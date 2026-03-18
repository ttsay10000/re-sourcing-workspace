import type { PropertyDetails, UserProfile } from "@re-sourcing/contracts";
import {
  computeMortgage,
  computeAmortizationSchedule,
  type AmortizationYearRow,
} from "./mortgageAmortization.js";
import { computeIrr, type IrrResult } from "./irrCalculation.js";
import {
  analyzePropertyForUnderwriting,
  computeBlendedRentUpliftPct,
  type UnderwritingPropertyMixSummary,
} from "./propertyAssumptions.js";

export { computeBlendedRentUpliftPct };

export const DEFAULT_HOLD_PERIOD_YEARS = 2;
export const MAX_UNDERWRITING_HOLD_PERIOD_YEARS = 10;
export const DEFAULT_PURCHASE_CLOSING_COST_PCT = 3;
export const DEFAULT_LTV_PCT = 64;
export const DEFAULT_INTEREST_RATE_PCT = 6;
export const DEFAULT_AMORTIZATION_YEARS = 30;
export const DEFAULT_RENT_UPLIFT_PCT = 76.3;
export const DEFAULT_EXPENSE_INCREASE_PCT = 0;
export const DEFAULT_MANAGEMENT_FEE_PCT = 8;
export const DEFAULT_EXIT_CAP_PCT = 5;
export const DEFAULT_EXIT_CLOSING_COST_PCT = 6;
export const DEFAULT_TARGET_IRR_PCT = 25;
export const DEFAULT_VACANCY_PCT = 15;
export const DEFAULT_LEAD_TIME_MONTHS = 2;
export const DEFAULT_ANNUAL_RENT_GROWTH_PCT = 1;
export const DEFAULT_ANNUAL_OTHER_INCOME_GROWTH_PCT = 0;
export const DEFAULT_ANNUAL_EXPENSE_GROWTH_PCT = 0;
export const DEFAULT_ANNUAL_PROPERTY_TAX_GROWTH_PCT = 6;
export const DEFAULT_RECURRING_CAPEX_ANNUAL = 1_200;
export const DEFAULT_LOAN_FEE_PCT = 0.63;
const NYC_CLASS_ONE_UNDERWRITING_TAX_GROWTH_PCT = 3;
const NYC_SMALL_CLASS_TWO_UNDERWRITING_TAX_GROWTH_PCT = 3;
const NYC_LARGE_CLASS_TWO_UNDERWRITING_TAX_GROWTH_PCT = 4;
const NYC_CLASS_FOUR_UNDERWRITING_TAX_GROWTH_PCT = 4;

export interface DossierAssumptionOverrides {
  purchasePrice?: number | null;
  purchaseClosingCostPct?: number | null;
  renovationCosts?: number | null;
  furnishingSetupCosts?: number | null;
  ltvPct?: number | null;
  interestRatePct?: number | null;
  amortizationYears?: number | null;
  loanFeePct?: number | null;
  rentUpliftPct?: number | null;
  expenseIncreasePct?: number | null;
  managementFeePct?: number | null;
  vacancyPct?: number | null;
  leadTimeMonths?: number | null;
  annualRentGrowthPct?: number | null;
  annualOtherIncomeGrowthPct?: number | null;
  annualExpenseGrowthPct?: number | null;
  annualPropertyTaxGrowthPct?: number | null;
  recurringCapexAnnual?: number | null;
  holdPeriodYears?: number | null;
  exitCapPct?: number | null;
  exitClosingCostPct?: number | null;
  targetIrrPct?: number | null;
}

export interface DossierPropertyContext {
  details?: PropertyDetails | null;
}

export interface ProjectedExpenseInputRow {
  lineItem: string;
  amount: number;
}

export interface ResolvedDossierAssumptions {
  acquisition: {
    purchasePrice: number | null;
    purchaseClosingCostPct: number;
    renovationCosts: number;
    furnishingSetupCosts: number;
  };
  financing: {
    ltvPct: number;
    interestRatePct: number;
    amortizationYears: number;
    loanFeePct: number;
  };
  operating: {
    rentUpliftPct: number;
    blendedRentUpliftPct: number;
    expenseIncreasePct: number;
    managementFeePct: number;
    vacancyPct: number;
    leadTimeMonths: number;
    annualRentGrowthPct: number;
    annualOtherIncomeGrowthPct: number;
    annualExpenseGrowthPct: number;
    annualPropertyTaxGrowthPct: number;
    recurringCapexAnnual: number;
  };
  holdPeriodYears: number;
  exit: {
    exitCapPct: number;
    exitClosingCostPct: number;
  };
  targetIrrPct: number;
  propertyMix: UnderwritingPropertyMixSummary;
}

export interface UnderwritingProjectionExpenseLine {
  lineItem: string;
  annualGrowthPct: number;
  baseAmount: number;
  yearlyAmounts: number[];
}

