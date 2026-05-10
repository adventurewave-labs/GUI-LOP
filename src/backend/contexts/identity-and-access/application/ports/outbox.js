// TODO: replace with shared-kernel import after merge

/**
 * Outbox — port. The shared-kernel Outbox owns the canonical
 * implementation; until that lands, the in-memory adapter simply
 * collects events into an array.
 *
 * @typedef {Object} Outbox
 * @property {(events: import('../../shared-kernel-stubs.js').DomainEvent[], uow?: object) => Promise<void>} enqueue
 */

export class InMemoryOutbox {
  constructor() {
    this.events = [];
  }

  async enqueue(events) {
    for (const e of events) this.events.push(e);
  }
}
