/**
 * pg-outbox-repository — Postgres adapter for the Outbox port.
 * Implements enqueue/pickBatch/markDispatched/markFailed against the
 * `outbox` table defined in database/migrations/003_outbox_and_idempotency.sql.
 */

const ENQUEUE_SQL = `
  INSERT INTO outbox (
    event_id, event_type, event_version, aggregate_id, aggregate_type,
    payload, occurred_at, correlation_id, causation_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (event_id) DO NOTHING
`;

const PICK_BATCH_SQL = `
  SELECT id, event_id, event_type, event_version, aggregate_id, aggregate_type,
         payload, occurred_at, correlation_id, causation_id, retry_count
  FROM outbox
  WHERE status = 'pending'
  ORDER BY occurred_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
`;

const MARK_DISPATCHED_SQL = `
  UPDATE outbox
  SET status = 'dispatched', dispatched_at = NOW()
  WHERE id = ANY($1::uuid[])
`;

const MARK_FAILED_SQL = `
  UPDATE outbox
  SET status = 'failed',
      retry_count = retry_count + 1,
      last_error = $2
  WHERE id = $1
`;

/**
 * Build the Postgres outbox repository bound to a pg Pool.
 * @param {{ query: Function, connect: Function }} pool
 */
export function createPgOutboxRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('createPgOutboxRepository: pool must implement query()');
  }

  return {
    /**
     * Persist events transactionally with the aggregate write.
     * @param {Array<{ toJSON?: () => any }>} events
     * @param {{ client: { query: Function } }} uowCtx
     */
    async enqueue(events, uowCtx) {
      if (!Array.isArray(events)) {
        throw new TypeError('Outbox.enqueue: events must be an array');
      }
      if (!uowCtx || !uowCtx.client || typeof uowCtx.client.query !== 'function') {
        throw new TypeError('Outbox.enqueue: uowCtx.client is required');
      }
      const client = uowCtx.client;
      for (const ev of events) {
        const e = typeof ev.toJSON === 'function' ? ev.toJSON() : ev;
        await client.query(ENQUEUE_SQL, [
          e.eventId,
          e.eventType,
          e.eventVersion ?? 1,
          e.aggregateId ?? null,
          e.aggregateType ?? null,
          e.payload ?? {},
          e.occurredAt,
          e.correlationId ?? null,
          e.causationId ?? null,
        ]);
      }
    },

    /**
     * Lock and return up to `size` pending rows for dispatch.
     * Caller is expected to run inside a transaction (FOR UPDATE).
     * @param {number} size
     * @param {{ client: { query: Function } }} [uowCtx]
     */
    async pickBatch(size, uowCtx) {
      if (!Number.isInteger(size) || size <= 0) {
        throw new TypeError('Outbox.pickBatch: size must be a positive integer');
      }
      const runner = uowCtx?.client ?? pool;
      const res = await runner.query(PICK_BATCH_SQL, [size]);
      return res.rows;
    },

    /**
     * Mark a batch of outbox rows as dispatched.
     * @param {string[]} ids
     */
    async markDispatched(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return;
      await pool.query(MARK_DISPATCHED_SQL, [ids]);
    },

    /**
     * Mark a single row as failed; the publisher decides on dead-letter.
     * @param {string} id
     * @param {string} reason
     */
    async markFailed(id, reason) {
      if (typeof id !== 'string' || !id) {
        throw new TypeError('Outbox.markFailed: id is required');
      }
      await pool.query(MARK_FAILED_SQL, [id, String(reason ?? '').slice(0, 4000)]);
    },
  };
}
