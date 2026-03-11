import type { PropertyDetails, UserProfile } from "@re-sourcing/contracts";
import { computeFurnishedRental } from "./furnishedRentalEstimator.js";
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

export const DEFAULT_HOLD_PERIOD_YEARS = 5;
export const MAX_UNDERWRITING_HOLD_PERIOD_YEARS = 10;
export const DEFAULT_PURCHASE_CLOSING_COST_PCT = 3;
export const DEFAULT_LTV_PCT = 75;
export const DEFAULT_INTEREST_RATE_PCT = 6;
export const DEFAULT_AMORTIZATION_YEARS = 30;
export const DEFAULT_RENT_UPLIFT_PCT = 70;
export const DEFAULT_EXPENSE_INCREASE_PCT = 20;
export const DEFAULT_MANAGEMENT_FEE_PCT = 8;
export const DEFAULT_EXIT_CAP_PCT = 5;
export const DEFAULT_EXIT_CLOSING_COST_PCT = 2;
export const DEFAULT_TARGET_IRR_PCT = 25;

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
  targetIrrPct?: number | null;
}

export interface DossierPropertyContext {
  details?: PropertyDetails | null;
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
    blendedRentUpliftPct: number;
    expenseIncreasePct: number;
    managementFeePct: number;
  };
  holdPeriodYears: number;
  exit: {
    exitCapPct: number;
    exitClosingCostPct: number;
  };
  targetIrrPct: number;
  propertyMix: UnderwritingPropertyMixSummary;
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

export interface RecommendedOfferAnalysis {
  askingPrice: number | null;
  targetIrrPct: number;
  irrAtAskingPct: number | null;
  recommendedOfferLow: number | null;
  recommendedOfferHigh: number | null;
  discountToAskingPct: number | null;
  targetMetAtAsking: boolean;
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
  overrides?: DossierAssumptionOverrides | null,
  propertyContext?: DossierPropertyContext | null
): ResolvedDossierAssumptions {
  const rentUpliftPct = safeNumber(
    pickNumber(overrides?.rentUpliftPct, profile?.defaultRentUplift),
    DEFAULT_RENT_UPLIFT_PCT
  );
  const propertyMix = analyzePropertyForUnderwriting(propertyContext?.details ?? null);

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
      rentUplift: 1 + assumptions.operating.blendedRentUpliftPct / 100,
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

function roundOffer(value: number): number {
  return Math.max(0, Math.round(value / 1_000) * 1_000);
}

export function computeRecommendedOffer(input: {
  assumptions: ResolvedDossierAssumptions;
  currentGrossRent: number | null;
  currentNoi: number | null;
}): RecommendedOfferAnalysis {
  const { assumptions, currentGrossRent, currentNoi } = input;
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
