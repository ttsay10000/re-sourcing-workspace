-- Backfill null underwriting defaults using the 3 E 9th reference model assumptions.
-- Do not overwrite any user-saved preferences.

UPDATE user_profile
SET
  default_purchase_closing_cost_pct = COALESCE(default_purchase_closing_cost_pct, 3),
  default_ltv = COALESCE(default_ltv, 64),
  default_interest_rate = COALESCE(default_interest_rate, 6),
  default_amortization = COALESCE(default_amortization, 30),
  default_hold_period_years = COALESCE(default_hold_period_years, 2),
  default_exit_cap = COALESCE(default_exit_cap, 5),
  default_exit_closing_cost_pct = COALESCE(default_exit_closing_cost_pct, 6),
  default_rent_uplift = COALESCE(default_rent_uplift, 76.3),
  default_expense_increase = COALESCE(default_expense_increase, 0),
  default_management_fee = COALESCE(default_management_fee, 8),
  default_target_irr_pct = COALESCE(default_target_irr_pct, 25),
  default_vacancy_pct = COALESCE(default_vacancy_pct, 15),
  default_lead_time_months = COALESCE(default_lead_time_months, 2),
  default_annual_rent_growth_pct = COALESCE(default_annual_rent_growth_pct, 1),
  default_annual_other_income_growth_pct = COALESCE(default_annual_other_income_growth_pct, 0),
  default_annual_expense_growth_pct = COALESCE(default_annual_expense_growth_pct, 0),
  default_annual_property_tax_growth_pct = COALESCE(default_annual_property_tax_growth_pct, 6),
  default_recurring_capex_annual = COALESCE(default_recurring_capex_annual, 1200),
  default_loan_fee_pct = COALESCE(default_loan_fee_pct, 0.63),
  updated_at = now()
WHERE
  default_purchase_closing_cost_pct IS NULL OR
  default_ltv IS NULL OR
  default_interest_rate IS NULL OR
  default_amortization IS NULL OR
  default_hold_period_years IS NULL OR
  default_exit_cap IS NULL OR
  default_exit_closing_cost_pct IS NULL OR
  default_rent_uplift IS NULL OR
  default_expense_increase IS NULL OR
  default_management_fee IS NULL OR
  default_target_irr_pct IS NULL OR
  default_vacancy_pct IS NULL OR
  default_lead_time_months IS NULL OR
  default_annual_rent_growth_pct IS NULL OR
  default_annual_other_income_growth_pct IS NULL OR
  default_annual_expense_growth_pct IS NULL OR
  default_annual_property_tax_growth_pct IS NULL OR
  default_recurring_capex_annual IS NULL OR
  default_loan_fee_pct IS NULL;
