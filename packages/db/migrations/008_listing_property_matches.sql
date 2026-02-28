-- Listing–property matches (dedupe candidates + confidence + reasons)

CREATE TABLE listing_property_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasons JSONB NOT NULL DEFAULT '{}',
  status match_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, property_id)
);

CREATE INDEX idx_listing_property_matches_listing_id ON listing_property_matches(listing_id);
CREATE INDEX idx_listing_property_matches_property_id ON listing_property_matches(property_id);
CREATE INDEX idx_listing_property_matches_status ON listing_property_matches(status);
CREATE INDEX idx_listing_property_matches_confidence ON listing_property_matches(confidence DESC);
