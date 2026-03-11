-- OM ingestion V2 run ledger, page artifacts, extracted snapshots, and promoted authoritative snapshots.

CREATE TABLE IF NOT EXISTS om_ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_document_id UUID,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  snapshot_version INTEGER NOT NULL DEFAULT 2,
  extraction_method TEXT,
  page_count INTEGER,
  financial_page_count INTEGER,
  ocr_page_count INTEGER,
  source_meta JSONB,
  coverage JSONB,
  last_error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_om_ingestion_runs_property_started_at
  ON om_ingestion_runs(property_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_om_ingestion_runs_status
  ON om_ingestion_runs(status, started_at DESC);

COMMENT ON TABLE om_ingestion_runs IS 'One row per OM ingestion attempt, including uploads, inquiry attachments, and refresh jobs.';

CREATE TABLE IF NOT EXISTS om_page_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES om_ingestion_runs(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  page_type TEXT NOT NULL,
  extraction_method_candidate TEXT NOT NULL DEFAULT 'ignore',
  text_density DOUBLE PRECISION,
  image_density DOUBLE PRECISION,
  numeric_density DOUBLE PRECISION,
  layout_blocks JSONB,
  detected_keywords TEXT[],
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_om_page_classifications_run_page
  ON om_page_classifications(run_id, page_number);

COMMENT ON TABLE om_page_classifications IS 'Per-page document structure output used to determine where OCR or text table extraction should run.';

CREATE TABLE IF NOT EXISTS om_table_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES om_ingestion_runs(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  region_type TEXT,
  extraction_method TEXT,
  confidence DOUBLE PRECISION,
  x1 DOUBLE PRECISION NOT NULL,
  y1 DOUBLE PRECISION NOT NULL,
  x2 DOUBLE PRECISION NOT NULL,
  y2 DOUBLE PRECISION NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_om_table_regions_run_page
  ON om_table_regions(run_id, page_number);

COMMENT ON TABLE om_table_regions IS 'Detected table bounding boxes that constrain OCR and table reconstruction to relevant OM regions.';

CREATE TABLE IF NOT EXISTS om_extracted_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES om_ingestion_runs(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  extraction_method TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_om_extracted_snapshots_property_created_at
  ON om_extracted_snapshots(property_id, created_at DESC);

COMMENT ON TABLE om_extracted_snapshots IS 'Structured extraction output for every OM run before promotion review.';

CREATE TABLE IF NOT EXISTS om_authoritative_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  run_id UUID NOT NULL UNIQUE REFERENCES om_ingestion_runs(id) ON DELETE CASCADE,
  source_document_id UUID,
  snapshot_version INTEGER NOT NULL DEFAULT 2,
  snapshot JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_om_authoritative_snapshots_property_created_at
  ON om_authoritative_snapshots(property_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_om_authoritative_snapshots_active_property
  ON om_authoritative_snapshots(property_id)
  WHERE is_active = true;

COMMENT ON TABLE om_authoritative_snapshots IS 'Promoted OM snapshots used as the authoritative broker-data source for property financial calculations.';
