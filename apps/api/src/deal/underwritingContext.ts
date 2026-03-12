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
  packageNote?: string | null;
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

export interface YearlyExpenseProjectionRow {
  lineItem: string;
  annualGrowthPct: number;
  baseAmount: number;
  yearlyAmounts: number[];
}

export interface YearlyCashFlowProjectionContext {
  years: number[];
  endingLabels: string[];
  propertyValue: number[];
  grossRentalIncome: number[];
  otherIncome: number[];
  vacancyLoss: number[];
  leadTimeLoss: number[];
  netRentalIncome: number[];
  managementFee: number[];
  expenseLineItems: YearlyExpenseProjectionRow[];
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

export interface SensitivityScenarioRow {
  valuePct: number;
  irrPct: number | null;
  year1CashOnCashReturn: number | null;
  year1EquityYield?: number | null;
  stabilizedNoi: number;
  annualOperatingCashFlow: number;
  exitPropertyValue: number;
  netProceedsToEquity: number;
}

export interface SensitivityAnalysisContext {
  key: "rental_uplift" | "expense_increase" | "management_fee" | "exit_cap_rate";
  title: string;
  inputLabel: string;
  scenarios: SensitivityScenarioRow[];
  baseCase: {
    valuePct: number | null;
    irrPct: number | null;
    year1CashOnCashReturn: number | null;
    year1EquityYield?: number | null;
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
    year1EquityYield?: {
      min: number | null;
      max: number | null;
    };
  };
}

export interface DossierPropertyMixContext {
  totalUnits: number | null;
  residentialUnits: number;
  eligibleResidentialUnits: number;
  commercialUnits: number;
  rentStabilizedUnits: number;
  eligibleRevenueSharePct: number | null;
  eligibleUnitSharePct: number | null;
}

export interface DossierRecommendedOfferContext {
  askingPrice: number | null;
  targetIrrPct: number | null;
  irrAtAskingPct: number | null;
  recommendedOfferLow: number | null;
  recommendedOfferHigh: number | null;
  discountToAskingPct: number | null;
  targetMetAtAsking: boolean;
}

export interface DossierConditionReviewContext {
  source: "images_and_text" | "text_only";
  overallCondition?: string | null;
  renovationScope?: string | null;
  imageQuality?: string | null;
  confidence?: number | null;
  imageCountAnalyzed: number;
  coverageSeen?: string[] | null;
  coverageMissing?: string[] | null;
  observedSignals?: string[] | null;
  textSignals?: string[] | null;
  summaryBullets?: string[] | null;
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
  /** Current other income (annual) from property details / OM when available. */
  currentOtherIncome?: number | null;
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
      loanFeePct?: number | null;
    };
    operating: {
      rentUpliftPct: number | null;
      blendedRentUpliftPct?: number | null;
      expenseIncreasePct: number | null;
      managementFeePct: number | null;
      vacancyPct?: number | null;
      leadTimeMonths?: number | null;
      annualRentGrowthPct?: number | null;
      annualOtherIncomeGrowthPct?: number | null;
      annualExpenseGrowthPct?: number | null;
      annualPropertyTaxGrowthPct?: number | null;
      recurringCapexAnnual?: number | null;
    };
    holdPeriodYears: number | null;
    targetIrrPct?: number | null;
    exit: {
      exitCapPct: number | null;
      exitClosingCostPct: number | null;
    };
  };
  acquisition: {
    purchaseClosingCosts: number;
    financingFees?: number;
    totalProjectCost: number;
    loanAmount: number;
    equityRequiredForPurchase: number;
    initialEquityInvested: number;
    year0CashFlow: number;
  };
  financing: {
    loanAmount: number;
    financingFees?: number;
    monthlyPayment: number;
    annualDebtService: number;
    remainingLoanBalanceAtExit: number;
    principalPaydownAtExit?: number;
  };
  operating: {
    currentExpenses: number;
    currentOtherIncome?: number;
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
    principalPaydownToDate?: number;
    netProceedsToEquity: number;
  };
  cashFlows: {
    annualOperatingCashFlow: number;
    annualOperatingCashFlows: number[];
    annualPrincipalPaydown?: number;
    annualPrincipalPaydowns?: number[];
    annualEquityGain?: number;
    annualEquityGains?: number[];
    annualUnleveredCashFlows?: number[];
    finalYearCashFlow: number;
    unleveredCashFlowSeries?: number[];
    equityCashFlowSeries: number[];
  };
  returns: {
    irrPct: number | null;
    equityMultiple: number | null;
    year1CashOnCashReturn: number | null;
    averageCashOnCashReturn: number | null;
    year1EquityYield?: number | null;
    averageEquityYield?: number | null;
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
  /** Optional: detailed yearly cash flow rows shared by the dossier and Excel model. */
  yearlyCashFlow?: YearlyCashFlowProjectionContext | null;
  /** Optional: protected-unit / convertible-unit mix used for uplift logic. */
  propertyMix?: DossierPropertyMixContext | null;
  /** Optional: target-IRR-based recommended offer analysis. */
  recommendedOffer?: DossierRecommendedOfferContext | null;
  /** Optional: listing-photo + OM/listing-text condition review for dossier narrative. */
  conditionReview?: DossierConditionReviewContext | null;
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
