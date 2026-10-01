-- 014_outbox_retry_lease.sql
-- Outbox delivery that actually retries (roadmap #20).
--
-- Before: a single failed delivery set status='failed', and nothing ever
-- selected 'failed' rows again — one transient error lost the event. And the
-- OutboxConsumer called a method the Postgres adapter didn't have, so with a
-- database configured the outbox was never drained at all.
--
--   next_attempt_at  when the row becomes eligible (exponential backoff)
--   locked_until     lease held by the consumer that claimed it; a crashed
--                    consumer's claim simply expires and another picks it up
--
-- Rows stranded in 'failed' by the old behaviour get another chance.

ALTER TABLE outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outbox_ready
  ON outbox (next_attempt_at, occurred_at)
  WHERE status = 'pending';

UPDATE outbox SET status = 'pending', next_attempt_at = NOW() WHERE status = 'failed';
