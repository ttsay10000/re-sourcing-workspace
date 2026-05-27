-- Safety default after introducing saved-search broker outreach.
-- Existing profiles are reset to manual-only initial outreach; users can re-enable from Profile.

UPDATE user_profile
SET
  automation_initial_email_enabled = false,
  automation_reply_email_enabled = false,
  automation_ambiguous_action_handling_enabled = false
WHERE
  automation_initial_email_enabled IS DISTINCT FROM false
  OR automation_reply_email_enabled IS DISTINCT FROM false
  OR automation_ambiguous_action_handling_enabled IS DISTINCT FROM false;
