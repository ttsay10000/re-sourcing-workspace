-- Saved deals: user + property + deal status (per user per property).

DO $$ BEGIN
  CREATE TYPE deal_status_enum AS ENUM ('new', 'interesting', 'saved', 'dossier_generated', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE saved_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  deal_status deal_status_enum NOT NULL DEFAULT 'saved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, property_id)
);

CREATE INDEX idx_saved_deals_user_id ON saved_deals(user_id);
CREATE INDEX idx_saved_deals_property_id ON saved_deals(property_id);

COMMENT ON TABLE saved_deals IS 'User-saved deals with status: new, interesting, saved, dossier_generated, rejected.';
