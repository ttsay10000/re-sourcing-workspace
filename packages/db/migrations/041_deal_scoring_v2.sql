-- Deal scoring v2: richer signal storage and manual score overrides.

ALTER TABLE deal_signals
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS risk_profile JSONB,
  ADD COLUMN IF NOT EXISTS risk_flags TEXT[],
  ADD COLUMN IF NOT EXISTS cap_reasons TEXT[],
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC,
  ADD COLUMN IF NOT EXISTS score_sensitivity JSONB,
  ADD COLUMN IF NOT EXISTS score_version TEXT;

COMMENT ON COLUMN deal_signals.deal_score IS 'Raw deterministic calculated score before any manual override.';
COMMENT ON COLUMN deal_signals.score_breakdown IS 'Deterministic deal scoring v2 breakdown.';
COMMENT ON COLUMN deal_signals.risk_profile IS 'Derived risk-profile signals used by the scorer.';
COMMENT ON COLUMN deal_signals.risk_flags IS 'Human-readable triggered risk and data-quality flags.';
COMMENT ON COLUMN deal_signals.cap_reasons IS 'Triggered hard-cap reasons applied to the raw score.';
COMMENT ON COLUMN deal_signals.confidence_score IS 'Deterministic confidence score from 0 to 1.';
COMMENT ON COLUMN deal_signals.score_sensitivity IS 'Deterministic downside score sensitivity scenarios.';
COMMENT ON COLUMN deal_signals.score_version IS 'Version tag for the scoring logic used to generate this row.';

CREATE TABLE IF NOT EXISTS deal_score_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL CHECK (score >= 0 AND score <= 100),
  reason TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_score_overrides_active_property
  ON deal_score_overrides(property_id)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deal_score_overrides_property_created_at
  ON deal_score_overrides(property_id, created_at DESC);

COMMENT ON TABLE deal_score_overrides IS 'Manual override decisions for display/final investment-committee score.';
