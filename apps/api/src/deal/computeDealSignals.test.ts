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
});
