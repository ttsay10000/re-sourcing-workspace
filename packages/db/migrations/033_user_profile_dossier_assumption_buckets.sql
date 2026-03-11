-- Dossier underwriting defaults: acquisition/hold/exit buckets.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS default_purchase_closing_cost_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS default_hold_period_years INTEGER,
  ADD COLUMN IF NOT EXISTS default_exit_closing_cost_pct NUMERIC;

COMMENT ON COLUMN user_profile.default_purchase_closing_cost_pct IS 'Default purchase closing costs as % of purchase price.';
COMMENT ON COLUMN user_profile.default_hold_period_years IS 'Default underwriting hold period in years.';
COMMENT ON COLUMN user_profile.default_exit_closing_cost_pct IS 'Default sale closing costs as % of sale price.';
