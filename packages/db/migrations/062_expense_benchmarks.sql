-- Expense benchmark brackets for underwriting validation. Each row defines a
-- screening band (low/typical/high) for one expense metric in one geography /
-- building-size bracket. The OM flag engine compares extracted expense lines
-- against the most specific matching row ('all' rows are fallbacks).

CREATE TABLE IF NOT EXISTS expense_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                                -- e.g. 'nyc_rgb_ie_screening_2024', 'agency_minimums', 'manual'
  source_year INTEGER,
  geography TEXT NOT NULL DEFAULT 'nyc',               -- 'nyc' | 'manhattan' | 'brooklyn' | 'queens' | 'bronx' | 'staten_island'
  building_size_bracket TEXT NOT NULL DEFAULT 'all',   -- 'all' | '1_10' | '11_19' | '20_99' | '100_plus'
  building_era TEXT NOT NULL DEFAULT 'all',            -- 'all' | 'pre_war' | 'post_war'
  metric TEXT NOT NULL,                                -- 'taxes' | 'insurance' | 'utilities' | 'repairs_maintenance' | 'payroll' | 'mgmt_admin' | 'total_opex' | 'reserves'
  unit_basis TEXT NOT NULL,                            -- 'per_unit_year' | 'per_unit_month' | 'pct_egi' | 'expense_ratio'
  low_value NUMERIC,                                   -- below this => suspiciously lean (likely understated)
  typical_value NUMERIC,                               -- midpoint used in flag messaging
  high_value NUMERIC,                                  -- above this => heavy load (verify one-time items / risk)
  severity_low TEXT NOT NULL DEFAULT 'warning',
  severity_high TEXT NOT NULL DEFAULT 'info',
  notes TEXT,
  effective_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, geography, building_size_bracket, building_era, metric, unit_basis)
);

CREATE INDEX IF NOT EXISTS idx_expense_benchmarks_lookup
  ON expense_benchmarks (metric, geography, building_size_bracket, building_era);
