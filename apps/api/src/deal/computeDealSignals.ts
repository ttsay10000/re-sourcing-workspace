/**
 * Compute deal signals and deal score from property details + primary listing.
 * Deal score is produced by the LLM when generating a dossier (dealScoringLlm); this module provides
 * the deterministic fallback (dealScoringEngine) and builds insert params for deal_signals.
 */

import type { PropertyDetails, RentalFinancials } from "@re-sourcing/contracts";
import { computeDealScore, type DealScoringResult } from "./dealScoringEngine.js";
import type { InsertDealSignalsParams } from "@re-sourcing/db";

export interface PropertyListingInput {
  /** Listing price (purchase price for scoring). */
  price: number | null;
  /** Listing city (optional, not used in current scoring). */
  city: string | null;
}

export interface ComputeDealSignalsInput {
  propertyId: string;
  canonicalAddress: string | null;
  details: PropertyDetails | null;
  primaryListing: PropertyListingInput;
  /** Optional: 5-year IRR as decimal (e.g. 0.22). Used when scoring after dossier. */
  irr5yrPct?: number | null;
  /** Number of rent-stabilized units (deduct points per unit). Default 0. */
  rentStabilizedUnitCount?: number;
}

export interface ComputeDealSignalsOutput {
  /** Params to persist to deal_signals. */
  insertParams: InsertDealSignalsParams;
  /** Full scoring result (positive/negative signals, component scores). */
  scoringResult: DealScoringResult;
}

function unitCountFromDetails(details: PropertyDetails | null): number | null {
  if (!details?.rentalFinancials) return null;
  const rf = details.rentalFinancials as RentalFinancials;
  const rapid = rf.rentalUnits ?? [];
  const om = rf.fromLlm?.rentalNumbersPerUnit ?? [];
  const n = rapid.length > 0 ? rapid.length : om.length;
  return n > 0 ? n : null;
}

function noiFromDetails(details: PropertyDetails | null): number | null {
  const noi = details?.rentalFinancials?.fromLlm?.noi;
  if (noi != null && typeof noi === "number" && !Number.isNaN(noi)) return noi;
  return null;
}

function scoringInputFromDetails(
  purchasePrice: number | null,
  details: PropertyDetails | null,
  input: ComputeDealSignalsInput
): Parameters<typeof computeDealScore>[0] {
  const noi = noiFromDetails(details);
  const hpd = details?.enrichment?.hpd_violations_summary;
  const dob = details?.enrichment?.dob_complaints_summary;
  const lit = details?.enrichment?.housing_litigations_summary;

  return {
    purchasePrice,
    noi,
    irr5yrPct: input.irr5yrPct ?? null,
    rentStabilizedUnitCount: input.rentStabilizedUnitCount ?? 0,
    hpdTotal: hpd?.total,
    hpdOpenCount: hpd?.openCount,
    hpdRentImpairingOpen: hpd?.rentImpairingOpen,
    dobOpenCount: dob?.openCount,
    dobCount30: dob?.count30,
    dobCount365: dob?.count365,
    litigationTotal: lit?.total,
    litigationOpenCount: lit?.openCount,
    litigationTotalPenalty: lit?.totalPenalty,
  };
}

/**
 * Compute deal signals and score (deterministic fallback). Returns insert params and scoring result.
 */
export function computeDealSignals(input: ComputeDealSignalsInput): ComputeDealSignalsOutput {
  const { propertyId, details, primaryListing, rentStabilizedUnitCount } = input;
  const price = primaryListing.price && primaryListing.price > 0 ? primaryListing.price : null;
  const unitCount = unitCountFromDetails(details);

  const scoringInput = scoringInputFromDetails(price, details, {
    ...input,
    rentStabilizedUnitCount: rentStabilizedUnitCount ?? 0,
  });

  const scoringResult = computeDealScore(scoringInput);

  const pricePerUnit =
    price != null && unitCount != null && unitCount > 0 ? price / unitCount : null;
  const yieldSpread =
    scoringResult.adjustedCapRate != null && scoringResult.assetCapRate != null
      ? scoringResult.adjustedCapRate - scoringResult.assetCapRate
      : null;

  const insertParams: InsertDealSignalsParams = {
    propertyId,
    pricePerUnit: pricePerUnit ?? undefined,
    pricePsf: undefined,
    assetCapRate: scoringResult.assetCapRate ?? undefined,
    adjustedCapRate: scoringResult.adjustedCapRate ?? undefined,
    yieldSpread: yieldSpread ?? undefined,
    rentUpside: undefined,
    rentPsfRatio: undefined,
    expenseRatio: undefined,
    liquidityScore: undefined,
    riskScore: scoringResult.riskScore ?? undefined,
    priceMomentum: undefined,
    dealScore: scoringResult.dealScore ?? undefined,
  };

  return { insertParams, scoringResult };
}
