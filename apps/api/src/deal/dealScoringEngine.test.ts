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

    expect(result.dealScore).toBeGreaterThanOrEqual(75);
    expect(result.dealScore).toBeLessThanOrEqual(90);
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.capReasons).toHaveLength(0);
  });

  it("pushes small, high-adjusted-cap townhouse opportunities into the target high-conviction range", () => {
    const result = computeDealScore({
      purchasePrice: 3_999_000,
      noi: 197_368,
      grossRentalIncome: 312_000,
      adjustedCapRatePct: 6.98,
      adjustedNoi: 278_970,
      irrPct: 0.1787,
      cocPct: 0.0363,
      equityMultiple: 2.26,
      recommendedOfferHigh: 3_539_000,
      blendedRentUpliftPct: 70,
      annualExpenseGrowthPct: 1,
      vacancyPct: 15,
      exitCapRatePct: 5,
      hasDetailedExpenseRows: true,
      totalUnits: 2,
      riskProfile: {
        commercialRevenueSharePct: 0,
        rentStabilizedRevenueSharePct: 0,
        largestUnitRevenueSharePct: 0.54,
        rollover12moRevenueSharePct: 0,
        rentRollCoveragePct: 1,
        omDiscrepancyCount: 1,
        rapidOmMismatch: false,
        taxBurdenPct: 0.25,
        unsupportedRentGrowthPct: 0,
        missingLeaseDataPct: 1,
        missingOccupancyDataPct: 0,
        missingLeaseDataMajority: true,
        missingOccupancyDataMajority: false,
        smallAssetRiskLevel: "under_5",
        isPackageOm: true,
        missingEnrichmentGroup: false,
        explicitRecordMismatch: false,
        totalUnits: 2,
        usableRentRowsCount: 2,
        rentRowsCount: 2,
      },
    });

    expect(result.dealScore).toBeGreaterThanOrEqual(80);
    expect(result.dealScore).toBeLessThanOrEqual(85);
    expect(result.positiveSignals).toContain("Adjusted cap 6.98%");
  });

  it("keeps mid-quality mixed-use package deals in a medium range instead of forcing them into near-zero scores", () => {
    const result = computeDealScore({
      purchasePrice: 8_135_000,
      noi: 446_272,
      grossRentalIncome: 617_208,
      adjustedCapRatePct: 6.35,
      adjustedNoi: 516_601,
      irrPct: 0.1255,
      cocPct: 0.0235,
      equityMultiple: 1.79,
      recommendedOfferHigh: 6_665_000,
      blendedRentUpliftPct: 36.08,
      annualExpenseGrowthPct: 1,
      vacancyPct: 15,
      exitCapRatePct: 5,
      hasDetailedExpenseRows: true,
      totalUnits: 10,
      riskProfile: {
        commercialRevenueSharePct: 0.46,
        rentStabilizedRevenueSharePct: 0.04,
        largestUnitRevenueSharePct: 0.23,
        rollover12moRevenueSharePct: 0.29,
        rentRollCoveragePct: 1,
        omDiscrepancyCount: 1,
        rapidOmMismatch: false,
        taxBurdenPct: 0.17,
        unsupportedRentGrowthPct: 0,
        missingLeaseDataPct: 0,
        missingOccupancyDataPct: 0,
        missingLeaseDataMajority: false,
        missingOccupancyDataMajority: false,
        smallAssetRiskLevel: "none",
        isPackageOm: true,
        missingEnrichmentGroup: false,
        explicitRecordMismatch: false,
        totalUnits: 10,
        usableRentRowsCount: 10,
        rentRowsCount: 10,
      },
    });

    expect(result.dealScore).toBeGreaterThanOrEqual(40);
    expect(result.dealScore).toBeLessThanOrEqual(65);
  });

  it("does not let the townhouse opportunity overlay rescue small assets with negative returns", () => {
    const result = computeDealScore({
      purchasePrice: 4_750_000,
      noi: 159_414,
      grossRentalIncome: 224_400,
      adjustedCapRatePct: 4.57,
      adjustedNoi: 216_938,
      irrPct: -0.1413,
      cocPct: -0.0353,
      equityMultiple: 0.56,
      recommendedOfferHigh: 2_746_000,
      blendedRentUpliftPct: 70,
      annualExpenseGrowthPct: 1,
      vacancyPct: 15,
      exitCapRatePct: 5,
      hasDetailedExpenseRows: true,
      totalUnits: 4,
      riskProfile: {
        commercialRevenueSharePct: 0,
        rentStabilizedRevenueSharePct: 0,
        largestUnitRevenueSharePct: 0.32,
        rollover12moRevenueSharePct: 0,
        rentRollCoveragePct: 1,
        omDiscrepancyCount: 1,
        rapidOmMismatch: false,
        taxBurdenPct: 0.18,
        unsupportedRentGrowthPct: 0,
        missingLeaseDataPct: 0.25,
        missingOccupancyDataPct: 0.25,
        missingLeaseDataMajority: false,
        missingOccupancyDataMajority: false,
        smallAssetRiskLevel: "under_5",
        isPackageOm: true,
        missingEnrichmentGroup: false,
        explicitRecordMismatch: false,
        totalUnits: 4,
        usableRentRowsCount: 4,
        rentRowsCount: 4,
      },
    });

    expect(result.dealScore).toBeLessThanOrEqual(10);
    expect(result.capReasons).toContain("Financial viability cap");
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

    expect(result.dealScore).toBeLessThanOrEqual(35);
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
