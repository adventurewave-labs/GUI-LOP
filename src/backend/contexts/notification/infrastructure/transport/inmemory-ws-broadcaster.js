import { WebSocketBroadcaster } from '../../application/ports/websocket-broadcaster.js';

export class InMemoryWebSocketBroadcaster extends WebSocketBroadcaster {
  constructor() {
    super();
    this._connections = new Map(); // connectionId -> { handler, meta }
    this._sent = []; // { connectionId, envelope }
  }

  register(connectionId, handler, meta = {}) {
    this._connections.set(connectionId, { handler, meta });
  }

  unregister(connectionId) {
    this._connections.delete(connectionId);
  }

  async send(connectionId, envelope) {
    const conn = this._connections.get(connectionId);
    if (!conn) return;
    this._sent.push({ connectionId, envelope });
    await conn.handler(envelope);
  }

  async broadcast(filter = {}, envelope) {
    for (const [id, conn] of this._connections) {
      if (filter.subscriberRef && conn.meta?.subscriberRef !== filter.subscriberRef) continue;
      this._sent.push({ connectionId: id, envelope });
      await conn.handler(envelope);
    }
  }

  sent() {
    return [...this._sent];
  }

  size() {
    return this._connections.size;
  }
}
