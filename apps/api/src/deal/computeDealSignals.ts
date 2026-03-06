/**
 * Compute deal signals and deal score from property details + primary listing.
 * Persist result to deal_signals; score is available before dossier generation.
 */

import type { PropertyDetails, RentalFinancials } from "@re-sourcing/contracts";
import { getRentRollComparison } from "../rental/rentRollComparison.js";
import { cityToArea, areaFromCanonicalAddress } from "./cityToArea.js";
import { computeDealScore, type DealScoringResult } from "./dealScoringEngine.js";
import type { InsertDealSignalsParams } from "@re-sourcing/db";

export interface PropertyListingInput {
  /** Listing price (purchase price for scoring). */
  price: number | null;
  /** Listing city for location score. */
  city: string | null;
}

export interface ComputeDealSignalsInput {
  propertyId: string;
  canonicalAddress: string | null;
  details: PropertyDetails | null;
  primaryListing: PropertyListingInput;
  /** Optional: adjusted NOI from furnished rental estimator (when run). */
  adjustedNoi?: number | null;
  /** Optional: rent upside as decimal (e.g. 0.15). From furnished rental when available. */
  rentUpsidePct?: number | null;
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

function hasHpdViolations(details: PropertyDetails | null): boolean {
  const summary = details?.enrichment?.hpd_violations_summary;
  if (!summary) return false;
  const open = summary.openCount ?? summary.rentImpairingOpen ?? 0;
  const total = summary.total ?? 0;
  return open > 0 || total > 0;
}

function hasDobViolations(details: PropertyDetails | null): boolean {
  const summary = details?.enrichment?.dob_complaints_summary;
  if (!summary) return false;
  const open = summary.openCount ?? 0;
  const count30 = summary.count30 ?? 0;
  const count365 = summary.count365 ?? 0;
  return open > 0 || count30 > 0 || count365 > 0;
}

/**
 * Compute deal signals and score; returns insert params and full scoring result.
 */
export function computeDealSignals(input: ComputeDealSignalsInput): ComputeDealSignalsOutput {
  const { propertyId, canonicalAddress, details, primaryListing, adjustedNoi, rentUpsidePct } = input;
  const price = primaryListing.price && primaryListing.price > 0 ? primaryListing.price : null;
  const noi = noiFromDetails(details);
  const adjNoi = adjustedNoi ?? noi;
  const unitCount = unitCountFromDetails(details);
  const area =
    primaryListing.city != null && primaryListing.city.trim() !== ""
      ? cityToArea(primaryListing.city)
      : areaFromCanonicalAddress(canonicalAddress);
  const rentRollComparison = getRentRollComparison(details?.rentalFinancials ?? null);
  const incompleteRentRoll = rentRollComparison ? !rentRollComparison.comparable : true;

  const scoringInput = {
    purchasePrice: price,
    noi,
    adjustedNoi: adjNoi,
    rentUpsidePct: rentUpsidePct ?? null,
    area,
    unitCount,
    hasHpdViolations: hasHpdViolations(details),
    hasDobViolations: hasDobViolations(details),
    taxIrregularities: false, // TBD if we have tax data to flag
    incompleteRentRoll,
  };

  const scoringResult = computeDealScore(scoringInput);

  const pricePerUnit =
    price != null && unitCount != null && unitCount > 0 ? price / unitCount : null;
  const yieldSpread =
    scoringResult.adjustedCapRate != null && scoringResult.assetCapRate != null
      ? scoringResult.adjustedCapRate - scoringResult.assetCapRate
      : null;
  const rentUpsideForDb = rentUpsidePct != null ? rentUpsidePct * 100 : null;

  const insertParams: InsertDealSignalsParams = {
    propertyId,
    pricePerUnit: pricePerUnit ?? undefined,
    pricePsf: undefined,
    assetCapRate: scoringResult.assetCapRate ?? undefined,
    adjustedCapRate: scoringResult.adjustedCapRate ?? undefined,
    yieldSpread: yieldSpread ?? undefined,
    rentUpside: rentUpsideForDb ?? undefined,
    rentPsfRatio: undefined,
    expenseRatio: undefined,
    liquidityScore: scoringResult.liquidityScore ?? undefined,
    riskScore: scoringResult.riskScore ?? undefined,
    priceMomentum: undefined,
    dealScore: scoringResult.dealScore ?? undefined,
  };

  return { insertParams, scoringResult };
}
