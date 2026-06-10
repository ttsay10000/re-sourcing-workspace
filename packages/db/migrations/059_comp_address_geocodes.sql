-- Geocode cache for broker-package comp addresses so comps can be plotted on
-- the yield map. Keyed by a normalized address line (+ borough/zip hint).
-- Failed lookups are cached too and retried after they go stale.

CREATE TABLE IF NOT EXISTS comp_address_geocodes (
  address_key TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  borough_hint TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  bbl TEXT,
  geocode_status TEXT NOT NULL DEFAULT 'ok', -- 'ok' | 'failed'
  geocode_source TEXT NOT NULL DEFAULT 'geoclient',
  geocoded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comp_address_geocodes_status_idx
  ON comp_address_geocodes (geocode_status, geocoded_at);
