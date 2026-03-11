/**
 * Compute deal signals and deal score from property details + primary listing.
 * Deal score is produced by the LLM when generating a dossier (dealScoringLlm); this module provides
 * the deterministic fallback (dealScoringEngine) and builds insert params for deal_signals.
 */

import { deriveListingActivitySummary, type PriceHistoryEntry } from "@re-sourcing/contracts";
import type { PropertyDetails, RentalFinancials } from "@re-sourcing/contracts";
import { computeDealScore, type DealScoringResult } from "./dealScoringEngine.js";
import type { InsertDealSignalsParams } from "@re-sourcing/db";

export interface PropertyListingInput {
  /** Listing price (purchase price for scoring). */
  price: number | null;
  /** Listing city (optional, not used in current scoring). */
  city: string | null;
  /** Original listed date for activity fallback/sorting. */
  listedAt?: string | null;
  /** Price history used to derive last activity and recent price cuts. */
  priceHistory?: PriceHistoryEntry[] | null;
}

export interface ComputeDealSignalsInput {
  propertyId: string;
  canonicalAddress: string | null;
  details: PropertyDetails | null;
  primaryListing: PropertyListingInput;
  /** Optional: hold-period IRR as decimal (e.g. 0.22). */
  irrPct?: number | null;
  /** Optional: Year 1 cash-on-cash as decimal. */
  cocPct?: number | null;
  /** Optional: stabilized cap rate at the current ask. */
  adjustedCapRatePct?: number | null;
  /** Optional: max offer that still clears the target IRR. */
  recommendedOfferHigh?: number | null;
  /** Optional: effective blended rent uplift after protected-unit exclusions. */
  blendedRentUpliftPct?: number | null;
  /** Number of rent-stabilized units (deduct points per unit). Default 0. */
  rentStabilizedUnitCount?: number;
  /** Number of commercial units. */
  commercialUnitCount?: number;
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
  const omRoll = rf.omAnalysis?.rentRoll ?? [];
  const omTotal = rf.omAnalysis?.propertyInfo?.totalUnits as number | undefined;
  const rapid = rf.rentalUnits ?? [];
  const om = rf.fromLlm?.rentalNumbersPerUnit ?? [];
  const candidates = [
    omRoll.length > 0 ? omRoll.length : null,
    omTotal != null && Number.isFinite(omTotal) ? omTotal : null,
    rapid.length > 0 ? rapid.length : null,
    om.length > 0 ? om.length : null,
  ].filter((value): value is number => value != null && value > 0);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function noiFromDetails(details: PropertyDetails | null): number | null {
  const om = details?.rentalFinancials?.omAnalysis;
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const noi =
    (ui?.noi as number | undefined) ??
    om?.noiReported ??
    (income?.NOI as number | undefined) ??
    details?.rentalFinancials?.fromLlm?.noi;
  if (noi != null && typeof noi === "number" && !Number.isNaN(noi)) return noi;
  return null;
}

function scoringInputFromDetails(
  purchasePrice: number | null,
  details: PropertyDetails | null,
  input: ComputeDealSignalsInput,
  listingActivity: ReturnType<typeof deriveListingActivitySummary>
): Parameters<typeof computeDealScore>[0] {
  const noi = noiFromDetails(details);
  const hpd = details?.enrichment?.hpd_violations_summary;
  const dob = details?.enrichment?.dob_complaints_summary;
  const lit = details?.enrichment?.housing_litigations_summary;

  return {
    purchasePrice,
    noi,
    irrPct: input.irrPct ?? null,
    cocPct: input.cocPct ?? null,
    adjustedCapRatePct: input.adjustedCapRatePct ?? null,
    recommendedOfferHigh: input.recommendedOfferHigh ?? null,
    blendedRentUpliftPct: input.blendedRentUpliftPct ?? null,
    rentStabilizedUnitCount: input.rentStabilizedUnitCount ?? 0,
    commercialUnitCount: input.commercialUnitCount ?? 0,
    hpdTotal: hpd?.total,
    hpdOpenCount: hpd?.openCount,
    hpdRentImpairingOpen: hpd?.rentImpairingOpen,
    dobOpenCount: dob?.openCount,
    dobCount30: dob?.count30,
    dobCount365: dob?.count365,
    litigationTotal: lit?.total,
    litigationOpenCount: lit?.openCount,
    litigationTotalPenalty: lit?.totalPenalty,
    latestPriceDecreasePct: listingActivity?.latestPriceDecreasePercent ?? null,
    daysSinceLatestPriceDecrease: daysSinceIsoDate(listingActivity?.latestPriceDecreaseDate ?? null),
    currentDiscountFromOriginalAskPct: listingActivity?.currentDiscountFromOriginalAskPct ?? null,
  };
}

function daysSinceIsoDate(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Compute deal signals and score (deterministic fallback). Returns insert params and scoring result.
 */
export function computeDealSignals(input: ComputeDealSignalsInput): ComputeDealSignalsOutput {
  const { propertyId, details, primaryListing, rentStabilizedUnitCount, blendedRentUpliftPct } = input;
  const price = primaryListing.price && primaryListing.price > 0 ? primaryListing.price : null;
  const unitCount = unitCountFromDetails(details);
  const listingActivity = deriveListingActivitySummary({
    listedAt: primaryListing.listedAt ?? null,
    currentPrice: price,
    priceHistory: primaryListing.priceHistory ?? null,
  });

  const scoringInput = scoringInputFromDetails(price, details, {
    ...input,
    rentStabilizedUnitCount: rentStabilizedUnitCount ?? 0,
  }, listingActivity);

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
    rentUpside: blendedRentUpliftPct ?? undefined,
    rentPsfRatio: undefined,
    expenseRatio: undefined,
    liquidityScore: undefined,
    riskScore: scoringResult.riskScore ?? undefined,
    priceMomentum: listingActivity?.latestPriceChangePercent ?? undefined,
    dealScore: scoringResult.isScoreable ? scoringResult.dealScore : undefined,
  };

  return { insertParams, scoringResult };
}
