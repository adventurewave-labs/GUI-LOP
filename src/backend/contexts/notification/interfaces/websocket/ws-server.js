/**
 * ws-server.js — WebSocket adapter for the notification context.
 *
 * `attach(httpServer, deps)` handles HTTP upgrades and, per connection,
 * registers a Subscription + broadcaster entry. Upgrade admission, in order:
 *
 *   1. path      — only `path` (default `/ws/v1`) is upgraded; else 404
 *   2. origin    — browser `Origin` must be in `allowedOrigins` (CSWSH guard);
 *                  requests without `Origin` (server clients) are allowed
 *   3. auth      — `principalFromUpgrade` (verified JWT / API key); else 401
 *   4. quota     — ≤ `maxConnectionsPerUser` live sockets per principal; else 429
 *
 * Live-connection policy:
 *   - frames larger than `maxPayloadBytes` are rejected by `ws` (close 1009)
 *   - ping every `pingIntervalMs`; a missed pong terminates the socket
 *   - `idleTimeoutMs` without *any* inbound activity (pong or message)
 *     terminates the socket (previously this fired unconditionally 30 s
 *     after connect, killing every healthy session)
 *   - when the access token expires (`principal.exp`), close 4001 so the
 *     client refreshes and reconnects
 *
 * The `ws` import is lazy so tests can inject a `wsServer`.
 */

import { randomUUID } from 'crypto';
import { Subscription } from '../../domain/subscription/subscription.js';

export const CLOSE_TOKEN_EXPIRED = 4001;

function reject(socket, status, reason) {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* ignore */ }
  socket.destroy();
}

function pathOf(url) {
  if (typeof url !== 'string') return '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export async function attach(httpServer, deps) {
  const {
    principalFromUpgrade,
    subscriptionRepository,
    websocketBroadcaster,
    wsServer,
    path = '/ws/v1',
    allowedOrigins = null,
    maxConnectionsPerUser = 10,
    maxPayloadBytes = 64 * 1024,
    idleTimeoutMs = 60_000,
    pingIntervalMs = 20_000,
    now = () => Date.now(),
  } = deps;

  let WSS = wsServer;
  if (!WSS) {
    const ws = await import('ws').catch(() => null);
    if (!ws) {
      throw new Error('ws package not available; pass `wsServer` for tests');
    }
    WSS = new ws.WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });
  }

  const originSet = Array.isArray(allowedOrigins) ? new Set(allowedOrigins) : null;
  /** principal id → live connection count (admission control). */
  const perUser = new Map();
  const release = (id) => {
    const left = (perUser.get(id) ?? 1) - 1;
    if (left > 0) perUser.set(id, left);
    else perUser.delete(id);
  };

  const onUpgrade = async (req, socket, head) => {
    if (pathOf(req.url) !== path) return reject(socket, 404, 'Not Found');

    const origin = req.headers?.origin;
    if (origin && originSet && !originSet.has(origin)) return reject(socket, 403, 'Forbidden');

    let principal;
    try {
      principal = await principalFromUpgrade(req);
    } catch {
      principal = null;
    }
    if (!principal) return reject(socket, 401, 'Unauthorized');

    if ((perUser.get(principal.id) ?? 0) >= maxConnectionsPerUser) {
      return reject(socket, 429, 'Too Many Requests');
    }
    // Reserve the slot before the async handshake completes so a burst of
    // parallel upgrades can't overshoot the cap.
    perUser.set(principal.id, (perUser.get(principal.id) ?? 0) + 1);
    let established = false;
    socket.once?.('close', () => {
      // Handshake aborted before 'connection' fired: release the slot.
      if (!established) release(principal.id);
    });

    WSS.handleUpgrade(req, socket, head, (ws) => {
      established = true;
      WSS.emit('connection', ws, req, principal);
    });
  };

  if (httpServer && typeof httpServer.on === 'function') {
    httpServer.on('upgrade', onUpgrade);
  }

  WSS.on('connection', async (ws, _req, principal) => {
    const connectionId = randomUUID();
    let closed = false;

    let alive = true;
    let idleTimer;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try { ws.terminate?.(); } catch { /* ignore */ }
      }, idleTimeoutMs);
      idleTimer.unref?.();
    };
    const markActive = () => {
      alive = true;
      resetIdle();
    };
    resetIdle();

    const pingTimer = setInterval(() => {
      if (!alive) {
        try { ws.terminate?.(); } catch { /* ignore */ }
        return;
      }
      alive = false;
      try { ws.ping?.(); } catch { /* ignore */ }
    }, pingIntervalMs);
    pingTimer.unref?.();

    let expiryTimer;
    if (Number.isFinite(principal.exp)) {
      const ms = principal.exp * 1000 - now();
      expiryTimer = setTimeout(() => {
        try { ws.close?.(CLOSE_TOKEN_EXPIRED, 'token expired'); } catch { /* ignore */ }
      }, Math.max(0, ms));
      expiryTimer.unref?.();
    }

    ws.on?.('pong', markActive);
    ws.on?.('message', (raw) => {
      markActive();
      try {
        const text = typeof raw === 'string' ? raw : raw?.toString?.();
        if (text === 'ping') ws.send?.('pong');
      } catch { /* ignore */ }
    });

    const subscription = Subscription.create({
      subscriberKind: 'user',
      subscriberRef: principal.id,
      channel: 'websocket',
      address: connectionId,
      filter: principal.filter ?? {},
    });
    let saved = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      clearInterval(pingTimer);
      clearTimeout(idleTimer);
      clearTimeout(expiryTimer);
      release(principal.id);
      websocketBroadcaster.unregister(connectionId);
      if (saved) {
        try { await subscriptionRepository.delete(subscription.id); } catch { /* ignore */ }
      }
    };
    ws.on?.('close', close);
    ws.on?.('error', close);

    await subscriptionRepository.save(subscription);
    saved = true;
    if (closed) {
      // Socket died during the save; don't leave an orphan subscription.
      try { await subscriptionRepository.delete(subscription.id); } catch { /* ignore */ }
      return;
    }
    websocketBroadcaster.register(connectionId, ws, { subscriberRef: principal.id });
  });

  return {
    /** Live connections for a principal (for metrics / tests). */
    connectionCount(principalId) {
      return principalId === undefined
        ? [...perUser.values()].reduce((a, b) => a + b, 0)
        : perUser.get(principalId) ?? 0;
    },
    /**
     * Stop accepting upgrades and close live sockets. In `noServer` mode
     * `WebSocketServer#close()` does NOT close existing clients, so we send
     * 1001 "Going Away" (clients reconnect to another pod) and hard-terminate
     * stragglers after `terminateAfterMs`.
     */
    async close({ code = 1001, reason = 'server shutting down', terminateAfterMs = 1000 } = {}) {
      if (httpServer?.off) httpServer.off('upgrade', onUpgrade);
      const clients = WSS.clients ? [...WSS.clients] : [];
      for (const ws of clients) {
        try { ws.close?.(code, reason); } catch { /* ignore */ }
      }
      if (clients.length > 0 && terminateAfterMs > 0) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, terminateAfterMs);
          t.unref?.();
          const check = () => {
            if (clients.every((ws) => ws.readyState === 3 /* CLOSED */)) {
              clearTimeout(t);
              resolve();
            }
          };
          for (const ws of clients) ws.once?.('close', check);
          check();
        });
      }
      for (const ws of clients) {
        if (ws.readyState !== 3) {
          try { ws.terminate?.(); } catch { /* ignore */ }
        }
      }
      try { WSS.close?.(); } catch { /* ignore */ }
    },
    wss: WSS,
  };
}
