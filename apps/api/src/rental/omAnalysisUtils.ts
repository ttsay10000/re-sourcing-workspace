import type {
  ExpenseLineItem,
  OmRentRollRow,
  RentalNumberPerUnit,
} from "@re-sourcing/contracts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.values(value).some((entry) => hasMeaningfulValue(entry));
  return true;
}

function normalizedLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/[$#]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isAggregateRentRollLabel(value: unknown): boolean {
  const label = normalizedLabel(value);
  if (!label) return false;
  return [
    "total",
    "total income",
    "income total",
    "rent roll total",
    "total rent roll",
    "gross rent total",
    "unit total",
    "subtotal",
    "summary",
  ].includes(label);
}

export function isAggregateRentRollRow(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const labels = [
    value.unit,
    value.tenantName,
    value.building,
    value.notes,
    value.note,
  ];
  return labels.some((label) => isAggregateRentRollLabel(label));
}

export function hasStructuredRentRollDetails(value: unknown): boolean {
  if (!isPlainObject(value) || isAggregateRentRollRow(value)) return false;
  return [
    "monthlyRent",
    "annualRent",
    "monthlyBaseRent",
    "annualBaseRent",
    "monthlyTotalRent",
    "annualTotalRent",
    "beds",
    "baths",
    "sqft",
    "tenantName",
    "leaseStartDate",
    "leaseEndDate",
    "lastRentedDate",
    "dateVacant",
    "reimbursementAmount",
  ].some((key) => hasMeaningfulValue(value[key]));
}

export function isPlaceholderRentRollRow(value: unknown): boolean {
  if (!isPlainObject(value) || isAggregateRentRollRow(value)) return false;
  const unitLabel = normalizedLabel(value.unit);
  const note = [value.notes, value.note]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ");
  const noStructuredDetails = !hasStructuredRentRollDetails(value);
  const genericUnit = /^unit \d+[a-z]?$/.test(unitLabel);
  return noStructuredDetails && (
    /placeholder|match stated unit count|does not provide a unit-level rent roll|rent tbd/i.test(note) ||
    genericUnit
  );
}

function rowQualityScore(row: unknown): number {
  if (!isPlainObject(row) || isAggregateRentRollRow(row)) return -5;
  let score = 0;
  if (hasStructuredRentRollDetails(row)) score += 3;
  if (hasMeaningfulValue(row.monthlyRent) || hasMeaningfulValue(row.annualRent) || hasMeaningfulValue(row.monthlyTotalRent) || hasMeaningfulValue(row.annualTotalRent)) {
    score += 3;
  }
  if (hasMeaningfulValue(row.occupied) || hasMeaningfulValue(row.lastRentedDate) || hasMeaningfulValue(row.dateVacant)) {
    score += 1;
  }
  if (isPlaceholderRentRollRow(row)) score -= 2;
  return score;
}

export function rentRollQualityScore(rows: unknown[]): number {
  return rows.reduce<number>((sum, row) => sum + rowQualityScore(row), 0);
}

export function sanitizeOmRentRollRows(rows: OmRentRollRow[] | null | undefined): OmRentRollRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is OmRentRollRow =>
      !!row && !isAggregateRentRollRow(row) && !isPlaceholderRentRollRow(row)
  );
}

export function sanitizeRentalNumberRows(
  rows: RentalNumberPerUnit[] | null | undefined
): RentalNumberPerUnit[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is RentalNumberPerUnit =>
      !!row && !isAggregateRentRollRow(row as Record<string, unknown>) && !isPlaceholderRentRollRow(row as Record<string, unknown>)
  );
}

function isAggregateExpenseLabel(value: unknown): boolean {
  const label = normalizedLabel(value);
  if (!label) return false;
  return [
    "total",
    "total expenses",
    "expense total",
    "operating expense total",
    "noi",
    "net operating income",
  ].includes(label);
}

export function sanitizeExpenseTableRows(
  rows: ExpenseLineItem[] | Array<{ lineItem?: unknown; amount?: unknown }> | null | undefined
): ExpenseLineItem[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      lineItem:
        typeof row?.lineItem === "string" && row.lineItem.trim().length > 0
          ? row.lineItem.trim()
          : "—",
      amount: typeof row?.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0,
    }))
    .filter((row) => row.amount >= 0 && !isAggregateExpenseLabel(row.lineItem));
}
