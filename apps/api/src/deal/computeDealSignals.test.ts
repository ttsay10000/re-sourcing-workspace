import { describe, expect, it } from "vitest";
import { computeDealSignals } from "./computeDealSignals.js";

describe("computeDealSignals", () => {
  it("uses the highest available unit count when the OM rent roll is incomplete", () => {
    const result = computeDealSignals({
      propertyId: "property-1",
      canonicalAddress: "18-20 Christopher Street, Manhattan, NY 10014",
      primaryListing: {
        price: 8_800_000,
        city: "Manhattan",
      },
      details: {
        rentalFinancials: {
          omAnalysis: {
            propertyInfo: {
              totalUnits: 11,
            },
            rentRoll: [{ unit: "1" }, { unit: "2" }, { unit: "3" }],
          },
        },
      },
    });

    expect(result.insertParams.pricePerUnit).toBe(800_000);
  });

  it("captures recent price-cut momentum from listing history", () => {
    const result = computeDealSignals({
      propertyId: "property-2",
      canonicalAddress: "27 West 9th Street, Manhattan, NY 10011",
      primaryListing: {
        price: 6_999_000,
        city: "Manhattan",
        listedAt: "2025-09-25",
        priceHistory: [
          { date: "2026-01-13", price: "$6,999,000", event: "Price Decrease" },
          { date: "2025-12-18", price: "$7,400,000", event: "Price Decrease" },
          { date: "2025-09-25", price: "$10,000,000", event: "Listed" },
        ],
      },
      details: null,
    });

    expect(result.insertParams.priceMomentum).toBeLessThan(0);
    expect(result.scoringResult.positiveSignals.some((signal) => signal.includes("price cut"))).toBe(true);
  });
});
