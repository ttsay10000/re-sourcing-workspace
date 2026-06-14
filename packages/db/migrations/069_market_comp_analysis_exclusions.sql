ALTER TABLE market_comps
  ADD COLUMN IF NOT EXISTS analysis_excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS analysis_excluded_reason text;

