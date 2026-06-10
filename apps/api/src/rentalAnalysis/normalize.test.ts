import { describe, expect, it } from "vitest";
import type { QuoteSpec } from "@re-sourcing/contracts";
import { normalizeQuote } from "./normalize.js";

const SPEC_30: QuoteSpec = {
  checkIn: "2026-07-15",
  checkOut: "2026-08-14",
  nights: 30,
  guests: 2,
  pets: false,
  currency: "USD",
  quoteType: "rolling_30_nights",
};

const SPEC_90: QuoteSpec = { ...SPEC_30, checkOut: "2026-10-13", nights: 90, quoteType: "rolling_90_nights" };

const baseInput = {
  listingId: "listing-1",
  listingUrl: "https://example.com/listing-1",
  source: "haus" as const,
};

describe("normalizeQuote", () => {
  it("clean line-item subtotal → comp-grade, fees and taxes excluded from the rate", () => {
    const observation = normalizeQuote({
      ...baseInput,
      quoteSpec: SPEC_30,
      line: { accommodationSubtotal: 6000, cleaningFee: 250, taxes: 540, serviceFee: 120, available: true },
    });

    expect(observation.normalizationStatus).toBe("subtotal_clean_no_fees_taxes");
    expect(observation.confidence).toBe("high");
    expect(observation.accommodationSubtotalEffective).toBe(6000);
    expect(observation.accommodationSubtotalUndiscounted).toBe(6000);
    expect(observation.effectiveAdr).toBe(200);
    expect(observation.effectiveMonthlyEquivalent).toBe(6000);
    // Fees are stored for diagnostics but never inside the rate.
    expect(observation.cleaningFee).toBe(250);
    expect(observation.taxes).toBe(540);
    expect(observation.feesExcluded).toBe(true);
    expect(observation.taxesExcluded).toBe(true);
    // Jul 15 → Aug 14 has 17 July nights vs 14 August nights.
    expect(observation.calendarMonth).toBe("2026-07");
  });

  it("visible discount line → both subtotals stored, discount_removed", () => {
    const observation = normalizeQuote({
      ...baseInput,
      quoteSpec: SPEC_30,
      line: {
        accommodationSubtotal: 5400,
        discountAmount: -600,
        discountLabels: ["Monthly discount"],
        available: true,
      },
    });

    expect(observation.normalizationStatus).toBe("discount_removed");
    expect(observation.accommodationSubtotalEffective).toBe(5400);
    expect(observation.accommodationSubtotalUndiscounted).toBe(6000);
    expect(observation.discountAmount).toBe(600);
    expect(observation.discountLabels).toEqual(["Monthly discount"]);
    expect(observation.undiscountedAdr).toBe(200);
  });

  it("stated pre-discount subtotal wins over inferred amounts", () => {
    const observation = normalizeQuote({
      ...baseInput,
      quoteSpec: SPEC_30,
      line: { accommodationSubtotal: 5100, accommodationSubtotalBeforeDiscount: 6000, available: true },
    });

    expect(observation.normalizationStatus).toBe("discount_removed");
    expect(observation.accommodationSubtotalUndiscounted).toBe(6000);
    expect(observation.discountAmount).toBe(900);
  });

  it("long stay without line items estimates from same-month 30-night ADR (discount_estimated)", () => {
    const observation = normalizeQuote({
      ...baseInput,
      quoteSpec: SPEC_90,
      line: { accommodationSubtotal: 15300, available: true },
      thirtyNightAdrSameMonth: 200,
    });

    // 200 * 90 = 18,000 estimated undiscounted vs 15,300 effective.
    expect(observation.normalizationStatus).toBe("discount_estimated");
    expect(observation.confidence).toBe("medium");
    expect(observation.accommodationSubtotalUndiscounted).toBe(18000);
    expect(observation.discountAmount).toBe(2700);
    expect(observation.effectiveAdr).toBe(170);
    expect(observation.undiscountedAdr).toBe(200);
    // Monthly equivalents are ADR × 30 so 90-night stays stay comparable.
    expect(observation.effectiveMonthlyEquivalent).toBe(5100);
    expect(observation.undiscountedMonthlyEquivalent).toBe(6000);
  });

  it("visible card price only → effective_rate_only at medium confidence", () => {
    const observation = normalizeQuote({
      ...baseInput,
      quoteSpec: { ...SPEC_30, checkIn: "2026-07-01", checkOut: "2026-08-01", nights: 31, quoteType: "calendar_month" },
      line: { displayedMonthlyRate: 6200 },
    });

    expect(observation.normalizationStatus).toBe("effective_rate_only");
    expect(observation.confidence).toBe("medium");
    expect(observation.accommodationSubtotalEffective).toBe(6200);
    expect(observation.displayedMonthlyRate).toBe(6200);
  });

  it("no pricing at all → pricing_unavailable, low confidence", () => {
    const observation = normalizeQuote({ ...baseInput, quoteSpec: SPEC_30, line: {} });

    expect(observation.normalizationStatus).toBe("pricing_unavailable");
    expect(observation.confidence).toBe("low");
    expect(observation.accommodationSubtotalEffective).toBeNull();
    expect(observation.effectiveMonthlyEquivalent).toBeNull();
  });

  it("unavailable stays are marked unavailable", () => {
    const observation = normalizeQuote({
      ...baseInput,
      quoteSpec: SPEC_30,
      line: { available: false },
    });
    expect(observation.availabilityStatus).toBe("unavailable");
  });
});
