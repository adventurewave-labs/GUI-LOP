/**
 * SPA nginx security headers (roadmap 25 / P3).
 *
 * Static policy checks always run. When an `nginx` binary is available
 * (GitHub's ubuntu runners ship one) the real config is rendered exactly
 * like the image's envsubst step, started on a random port in front of a
 * stub backend, and the response headers are asserted per route — that is
 * what catches nginx's add_header inheritance trap, which a text check can't.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const DIR = path.join(ROOT, 'docker/frontend');
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');
const mainConf = read('nginx.conf');
const serverTpl = read('templates/default.conf.template');
const headersTpl = read('templates/security-headers.inc.template');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

function nginxBin() {
  try { execFileSync('nginx', ['-v'], { stdio: 'ignore' }); return 'nginx'; } catch { return null; }
}
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

describe('SPA nginx config — static policy', () => {
  test('no add_header at http level (it would be silently dropped wherever a location sets its own)', () => {
    expect(code(mainConf)).not.toMatch(/add_header/);
  });

  test('every location that sets a header also includes the security snippet', () => {
    const blocks = code(serverTpl).split(/\n\s*location\s+/).slice(1);
    const withHeaders = blocks.filter((b) => /add_header/.test(b));
    expect(withHeaders.length).toBeGreaterThanOrEqual(3);
    for (const b of withHeaders) expect(b).toMatch(/include \/etc\/nginx\/conf\.d\/security-headers\.inc;/);
  });

  test('script CSP is strict: no unsafe-inline / unsafe-eval / wildcards for scripts', () => {
    const csp = code(headersTpl).match(/Content-Security-Policy "([^"]+)"/)[1];
    const script = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self'");
    for (const d of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "default-src 'self'"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/localhost|\*/);
  });

  test('legacy / weak settings are gone', () => {
    expect(headersTpl).toMatch(/X-XSS-Protection "0"/);
    expect(code(mainConf)).toMatch(/server_tokens off;/);
    expect(code(serverTpl)).not.toMatch(/Connection 'upgrade'/); // broke upstream keepalive for every API call
  });

  test('Dockerfile renders the templates and lets the non-root user write conf.d', () => {
    const df = read('Dockerfile');
    expect(df).toMatch(/COPY docker\/frontend\/templates\/ \/etc\/nginx\/templates\//);
    expect(df).toMatch(/ENV CSP_CONNECT_EXTRA=""/);
    expect(df).toMatch(/chown -R nginx:nginx[^\n]*\/etc\/nginx\/conf\.d/);
  });
});

const bin = nginxBin();
const describeIfNginx = bin ? describe : describe.skip;

describeIfNginx('SPA nginx config — live (real nginx)', () => {
  let tmp; let proc; let backend; let base;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-nginx-'));
    const [port, backendPort] = [await freePort(), await freePort()];
    backend = http.createServer((req, res) => {
      res.setHeader('X-Backend', 'yes');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.end(JSON.stringify({ path: req.url, connection: req.headers.connection ?? null }));
    }).listen(backendPort, '127.0.0.1');

    const confd = path.join(tmp, 'conf.d');
    const html = path.join(tmp, 'html');
    fs.mkdirSync(confd); fs.mkdirSync(path.join(html, 'static/js'), { recursive: true });
    fs.writeFileSync(path.join(html, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(html, 'static/js/main.abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(html, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(html, '.env'), 'SECRET=1');
    // Workers drop to an unprivileged user when the master runs as root.
    for (const p of [tmp, html, path.join(html, 'static'), path.join(html, 'static/js')]) fs.chmodSync(p, 0o755);

    // Same substitution the image's entrypoint does (only defined vars).
    const env = { CSP_CONNECT_EXTRA: ' https://api.example.com' };
    const render = (s) => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in env ? env[k] : m));
    fs.writeFileSync(path.join(confd, 'security-headers.inc'), render(headersTpl));
    fs.writeFileSync(path.join(confd, 'default.conf'), render(serverTpl)
      .replace('server backend:3001;', `server 127.0.0.1:${backendPort};`)
      .replace('listen 3000;', `listen 127.0.0.1:${port};`)
      .replace('root /usr/share/nginx/html;', `root ${html};`)
      .replaceAll('/etc/nginx/conf.d/security-headers.inc', path.join(confd, 'security-headers.inc')));
    fs.writeFileSync(path.join(tmp, 'nginx.conf'), mainConf
      .replace('user nginx;', '')
      .replace('/var/log/nginx/error.log', path.join(tmp, 'error.log'))
      .replace('/var/log/nginx/access.log', path.join(tmp, 'access.log'))
      .replace('/var/run/nginx.pid', path.join(tmp, 'nginx.pid'))
      .replace('/etc/nginx/conf.d/*.conf', path.join(confd, '*.conf'))
      .replace('use epoll;', ''));

    execFileSync(bin, ['-t', '-p', tmp, '-c', path.join(tmp, 'nginx.conf')], { stdio: 'pipe' });
    proc = spawn(bin, ['-p', tmp, '-c', path.join(tmp, 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' });
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  }, 20_000);

  afterAll(() => {
    proc?.kill('SIGTERM');
    backend?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  const get = (p, headers = {}) => fetch(`${base}${p}`, { headers, redirect: 'manual' });

  test.each(['/', '/index.html', '/workflows/123/steps', '/static/js/main.abc123.js', '/manifest.json'])(
    'full security header set on %s', async (p) => {
      const res = await get(p);
      expect(res.status).toBe(200);
      const csp = res.headers.get('content-security-policy');
      expect(csp).toContain("script-src 'self';");
      expect(csp).toContain("connect-src 'self' https://api.example.com;");
      expect(res.headers.get('content-security-policy-report-only')).toBe("require-trusted-types-for 'script'");
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('permissions-policy')).toMatch(/camera=\(\)/);
      expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(res.headers.get('x-xss-protection')).toBe('0');
      expect(res.headers.get('strict-transport-security')).toBeNull(); // plain http
      expect(res.headers.get('server')).toBe('nginx'); // no version
    },
  );

  test('caching: shell revalidates, hashed assets immutable, root assets short', async () => {
    expect((await get('/')).status).toBe(200);
    expect((await get('/')).headers.get('cache-control')).toBe('no-cache');
    expect((await get('/some/route')).headers.get('cache-control')).toBe('no-cache');
    expect((await get('/static/js/main.abc123.js')).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await get('/manifest.json')).headers.get('cache-control')).toBe('public, max-age=3600');
  });

  test('HSTS only when the edge terminated TLS', async () => {
    const res = await get('/', { 'X-Forwarded-Proto': 'https' });
    expect(res.headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains');
  });

  test('API responses are proxied untouched (no SPA CSP layered on) with upstream keepalive', async () => {
    const res = await get('/api/v1/ping');
    expect(res.headers.get('x-backend')).toBe('yes');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    const body = await res.json();
    expect(body.path).toBe('/api/v1/ping');
    expect(body.connection).not.toBe('upgrade');
  });

  test('a missing hashed asset is a real 404, not index.html; dotfiles are denied', async () => {
    expect((await get('/static/js/nope.js')).status).toBe(404);
    expect((await get('/.env')).status).toBe(403);
    expect((await get('/health')).status).toBe(200);
  });
});
