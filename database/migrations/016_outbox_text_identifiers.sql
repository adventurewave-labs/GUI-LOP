-- 016: outbox identifiers that are not UUIDs.
--
-- Production bugs (found by the production-mode smoke test):
--   * aggregate_id was uuid, but workflow-template aggregates are identified
--     as "<key>@<version>" (e.g. "data-analysis@1"), so every template
--     publish/deprecate failed with 22P02 and no template event could ever be
--     recorded.
--   * correlation_id / causation_id were uuid, but the workflow API copies the
--     client's X-Correlation-Id header verbatim, so any caller using a
--     non-UUID correlation id (W3C trace ids, ULIDs, "req-123") got a 500.
-- Existing values convert losslessly (uuid -> text); indexes are rebuilt.
-- Idempotent: only alters columns that are still uuid.
DO $$
DECLARE col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['aggregate_id', 'correlation_id', 'causation_id'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'outbox'
         AND column_name = col AND data_type = 'uuid'
    ) THEN
      EXECUTE format('ALTER TABLE outbox ALTER COLUMN %I TYPE text USING %I::text', col, col);
    END IF;
  END LOOP;
END $$;
