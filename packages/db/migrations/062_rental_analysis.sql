-- Rental Analysis v1: competitor furnished-rental listings + month-by-month
-- pricing observations (Haus first; Rove/Blueground adapters next).
--
-- Design notes:
-- * competitor_listings is the current-state row per source listing (upserted
--   on source + source_listing_id). Excluded listings are kept, flagged, and
--   hidden from comp aggregates unless the caller opts in.
-- * competitor_rate_observations is append-only: one row per tested
--   check-in/check-out range per collection run, so seasonality and price
--   movement stay reconstructable (snapshots, not overwrites).
-- * competitor_scrape_runs / _errors back the per-source diagnostics view.

CREATE TABLE IF NOT EXISTS competitor_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('haus', 'rove', 'blueground')),
  source_listing_id TEXT NOT NULL,
  url TEXT NOT NULL,

  title TEXT,
  address TEXT,
  neighborhood TEXT,
  borough TEXT,

  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  beds NUMERIC,
  baths NUMERIC,
  sqft NUMERIC,
  guests NUMERIC,

  min_stay_nights INTEGER,
  max_stay_nights INTEGER,

  available_from DATE,
  image_url TEXT,

  excluded_from_comps BOOLEAN NOT NULL DEFAULT false,
  exclusion_reason TEXT,

  scrape_status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (scrape_status IN ('discovered', 'metadata_collected', 'pricing_collected', 'pricing_failed', 'excluded')),
  scrape_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (source, source_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_competitor_listings_source
  ON competitor_listings (source, excluded_from_comps);
CREATE INDEX IF NOT EXISTS idx_competitor_listings_geo
  ON competitor_listings (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON TABLE competitor_listings IS 'Competitor furnished-rental listings (Haus/Rove/Blueground) discovered from public inventory pages.';
COMMENT ON COLUMN competitor_listings.excluded_from_comps IS 'True when rental terms make the listing non-comparable (e.g. min stay above threshold); kept for diagnostics, hidden from comp averages.';

CREATE TABLE IF NOT EXISTS competitor_rate_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES competitor_listings(id) ON DELETE CASCADE,
  run_id UUID,
  source TEXT NOT NULL CHECK (source IN ('haus', 'rove', 'blueground')),
  listing_url TEXT NOT NULL,

  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  nights INTEGER NOT NULL,
  -- "2026-07" — the calendar month this observation prices (dominant month for rolling stays).
  calendar_month TEXT,

  quote_type TEXT NOT NULL
    CHECK (quote_type IN ('calendar_month', 'rolling_30_nights', 'rolling_60_nights', 'rolling_90_nights', 'rolling_180_nights')),
  availability_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (availability_status IN ('available', 'unavailable', 'partial', 'unknown')),

  displayed_adr NUMERIC,
  displayed_monthly_rate NUMERIC,

  accommodation_subtotal_effective NUMERIC,
  accommodation_subtotal_undiscounted NUMERIC,

  effective_adr NUMERIC,
  undiscounted_adr NUMERIC,

  effective_monthly_equivalent NUMERIC,
  undiscounted_monthly_equivalent NUMERIC,

  discount_amount NUMERIC,
  discount_labels JSONB NOT NULL DEFAULT '[]'::jsonb,

  fees_excluded BOOLEAN NOT NULL DEFAULT true,
  taxes_excluded BOOLEAN NOT NULL DEFAULT true,

  cleaning_fee NUMERIC,
  service_fee NUMERIC,
  taxes NUMERIC,
  other_fees NUMERIC,

  normalization_status TEXT NOT NULL
    CHECK (normalization_status IN (
      'subtotal_clean_no_fees_taxes', 'discount_removed', 'discount_estimated',
      'effective_rate_only', 'pricing_unavailable', 'excluded_term_requirement', 'low_confidence')),
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high', 'medium', 'low')),

  raw_text TEXT,
  raw_network_payload JSONB,

  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_rate_observations_listing_month
  ON competitor_rate_observations (listing_id, calendar_month, quote_type, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_rate_observations_month
  ON competitor_rate_observations (calendar_month, quote_type);
CREATE INDEX IF NOT EXISTS idx_competitor_rate_observations_run
  ON competitor_rate_observations (run_id);

COMMENT ON TABLE competitor_rate_observations IS 'Append-only monthly pricing observations per competitor listing: accommodation subtotal only, taxes/fees excluded.';
COMMENT ON COLUMN competitor_rate_observations.normalization_status IS 'How clean the rate is: subtotal_clean_no_fees_taxes / discount_removed / discount_estimated are comp-grade; the rest carry caveats.';

CREATE TABLE IF NOT EXISTS competitor_scrape_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('haus', 'rove', 'blueground')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,

  discovered_count INTEGER NOT NULL DEFAULT 0,
  metadata_success_count INTEGER NOT NULL DEFAULT 0,
  metadata_failure_count INTEGER NOT NULL DEFAULT 0,
  pricing_success_count INTEGER NOT NULL DEFAULT 0,
  pricing_failure_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,

  quote_specs JSONB,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_competitor_scrape_runs_source_started
  ON competitor_scrape_runs (source, started_at DESC);

COMMENT ON TABLE competitor_scrape_runs IS 'One row per rental-analysis collection run (manual for V1; scheduled later) — diagnostics backbone.';

CREATE TABLE IF NOT EXISTS competitor_scrape_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES competitor_scrape_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('haus', 'rove', 'blueground')),
  listing_id UUID REFERENCES competitor_listings(id) ON DELETE SET NULL,
  url TEXT,
  stage TEXT NOT NULL
    CHECK (stage IN ('discovery', 'metadata', 'date_entry', 'quote_fetch', 'normalization', 'storage')),
  message TEXT NOT NULL,
  retryable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_scrape_errors_run
  ON competitor_scrape_errors (run_id, created_at);

COMMENT ON TABLE competitor_scrape_errors IS 'Per-listing scrape errors by stage; powers the per-source diagnostics view.';
