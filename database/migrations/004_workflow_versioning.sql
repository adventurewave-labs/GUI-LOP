-- 004_workflow_versioning.sql
-- Adds optimistic-concurrency `version` column to `workflows` so the
-- Workflow aggregate can enforce `WHERE id = ? AND version = ?` writes.

ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_workflows_version ON workflows(id, version);

COMMENT ON COLUMN workflows.version IS
    'Optimistic-concurrency token; bumped on every successful save.';
