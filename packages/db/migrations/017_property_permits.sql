-- DOB NOW Build Approved Permits enrichment: one row per permit per property

CREATE TABLE property_permits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'dob_build_rbx6_tga4',
  work_permit TEXT NOT NULL,
  sequence_number INTEGER NULL,
  tracking_number TEXT NULL,
  bbl TEXT NULL,
  status TEXT NULL,
  issued_date DATE NULL,
  approved_date DATE NULL,
  expired_date DATE NULL,
  normalized_json JSONB NOT NULL DEFAULT '{}',
  raw_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source, work_permit)
);

CREATE INDEX idx_property_permits_property_id ON property_permits(property_id);
CREATE INDEX idx_property_permits_bbl ON property_permits(bbl);
CREATE INDEX idx_property_permits_issued_date ON property_permits(issued_date DESC);

COMMENT ON TABLE property_permits IS 'Permits from NYC DOB NOW Build (Socrata rbx6-tga4) linked to canonical properties.';
