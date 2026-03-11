import type { PropertyDetails } from "@re-sourcing/contracts";
import {
  resolvePreferredOmPropertyInfo,
  resolvePreferredOmRentRoll,
  resolvePreferredOmRevenueComposition,
} from "../om/authoritativeOm.js";

const COMMERCIAL_PATTERN =
  /\b(commercial|retail|office|storefront|store front|restaurant|cafe|gallery|medical|community facility)\b/i;
const RENT_STABILIZED_PATTERN = /(rent[\s-]*(?:stabilized|stabilised|controlled?)|\bRS\b)/i;

export interface NormalizedUnderwritingRentRow {
  annualRent: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  isCommercial: boolean;
  isRentStabilized: boolean;
  leaseEndDate: string | null;
  hasOccupancyData: boolean;
}

export interface UnderwritingPropertyMixSummary {
  totalUnits: number | null;
  residentialUnits: number;
  eligibleResidentialUnits: number;
  commercialUnits: number;
  rentStabilizedUnits: number;
  totalAnnualRent: number | null;
  commercialAnnualRent: number | null;
  rentStabilizedAnnualRent: number | null;
  freeMarketAnnualRent: number | null;
  eligibleAnnualRent: number | null;
  protectedAnnualRent: number | null;
  eligibleRevenueSharePct: number | null;
  eligibleUnitSharePct: number | null;
  furnishingSetupCostEstimate: number;
}

interface MetricStats {
  total: number;
  count: number;
  average: number | null;
}

const DEFAULT_FURNISHING_BASE_PER_UNIT = 8_000;
const DEFAULT_FURNISHING_BEDROOM_COST = 1_000;
const DEFAULT_FURNISHING_BATHROOM_COST = 750;
const DEFAULT_FURNISHING_BEDROOMS_PER_UNIT = 1;
const DEFAULT_FURNISHING_BATHS_PER_UNIT = 1;
const DEFAULT_FURNISHING_UNIT_SQFT = 900;
const MAX_FURNISHING_COST_PER_UNIT = 30_000;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function annualRentFromRecord(record: Record<string, unknown>): number | null {
  const annual =
    toFiniteNumber(record.annualTotalRent) ??
    toFiniteNumber(record.annualBaseRent) ??
    toFiniteNumber(record.annualRent);
  if (annual != null && annual > 0) return annual;

  const monthly =
    toFiniteNumber(record.monthlyTotalRent) ??
    toFiniteNumber(record.monthlyBaseRent) ??
    toFiniteNumber(record.monthlyRent) ??
    toFiniteNumber(record.rent);
  if (monthly != null && monthly > 0) return monthly * 12;

  return null;
}

