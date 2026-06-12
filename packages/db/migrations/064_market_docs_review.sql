-- Market docs usability push: per-document LLM analyst notes, removable /
-- duplicate-excludable documents, user-level review gating for extracted
-- comps, and the live cross-document AI market review.
--
-- Design:
--  * market_documents.llm_notes stores the two-stage (Gemini read → GPT
--    refine) analyst notes for the upload; excluded_at soft-removes a document
--    so its comps/stats leave rollups and the live review without losing the
--    audit trail (restorable).
--  * market_comps.review_status gates which extracted deals reach the Comp
--    Analysis page / Yield Map comp layer: new extractions land 'pending' and
--    wait for user approval; existing rows are grandfathered to 'approved' so
--    current rollups and map fills do not change on deploy.
--  * market_reviews is the append-only, versioned live AI review — the
--    cross-document synthesis (small-multifamily focus, QoQ comparisons,
--    cross-publisher discrepancies) regenerated from the currently included
--    documents; included_document_ids makes staleness detectable.

ALTER TABLE market_documents ADD COLUMN IF NOT EXISTS llm_notes JSONB;
ALTER TABLE market_documents ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;
ALTER TABLE market_documents ADD COLUMN IF NOT EXISTS excluded_reason TEXT
  CHECK (excluded_reason IS NULL OR excluded_reason IN ('removed', 'duplicate'));

COMMENT ON COLUMN market_documents.llm_notes IS 'MarketDocumentNotes: robust per-upload analyst notes (Gemini PDF read refined by the OpenAI model).';
COMMENT ON COLUMN market_documents.excluded_at IS 'Soft removal: excluded documents leave rollups, comp surfaces, and the live AI review; restorable.';

ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Grandfather every pre-existing comp: they were already feeding the Yield
-- Map and rollups, so they start approved; only post-migration extractions
-- enter the review queue as pending.
UPDATE market_comps SET review_status = 'approved', reviewed_at = now() WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_market_comps_review_status ON market_comps (review_status);

CREATE TABLE IF NOT EXISTS market_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic version; computed as MAX(version)+1 on append (UNIQUE guards races).
  version INTEGER NOT NULL UNIQUE,
  -- MarketReview: headline, market_pulse, small_multifamily_focus, cap_rate_trends,
  -- buyer_seller_activity, loan_environment, opportunities, qoq_comparisons,
  -- discrepancies, sources.
  review JSONB NOT NULL,
  -- Document ids folded into this version (staleness = set difference vs current).
  included_document_ids JSONB NOT NULL DEFAULT '[]',
  prompt_version TEXT,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_reviews_version ON market_reviews (version DESC);

COMMENT ON TABLE market_reviews IS 'Append-only versioned live AI market review synthesized across all included market documents.';

-- New LLM stages: per-document notes (Gemini read + GPT refine) and the
-- cross-document live review. Drop-then-add keeps this idempotent on re-run.
ALTER TABLE market_llm_outputs DROP CONSTRAINT IF EXISTS market_llm_outputs_stage_check;
ALTER TABLE market_llm_outputs ADD CONSTRAINT market_llm_outputs_stage_check
  CHECK (stage IN ('classify', 'extract', 'synthesize', 'knowledge', 'notes', 'review'));
