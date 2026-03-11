-- Additional dossier defaults for yearly cash flow, vacancy, and financing fees.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS default_vacancy_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS default_lead_time_months INTEGER,
  ADD COLUMN IF NOT EXISTS default_annual_rent_growth_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS default_annual_other_income_growth_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS default_annual_expense_growth_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS default_annual_property_tax_growth_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS default_recurring_capex_annual NUMERIC,
  ADD COLUMN IF NOT EXISTS default_loan_fee_pct NUMERIC;

COMMENT ON COLUMN user_profile.default_vacancy_pct IS 'Default annual vacancy and credit loss assumption as % of gross rental income.';
COMMENT ON COLUMN user_profile.default_lead_time_months IS 'Default lease-up / downtime deduction applied in year 1, in months of gross rental income.';
COMMENT ON COLUMN user_profile.default_annual_rent_growth_pct IS 'Default annual rent growth assumption after stabilization.';
COMMENT ON COLUMN user_profile.default_annual_other_income_growth_pct IS 'Default annual other-income growth assumption.';
COMMENT ON COLUMN user_profile.default_annual_expense_growth_pct IS 'Default annual growth assumption for non-tax operating expenses.';
COMMENT ON COLUMN user_profile.default_annual_property_tax_growth_pct IS 'Default annual growth assumption for property taxes.';
COMMENT ON COLUMN user_profile.default_recurring_capex_annual IS 'Default recurring annual capital reserve / furnishing refresh amount.';
COMMENT ON COLUMN user_profile.default_loan_fee_pct IS 'Default financing fee / points assumption as % of funded debt.';
