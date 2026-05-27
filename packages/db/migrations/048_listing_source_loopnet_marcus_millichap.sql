-- Additive listing source values for source adapters.
-- Also repairs the pre-existing contract/database skew for nyc_api.

ALTER TYPE listing_source ADD VALUE IF NOT EXISTS 'nyc_api';
ALTER TYPE listing_source ADD VALUE IF NOT EXISTS 'loopnet';
ALTER TYPE listing_source ADD VALUE IF NOT EXISTS 'marcus_millichap';
