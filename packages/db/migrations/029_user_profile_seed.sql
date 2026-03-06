-- Ensure one default user_profile row exists so saved_deals can reference it (single-user mode).
INSERT INTO user_profile (id, name, email, organization)
SELECT gen_random_uuid(), '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM user_profile LIMIT 1);
