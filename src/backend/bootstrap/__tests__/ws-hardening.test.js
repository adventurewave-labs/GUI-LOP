/**
 * ws-hardening.test.js — WebSocket admission + live-connection policy and
 * end-to-end delivery through the real broadcaster, over loopback.
 */
import WebSocket from 'ws';
import { bootstrap } from '../main.js';
import { attach, CLOSE_TOKEN_EXPIRED, selectSubprotocol } from '../../contexts/notification/interfaces/websocket/ws-server.js';
import { WsBroadcaster } from '../../contexts/notification/infrastructure/transport/ws-broadcaster.js';

function connect(url, opts) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, opts);
    ws.once('open', () => resolve({ ws, status: 'open' }));
    ws.once('unexpected-response', (_req, res) => resolve({ ws, status: res.statusCode }));
    ws.once('error', () => resolve({ ws, status: 'error' }));
  });
}
const nextMessage = (ws) => new Promise((r) => { ws.once('message', (d) => r(String(d))); });
const closeCode = (ws) => new Promise((r) => { ws.once('close', (code) => r(code)); });

describe('WebSocket hardening (booted server)', () => {
  let booted;
  let base;
  let token;
  const opened = [];

  beforeAll(async () => {
    booted = await bootstrap({
      JWT_SECRET: 'ws-hardening-secret',
      LOG_LEVEL: 'error',
      NODE_ENV: 'test',
      CORS_ORIGINS: 'https://app.example.com',
      WS_MAX_CONNECTIONS_PER_USER: '2',
      WS_MAX_PAYLOAD_BYTES: '1024',
    });
    await new Promise((r) => { booted.httpServer.listen(0, '127.0.0.1', r); });
    base = `ws://127.0.0.1:${booted.httpServer.address().port}`;
    ({ token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: 'ws-u1' }, 300));
  });

  afterEach(async () => {
    for (const ws of opened.splice(0)) {
      if (ws.readyState === WebSocket.OPEN) {
        const done = closeCode(ws);
        ws.close();
        await done;
      }
    }
    // Let server-side close handlers release quota slots.
    await new Promise((r) => { setTimeout(r, 20); });
  });

  afterAll(() => booted?.shutdown());

  const open = async (path = `/ws/v1?token=${token}`, opts) => {
    const r = await connect(`${base}${path}`, opts);
    opened.push(r.ws);
    return r;
  };

  test('END-TO-END: a broadcast reaches the live socket (was broken: in-memory double wired)', async () => {
    const { ws, status } = await open();
    expect(status).toBe('open');
    await new Promise((r) => { setTimeout(r, 20); }); // subscription save
    const got = nextMessage(ws);
    await booted.ctx.notification.transports.websocketBroadcaster.broadcast(
      { subscriberRef: 'ws-u1' },
      { type: 'workflow.step_ready', id: 42 },
    );
    expect(JSON.parse(await got)).toEqual({ type: 'workflow.step_ready', id: 42 });
  });

  test('other paths are not upgraded (404)', async () => {
    expect((await open(`/socket?token=${token}`)).status).toBe(404);
  });

  test('cross-site Origin is refused (403); allowed Origin and no Origin pass', async () => {
    expect((await open(undefined, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await open(undefined, { origin: 'https://app.example.com' })).status).toBe('open');
  });

  test('per-user connection cap → 429, slot released on close', async () => {
    const a = await open();
    const b = await open();
    expect([a.status, b.status]).toEqual(['open', 'open']);
    expect((await open()).status).toBe(429);

    const done = closeCode(a.ws);
    a.ws.close();
    await done;
    await new Promise((r) => { setTimeout(r, 30); });
    expect((await open()).status).toBe('open');
  });

  test('oversized frames close with 1009', async () => {
    const { ws } = await open();
    const code = closeCode(ws);
    ws.send('x'.repeat(4096));
    await expect(code).resolves.toBe(1009);
  });

  test('bearer subprotocol: negotiated protocol is "bearer", token never echoed', async () => {
    const { ws, status } = await open('/ws/v1', [token, 'bearer'].reverse());
    expect(status).toBe('open');
    expect(ws.protocol).toBe('bearer');
  });

  test('token listed first is still not selected as the protocol', async () => {
    // Even a misordered client must not get its credential reflected back.
    const { ws } = await open('/ws/v1', ['bearer', token]);
    expect(ws.protocol).toBe('bearer');
    expect(selectSubprotocol(new Set([token, 'bearer']))).toBe('bearer');
    expect(selectSubprotocol(new Set(['graphql-ws']))).toBe(false);
  });

  test('"ping" text frame gets "pong"', async () => {
    const { ws } = await open();
    const got = nextMessage(ws);
    ws.send('ping');
    await expect(got).resolves.toBe('pong');
  });
});

