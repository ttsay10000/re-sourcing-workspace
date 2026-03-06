-- Single user profile (name, email, organization) and assumption defaults for dossier/underwriting.

CREATE TABLE user_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT,
  organization TEXT,
  default_ltv NUMERIC,
  default_interest_rate NUMERIC,
  default_amortization INTEGER,
  default_exit_cap NUMERIC,
  default_rent_uplift NUMERIC,
  default_expense_increase NUMERIC,
  default_management_fee NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_profile IS 'Single global user profile and dossier/underwriting assumption defaults.';
