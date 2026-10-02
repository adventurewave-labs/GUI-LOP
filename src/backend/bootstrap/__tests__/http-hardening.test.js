/**
 * http-hardening.test.js — composition-root HTTP behaviour.
 *
 * Unit tests for the helpers plus an in-memory end-to-end boot that
 * exercises probes, security headers, error mapping and a real
 * WebSocket upgrade over a loopback socket.
 */
import request from 'supertest';
import WebSocket from 'ws';
import {
  requestIdMiddleware,
  parseTrustProxy,
  jsonErrorHandler,
  applyServerTimeouts,
  probeWithTimeout,
} from '../http-hardening.js';
import { bootstrap } from '../main.js';
import { loadConfig } from '../config.js';

describe('http-hardening helpers', () => {
  test('requestIdMiddleware keeps a well-formed inbound id and echoes it', () => {
    const headers = {};
    const req = { get: () => 'abc-123' };
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    requestIdMiddleware()(req, res, () => {});
    expect(req.id).toBe('abc-123');
    expect(headers['X-Request-Id']).toBe('abc-123');
  });

  test('requestIdMiddleware replaces an injected/oversized id', () => {
    const res = { setHeader() {} };
    for (const bad of ['a\r\nSet-Cookie: x=1', 'x'.repeat(200), '<script>']) {
      const req = { get: () => bad };
      requestIdMiddleware({ genId: () => 'fresh' })(req, res, () => {});
      expect(req.id).toBe('fresh');
    }
  });

  test.each([
    [undefined, false],
    ['false', false],
    ['true', true],
    ['2', 2],
    ['loopback, 10.0.0.0/8', ['loopback', '10.0.0.0/8']],
  ])('parseTrustProxy(%p) → %p', (raw, expected) => {
    expect(parseTrustProxy(raw)).toEqual(expected);
  });

  test('applyServerTimeouts keeps headersTimeout above keepAliveTimeout', () => {
    const server = {};
    applyServerTimeouts(server, {
      HTTP_KEEPALIVE_TIMEOUT_MS: 65000,
      HTTP_HEADERS_TIMEOUT_MS: 15000,
      HTTP_REQUEST_TIMEOUT_MS: 30000,
    });
    expect(server.keepAliveTimeout).toBe(65000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    expect(server.requestTimeout).toBeGreaterThanOrEqual(server.headersTimeout);
  });

  test('probeWithTimeout bounds a hung dependency', async () => {
    const r = await probeWithTimeout(() => new Promise(() => {}), 20);
    expect(r).toEqual({ ok: false, error: 'probe_timeout' });
    await expect(probeWithTimeout(async () => 'PONG', 50)).resolves.toEqual({ ok: true, value: 'PONG' });
  });

  test('jsonErrorHandler never leaks 5xx detail', () => {
    let status;
    let body;
    const res = {
      headersSent: false,
      status(s) { status = s; return res; },
      json(b) { body = b; return res; },
    };
    jsonErrorHandler()(new Error('db password is hunter2'), { id: 'r1' }, res, () => {});
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body.request_id).toBe('r1');
  });
});

describe('config hardening invariants', () => {
  const base = { JWT_SECRET: 'x' };
  test('boolean coercion', () => {
    expect(loadConfig({ ...base, WS_ALLOW_HEADER_AUTH: 'yes' }).WS_ALLOW_HEADER_AUTH).toBe(true);
    expect(loadConfig(base).WS_ALLOW_HEADER_AUTH).toBe(false);
    expect(() => loadConfig({ ...base, WS_ALLOW_HEADER_AUTH: 'maybe' })).toThrow(/boolean/);
  });
  test('refuses insecure WS header auth in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', WS_ALLOW_HEADER_AUTH: 'true' }),
    ).toThrow(/WS_ALLOW_HEADER_AUTH/);
  });
  test('rejects headers timeout above request timeout', () => {
    expect(() =>
      loadConfig({ ...base, HTTP_HEADERS_TIMEOUT_MS: '40000', HTTP_REQUEST_TIMEOUT_MS: '30000' }),
    ).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);
  });
});

describe('bootstrap HTTP surface (in-memory)', () => {
  let booted;
  let baseUrl;

  beforeAll(async () => {
    booted = await bootstrap({
      JWT_SECRET: 'hardening-test-secret',
      LOG_LEVEL: 'error',
      NODE_ENV: 'test',
    });
    await new Promise((r) => booted.httpServer.listen(0, '127.0.0.1', r));
    const { port } = booted.httpServer.address();
    baseUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (booted) await booted.shutdown();
  });

  test('GET /livez is dependency-free 200', async () => {
    const res = await request(booted.app).get('/livez');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('GET /readyz is 200 with no configured deps', async () => {
    const res = await request(booted.app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  test('security headers are set and x-powered-by is absent', async () => {
    const res = await request(booted.app).get('/livez');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('X-Request-Id is echoed back', async () => {
    const res = await request(booted.app).get('/livez').set('X-Request-Id', 'trace-42');
    expect(res.headers['x-request-id']).toBe('trace-42');
  });

  test('malformed JSON body → 400, not 500', async () => {
    const res = await request(booted.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
    expect(res.body.request_id).toEqual(expect.any(String));
  });

  test('oversized JSON body → 413, not 500', async () => {
    const res = await request(booted.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ pad: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('payload_too_large');
  });

  const openWs = (url, opts) =>
    new Promise((resolve) => {
      const ws = new WebSocket(url, opts);
      ws.once('open', () => { ws.close(); resolve('open'); });
      ws.once('unexpected-response', (_req, res) => { resolve(res.statusCode); });
      ws.once('error', () => resolve('error'));
    });

  test('WS upgrade with forged X-User-Id is rejected with 401', async () => {
    await expect(
      openWs(`${baseUrl}/ws/v1`, { headers: { 'X-User-Id': 'victim' } }),
    ).resolves.toBe(401);
  });

  test('WS upgrade with a valid access token succeeds', async () => {
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: 'ws-user' }, 60);
    await expect(openWs(`${baseUrl}/ws/v1?token=${token}`)).resolves.toBe('open');
  });

  test('WS upgrade via bearer subprotocol succeeds', async () => {
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: 'ws-user' }, 60);
    await expect(openWs(`${baseUrl}/ws/v1`, ['bearer', token])).resolves.toBe('open');
  });
});
