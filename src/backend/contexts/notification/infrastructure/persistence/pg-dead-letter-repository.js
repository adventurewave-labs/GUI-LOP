import { DeadLetterRepository } from '../../application/ports/dead-letter-repository.js';

function rowToRecord(r) {
  if (!r) return null;
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    eventId: r.event_id,
    envelope: typeof r.envelope === 'string' ? JSON.parse(r.envelope) : r.envelope,
    attempts: r.attempts,
    error: r.error,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
  };
}

export class PgDeadLetterRepository extends DeadLetterRepository {
  constructor(pool) {
    super();
    this._pool = pool;
  }

  async save(record) {
    await this._pool.query(
      `INSERT INTO dead_letters
        (id, subscription_id, event_id, envelope, attempts, error, created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [
        record.id,
        record.subscriptionId,
        record.eventId,
        JSON.stringify(record.envelope),
        record.attempts,
        record.error,
        record.createdAt
      ]
    );
  }

  async findById(id) {
    const { rows } = await this._pool.query(
      `SELECT id, subscription_id, event_id, envelope, attempts, error, created_at
         FROM dead_letters WHERE id = $1`,
      [id]
    );
    return rowToRecord(rows[0]);
  }

  async list({ limit = 100, offset = 0 } = {}) {
    const { rows } = await this._pool.query(
      `SELECT id, subscription_id, event_id, envelope, attempts, error, created_at
         FROM dead_letters
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToRecord);
  }

  async delete(id) {
    await this._pool.query('DELETE FROM dead_letters WHERE id = $1', [id]);
  }
}
