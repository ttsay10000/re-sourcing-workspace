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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundDollar(value: number): number {
  return Math.round(value * 100) / 100;
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
    "total rentable space",
    "average total",
    "average totals",
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

function appendCorrectionNote(row: Record<string, unknown>, note: string): void {
  const current = typeof row.notes === "string" && row.notes.trim().length > 0 ? row.notes.trim() : "";
  if (current.toLowerCase().includes(note.toLowerCase())) return;
  row.notes = current ? `${current}; ${note}` : note;
}

function hasRentPsfEvidence(row: Record<string, unknown>): boolean {
  const psfKeys = [
    "rentPsf",
    "rentPSF",
    "rentPerSf",
    "rentPerSF",
    "rentPerSqft",
    "rentPerSqFt",
    "rentPerSquareFoot",
    "annualRentPsf",
  ];
  if (psfKeys.some((key) => toFiniteNumber(row[key]) != null)) return true;

  const text = [
    row.notes,
    row.note,
    row.rentType,
    row.leaseType,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ");

  return /\bpsf\b|\$?\s*\/\s*sf\b|per\s+(?:sf|square\s+foot)/i.test(text);
}

function correctRentPsfMonthlyConfusion(row: OmRentRollRow): OmRentRollRow {
  const normalized: Record<string, unknown> = { ...row };
  const sqft = toFiniteNumber(normalized.sqft);
  if (sqft == null || sqft < 100) return row;
  const rentPsfEvidence = hasRentPsfEvidence(normalized);

  const pairs = [
    ["monthlyRent", "annualRent"],
    ["monthlyBaseRent", "annualBaseRent"],
    ["monthlyTotalRent", "annualTotalRent"],
  ] as const;

  for (const [monthlyKey, annualKey] of pairs) {
    const monthly = toFiniteNumber(normalized[monthlyKey]);
    const annual = toFiniteNumber(normalized[annualKey]);
    const monthlyLooksLikeAnnualRentPsf = monthly != null && monthly > 0 && monthly <= 250;
    const annualLooksLikeAnnualRentPsf = annual != null && annual > 0 && annual <= 250;

    if (monthlyLooksLikeAnnualRentPsf) {
      const monthlyFromAnnual = annual != null && !annualLooksLikeAnnualRentPsf && annual / 12 >= 500 ? annual / 12 : null;
      const annualFromPsf = monthly * sqft;
      const monthlyFromPsf = annualFromPsf / 12;
      const canDeriveFromPsf = rentPsfEvidence || annualLooksLikeAnnualRentPsf;
      const replacement = monthlyFromAnnual ?? (canDeriveFromPsf && monthlyFromPsf >= 500 ? monthlyFromPsf : null);
      if (replacement != null && replacement > monthly * 3) {
        normalized.rentPsf = normalized.rentPsf ?? monthly;
        normalized[monthlyKey] = roundDollar(replacement);
        if (annual == null || annualLooksLikeAnnualRentPsf) normalized[annualKey] = roundDollar(annualFromPsf);
        appendCorrectionNote(normalized, "Monthly rent corrected from rent PSF using SF/annual rent context");
      }
    } else if (annualLooksLikeAnnualRentPsf) {
      const annualFromPsf = annual * sqft;
      if (annualFromPsf >= 6_000) {
        normalized.rentPsf = normalized.rentPsf ?? annual;
        normalized[annualKey] = roundDollar(annualFromPsf);
        if (monthly == null || monthly <= 250) normalized[monthlyKey] = roundDollar(annualFromPsf / 12);
        appendCorrectionNote(normalized, "Annual rent corrected from rent PSF using SF context");
      }
    }
  }

  return normalized as OmRentRollRow;
}

/**
 * Tokens that carry no unit identity: street-type words and unit prefixes.
 * Dropping them lets "219 E 59th - 2" and "219 East 59th Street - 2" collapse
 * to the same key when the extraction lists the same unit under two label styles.
 */
const UNIT_KEY_DROP_TOKENS = new Set([
  "street", "st", "avenue", "ave", "av", "road", "rd", "boulevard", "blvd",
  "place", "pl", "drive", "dr", "lane", "ln", "court", "ct", "terrace", "ter",
  "way", "apt", "apartment", "unit", "suite", "ste", "no", "num", "number",
  "floor", "fl",
]);

const UNIT_KEY_DIRECTIONS: Record<string, string> = {
  e: "east",
  w: "west",
  n: "north",
  s: "south",
};

function normalizedUnitIdentityKey(row: Record<string, unknown>): string | null {
  const raw = [row.building, row.unit]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  if (!raw) return null;
  const tokens = normalizedLabel(raw)
    .split(" ")
    .map((token) => token.replace(/^(\d+)(?:st|nd|rd|th)$/, "$1"))
    .map((token) => UNIT_KEY_DIRECTIONS[token] ?? token)
    .filter((token) => token.length > 0 && !UNIT_KEY_DROP_TOKENS.has(token));
  const key = tokens.join(" ");
  return key.length > 0 ? key : null;
}

const DUPLICATE_FINGERPRINT_RENT_KEYS = [
  "monthlyRent",
  "monthlyBaseRent",
  "monthlyTotalRent",
  "annualRent",
  "annualBaseRent",
  "annualTotalRent",
] as const;

/**
 * Identity fingerprint for duplicate detection: the normalized unit label plus
 * every rent/size/layout figure. Two rows must agree on all of them (null ==
 * null) to be treated as one unit pulled twice — identical rents on different
 * unit labels, or same label with different rents, are kept.
 */
function duplicateRentRollFingerprint(row: OmRentRollRow): string | null {
  const record = row as Record<string, unknown>;
  const unitKey = normalizedUnitIdentityKey(record);
  if (!unitKey) return null;
  const hasAnyRent = DUPLICATE_FINGERPRINT_RENT_KEYS.some((key) => toFiniteNumber(record[key]) != null);
  if (!hasAnyRent) return null;
  const figures = [
    ...DUPLICATE_FINGERPRINT_RENT_KEYS.map((key) => toFiniteNumber(record[key])),
    toFiniteNumber(record.sqft),
    toFiniteNumber(record.beds),
    toFiniteNumber(record.baths),
  ].map((value) => (value == null ? "·" : String(value)));
  return [unitKey, normalizedLabel(record.tenantName), ...figures].join("|");
}

export interface OmRentRollSanitizeStats {
  rows: OmRentRollRow[];
  /** Rows dropped because the extraction listed the same unit twice. */
  duplicateRowsRemoved: number;
  /** Unit labels of removed duplicates (capped), for validation messages. */
  duplicateExamples: string[];
}

export function sanitizeOmRentRollRowsWithStats(
  rows: OmRentRollRow[] | null | undefined
): OmRentRollSanitizeStats {
  if (!Array.isArray(rows)) return { rows: [], duplicateRowsRemoved: 0, duplicateExamples: [] };
  const cleaned = rows
    .filter(
      (row): row is OmRentRollRow =>
        !!row && !isAggregateRentRollRow(row) && !isPlaceholderRentRollRow(row)
    )
    .map((row) => correctRentPsfMonthlyConfusion(row));

  const seen = new Set<string>();
  const deduped: OmRentRollRow[] = [];
  const duplicateExamples: string[] = [];
  let duplicateRowsRemoved = 0;
  for (const row of cleaned) {
    const fingerprint = duplicateRentRollFingerprint(row);
    if (fingerprint != null && seen.has(fingerprint)) {
      duplicateRowsRemoved += 1;
      if (duplicateExamples.length < 5 && typeof row.unit === "string" && row.unit.trim()) {
        duplicateExamples.push(row.unit.trim());
      }
      continue;
    }
    if (fingerprint != null) seen.add(fingerprint);
    deduped.push(row);
  }
  return { rows: deduped, duplicateRowsRemoved, duplicateExamples };
}

export function sanitizeOmRentRollRows(rows: OmRentRollRow[] | null | undefined): OmRentRollRow[] {
  return sanitizeOmRentRollRowsWithStats(rows).rows;
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
