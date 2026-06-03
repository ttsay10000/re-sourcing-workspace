-- Broker comp package review and promotion workflow.

CREATE TABLE IF NOT EXISTS broker_comp_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_document_id UUID REFERENCES property_uploaded_documents(id) ON DELETE SET NULL,
  source_document_type TEXT,
  package_type TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'uploaded',
  raw_payload JSONB,
  normalized_payload JSONB,
  source_name TEXT,
  source_meta JSONB,
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  parser_version TEXT,
  package_meta JSONB,
  created_by TEXT,
  reviewed_at TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broker_comp_packages_property_created_at
  ON broker_comp_packages(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broker_comp_packages_source_document
  ON broker_comp_packages(source_document_id);
CREATE INDEX IF NOT EXISTS idx_broker_comp_packages_status
  ON broker_comp_packages(status, created_at DESC);

COMMENT ON TABLE broker_comp_packages IS 'Broker-provided comparable packages linked to uploaded property documents.';
COMMENT ON COLUMN broker_comp_packages.package_type IS 'Package category such as market_analysis, pricing_sellout, sale_comps, operating_comps, rent_comps, expense_comps, broker_opinion, or other.';
COMMENT ON COLUMN broker_comp_packages.status IS 'Workflow status such as uploaded, classified, extracted, needs_review, approved, or failed.';

CREATE TABLE IF NOT EXISTS broker_comp_package_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES broker_comp_packages(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  page_type TEXT NOT NULL DEFAULT 'other',
  extraction_method TEXT,
  page_ref TEXT,
  raw_text_excerpt TEXT,
  regions JSONB,
  raw_payload JSONB,
  normalized_payload JSONB,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_broker_comp_package_pages_package_page
  ON broker_comp_package_pages(package_id, page_number);
CREATE INDEX IF NOT EXISTS idx_broker_comp_package_pages_review_status
  ON broker_comp_package_pages(package_id, review_status);

COMMENT ON TABLE broker_comp_package_pages IS 'Page-level extraction artifacts and review state for a broker comp package.';

CREATE TABLE IF NOT EXISTS broker_comp_extracted_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES broker_comp_packages(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_payload JSONB,
  page_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  review_status TEXT NOT NULL DEFAULT 'pending',
  selection_decision TEXT,
  include_in_dossier BOOLEAN NOT NULL DEFAULT false,
  analyst_note TEXT,
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broker_comp_extracted_items_package_created_at
  ON broker_comp_extracted_items(package_id, created_at);
CREATE INDEX IF NOT EXISTS idx_broker_comp_extracted_items_property_created_at
  ON broker_comp_extracted_items(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broker_comp_extracted_items_package_review_status
  ON broker_comp_extracted_items(package_id, review_status);

COMMENT ON TABLE broker_comp_extracted_items IS 'Comparable rows/facts extracted from broker comp package pages before analyst promotion.';
COMMENT ON COLUMN broker_comp_extracted_items.review_status IS 'Item review status such as pending, edited, accepted, or rejected.';

CREATE TABLE IF NOT EXISTS broker_comp_promoted_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES broker_comp_packages(id) ON DELETE CASCADE,
  extracted_item_id UUID NOT NULL REFERENCES broker_comp_extracted_items(id) ON DELETE CASCADE,
  source_document_id UUID REFERENCES property_uploaded_documents(id) ON DELETE SET NULL,
  package_type TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'comp',
  raw_payload JSONB,
  normalized_payload JSONB NOT NULL,
  reviewed_payload JSONB,
  page_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  selection_decision TEXT,
  include_in_dossier BOOLEAN NOT NULL DEFAULT true,
  analyst_note TEXT,
  promoted_by TEXT,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (extracted_item_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_comp_promoted_items_property_promoted_at
  ON broker_comp_promoted_items(property_id, promoted_at DESC);
CREATE INDEX IF NOT EXISTS idx_broker_comp_promoted_items_package
  ON broker_comp_promoted_items(package_id);

COMMENT ON TABLE broker_comp_promoted_items IS 'Reviewed broker comp items promoted for downstream property analysis.';
