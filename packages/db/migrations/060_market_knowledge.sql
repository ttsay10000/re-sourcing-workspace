-- Market knowledge base v1: a living, cumulative market narrative that grows
-- with every ingested market document, plus a per-upload analyst brief.
--
-- Design: market_knowledge_entries is append-only and versioned — each ingest
-- appends one row carrying the FULL updated narrative (per-submarket direction,
-- asset-type attention, cap-rate/$PSF movements, citations, open discrepancies)
-- and the brief for the triggering document. The latest version is the current
-- state; history stays auditable by construction. Raw LLM output for the merge
-- step is persisted in market_llm_outputs under the new 'knowledge' stage.

CREATE TABLE IF NOT EXISTS market_knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic knowledge-base version; computed as MAX(version)+1 on append.
  version INTEGER NOT NULL UNIQUE,
  document_id UUID REFERENCES market_documents(id) ON DELETE SET NULL,
  -- MarketKnowledgeNarrative: submarket_trends, asset_type_attention,
  -- cap_rate_psf_movements, discrepancies, sources, as_of.
  narrative JSONB NOT NULL,
  -- MarketDocumentBrief for the document that produced this version (audit copy).
  brief JSONB,
  prompt_version TEXT,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_knowledge_entries_version
  ON market_knowledge_entries (version DESC);

COMMENT ON TABLE market_knowledge_entries IS 'Append-only versioned market knowledge base: cumulative narrative + per-upload brief; latest version = current state.';

-- Per-upload analyst brief, also stored on the document row so the ingest log
-- can render it without joining the knowledge table.
ALTER TABLE market_documents ADD COLUMN IF NOT EXISTS document_brief JSONB;

COMMENT ON COLUMN market_documents.document_brief IS 'MarketDocumentBrief: what this upload says, comparison vs prior data, discrepancy flags.';

-- Allow the knowledge-merge stage in market_llm_outputs (raw output keyed by
-- document + prompt_version, e.g. knowledge_v1). Drop-then-add keeps this
-- idempotent on re-run.
ALTER TABLE market_llm_outputs DROP CONSTRAINT IF EXISTS market_llm_outputs_stage_check;
ALTER TABLE market_llm_outputs ADD CONSTRAINT market_llm_outputs_stage_check
  CHECK (stage IN ('classify', 'extract', 'synthesize', 'knowledge'));
