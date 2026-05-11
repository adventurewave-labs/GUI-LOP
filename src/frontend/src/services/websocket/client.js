/**
 * WebSocket client for the GUI-LOP v1 envelope.
 *
 * Connects to `ws[s]://<host>/ws/v1` (the backend currently mounts `ws` on
 * any upgrade path; we still send `/ws/v1` for forward compatibility, see
 * ADR 0017). The access token is sent via a query parameter (`?token=...`)
 * — browser WebSocket APIs do not allow custom headers, so this is the
 * only universally-supported way to ferry a bearer through an upgrade
 * handshake. Per ADR 0008 the access token has a short TTL so leaking the
 * URL has limited blast radius.
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

import { accessTokenStore, apiBaseUrl } from '../api/client.js';

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

function defaultUrlBuilder({ baseUrl, path, token, userId }) {
  const httpBase = baseUrl || apiBaseUrl;
  const wsBase = httpBase.replace(/^https/, 'wss').replace(/^http/, 'ws').replace(/\/$/, '');
  const url = new URL(`${wsBase}${path}`);
  if (token) url.searchParams.set('token', token);
  if (userId) url.searchParams.set('user_id', userId);
  return url.toString();
}

/**
 * Create a WebSocket client.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]    HTTP base URL; converted to ws[s]://.
 * @param {string} [options.path]       WebSocket path (default `/ws/v1`).
 * @param {() => string|null} [options.getToken] Token provider (default reads accessTokenStore).
 * @param {() => string|null} [options.getUserId] Optional user id (used in dev where the
 *                                       backend authenticates upgrades via x-user-id).
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
    getUserId = () => null,
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
    const userId = getUserId ? getUserId() : null;
    const url = urlBuilder({ baseUrl, path, token, userId });

    const Impl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!Impl) {
      setStatus('error');
      return;
    }

    setStatus('connecting');
    let ws;
    try {
      ws = new Impl(url);
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
    ws.onclose = () => {
      socket = null;
      setStatus('closed');
      if (!manuallyClosed) scheduleReconnect();
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
