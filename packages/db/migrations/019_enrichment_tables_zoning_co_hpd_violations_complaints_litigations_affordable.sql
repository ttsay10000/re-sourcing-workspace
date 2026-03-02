-- Enrichment tables for ZTL, CO, HPD Registration, HPD Violations, DOB Complaints, Housing Litigations, Affordable Housing

-- 1) Zoning ZTL (single row per property)
CREATE TABLE property_zoning_ztl (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bbl TEXT NULL,
  bin TEXT NULL,
  source_dataset TEXT NOT NULL DEFAULT 'fdkv-4t4z',
  source_row_id TEXT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}',
  normalized_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source_dataset)
);
CREATE INDEX idx_property_zoning_ztl_property_id ON property_zoning_ztl(property_id);
CREATE INDEX idx_property_zoning_ztl_bbl ON property_zoning_ztl(bbl);
CREATE INDEX idx_property_zoning_ztl_bin ON property_zoning_ztl(bin);
COMMENT ON TABLE property_zoning_ztl IS 'NYC Zoning Tax Lot (ZTL) fdkv-4t4z enrichment.';

-- 2) Certificates of Occupancy (one row per CO record)
CREATE TABLE property_certificates_of_occupancy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bbl TEXT NULL,
  bin TEXT NULL,
  source_dataset TEXT NOT NULL DEFAULT 'pkdm-hqz6',
  source_row_id TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}',
  normalized_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source_dataset, source_row_id)
);
CREATE INDEX idx_property_certificates_of_occupancy_property_id ON property_certificates_of_occupancy(property_id);
CREATE INDEX idx_property_certificates_of_occupancy_bbl ON property_certificates_of_occupancy(bbl);
CREATE INDEX idx_property_certificates_of_occupancy_bin ON property_certificates_of_occupancy(bin);
COMMENT ON TABLE property_certificates_of_occupancy IS 'DOB NOW Certificate of Occupancy pkdm-hqz6.';

-- 3) HPD Multiple Dwelling Registrations (single row per property)
CREATE TABLE property_hpd_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bbl TEXT NULL,
  bin TEXT NULL,
  source_dataset TEXT NOT NULL DEFAULT 'tesw-yqqr',
  source_row_id TEXT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}',
  normalized_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source_dataset)
);
CREATE INDEX idx_property_hpd_registrations_property_id ON property_hpd_registrations(property_id);
CREATE INDEX idx_property_hpd_registrations_bbl ON property_hpd_registrations(bbl);
CREATE INDEX idx_property_hpd_registrations_bin ON property_hpd_registrations(bin);
COMMENT ON TABLE property_hpd_registrations IS 'HPD Multiple Dwelling Registrations tesw-yqqr.';

-- 4) HPD Housing Maintenance Code Violations (multi-row)
CREATE TABLE property_hpd_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bbl TEXT NULL,
  bin TEXT NULL,
  source_dataset TEXT NOT NULL DEFAULT 'wvxf-dwi5',
  source_row_id TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}',
  normalized_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source_dataset, source_row_id)
);
CREATE INDEX idx_property_hpd_violations_property_id ON property_hpd_violations(property_id);
CREATE INDEX idx_property_hpd_violations_bbl ON property_hpd_violations(bbl);
CREATE INDEX idx_property_hpd_violations_bin ON property_hpd_violations(bin);
COMMENT ON TABLE property_hpd_violations IS 'HPD Housing Maintenance Code Violations wvxf-dwi5.';

-- 5) DOB Complaints (multi-row)
CREATE TABLE property_dob_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bbl TEXT NULL,
  bin TEXT NULL,
  source_dataset TEXT NOT NULL DEFAULT 'eabe-havv',
  source_row_id TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}',
  normalized_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source_dataset, source_row_id)
);
CREATE INDEX idx_property_dob_complaints_property_id ON property_dob_complaints(property_id);
CREATE INDEX idx_property_dob_complaints_bbl ON property_dob_complaints(bbl);
CREATE INDEX idx_property_dob_complaints_bin ON property_dob_complaints(bin);
COMMENT ON TABLE property_dob_complaints IS 'DOB Complaints Received eabe-havv.';

-- 6) Housing Litigations (multi-row)
CREATE TABLE property_housing_litigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bbl TEXT NULL,
  bin TEXT NULL,
  source_dataset TEXT NOT NULL DEFAULT '59kj-x8nc',
  source_row_id TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}',
  normalized_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source_dataset, source_row_id)
);
CREATE INDEX idx_property_housing_litigations_property_id ON property_housing_litigations(property_id);
CREATE INDEX idx_property_housing_litigations_bbl ON property_housing_litigations(bbl);
CREATE INDEX idx_property_housing_litigations_bin ON property_housing_litigations(bin);
COMMENT ON TABLE property_housing_litigations IS 'Housing Litigations 59kj-x8nc.';

-- 7) Affordable Housing Production (multi-row, one per project)
CREATE TABLE property_affordable_housing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bbl TEXT NULL,
  bin TEXT NULL,
  source_dataset TEXT NOT NULL DEFAULT 'hg8x-zxpr',
  source_row_id TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}',
  normalized_json JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, source_dataset, source_row_id)
);
CREATE INDEX idx_property_affordable_housing_property_id ON property_affordable_housing(property_id);
CREATE INDEX idx_property_affordable_housing_bbl ON property_affordable_housing(bbl);
CREATE INDEX idx_property_affordable_housing_bin ON property_affordable_housing(bin);
COMMENT ON TABLE property_affordable_housing IS 'Affordable Housing Production by Building hg8x-zxpr.';
