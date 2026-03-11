import { describe, expect, it } from "vitest";
import { computeDealSignals } from "./computeDealSignals.js";

describe("computeDealSignals", () => {
  it("uses the authoritative OM unit count when the rent roll is incomplete", () => {
    const result = computeDealSignals({
      propertyId: "property-1",
      canonicalAddress: "18-20 Christopher Street, Manhattan, NY 10014",
      primaryListing: {
        price: 8_800_000,
        city: "Manhattan",
      },
      details: {
        omData: {
          authoritative: {
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

  it("uses authoritative OM unit count over larger legacy and RapidAPI counts", () => {
    const result = computeDealSignals({
      propertyId: "property-3",
      canonicalAddress: "416 West 20th Street, Manhattan, NY 10011",
      primaryListing: {
        price: 8_800_000,
        city: "Manhattan",
      },
      details: {
        omData: {
          authoritative: {
            propertyInfo: {
              totalUnits: 8,
            },
            rentRoll: [{ unit: "1" }, { unit: "2" }],
          },
        },
        rentalFinancials: {
          rentalUnits: Array.from({ length: 12 }, (_, index) => ({ unit: String(index + 1) })),
          fromLlm: {
            rentalNumbersPerUnit: Array.from({ length: 10 }, (_, index) => ({ unit: `L${index + 1}` })),
          },
          omAnalysis: {
            propertyInfo: {
              totalUnits: 11,
            },
            rentRoll: [{ unit: "1" }, { unit: "2" }, { unit: "3" }],
          },
        },
      },
    });

    expect(result.insertParams.pricePerUnit).toBe(1_100_000);
  });

  it("does not fall back to legacy unit counts once authoritative OM exists", () => {
    const result = computeDealSignals({
      propertyId: "property-4",
      canonicalAddress: "80 East 10th Street, Manhattan, NY 10003",
      primaryListing: {
        price: 8_800_000,
        city: "Manhattan",
      },
      details: {
        omData: {
          authoritative: {
            propertyInfo: {},
            rentRoll: [],
          },
        },
        rentalFinancials: {
          rentalUnits: Array.from({ length: 12 }, (_, index) => ({ unit: String(index + 1) })),
          omAnalysis: {
            propertyInfo: {
              totalUnits: 11,
            },
            rentRoll: [{ unit: "1" }, { unit: "2" }, { unit: "3" }],
          },
        },
      },
    });

    expect(result.insertParams.pricePerUnit).toBeUndefined();
  });

  it("derives and persists v2 risk profile, breakdown, and confidence", () => {
    const result = computeDealSignals({
      propertyId: "property-5",
      canonicalAddress: "99 Orchard Street, Manhattan, NY 10002",
      primaryListing: {
        price: 4_500_000,
        city: "Manhattan",
      },
      irrPct: 0.21,
      cocPct: 0.08,
      equityMultiple: 1.9,
      adjustedCapRatePct: 6.1,
      adjustedNoi: 275_000,
      blendedRentUpliftPct: 42,
      annualExpenseGrowthPct: 1,
      vacancyPct: 2.5,
      exitCapRatePct: 5.8,
      details: {
        assessedTaxBeforeTotal: 70_000,
        omData: {
          authoritative: {
            propertyInfo: {
              totalUnits: 6,
            },
            rentRoll: [
              { unit: "1", monthlyRent: 4_000, leaseEndDate: "2026-07-01", occupied: true },
              { unit: "2", monthlyRent: 3_500, leaseEndDate: "2027-04-01", occupied: true },
              { unit: "3", monthlyRent: 3_200, notes: "Rent Stabilized" },
              { unit: "Store", unitCategory: "Commercial", monthlyRent: 5_500, leaseEndDate: "2026-09-01", occupied: true },
            ],
            reportedDiscrepancies: [{ field: "unit_count" }, { field: "commercial_units" }],
            income: {
              effectiveGrossIncome: 260_000,
              NOI: 225_000,
            },
            expenses: {
              expensesTable: [{ lineItem: "Taxes", amount: 70_000 }],
              totalExpenses: 35_000,
            },
            revenueComposition: {
              commercialAnnualRent: 66_000,
            },
          },
        },
      },
    });

    expect(result.scoringResult.riskProfile.commercialRevenueSharePct).toBeGreaterThan(0.2);
    expect(result.scoringResult.riskProfile.rentRollCoveragePct).toBeCloseTo(4 / 6, 2);
    expect(result.insertParams.scoreBreakdown).toBeTruthy();
    expect(result.insertParams.riskProfile).toBeTruthy();
    expect(result.insertParams.confidenceScore).toBeLessThan(1);
    expect(result.insertParams.scoreVersion).toBe("v2");
  });

  it("does not derive unit count from legacy OM data without an authoritative snapshot", () => {
    const result = computeDealSignals({
      propertyId: "property-6",
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
          },
        },
      },
    });

    expect(result.insertParams.pricePerUnit).toBeUndefined();
  });
});
