-- Manual-first email automation controls. Defaults remain off until explicitly enabled.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS automation_initial_email_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS automation_reply_email_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS automation_ambiguous_action_handling_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profile.automation_initial_email_enabled IS 'When true, initial broker OM outreach may run, subject to the global env gate.';
COMMENT ON COLUMN user_profile.automation_reply_email_enabled IS 'Reserved toggle for future automatic broker replies. Defaults off and is not acted on yet.';
COMMENT ON COLUMN user_profile.automation_ambiguous_action_handling_enabled IS 'Reserved toggle for future automatic handling of ambiguous inbox/action items. Defaults off and is not acted on yet.';
