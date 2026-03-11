/**
 * Compute deal signals and deterministic deal score from property details + primary listing.
 */

import {
  deriveListingActivitySummary,
  type DealRiskProfile,
  type DealScoreSensitivity,
  type PriceHistoryEntry,
  type PropertyDetails,
} from "@re-sourcing/contracts";
import { getAuthoritativeOmSnapshot, resolvePreferredOmPropertyInfo, resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import {
  resolveCurrentFinancialsFromDetails,
  resolveExpenseRowsFromDetails,
} from "../rental/currentFinancials.js";
import { getRentRollComparison } from "../rental/rentRollComparison.js";
import {
  analyzePropertyForUnderwriting,
  resolveNormalizedUnderwritingRentRows,
} from "./propertyAssumptions.js";
import {
  computeDealScore,
  type DealScoringResult,
} from "./dealScoringEngine.js";
import { resolveDossierPackageContext } from "./dossierPropertyContext.js";
import type { InsertDealSignalsParams } from "@re-sourcing/db";

export interface PropertyListingInput {
  price: number | null;
  city: string | null;
  listedAt?: string | null;
  priceHistory?: PriceHistoryEntry[] | null;
}

export interface ComputeDealSignalsInput {
  propertyId: string;
  canonicalAddress: string | null;
  details: PropertyDetails | null;
  primaryListing: PropertyListingInput;
  irrPct?: number | null;
  cocPct?: number | null;
  equityMultiple?: number | null;
  adjustedCapRatePct?: number | null;
  adjustedNoi?: number | null;
  recommendedOfferHigh?: number | null;
  blendedRentUpliftPct?: number | null;
  annualExpenseGrowthPct?: number | null;
  vacancyPct?: number | null;
  exitCapRatePct?: number | null;
  rentStabilizedUnitCount?: number;
  commercialUnitCount?: number;
  scoreSensitivity?: DealScoreSensitivity | null;
}

export interface ComputeDealSignalsOutput {
  insertParams: InsertDealSignalsParams;
  scoringResult: DealScoringResult;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function daysSinceIsoDate(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value}T12:00:00Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countOmDiscrepancies(details: PropertyDetails | null): number {
  const flags = getAuthoritativeOmSnapshot(details)?.validationFlags;
  if (!Array.isArray(flags)) return 0;
  return flags.filter((flag) => {
    const severity = typeof flag?.severity === "string" ? flag.severity : null;
    return severity === "warning" || severity === "error";
  }).length;
}

function hasExplicitValidationMismatch(details: PropertyDetails | null): boolean {
  const flags = getAuthoritativeOmSnapshot(details)?.validationFlags;
  if (!Array.isArray(flags)) return false;
  return flags.some((flag) => {
    const severity = typeof flag?.severity === "string" ? flag.severity : null;
    if (severity !== "warning" && severity !== "error") return false;
    const message = typeof flag?.message === "string" ? flag.message.toLowerCase() : "";
    return (
      flag?.externalValue != null ||
      /mismatch|conflict|disagree|verify/.test(message)
    );
  });
}

function annualTaxFromDetails(details: PropertyDetails | null): number | null {
  const assessedTax = toFiniteNumber(details?.assessedTaxBeforeTotal);
  if (assessedTax != null && assessedTax > 0) return assessedTax;
  const monthlyTax = toFiniteNumber(details?.monthlyTax);
  if (monthlyTax != null && monthlyTax > 0) return monthlyTax * 12;
  return null;
}

function riskProfileFromDetails(
  details: PropertyDetails | null,
  canonicalAddress: string | null,
  blendedRentUpliftPct: number | null | undefined
): DealRiskProfile {
  const currentFinancials = resolveCurrentFinancialsFromDetails(details);
  const propertyMix = analyzePropertyForUnderwriting(details);
  const rentRows = resolveNormalizedUnderwritingRentRows(details);
  const expectedUnitCount = resolvePreferredOmUnitCount(details) ?? propertyMix.totalUnits ?? null;
  const usableRows = rentRows.filter((row) => row.annualRent != null && row.annualRent > 0);
  const totalAnnualRent = propertyMix.totalAnnualRent ?? currentFinancials.grossRentalIncome ?? null;
  const usableRentRowsCount = usableRows.length;
  const rentRowsCount = rentRows.length;
  const rentRollCoveragePct =
    expectedUnitCount != null && expectedUnitCount > 0
      ? usableRentRowsCount / expectedUnitCount
      : rentRowsCount > 0
        ? usableRentRowsCount / rentRowsCount
        : null;
  const largestUnitRevenueSharePct =
    totalAnnualRent != null && totalAnnualRent > 0 && usableRows.length > 0
      ? Math.max(...usableRows.map((row) => row.annualRent ?? 0)) / totalAnnualRent
      : null;
  const now = new Date();
  const rolloverBoundary = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const rolloverAnnualRent =
    totalAnnualRent != null && totalAnnualRent > 0
      ? usableRows.reduce((sum, row) => {
          const leaseEnd = parseIsoDate(row.leaseEndDate);
          if (!leaseEnd) return sum;
          if (leaseEnd < now || leaseEnd > rolloverBoundary) return sum;
          return sum + (row.annualRent ?? 0);
        }, 0)
      : 0;
  const missingLeaseCount = rentRows.filter((row) => row.leaseEndDate == null).length;
  const missingOccupancyCount = rentRows.filter((row) => !row.hasOccupancyData).length;
  const rentRollComparison = getRentRollComparison(details);
  const annualTax = annualTaxFromDetails(details);
  const commercialAnnualRent = propertyMix.commercialAnnualRent ?? null;
  const rentStabilizedAnnualRent = propertyMix.rentStabilizedAnnualRent ?? null;
  const taxBurdenPct =
    annualTax != null &&
    currentFinancials.effectiveGrossIncome != null &&
    currentFinancials.effectiveGrossIncome > 0
      ? annualTax / currentFinancials.effectiveGrossIncome
      : null;
  const coverage = rentRollCoveragePct != null ? Math.min(1, Math.max(0, rentRollCoveragePct)) : 1;
  const packageOm = canonicalAddress ? resolveDossierPackageContext(canonicalAddress, details).isPackage : false;
  const enrichment = details?.enrichment;

  return {
    commercialRevenueSharePct:
      totalAnnualRent != null && totalAnnualRent > 0 && commercialAnnualRent != null
        ? commercialAnnualRent / totalAnnualRent
        : null,
    rentStabilizedRevenueSharePct:
      totalAnnualRent != null && totalAnnualRent > 0 && rentStabilizedAnnualRent != null
        ? rentStabilizedAnnualRent / totalAnnualRent
        : null,
    largestUnitRevenueSharePct,
    rollover12moRevenueSharePct:
      totalAnnualRent != null && totalAnnualRent > 0 ? rolloverAnnualRent / totalAnnualRent : null,
    rentRollCoveragePct,
    omDiscrepancyCount: countOmDiscrepancies(details),
    rapidOmMismatch: rentRollComparison != null ? !rentRollComparison.comparable : false,
    taxBurdenPct,
    unsupportedRentGrowthPct: Math.max(0, blendedRentUpliftPct ?? 0) * (1 - coverage),
    missingLeaseDataPct: rentRowsCount > 0 ? missingLeaseCount / rentRowsCount : null,
    missingOccupancyDataPct: rentRowsCount > 0 ? missingOccupancyCount / rentRowsCount : null,
    missingLeaseDataMajority: rentRowsCount > 0 && missingLeaseCount / rentRowsCount > 0.5,
    missingOccupancyDataMajority: rentRowsCount > 0 && missingOccupancyCount / rentRowsCount > 0.5,
    smallAssetRiskLevel:
      expectedUnitCount != null && expectedUnitCount < 5
        ? "under_5"
        : expectedUnitCount != null && expectedUnitCount < 10
          ? "5_to_9"
          : "none",
    isPackageOm: packageOm,
    missingEnrichmentGroup:
      !enrichment?.hpd_violations_summary &&
      !enrichment?.dob_complaints_summary &&
      !enrichment?.housing_litigations_summary,
    explicitRecordMismatch: hasExplicitValidationMismatch(details),
    totalUnits: expectedUnitCount,
    usableRentRowsCount,
    rentRowsCount,
  };
}

function grossBuildingSqft(details: PropertyDetails | null): number | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  return (
    toFiniteNumber(propertyInfo?.buildingSqft) ??
    toFiniteNumber(propertyInfo?.buildingSquareFeet) ??
    toFiniteNumber(propertyInfo?.grossSqft) ??
    toFiniteNumber(propertyInfo?.grossSquareFeet) ??
    toFiniteNumber(propertyInfo?.squareFeet) ??
    toFiniteNumber(details?.assessedGrossSqft)
  );
}

function scoringInputFromDetails(
  purchasePrice: number | null,
  details: PropertyDetails | null,
  input: ComputeDealSignalsInput,
  listingActivity: ReturnType<typeof deriveListingActivitySummary>,
  riskProfile: DealRiskProfile
): Parameters<typeof computeDealScore>[0] {
  const currentFinancials = resolveCurrentFinancialsFromDetails(details);
  const expenseRows = resolveExpenseRowsFromDetails(details);
  const hpd = details?.enrichment?.hpd_violations_summary;
  const dob = details?.enrichment?.dob_complaints_summary;
  const lit = details?.enrichment?.housing_litigations_summary;

  return {
    purchasePrice,
    noi: currentFinancials.noi,
    grossRentalIncome: currentFinancials.grossRentalIncome,
    irrPct: input.irrPct ?? null,
    cocPct: input.cocPct ?? null,
    equityMultiple: input.equityMultiple ?? null,
    adjustedCapRatePct: input.adjustedCapRatePct ?? null,
    adjustedNoi: input.adjustedNoi ?? null,
    recommendedOfferHigh: input.recommendedOfferHigh ?? null,
    blendedRentUpliftPct: input.blendedRentUpliftPct ?? null,
    annualExpenseGrowthPct: input.annualExpenseGrowthPct ?? null,
    vacancyPct: input.vacancyPct ?? null,
    exitCapRatePct: input.exitCapRatePct ?? null,
    hasDetailedExpenseRows: expenseRows.length > 0,
    totalUnits: riskProfile.totalUnits ?? null,
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
    riskProfile,
  };
}

export function computeDealSignals(input: ComputeDealSignalsInput): ComputeDealSignalsOutput {
  const { propertyId, details, primaryListing, blendedRentUpliftPct } = input;
  const price = primaryListing.price && primaryListing.price > 0 ? primaryListing.price : null;
  const unitCount = resolvePreferredOmUnitCount(details);
  const currentFinancials = resolveCurrentFinancialsFromDetails(details);
  const listingActivity = deriveListingActivitySummary({
    listedAt: primaryListing.listedAt ?? null,
    currentPrice: price,
    priceHistory: primaryListing.priceHistory ?? null,
  });
  const riskProfile = riskProfileFromDetails(details, input.canonicalAddress, blendedRentUpliftPct);

  const scoringInput = scoringInputFromDetails(price, details, input, listingActivity, riskProfile);
  const scoringResult = computeDealScore(scoringInput);

  const pricePerUnit = price != null && unitCount != null && unitCount > 0 ? price / unitCount : null;
  const buildingSqft = grossBuildingSqft(details);
  const pricePsf = price != null && buildingSqft != null && buildingSqft > 0 ? price / buildingSqft : null;
  const yieldSpread =
    scoringResult.adjustedCapRate != null && scoringResult.assetCapRate != null
      ? scoringResult.adjustedCapRate - scoringResult.assetCapRate
      : null;
  const expenseRatio =
    currentFinancials.operatingExpenses != null &&
    currentFinancials.effectiveGrossIncome != null &&
    currentFinancials.effectiveGrossIncome > 0
      ? (currentFinancials.operatingExpenses / currentFinancials.effectiveGrossIncome) * 100
      : null;

  const insertParams: InsertDealSignalsParams = {
    propertyId,
    pricePerUnit: pricePerUnit ?? undefined,
    pricePsf: pricePsf ?? undefined,
    assetCapRate: scoringResult.assetCapRate ?? undefined,
    adjustedCapRate: scoringResult.adjustedCapRate ?? undefined,
    yieldSpread: yieldSpread ?? undefined,
    rentUpside: blendedRentUpliftPct ?? undefined,
    rentPsfRatio: undefined,
    expenseRatio: expenseRatio ?? undefined,
    liquidityScore: scoringResult.liquidityScore ?? undefined,
    riskScore: scoringResult.riskScore ?? undefined,
    priceMomentum: listingActivity?.latestPriceChangePercent ?? undefined,
    dealScore: scoringResult.isScoreable ? scoringResult.dealScore : undefined,
    scoreBreakdown: scoringResult.scoreBreakdown,
    riskProfile: scoringResult.riskProfile,
    riskFlags: scoringResult.riskFlags,
    capReasons: scoringResult.capReasons,
    confidenceScore: scoringResult.confidenceScore,
    scoreSensitivity: input.scoreSensitivity ?? undefined,
    scoreVersion: scoringResult.scoreVersion,
  };

  return { insertParams, scoringResult };
}
