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
  };
}
