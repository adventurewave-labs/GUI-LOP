/**
 * ws-server.js — minimal WebSocket adapter.
 *
 * `attach(httpServer, deps)` upgrades incoming HTTP connections, authenticates
 * via `principalFromUpgrade`, and registers a Subscription per connection.
 * Closes idle connections after `idleTimeoutMs` of no pong.
 *
 * The actual `ws` package import is lazy so tests can inject a `wsServer`.
 */

import { randomUUID } from 'crypto';
import { Subscription } from '../../domain/subscription/subscription.js';

export async function attach(httpServer, deps) {
  const {
    principalFromUpgrade,
    subscriptionRepository,
    websocketBroadcaster,
    wsServer,
    idleTimeoutMs = 30_000,
    pingIntervalMs = 10_000
  } = deps;

  let WSS = wsServer;
  if (!WSS) {
    const ws = await import('ws').catch(() => null);
    if (!ws) {
      throw new Error('ws package not available; pass `wsServer` for tests');
    }
    WSS = new ws.WebSocketServer({ noServer: true });
  }

  const onUpgrade = async (req, socket, head) => {
    let principal;
    try {
      principal = await principalFromUpgrade(req);
    } catch {
      principal = null;
    }
    if (!principal) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    WSS.handleUpgrade(req, socket, head, (ws) => {
      WSS.emit('connection', ws, req, principal);
    });
  };

  if (httpServer && typeof httpServer.on === 'function') {
    httpServer.on('upgrade', onUpgrade);
  }

  WSS.on('connection', async (ws, _req, principal) => {
    const connectionId = randomUUID();
    const subscription = Subscription.create({
      subscriberKind: 'user',
      subscriberRef: principal.id,
      channel: 'websocket',
      address: connectionId,
      filter: principal.filter ?? {}
    });

    await subscriptionRepository.save(subscription);
    websocketBroadcaster.register(connectionId, ws, {
      subscriberRef: principal.id
    });

    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        try { ws.terminate(); } catch { /* ignore */ }
        return;
      }
      alive = false;
      try { ws.ping?.(); } catch { /* ignore */ }
    }, pingIntervalMs);
    if (pingTimer.unref) pingTimer.unref();

    const idleTimer = setTimeout(() => {
      try { ws.terminate?.(); } catch { /* ignore */ }
    }, idleTimeoutMs);
    if (idleTimer.unref) idleTimer.unref();

    ws.on?.('pong', () => {
      alive = true;
    });

    ws.on?.('message', (raw) => {
      // Treat any client message as activity. Support string 'ping' shorthand.
      alive = true;
      try {
        const text = typeof raw === 'string' ? raw : raw?.toString?.();
        if (text === 'ping') ws.send?.('pong');
      } catch { /* ignore */ }
    });

    const close = async () => {
      clearInterval(pingTimer);
      clearTimeout(idleTimer);
      websocketBroadcaster.unregister(connectionId);
      await subscriptionRepository.delete(subscription.id);
    };

    ws.on?.('close', close);
    ws.on?.('error', close);
  });

  return {
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
    wss: WSS
  };
}