/* -------- unit-level policy with injected timers / fake clock -------- */

describe('ws-server live-connection policy', () => {
  let http;
  let handle;
  let port;

  async function start(opts) {
    const { createServer } = await import('node:http');
    http = createServer();
    const broadcaster = new WsBroadcaster();
    const subs = new Map();
    handle = await attach(http, {
      principalFromUpgrade: async () => opts.principal ?? { id: 'p1' },
      subscriptionRepository: {
        save: async (s) => { subs.set(s.id, s); },
        delete: async (id) => { subs.delete(id); },
      },
      websocketBroadcaster: broadcaster,
      ...opts,
    });
    await new Promise((r) => { http.listen(0, '127.0.0.1', r); });
    port = http.address().port;
  }

  afterEach(async () => {
    await handle?.close({ terminateAfterMs: 50 });
    await new Promise((r) => { http.close(r); });
  });

  test('access-token expiry closes the socket with 4001', async () => {
    await start({ principal: { id: 'p1', exp: Math.floor(Date.now() / 1000) + 1 }, now: () => Date.now() + 900 });
    const { ws } = await connect(`ws://127.0.0.1:${port}/ws/v1`);
    await expect(closeCode(ws)).resolves.toBe(CLOSE_TOKEN_EXPIRED);
  });

  test('activity resets the idle timer (regression: sockets died 30 s after connect)', async () => {
    await start({ idleTimeoutMs: 150, pingIntervalMs: 10_000 });
    const { ws } = await connect(`ws://127.0.0.1:${port}/ws/v1`);
    let closed = false;
    ws.once('close', () => { closed = true; });
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => { setTimeout(r, 80); });
      ws.send('ping'); // activity every 80 ms < 150 ms idle window
    }
    expect(closed).toBe(false); // alive at ~400 ms, well past one idle window
    const code = closeCode(ws);
    await expect(code).resolves.toBe(1006); // goes idle → terminated
  });

  test('connectionCount tracks live sockets', async () => {
    await start({});
    const { ws } = await connect(`ws://127.0.0.1:${port}/ws/v1`);
    await new Promise((r) => { setTimeout(r, 20); });
    expect(handle.connectionCount('p1')).toBe(1);
    const done = closeCode(ws);
    ws.close();
    await done;
    await new Promise((r) => { setTimeout(r, 20); });
    expect(handle.connectionCount('p1')).toBe(0);
  });
});

describe('WsBroadcaster backpressure', () => {
  test('slow consumer over the buffer limit is closed with 1013, not written to', async () => {
    const b = new WsBroadcaster({ maxBufferedBytes: 100 });
    const sent = [];
    const closes = [];
    const ws = { bufferedAmount: 1000, send: (p) => sent.push(p), close: (c) => closes.push(c) };
    b.register('c1', ws, { subscriberRef: 'u' });
    await b.send('c1', { a: 1 });
    expect(sent).toEqual([]);
    expect(closes).toEqual([1013]);
  });

  test('healthy consumer receives JSON', async () => {
    const b = new WsBroadcaster();
    const sent = [];
    b.register('c1', { bufferedAmount: 0, send: (p) => sent.push(p) }, { subscriberRef: 'u' });
    await b.broadcast({ subscriberRef: 'u' }, { a: 1 });
    expect(sent).toEqual(['{"a":1}']);
  });
});
