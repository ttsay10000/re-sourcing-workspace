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

  it("rewards a recent price cut that may create near-term buying opportunity", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = computeDealScore({
      purchasePrice: 6_999_000,
      noi: 380_000,
      adjustedCapRatePct: 5.8,
      irrPct: 0.22,
      cocPct: 0.07,
      recommendedOfferHigh: 6_900_000,
      blendedRentUpliftPct: 24,
      latestPriceDecreasePct: 5.4,
      daysSinceLatestPriceDecrease: 0,
      currentDiscountFromOriginalAskPct: 30,
    });

    expect(result.dealScore).toBeGreaterThan(60);
    expect(result.positiveSignals.some((signal) => signal.includes("Recent 5.4% price cut"))).toBe(true);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
