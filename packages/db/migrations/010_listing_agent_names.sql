-- Agent names from GET sale details; first-class for LLM enrichment.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS agent_names TEXT[];

COMMENT ON COLUMN listings.agent_names IS 'Listing/sale agent names from source (e.g. GET sale details); used for LLM enrichment.';
