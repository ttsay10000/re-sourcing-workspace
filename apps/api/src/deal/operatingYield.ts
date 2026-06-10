/**
 * Operating-comp yield resolution for the Yield Map read path.
 *
 * A 0% (or negative) LTR yield is never a real market signal — it means a $0
 * NOI extraction or a bad stored cap-rate signal. Those rows must stay visible
 * (the deal exists and needs follow-up) but carry a flag, report no yield, and
 * stay out of every average/median/borough stat. Historical deal_signals rows
 * written before the scoring engine required NOI > 0 are sanitized here too.
 */

export type OperatingYieldFlag = "zero_noi" | "zero_cap_signal" | "negative_yield";

export interface OperatingYieldInput {
  /** Latest deal_signals.asset_cap_rate (already in percent, e.g. 5.8). */
  signalLtrPct: number | null;
  /** Fallback NOI from OM/LLM extraction chain. */
  fallbackNoi: number | null;
  /** Fallback asking price (manual → OM → matched listing). */
  fallbackAsk: number | null;
}

export interface OperatingYieldResult {
  /** Trustworthy yield in percent, or null when flagged/absent. */
  ltrYieldPct: number | null;
  yieldSource: "signal" | "derived" | null;
  flag: OperatingYieldFlag | null;
  /** Short human explanation for UI badges / follow-up lists. */
  flagDetail: string | null;
}

const FLAG_DETAILS: Record<OperatingYieldFlag, string> = {
  zero_noi: "Extracted NOI is $0 — re-run or review the OM extraction before trusting this deal's numbers.",
  zero_cap_signal: "Stored cap-rate signal is 0% — recompute deal signals; the source NOI was missing or zero.",
  negative_yield: "Computed yield is negative — extracted NOI/expenses look wrong; review the OM extraction.",
};

export function resolveOperatingYield(input: OperatingYieldInput): OperatingYieldResult {
  const { signalLtrPct, fallbackNoi, fallbackAsk } = input;
  const derivedLtrPct =
    fallbackNoi != null && fallbackAsk != null && fallbackAsk > 0 ? (fallbackNoi / fallbackAsk) * 100 : null;

  // Prefer the stored signal, but only when it is a usable positive yield; a
  // garbage 0% signal must not shadow a valid derived yield.
  if (signalLtrPct != null && signalLtrPct > 0) {
    return { ltrYieldPct: signalLtrPct, yieldSource: "signal", flag: null, flagDetail: null };
  }
  if (derivedLtrPct != null && derivedLtrPct > 0) {
    return { ltrYieldPct: derivedLtrPct, yieldSource: "derived", flag: null, flagDetail: null };
  }

  // Nothing usable — classify why so the user can follow up.
  let flag: OperatingYieldFlag | null = null;
  if ((signalLtrPct != null && signalLtrPct < 0) || (derivedLtrPct != null && derivedLtrPct < 0)) {
    flag = "negative_yield";
  } else if (fallbackNoi != null && fallbackNoi === 0) {
    flag = "zero_noi";
  } else if (signalLtrPct === 0) {
    flag = "zero_cap_signal";
  } else if (derivedLtrPct === 0) {
    flag = "zero_noi";
  }

  return {
    ltrYieldPct: null,
    yieldSource: null,
    flag,
    flagDetail: flag ? FLAG_DETAILS[flag] : null,
  };
}

/** Secondary rates (MTR/adjusted cap) get the same zero-is-not-a-rate guard. */
export function sanitizeRatePct(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}
