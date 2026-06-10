/**
 * Shared LTR vs MTR yield comparison used by the OM calculation snapshot,
 * deal signals, and the pipeline screening API.
 *
 * Terminology (matches existing metrics):
 * - LTR yield: current NOI / purchase basis — the asset cap rate at ask.
 * - MTR yield: stabilized / rent-uplift NOI / purchase basis — the adjusted cap rate.
 *
 * The MTR strategy carries furnishing cost, turnover, and operational drag, so an
 * MTR yield at or barely above the LTR yield is a sourcing red flag: the property
 * should be evaluated as an LTR deal on its cap rate instead.
 */

export type YieldCalloutCode = "mtr_below_ltr" | "mtr_weak_uplift" | "mtr_spread_outlier";

export interface YieldSignals {
  ltrYieldPct: number | null;
  mtrYieldPct: number | null;
  /** mtrYieldPct - ltrYieldPct, in percentage points. */
  spreadPctPoints: number | null;
  /** Spread below this threshold (and >= 0) is flagged as a weak uplift. */
  minHealthySpreadPctPoints: number;
  /** Spread above this threshold is flagged as an implausible uplift (data error). */
  maxPlausibleSpreadPctPoints: number;
  calloutCode: YieldCalloutCode | null;
  calloutLabel: string | null;
}

export const DEFAULT_MIN_MTR_SPREAD_PCT_POINTS = 0.75;

/**
 * No real furnished-conversion underwrite adds this many points over the LTR
 * yield; spreads beyond it have so far meant double-counted rents (the LLM
 * extracting the same rent roll twice) or a bad NOI, not a great deal.
 */
export const DEFAULT_MAX_MTR_SPREAD_PCT_POINTS = 5;

/** Env override so the weak-uplift threshold can be tuned without a deploy-time code change. */
export function resolveMinHealthyMtrSpreadPctPoints(): number {
  const raw = process.env.MTR_MIN_YIELD_SPREAD_PCT;
  if (raw != null && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_MIN_MTR_SPREAD_PCT_POINTS;
}

/** Env override for the implausible-spread ceiling (percentage points). */
export function resolveMaxPlausibleMtrSpreadPctPoints(): number {
  const raw = process.env.MTR_MAX_YIELD_SPREAD_PCT;
  if (raw != null && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_MTR_SPREAD_PCT_POINTS;
}

function toFinite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatPct(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toFixed(Math.abs(rounded) >= 10 ? 1 : 2).replace(/\.?0+$/, "")}%`;
}

function formatPoints(value: number): string {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  return `${rounded.toFixed(2).replace(/\.?0+$/, "")}pt`;
}

export function computeYieldSignals(params: {
  ltrYieldPct: number | null | undefined;
  mtrYieldPct: number | null | undefined;
  minSpreadPctPoints?: number | null;
  maxSpreadPctPoints?: number | null;
}): YieldSignals {
  const ltrYieldPct = toFinite(params.ltrYieldPct);
  const mtrYieldPct = toFinite(params.mtrYieldPct);
  const minHealthySpreadPctPoints =
    toFinite(params.minSpreadPctPoints ?? null) ?? resolveMinHealthyMtrSpreadPctPoints();
  const maxPlausibleSpreadPctPoints =
    toFinite(params.maxSpreadPctPoints ?? null) ?? resolveMaxPlausibleMtrSpreadPctPoints();

  if (ltrYieldPct == null || mtrYieldPct == null) {
    return {
      ltrYieldPct,
      mtrYieldPct,
      spreadPctPoints: null,
      minHealthySpreadPctPoints,
      maxPlausibleSpreadPctPoints,
      calloutCode: null,
      calloutLabel: null,
    };
  }

  const spreadPctPoints = Math.round((mtrYieldPct - ltrYieldPct) * 10000) / 10000;

  if (spreadPctPoints < 0) {
    return {
      ltrYieldPct,
      mtrYieldPct,
      spreadPctPoints,
      minHealthySpreadPctPoints,
      maxPlausibleSpreadPctPoints,
      calloutCode: "mtr_below_ltr",
      calloutLabel: `MTR yield ${formatPct(mtrYieldPct)} is below the LTR yield ${formatPct(
        ltrYieldPct
      )} (${formatPoints(spreadPctPoints)} lower) — underwrite this as an LTR deal at its cap rate.`,
    };
  }

  if (spreadPctPoints < minHealthySpreadPctPoints) {
    return {
      ltrYieldPct,
      mtrYieldPct,
      spreadPctPoints,
      minHealthySpreadPctPoints,
      maxPlausibleSpreadPctPoints,
      calloutCode: "mtr_weak_uplift",
      calloutLabel: `MTR adds only +${formatPoints(spreadPctPoints)} over the LTR yield (${formatPct(
        ltrYieldPct
      )} → ${formatPct(mtrYieldPct)}), below the +${formatPoints(
        minHealthySpreadPctPoints
      )} target — the MTR bump may not justify the added cost and turnover.`,
    };
  }

  if (spreadPctPoints > maxPlausibleSpreadPctPoints) {
    return {
      ltrYieldPct,
      mtrYieldPct,
      spreadPctPoints,
      minHealthySpreadPctPoints,
      maxPlausibleSpreadPctPoints,
      calloutCode: "mtr_spread_outlier",
      calloutLabel: `MTR yield ${formatPct(mtrYieldPct)} is +${formatPoints(
        spreadPctPoints
      )} over the LTR yield ${formatPct(ltrYieldPct)}, beyond the +${formatPoints(
        maxPlausibleSpreadPctPoints
      )} plausibility ceiling — check for double-counted rent roll rows or a bad NOI extraction before trusting the MTR spread.`,
    };
  }

  return {
    ltrYieldPct,
    mtrYieldPct,
    spreadPctPoints,
    minHealthySpreadPctPoints,
    maxPlausibleSpreadPctPoints,
    calloutCode: null,
    calloutLabel: null,
  };
}
