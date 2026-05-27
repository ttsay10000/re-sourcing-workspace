import type { OmAnalysis, PropertyDetails } from "@re-sourcing/contracts";
import { getAuthoritativeOmSnapshot } from "../om/authoritativeOm.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

export function resolveOmAskingPriceFromAnalysis(
  omAnalysis: OmAnalysis | null | undefined
): number | null {
  const propertyInfo = asRecord(omAnalysis?.propertyInfo);
  const valuationMetrics = asRecord(omAnalysis?.valuationMetrics);
  const uiFinancialSummary = asRecord(omAnalysis?.uiFinancialSummary);
  return firstFiniteNumber(
    propertyInfo?.price,
    propertyInfo?.askingPrice,
    propertyInfo?.listedPrice,
    propertyInfo?.askPrice,
    valuationMetrics?.price,
    valuationMetrics?.askingPrice,
    valuationMetrics?.listedPrice,
    valuationMetrics?.askPrice,
    uiFinancialSummary?.askingPrice
  );
}

export function resolveOmAskingPriceFromDetails(
  details: PropertyDetails | null | undefined
): number | null {
  const authoritative = getAuthoritativeOmSnapshot(details);
  const propertyInfo = asRecord(authoritative?.propertyInfo);
  const valuationMetrics = asRecord(authoritative?.valuationMetrics);
  const uiFinancialSummary = asRecord(authoritative?.uiFinancialSummary);
  return (
    firstFiniteNumber(
      propertyInfo?.price,
      propertyInfo?.askingPrice,
      propertyInfo?.listedPrice,
      propertyInfo?.askPrice,
      valuationMetrics?.price,
      valuationMetrics?.askingPrice,
      valuationMetrics?.listedPrice,
      valuationMetrics?.askPrice,
      uiFinancialSummary?.askingPrice
    ) ?? resolveOmAskingPriceFromAnalysis(details?.rentalFinancials?.omAnalysis)
  );
}
