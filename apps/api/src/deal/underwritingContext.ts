/**
 * Shared underwriting context for Excel pro forma and dossier generator.
 * Built by the generate-dossier flow from property, listing, profile, and deal modules.
 */

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
  } | null;
  /** Mortgage result (annual debt service, etc.). */
  mortgage: {
    principal: number;
    monthlyPayment: number;
    annualDebtService: number;
  } | null;
  /** IRR result. */
  irr: {
    irrPct: number | null;
    equityMultiple: number | null;
    coc: number | null;
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
