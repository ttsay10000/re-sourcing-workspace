import { describe, expect, it } from "vitest";
import {
  analyzePropertyForUnderwriting,
  resolveConservativeProjectedResidentialLeaseUpRent,
  resolveProjectedResidentialLeaseUpRentSummary,
} from "./propertyAssumptions.js";

describe("propertyAssumptions", () => {
  it("sizes furnishing defaults from eligible-unit beds, baths, and sqft", () => {
    const mix = analyzePropertyForUnderwriting({
      omData: {
        authoritative: {
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
      omData: {
        authoritative: {
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

  it("ignores aggregate total rows when sizing the protected-unit mix", () => {
    const mix = analyzePropertyForUnderwriting({
      omData: {
        authoritative: {
          propertyInfo: { totalUnits: 4, unitsResidential: 3, unitsCommercial: 1 },
          rentRoll: [
            { unit: "1", annualRent: 120_000, unitCategory: "Residential" },
            { unit: "2", annualRent: 110_000, unitCategory: "Residential", rentType: "Rent Stabilized" },
            { unit: "Store", annualRent: 90_000, unitCategory: "Commercial" },
            { unit: "TOTAL", annualRent: 320_000, unitCategory: "Residential" },
          ],
        },
      },
    });

    expect(mix.totalUnits).toBe(4);
    expect(mix.commercialUnits).toBe(1);
    expect(mix.rentStabilizedUnits).toBe(1);
    expect(mix.eligibleResidentialUnits).toBe(2);
    expect(mix.totalAnnualRent).toBe(320_000);
    expect(mix.eligibleAnnualRent).toBe(120_000);
  });

  it("returns an empty mix without authoritative OM data", () => {
    const mix = analyzePropertyForUnderwriting({
      rentalFinancials: {
        omAnalysis: {
          propertyInfo: { totalUnits: 4, unitsResidential: 4 },
          rentRoll: [{ unit: "1", annualRent: 120_000, unitCategory: "Residential" }],
        },
      },
    });

    expect(mix.totalUnits).toBeNull();
    expect(mix.totalAnnualRent).toBeNull();
    expect(mix.eligibleResidentialUnits).toBe(0);
  });

  it("prefers authoritative OM snapshot data over legacy OM fields", () => {
    const mix = analyzePropertyForUnderwriting({
      omData: {
        authoritative: {
          propertyInfo: { totalUnits: 2, unitsResidential: 2, unitsCommercial: 0 },
          revenueComposition: {
            residentialAnnualRent: 132_000,
            freeMarketUnits: 1,
            rentStabilizedUnits: 1,
          },
          rentRoll: [
            { unit: "1", annualRent: 72_000, unitCategory: "Residential" },
            { unit: "2", annualRent: 60_000, unitCategory: "Residential", rentType: "Rent Stabilized" },
          ],
        },
      },
      rentalFinancials: {
        omAnalysis: {
          propertyInfo: { totalUnits: 5, unitsResidential: 4, unitsCommercial: 1 },
          revenueComposition: {
            residentialAnnualRent: 300_000,
            commercialAnnualRent: 120_000,
            freeMarketUnits: 3,
            rentStabilizedUnits: 1,
            commercialUnits: 1,
          },
          rentRoll: [
            { unit: "1", annualRent: 72_000, unitCategory: "Residential" },
            { unit: "2", annualRent: 60_000, unitCategory: "Residential", rentType: "Rent Stabilized" },
            { unit: "3", annualRent: 80_000, unitCategory: "Residential" },
            { unit: "Store", annualRent: 120_000, unitCategory: "Commercial" },
          ],
        },
      },
    });

    expect(mix.totalUnits).toBe(2);
    expect(mix.commercialUnits).toBe(0);
    expect(mix.rentStabilizedUnits).toBe(1);
    expect(mix.eligibleResidentialUnits).toBe(1);
    expect(mix.totalAnnualRent).toBe(132_000);
    expect(mix.eligibleAnnualRent).toBe(72_000);
  });

  it("captures conservative projected rent for vacant residential units while skipping ancillary spaces", () => {
    const projectedRent = resolveConservativeProjectedResidentialLeaseUpRent({
      omData: {
        authoritative: {
          propertyInfo: { totalUnits: 4, unitsResidential: 4 },
          rentRoll: [
            {
              unit: "Owner's Garden Level",
              annualRent: 0,
              unitCategory: "Residential",
              occupied: false,
              notes: "Projected rent $6,000-$7,000; currently owner-occupied or delivered vacant.",
            },
            {
              unit: "Apt. 1",
              annualRent: 49_200,
              unitCategory: "Residential",
              occupied: true,
            },
            {
              unit: "Basement",
              annualRent: 0,
              unitCategory: "Residential",
              occupied: false,
              notes: "Projected rent $2,000-$2,500 basement storage.",
            },
            {
              unit: "Store",
              annualRent: 0,
              unitCategory: "Commercial",
              occupied: false,
              notes: "Projected rent $9,000-$10,000.",
            },
          ],
        },
      },
    });

    expect(projectedRent).toBe(72_000);
  });

  it("treats rent-stabilized vacant projected rent as protected from uplift", () => {
    const projectedRent = resolveProjectedResidentialLeaseUpRentSummary({
      omData: {
        authoritative: {
          propertyInfo: { totalUnits: 3, unitsResidential: 3 },
          rentRoll: [
            {
              unit: "Owner's Garden Level",
              annualRent: 0,
              unitCategory: "Residential",
              occupied: false,
              notes: "Projected rent $6,000-$7,000; currently owner-occupied or delivered vacant.",
            },
            {
              unit: "RS Apt",
              annualRent: 0,
              unitCategory: "Residential",
              occupied: false,
              rentType: "Rent Stabilized",
              notes: "Projected rent $1,200-$1,500 after turnover.",
            },
          ],
        },
      },
    });

    expect(projectedRent.totalAnnualRent).toBe(86_400);
    expect(projectedRent.eligibleAnnualRent).toBe(72_000);
    expect(projectedRent.protectedAnnualRent).toBe(14_400);
  });
});
