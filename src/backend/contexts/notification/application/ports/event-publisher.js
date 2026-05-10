/**
 * EventPublisher — abstracts the underlying transport for cross-instance fan-out
 * (Redis pub/sub). The contract is fire-and-forget; ordering is best-effort.
 */

export class EventPublisher {
  /** @param {string} _channel @param {object} _envelope */
  async publish(_channel, _envelope) {
    throw new Error('EventPublisher.publish is abstract');
  }

  /** @param {string} _channel @param {(envelope: object) => void | Promise<void>} _handler */
  async subscribe(_channel, _handler) {
    throw new Error('EventPublisher.subscribe is abstract');
  }

  async close() {
    /* default no-op */
  }
}
