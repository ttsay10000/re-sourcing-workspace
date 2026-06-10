-- Seed screening bands for NYC multifamily expense validation.
--
-- 'nyc_rgb_ie_screening_2024' rows are rounded screening BANDS derived from
-- the NYC Rent Guidelines Board annual Income & Expense Study (2024 study,
-- 2022/2023 filing years) plus current market color for fast-moving lines
-- (insurance). They are deliberately wide: the goal is to catch OMs that
-- understate a line (below low_value) or carry an unusually heavy load
-- (above high_value), not to predict the exact figure. Refresh annually from
-- the latest RGB study (https://rentguidelinesboard.cityofnewyork.us) by
-- updating these rows or inserting a newer source.
--
-- 'agency_minimums' rows encode Fannie/Freddie underwriting conventions and
-- change rarely.

INSERT INTO expense_benchmarks
  (source, source_year, geography, building_size_bracket, building_era, metric, unit_basis, low_value, typical_value, high_value, severity_low, severity_high, notes, effective_date)
VALUES
  -- Per-unit-per-YEAR screening bands, citywide.
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', 'all', 'all', 'taxes', 'per_unit_year', 2400, 4800, 9600,
   'warning', 'info',
   'RGB I&E: taxes are the largest opex line (~$320-420/unit/mo citywide for stabilized stock). Below $200/unit/mo usually means an abatement, a cap, or a stale figure — verify against the DOF bill.', '2024-06-01'),
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', 'all', 'all', 'insurance', 'per_unit_year', 600, 1500, 3000,
   'warning', 'info',
   'NYC multifamily insurance has compounded hard since 2021; sub-$600/unit/yr is almost always an old policy or an understatement. Verify renewals.', '2024-06-01'),
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', 'all', 'all', 'utilities', 'per_unit_year', 500, 1900, 4200,
   'warning', 'info',
   'Owner-paid fuel + utilities (RGB: fuel ~$95/unit/mo + utilities ~$110/unit/mo for master-metered). Low figures are fine ONLY if tenants truly pay heat/hot water — confirm metering.', '2024-06-01'),
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', 'all', 'all', 'repairs_maintenance', 'per_unit_year', 800, 2700, 5400,
   'warning', 'info',
   'RGB maintenance ~$225/unit/mo citywide. OMs below ~$67/unit/mo are deferring or hiding R&M.', '2024-06-01'),
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', '20_99', 'all', 'payroll', 'per_unit_year', 900, 2400, 6000,
   'warning', 'info',
   'Buildings of 20+ units generally need super/porter coverage (RGB labor ~$135-200/unit/mo at scale). No payroll line on a 20+ unit building means the expense lives somewhere else — or nowhere.', '2024-06-01'),
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', '100_plus', 'all', 'payroll', 'per_unit_year', 1500, 3200, 7200,
   'warning', 'info',
   'Large elevator buildings carry full staff; understated payroll is a classic OM lever.', '2024-06-01'),
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', 'all', 'all', 'total_opex', 'per_unit_year', 7200, 13500, 24000,
   'warning', 'info',
   'RGB citywide O&M averages ~$1,125/unit/mo (2024 study). Below $600/unit/mo is rarely a real operating picture for stabilized NYC stock.', '2024-06-01'),
  -- Percent-of-EGI bands.
  ('nyc_rgb_ie_screening_2024', 2024, 'nyc', 'all', 'all', 'mgmt_admin', 'pct_egi', 3, 5, 9,
   'warning', 'info',
   'Management + admin typically 4-6% of EGI for third-party managed multifamily; OMs often omit it entirely when owner-managed.', '2024-06-01'),
  -- Agency conventions (numeric source of truth for the deal-level flags).
  ('agency_minimums', 2025, 'nyc', 'all', 'all', 'reserves', 'per_unit_year', 250, 250, NULL,
   'info', 'info',
   'Fannie/Freddie replacement-reserve convention: $250/unit/yr minimum.', '2025-01-01'),
  ('agency_minimums', 2025, 'nyc', 'all', 'all', 'total_opex', 'expense_ratio', 28, 40, 65,
   'warning', 'info',
   'Expense ratio (opex / EGI) under ~28% is rarely credible for NYC multifamily; over ~65% suggests one-time items or a mixed-use cost structure.', '2025-01-01')
ON CONFLICT (source, geography, building_size_bracket, building_era, metric, unit_basis) DO NOTHING;