export interface UnderwritingProjectionYearly {
  years: number[];
  endingLabels: string[];
  propertyValue: number[];
  grossRentalIncome: number[];
  otherIncome: number[];
  vacancyLoss: number[];
  leadTimeLoss: number[];
  netRentalIncome: number[];
  managementFee: number[];
  expenseLineItems: UnderwritingProjectionExpenseLine[];
  totalOperatingExpenses: number[];
  noi: number[];
  recurringCapex: number[];
  cashFlowFromOperations: number[];
  capRateOnPurchase: Array<number | null>;
  debtService: number[];
  principalPaid: number[];
  interestPaid: number[];
  cashFlowAfterFinancing: number[];
  totalInvestmentCost: number[];
  financingFunding: number[];
  financingFees: number[];
  saleValue: number[];
  saleClosingCosts: number[];
  remainingLoanBalance: number[];
  financingPayoff: number[];
  netSaleProceedsBeforeDebtPayoff: number[];
  netSaleProceedsToEquity: number[];
  unleveredCashFlow: number[];
  leveredCashFlow: number[];
}

export interface UnderwritingProjection {
  assumptions: ResolvedDossierAssumptions;
  acquisition: {
    purchaseClosingCosts: number;
    financingFees: number;
    totalProjectCost: number;
    loanAmount: number;
    equityRequiredForPurchase: number;
    initialEquityInvested: number;
    year0CashFlow: number;
  };
  financing: {
    loanAmount: number;
    financingFees: number;
    equityRequiredForPurchase: number;
    monthlyPayment: number;
    annualDebtService: number;
    remainingLoanBalanceAtExit: number;
    principalPaydownAtExit: number;
    amortizationSchedule: AmortizationYearRow[];
  };
  operating: {
    currentExpenses: number;
    currentOtherIncome: number;
    adjustedGrossRent: number;
    adjustedOperatingExpenses: number;
    managementFeeAmount: number;
    stabilizedNoi: number;
  };
  exit: {
    exitPropertyValue: number;
    saleClosingCosts: number;
    netSaleProceedsBeforeDebtPayoff: number;
    remainingLoanBalance: number;
    principalPaydownToDate: number;
    netProceedsToEquity: number;
  };
  yearly: UnderwritingProjectionYearly;
  cashFlows: {
    annualOperatingCashFlow: number;
    annualOperatingCashFlows: number[];
    annualPrincipalPaydown: number;
    annualPrincipalPaydowns: number[];
    annualEquityGain: number;
    annualEquityGains: number[];
    annualUnleveredCashFlows: number[];
    finalYearCashFlow: number;
    unleveredCashFlowSeries: number[];
    equityCashFlowSeries: number[];
  };
  returns: IrrResult & {
    year1EquityYield: number | null;
    averageEquityYield: number | null;
  };
}

export interface RecommendedOfferAnalysis {
  askingPrice: number | null;
  targetIrrPct: number;
  irrAtAskingPct: number | null;
  recommendedOfferLow: number | null;
  recommendedOfferHigh: number | null;
  discountToAskingPct: number | null;
  targetMetAtAsking: boolean;
}

export interface UnderwritingProjectionInput {
  assumptions: ResolvedDossierAssumptions;
  currentGrossRent: number | null;
  currentNoi: number | null;
  currentOtherIncome?: number | null;
  currentExpensesTotal?: number | null;
  expenseRows?: ProjectedExpenseInputRow[] | null;
  conservativeProjectedLeaseUpRent?: number | null;
}

function safeNumber(value: number | null | undefined, fallback = 0): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

export function resolveAssetCapRateNoiBasis(input: {
  currentNoi: number | null;
  conservativeProjectedLeaseUpRent?: number | null;
}): number | null {
  const currentNoi =
    input.currentNoi != null && Number.isFinite(input.currentNoi) ? input.currentNoi : null;
  if (currentNoi == null) return null;
  return roundCurrency(currentNoi + Math.max(0, safeNumber(input.conservativeProjectedLeaseUpRent)));
}

function safePositiveInteger(
  value: number | null | undefined,
  fallback: number,
  max?: number
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded <= 0) return fallback;
  if (max != null && Number.isFinite(max)) return Math.min(rounded, max);
  return rounded;
}

function safeNonNegativeInteger(
  value: number | null | undefined,
  fallback: number,
  max?: number
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 0) return fallback;
  if (max != null && Number.isFinite(max)) return Math.min(rounded, max);
  return rounded;
}

function safeBoundedNumber(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const resolved = safeNumber(value, fallback);
  return Math.min(max, Math.max(min, resolved));
}

function pickNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampUnitShare(value: number | null | undefined, fallback = 1): number {
  const resolved = value != null && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, resolved));
}

