-- Deal cards: persist IRR, equity multiple, CoC, hold years, current/adjusted NOI.
-- Profile: expected appreciation rate for property value projection.

ALTER TABLE deal_signals
  ADD COLUMN IF NOT EXISTS irr_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS equity_multiple NUMERIC,
  ADD COLUMN IF NOT EXISTS coc_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hold_years INTEGER,
  ADD COLUMN IF NOT EXISTS current_noi NUMERIC,
  ADD COLUMN IF NOT EXISTS adjusted_noi NUMERIC;

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS expected_appreciation_pct NUMERIC;

COMMENT ON COLUMN deal_signals.irr_pct IS 'IRR as decimal (e.g. 0.12 for 12%)';
COMMENT ON COLUMN deal_signals.coc_pct IS 'Cash-on-cash as decimal (e.g. 0.062 for 6.2%)';
COMMENT ON COLUMN deal_signals.hold_years IS 'Hold period in years used for IRR calc';
COMMENT ON COLUMN user_profile.expected_appreciation_pct IS 'Expected annual appreciation % (e.g. 3 for 3%/yr)';
