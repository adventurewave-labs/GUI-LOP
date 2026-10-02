/**
 * WebSocket client for the GUI-LOP v1 envelope.
 *
 * Connects to `ws[s]://<host>/ws/v1` (the only path the backend upgrades).
 *
 * Auth: browsers can't set headers on `new WebSocket(...)`, so the access
 * token rides in the subprotocol list — `Sec-WebSocket-Protocol: bearer,
 * <token>`. Unlike `?token=` this never lands in URLs, proxy/CDN access logs,
 * browser history or Referer. The server always selects `bearer` as the
 * negotiated protocol, so the token is not echoed back.
 * `tokenTransport: 'query'` keeps the legacy `?token=` behaviour for
 * environments whose proxies strip unknown subprotocols.
 *
 * Close code 4001 means the access token expired mid-session: the client
 * calls `onTokenExpired()` (e.g. the auth refresh flow) and reconnects
 * immediately instead of backing off.
 *
 * Versioned envelope (per ADR 0005):
 *
 *   { type, version, payload, occurredAt }
 *
 * Known event types (dispatched via `subscribe(eventType, handler)`):
 *   - workflow.created
 *   - workflow.started
 *   - workflow.step_started
 *   - workflow.human_input_required
 *   - workflow.completed
 *   - workflow.failed
 *   - workflow.cancelled
 *   - human_response.recorded
 *   - ui.generated
 *
 * `subscribe('*', handler)` listens to every event.
 *
 * Reconnect strategy: exponential backoff (1s, 2s, 4s, ...) capped at 30s.
 */

import { accessTokenStore, apiBaseUrl, refreshAccessToken } from '../api/client.js';

export const KNOWN_EVENT_TYPES = Object.freeze([
  'workflow.created',
  'workflow.started',
  'workflow.step_started',
  'workflow.human_input_required',
  'workflow.completed',
  'workflow.failed',
  'workflow.cancelled',
  'human_response.recorded',
  'ui.generated',
]);

const DEFAULT_PATH = '/ws/v1';
const MAX_BACKOFF_MS = 30_000;

export const WS_SUBPROTOCOL = 'bearer';
export const CLOSE_TOKEN_EXPIRED = 4001;

function defaultUrlBuilder({ baseUrl, path, token, tokenTransport = 'subprotocol' }) {
  const httpBase = baseUrl || apiBaseUrl;
  const wsBase = httpBase.replace(/^https/, 'wss').replace(/^http/, 'ws').replace(/\/$/, '');
  const url = new URL(`${wsBase}${path}`);
  if (token && tokenTransport === 'query') url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Create a WebSocket client.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]    HTTP base URL; converted to ws[s]://.
 * @param {string} [options.path]       WebSocket path (default `/ws/v1`).
 * @param {() => string|null} [options.getToken] Token provider (default reads accessTokenStore).
 * @param {'subprotocol'|'query'} [options.tokenTransport] How the token is sent (default subprotocol).
 * @param {() => (void|Promise<void>)} [options.onTokenExpired] Called on close 4001 before reconnecting.
 *   Defaults to the API client's single-flight token refresh, so an expired
 *   socket renews its token instead of reconnecting with the stale one.
 * @param {(opts: object) => string} [options.urlBuilder] Custom URL builder.
 * @param {boolean} [options.autoConnect] Connect immediately on creation.
 * @param {typeof WebSocket} [options.WebSocketImpl] Override for tests.
 * @param {(ms: number) => void} [options.scheduler] Custom scheduler for tests.
 */
