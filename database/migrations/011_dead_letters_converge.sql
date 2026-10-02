-- =====================================================
-- 011 — converge dead_letters onto the shape the adapter writes
-- =====================================================
--
-- 003 created `dead_letters(source_event_id, payload, reason, …)`. 006 later
-- declared the notification-context shape
-- `dead_letters(subscription_id, event_id, envelope, error, …)` with
-- CREATE TABLE IF NOT EXISTS — a silent no-op because 003's table already
-- existed. PgDeadLetterRepository writes the 006 shape, so every insert
-- failed with `column "subscription_id" does not exist`: events that
-- exhausted their retries were lost instead of parked for inspection.
--
-- This migration is idempotent and safe on both histories:
--   * adds the 006 columns if missing,
--   * back-fills them from the 003 columns when those exist,
--   * relaxes 003's NOT NULLs so new-shape inserts succeed.

ALTER TABLE dead_letters
  ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id UUID,
  ADD COLUMN IF NOT EXISTS envelope JSONB,
  ADD COLUMN IF NOT EXISTS error TEXT;

ALTER TABLE dead_letters ALTER COLUMN attempts SET DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'dead_letters' AND column_name = 'payload') THEN
    UPDATE dead_letters SET envelope = payload WHERE envelope IS NULL;
    ALTER TABLE dead_letters ALTER COLUMN payload DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'dead_letters' AND column_name = 'source_event_id') THEN
    UPDATE dead_letters SET event_id = source_event_id WHERE event_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'dead_letters' AND column_name = 'reason') THEN
    UPDATE dead_letters SET error = reason WHERE error IS NULL;
    ALTER TABLE dead_letters ALTER COLUMN reason DROP NOT NULL;
  END IF;
END $$;

UPDATE dead_letters SET envelope = '{}'::jsonb WHERE envelope IS NULL;
ALTER TABLE dead_letters ALTER COLUMN envelope SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dead_letters_created ON dead_letters (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letters_subscription ON dead_letters (subscription_id);
