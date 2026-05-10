import { AuditLogStore } from '../../application/ports/audit-log-store.js';

export class InMemoryAuditLogStore extends AuditLogStore {
  constructor(initial = []) {
    super();
    this._items = [...initial];
  }

  add(entry) {
    this._items.push({ ...entry });
  }

  async query({ aggregateType, aggregateId, actorId, range = {} } = {}) {
    let out = [...this._items];
    if (aggregateType) out = out.filter((e) => e.aggregate_type === aggregateType || e.aggregateType === aggregateType);
    if (aggregateId) out = out.filter((e) => e.aggregate_id === aggregateId || e.aggregateId === aggregateId);
    if (actorId) out = out.filter((e) => e.actor_id === actorId || e.actorId === actorId);
    if (range.from) out = out.filter((e) => (e.created_at ?? e.createdAt) >= range.from);
    if (range.to) out = out.filter((e) => (e.created_at ?? e.createdAt) <= range.to);
    out.sort((a, b) => {
      const av = a.created_at ?? a.createdAt ?? '';
      const bv = b.created_at ?? b.createdAt ?? '';
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    const limit = range.limit ?? out.length;
    const offset = range.offset ?? 0;
    return out.slice(offset, offset + limit);
  }
}
