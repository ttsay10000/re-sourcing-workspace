-- Global automation controls for scheduled sourcing/outreach jobs.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS automation_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS automation_pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS automation_paused_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profile.automation_paused IS 'When true, scheduled automation jobs should skip ingestion, outreach, and inbox processing.';
COMMENT ON COLUMN user_profile.automation_pause_reason IS 'Optional operator note explaining why scheduled automation is paused.';
COMMENT ON COLUMN user_profile.automation_paused_at IS 'Timestamp when automation was most recently paused.';
