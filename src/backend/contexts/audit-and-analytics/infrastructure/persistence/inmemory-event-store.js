import { EventStore } from '../../application/ports/event-store.js';

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
    const at = (e) => toMs(e.occurred_at ?? e.occurredAt);
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

  /** No chain in memory (development/tests only): reported as unsupported, never as "intact". */
  async verifyChain() {
    return { supported: false, ok: false, entries: this._events.length, firstBrokenSeq: null, head: null };
  }
}
