// @ts-check
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
  SET status = 'dispatched', dispatched_at = NOW(), locked_until = NULL
  WHERE id = ANY($1::uuid[])
`;

// Lease-based claim (migration 014): marks up to $1 ready rows as leased for
// $2 ms and returns them. SKIP LOCKED keeps concurrent consumers disjoint;
// the lease (not an open transaction) protects the row during delivery, and
// an expired lease (crashed consumer) makes it claimable again.
const CLAIM_SQL = `
  UPDATE outbox o
  SET locked_until = NOW() + ($2::text || ' milliseconds')::interval
  WHERE o.id IN (
    SELECT id FROM outbox
    WHERE status = 'pending'
      AND next_attempt_at <= NOW()
      AND (locked_until IS NULL OR locked_until < NOW())
    ORDER BY occurred_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  )
  RETURNING o.id, o.event_id, o.event_type, o.event_version, o.aggregate_id,
            o.aggregate_type, o.payload, o.occurred_at, o.correlation_id, o.retry_count
`;

// Retry with exponential backoff + full jitter (delay = rand * min(cap,
// base * 2^attempt)); after max attempts the row is dead-lettered. The old
// version set a terminal 'failed' status that nothing ever retried.
const MARK_FAILED_SQL = `
  UPDATE outbox
  SET retry_count = retry_count + 1,
      last_error = $2,
      locked_until = NULL,
      status = CASE WHEN retry_count + 1 >= $3 THEN 'dead_letter' ELSE 'pending' END,
      next_attempt_at = NOW() + ((
        $6::float8 * LEAST($5::float8, $4::float8 * power(2, retry_count))
      )::text || ' milliseconds')::interval
  WHERE id = $1
  RETURNING status, retry_count
`;

export const OUTBOX_RETRY_DEFAULTS = Object.freeze({
  maxAttempts: 10,
  baseDelayMs: 1000,
  maxDelayMs: 15 * 60 * 1000,
  leaseMs: 30_000,
});

// MIN(occurred_at) is cheap thanks to the partial index on status='pending'
// shipped in 003_outbox_and_idempotency.sql. Returns NULL when there are no
// pending rows; we coalesce that to 0 ms in the caller.
const OLDEST_PENDING_AGE_SQL = `
  SELECT EXTRACT(EPOCH FROM ($1::timestamptz - MIN(occurred_at))) * 1000 AS age_ms
  FROM outbox
  WHERE status = 'pending'
`;

const PENDING_COUNT_SQL = `
  SELECT COUNT(*)::bigint AS pending
  FROM outbox
  WHERE status = 'pending'
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
     * Claim up to `batchSize` deliverable rows under a lease — the API the
     * OutboxConsumer uses. (It used to call this on the Pg adapter, which
     * didn't have it: every tick threw and the outbox never drained.)
     * @param {{ batchSize?: number, leaseMs?: number }} [opts]
     */
    async fetchPending({ batchSize = 25, leaseMs = OUTBOX_RETRY_DEFAULTS.leaseMs } = {}) {
      const size = Math.max(1, Math.min(Number(batchSize) || 25, 1000));
      const { rows } = await pool.query(CLAIM_SQL, [size, String(Math.max(1, leaseMs))]);
      return rows
        .map((r) => ({
          id: r.id,
          eventId: r.event_id,
          type: r.event_type,
          version: r.event_version ?? 1,
          aggregateId: r.aggregate_id,
          aggregateType: r.aggregate_type,
          payload: r.payload ?? {},
          occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at,
          correlationId: r.correlation_id ?? null,
          attempts: r.retry_count ?? 0,
        }))
        .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
    },

    /**
     * Mark one row or a batch as dispatched.
     * @param {string | string[]} ids
     */
    async markDispatched(ids) {
      const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
      if (list.length === 0) return;
      await pool.query(MARK_DISPATCHED_SQL, [list]);
    },

    /**
     * Record a failed delivery: back off and retry, or dead-letter after
     * `maxAttempts`. Returns the new state.
     * @param {string} id
     * @param {string} reason
     * @param {{ maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number, random?: () => number }} [opts]
     * @returns {Promise<{ status: 'pending' | 'dead_letter', attempts: number } | null>}
     */
    async markFailed(id, reason, opts = {}) {
      if (typeof id !== 'string' || !id) {
        throw new TypeError('Outbox.markFailed: id is required');
      }
      const o = { ...OUTBOX_RETRY_DEFAULTS, ...opts };
      const rand = Math.min(1, Math.max(0, (o.random ?? Math.random)()));
      const { rows } = await pool.query(MARK_FAILED_SQL, [
        id, String(reason ?? '').slice(0, 4000), o.maxAttempts, o.baseDelayMs, o.maxDelayMs, rand,
      ]);
      return rows?.[0] ? { status: rows[0].status, attempts: rows[0].retry_count } : null;
    },

    /**
     * Age of the oldest pending event in ms. 0 when nothing is pending.
     * @param {Date} [now] Reference timestamp; defaults to `new Date()`.
     */
    async getOldestPendingAge(now) {
      const ts = now instanceof Date ? now : new Date();
      const { rows } = await pool.query(OLDEST_PENDING_AGE_SQL, [ts.toISOString()]);
      const ageMs = rows[0]?.age_ms;
      if (ageMs == null) return 0;
      const n = Number(ageMs);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },

    /**
     * Number of pending outbox rows.
     */
    async getPendingCount() {
      const { rows } = await pool.query(PENDING_COUNT_SQL);
      const n = Number(rows[0]?.pending ?? 0);
      return Number.isFinite(n) ? n : 0;
    },
  };
}
