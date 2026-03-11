import { describe, expect, it } from "vitest";
import { analyzePropertyForUnderwriting } from "./propertyAssumptions.js";

describe("propertyAssumptions", () => {
  it("sizes furnishing defaults from eligible-unit beds, baths, and sqft", () => {
    const mix = analyzePropertyForUnderwriting({
      rentalFinancials: {
        omAnalysis: {
          propertyInfo: { totalUnits: 3, unitsResidential: 3 },
          rentRoll: [
            { unit: "1", annualRent: 72_000, beds: 2, baths: 1, sqft: 900, unitCategory: "Residential" },
            { unit: "2", annualRent: 72_000, beds: 2, baths: 1, sqft: 850, unitCategory: "Residential" },
            { unit: "3", annualRent: 60_000, beds: 1, baths: 1, sqft: 700, rentType: "Rent Stabilized" },
          ],
        },
      },
    });

    expect(mix.eligibleResidentialUnits).toBe(2);
    expect(mix.furnishingSetupCostEstimate).toBe(22_500);
  });

  it("falls back to building square footage for large-unit furnishing tiers", () => {
    const mix = analyzePropertyForUnderwriting({
      rentalFinancials: {
        omAnalysis: {
          propertyInfo: {
            totalUnits: 1,
            unitsResidential: 1,
            buildingSqft: 2_800,
          },
          rentRoll: [
            { unit: "TH", annualRent: 180_000, beds: 3, baths: 2, unitCategory: "Residential" },
          ],
        },
      },
    });

    expect(mix.eligibleResidentialUnits).toBe(1);
    expect(mix.furnishingSetupCostEstimate).toBe(27_000);
  });
});