function normalizeTaxCode(taxCode: string | null | undefined): string | null {
  if (taxCode == null) return null;
  const normalized = String(taxCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length > 0 ? normalized : null;
}

export function defaultAnnualPropertyTaxGrowthPctFromNycTaxCode(
  taxCode: string | null | undefined
): number | null {
  const normalized = normalizeTaxCode(taxCode);
  if (!normalized) return null;
  if (normalized.startsWith("1")) return NYC_CLASS_ONE_UNDERWRITING_TAX_GROWTH_PCT;
  if (normalized.startsWith("2A") || normalized.startsWith("2B") || normalized.startsWith("2C")) {
    return NYC_SMALL_CLASS_TWO_UNDERWRITING_TAX_GROWTH_PCT;
  }
  if (normalized.startsWith("2")) return NYC_LARGE_CLASS_TWO_UNDERWRITING_TAX_GROWTH_PCT;
  if (normalized.startsWith("4")) return NYC_CLASS_FOUR_UNDERWRITING_TAX_GROWTH_PCT;
  return null;
}

function compoundAnnual(base: number, growthPct: number, yearsElapsed: number): number {
  if (!Number.isFinite(base) || base === 0) return 0;
  if (!Number.isFinite(growthPct) || yearsElapsed <= 0) return base;
  return base * Math.pow(1 + growthPct / 100, yearsElapsed);
}

export function isManagementFeeExpenseLine(lineItem: string): boolean {
  return /\b(management|mgmt)\b/i.test(lineItem);
}

export function normalizeExpenseProjectionInputs<T extends { lineItem: string; amount: number }>(input: {
  currentExpensesTotal: number;
  expenseRows?: T[] | null;
}): {
  currentExpensesTotalExManagement: number;
  expenseRowsExManagement: T[];
  removedManagementFeeAmount: number;
} {
  const detailedRows = Array.isArray(input.expenseRows)
    ? input.expenseRows.filter(
        (row): row is T =>
          !!row &&
          typeof row.lineItem === "string" &&
          row.lineItem.trim().length > 0 &&
          typeof row.amount === "number" &&
          Number.isFinite(row.amount) &&
          row.amount >= 0
      )
    : [];
  const removedManagementFeeAmount = detailedRows.reduce(
    (sum, row) => sum + (isManagementFeeExpenseLine(row.lineItem) ? row.amount : 0),
    0
  );
  const expenseRowsExManagement = detailedRows.filter(
    (row) => !isManagementFeeExpenseLine(row.lineItem)
  );
  return {
    currentExpensesTotalExManagement: Math.max(0, input.currentExpensesTotal - removedManagementFeeAmount),
    expenseRowsExManagement,
    removedManagementFeeAmount: roundCurrency(removedManagementFeeAmount),
  };
}

function expenseGrowthPctForLine(
  lineItem: string,
  assumptions: ResolvedDossierAssumptions,
  options?: { aggregateFallback?: boolean }
): number {
  if (options?.aggregateFallback) {
    return Math.max(
      assumptions.operating.annualExpenseGrowthPct,
      assumptions.operating.annualPropertyTaxGrowthPct
    );
  }
  return /tax/i.test(lineItem)
    ? assumptions.operating.annualPropertyTaxGrowthPct
    : assumptions.operating.annualExpenseGrowthPct;
}

function projectExpenseLines(input: {
  assumptions: ResolvedDossierAssumptions;
  currentExpensesTotal: number;
  expenseRows?: ProjectedExpenseInputRow[] | null;
}): UnderwritingProjectionExpenseLine[] {
  const { assumptions, currentExpensesTotal, expenseRows } = input;
  const detailedRows =
    Array.isArray(expenseRows) && expenseRows.length > 0
      ? expenseRows
          .filter(
            (row): row is ProjectedExpenseInputRow =>
              !!row &&
              typeof row.lineItem === "string" &&
              row.lineItem.trim().length > 0 &&
              typeof row.amount === "number" &&
              Number.isFinite(row.amount) &&
              row.amount >= 0
          )
          .map((row) => ({
            lineItem: row.lineItem.trim(),
            amount: row.amount,
          }))
      : [];
  const aggregateFallback = detailedRows.length === 0;
  const normalizedRows = aggregateFallback
    ? [{ lineItem: "Operating expenses", amount: currentExpensesTotal }]
    : detailedRows;

  const totalFromRows = normalizedRows.reduce((sum, row) => sum + row.amount, 0);
  const scale =
    totalFromRows > 0 && currentExpensesTotal > 0
      ? currentExpensesTotal / totalFromRows
      : 1;
  const increaseFactor = 1 + assumptions.operating.expenseIncreasePct / 100;

  return normalizedRows.map((row) => {
    const annualGrowthPct = expenseGrowthPctForLine(row.lineItem, assumptions, {
      aggregateFallback,
    });
    const baseAmount = row.amount * scale * increaseFactor;
    const yearlyAmounts = Array.from({ length: assumptions.holdPeriodYears }, (_, index) =>
      roundCurrency(compoundAnnual(baseAmount, annualGrowthPct, index))
    );
    return {
      lineItem: row.lineItem,
      annualGrowthPct,
      baseAmount: roundCurrency(baseAmount),
      yearlyAmounts,
    };
  });
}

export function resolveDossierAssumptions(
  profile: UserProfile | null,
  purchasePrice: number | null,
  overrides?: DossierAssumptionOverrides | null,
  propertyContext?: DossierPropertyContext | null
): ResolvedDossierAssumptions {
  const rentUpliftPct = safeNumber(
    pickNumber(overrides?.rentUpliftPct, profile?.defaultRentUplift),
    DEFAULT_RENT_UPLIFT_PCT
  );
  const propertyMix = analyzePropertyForUnderwriting(propertyContext?.details ?? null);
  const autoAnnualPropertyTaxGrowthPct = defaultAnnualPropertyTaxGrowthPctFromNycTaxCode(
    propertyContext?.details?.taxCode
  );

  return {
    acquisition: {
      purchasePrice: pickNumber(overrides?.purchasePrice, purchasePrice),
      purchaseClosingCostPct: safeNumber(
        pickNumber(overrides?.purchaseClosingCostPct, profile?.defaultPurchaseClosingCostPct),
        DEFAULT_PURCHASE_CLOSING_COST_PCT
      ),
      renovationCosts: safeNumber(overrides?.renovationCosts, 0),
      furnishingSetupCosts: safeNumber(
        overrides?.furnishingSetupCosts,
        propertyMix.furnishingSetupCostEstimate
      ),
    },
    financing: {
      ltvPct: safeNumber(pickNumber(overrides?.ltvPct, profile?.defaultLtv), DEFAULT_LTV_PCT),
      interestRatePct: safeNumber(
        pickNumber(overrides?.interestRatePct, profile?.defaultInterestRate),
        DEFAULT_INTEREST_RATE_PCT
      ),
      amortizationYears: safePositiveInteger(
        pickNumber(overrides?.amortizationYears, profile?.defaultAmortization),
        DEFAULT_AMORTIZATION_YEARS
      ),
      loanFeePct: safeBoundedNumber(
        pickNumber(overrides?.loanFeePct, profile?.defaultLoanFeePct),
        DEFAULT_LOAN_FEE_PCT,
        0,
        100
      ),
    },
    operating: {
      rentUpliftPct,
      blendedRentUpliftPct: computeBlendedRentUpliftPct(rentUpliftPct, propertyMix),
      expenseIncreasePct: safeNumber(
        pickNumber(overrides?.expenseIncreasePct, profile?.defaultExpenseIncrease),
        DEFAULT_EXPENSE_INCREASE_PCT
      ),
      managementFeePct: safeNumber(
        pickNumber(overrides?.managementFeePct, profile?.defaultManagementFee),
        DEFAULT_MANAGEMENT_FEE_PCT
      ),
      vacancyPct: safeBoundedNumber(
        pickNumber(overrides?.vacancyPct, profile?.defaultVacancyPct),
        DEFAULT_VACANCY_PCT,
        0,
        100
      ),
      leadTimeMonths: Math.min(
        12,
        Math.max(
          0,
          safeNonNegativeInteger(
            pickNumber(overrides?.leadTimeMonths, profile?.defaultLeadTimeMonths),
            DEFAULT_LEAD_TIME_MONTHS,
            12
          )
        )
      ),
      annualRentGrowthPct: safeNumber(
        pickNumber(overrides?.annualRentGrowthPct, profile?.defaultAnnualRentGrowthPct),
        DEFAULT_ANNUAL_RENT_GROWTH_PCT
      ),
      annualOtherIncomeGrowthPct: safeNumber(
        pickNumber(
          overrides?.annualOtherIncomeGrowthPct,
          profile?.defaultAnnualOtherIncomeGrowthPct
        ),
        DEFAULT_ANNUAL_OTHER_INCOME_GROWTH_PCT
      ),
      annualExpenseGrowthPct: safeNumber(
        pickNumber(overrides?.annualExpenseGrowthPct, profile?.defaultAnnualExpenseGrowthPct),
        DEFAULT_ANNUAL_EXPENSE_GROWTH_PCT
      ),
      annualPropertyTaxGrowthPct: safeNumber(
        pickNumber(
          overrides?.annualPropertyTaxGrowthPct,
          autoAnnualPropertyTaxGrowthPct,
          profile?.defaultAnnualPropertyTaxGrowthPct
        ),
        DEFAULT_ANNUAL_PROPERTY_TAX_GROWTH_PCT
      ),
      recurringCapexAnnual: safeNumber(
        pickNumber(overrides?.recurringCapexAnnual, profile?.defaultRecurringCapexAnnual),
        DEFAULT_RECURRING_CAPEX_ANNUAL
      ),
    },
    holdPeriodYears: safePositiveInteger(
      pickNumber(overrides?.holdPeriodYears, profile?.defaultHoldPeriodYears),
      DEFAULT_HOLD_PERIOD_YEARS,
      MAX_UNDERWRITING_HOLD_PERIOD_YEARS
    ),
    exit: {
      exitCapPct: safeNumber(
        pickNumber(overrides?.exitCapPct, profile?.defaultExitCap),
        DEFAULT_EXIT_CAP_PCT
      ),
      exitClosingCostPct: safeNumber(
        pickNumber(overrides?.exitClosingCostPct, profile?.defaultExitClosingCostPct),
        DEFAULT_EXIT_CLOSING_COST_PCT
      ),
    },
    targetIrrPct: safeNumber(
      pickNumber(overrides?.targetIrrPct, profile?.defaultTargetIrrPct),
      DEFAULT_TARGET_IRR_PCT
    ),
    propertyMix,
  };
}

export function computeUnderwritingProjection(
  input: UnderwritingProjectionInput
): UnderwritingProjection {
  const {
    assumptions,
    currentGrossRent,
    currentNoi,
    currentOtherIncome,
    currentExpensesTotal,
    expenseRows,
    conservativeProjectedLeaseUpRent,
  } = input;
  const purchasePrice = assumptions.acquisition.purchasePrice ?? 0;
  const purchaseClosingCosts =
    purchasePrice * (Math.max(0, assumptions.acquisition.purchaseClosingCostPct) / 100);
  const totalProjectCost =
    purchasePrice +
    purchaseClosingCosts +
    Math.max(0, assumptions.acquisition.renovationCosts) +
    Math.max(0, assumptions.acquisition.furnishingSetupCosts);
  const loanAmount =
    purchasePrice > 0
      ? purchasePrice * (Math.max(0, assumptions.financing.ltvPct) / 100)
      : 0;
  const financingFees = loanAmount * (Math.max(0, assumptions.financing.loanFeePct) / 100);
  const equityRequiredForPurchase = Math.max(0, purchasePrice - loanAmount);
  const initialEquityInvested = Math.max(0, totalProjectCost + financingFees - loanAmount);
  const year0CashFlow = -initialEquityInvested;

  const currentRent = safeNumber(currentGrossRent);
  const otherIncome = Math.max(0, safeNumber(currentOtherIncome));
  const impliedExpenses = Math.max(0, currentRent + otherIncome - safeNumber(currentNoi));
  const resolvedCurrentExpenses =
    currentExpensesTotal != null && Number.isFinite(currentExpensesTotal) && currentExpensesTotal >= 0
      ? currentExpensesTotal
      : impliedExpenses;
  const normalizedExpenseInputs = normalizeExpenseProjectionInputs({
    currentExpensesTotal: resolvedCurrentExpenses,
    expenseRows,
  });

  const eligibleRevenueShare = clampUnitShare(
    assumptions.propertyMix.eligibleRevenueSharePct,
    assumptions.propertyMix.eligibleUnitSharePct ?? 1
  );
  const eligibleCurrentRent = roundCurrency(currentRent * eligibleRevenueShare);
  const projectedLeaseUpRentBase = roundCurrency(Math.max(0, safeNumber(conservativeProjectedLeaseUpRent)));
  const protectedCurrentRent = roundCurrency(Math.max(0, currentRent - eligibleCurrentRent));
  const upliftedEligibleCurrentRent = roundCurrency(
    eligibleCurrentRent * (1 + Math.max(0, assumptions.operating.rentUpliftPct) / 100)
  );
  const eligibleGrossRentalIncomeBase = roundCurrency(
    upliftedEligibleCurrentRent + projectedLeaseUpRentBase
  );
  const protectedGrossRentalIncomeBase = protectedCurrentRent;
  const grossRentalIncomeBase = roundCurrency(
    eligibleGrossRentalIncomeBase + protectedGrossRentalIncomeBase
  );
  const expenseLineItems = projectExpenseLines({
    assumptions,
    currentExpensesTotal: normalizedExpenseInputs.currentExpensesTotalExManagement,
    expenseRows: normalizedExpenseInputs.expenseRowsExManagement,
  });
  const projectedNonManagementExpenses = Array.from(
    { length: assumptions.holdPeriodYears },
    (_, yearIndex) =>
      roundCurrency(
        expenseLineItems.reduce(
          (sum, row) => sum + (row.yearlyAmounts[yearIndex] ?? 0),
          0
        )
      )
  );

  const mortgage =
    loanAmount > 0 && assumptions.financing.amortizationYears > 0
      ? computeMortgage({
          principal: loanAmount,
          annualRate: assumptions.financing.interestRatePct / 100,
          amortizationYears: assumptions.financing.amortizationYears,
        })
      : null;
  const amortizationSchedule =
    loanAmount > 0 && assumptions.financing.amortizationYears > 0
      ? computeAmortizationSchedule(
          {
            principal: loanAmount,
            annualRate: assumptions.financing.interestRatePct / 100,
            amortizationYears: assumptions.financing.amortizationYears,
          },
          assumptions.holdPeriodYears
        )
      : [];
  const annualDebtService = mortgage?.annualDebtService ?? 0;
  const remainingLoanBalanceAtExit =
    amortizationSchedule[assumptions.holdPeriodYears - 1]?.endingBalance ??
    amortizationSchedule[amortizationSchedule.length - 1]?.endingBalance ??
    0;
  const principalPaydownAtExit = Math.max(0, loanAmount - remainingLoanBalanceAtExit);

  const years = Array.from({ length: assumptions.holdPeriodYears + 1 }, (_, index) => index);
  const endingLabels = years.map((year) => `Y${year}`);
  const yearlyPropertyValue = years.map((year) =>
    year === 0
      ? roundCurrency(purchasePrice)
      : roundCurrency(compoundAnnual(purchasePrice, assumptions.operating.annualRentGrowthPct, year))
  );
  const yearlyEligibleGrossRentalIncome = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          compoundAnnual(
            eligibleGrossRentalIncomeBase,
            assumptions.operating.annualRentGrowthPct,
            year - 1
          )
        )
  );
  const yearlyProtectedGrossRentalIncome = years.map((year) =>
    year === 0 ? 0 : roundCurrency(protectedGrossRentalIncomeBase)
  );
  const yearlyGrossRentalIncome = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          (yearlyEligibleGrossRentalIncome[year] ?? 0) +
            (yearlyProtectedGrossRentalIncome[year] ?? 0)
        )
  );
  const yearlyOtherIncome = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          compoundAnnual(
            otherIncome,
            assumptions.operating.annualOtherIncomeGrowthPct,
            year - 1
          )
        )
  );
  const yearlyVacancyLoss = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          (yearlyEligibleGrossRentalIncome[year] ?? 0) * (assumptions.operating.vacancyPct / 100)
        )
  );
  const yearlyLeadTimeLoss = years.map((year) =>
    year === 1
      ? roundCurrency(
          (yearlyEligibleGrossRentalIncome[year] ?? 0) *
            (Math.max(0, assumptions.operating.leadTimeMonths) / 12)
        )
      : 0
  );
  const yearlyNetRentalIncome = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          (yearlyGrossRentalIncome[year] ?? 0) +
            (yearlyOtherIncome[year] ?? 0) -
            (yearlyVacancyLoss[year] ?? 0) -
            (yearlyLeadTimeLoss[year] ?? 0)
        )
  );
  const yearlyManagementFee = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          (yearlyGrossRentalIncome[year] ?? 0) *
            (Math.max(0, assumptions.operating.managementFeePct) / 100)
        )
  );
  const yearlyTotalOperatingExpenses = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          (projectedNonManagementExpenses[year - 1] ?? 0) + (yearlyManagementFee[year] ?? 0)
        )
  );
  const yearlyNoi = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency((yearlyNetRentalIncome[year] ?? 0) - (yearlyTotalOperatingExpenses[year] ?? 0))
  );
  const yearlyRecurringCapex = years.map((year) =>
    year === 0 ? 0 : roundCurrency(Math.max(0, assumptions.operating.recurringCapexAnnual))
  );
  const yearlyCashFlowFromOperations = years.map((year) =>
    year === 0 ? 0 : roundCurrency((yearlyNoi[year] ?? 0) - (yearlyRecurringCapex[year] ?? 0))
  );
  const yearlyCapRateOnPurchase = years.map((year) =>
    year === 0 || purchasePrice <= 0
      ? null
      : (yearlyNoi[year] ?? 0) / purchasePrice
  );
  const yearlyDebtService = years.map((year) =>
    year === 0 ? 0 : roundCurrency(amortizationSchedule[year - 1]?.debtService ?? 0)
  );
  const yearlyPrincipalPaid = years.map((year) =>
    year === 0 ? 0 : roundCurrency(amortizationSchedule[year - 1]?.principalPayment ?? 0)
  );
  const yearlyInterestPaid = years.map((year) =>
    year === 0 ? 0 : roundCurrency(amortizationSchedule[year - 1]?.interestPayment ?? 0)
  );
  const yearlyCashFlowAfterFinancing = years.map((year) =>
    year === 0
      ? 0
      : roundCurrency(
          (yearlyCashFlowFromOperations[year] ?? 0) - (yearlyDebtService[year] ?? 0)
        )
  );
  const yearlyTotalInvestmentCost = years.map((year) =>
    year === 0 ? roundCurrency(-totalProjectCost) : 0
  );
  const yearlyFinancingFunding = years.map((year) =>
    year === 0 ? roundCurrency(loanAmount) : 0
  );
  const yearlyFinancingFees = years.map((year) =>
    year === 0 ? roundCurrency(financingFees) : 0
  );
  const yearlyRemainingLoanBalance = years.map((year) =>
    year === 0
      ? roundCurrency(loanAmount)
      : roundCurrency(amortizationSchedule[year - 1]?.endingBalance ?? 0)
  );
  const yearlySaleValue = years.map((year) =>
    year === assumptions.holdPeriodYears && assumptions.exit.exitCapPct > 0
      ? roundCurrency((yearlyNoi[year] ?? 0) / (assumptions.exit.exitCapPct / 100))
      : 0
  );
  const yearlySaleClosingCosts = years.map((year) =>
    year === assumptions.holdPeriodYears
      ? roundCurrency(
          (yearlySaleValue[year] ?? 0) * (Math.max(0, assumptions.exit.exitClosingCostPct) / 100)
        )
      : 0
  );
  const yearlyNetSaleBeforeDebt = years.map((year) =>
    year === assumptions.holdPeriodYears
      ? roundCurrency((yearlySaleValue[year] ?? 0) - (yearlySaleClosingCosts[year] ?? 0))
      : 0
  );
  const yearlyFinancingPayoff = years.map((year) =>
    year === assumptions.holdPeriodYears ? roundCurrency(yearlyRemainingLoanBalance[year] ?? 0) : 0
  );
  const yearlyNetSaleToEquity = years.map((year) =>
    year === assumptions.holdPeriodYears
      ? roundCurrency((yearlyNetSaleBeforeDebt[year] ?? 0) - (yearlyFinancingPayoff[year] ?? 0))
      : 0
  );
  const yearlyUnleveredCashFlow = years.map((year) =>
    roundCurrency(
      (yearlyCashFlowFromOperations[year] ?? 0) +
        (yearlyNetSaleBeforeDebt[year] ?? 0) +
        (yearlyTotalInvestmentCost[year] ?? 0)
    )
  );
  const yearlyLeveredCashFlow = years.map((year) =>
    year === 0
      ? roundCurrency(-initialEquityInvested)
      : roundCurrency(
          (yearlyCashFlowAfterFinancing[year] ?? 0) + (yearlyNetSaleToEquity[year] ?? 0)
        )
  );

  const annualOperatingCashFlows = yearlyCashFlowAfterFinancing.slice(1);
  const annualPrincipalPaydowns = yearlyPrincipalPaid.slice(1);
  const annualEquityGains = annualOperatingCashFlows.map((cashFlow, index) =>
    roundCurrency(cashFlow + (annualPrincipalPaydowns[index] ?? 0))
  );
  const annualUnleveredCashFlows = yearlyCashFlowFromOperations.slice(1);
  const annualOperatingCashFlow = annualOperatingCashFlows[0] ?? 0;
  const annualPrincipalPaydown = annualPrincipalPaydowns[0] ?? 0;
  const annualEquityGain = annualEquityGains[0] ?? 0;
  const finalYearCashFlow =
    yearlyLeveredCashFlow[assumptions.holdPeriodYears] ??
    yearlyLeveredCashFlow[yearlyLeveredCashFlow.length - 1] ??
    0;
  const equityCashFlowSeries = yearlyLeveredCashFlow.slice();
  const unleveredCashFlowSeries = yearlyUnleveredCashFlow.slice();
  const averageEquityYield =
    annualEquityGains.length > 0 && initialEquityInvested !== 0
      ? annualEquityGains.reduce((sum, value) => sum + value, 0) /
        annualEquityGains.length /
        initialEquityInvested
      : null;
  const year1EquityYield =
    annualEquityGains.length > 0 && initialEquityInvested !== 0
      ? annualEquityGains[0]! / initialEquityInvested
      : null;
  const exitPropertyValue =
    yearlySaleValue[assumptions.holdPeriodYears] ?? yearlySaleValue[yearlySaleValue.length - 1] ?? 0;
  const saleClosingCosts =
    yearlySaleClosingCosts[assumptions.holdPeriodYears] ??
    yearlySaleClosingCosts[yearlySaleClosingCosts.length - 1] ??
    0;
  const netSaleProceedsBeforeDebtPayoff =
    yearlyNetSaleBeforeDebt[assumptions.holdPeriodYears] ??
    yearlyNetSaleBeforeDebt[yearlyNetSaleBeforeDebt.length - 1] ??
    0;
  const netProceedsToEquity =
    yearlyNetSaleToEquity[assumptions.holdPeriodYears] ??
    yearlyNetSaleToEquity[yearlyNetSaleToEquity.length - 1] ??
    0;
  const stabilizedYearIndex =
    assumptions.operating.leadTimeMonths > 0 && assumptions.holdPeriodYears > 1 ? 2 : 1;
  const stabilizedIndex = Math.min(assumptions.holdPeriodYears, stabilizedYearIndex);

  return {
    assumptions,
    acquisition: {
      purchaseClosingCosts: roundCurrency(purchaseClosingCosts),
      financingFees: roundCurrency(financingFees),
      totalProjectCost: roundCurrency(totalProjectCost),
      loanAmount: roundCurrency(loanAmount),
      equityRequiredForPurchase: roundCurrency(equityRequiredForPurchase),
      initialEquityInvested: roundCurrency(initialEquityInvested),
      year0CashFlow: roundCurrency(year0CashFlow),
    },
    financing: {
      loanAmount: roundCurrency(loanAmount),
      financingFees: roundCurrency(financingFees),
      equityRequiredForPurchase: roundCurrency(equityRequiredForPurchase),
      monthlyPayment: mortgage?.monthlyPayment ?? 0,
      annualDebtService: roundCurrency(annualDebtService),
      remainingLoanBalanceAtExit: roundCurrency(remainingLoanBalanceAtExit),
      principalPaydownAtExit: roundCurrency(principalPaydownAtExit),
      amortizationSchedule,
    },
    operating: {
      currentExpenses: roundCurrency(normalizedExpenseInputs.currentExpensesTotalExManagement),
      currentOtherIncome: roundCurrency(otherIncome),
      adjustedGrossRent: roundCurrency(yearlyGrossRentalIncome[stabilizedIndex] ?? grossRentalIncomeBase),
      adjustedOperatingExpenses: roundCurrency(
        projectedNonManagementExpenses[stabilizedIndex - 1] ?? projectedNonManagementExpenses[0] ?? 0
      ),
      managementFeeAmount: roundCurrency(yearlyManagementFee[stabilizedIndex] ?? 0),
      stabilizedNoi: roundCurrency(yearlyNoi[stabilizedIndex] ?? 0),
    },
    exit: {
      exitPropertyValue: roundCurrency(exitPropertyValue),
      saleClosingCosts: roundCurrency(saleClosingCosts),
      netSaleProceedsBeforeDebtPayoff: roundCurrency(netSaleProceedsBeforeDebtPayoff),
      remainingLoanBalance: roundCurrency(remainingLoanBalanceAtExit),
      principalPaydownToDate: roundCurrency(principalPaydownAtExit),
      netProceedsToEquity: roundCurrency(netProceedsToEquity),
    },
    yearly: {
      years,
      endingLabels,
      propertyValue: yearlyPropertyValue,
      grossRentalIncome: yearlyGrossRentalIncome,
      otherIncome: yearlyOtherIncome,
      vacancyLoss: yearlyVacancyLoss,
      leadTimeLoss: yearlyLeadTimeLoss,
      netRentalIncome: yearlyNetRentalIncome,
      managementFee: yearlyManagementFee,
      expenseLineItems,
      totalOperatingExpenses: yearlyTotalOperatingExpenses,
      noi: yearlyNoi,
      recurringCapex: yearlyRecurringCapex,
      cashFlowFromOperations: yearlyCashFlowFromOperations,
      capRateOnPurchase: yearlyCapRateOnPurchase,
      debtService: yearlyDebtService,
      principalPaid: yearlyPrincipalPaid,
      interestPaid: yearlyInterestPaid,
      cashFlowAfterFinancing: yearlyCashFlowAfterFinancing,
      totalInvestmentCost: yearlyTotalInvestmentCost,
      financingFunding: yearlyFinancingFunding,
      financingFees: yearlyFinancingFees,
      saleValue: yearlySaleValue,
      saleClosingCosts: yearlySaleClosingCosts,
      remainingLoanBalance: yearlyRemainingLoanBalance,
      financingPayoff: yearlyFinancingPayoff,
      netSaleProceedsBeforeDebtPayoff: yearlyNetSaleBeforeDebt,
      netSaleProceedsToEquity: yearlyNetSaleToEquity,
      unleveredCashFlow: yearlyUnleveredCashFlow,
      leveredCashFlow: yearlyLeveredCashFlow,
    },
    cashFlows: {
      annualOperatingCashFlow: roundCurrency(annualOperatingCashFlow),
      annualOperatingCashFlows: annualOperatingCashFlows.map(roundCurrency),
      annualPrincipalPaydown: roundCurrency(annualPrincipalPaydown),
      annualPrincipalPaydowns: annualPrincipalPaydowns.map(roundCurrency),
      annualEquityGain: roundCurrency(annualEquityGain),
      annualEquityGains: annualEquityGains.map(roundCurrency),
      annualUnleveredCashFlows: annualUnleveredCashFlows.map(roundCurrency),
      finalYearCashFlow: roundCurrency(finalYearCashFlow),
      unleveredCashFlowSeries: unleveredCashFlowSeries.map(roundCurrency),
      equityCashFlowSeries: equityCashFlowSeries.map(roundCurrency),
    },
    returns: {
      ...computeIrr({
        equityCashFlows: equityCashFlowSeries,
        operatingCashFlows: annualOperatingCashFlows,
      }),
      year1EquityYield,
      averageEquityYield,
    },
  };
}

