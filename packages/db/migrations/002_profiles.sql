-- Search profiles: filters, source toggles, schedule

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location_mode location_mode NOT NULL DEFAULT 'single',
  single_location_slug TEXT,
  area_codes TEXT[] NOT NULL DEFAULT '{}',
  min_price INTEGER,
  max_price INTEGER,
  min_beds INTEGER,
  max_beds INTEGER,
  min_baths INTEGER,
  max_baths INTEGER,
  min_sqft INTEGER,
  max_sqft INTEGER,
  required_amenities TEXT[] NOT NULL DEFAULT '{}',
  source_toggles JSONB NOT NULL DEFAULT '{"streeteasy": true, "manual": true}',
  schedule_cron TEXT,
  run_interval_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_updated_at ON profiles(updated_at);
