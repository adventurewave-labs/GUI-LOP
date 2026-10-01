/**
 * WsBroadcaster — manages live `ws` connections by connectionId, with optional
 * cross-instance fan-out via an injected EventPublisher.
 *
 * Subscribes to `ws:<subscriberRef>` on the publisher when it sees the first
 * connection for a given subscriberRef and unsubscribes on the last close.
 */

import { WebSocketBroadcaster } from '../../application/ports/websocket-broadcaster.js';

export class WsBroadcaster extends WebSocketBroadcaster {
  /**
   * @param {object} [opts]
   * @param {object} [opts.eventPublisher]   cross-instance fan-out (Redis pub/sub)
   * @param {number} [opts.maxBufferedBytes] slow-consumer cutoff (default 1 MiB)
   */
  constructor({ eventPublisher, maxBufferedBytes = 1024 * 1024 } = {}) {
    super();
    this._publisher = eventPublisher ?? null;
    this._maxBuffered = maxBufferedBytes;
    this._connections = new Map();
    this._byRef = new Map();
    this._unsubByRef = new Map();
  }

  register(connectionId, ws, meta = {}) {
    this._connections.set(connectionId, { ws, meta });
    const ref = meta.subscriberRef;
    if (ref) {
      if (!this._byRef.has(ref)) this._byRef.set(ref, new Set());
      this._byRef.get(ref).add(connectionId);
      this._maybeSubscribe(ref);
    }
  }

  unregister(connectionId) {
    const conn = this._connections.get(connectionId);
    if (!conn) return;
    this._connections.delete(connectionId);
    const ref = conn.meta?.subscriberRef;
    if (ref && this._byRef.has(ref)) {
      const set = this._byRef.get(ref);
      set.delete(connectionId);
      if (set.size === 0) {
        this._byRef.delete(ref);
        const stop = this._unsubByRef.get(ref);
        if (stop) {
          this._unsubByRef.delete(ref);
          Promise.resolve(stop()).catch(() => {});
        }
      }
    }
  }

  async send(connectionId, envelope) {
    const conn = this._connections.get(connectionId);
    if (!conn) return;
    this._safeSend(conn.ws, envelope);
  }

  async broadcast(filter = {}, envelope) {
    if (filter.subscriberRef) {
      const ids = this._byRef.get(filter.subscriberRef) ?? new Set();
      for (const id of ids) {
        const conn = this._connections.get(id);
        if (conn) this._safeSend(conn.ws, envelope);
      }
      return;
    }
    for (const [, conn] of this._connections) {
      this._safeSend(conn.ws, envelope);
    }
  }

  _safeSend(ws, envelope) {
    try {
      // Backpressure: a client that isn't draining its socket would make us
      // buffer unbounded memory. Cut it off (1013 Try Again Later) instead.
      if (ws && Number(ws.bufferedAmount) > this._maxBuffered) {
        try { ws.close?.(1013, 'slow consumer'); } catch { /* ignore */ }
        return;
      }
      const payload = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
      if (ws && typeof ws.send === 'function') {
        ws.send(payload);
      }
    } catch {
      /* swallow — caller will retry via DeliverEvent retry policy */
    }
  }

  async _maybeSubscribe(ref) {
    if (!this._publisher || this._unsubByRef.has(ref)) return;
    const stop = await this._publisher.subscribe(`ws:${ref}`, (envelope) => {
      this.broadcast({ subscriberRef: ref }, envelope);
    });
    this._unsubByRef.set(ref, stop);
  }
}
