/**
 * Term-comparability exclusion: listings whose rental terms make them
 * non-comparable to flexible monthly furnished rentals leave the active comp
 * set (but are stored and visible in diagnostics / "show excluded").
 */

import { DEFAULT_MAX_MIN_STAY_NIGHTS } from "@re-sourcing/contracts";

export interface ExclusionInput {
  minStayNights?: number | null;
  /** True when the only available rates require a multi-month mandatory lease. */
  requiresMultiMonthLease?: boolean;
  /** True when no 30-night/calendar-month quote ever priced for the listing. */
  noMonthlyQuoteAvailable?: boolean;
}

export interface ExclusionResult {
  excluded: boolean;
  reason: string | null;
}

export function maxMinStayNights(): number {
  const fromEnv = Number(process.env.RENTAL_MAX_MIN_STAY_NIGHTS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_MIN_STAY_NIGHTS;
}

export function evaluateExclusion(input: ExclusionInput, threshold = maxMinStayNights()): ExclusionResult {
  if (input.minStayNights != null && input.minStayNights > threshold) {
    return { excluded: true, reason: "Minimum stay exceeds monthly comp threshold" };
  }
  if (input.requiresMultiMonthLease) {
    return { excluded: true, reason: "Mandatory multi-month lease term" };
  }
  if (input.noMonthlyQuoteAvailable) {
    return { excluded: true, reason: "No 30-night or calendar-month rate available" };
  }
  return { excluded: false, reason: null };
}
