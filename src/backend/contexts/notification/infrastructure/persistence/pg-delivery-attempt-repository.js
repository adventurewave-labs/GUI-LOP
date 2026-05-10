import { DeliveryAttemptRepository } from '../../application/ports/delivery-attempt-repository.js';

export class PgDeliveryAttemptRepository extends DeliveryAttemptRepository {
  constructor(pool) {
    super();
    this._pool = pool;
  }

  async record(attempt) {
    await this._pool.query(
      `INSERT INTO delivery_attempts
        (id, subscription_id, event_id, attempt_number, status, error, attempted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        attempt.id,
        attempt.subscriptionId,
        attempt.eventId,
        attempt.attemptNumber,
        attempt.status,
        attempt.error,
        attempt.attemptedAt
      ]
    );
  }

  async listForEvent(eventId) {
    const { rows } = await this._pool.query(
      `SELECT id, subscription_id, event_id, attempt_number, status, error, attempted_at
         FROM delivery_attempts WHERE event_id = $1
         ORDER BY attempted_at`,
      [eventId]
    );
    return rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscription_id,
      eventId: r.event_id,
      attemptNumber: r.attempt_number,
      status: r.status,
      error: r.error,
      attemptedAt:
        r.attempted_at instanceof Date ? r.attempted_at.toISOString() : r.attempted_at
    }));
  }

  async countForSubscription(subscriptionId, eventId) {
    const { rows } = await this._pool.query(
      `SELECT COUNT(*)::int AS c
         FROM delivery_attempts
        WHERE subscription_id = $1 AND event_id = $2`,
      [subscriptionId, eventId]
    );
    return rows[0]?.c ?? 0;
  }
}
