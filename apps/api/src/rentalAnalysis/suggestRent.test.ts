import { describe, expect, it } from "vitest";
import { suggestMtrRent, type SuggestRentCompInput } from "./suggestRent.js";

function comp(overrides: Partial<SuggestRentCompInput> = {}): SuggestRentCompInput {
  return {
    monthlyEquivalent: 6000,
    adr: 200,
    confidence: "high",
    normalizationStatus: "subtotal_clean_no_fees_taxes",
    distanceMiles: 0.4,
    bedsMatch: true,
    ...overrides,
  };
}

describe("suggestMtrRent", () => {
  it("returns p25/median/p75 of the matched comps", () => {
    const result = suggestMtrRent("prop-1", "2026-07", [
      comp({ monthlyEquivalent: 5000, adr: 167 }),
      comp({ monthlyEquivalent: 6000, adr: 200 }),
      comp({ monthlyEquivalent: 7000, adr: 233 }),
      comp({ monthlyEquivalent: 8000, adr: 267 }),
      comp({ monthlyEquivalent: 9000, adr: 300 }),
    ]);

    expect(result.compCount).toBe(5);
    expect(result.suggestedMonthlyRentLow).toBe(6000);
    expect(result.suggestedMonthlyRentBase).toBe(7000);
    expect(result.suggestedMonthlyRentHigh).toBe(8000);
    expect(result.suggestedAdrBase).toBe(233);
    expect(result.confidence).toBe("high");
  });

  it("drops to low confidence with fewer than 3 comps", () => {
    const result = suggestMtrRent("prop-1", "2026-07", [comp(), comp({ monthlyEquivalent: 6400 })]);
    expect(result.confidence).toBe("low");
    expect(result.explanation).toContain("2 comps");
  });

  it("demotes when estimated/effective-only rates dominate", () => {
    const result = suggestMtrRent("prop-1", "2026-07", [
      comp({ normalizationStatus: "discount_estimated" }),
      comp({ normalizationStatus: "effective_rate_only", monthlyEquivalent: 6200 }),
      comp({ normalizationStatus: "effective_rate_only", monthlyEquivalent: 6400 }),
      comp({ monthlyEquivalent: 6600 }),
    ]);
    expect(result.confidence).toBe("low");
    expect(result.explanation).toContain("estimated");
  });

  it("demotes to medium for far or bed-mismatched comp sets", () => {
    const result = suggestMtrRent("prop-1", "2026-07", [
      comp({ distanceMiles: 2.4 }),
      comp({ distanceMiles: 2.2, monthlyEquivalent: 6300 }),
      comp({ distanceMiles: 1.9, monthlyEquivalent: 6500 }),
    ]);
    expect(result.confidence).toBe("medium");
    expect(result.explanation).toContain("1.5 miles");
  });

  it("handles an empty comp set without numbers", () => {
    const result = suggestMtrRent("prop-1", "2026-07", []);
    expect(result.compCount).toBe(0);
    expect(result.confidence).toBe("low");
    expect(result.suggestedMonthlyRentBase).toBeNull();
  });
});
