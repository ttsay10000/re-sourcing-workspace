-- Unified workflow run ledger for property-data operations and downstream jobs.

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number BIGSERIAL UNIQUE,
  run_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  scope_label TEXT,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  total_items INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  metadata JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at ON workflow_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_type ON workflow_runs(run_type, started_at DESC);

COMMENT ON TABLE workflow_runs IS 'Cross-pipeline run ledger for canonicalization, enrichment, OM parsing, inquiries, dossiers, and related jobs.';

CREATE TABLE IF NOT EXISTS workflow_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  last_message TEXT,
  last_error TEXT,
  metadata JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run_id ON workflow_run_steps(run_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_status ON workflow_run_steps(status);

COMMENT ON TABLE workflow_run_steps IS 'Per-run step/module progress with x/y counts and latest status/error for the operations board.';
