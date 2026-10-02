/**
 * Unit tests for the v1 WebSocket client. Uses a fake WebSocket that
 * records onopen/onmessage/onclose handlers so we can simulate frames
 * synchronously — this avoids real timers/sockets and keeps the test
 * snappy.
 */

import {
  createWebSocketClient,
  KNOWN_EVENT_TYPES,
  WS_SUBPROTOCOL,
  CLOSE_TOKEN_EXPIRED,
} from '../client.js';

class FakeWebSocket {
  static instances = [];
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.sent = [];
    this.closed = null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen({});
  }
  emit(payload) {
    if (this.onmessage) {
      this.onmessage({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    }
  }
  fail() {
    if (this.onerror) this.onerror(new Error('boom'));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.closed = { code, reason };
    if (this.onclose) this.onclose({ code, reason });
  }
  send(data) {
    this.sent.push(data);
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

describe('websocket client', () => {
  test('connects and dispatches by event type', () => {
    const client = createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      getToken: () => 'tok',
      urlBuilder: ({ token }) => `ws://test/ws/v1?token=${token}`,
      autoConnect: true,
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    const sock = FakeWebSocket.instances[0];
    expect(sock.url).toContain('token=tok');

    sock.open();
    expect(client.status).toBe('open');

    const seen = [];
    const tok = client.subscribe('workflow.completed', (env) => seen.push(env));
    sock.emit({
      type: 'workflow.completed',
      version: 1,
      payload: { workflowId: 'wf-1' },
      occurredAt: '2025-01-01T00:00:00Z',
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('workflow.completed');
    expect(seen[0].payload.workflowId).toBe('wf-1');

    // Ignored when type doesn't match
    sock.emit({ type: 'workflow.failed', version: 1, payload: {} });
    expect(seen).toHaveLength(1);

    // Wildcard handler
    const wildSeen = [];
    client.subscribe('*', (env) => wildSeen.push(env.type));
    sock.emit({ type: 'workflow.cancelled', version: 1, payload: {} });
    expect(wildSeen).toContain('workflow.cancelled');

    // Unsubscribe stops dispatch
    client.unsubscribe(tok);
    sock.emit({ type: 'workflow.completed', version: 1, payload: {} });
    expect(seen).toHaveLength(1);
  });

  test('schedules exponential backoff up to 30s ceiling', () => {
    const delays = [];
    const client = createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      autoConnect: false,
      scheduler: (ms) => delays.push(ms),
    });

    // Fire scheduleReconnect 8 times via the test helper.
    for (let i = 0; i < 8; i += 1) {
      client._scheduleReconnectForTest();
    }

    expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000]);
    // 32_000 is capped at 30_000
    expect(delays[5]).toBe(30_000);
    expect(delays[6]).toBe(30_000);
    expect(delays[7]).toBe(30_000);
    expect(client.reconnectAttempt).toBe(8);
  });

  test('reconnects after non-clean close', () => {
    const delays = [];
    const client = createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      getToken: () => 'tok',
      urlBuilder: () => 'ws://test/ws/v1',
      autoConnect: true,
      scheduler: (ms) => delays.push(ms),
    });
    const first = FakeWebSocket.instances[0];
    first.open();
    first.close(1006, 'abnormal');
    expect(delays).toEqual([1000]);

    // Manual disconnect should NOT schedule a reconnect.
    delays.length = 0;
    client.disconnect();
    expect(delays).toEqual([]);
  });

  test('manual disconnect prevents reconnect', () => {
    const delays = [];
    const client = createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      getToken: () => 'tok',
      urlBuilder: () => 'ws://test/ws/v1',
      autoConnect: true,
      scheduler: (ms) => delays.push(ms),
    });
    const sock = FakeWebSocket.instances[0];
    sock.open();
    client.disconnect();
    expect(client.status).toBe('closed');
    // A subsequent close event must not enqueue a reconnect.
    sock.close(1006, 'after manual close');
    expect(delays).toEqual([]);
  });

  test('handles malformed frames without throwing', () => {
    const client = createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      getToken: () => 'tok',
      urlBuilder: () => 'ws://test/ws/v1',
      autoConnect: true,
    });
    const sock = FakeWebSocket.instances[0];
    sock.open();
    expect(() => sock.emit('not json')).not.toThrow();
    expect(() => sock.emit('null')).not.toThrow();
  });

  test('exposes the canonical list of event types', () => {
    expect(KNOWN_EVENT_TYPES).toContain('workflow.created');
    expect(KNOWN_EVENT_TYPES).toContain('workflow.human_input_required');
    expect(KNOWN_EVENT_TYPES).toContain('human_response.recorded');
    expect(KNOWN_EVENT_TYPES).toContain('ui.generated');
  });
});

describe('websocket client auth transport', () => {
  test('default: token rides in Sec-WebSocket-Protocol, never in the URL', () => {
    createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      baseUrl: 'https://api.example.com',
      getToken: () => 'secret.jwt',
      autoConnect: true,
    });
    const sock = FakeWebSocket.instances[0];
    expect(sock.url).toBe('wss://api.example.com/ws/v1');
    expect(sock.url).not.toContain('secret.jwt');
    expect(sock.protocols).toEqual([WS_SUBPROTOCOL, 'secret.jwt']);
  });

  test('no token → no subprotocols', () => {
    createWebSocketClient({ WebSocketImpl: FakeWebSocket, baseUrl: 'http://x', getToken: () => null, autoConnect: true });
    expect(FakeWebSocket.instances[0].protocols).toBeUndefined();
  });

  test("legacy tokenTransport: 'query' keeps ?token=", () => {
    createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      baseUrl: 'http://localhost:3001',
      getToken: () => 'tok',
      tokenTransport: 'query',
      autoConnect: true,
    });
    const sock = FakeWebSocket.instances[0];
    expect(sock.url).toBe('ws://localhost:3001/ws/v1?token=tok');
    expect(sock.protocols).toBeUndefined();
  });

  test('never sends the dev-only user_id param', () => {
    createWebSocketClient({ WebSocketImpl: FakeWebSocket, baseUrl: 'http://x', getToken: () => 't', getUserId: () => 'u1', autoConnect: true });
    expect(FakeWebSocket.instances[0].url).not.toContain('user_id');
  });

  test('close 4001 → onTokenExpired() then immediate reconnect with the fresh token', async () => {
    let current = 'old';
    const scheduler = jest.fn();
    const onTokenExpired = jest.fn(async () => { current = 'new'; });
    createWebSocketClient({
      WebSocketImpl: FakeWebSocket,
      baseUrl: 'http://x',
      getToken: () => current,
      onTokenExpired,
      scheduler,
      autoConnect: true,
    });
    const first = FakeWebSocket.instances[0];
    first.open();
    first.close(CLOSE_TOKEN_EXPIRED, 'token expired');
    await new Promise((r) => setTimeout(r, 0));
    expect(onTokenExpired).toHaveBeenCalledTimes(1);
    expect(scheduler).not.toHaveBeenCalled(); // no backoff
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].protocols).toEqual([WS_SUBPROTOCOL, 'new']);
  });

  test('other close codes use backoff, not the refresh path', () => {
    const scheduler = jest.fn();
    const onTokenExpired = jest.fn();
    createWebSocketClient({ WebSocketImpl: FakeWebSocket, baseUrl: 'http://x', getToken: () => 't', onTokenExpired, scheduler, autoConnect: true });
    FakeWebSocket.instances[0].close(1006, '');
    expect(scheduler).toHaveBeenCalledWith(1000);
    expect(onTokenExpired).not.toHaveBeenCalled();
  });
});
