/**
 * EventPublisher port — dispatches domain events. Implementations may write
 * to the outbox table, publish to Redis, or do both.
 */
/* eslint-disable no-unused-vars */
export class EventPublisher {
  /**
   * @param {import('../../../../shared-kernel/domain/domain-event.js').DomainEvent[]} events
   * @param {object} [uow]
   */
  async publish(events, uow) { throw new Error('not implemented'); }
}

/** Useful for tests. */
export class InMemoryEventPublisher extends EventPublisher {
  constructor() {
    super();
    this.events = [];
  }
  async publish(events) {
    for (const e of events) this.events.push(e);
  }
}
