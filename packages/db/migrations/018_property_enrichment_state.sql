-- Track last run and outcome of enrichment jobs per property (e.g. permits)

CREATE TABLE property_enrichment_state (
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  enrichment_name TEXT NOT NULL DEFAULT 'permits',
  last_refreshed_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  stats_json JSONB NULL,
  PRIMARY KEY (property_id, enrichment_name)
);

COMMENT ON TABLE property_enrichment_state IS 'Last run and outcome of enrichment (permits, future: tax, owner) per property.';
