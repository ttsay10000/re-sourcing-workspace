import type { PropertyDetails } from "@re-sourcing/contracts";

const COMMERCIAL_PATTERN =
  /\b(commercial|retail|office|storefront|store front|restaurant|cafe|gallery|medical|community facility)\b/i;
const RENT_STABILIZED_PATTERN = /(rent[\s-]*(?:stabilized|stabilised|controlled?)|\bRS\b)/i;

interface NormalizedRentRow {
  annualRent: number | null;
  beds: number | null;
  sqft: number | null;
  isCommercial: boolean;
  isRentStabilized: boolean;
}

export interface UnderwritingPropertyMixSummary {
  totalUnits: number | null;
  residentialUnits: number;
  eligibleResidentialUnits: number;
  commercialUnits: number;
  rentStabilizedUnits: number;
  totalAnnualRent: number | null;
  eligibleAnnualRent: number | null;
  protectedAnnualRent: number | null;
  eligibleRevenueSharePct: number | null;
  eligibleUnitSharePct: number | null;
  furnishingSetupCostEstimate: number;
}

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

function normalizeRows(details: PropertyDetails | null): NormalizedRentRow[] {
  const omRoll = details?.rentalFinancials?.omAnalysis?.rentRoll;
  if (Array.isArray(omRoll) && omRoll.length > 0) {
    return omRoll.map((row) => {
      const record = row as Record<string, unknown>;
      const labels = classificationText(record);
      return {
        annualRent: annualRentFromRecord(record),
        beds: toFiniteNumber(record.beds),
        sqft: toFiniteNumber(record.sqft),
        isCommercial: COMMERCIAL_PATTERN.test(labels),
        isRentStabilized: RENT_STABILIZED_PATTERN.test(labels),
      };
    });
  }

  const llmRoll = details?.rentalFinancials?.fromLlm?.rentalNumbersPerUnit;
  if (Array.isArray(llmRoll) && llmRoll.length > 0) {
    return llmRoll.map((row) => {
      const record = row as Record<string, unknown>;
      const labels = classificationText(record);
      return {
        annualRent: annualRentFromRecord(record),
        beds: toFiniteNumber(record.beds),
        sqft: toFiniteNumber(record.sqft),
        isCommercial: COMMERCIAL_PATTERN.test(labels),
        isRentStabilized: RENT_STABILIZED_PATTERN.test(labels),
      };
    });
  }

  return [];
}

function roundCurrency(value: number): number {
  return Math.max(0, Math.round(value / 500) * 500);
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
  const rows = normalizeRows(details);
  const rowCommercialUnits = rows.filter((row) => row.isCommercial).length;
  const rowResidentialUnits = rows.filter((row) => !row.isCommercial).length;
  const rowRentStabilizedUnits = rows.filter((row) => !row.isCommercial && row.isRentStabilized).length;
  const rowEligibleUnits = rows.filter((row) => !row.isCommercial && !row.isRentStabilized);

  const propertyInfo =
    (details?.rentalFinancials?.omAnalysis?.propertyInfo as Record<string, unknown> | null | undefined) ??
    null;
  const revenueComposition =
    (details?.rentalFinancials?.omAnalysis?.revenueComposition as Record<string, unknown> | null | undefined) ??
    null;

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
  const eligibleRevenueSharePct =
    totalAnnualRent != null && totalAnnualRent > 0 && eligibleAnnualRent != null
      ? eligibleAnnualRent / totalAnnualRent
      : null;
  const eligibleUnitSharePct =
    totalUnits != null && totalUnits > 0 ? eligibleResidentialUnits / totalUnits : null;

  const furnishingEligibleUnits = Math.max(rowEligibleUnits.length, eligibleResidentialUnits);
  const additionalBedrooms = rowEligibleUnits.reduce((sum, row) => {
    const beds = row.beds != null ? Math.max(0, Math.round(row.beds)) : 0;
    return sum + Math.max(0, beds - 1);
  }, 0);
  const sqftPremium = rowEligibleUnits.reduce((sum, row) => {
    if (row.sqft == null || !Number.isFinite(row.sqft)) return sum;
    return sum + Math.max(0, row.sqft - 650) * 2;
  }, 0);
  const furnishingSetupCostEstimate =
    furnishingEligibleUnits > 0
      ? roundCurrency(10_000 + furnishingEligibleUnits * 3_000 + additionalBedrooms * 2_500 + sqftPremium)
      : 0;

  return {
    totalUnits,
    residentialUnits,
    eligibleResidentialUnits,
    commercialUnits,
    rentStabilizedUnits,
    totalAnnualRent,
    eligibleAnnualRent,
    protectedAnnualRent,
    eligibleRevenueSharePct,
    eligibleUnitSharePct,
    furnishingSetupCostEstimate,
  };
}
