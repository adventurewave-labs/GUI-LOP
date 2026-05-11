-- 007_ui_documents.sql
-- UI Generation context: persistent record of generated UI documents.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS ui_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL,
  step_id UUID NOT NULL,
  url TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  strategy TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ui_documents_step
  ON ui_documents (workflow_id, step_id);
