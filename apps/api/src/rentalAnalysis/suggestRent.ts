/**
 * Suggested MTR rent engine (V1): low/base/high from the matched comp set's
 * p25/median/p75 monthly equivalents, with confidence demoted for thin,
 * estimated/discount-derived, or mismatched comp sets.
 */

import type { RentalConfidence, SuggestedMtrRent } from "@re-sourcing/contracts";

export interface SuggestRentCompInput {
  monthlyEquivalent: number;
  adr?: number | null;
  confidence: RentalConfidence;
  normalizationStatus: string;
  distanceMiles?: number | null;
  bedsMatch: boolean;
}

function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const index = (sortedAscending.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAscending[lower];
  const weight = index - lower;
  return sortedAscending[lower] * (1 - weight) + sortedAscending[upper] * weight;
}

function round0(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

export function suggestMtrRent(
  targetPropertyId: string,
  month: string,
  comps: SuggestRentCompInput[]
): SuggestedMtrRent {
  const usable = comps.filter((comp) => Number.isFinite(comp.monthlyEquivalent) && comp.monthlyEquivalent > 0);
  const monthlySorted = usable.map((comp) => comp.monthlyEquivalent).sort((a, b) => a - b);
  const adrSorted = usable
    .map((comp) => comp.adr)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const reasons: string[] = [];
  let confidence: RentalConfidence = "high";
  const demote = (to: RentalConfidence, reason: string) => {
    const order: RentalConfidence[] = ["high", "medium", "low"];
    if (order.indexOf(to) > order.indexOf(confidence)) confidence = to;
    reasons.push(reason);
  };

  if (usable.length === 0) {
    return {
      targetPropertyId,
      month,
      suggestedMonthlyRentLow: null,
      suggestedMonthlyRentBase: null,
      suggestedMonthlyRentHigh: null,
      suggestedAdrLow: null,
      suggestedAdrBase: null,
      suggestedAdrHigh: null,
      compCount: 0,
      confidence: "low",
      explanation: `No usable rental comps for ${month}.`,
    };
  }

  if (usable.length < 3) {
    demote("low", `only ${usable.length} comp${usable.length === 1 ? "" : "s"}`);
  }

  const estimatedShare =
    usable.filter(
      (comp) =>
        comp.normalizationStatus === "discount_estimated" ||
        comp.normalizationStatus === "effective_rate_only" ||
        comp.confidence === "low"
    ).length / usable.length;
  if (estimatedShare > 0.5) {
    demote("low", "most comps use estimated or effective-only rates");
  } else if (estimatedShare > 0.2) {
    demote("medium", "some comps use estimated or effective-only rates");
  }

  const farShare = usable.filter((comp) => comp.distanceMiles != null && comp.distanceMiles > 1.5).length / usable.length;
  if (farShare > 0.5) demote("medium", "comps are mostly beyond 1.5 miles");

  const bedMismatchShare = usable.filter((comp) => !comp.bedsMatch).length / usable.length;
  if (bedMismatchShare > 0.5) demote("medium", "comps are mostly a different bedroom count");

  const explanation =
    `Low/base/high from p25/median/p75 of ${usable.length} matched comp${usable.length === 1 ? "" : "s"} for ${month}` +
    (reasons.length > 0 ? ` (confidence ${confidence}: ${reasons.join(", ")})` : "") +
    ".";

  return {
    targetPropertyId,
    month,
    suggestedMonthlyRentLow: round0(percentile(monthlySorted, 0.25)),
    suggestedMonthlyRentBase: round0(percentile(monthlySorted, 0.5)),
    suggestedMonthlyRentHigh: round0(percentile(monthlySorted, 0.75)),
    suggestedAdrLow: round0(percentile(adrSorted, 0.25)),
    suggestedAdrBase: round0(percentile(adrSorted, 0.5)),
    suggestedAdrHigh: round0(percentile(adrSorted, 0.75)),
    compCount: usable.length,
    confidence,
    explanation,
  };
}

export { percentile };
