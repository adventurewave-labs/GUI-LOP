-- 013_idempotency_scope_key.sql
-- Make the idempotency_keys table (003) usable by the shared HTTP
-- Idempotency-Key middleware.
--
-- The original UNIQUE (actor_id, route, idempotency_key) cannot protect
-- anonymous requests (registration): actor_id is NULL and NULLs are distinct
-- in a unique constraint. The middleware instead claims a single opaque
-- scope_key = sha256(subject, method + concrete path, key), atomically via
-- this unique index. status_code = 0 marks a request still in flight.

ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS scope_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_scope ON idempotency_keys (scope_key);
