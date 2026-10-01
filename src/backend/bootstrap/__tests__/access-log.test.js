/**
 * access-log.test.js — end-to-end request context + access log.
 *
 * Captures stdout/stderr JSON lines from a booted in-memory app and checks
 * that each request yields one `http_request` line with a bounded route
 * label, the request id, the authenticated user, and no query-string
 * credentials.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import { routeTemplate } from '../http-hardening.js';

describe('access log', () => {
  let booted;
  let lines;
  let outSpy;
  let errSpy;

  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'access-log-secret', LOG_LEVEL: 'debug', NODE_ENV: 'test' });
  });
  afterAll(async () => {
    await booted?.shutdown();
  });

  beforeEach(() => {
    lines = [];
    const capture = (chunk) => {
      for (const l of String(chunk).split('\n')) {
        if (!l.trim()) continue;
        try { lines.push(JSON.parse(l)); } catch { /* non-JSON */ }
      }
      return true;
    };
    outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(capture);
    errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(capture);
  });
  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  const accessLines = () => lines.filter((l) => l.msg === 'http_request');
  const flush = () => new Promise((r) => setImmediate(r));

  test('authenticated request logs route template, status, request + user id', async () => {
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: 'user-77', role: 'admin' }, 60);
    await request(booted.app)
      .get('/api/v1/workflows/templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', 'req-abc')
      .expect(200);
    await flush();

    const [line] = accessLines();
    expect(line).toEqual(
      expect.objectContaining({
        level: 'info',
        method: 'GET',
        status: 200,
        request_id: 'req-abc',
        user_id: 'user-77',
        auth_via: 'jwt',
        route: expect.stringMatching(/^\/api\/v1\/workflows\//),
        duration_ms: expect.any(Number),
      }),
    );
    expect(accessLines()).toHaveLength(1);
  });

  test('query-string credentials never reach the log', async () => {
    await request(booted.app).get('/nope?token=supersecret&access_token=alsosecret');
    await flush();
    const raw = JSON.stringify(lines);
    expect(raw).not.toContain('supersecret');
    expect(raw).not.toContain('alsosecret');
    const [line] = accessLines();
    expect(line).toEqual(expect.objectContaining({ status: 404, route: 'unmatched', path: '/nope' }));
  });

  test('probe endpoints log at debug', async () => {
    await request(booted.app).get('/livez');
    await flush();
    expect(accessLines()[0].level).toBe('debug');
  });

  test('Authorization header value is never logged', async () => {
    await request(booted.app).get('/api/v1/workflows/templates').set('Authorization', 'Bearer leaked.jwt.value');
    await flush();
    expect(JSON.stringify(lines)).not.toContain('leaked.jwt.value');
  });
});

describe('routeTemplate', () => {
  test('joins baseUrl and route path; unmatched otherwise', () => {
    expect(routeTemplate({ baseUrl: '/api/v1/workflows', route: { path: '/:id' } })).toBe('/api/v1/workflows/:id');
    expect(routeTemplate({ route: { path: '/livez' } })).toBe('/livez');
    expect(routeTemplate({})).toBe('unmatched');
  });
});
