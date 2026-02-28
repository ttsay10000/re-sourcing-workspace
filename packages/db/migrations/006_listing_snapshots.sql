-- Listing snapshots: raw lake metadata + pointer to raw payload.
-- Pruned flag used (no hard delete) for audit/undelete; document in README.

CREATE TABLE listing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload_path TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  pruned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_listing_snapshots_listing_id ON listing_snapshots(listing_id);
CREATE INDEX idx_listing_snapshots_run_id ON listing_snapshots(run_id);
CREATE INDEX idx_listing_snapshots_captured_at ON listing_snapshots(captured_at DESC);
CREATE INDEX idx_listing_snapshots_pruned ON listing_snapshots(pruned) WHERE pruned = false;
