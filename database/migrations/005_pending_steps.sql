-- Migration 005: pending_steps projection used by the Human Interaction
-- bounded context for inbox listing and the deadline watcher.

CREATE TABLE IF NOT EXISTS pending_steps (
    workflow_id UUID NOT NULL,
    step_id UUID NOT NULL,
    ui_document_id UUID,
    eligibility JSONB NOT NULL,
    deadline TIMESTAMPTZ,
    on_timeout TEXT NOT NULL DEFAULT 'escalate' CHECK (on_timeout IN ('fail','escalate','auto_approve')),
    escalation_level INT NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    PRIMARY KEY (workflow_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_steps_overdue
    ON pending_steps (deadline)
    WHERE closed_at IS NULL;
