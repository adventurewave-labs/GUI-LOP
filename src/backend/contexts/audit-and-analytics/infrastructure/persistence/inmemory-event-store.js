import { EventStore } from '../../application/ports/event-store.js';

export class InMemoryEventStore extends EventStore {
  constructor(initial = []) {
    super();
    this._events = [...initial];
  }

  add(event) {
    this._events.push({ ...event });
  }

  async query({ aggregateType, aggregateId, range = {} } = {}) {
    let out = [...this._events];
    if (aggregateType) out = out.filter((e) => e.aggregate_type === aggregateType || e.aggregateType === aggregateType);
    if (aggregateId) out = out.filter((e) => e.aggregate_id === aggregateId || e.aggregateId === aggregateId);
    if (range.from) out = out.filter((e) => (e.occurred_at ?? e.occurredAt) >= range.from);
    if (range.to) out = out.filter((e) => (e.occurred_at ?? e.occurredAt) <= range.to);
    out.sort((a, b) => {
      const av = a.occurred_at ?? a.occurredAt ?? '';
      const bv = b.occurred_at ?? b.occurredAt ?? '';
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    const limit = range.limit ?? out.length;
    const offset = range.offset ?? 0;
    return out.slice(offset, offset + limit);
  }
}
