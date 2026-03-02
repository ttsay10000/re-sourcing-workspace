-- Enrichment and dedup columns for raw listings

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS agent_enrichment JSONB,
  ADD COLUMN IF NOT EXISTS price_history JSONB,
  ADD COLUMN IF NOT EXISTS duplicate_score INTEGER;

COMMENT ON COLUMN listings.agent_enrichment IS 'Enriched broker/agent data (firm, email, phone) from OpenAI lookup.';
COMMENT ON COLUMN listings.price_history IS 'Price history (date, price, event) extracted from listing URL.';
COMMENT ON COLUMN listings.duplicate_score IS 'Duplicate likelihood 0-100 (100 = likely duplicate); from fuzzy address match.';
