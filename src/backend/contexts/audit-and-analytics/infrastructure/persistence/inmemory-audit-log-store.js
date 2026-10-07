import { AuditLogStore } from '../../application/ports/audit-log-store.js';

/**
 * Epoch ms for a Date, ISO string or number; NaN when absent/invalid.
 * Comparing raw values mixed Date objects with ISO query strings, and
 * `Date >= 'iso'` is always false in JS — so a range filter silently
 * dropped every row whose timestamp was a Date.
 */
function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v) return Date.parse(v);
  return NaN;
}

/** Same paging contract as the Pg adapter: default 1000, hard cap 5000. */
function page(range) {
  const limit = Math.min(Math.max(Number(range.limit) || 1000, 0), 5000);
  const offset = Math.max(Number(range.offset) || 0, 0);
  return { limit, offset };
}

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
    const at = (e) => toMs(e.created_at ?? e.createdAt);
    if (range.from) {
      const from = toMs(range.from);
      out = out.filter((e) => at(e) >= from);
    }
    if (range.to) {
      const to = toMs(range.to);
      out = out.filter((e) => at(e) <= to);
    }
    // Stable ascending sort; rows without a timestamp sort first.
    out.sort((a, b) => (at(a) || 0) - (at(b) || 0));
    const { limit, offset } = page(range);
    return out.slice(offset, offset + limit);
  }
}
