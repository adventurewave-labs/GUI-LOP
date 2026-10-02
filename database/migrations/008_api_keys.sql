-- 008_api_keys.sql
-- Identity & Access context: ApiKey aggregate.
--
-- The base `api_keys` table already exists in
-- `database/schemas/01_main_schema.sql` (id, user_id, key_name,
-- api_key_hash, permissions JSONB, is_active, expires_at, last_used,
-- created_at, updated_at) so this migration is purely additive:
--
--   * Add a partial expiry-aware index that the auth-middleware path
--     uses to gate active+non-expired API keys.
--   * Add a covering index for `findActiveByUser`.
--
-- Both statements are idempotent so re-running this migration on a
-- partially-applied database is safe.

CREATE INDEX IF NOT EXISTS idx_api_keys_active_user_created
  ON api_keys (user_id, created_at DESC)
  WHERE is_active = true;

-- Partial-index predicates must be IMMUTABLE, so `expires_at > NOW()` is
-- rejected by Postgres (42P17) and this index was never created. Index the
-- active keys with expires_at as a column; the expiry check stays in the
-- query and is served by the same index.
CREATE INDEX IF NOT EXISTS idx_api_keys_active_not_expired
  ON api_keys (api_key_hash, expires_at)
  WHERE is_active = true;
