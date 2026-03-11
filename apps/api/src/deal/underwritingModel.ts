import type { UserProfile } from "@re-sourcing/contracts";
import { computeFurnishedRental } from "./furnishedRentalEstimator.js";
import {
  computeMortgage,
  computeAmortizationSchedule,
  type AmortizationYearRow,
} from "./mortgageAmortization.js";
import { computeIrr, type IrrResult } from "./irrCalculation.js";

export const DEFAULT_HOLD_PERIOD_YEARS = 5;
export const MAX_UNDERWRITING_HOLD_PERIOD_YEARS = 50;

export interface DossierAssumptionOverrides {
  purchasePrice?: number | null;
  purchaseClosingCostPct?: number | null;
  renovationCosts?: number | null;
  furnishingSetupCosts?: number | null;
  ltvPct?: number | null;
  interestRatePct?: number | null;
  amortizationYears?: number | null;
  rentUpliftPct?: number | null;
  expenseIncreasePct?: number | null;
  managementFeePct?: number | null;
  holdPeriodYears?: number | null;
  exitCapPct?: number | null;
  exitClosingCostPct?: number | null;
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
  };
  operating: {
    rentUpliftPct: number;
    expenseIncreasePct: number;
    managementFeePct: number;
  };
  holdPeriodYears: number;
  exit: {
    exitCapPct: number;
    exitClosingCostPct: number;
  };
}

export interface UnderwritingProjection {
  assumptions: ResolvedDossierAssumptions;
  acquisition: {
    purchaseClosingCosts: number;
    totalProjectCost: number;
    loanAmount: number;
    equityRequiredForPurchase: number;
    initialEquityInvested: number;
    year0CashFlow: number;
  };
  financing: {
    loanAmount: number;
    equityRequiredForPurchase: number;
    monthlyPayment: number;
    annualDebtService: number;
    remainingLoanBalanceAtExit: number;
    amortizationSchedule: AmortizationYearRow[];
  };
  operating: {
    currentExpenses: number;
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
    netProceedsToEquity: number;
  };
  cashFlows: {
    annualOperatingCashFlow: number;
    annualOperatingCashFlows: number[];
    finalYearCashFlow: number;
    equityCashFlowSeries: number[];
  };
  returns: IrrResult;
}

