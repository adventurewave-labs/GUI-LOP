-- 009_user_permissions.sql
-- Identity & Access context: durable storage for per-user permission grants.
--
-- The base schema in `database/schemas/01_main_schema.sql` only has
-- `roles.permissions JSONB`, which models role-level permissions. Direct
-- per-user grants (scoped or unscoped, e.g. `workflow:respond@wf-1`) had
-- no durable home — the in-memory `InMemoryGrantsRepository` was the only
-- option. This migration introduces `user_permissions` to back the
-- `GrantPermission` / `RevokePermission` use cases in production.
--
-- Soft-revoke shape: a `revoked_at IS NULL` row is the active grant; on
-- revoke we update `revoked_at` rather than deleting, so the audit trail
-- is preserved.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission VARCHAR(255) NOT NULL,
  scope VARCHAR(255),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- A user can only hold one active row per (permission, scope). We model
-- this with a partial unique index keyed on the active rows; the scope
-- column is COALESCEd to the empty string so the unique key is total.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_permissions_active
  ON user_permissions (user_id, permission, COALESCE(scope, ''))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_permissions_user
  ON user_permissions (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_permissions_granted_at
  ON user_permissions (granted_at DESC);
