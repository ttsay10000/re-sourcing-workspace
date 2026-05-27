import { describe, expect, it } from "vitest";
import { resolveOmAskingPriceFromDetails } from "./omAskingPrice.js";

describe("omAskingPrice", () => {
  it("uses authoritative OM asking price when no listing price is available", () => {
    expect(
      resolveOmAskingPriceFromDetails({
        omData: {
          authoritative: {
            propertyInfo: {
              askingPrice: "$1,875,000",
            },
          },
        },
      })
    ).toBe(1_875_000);
  });

  it("falls back to legacy reviewed OM analysis valuation fields", () => {
    expect(
      resolveOmAskingPriceFromDetails({
        rentalFinancials: {
          omAnalysis: {
            valuationMetrics: {
              askPrice: 2_250_000,
            },
          },
        },
      })
    ).toBe(2_250_000);
  });
});
