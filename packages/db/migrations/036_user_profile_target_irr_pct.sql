-- Dossier underwriting defaults: target IRR for recommended offer calculations.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS default_target_irr_pct NUMERIC;

COMMENT ON COLUMN user_profile.default_target_irr_pct IS 'Default target IRR % used to solve for recommended offer price.';