function safeNumber(value: number | null | undefined, fallback = 0): number {
  return value != null && Number.isFinite(value) ? value : fallback;
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

function pickNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

export function resolveDossierAssumptions(
  profile: UserProfile | null,
  purchasePrice: number | null,
  overrides?: DossierAssumptionOverrides | null
): ResolvedDossierAssumptions {
  return {
    acquisition: {
      purchasePrice: pickNumber(overrides?.purchasePrice, purchasePrice),
      purchaseClosingCostPct: safeNumber(
        pickNumber(overrides?.purchaseClosingCostPct, profile?.defaultPurchaseClosingCostPct),
        0
      ),
      renovationCosts: safeNumber(overrides?.renovationCosts, 0),
      furnishingSetupCosts: safeNumber(overrides?.furnishingSetupCosts, 0),
    },
    financing: {
      ltvPct: safeNumber(pickNumber(overrides?.ltvPct, profile?.defaultLtv), 65),
      interestRatePct: safeNumber(pickNumber(overrides?.interestRatePct, profile?.defaultInterestRate), 6.5),
      amortizationYears: safePositiveInteger(
        pickNumber(overrides?.amortizationYears, profile?.defaultAmortization),
        30
      ),
    },
    operating: {
      rentUpliftPct: safeNumber(pickNumber(overrides?.rentUpliftPct, profile?.defaultRentUplift), 15),
      expenseIncreasePct: safeNumber(
        pickNumber(overrides?.expenseIncreasePct, profile?.defaultExpenseIncrease),
        2
      ),
      managementFeePct: safeNumber(
        pickNumber(overrides?.managementFeePct, profile?.defaultManagementFee),
        5
      ),
    },
    holdPeriodYears: safePositiveInteger(
      pickNumber(overrides?.holdPeriodYears, profile?.defaultHoldPeriodYears),
      DEFAULT_HOLD_PERIOD_YEARS,
      MAX_UNDERWRITING_HOLD_PERIOD_YEARS
    ),
    exit: {
      exitCapPct: safeNumber(pickNumber(overrides?.exitCapPct, profile?.defaultExitCap), 5),
      exitClosingCostPct: safeNumber(
        pickNumber(overrides?.exitClosingCostPct, profile?.defaultExitClosingCostPct),
        0
      ),
    },
  };
}

export function computeUnderwritingProjection(input: {
  assumptions: ResolvedDossierAssumptions;
  currentGrossRent: number | null;
  currentNoi: number | null;
}): UnderwritingProjection {
  const { assumptions, currentGrossRent, currentNoi } = input;
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
  const equityRequiredForPurchase = Math.max(0, purchasePrice - loanAmount);
  const initialEquityInvested = Math.max(0, totalProjectCost - loanAmount);
  const year0CashFlow = -initialEquityInvested;

  const furnishedRental = computeFurnishedRental(
    {
      currentGrossRent: safeNumber(currentGrossRent),
      currentNoi: safeNumber(currentNoi),
      rentUplift: 1 + assumptions.operating.rentUpliftPct / 100,
      expenseIncrease: 1 + assumptions.operating.expenseIncreasePct / 100,
      managementFee: assumptions.operating.managementFeePct / 100,
    },
    assumptions.acquisition.purchasePrice
  );

  const managementFeeAmount =
    furnishedRental.adjustedGrossIncome * (Math.max(0, assumptions.operating.managementFeePct) / 100);
  const adjustedOperatingExpenses = Math.max(0, furnishedRental.adjustedExpenses - managementFeeAmount);
  const stabilizedNoi = furnishedRental.adjustedNoi;

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

  const annualOperatingCashFlows = Array.from({ length: assumptions.holdPeriodYears }, (_, index) => {
    const debtServiceForYear = amortizationSchedule[index]?.debtService ?? 0;
    return stabilizedNoi - debtServiceForYear;
  });
  const annualOperatingCashFlow = annualOperatingCashFlows[0] ?? stabilizedNoi;

  const exitPropertyValue =
    assumptions.exit.exitCapPct > 0 ? stabilizedNoi / (assumptions.exit.exitCapPct / 100) : 0;
  const saleClosingCosts =
    exitPropertyValue * (Math.max(0, assumptions.exit.exitClosingCostPct) / 100);
  const netSaleProceedsBeforeDebtPayoff = exitPropertyValue - saleClosingCosts;
  const netProceedsToEquity = netSaleProceedsBeforeDebtPayoff - remainingLoanBalanceAtExit;
  const finalYearCashFlow =
    (annualOperatingCashFlows[annualOperatingCashFlows.length - 1] ?? 0) + netProceedsToEquity;
  const equityCashFlowSeries =
    annualOperatingCashFlows.length > 0
      ? [
          year0CashFlow,
          ...annualOperatingCashFlows.slice(0, -1),
          finalYearCashFlow,
        ]
      : [year0CashFlow, netProceedsToEquity];

  return {
    assumptions,
    acquisition: {
      purchaseClosingCosts,
      totalProjectCost,
      loanAmount,
      equityRequiredForPurchase,
      initialEquityInvested,
      year0CashFlow,
    },
    financing: {
      loanAmount,
      equityRequiredForPurchase,
      monthlyPayment: mortgage?.monthlyPayment ?? 0,
      annualDebtService,
      remainingLoanBalanceAtExit,
      amortizationSchedule,
    },
    operating: {
      currentExpenses: furnishedRental.currentExpenses,
      adjustedGrossRent: furnishedRental.adjustedGrossIncome,
      adjustedOperatingExpenses,
      managementFeeAmount,
      stabilizedNoi,
    },
    exit: {
      exitPropertyValue,
      saleClosingCosts,
      netSaleProceedsBeforeDebtPayoff,
      remainingLoanBalance: remainingLoanBalanceAtExit,
      netProceedsToEquity,
    },
    cashFlows: {
      annualOperatingCashFlow,
      annualOperatingCashFlows,
      finalYearCashFlow,
      equityCashFlowSeries,
    },
    returns: computeIrr({
      equityCashFlows: equityCashFlowSeries,
      operatingCashFlows: annualOperatingCashFlows,
    }),
  };
}
