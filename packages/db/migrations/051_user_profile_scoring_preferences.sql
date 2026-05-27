-- User-configurable deal scoring preferences.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS scoring_preferences JSONB NOT NULL DEFAULT
    '{"targetIrrPct":25,"goodCashOnCashPct":2,"rentStabilizationDoNotBuy":false,"scoringProfileKey":"legacy_v3"}'::jsonb;

COMMENT ON COLUMN user_profile.scoring_preferences IS 'User scoring preferences applied to deterministic deal scoring profiles.';

UPDATE user_profile
SET scoring_preferences = jsonb_build_object(
  'targetIrrPct', COALESCE((scoring_preferences->>'targetIrrPct')::numeric, 25),
  'goodCashOnCashPct', COALESCE((scoring_preferences->>'goodCashOnCashPct')::numeric, 2),
  'rentStabilizationDoNotBuy', COALESCE((scoring_preferences->>'rentStabilizationDoNotBuy')::boolean, false),
  'scoringProfileKey', COALESCE(scoring_preferences->>'scoringProfileKey', 'legacy_v3')
)
WHERE scoring_preferences IS NULL OR scoring_preferences = '{}'::jsonb;
