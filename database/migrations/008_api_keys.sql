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

CREATE INDEX IF NOT EXISTS idx_api_keys_active_not_expired
  ON api_keys (api_key_hash)
  WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW());
