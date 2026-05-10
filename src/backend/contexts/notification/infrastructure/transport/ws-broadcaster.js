/**
 * WsBroadcaster — manages live `ws` connections by connectionId, with optional
 * cross-instance fan-out via an injected EventPublisher.
 *
 * Subscribes to `ws:<subscriberRef>` on the publisher when it sees the first
 * connection for a given subscriberRef and unsubscribes on the last close.
 */

import { WebSocketBroadcaster } from '../../application/ports/websocket-broadcaster.js';

export class WsBroadcaster extends WebSocketBroadcaster {
  constructor({ eventPublisher } = {}) {
    super();
    this._publisher = eventPublisher ?? null;
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
