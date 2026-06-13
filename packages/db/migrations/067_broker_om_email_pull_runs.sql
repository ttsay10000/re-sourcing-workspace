-- Broker OM email pulls: persist each manual Gmail pull (so the page survives
-- refresh) and keep a ledger of attachments already surfaced per pull scope
-- (so re-pulls skip documents we've already pulled).

CREATE TABLE IF NOT EXISTS broker_om_email_pull_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key TEXT NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  query TEXT,
  baseline_at TIMESTAMPTZ,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  document_count INTEGER NOT NULL DEFAULT 0,
  new_document_count INTEGER NOT NULL DEFAULT 0,
  skipped_previously_pulled INTEGER NOT NULL DEFAULT 0,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broker_om_email_pull_runs_scope_run_at
  ON broker_om_email_pull_runs (scope_key, run_at DESC);

CREATE TABLE IF NOT EXISTS broker_om_pulled_attachments (
  scope_key TEXT NOT NULL,
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  filename TEXT,
  size_bytes BIGINT,
  first_pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pull_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (scope_key, message_id, attachment_id)
);

-- Gmail attachment ids are not guaranteed stable across fetches, so re-pull
-- dedupe also matches on (scope, message, filename).
CREATE INDEX IF NOT EXISTS idx_broker_om_pulled_attachments_scope_message_filename
  ON broker_om_pulled_attachments (scope_key, message_id, filename);
