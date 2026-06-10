/**
 * Shared yield comparisons used by the OM calculation snapshot, deal signals,
 * and the pipeline screening API.
 *
 * Terminology (matches existing metrics):
 * - LTR yield: reconstructed current NOI / purchase basis — the asset cap rate at ask.
 *   "Reconstructed" means actual gross rent + other income (+ projected lease-up)
 *   − expenses, per resolveAssetCapRateNoiBasis; the broker-stated NOI is never
 *   the numerator unless reconstruction is impossible or the NOI was manually overridden.
 * - MTR yield: stabilized / rent-uplift NOI / purchase basis — the adjusted cap rate.
 *
 * Two callouts live here:
 * - LTR vs MTR: the MTR strategy carries furnishing cost, turnover, and operational
 *   drag, so an MTR yield at or barely above the LTR yield is a sourcing red flag:
 *   the property should be evaluated as an LTR deal on its cap rate instead.
 * - Broker vs reconstructed: when the OM-stated cap rate (or the cap implied by the
 *   broker's NOI) diverges from the reconstructed basis, flag it — broker yields are
 *   typically built on pro forma rents while we underwrite off actuals.
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

export type BrokerYieldCalloutCode =
  | "broker_cap_above_reconstructed"
  | "broker_cap_below_reconstructed";

export type BrokerCapRateSource = "om_stated" | "implied_from_broker_noi";

export interface BrokerYieldComparison {
  /** Broker-stated NOI as extracted from the OM. */
  brokerNoi: number | null;
  /** OM-stated cap rate when listed, otherwise broker NOI / purchase basis. */
  brokerCapRatePct: number | null;
  brokerCapRateSource: BrokerCapRateSource | null;
  /** Actuals basis: gross rent + other income (+ lease-up) − expenses. */
  reconstructedNoi: number | null;
  reconstructedCapRatePct: number | null;
  /** brokerCapRatePct - reconstructedCapRatePct, in percentage points. */
  deltaPctPoints: number | null;
  /** |delta| at or above this threshold raises the callout. */
  minFlagDeltaPctPoints: number;
  calloutCode: BrokerYieldCalloutCode | null;
  calloutLabel: string | null;
}

export const DEFAULT_MIN_BROKER_CAP_DELTA_PCT_POINTS = 0.1;

/** Env override so the broker-vs-reconstructed threshold can be tuned without a deploy-time code change. */
export function resolveMinBrokerCapDeltaPctPoints(): number {
  const raw = process.env.BROKER_CAP_MIN_DELTA_PCT;
  if (raw != null && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_MIN_BROKER_CAP_DELTA_PCT_POINTS;
}

export function computeBrokerYieldComparison(params: {
  brokerNoi: number | null | undefined;
  brokerStatedCapRatePct?: number | null;
  reconstructedNoi: number | null | undefined;
  purchasePrice: number | null | undefined;
  minDeltaPctPoints?: number | null;
}): BrokerYieldComparison {
  const brokerNoi = toFinite(params.brokerNoi);
  const reconstructedNoi = toFinite(params.reconstructedNoi);
  const rawPrice = toFinite(params.purchasePrice);
  const price = rawPrice != null && rawPrice > 0 ? rawPrice : null;
  const minFlagDeltaPctPoints =
    toFinite(params.minDeltaPctPoints ?? null) ?? resolveMinBrokerCapDeltaPctPoints();

  const statedCapRatePct = toFinite(params.brokerStatedCapRatePct ?? null);
  const impliedCapRatePct = brokerNoi != null && price != null ? (brokerNoi / price) * 100 : null;
  const brokerCapRatePct = statedCapRatePct ?? impliedCapRatePct;
  const brokerCapRateSource: BrokerCapRateSource | null =
    statedCapRatePct != null ? "om_stated" : impliedCapRatePct != null ? "implied_from_broker_noi" : null;
  const reconstructedCapRatePct =
    reconstructedNoi != null && price != null ? (reconstructedNoi / price) * 100 : null;

  const base: BrokerYieldComparison = {
    brokerNoi,
    brokerCapRatePct,
    brokerCapRateSource,
    reconstructedNoi,
    reconstructedCapRatePct,
    deltaPctPoints: null,
    minFlagDeltaPctPoints,
    calloutCode: null,
    calloutLabel: null,
  };

  if (brokerCapRatePct == null || reconstructedCapRatePct == null) return base;

  const deltaPctPoints = Math.round((brokerCapRatePct - reconstructedCapRatePct) * 10000) / 10000;
  if (Math.abs(deltaPctPoints) < minFlagDeltaPctPoints) {
    return { ...base, deltaPctPoints };
  }

  const brokerSourceLabel =
    brokerCapRateSource === "om_stated" ? "OM-stated cap rate" : "broker NOI-implied cap rate";

  if (deltaPctPoints > 0) {
    return {
      ...base,
      deltaPctPoints,
      calloutCode: "broker_cap_above_reconstructed",
      calloutLabel: `Broker ${brokerSourceLabel} ${formatPct(brokerCapRatePct)} runs +${formatPoints(
        deltaPctPoints
      )} above the ${formatPct(
        reconstructedCapRatePct
      )} reconstructed from actuals (rent + other income − expenses) — broker yield likely reflects pro forma rents; underwriting keeps the reconstructed basis.`,
    };
  }

  return {
    ...base,
    deltaPctPoints,
    calloutCode: "broker_cap_below_reconstructed",
    calloutLabel: `Broker ${brokerSourceLabel} ${formatPct(brokerCapRatePct)} runs -${formatPoints(
      deltaPctPoints
    )} below the ${formatPct(
      reconstructedCapRatePct
    )} reconstructed from actuals (rent + other income − expenses) — the broker NOI nets out items (e.g. vacancy) the actuals basis does not; underwriting keeps the reconstructed basis.`,
  };
}
