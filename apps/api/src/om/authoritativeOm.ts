import type {
  ExpenseLineItem,
  OmAuthoritativeSnapshot,
  OmRentRollRow,
  PropertyDetails,
} from "@re-sourcing/contracts";
import {
  sanitizeExpenseTableRows,
  sanitizeOmRentRollRows,
} from "../rental/omAnalysisUtils.js";

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

function resolveUnitCountFromDiscrepancies(authoritative: OmAuthoritativeSnapshot | null): number | null {
  const discrepancies = authoritative?.reportedDiscrepancies;
  if (!Array.isArray(discrepancies)) return null;

  for (const discrepancy of discrepancies) {
    const field = typeof discrepancy?.field === "string" ? discrepancy.field.toLowerCase() : "";
    if (!/totalunits|unitcount|unitscommercial|unit_count/.test(field)) continue;

    const selectedValue = discrepancy?.selectedValue;
    const numeric =
      toFiniteNumber(selectedValue) ??
      (typeof selectedValue === "string" ? toFiniteNumber(selectedValue.match(/\d[\d,.]*/) ? selectedValue.match(/\d[\d,.]*/)?.[0] ?? null : null) : null);
    if (numeric != null && numeric > 0) return numeric;
  }

  return null;
}

export function getAuthoritativeOmSnapshot(
  details: PropertyDetails | null | undefined
): OmAuthoritativeSnapshot | null {
  const snapshot = details?.omData?.authoritative;
  return snapshot != null && typeof snapshot === "object" ? snapshot : null;
}

export function hasAuthoritativeOmSnapshot(
  details: PropertyDetails | null | undefined
): boolean {
  return getAuthoritativeOmSnapshot(details) != null;
}

export function resolvePreferredOmPropertyInfo(
  details: PropertyDetails | null | undefined
): Record<string, unknown> | null {
  const snapshot = getAuthoritativeOmSnapshot(details);
  return snapshot ? asRecord(snapshot.propertyInfo) : null;
}

export function resolvePreferredOmRevenueComposition(
  details: PropertyDetails | null | undefined
): Record<string, unknown> | null {
  const snapshot = getAuthoritativeOmSnapshot(details);
  return snapshot ? asRecord(snapshot.revenueComposition) : null;
}

export function resolvePreferredOmRentRoll(
  details: PropertyDetails | null | undefined
): OmRentRollRow[] {
  const snapshot = getAuthoritativeOmSnapshot(details);
  return snapshot ? sanitizeOmRentRollRows(snapshot.rentRoll ?? []) : [];
}

export function resolvePreferredOmExpenseTable(
  details: PropertyDetails | null | undefined
): ExpenseLineItem[] {
  const snapshot = getAuthoritativeOmSnapshot(details);
  return snapshot ? sanitizeExpenseTableRows(snapshot.expenses?.expensesTable ?? []) : [];
}

export function resolvePreferredOmExpenseTotal(
  details: PropertyDetails | null | undefined
): number | null {
  const authoritative = getAuthoritativeOmSnapshot(details);
  const authoritativeTotal = toFiniteNumber(authoritative?.expenses?.totalExpenses);
  if (authoritative == null) return null;
  if (authoritativeTotal != null) return authoritativeTotal;
  const authoritativeRows = sanitizeExpenseTableRows(authoritative?.expenses?.expensesTable ?? []);
  return authoritativeRows.length > 0
    ? authoritativeRows.reduce((sum, row) => sum + row.amount, 0)
    : null;
}

export function resolvePreferredOmUnitCount(
  details: PropertyDetails | null | undefined
): number | null {
  const authoritative = getAuthoritativeOmSnapshot(details);
  if (authoritative == null) return null;
  const authoritativeInfo = asRecord(authoritative?.propertyInfo);
  const declaredUnitCount =
    toFiniteNumber(authoritativeInfo?.totalUnits) ??
    toFiniteNumber(authoritativeInfo?.unitsTotal) ??
    resolveUnitCountFromDiscrepancies(authoritative);
  if (declaredUnitCount != null && declaredUnitCount > 0) return declaredUnitCount;

  const authoritativeRentRoll = sanitizeOmRentRollRows(authoritative?.rentRoll ?? []);
  return authoritativeRentRoll.length > 0 ? authoritativeRentRoll.length : null;
}
