-- Market context layer v1: ingested broker/research PDFs → classified documents,
-- extracted comps + market stats with provenance, per-neighborhood rollups, and
-- the Manhattan neighborhood polygon/alias lookup used by the Yield Map overlay.
--
-- Naming note: the spec calls these tables documents/comps; they are prefixed
-- market_* here because `documents` (generated dossiers) and the operating-comps
-- concept already exist in this schema. Field-level schemas are unchanged.

-- Neighborhood lookup: polygon ids + alias map. Polygons are simplified
-- display rings ([lng,lat] pairs) traced along well-known boundary streets —
-- good enough for choropleth fills and centroid labels; swap in official NTA
-- geometries later without changing consumers (same JSONB ring shape).
CREATE TABLE IF NOT EXISTS neighborhoods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  borough TEXT NOT NULL DEFAULT 'Manhattan',
  -- Submarket bucket used to match publisher aggregate stats for fallbacks
  -- (e.g. Avison Young tracks south of 96th only; Ariel splits Northern Manhattan).
  submarket_id TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  polygon JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE neighborhoods IS 'Manhattan neighborhood polygons + alias map for market-comp resolution and Yield Map fills.';

-- Uploaded market documents (broker materials and published research reports)
-- with the classifier verdict persisted on the row.
CREATE TABLE IF NOT EXISTS market_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  content_type TEXT,
  file_content BYTEA,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'classified', 'extracted', 'synthesized', 'failed')),
  -- Classifier output (Part 1). source_type is the two-value provenance enum.
  source_type TEXT CHECK (source_type IN ('broker_provided', 'market_research')),
  publisher TEXT,
  branded BOOLEAN,
  document_class TEXT
    CHECK (document_class IN ('published_report', 'om', 'bov', 'comp_list', 'email', 'unknown')),
  report_title TEXT,
  period_covered TEXT,
  geo_scope TEXT,
  subject_property TEXT,
  classifier_confidence TEXT CHECK (classifier_confidence IN ('high', 'medium', 'low')),
  classifier_evidence JSONB,
  flag_for_review BOOLEAN NOT NULL DEFAULT false,
  ingest_report JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE market_documents IS 'Uploaded market-context PDFs: broker deal materials (default) and published research reports, with classifier provenance.';

-- Extracted comps. Append-only by document; upserted on the dedupe key
-- (normalized address + price ±2% + sale date ±30d) with provenance merged
-- into provenance_list so corroborated deals keep both source tags.
CREATE TABLE IF NOT EXISTS market_comps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES market_documents(id) ON DELETE SET NULL,
  address TEXT NOT NULL,
  address_normalized TEXT NOT NULL,
  neighborhood_raw TEXT,
  neighborhood_id TEXT REFERENCES neighborhoods(id),
  borough TEXT,
  sale_price NUMERIC,
  price_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (price_type IN ('closed', 'asking', 'in_contract', 'unknown')),
  sale_date DATE,
  gsf NUMERIC,
  price_psf NUMERIC,
  units_total INTEGER,
  units_resi INTEGER,
  pct_rent_stabilized NUMERIC,
  -- Decimal (0.0582 = 5.82%); null when the document prints "N/A" — never inferred.
  cap_rate NUMERIC,
  asset_type TEXT
    CHECK (asset_type IS NULL OR asset_type IN ('multifamily', 'mixed-use', 'office', 'retail', 'development', 'conversion')),
  notes_short TEXT,
  cherry_pick_risk BOOLEAN NOT NULL DEFAULT false,
  is_subject_property BOOLEAN NOT NULL DEFAULT false,
  confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  raw_text TEXT,
  provenance JSONB NOT NULL,
  provenance_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Coordinates resolved by matching pipeline properties (no external geocoder).
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_comps_address_norm ON market_comps (address_normalized);
CREATE INDEX IF NOT EXISTS idx_market_comps_neighborhood ON market_comps (neighborhood_id, price_type, sale_date);
CREATE INDEX IF NOT EXISTS idx_market_comps_document ON market_comps (document_id);

