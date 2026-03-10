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
  /** Furnished rental result (adjusted NOI, etc.). */
  furnishedRental: {
    adjustedGrossIncome: number;
    adjustedExpenses: number;
    adjustedNoi: number;
    adjustedCapRatePct: number | null;
    /** Management fee amount (e.g. 8% of gross rents) shown as separate line. */
    managementFeeAmount?: number;
    /** Expected sale price at exit cap rate (adjusted NOI / exitCap). */
    expectedSalePriceAtExitCap?: number | null;
  } | null;
  /** Mortgage result (annual debt service, etc.). */
  mortgage: {
    principal: number;
    monthlyPayment: number;
    annualDebtService: number;
  } | null;
  /** IRR result (5-year by default). */
  irr: {
    irrPct: number | null;
    equityMultiple: number | null;
    coc: number | null;
    /** 3-year IRR as decimal when computed. */
    irr3yrPct?: number | null;
    /** 5-year IRR as decimal when computed. */
    irr5yrPct?: number | null;
  } | null;
  /** Assumptions used (for display). */
  assumptions: {
    ltvPct: number | null;
    interestRatePct: number | null;
    amortizationYears: number | null;
    exitCapPct: number | null;
    rentUpliftPct: number | null;
    expenseIncreasePct: number | null;
    managementFeePct: number | null;
    expectedAppreciationPct: number | null;
  };
  /** Projected property value at exit from appreciation (purchasePrice * (1 + appreciation)^holdYears). */
  projectedValueFromAppreciation: number | null;
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
