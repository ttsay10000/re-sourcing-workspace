import type { DealScoreOverride } from "@re-sourcing/contracts";

export function resolveEffectiveDealScore(
  calculatedDealScore: number | null | undefined,
  scoreOverride: DealScoreOverride | null | undefined
): number | null {
  if (scoreOverride?.score != null && Number.isFinite(scoreOverride.score)) {
    return Math.round(scoreOverride.score);
  }
  if (calculatedDealScore != null && Number.isFinite(calculatedDealScore)) {
    return Math.round(calculatedDealScore);
  }
  return null;
}
