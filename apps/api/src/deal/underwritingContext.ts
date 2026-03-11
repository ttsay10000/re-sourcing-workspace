/**
 * Shared underwriting context for Excel pro forma and dossier generator.
 * Built by the generate-dossier flow from property, listing, profile, and deal modules.
 */

/** Property overview fields for dossier (tax code, HPD, etc.). */
export interface DossierPropertyOverview {
  taxCode?: string | null;
  hpdRegistrationId?: string | null;
  hpdRegistrationDate?: string | null;
  bbl?: string | null;
}

/** One row for gross rent breakdown (e.g. per unit from OM). */
export interface GrossRentRow {
  label: string;
  annualRent: number;
}

/** One row for expenses breakdown (from OM). */
export interface ExpenseRow {
  lineItem: string;
  amount: number;
}

/** Per-year amortization row for financing table. */
export interface DossierAmortizationRow {
  year: number;
  principalPayment: number;
  interestPayment: number;
  debtService: number;
  endingBalance: number;
}

export interface SensitivityScenarioRow {
  valuePct: number;
  irrPct: number | null;
  year1CashOnCashReturn: number | null;
  stabilizedNoi: number;
  annualOperatingCashFlow: number;
}

export interface SensitivityAnalysisContext {
  key: "rental_uplift" | "expense_increase" | "management_fee";
  title: string;
  inputLabel: string;
  scenarios: SensitivityScenarioRow[];
  baseCase: {
    valuePct: number | null;
    irrPct: number | null;
    year1CashOnCashReturn: number | null;
  };
  ranges: {
    irrPct: {
      min: number | null;
      max: number | null;
    };
    year1CashOnCashReturn: {
      min: number | null;
      max: number | null;
    };
  };
}

export interface UnderwritingContext {
  propertyId: string;
  canonicalAddress: string;
  /** Listing price (purchase price). */
  purchasePrice: number | null;
  listingCity: string | null;
  /** Current NOI from property details. */
  currentNoi: number | null;
  /** Current gross rent (annual) from property details. */
  currentGrossRent: number | null;
  /** Unit count from OM when available (rent roll length or propertyInfo.totalUnits). */
  unitCount: number | null;
  /** Deal score 0–100. */
  dealScore: number | null;
  assetCapRate: number | null;
  adjustedCapRate: number | null;
  /** Assumptions used, grouped by underwriting bucket. */
  assumptions: {
    acquisition: {
      purchasePrice: number | null;
      purchaseClosingCostPct: number | null;
      renovationCosts: number | null;
      furnishingSetupCosts: number | null;
    };
    financing: {
      ltvPct: number | null;
      interestRatePct: number | null;
      amortizationYears: number | null;
    };
    operating: {
      rentUpliftPct: number | null;
      expenseIncreasePct: number | null;
      managementFeePct: number | null;
    };
    holdPeriodYears: number | null;
    exit: {
      exitCapPct: number | null;
      exitClosingCostPct: number | null;
    };
  };
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
    monthlyPayment: number;
    annualDebtService: number;
    remainingLoanBalanceAtExit: number;
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
  returns: {
    irrPct: number | null;
    equityMultiple: number | null;
    year1CashOnCashReturn: number | null;
    averageCashOnCashReturn: number | null;
  };
  /** Optional: property overview for dossier (tax code, HPD registration). */
  propertyOverview?: DossierPropertyOverview | null;
  /** Optional: gross rent breakdown from OM (per-unit rows). */
  rentRollRows?: GrossRentRow[];
  /** Optional: expense line items from OM. */
  expenseRows?: ExpenseRow[];
  /** Optional: total current expenses (gross rent - NOI when not from OM). */
  currentExpensesTotal?: number | null;
  /** Optional: 1–2 bullets for Current State (e.g. listed price, risk flags). */
  financialFlags?: string[];
  /** Optional: per-year amortization for financing table. */
  amortizationSchedule?: DossierAmortizationRow[];
  /** Optional: one-way underwriting sensitivities for dossier and Excel. */
  sensitivities?: SensitivityAnalysisContext[];
}

/**
 * Optional neighborhood/market context for the dossier LLM.
 * When Neighborhood Intelligence is implemented, built from neighborhood_metrics + deal_signals.
 */
export interface DossierNeighborhoodContext {
  neighborhoodKey: string | null;
  neighborhoodName: string | null;
  medianPricePsf: number | null;
  medianRentPsf: number | null;
  medianAssetCapRate: number | null;
  subjectPricePsf: number | null;
  subjectRentPsf: number | null;
  priceDiscountPct: number | null;
  yieldSpreadAsset: number | null;
  yieldSpreadAdjusted: number | null;
  supplyRiskFlag: boolean | null;
  momentumFlag: string | null;
}
