ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS site_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS site_password_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profile.site_password_hash IS 'Hashed shared site password for the lightweight global unlock flow.';
COMMENT ON COLUMN user_profile.site_password_updated_at IS 'Timestamp when the shared site password was last changed.';
