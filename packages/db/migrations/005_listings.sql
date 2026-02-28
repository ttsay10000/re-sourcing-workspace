-- Listings (source-agnostic; lifecycle: active | missing | pruned)

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source listing_source NOT NULL,
  external_id TEXT NOT NULL,
  lifecycle_state listing_lifecycle_state NOT NULL DEFAULT 'active',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  missing_since TIMESTAMPTZ,
  pruned_at TIMESTAMPTZ,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  price INTEGER NOT NULL,
  beds INTEGER NOT NULL,
  baths INTEGER NOT NULL,
  sqft INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  image_urls TEXT[],
  listed_at TIMESTAMPTZ,
  extra JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source, external_id)
);

CREATE INDEX idx_listings_source ON listings(source);
CREATE INDEX idx_listings_lifecycle_state ON listings(lifecycle_state);
CREATE INDEX idx_listings_last_seen_at ON listings(last_seen_at DESC);
CREATE INDEX idx_listings_first_seen_at ON listings(first_seen_at);
CREATE INDEX idx_listings_price ON listings(price);
CREATE INDEX idx_listings_zip ON listings(zip);
