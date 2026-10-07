/**
 * graceful-shutdown.test.js — ordering guarantees of bootstrap().shutdown().
 *
 * Boots the in-memory stack on a loopback port and verifies:
 *   - during the drain window the server still serves, /readyz is 503 and
 *     responses carry `Connection: close`
 *   - live WebSocket clients receive 1001 Going Away
 *   - an in-flight request started before shutdown completes successfully
 *   - shutdown is idempotent and the listener is closed afterwards
 */
import http from 'node:http';
import WebSocket from 'ws';
import { bootstrap } from '../main.js';
import { loadConfig } from '../config.js';

function get(port, path, { agent } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

/** Register a GET route ahead of the trailing 404 + error handlers. */
function injectRoute(app, path, handler) {
  const stack = app._router.stack;
  const before = stack.length;
  app.get(path, handler);
  const added = stack.splice(before, stack.length - before);
  stack.splice(stack.length - 2, 0, ...added);
}

async function boot() {
  const booted = await bootstrap({ JWT_SECRET: 'drain-test-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
  await new Promise((r) => booted.httpServer.listen(0, '127.0.0.1', r));
  return { booted, port: booted.httpServer.address().port };
}

describe('graceful shutdown', () => {
  test('drain window: still serving, readiness 503, Connection: close', async () => {
    const { booted, port } = await boot();
    const done = booted.shutdown({ drainDelayMs: 300 });
    await new Promise((r) => setTimeout(r, 50));

    const live = await get(port, '/livez');
    expect(live.status).toBe(200);
    expect(live.headers.connection).toBe('close');

    const ready = await get(port, '/readyz');
    expect(ready.status).toBe(503);
    expect(JSON.parse(ready.body).status).toBe('draining');

    await done;
    expect(booted.httpServer.listening).toBe(false);
    await expect(get(port, '/livez')).rejects.toThrow();
  });

  test('live WebSocket clients get 1001 Going Away', async () => {
    const { booted, port } = await boot();
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: 'u' }, 60);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/v1?token=${token}`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    await booted.shutdown();
    await expect(closed).resolves.toBe(1001);
  });

  test('in-flight request finishes before the server closes', async () => {
    const { booted, port } = await boot();
    injectRoute(booted.app, '/__slow', (_req, res) => setTimeout(() => res.json({ ok: true }), 200));

    const inflight = get(port, '/__slow');
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    await booted.shutdown({ inFlightTimeoutMs: 2000 });
    // Must not wait for the force-close deadline once the response is sent.
    expect(Date.now() - t0).toBeLessThan(1000);
    const res = await inflight;
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  test('stuck requests are force-closed at the in-flight deadline', async () => {
    const { booted, port } = await boot();
    injectRoute(booted.app, '/__hang', () => { /* never responds */ });

    const hung = get(port, '/__hang').catch((e) => e);
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    await booted.shutdown({ inFlightTimeoutMs: 150 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((await hung)?.code).toBe('ECONNRESET');
  });

  test('shutdown is idempotent (concurrent callers share one run)', async () => {
    const { booted } = await boot();
    const a = booted.shutdown();
    const b = booted.shutdown();
    expect(a).toBe(b);
    await a;
  });
});

describe('shutdown config invariants', () => {
  test('drain delay must be below the shutdown timeout', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: 'x', SHUTDOWN_DRAIN_DELAY_MS: '30000', SHUTDOWN_TIMEOUT_MS: '25000' }),
    ).toThrow(/SHUTDOWN_DRAIN_DELAY_MS/);
    const c = loadConfig({ JWT_SECRET: 'x' });
    expect(c.SHUTDOWN_DRAIN_DELAY_MS).toBe(5000);
    expect(c.SHUTDOWN_TIMEOUT_MS).toBe(25000);
  });
});