function roundOffer(value: number): number {
  return Math.max(0, Math.round(value / 1_000) * 1_000);
}

export function computeRecommendedOffer(input: UnderwritingProjectionInput): RecommendedOfferAnalysis {
  const {
    assumptions,
    currentGrossRent,
    currentNoi,
    currentOtherIncome,
    currentExpensesTotal,
    expenseRows,
    conservativeProjectedLeaseUpRent,
  } = input;
  const askingPrice = assumptions.acquisition.purchasePrice;
  const targetIrrPct = assumptions.targetIrrPct;
  const targetIrr = targetIrrPct / 100;

  if (askingPrice == null || !Number.isFinite(askingPrice) || askingPrice <= 0) {
    return {
      askingPrice: null,
      targetIrrPct,
      irrAtAskingPct: null,
      recommendedOfferLow: null,
      recommendedOfferHigh: null,
      discountToAskingPct: null,
      targetMetAtAsking: false,
    };
  }

  const baseProjection = computeUnderwritingProjection({
    assumptions,
    currentGrossRent,
    currentNoi,
    currentOtherIncome,
    currentExpensesTotal,
    expenseRows,
    conservativeProjectedLeaseUpRent,
  });
  const irrAtAskingPct = baseProjection.returns.irr ?? null;
  const targetMetAtAsking = irrAtAskingPct != null && irrAtAskingPct >= targetIrr;

  if (targetMetAtAsking) {
    return {
      askingPrice,
      targetIrrPct,
      irrAtAskingPct,
      recommendedOfferLow: roundOffer(askingPrice * 0.95),
      recommendedOfferHigh: roundOffer(askingPrice),
      discountToAskingPct: 0,
      targetMetAtAsking: true,
    };
  }

  const realisticLowPrice = Math.max(1_000, askingPrice * 0.1);
  const projectionAtLowPrice = computeUnderwritingProjection({
    assumptions: {
      ...assumptions,
      acquisition: {
        ...assumptions.acquisition,
        purchasePrice: realisticLowPrice,
      },
    },
    currentGrossRent,
    currentNoi,
    currentOtherIncome,
    currentExpensesTotal,
    expenseRows,
    conservativeProjectedLeaseUpRent,
  });
  if (projectionAtLowPrice.returns.irr == null || projectionAtLowPrice.returns.irr < targetIrr) {
    return {
      askingPrice,
      targetIrrPct,
      irrAtAskingPct,
      recommendedOfferLow: null,
      recommendedOfferHigh: null,
      discountToAskingPct: null,
      targetMetAtAsking: false,
    };
  }

  let low = realisticLowPrice;
  let high = askingPrice;
  for (let index = 0; index < 50; index += 1) {
    const mid = (low + high) / 2;
    const trialProjection = computeUnderwritingProjection({
      assumptions: {
        ...assumptions,
        acquisition: {
          ...assumptions.acquisition,
          purchasePrice: mid,
        },
      },
      currentGrossRent,
      currentNoi,
      currentOtherIncome,
      currentExpensesTotal,
      expenseRows,
      conservativeProjectedLeaseUpRent,
    });
    const irr = trialProjection.returns.irr;
    if (irr != null && irr >= targetIrr) low = mid;
    else high = mid;
  }

  const recommendedOfferHigh = roundOffer(low);
  const recommendedOfferLow = roundOffer(recommendedOfferHigh * 0.95);
  const discountToAskingPct =
    askingPrice > 0 ? Math.max(0, ((askingPrice - recommendedOfferHigh) / askingPrice) * 100) : null;

  return {
    askingPrice,
    targetIrrPct,
    irrAtAskingPct,
    recommendedOfferLow,
    recommendedOfferHigh,
    discountToAskingPct,
    targetMetAtAsking: false,
  };
}
