/**
 * Outbox — port. The canonical implementation lives in
 * `src/backend/shared-kernel/infrastructure/inmemory-outbox.js`
 * (in-memory) and `pg-outbox-repository.js` (Postgres).
 *
 * This file keeps a thin in-memory adapter local to the context for
 * existing test fixtures that want a simple `events` array surface
 * without importing from the shared kernel directly.
 *
 * @typedef {Object} Outbox
 * @property {(events: import('../../../../shared-kernel/domain/domain-event.js').DomainEvent[], uow?: object) => Promise<void>} enqueue
 */

export class InMemoryOutbox {
  constructor() {
    this.events = [];
  }

  async enqueue(events) {
    for (const e of events) this.events.push(e);
  }
}
