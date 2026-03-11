import type { PoolClient } from "pg";
import type { UserProfile } from "@re-sourcing/contracts";
import { mapUserProfile } from "../map.js";

export interface UserProfileRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface UpsertUserProfileParams {
  name?: string | null;
  email?: string | null;
  organization?: string | null;
  defaultPurchaseClosingCostPct?: number | null;
  defaultLtv?: number | null;
  defaultInterestRate?: number | null;
  defaultAmortization?: number | null;
  defaultHoldPeriodYears?: number | null;
  defaultExitCap?: number | null;
  defaultExitClosingCostPct?: number | null;
  defaultRentUplift?: number | null;
  defaultExpenseIncrease?: number | null;
  defaultManagementFee?: number | null;
  defaultTargetIrrPct?: number | null;
  defaultVacancyPct?: number | null;
  defaultLeadTimeMonths?: number | null;
  defaultAnnualRentGrowthPct?: number | null;
  defaultAnnualOtherIncomeGrowthPct?: number | null;
  defaultAnnualExpenseGrowthPct?: number | null;
  defaultAnnualPropertyTaxGrowthPct?: number | null;
  defaultRecurringCapexAnnual?: number | null;
  defaultLoanFeePct?: number | null;
}

export class UserProfileRepo {
  constructor(private options: UserProfileRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  /** Get the first (and typically only) user profile. Returns null if none. */
  async getDefault(): Promise<UserProfile | null> {
    const r = await this.client.query("SELECT * FROM user_profile ORDER BY created_at ASC LIMIT 1");
    return r.rows[0] ? mapUserProfile(r.rows[0]) : null;
  }

  /** Create a default profile row if none exists. Returns the profile id. */
  async ensureDefault(): Promise<string> {
    const existing = await this.getDefault();
    if (existing) return existing.id;
    const r = await this.client.query(
      `INSERT INTO user_profile (
         name,
         email,
         organization,
         default_purchase_closing_cost_pct,
         default_ltv,
         default_interest_rate,
         default_amortization,
         default_hold_period_years,
         default_exit_cap,
         default_exit_closing_cost_pct,
         default_rent_uplift,
         default_expense_increase,
         default_management_fee,
         default_target_irr_pct,
         default_vacancy_pct,
         default_lead_time_months,
         default_annual_rent_growth_pct,
         default_annual_other_income_growth_pct,
         default_annual_expense_growth_pct,
         default_annual_property_tax_growth_pct,
         default_recurring_capex_annual,
         default_loan_fee_pct
       ) VALUES (
         '', '', '',
         3,
         64,
         6,
         30,
         2,
         5,
         6,
         76.3,
         0,
         8,
         25,
         15,
         2,
         1,
         0,
         0,
         6,
         1200,
         0.63
       ) RETURNING id`
    );
    return r.rows[0].id as string;
  }

  async byId(id: string): Promise<UserProfile | null> {
    const r = await this.client.query("SELECT * FROM user_profile WHERE id = $1", [id]);
    return r.rows[0] ? mapUserProfile(r.rows[0]) : null;
  }

  async update(id: string, params: UpsertUserProfileParams): Promise<UserProfile> {
    await this.client.query(
      `UPDATE user_profile SET
        name = COALESCE($2, name),
        email = COALESCE($3, email),
        organization = COALESCE($4, organization),
        default_purchase_closing_cost_pct = COALESCE($5, default_purchase_closing_cost_pct),
        default_ltv = COALESCE($6, default_ltv),
        default_interest_rate = COALESCE($7, default_interest_rate),
        default_amortization = COALESCE($8, default_amortization),
        default_hold_period_years = COALESCE($9, default_hold_period_years),
        default_exit_cap = COALESCE($10, default_exit_cap),
        default_exit_closing_cost_pct = COALESCE($11, default_exit_closing_cost_pct),
        default_rent_uplift = COALESCE($12, default_rent_uplift),
        default_expense_increase = COALESCE($13, default_expense_increase),
        default_management_fee = COALESCE($14, default_management_fee),
        default_target_irr_pct = COALESCE($15, default_target_irr_pct),
        default_vacancy_pct = COALESCE($16, default_vacancy_pct),
        default_lead_time_months = COALESCE($17, default_lead_time_months),
        default_annual_rent_growth_pct = COALESCE($18, default_annual_rent_growth_pct),
        default_annual_other_income_growth_pct = COALESCE($19, default_annual_other_income_growth_pct),
        default_annual_expense_growth_pct = COALESCE($20, default_annual_expense_growth_pct),
        default_annual_property_tax_growth_pct = COALESCE($21, default_annual_property_tax_growth_pct),
        default_recurring_capex_annual = COALESCE($22, default_recurring_capex_annual),
        default_loan_fee_pct = COALESCE($23, default_loan_fee_pct),
        updated_at = now()
       WHERE id = $1`,
      [
        id,
        params.name ?? null,
        params.email ?? null,
        params.organization ?? null,
        params.defaultPurchaseClosingCostPct ?? null,
        params.defaultLtv ?? null,
        params.defaultInterestRate ?? null,
        params.defaultAmortization ?? null,
        params.defaultHoldPeriodYears ?? null,
        params.defaultExitCap ?? null,
        params.defaultExitClosingCostPct ?? null,
        params.defaultRentUplift ?? null,
        params.defaultExpenseIncrease ?? null,
        params.defaultManagementFee ?? null,
        params.defaultTargetIrrPct ?? null,
        params.defaultVacancyPct ?? null,
        params.defaultLeadTimeMonths ?? null,
        params.defaultAnnualRentGrowthPct ?? null,
        params.defaultAnnualOtherIncomeGrowthPct ?? null,
        params.defaultAnnualExpenseGrowthPct ?? null,
        params.defaultAnnualPropertyTaxGrowthPct ?? null,
        params.defaultRecurringCapexAnnual ?? null,
        params.defaultLoanFeePct ?? null,
      ]
    );
    const updated = await this.byId(id);
    if (!updated) throw new Error("UserProfile update failed");
    return updated;
  }
}
