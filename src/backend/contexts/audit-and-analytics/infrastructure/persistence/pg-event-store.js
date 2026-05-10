import { EventStore } from '../../application/ports/event-store.js';

export class PgEventStore extends EventStore {
  constructor(pool) {
    super();
    this._pool = pool;
  }

  async query({ aggregateType, aggregateId, range = {} } = {}) {
    const conds = [];
    const args = [];
    if (aggregateType) {
      args.push(aggregateType);
      conds.push(`aggregate_type = $${args.length}`);
    }
    if (aggregateId) {
      args.push(aggregateId);
      conds.push(`aggregate_id = $${args.length}`);
    }
    if (range.from) {
      args.push(range.from);
      conds.push(`occurred_at >= $${args.length}`);
    }
    if (range.to) {
      args.push(range.to);
      conds.push(`occurred_at <= $${args.length}`);
    }

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = Math.min(range.limit ?? 1000, 5000);
    const offset = range.offset ?? 0;

    const sql = `
      SELECT id, type, version, aggregate_type, aggregate_id, payload, occurred_at
        FROM events
        ${where}
        ORDER BY occurred_at ASC
        LIMIT ${limit} OFFSET ${offset}
    `;

    try {
      const { rows } = await this._pool.query(sql, args);
      return rows;
    } catch (err) {
      if (err?.code === '42P01') return [];
      throw err;
    }
  }
}
