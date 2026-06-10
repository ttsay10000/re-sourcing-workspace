/**
 * Shared display formatters. One empty-value convention for the whole app:
 * a muted em dash (never a bare "-"), rendered via `EMPTY_VALUE`.
 */
export const EMPTY_VALUE = "—";

export function isMissing(value: number | null | undefined): value is null | undefined {
  return value == null || Number.isNaN(value) || !Number.isFinite(value);
}

/** $8.3M / $940K / $927 — compact for dense tables and cards. */
export function formatCurrencyCompact(value: number | null | undefined): string {
  if (isMissing(value)) return EMPTY_VALUE;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

/**
 * $6.80M / $850K — table money: two decimals in the millions so asks don't
 * collapse together, whole K under $1M, exact dollars under $1K.
 */
export function formatMoneyShort(value: number | null | undefined): string {
  if (isMissing(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

/** $8,250,000 — exact for detail surfaces. */
export function formatCurrencyExact(value: number | null | undefined): string {
  if (isMissing(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (isMissing(value)) return EMPTY_VALUE;
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (isMissing(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatDateShort(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return EMPTY_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDateTimeShort(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return EMPTY_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** snake_case / kebab-case → Title Case, with finance acronyms preserved. */
export function titleize(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bOm\b/g, "OM")
    .replace(/\bNoi\b/g, "NOI")
    .replace(/\bPsf\b/g, "PSF")
    .replace(/\bSf\b/g, "SF")
    .replace(/\bLtr\b/g, "LTR")
    .replace(/\bMtr\b/g, "MTR")
    .replace(/\bLoi\b/g, "LOI")
    .replace(/\bUw\b/g, "UW");
}

/**
 * Canonical display names for stage/status/source keys whose Title Case form
 * is wrong or off-brand. Everything else falls through to `titleize`.
 */
const SPECIAL_KEY_LABELS: Record<string, string> = {
  awaiting_broker: "OM Requested",
  contract_signed: "Contract Signed",
  deal_closed: "Deal Closed",
  dossier_generated: "Dossier Generated",
  loopnet: "LoopNet",
  offer_review: "LOI Offered",
  sourced: "Sourced",
  om_received: "OM Received",
  streeteasy: "StreetEasy",
  tour_requested: "Tour Requested",
  tour_scheduled: "Tour Scheduled",
  tour_completed_awaiting_inputs: "Tour Completed",
  underwriting_awaiting_review: "Underwriting - Awaiting User Review",
  underwriting_review_completed: "Underwriting - Review Completed",
};

/** Domain-aware key → label: canonical stage/source names first, then Title Case. */
export function labelFromKey(value: string | null | undefined, emptyLabel = "Unknown"): string {
  if (!value || !value.trim()) return emptyLabel;
  const special = SPECIAL_KEY_LABELS[value.trim().toLowerCase()];
  if (special) return special;
  return titleize(value.trim());
}

export type ScoreTone = "strong" | "watch" | "weak" | "empty";

/**
 * One deal-score banding for every page: ≥70 strong, 50–69 watch, <50 weak.
 * Pages map the tone onto their own CSS-module classes.
 */
export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score == null || Number.isNaN(score)) return "empty";
  if (score >= 70) return "strong";
  if (score >= 50) return "watch";
  return "weak";
}
