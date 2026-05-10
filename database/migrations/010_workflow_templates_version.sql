-- 010_workflow_templates_version.sql
-- Promotes the workflow template aggregate's `version` from a JSONB
-- back-channel (`default_config.__version`) to a real INT column, and
-- adds the canonical `(template_key, version)` uniqueness constraint
-- so multiple historical versions of the same key can coexist.
--
-- Backwards-compatibility notes:
--   - DEFAULT 1 ensures pre-existing rows pick up a sensible version
--     without manual backfill.
--   - The old `template_key` UNIQUE constraint is dropped so new rows
--     can coexist with their historical versions; the new composite
--     unique index on `(template_key, version)` enforces the real
--     identity rule for the WorkflowTemplate aggregate.
--   - The PgWorkflowTemplateRepository falls back to the legacy
--     `default_config.__version` JSON path for one release if the
--     column is missing on an older database, logging a one-time
--     warning.

ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE workflow_templates DROP CONSTRAINT IF EXISTS workflow_templates_template_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_templates_key_version
    ON workflow_templates (template_key, version);

COMMENT ON COLUMN workflow_templates.version IS
    'Aggregate version of the WorkflowTemplate; identity is (template_key, version).';
