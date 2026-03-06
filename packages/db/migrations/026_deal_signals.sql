-- Deal signal layer: one row per property per generation (price metrics, cap rates, scores).

CREATE TABLE deal_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  price_per_unit NUMERIC,
  price_psf NUMERIC,
  asset_cap_rate NUMERIC,
  adjusted_cap_rate NUMERIC,
  yield_spread NUMERIC,
  rent_upside NUMERIC,
  rent_psf_ratio NUMERIC,
  expense_ratio NUMERIC,
  liquidity_score NUMERIC,
  risk_score NUMERIC,
  price_momentum NUMERIC,
  deal_score NUMERIC,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_signals_property_id ON deal_signals(property_id);
CREATE INDEX idx_deal_signals_generated_at ON deal_signals(property_id, generated_at DESC);

COMMENT ON TABLE deal_signals IS 'Deal signal layer: price metrics, cap rates, and deal score per property per generation.';
