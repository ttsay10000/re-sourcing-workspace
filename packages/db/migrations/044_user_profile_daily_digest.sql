ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS daily_digest_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_digest_time_local TEXT NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS daily_digest_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS last_daily_digest_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profile.daily_digest_enabled IS 'When true, cron may send a daily owner digest if there were system updates since the last digest.';
COMMENT ON COLUMN user_profile.daily_digest_time_local IS 'Preferred daily digest send time in local HH:MM format.';
COMMENT ON COLUMN user_profile.daily_digest_timezone IS 'IANA timezone used to determine when the daily digest is due.';
COMMENT ON COLUMN user_profile.last_daily_digest_sent_at IS 'Timestamp when the last owner digest email was successfully sent.';
