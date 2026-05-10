/**
 * WebSocketBroadcaster — sends envelopes to live WebSocket connections.
 *
 * `send(connectionId, envelope)` targets a single connection.
 * `broadcast(filter, envelope)` fans out to all matching connections.
 *   `filter` shape: { subscriberRef?: string, channel?: 'websocket' }
 */

export class WebSocketBroadcaster {
  async send(_connectionId, _envelope) {
    throw new Error('WebSocketBroadcaster.send is abstract');
  }

  async broadcast(_filter, _envelope) {
    throw new Error('WebSocketBroadcaster.broadcast is abstract');
  }

  register(_connectionId, _handler) {
    throw new Error('WebSocketBroadcaster.register is abstract');
  }

  unregister(_connectionId) {
    throw new Error('WebSocketBroadcaster.unregister is abstract');
  }
}
