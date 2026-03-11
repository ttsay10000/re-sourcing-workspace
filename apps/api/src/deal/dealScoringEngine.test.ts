import { describe, expect, it } from "vitest";
import { computeDealScore } from "./dealScoringEngine.js";

describe("dealScoringEngine", () => {
  it("rewards pricing that already clears the target IRR", () => {
    const result = computeDealScore({
      purchasePrice: 4_000_000,
      noi: 220_000,
      adjustedCapRatePct: 6.2,
      irrPct: 0.27,
      cocPct: 0.09,
      recommendedOfferHigh: 4_000_000,
      blendedRentUpliftPct: 70,
      rentStabilizedUnitCount: 0,
      commercialUnitCount: 0,
    });

    expect(result.dealScore).toBeGreaterThanOrEqual(80);
    expect(result.positiveSignals).toContain("Asking price already clears target IRR");
  });

  it("penalizes deals that need a large discount and carry execution risk", () => {
    const result = computeDealScore({
      purchasePrice: 5_000_000,
      noi: 150_000,
      adjustedCapRatePct: 4.1,
      irrPct: 0.16,
      cocPct: 0.03,
      recommendedOfferHigh: 3_800_000,
      blendedRentUpliftPct: 38,
      rentStabilizedUnitCount: 2,
      commercialUnitCount: 1,
      hpdRentImpairingOpen: 1,
      dobOpenCount: 2,
    });

    expect(result.dealScore).toBeLessThan(50);
    expect(result.negativeSignals.some((signal) => signal.includes("discount"))).toBe(true);
  });
});
