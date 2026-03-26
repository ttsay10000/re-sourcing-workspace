ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS default_annual_commercial_rent_growth_pct NUMERIC;

COMMENT ON COLUMN user_profile.default_annual_commercial_rent_growth_pct IS 'Default annual growth assumption for commercial rent lines.';

UPDATE user_profile
SET default_annual_commercial_rent_growth_pct = COALESCE(default_annual_commercial_rent_growth_pct, 1.5)
WHERE default_annual_commercial_rent_growth_pct IS NULL;