COMMENT ON TABLE market_comps IS 'Comps extracted from market documents; every row carries provenance with the two-value source_type enum.';

-- Extracted aggregate market statistics. Publisher universes differ (Alpha: 5+
-- units >=$1M citywide; AY: >=$5M south of 96th; Ariel: 10+ units, splits
-- Northern Manhattan) — aggregates are NEVER averaged across publishers.
CREATE TABLE IF NOT EXISTS market_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES market_documents(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  metric_type TEXT NOT NULL DEFAULT 'level' CHECK (metric_type IN ('level', 'pct_change')),
  value NUMERIC NOT NULL,
  comparison_period TEXT,
  geo_level TEXT NOT NULL
    CHECK (geo_level IN ('address', 'neighborhood', 'submarket', 'borough', 'citywide')),
  geo_name TEXT NOT NULL,
  submarket_id TEXT,
  segment TEXT,
  period TEXT,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_stats_scope ON market_stats (submarket_id, metric, metric_type);
CREATE INDEX IF NOT EXISTS idx_market_stats_document ON market_stats (document_id);

COMMENT ON TABLE market_stats IS 'Aggregate stats from market documents; geo scope stored verbatim, publisher named on every citation.';

-- Per-neighborhood rollups (recomputed for affected neighborhoods after each ingest).
CREATE TABLE IF NOT EXISTS neighborhood_summaries (
  neighborhood_id TEXT PRIMARY KEY REFERENCES neighborhoods(id),
  comp_count_12mo INTEGER NOT NULL DEFAULT 0,
  n_research INTEGER NOT NULL DEFAULT 0,
  n_broker INTEGER NOT NULL DEFAULT 0,
  n_cherry_pick_excluded INTEGER NOT NULL DEFAULT 0,
  n_asking_excluded INTEGER NOT NULL DEFAULT 0,
  median_cap_rate NUMERIC,
  cap_rate_range JSONB,
  median_psf NUMERIC,
  psf_range JSONB,
  regulatory_skew TEXT,
  bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  fallback_context TEXT,
  data_freshness DATE,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_comps JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE neighborhood_summaries IS 'Computed neighborhood rollups + synthesized popup bullets for the Yield Map market layer.';

-- Raw LLM outputs per stage, keyed by document + prompt version, so the corpus
-- can be re-derived when prompts improve.
CREATE TABLE IF NOT EXISTS market_llm_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES market_documents(id) ON DELETE CASCADE,
  neighborhood_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('classify', 'extract', 'synthesize')),
  prompt_version TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  raw_output TEXT,
  parsed JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_llm_outputs_document ON market_llm_outputs (document_id, stage, prompt_version);

COMMENT ON TABLE market_llm_outputs IS 'Raw model output per ingest stage keyed by document_id + prompt_version for reprocessing.';

-- ---------------------------------------------------------------------------
-- Seed: Manhattan neighborhoods (simplified polygons + aliases).
-- ---------------------------------------------------------------------------
INSERT INTO neighborhoods (id, name, borough, submarket_id, aliases, polygon) VALUES
  ('financial-district', 'Financial District', 'Manhattan', 'manhattan_below_96',
   ARRAY['FiDi','Financial District','Wall Street','Battery Park City'],
   '[[-74.0190,40.7000],[-73.9985,40.7060],[-73.9975,40.7115],[-74.0130,40.7160],[-74.0175,40.7150]]'::jsonb),
  ('tribeca', 'Tribeca', 'Manhattan', 'manhattan_below_96',
   ARRAY['Tribeca','TriBeCa'],
   '[[-74.0170,40.7150],[-74.0034,40.7143],[-74.0012,40.7192],[-74.0105,40.7248]]'::jsonb),
  ('chinatown', 'Chinatown', 'Manhattan', 'manhattan_below_96',
   ARRAY['Chinatown'],
   '[[-74.0010,40.7143],[-73.9930,40.7105],[-73.9870,40.7150],[-73.9920,40.7215],[-74.0012,40.7192]]'::jsonb),
  ('lower-east-side', 'Lower East Side', 'Manhattan', 'manhattan_below_96',
   ARRAY['Lower East Side','LES','Two Bridges'],
   '[[-73.9935,40.7140],[-73.9755,40.7105],[-73.9735,40.7230],[-73.9935,40.7245]]'::jsonb),
  ('soho', 'SoHo', 'Manhattan', 'manhattan_below_96',
   ARRAY['SoHo','Soho','Hudson Square','South Village'],
   '[[-74.0052,40.7227],[-73.9990,40.7185],[-73.9940,40.7254],[-74.0033,40.7282]]'::jsonb),
  ('nolita', 'Nolita', 'Manhattan', 'manhattan_below_96',
   ARRAY['Nolita','NoLita','Little Italy'],
   '[[-73.9990,40.7185],[-73.9938,40.7177],[-73.9935,40.7244],[-73.9940,40.7254]]'::jsonb),
  ('noho', 'NoHo', 'Manhattan', 'manhattan_below_96',
   ARRAY['NoHo','Noho'],
   '[[-73.9949,40.7255],[-73.9935,40.7244],[-73.9900,40.7290],[-73.9925,40.7308]]'::jsonb),
  ('east-village', 'East Village', 'Manhattan', 'manhattan_below_96',
   ARRAY['East Village','Alphabet City','Bowery'],
   '[[-73.9935,40.7244],[-73.9735,40.7225],[-73.9720,40.7290],[-73.9899,40.7332],[-73.9925,40.7308]]'::jsonb),
  ('greenwich-village', 'Greenwich Village', 'Manhattan', 'manhattan_below_96',
   ARRAY['Greenwich Village','The Village','Central Village','Washington Square'],
   '[[-74.0033,40.7282],[-73.9949,40.7255],[-73.9905,40.7347],[-73.9965,40.7376]]'::jsonb),
  ('west-village', 'West Village', 'Manhattan', 'manhattan_below_96',
   ARRAY['West Village','Far West Village','Meatpacking District'],
   '[[-74.0107,40.7290],[-74.0033,40.7282],[-73.9965,40.7376],[-74.0085,40.7405]]'::jsonb),
  ('chelsea', 'Chelsea', 'Manhattan', 'manhattan_below_96',
   ARRAY['Chelsea','West Chelsea','Hudson Yards'],
   '[[-74.0085,40.7405],[-73.9965,40.7376],[-73.9877,40.7496],[-74.0025,40.7575]]'::jsonb),
  ('flatiron', 'Flatiron / Union Square', 'Manhattan', 'manhattan_below_96',
   ARRAY['Flatiron','Flatiron District','Union Square','NoMad','Madison Square'],
   '[[-73.9965,40.7376],[-73.9885,40.7345],[-73.9833,40.7446],[-73.9897,40.7470]]'::jsonb),
  ('gramercy', 'Gramercy', 'Manhattan', 'manhattan_below_96',
   ARRAY['Gramercy','Gramercy Park','Stuyvesant Town','Peter Cooper Village'],
   '[[-73.9885,40.7345],[-73.9720,40.7290],[-73.9685,40.7355],[-73.9866,40.7398]]'::jsonb),
  ('kips-bay', 'Kips Bay', 'Manhattan', 'manhattan_below_96',
   ARRAY['Kips Bay','Rose Hill'],
   '[[-73.9866,40.7398],[-73.9685,40.7355],[-73.9645,40.7425],[-73.9821,40.7461]]'::jsonb),
  ('murray-hill', 'Murray Hill', 'Manhattan', 'manhattan_below_96',
   ARRAY['Murray Hill','Tudor City'],
   '[[-73.9857,40.7484],[-73.9645,40.7425],[-73.9680,40.7490],[-73.9810,40.7539]]'::jsonb),
  ('midtown', 'Midtown', 'Manhattan', 'manhattan_below_96',
   ARRAY['Midtown','Times Square','Theater District','Garment District','Herald Square','Penn District','Plaza District'],
   '[[-73.9934,40.7522],[-73.9857,40.7484],[-73.9732,40.7644],[-73.9819,40.7680]]'::jsonb),
  ('hells-kitchen', 'Hell''s Kitchen', 'Manhattan', 'manhattan_below_96',
   ARRAY['Hell''s Kitchen','Hells Kitchen','Clinton','Midtown West'],
   '[[-74.0025,40.7575],[-73.9934,40.7522],[-73.9819,40.7680],[-73.9930,40.7720]]'::jsonb),
  ('midtown-east', 'Midtown East', 'Manhattan', 'manhattan_below_96',
   ARRAY['Midtown East','Turtle Bay','Sutton Place','Grand Central'],
   '[[-73.9810,40.7539],[-73.9680,40.7490],[-73.9619,40.7585],[-73.9732,40.7644]]'::jsonb),
  ('upper-east-side', 'Upper East Side', 'Manhattan', 'manhattan_below_96',
   ARRAY['Upper East Side','UES','Yorkville','Lenox Hill','Carnegie Hill'],
   '[[-73.9732,40.7644],[-73.9619,40.7585],[-73.9440,40.7825],[-73.9562,40.7878]]'::jsonb),
  ('upper-west-side', 'Upper West Side', 'Manhattan', 'manhattan_below_96',
   ARRAY['Upper West Side','UWS','Lincoln Square','Manhattan Valley','Bloomingdale'],
   '[[-73.9935,40.7720],[-73.9819,40.7680],[-73.9580,40.8005],[-73.9720,40.8060]]'::jsonb),
  ('east-harlem', 'East Harlem', 'Manhattan', 'northern_manhattan',
   ARRAY['East Harlem','El Barrio','Spanish Harlem'],
   '[[-73.9562,40.7878],[-73.9440,40.7825],[-73.9290,40.8005],[-73.9320,40.8128],[-73.9380,40.8128]]'::jsonb),
  ('harlem', 'Central Harlem', 'Manhattan', 'northern_manhattan',
   ARRAY['Harlem','Central Harlem','South Harlem','SoHa'],
   '[[-73.9580,40.8005],[-73.9498,40.7967],[-73.9380,40.8128],[-73.9340,40.8290],[-73.9412,40.8303]]'::jsonb),
  ('morningside-heights', 'Morningside Heights', 'Manhattan', 'northern_manhattan',
   ARRAY['Morningside Heights'],
   '[[-73.9720,40.8060],[-73.9580,40.8005],[-73.9525,40.8112],[-73.9640,40.8180]]'::jsonb),
  ('manhattanville', 'Manhattanville', 'Manhattan', 'northern_manhattan',
   ARRAY['Manhattanville','West Harlem'],
   '[[-73.9640,40.8180],[-73.9525,40.8112],[-73.9476,40.8179],[-73.9560,40.8235]]'::jsonb),
  ('hamilton-heights', 'Hamilton Heights', 'Manhattan', 'northern_manhattan',
   ARRAY['Hamilton Heights','Sugar Hill'],
   '[[-73.9560,40.8235],[-73.9476,40.8179],[-73.9412,40.8303],[-73.9480,40.8325]]'::jsonb),
  ('washington-heights', 'Washington Heights', 'Manhattan', 'northern_manhattan',
   ARRAY['Washington Heights','Hudson Heights','Fort George','WaHi'],
   '[[-73.9480,40.8325],[-73.9340,40.8290],[-73.9230,40.8560],[-73.9330,40.8625]]'::jsonb),
  ('inwood', 'Inwood', 'Manhattan', 'northern_manhattan',
   ARRAY['Inwood','Marble Hill'],
   '[[-73.9330,40.8625],[-73.9230,40.8560],[-73.9120,40.8690],[-73.9200,40.8770],[-73.9300,40.8720]]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  borough = EXCLUDED.borough,
  submarket_id = EXCLUDED.submarket_id,
  aliases = EXCLUDED.aliases,
  polygon = EXCLUDED.polygon;
