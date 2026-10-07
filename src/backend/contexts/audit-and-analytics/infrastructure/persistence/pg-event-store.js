// @ts-check
import { EventStore } from '../../application/ports/event-store.js';

/**
 * Reads the audit trail from `audit_events` (migration 017): an append-only,
 * hash-chained copy of every domain event, written by a trigger on `outbox`
 * in the same transaction as the business change.
 *
 * (This adapter used to query a table called `events` with columns the real
 * schema does not have — `type`, `version`, `occurred_at`… — and nothing
 * wrote domain events there, so on Postgres the audit API returned an error
 * or nothing. The contract suite did not notice because it created its own
 * `events` table in the shape the adapter expected.)
 */
export class PgEventStore extends EventStore {
  /** @param {{ query(sql: string, args?: any[]): Promise<{ rows: any[] }> }} pool */
  constructor(pool) {
    super();
    this._pool = pool;
  }

  /** @param {{ aggregateType?: string, aggregateId?: string, actorId?: string, range?: { from?: any, to?: any, limit?: number, offset?: number } }} [filter] */
  async query({ aggregateType, aggregateId, actorId, range = {} } = {}) {
    const conds = [];
    const args = [];
    const where = (column, value) => {
      args.push(value);
      conds.push(`${column} $${args.length}`);
    };
    if (aggregateType) where('aggregate_type =', aggregateType);
    if (aggregateId) where('aggregate_id =', String(aggregateId));
    if (actorId) where('actor_id =', String(actorId));
    if (range.from) where('occurred_at >=', range.from);
    if (range.to) where('occurred_at <=', range.to);

    const limit = Math.min(Math.max(Number(range.limit ?? 1000) || 0, 0), 5000);
    const offset = Math.max(Number(range.offset ?? 0) || 0, 0);
    const sql = `
      SELECT event_id AS id, event_type AS type, event_version AS version, aggregate_type, aggregate_id,
             actor_id, payload, correlation_id, occurred_at, seq, hash
        FROM audit_events
        ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY occurred_at ASC, seq ASC
        LIMIT ${limit} OFFSET ${offset}
    `;
    try {
      const { rows } = await this._pool.query(sql, args);
      return rows.map((r) => ({ ...r, seq: Number(r.seq) }));
    } catch (err) {
      if (/** @type {any} */ (err)?.code === '42P01') return [];
      throw err;
    }
  }

  /**
   * Recompute the whole hash chain.
   * `head` is what to record outside the database: a later chain must still
   * contain that seq with that hash, otherwise history was rewritten or cut.
   * @returns {Promise<{ supported: boolean, ok: boolean, entries: number, firstBrokenSeq: number|null, head: { seq: number, hash: string, recordedAt: string }|null }>}
   */
  async verifyChain() {
    const { rows } = await this._pool.query(`
      SELECT audit_chain_first_break() AS broken,
             (SELECT count(*) FROM audit_events) AS entries,
             (SELECT row_to_json(h) FROM (SELECT seq, hash, recorded_at FROM audit_events ORDER BY seq DESC LIMIT 1) h) AS head
    `);
    const { broken, entries, head } = rows[0];
    return {
      supported: true,
      ok: broken == null,
      entries: Number(entries),
      firstBrokenSeq: broken == null ? null : Number(broken),
      head: head ? { seq: Number(head.seq), hash: head.hash, recordedAt: new Date(head.recorded_at).toISOString() } : null,
    };
  }
}
