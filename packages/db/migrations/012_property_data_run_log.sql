-- Log of every "Send to property data" run for data integrity and comparison.

CREATE TABLE IF NOT EXISTS property_data_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number SERIAL UNIQUE,
  run_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  criteria JSONB,
  listings_created INTEGER NOT NULL DEFAULT 0,
  listings_updated INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_property_data_run_log_sent_at ON property_data_run_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_data_run_log_run_id ON property_data_run_log(run_id);

COMMENT ON TABLE property_data_run_log IS 'Log of test runs sent to property data; run_number allows comparing runs for data integrity.';
