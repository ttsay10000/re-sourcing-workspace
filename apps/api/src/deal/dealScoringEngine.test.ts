import { describe, expect, it } from "vitest";
import { computeDealScore, resolveFinalDealScore } from "./dealScoringEngine.js";

describe("dealScoringEngine", () => {
  it("keeps strong, clean finance-led deals in the target strong range", () => {
    const result = computeDealScore({
      purchasePrice: 4_000_000,
      noi: 250_000,
      grossRentalIncome: 420_000,
      adjustedCapRatePct: 6.8,
      adjustedNoi: 272_000,
      irrPct: 0.24,
      cocPct: 0.095,
      equityMultiple: 2.1,
      recommendedOfferHigh: 4_000_000,
      blendedRentUpliftPct: 18,
      annualExpenseGrowthPct: 3,
      vacancyPct: 7,
      exitCapRatePct: 7.2,
      hasDetailedExpenseRows: true,
      totalUnits: 24,
      latestPriceDecreasePct: 4.2,
      daysSinceLatestPriceDecrease: 20,
      currentDiscountFromOriginalAskPct: 12,
      riskProfile: {
        commercialRevenueSharePct: 0.08,
        rentStabilizedRevenueSharePct: 0,
        largestUnitRevenueSharePct: 0.08,
        rollover12moRevenueSharePct: 0.12,
        rentRollCoveragePct: 0.96,
        omDiscrepancyCount: 0,
        rapidOmMismatch: false,
        taxBurdenPct: 0.09,
        unsupportedRentGrowthPct: 0.72,
        missingLeaseDataPct: 0.04,
        missingOccupancyDataPct: 0,
        missingLeaseDataMajority: false,
        missingOccupancyDataMajority: false,
        smallAssetRiskLevel: "none",
        isPackageOm: false,
        missingEnrichmentGroup: false,
        explicitRecordMismatch: false,
        totalUnits: 24,
        usableRentRowsCount: 23,
        rentRowsCount: 24,
      },
    });

    expect(result.dealScore).toBeGreaterThanOrEqual(70);
    expect(result.dealScore).toBeLessThanOrEqual(85);
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.capReasons).toHaveLength(0);
  });

  it("caps structurally risky mixed-use deals even when returns are strong", () => {
    const result = computeDealScore({
      purchasePrice: 6_000_000,
      noi: 390_000,
      grossRentalIncome: 720_000,
      adjustedCapRatePct: 7,
      adjustedNoi: 420_000,
      irrPct: 0.27,
      cocPct: 0.11,
      equityMultiple: 2.4,
      recommendedOfferHigh: 5_900_000,
      blendedRentUpliftPct: 15,
      annualExpenseGrowthPct: 3,
      vacancyPct: 6,
      exitCapRatePct: 7.4,
      hasDetailedExpenseRows: true,
      totalUnits: 8,
      riskProfile: {
        commercialRevenueSharePct: 0.57,
        rentStabilizedRevenueSharePct: 0.05,
        largestUnitRevenueSharePct: 0.41,
        rollover12moRevenueSharePct: 0.2,
        rentRollCoveragePct: 0.88,
        omDiscrepancyCount: 1,
        rapidOmMismatch: false,
        taxBurdenPct: 0.1,
        unsupportedRentGrowthPct: 1.8,
        missingLeaseDataPct: 0.2,
        missingOccupancyDataPct: 0.1,
        missingLeaseDataMajority: false,
        missingOccupancyDataMajority: false,
        smallAssetRiskLevel: "5_to_9",
        isPackageOm: false,
        missingEnrichmentGroup: false,
        explicitRecordMismatch: false,
        totalUnits: 8,
        usableRentRowsCount: 7,
        rentRowsCount: 8,
      },
    });

    expect(result.dealScore).toBeLessThanOrEqual(68);
    expect(result.capReasons).toContain("Structural concentration cap");
    expect(result.riskFlags.some((flag) => flag.includes("Commercial revenue share"))).toBe(true);
  });

  it("applies the financial viability cap to objectively broken return profiles", () => {
    const result = computeDealScore({
      purchasePrice: 8_135_000,
      noi: 446_730,
      grossRentalIncome: 610_000,
      adjustedCapRatePct: 5.48,
      adjustedNoi: 446_730,
      irrPct: -0.0402,
      cocPct: -0.0493,
      equityMultiple: 0.86,
      recommendedOfferHigh: 5_324_000,
      blendedRentUpliftPct: 38.18,
      annualExpenseGrowthPct: 0,
      vacancyPct: 2,
      exitCapRatePct: 5.25,
      hasDetailedExpenseRows: false,
      totalUnits: 9,
      riskProfile: {
        commercialRevenueSharePct: 0.26,
        rentStabilizedRevenueSharePct: 0.18,
        largestUnitRevenueSharePct: 0.18,
        rollover12moRevenueSharePct: 0.35,
        rentRollCoveragePct: 0.67,
        omDiscrepancyCount: 1,
        rapidOmMismatch: false,
        taxBurdenPct: 0.14,
        unsupportedRentGrowthPct: 12.6,
        missingLeaseDataPct: 0.55,
        missingOccupancyDataPct: 0.33,
        missingLeaseDataMajority: true,
        missingOccupancyDataMajority: false,
        smallAssetRiskLevel: "5_to_9",
        isPackageOm: false,
        missingEnrichmentGroup: false,
        explicitRecordMismatch: false,
        totalUnits: 9,
        usableRentRowsCount: 6,
        rentRowsCount: 9,
      },
    });

    expect(result.dealScore).toBeLessThanOrEqual(40);
    expect(result.capReasons).toContain("Financial viability cap");
    expect(resolveFinalDealScore({ llmScore: 90, deterministicScore: result.dealScore })).toBe(result.dealScore);
  });

  it("drops confidence and applies a data cap when rent-roll support is weak", () => {
    const result = computeDealScore({
      purchasePrice: 5_200_000,
      noi: 260_000,
      grossRentalIncome: null,
      adjustedCapRatePct: 6.1,
      adjustedNoi: 317_000,
      irrPct: 0.2,
      cocPct: 0.075,
      equityMultiple: 1.8,
      recommendedOfferHigh: 4_900_000,
      blendedRentUpliftPct: 58,
      annualExpenseGrowthPct: 1,
      vacancyPct: 2.5,
      exitCapRatePct: 5.8,
      hasDetailedExpenseRows: false,
      totalUnits: 11,
      hpdRentImpairingOpen: 1,
      riskProfile: {
        commercialRevenueSharePct: 0,
        rentStabilizedRevenueSharePct: 0.08,
        largestUnitRevenueSharePct: 0.14,
        rollover12moRevenueSharePct: 0.18,
        rentRollCoveragePct: 0.42,
        omDiscrepancyCount: 3,
        rapidOmMismatch: true,
        taxBurdenPct: 0.11,
        unsupportedRentGrowthPct: 33.64,
        missingLeaseDataPct: 0.75,
        missingOccupancyDataPct: 0.66,
        missingLeaseDataMajority: true,
        missingOccupancyDataMajority: true,
        smallAssetRiskLevel: "none",
        isPackageOm: true,
        missingEnrichmentGroup: true,
        explicitRecordMismatch: true,
        totalUnits: 11,
        usableRentRowsCount: 4,
        rentRowsCount: 11,
      },
    });

    expect(result.confidenceScore).toBeLessThan(0.45);
    expect(result.dealScore).toBeLessThanOrEqual(60);
    expect(result.capReasons).toContain("Data / regulatory cap");
  });
});
