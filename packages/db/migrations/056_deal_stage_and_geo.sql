-- Canonical deal stage model + stage transition audit + property geo columns.
-- Additive only; legacy status dimensions keep working during the transition.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS deal_state TEXT,
  ADD COLUMN IF NOT EXISTS deal_stage TEXT,
  ADD COLUMN IF NOT EXISTS stage_order INTEGER,
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geocode_source TEXT,
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

COMMENT ON COLUMN properties.deal_state IS 'Canonical deal state: active | dead | closed.';
COMMENT ON COLUMN properties.deal_stage IS 'Canonical pipeline stage (inbox, screening, pursuing, outreach, om_review, underwriting, tour, offer_loi, contract_dd, closed).';
COMMENT ON COLUMN properties.stage_order IS 'Manual ordering within a stage column (board position).';
COMMENT ON COLUMN properties.stage_entered_at IS 'When the property entered its current stage (drives aging).';

CREATE INDEX IF NOT EXISTS idx_properties_deal_stage
  ON properties (deal_state, deal_stage, stage_order);
CREATE INDEX IF NOT EXISTS idx_properties_geo
  ON properties (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

CREATE TABLE IF NOT EXISTS stage_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  from_state TEXT,
  from_stage TEXT,
  to_state TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  actor TEXT,
  source TEXT,
  reason TEXT,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_property
  ON stage_transitions (property_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_transitions_stage
  ON stage_transitions (to_stage, occurred_at DESC);

-- Backfill property coordinates from the best matched listing (read-only data copy).
UPDATE properties p
SET lat = source.lat,
    lng = source.lon,
    geocode_source = 'listing',
    geocoded_at = now()
FROM (
  SELECT DISTINCT ON (m.property_id) m.property_id, l.lat, l.lon
  FROM listing_property_matches m
  JOIN listings l ON l.id = m.listing_id
  WHERE l.lat IS NOT NULL AND l.lon IS NOT NULL AND m.status <> 'rejected'
  ORDER BY m.property_id, (m.status = 'accepted') DESC, m.confidence DESC NULLS LAST
) AS source
WHERE source.property_id = p.id
  AND p.lat IS NULL;