function classificationText(record: Record<string, unknown>): string {
  return [
    record.unitCategory,
    record.tenantName,
    record.rentType,
    record.tenantStatus,
    record.leaseType,
    record.notes,
    record.note,
    record.unit,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

export function resolveNormalizedUnderwritingRentRows(
  details: PropertyDetails | null
): NormalizedUnderwritingRentRow[] {
  const omRoll = resolvePreferredOmRentRoll(details);
  if (Array.isArray(omRoll) && omRoll.length > 0) {
    return omRoll.map((row) => {
      const record = row as Record<string, unknown>;
      const labels = classificationText(record);
      return {
        annualRent: annualRentFromRecord(record),
        beds: toFiniteNumber(record.beds),
        baths: toFiniteNumber(record.baths),
        sqft: toFiniteNumber(record.sqft),
        isCommercial: COMMERCIAL_PATTERN.test(labels),
        isRentStabilized: RENT_STABILIZED_PATTERN.test(labels),
        leaseEndDate:
          typeof record.leaseEndDate === "string" && record.leaseEndDate.trim().length > 0
            ? record.leaseEndDate.trim()
            : null,
        hasOccupancyData: record.occupied != null || typeof record.tenantStatus === "string",
      };
    });
  }

  return [];
}

function roundCurrency(value: number): number {
  return Math.max(0, Math.round(value / 500) * 500);
}

function collectMetricStats(
  rows: NormalizedUnderwritingRentRow[],
  pickValue: (row: NormalizedUnderwritingRentRow) => number | null
): MetricStats {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const value = pickValue(row);
    if (value == null || !Number.isFinite(value) || value < 0) continue;
    total += value;
    count += 1;
  }
  return {
    total,
    count,
    average: count > 0 ? total / count : null,
  };
}

function estimateMetricTotal(
  known: MetricStats,
  unitCount: number,
  fallbackAveragePerUnit: number
): number {
  if (unitCount <= 0) return 0;
  const knownUnits = Math.min(unitCount, known.count);
  const fillAverage =
    known.average != null && Number.isFinite(known.average) ? known.average : fallbackAveragePerUnit;
  return known.total + Math.max(0, unitCount - knownUnits) * Math.max(0, fillAverage);
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

function furnishingSqftPremiumPerUnit(avgUnitSqft: number | null): number {
  if (avgUnitSqft == null || !Number.isFinite(avgUnitSqft)) return 0;
  const sqft = Math.max(0, avgUnitSqft);
  if (sqft <= 500) return 0;
  if (sqft <= 1_500) return sqft - 500;
  if (sqft <= 2_500) return 1_000 + (sqft - 1_500) * 11;
  return 12_000 + Math.min(8_000, (sqft - 2_500) * 8);
}

export function computeBlendedRentUpliftPct(
  baseRentUpliftPct: number,
  propertyMix: Pick<UnderwritingPropertyMixSummary, "eligibleRevenueSharePct" | "eligibleUnitSharePct"> | null | undefined
): number {
  const base = Number.isFinite(baseRentUpliftPct) ? Math.max(0, baseRentUpliftPct) : 0;
  if (!propertyMix) return base;
  const share =
    propertyMix.eligibleRevenueSharePct != null && Number.isFinite(propertyMix.eligibleRevenueSharePct)
      ? propertyMix.eligibleRevenueSharePct
      : propertyMix.eligibleUnitSharePct != null && Number.isFinite(propertyMix.eligibleUnitSharePct)
        ? propertyMix.eligibleUnitSharePct
        : 1;
  return base * Math.max(0, Math.min(1, share));
}

export function analyzePropertyForUnderwriting(
  details: PropertyDetails | null
): UnderwritingPropertyMixSummary {
  const rows = resolveNormalizedUnderwritingRentRows(details);
  const residentialRows = rows.filter((row) => !row.isCommercial);
  const rowCommercialUnits = rows.filter((row) => row.isCommercial).length;
  const rowResidentialUnits = residentialRows.length;
  const rowRentStabilizedUnits = residentialRows.filter((row) => row.isRentStabilized).length;
  const rowEligibleUnits = residentialRows.filter((row) => !row.isRentStabilized);
  const rowCommercialAnnualRent = rows
    .filter((row) => row.isCommercial)
    .reduce((sum, row) => sum + (row.annualRent ?? 0), 0);
  const rowRentStabilizedAnnualRent = residentialRows
    .filter((row) => row.isRentStabilized)
    .reduce((sum, row) => sum + (row.annualRent ?? 0), 0);

  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const revenueComposition = resolvePreferredOmRevenueComposition(details);

  const infoTotalUnits = toFiniteNumber(propertyInfo?.totalUnits);
  const infoResidentialUnits = toFiniteNumber(propertyInfo?.unitsResidential);
  const infoCommercialUnits = toFiniteNumber(propertyInfo?.unitsCommercial);
  const revenueCommercialUnits = toFiniteNumber(revenueComposition?.commercialUnits);
  const revenueRentStabilizedUnits = toFiniteNumber(revenueComposition?.rentStabilizedUnits);
  const revenueFreeMarketUnits = toFiniteNumber(revenueComposition?.freeMarketUnits);

  const totalUnitsCandidates = [
    rows.length > 0 ? rows.length : null,
    infoTotalUnits,
    revenueFreeMarketUnits != null || revenueRentStabilizedUnits != null || revenueCommercialUnits != null
      ? (revenueFreeMarketUnits ?? 0) + (revenueRentStabilizedUnits ?? 0) + (revenueCommercialUnits ?? 0)
      : null,
  ].filter((value): value is number => value != null && value > 0);
  const totalUnits = totalUnitsCandidates.length > 0 ? Math.max(...totalUnitsCandidates) : null;

  let commercialUnits = Math.max(
    rowCommercialUnits,
    Math.round(infoCommercialUnits ?? 0),
    Math.round(revenueCommercialUnits ?? 0)
  );
  if (totalUnits != null) commercialUnits = Math.min(totalUnits, commercialUnits);

  let residentialUnits = Math.max(
    rowResidentialUnits,
    Math.round(infoResidentialUnits ?? 0),
    totalUnits != null ? Math.max(0, totalUnits - commercialUnits) : 0
  );
  if (totalUnits != null && residentialUnits + commercialUnits > totalUnits) {
    residentialUnits = Math.max(0, totalUnits - commercialUnits);
  }

  let rentStabilizedUnits = Math.max(
    rowRentStabilizedUnits,
    Math.round(revenueRentStabilizedUnits ?? 0)
  );
  rentStabilizedUnits = Math.min(residentialUnits, rentStabilizedUnits);

  const eligibleResidentialUnits = Math.max(0, residentialUnits - rentStabilizedUnits);

  const rowTotalAnnualRent = rows.reduce((sum, row) => sum + (row.annualRent ?? 0), 0);
  const rowEligibleAnnualRent = rowEligibleUnits.reduce((sum, row) => sum + (row.annualRent ?? 0), 0);
  const revenueResidentialAnnualRent = toFiniteNumber(revenueComposition?.residentialAnnualRent);
  const revenueCommercialAnnualRent = toFiniteNumber(revenueComposition?.commercialAnnualRent);

  const fallbackTotalAnnualRent =
    (revenueResidentialAnnualRent ?? 0) + (revenueCommercialAnnualRent ?? 0) > 0
      ? (revenueResidentialAnnualRent ?? 0) + (revenueCommercialAnnualRent ?? 0)
      : null;
  const totalAnnualRent = rowTotalAnnualRent > 0 ? rowTotalAnnualRent : fallbackTotalAnnualRent;

  let eligibleAnnualRent = rowEligibleAnnualRent > 0 ? rowEligibleAnnualRent : null;
  if ((eligibleAnnualRent == null || eligibleAnnualRent <= 0) && revenueResidentialAnnualRent != null) {
    const eligibleResidentialShare =
      residentialUnits > 0
        ? Math.max(
            0,
            Math.min(
              1,
              (revenueFreeMarketUnits ?? eligibleResidentialUnits) / residentialUnits
            )
          )
        : 0;
    eligibleAnnualRent = revenueResidentialAnnualRent * eligibleResidentialShare;
  }
  if (totalAnnualRent != null && eligibleAnnualRent != null) {
    eligibleAnnualRent = Math.min(totalAnnualRent, Math.max(0, eligibleAnnualRent));
  }

  const protectedAnnualRent =
    totalAnnualRent != null && eligibleAnnualRent != null
      ? Math.max(0, totalAnnualRent - eligibleAnnualRent)
      : null;
  const commercialAnnualRent =
    rowCommercialAnnualRent > 0
      ? rowCommercialAnnualRent
      : revenueCommercialAnnualRent != null
        ? revenueCommercialAnnualRent
        : null;
  const rentStabilizedAnnualRent =
    rowRentStabilizedAnnualRent > 0
      ? rowRentStabilizedAnnualRent
      : protectedAnnualRent != null && commercialAnnualRent != null
        ? Math.max(0, protectedAnnualRent - commercialAnnualRent)
        : protectedAnnualRent;
  const freeMarketAnnualRent =
    totalAnnualRent != null && commercialAnnualRent != null && rentStabilizedAnnualRent != null
      ? Math.max(0, totalAnnualRent - commercialAnnualRent - rentStabilizedAnnualRent)
      : eligibleAnnualRent;
  const eligibleRevenueSharePct =
    totalAnnualRent != null && totalAnnualRent > 0 && eligibleAnnualRent != null
      ? eligibleAnnualRent / totalAnnualRent
      : null;
  const eligibleUnitSharePct =
    totalUnits != null && totalUnits > 0 ? eligibleResidentialUnits / totalUnits : null;

  const furnishingEligibleUnits = Math.max(rowEligibleUnits.length, eligibleResidentialUnits);
  const eligibleBedroomStats = collectMetricStats(rowEligibleUnits, (row) =>
    row.beds != null ? Math.max(0, Math.round(row.beds)) : null
  );
  const residentialBedroomStats = collectMetricStats(residentialRows, (row) =>
    row.beds != null ? Math.max(0, Math.round(row.beds)) : null
  );
  const totalEligibleBedrooms = Math.round(
    estimateMetricTotal(
      eligibleBedroomStats,
      furnishingEligibleUnits,
      residentialBedroomStats.average ?? DEFAULT_FURNISHING_BEDROOMS_PER_UNIT
    )
  );

  const eligibleBathroomStats = collectMetricStats(rowEligibleUnits, (row) =>
    row.baths != null ? Math.max(0, row.baths) : null
  );
  const residentialBathroomStats = collectMetricStats(residentialRows, (row) =>
    row.baths != null ? Math.max(0, row.baths) : null
  );
  const totalEligibleBathrooms = estimateMetricTotal(
    eligibleBathroomStats,
    furnishingEligibleUnits,
    residentialBathroomStats.average ?? DEFAULT_FURNISHING_BATHS_PER_UNIT
  );

  const eligibleSqftStats = collectMetricStats(rowEligibleUnits, (row) =>
    row.sqft != null ? Math.max(0, row.sqft) : null
  );
  const residentialSqftStats = collectMetricStats(residentialRows, (row) =>
    row.sqft != null ? Math.max(0, row.sqft) : null
  );
  const residentialAreaSqft = firstFiniteNumber(
    propertyInfo?.residentialSqft,
    propertyInfo?.residentialSquareFeet,
    details?.assessedResidentialAreaGross
  );
  const grossBuildingSqft = firstFiniteNumber(
    propertyInfo?.buildingSqft,
    propertyInfo?.buildingSquareFeet,
    propertyInfo?.grossSqft,
    propertyInfo?.grossSquareFeet,
    propertyInfo?.squareFeet,
    details?.assessedGrossSqft
  );
  const fallbackAvgEligibleUnitSqft =
    residentialSqftStats.average ??
    (residentialAreaSqft != null && residentialUnits > 0 ? residentialAreaSqft / residentialUnits : null) ??
    (grossBuildingSqft != null
      ? grossBuildingSqft /
        (totalUnits != null && totalUnits > 0 ? totalUnits : residentialUnits > 0 ? residentialUnits : 1)
      : null) ??
    eligibleSqftStats.average ??
    DEFAULT_FURNISHING_UNIT_SQFT;
  const knownEligibleSqftUnits = Math.min(furnishingEligibleUnits, eligibleSqftStats.count);
  const estimatedEligibleSqft =
    eligibleSqftStats.total + Math.max(0, furnishingEligibleUnits - knownEligibleSqftUnits) * fallbackAvgEligibleUnitSqft;
  const avgEligibleUnitSqft =
    furnishingEligibleUnits > 0 ? estimatedEligibleSqft / furnishingEligibleUnits : null;
  const sqftPremium = furnishingEligibleUnits * furnishingSqftPremiumPerUnit(avgEligibleUnitSqft);
  const furnishingSetupCostEstimate =
    furnishingEligibleUnits > 0
      ? roundCurrency(
          Math.min(
            furnishingEligibleUnits * MAX_FURNISHING_COST_PER_UNIT,
            furnishingEligibleUnits * DEFAULT_FURNISHING_BASE_PER_UNIT +
              totalEligibleBedrooms * DEFAULT_FURNISHING_BEDROOM_COST +
              totalEligibleBathrooms * DEFAULT_FURNISHING_BATHROOM_COST +
              sqftPremium
          )
        )
      : 0;

  return {
    totalUnits,
    residentialUnits,
    eligibleResidentialUnits,
    commercialUnits,
    rentStabilizedUnits,
    totalAnnualRent,
    commercialAnnualRent,
    rentStabilizedAnnualRent,
    freeMarketAnnualRent,
    eligibleAnnualRent,
    protectedAnnualRent,
    eligibleRevenueSharePct,
    eligibleUnitSharePct,
    furnishingSetupCostEstimate,
  };
}