export function createWebSocketClient(options = {}) {
  const {
    baseUrl,
    path = DEFAULT_PATH,
    getToken = () => accessTokenStore.get(),
    tokenTransport = 'subprotocol',
    onTokenExpired = () => refreshAccessToken(),
    urlBuilder = defaultUrlBuilder,
    autoConnect = false,
    WebSocketImpl,
    scheduler,
  } = options;

  const handlers = new Map();          // eventType → Map(token → handler)
  const tokenIndex = new Map();        // token → eventType
  let nextToken = 1;
  const stateListeners = new Set();    // (status) => void
  let socket = null;
  let status = 'idle';                 // idle | connecting | open | closed | error
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let manuallyClosed = false;
  let lastEnvelope = null;

  function setStatus(next) {
    status = next;
    stateListeners.forEach((fn) => {
      try {
        fn(next);
      } catch {
        /* ignore */
      }
    });
  }

  function dispatch(envelope) {
    if (!envelope || typeof envelope !== 'object') return;
    const type = envelope.type;
    if (!type) return;
    const exact = handlers.get(type);
    if (exact) {
      exact.forEach((fn) => {
        try {
          fn(envelope);
        } catch {
          /* ignore handler errors */
        }
      });
    }
    const wildcard = handlers.get('*');
    if (wildcard) {
      wildcard.forEach((fn) => {
        try {
          fn(envelope);
        } catch {
          /* ignore */
        }
      });
    }
  }

  function parseFrame(raw) {
    if (typeof raw !== 'string') return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      type: parsed.type ?? null,
      version: parsed.version ?? 1,
      payload: parsed.payload ?? {},
      occurredAt: parsed.occurredAt ?? parsed.occurred_at ?? null,
    };
  }

  function scheduleReconnect() {
    if (manuallyClosed) return;
    reconnectAttempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (reconnectAttempt - 1));
    if (scheduler) {
      scheduler(delay);
      return;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (status === 'connecting' || status === 'open') return;
    manuallyClosed = false;
    const token = getToken ? getToken() : null;
    const url = urlBuilder({ baseUrl, path, token, tokenTransport });
    const protocols =
      token && tokenTransport === 'subprotocol' ? [WS_SUBPROTOCOL, token] : undefined;

    const Impl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!Impl) {
      setStatus('error');
      return;
    }

    setStatus('connecting');
    let ws;
    try {
      ws = protocols ? new Impl(url, protocols) : new Impl(url);
    } catch (err) {
      setStatus('error');
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      reconnectAttempt = 0;
      setStatus('open');
    };
    ws.onmessage = (event) => {
      const env = parseFrame(typeof event.data === 'string' ? event.data : String(event.data));
      if (env) {
        lastEnvelope = env;
        dispatch(env);
      }
    };
    ws.onerror = () => {
      setStatus('error');
    };
    ws.onclose = (event) => {
      socket = null;
      setStatus('closed');
      if (manuallyClosed) return;
      if (event && event.code === CLOSE_TOKEN_EXPIRED) {
        // Token expired server-side: refresh, then reconnect at once. A failed
        // refresh (throw, or { ok: false } from the shared refresher) takes
        // the normal backoff path instead — reconnecting immediately with the
        // same stale token used to spin a tight 4001 → reconnect loop.
        Promise.resolve()
          .then(() => (onTokenExpired ? onTokenExpired() : undefined))
          .then((r) => !(r && r.ok === false), () => false)
          .then((refreshed) => {
            if (manuallyClosed) return;
            if (refreshed) connect();
            else scheduleReconnect();
          });
        return;
      }
      scheduleReconnect();
    };
  }

  function disconnect(code = 1000, reason = 'client close') {
    manuallyClosed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      try {
        socket.close(code, reason);
      } catch {
        /* ignore */
      }
    }
    socket = null;
    setStatus('closed');
  }

  function subscribe(eventType, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }
    if (!handlers.has(eventType)) handlers.set(eventType, new Map());
    const token = `sub_${nextToken++}`;
    handlers.get(eventType).set(token, handler);
    tokenIndex.set(token, eventType);
    return token;
  }

  function unsubscribe(token) {
    const eventType = tokenIndex.get(token);
    if (!eventType) return false;
    const bucket = handlers.get(eventType);
    if (!bucket) return false;
    const removed = bucket.delete(token);
    if (bucket.size === 0) handlers.delete(eventType);
    tokenIndex.delete(token);
    return removed;
  }

  function onStatusChange(fn) {
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
  }

  if (autoConnect) {
    connect();
  }

  return {
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    onStatusChange,
    /* debug helpers used by tests */
    _ingest(rawJson) {
      const env = parseFrame(typeof rawJson === 'string' ? rawJson : JSON.stringify(rawJson));
      if (env) {
        lastEnvelope = env;
        dispatch(env);
      }
    },
    _scheduleReconnectForTest: scheduleReconnect,
    get status() {
      return status;
    },
    get lastEnvelope() {
      return lastEnvelope;
    },
    get reconnectAttempt() {
      return reconnectAttempt;
    },
  };
}

export default createWebSocketClient;
