import { describe, expect, it } from "vitest";
import type { PropertyDetails } from "@re-sourcing/contracts";
import { computeDealScore } from "./dealScoringEngine.js";
import { buildDossierTeaserData } from "./dossierTeaser.js";
import { dossierTeaserToPdf } from "./dossierTeaserToPdf.js";
import type { UnderwritingContext } from "./underwritingContext.js";

function sampleContext(): UnderwritingContext {
  return {
    propertyId: "property-teaser-1",
    canonicalAddress: "321 West 22nd Street, New York, NY 10011",
    purchasePrice: 5_000_000,
    listingCity: "Manhattan",
    currentNoi: 280_000,
    currentGrossRent: 430_000,
    currentOtherIncome: 5_000,
    unitCount: 12,
    dealScore: 74,
    currentStateNoi: 280_000,
    assetCapRateNoiBasis: 280_000,
    assetCapRate: 5.6,
    adjustedCapRate: 6.2,
    assumptions: {
      acquisition: {
        purchasePrice: 5_000_000,
        purchaseClosingCostPct: 2,
        renovationCosts: 150_000,
        furnishingSetupCosts: 60_000,
        onboardingCosts: 18_000,
        investmentProfile: "Furnished monthly-rental value-add",
        targetAcquisitionDate: "2026-06-15",
      },
      financing: {
        ltvPct: 65,
        interestRatePct: 6.25,
        amortizationYears: 30,
        loanFeePct: 1,
      },
      operating: {
        rentUpliftPct: 72,
        blendedRentUpliftPct: 72,
        expenseIncreasePct: 6,
        managementFeePct: 4,
        occupancyTaxPct: 0,
        vacancyPct: 7.5,
        leadTimeMonths: 3,
        annualRentGrowthPct: 3,
        annualCommercialRentGrowthPct: 2,
        annualOtherIncomeGrowthPct: 2,
        annualExpenseGrowthPct: 3,
        annualPropertyTaxGrowthPct: 3,
        recurringCapexAnnual: 12_000,
      },
      holdPeriodYears: 5,
      targetIrrPct: 16,
      exit: {
        exitCapPct: 6,
        exitClosingCostPct: 2,
      },
    },
    acquisition: {
      purchaseClosingCosts: 100_000,
      financingFees: 32_500,
      totalProjectCost: 5_360_500,
      loanAmount: 3_250_000,
      equityRequiredForPurchase: 1_750_000,
      initialEquityInvested: 2_110_500,
      year0CashFlow: -2_110_500,
    },
    financing: {
      loanAmount: 3_250_000,
      financingFees: 32_500,
      monthlyPayment: 20_010,
      annualDebtService: 240_120,
      remainingLoanBalanceAtExit: 3_050_000,
      principalPaydownAtExit: 200_000,
    },
    operating: {
      currentExpenses: 155_000,
      currentOtherIncome: 5_000,
      adjustedGrossRent: 739_600,
      adjustedOperatingExpenses: 220_000,
      managementFeeAmount: 29_584,
      stabilizedNoi: 310_000,
    },
    exit: {
      exitPropertyValue: 5_166_667,
      saleClosingCosts: 103_333,
      netSaleProceedsBeforeDebtPayoff: 5_063_334,
      remainingLoanBalance: 3_050_000,
      principalPaydownToDate: 200_000,
      netProceedsToEquity: 2_013_334,
    },
    cashFlows: {
      annualOperatingCashFlow: 69_880,
      annualOperatingCashFlows: [69_880, 82_000, 95_000, 108_000, 121_000],
      annualPrincipalPaydown: 35_000,
      annualPrincipalPaydowns: [35_000, 38_000, 41_000, 45_000, 49_000],
      annualEquityGain: 104_880,
      annualEquityGains: [104_880, 120_000, 136_000, 153_000, 170_000],
      finalYearCashFlow: 2_134_334,
      equityCashFlowSeries: [-2_110_500, 69_880, 82_000, 95_000, 108_000, 2_134_334],
    },
    returns: {
      irrPct: 0.18,
      equityMultiple: 1.92,
      year1CashOnCashReturn: 0.033,
      averageCashOnCashReturn: 0.045,
      year1EquityYield: 0.05,
      averageEquityYield: 0.064,
    },
    currentExpensesTotal: 155_000,
    expenseRows: [
      { lineItem: "Taxes", amount: 90_000 },
      { lineItem: "Insurance", amount: 14_000 },
    ],
    financialFlags: [
      "Purchase price: $5,000,000",
      "Score drag: Elevated furnished-rent uplift (72.0%)",
      "Score upside: IRR 18.0%",
    ],
    yearlyCashFlow: {
      years: [0, 1, 2, 3, 4, 5],
      endingLabels: ["Y0", "Y1", "Y2", "Y3", "Y4", "Y5"],
      propertyValue: [5_000_000, 5_000_000, 5_000_000, 5_000_000, 5_000_000, 5_166_667],
      grossRentalIncome: [0, 700_000, 739_600, 761_788, 784_642, 808_181],
      otherIncome: [0, 5_000, 5_100, 5_202, 5_306, 5_412],
      vacancyLoss: [0, 52_500, 55_470, 57_134, 58_848, 60_614],
      leadTimeLoss: [0, 40_000, 0, 0, 0, 0],
      netRentalIncome: [0, 612_500, 689_230, 709_856, 731_100, 752_979],
      managementFee: [0, 28_000, 29_584, 30_472, 31_386, 32_327],
      expenseLineItems: [],
      totalOperatingExpenses: [0, 212_000, 220_000, 226_600, 233_398, 240_400],
      noi: [0, 300_500, 310_000, 321_870, 334_316, 347_252],
      recurringCapex: [0, 12_000, 12_000, 12_000, 12_000, 12_000],
      reserveRelease: [0, 0, 0, 0, 0, 0],
      cashFlowFromOperations: [0, 288_500, 298_000, 309_870, 322_316, 335_252],
      capRateOnPurchase: [null, 0.0601, 0.062, 0.0644, 0.0669, 0.0695],
      debtService: [0, 240_120, 240_120, 240_120, 240_120, 240_120],
      principalPaid: [0, 35_000, 38_000, 41_000, 45_000, 49_000],
      interestPaid: [0, 205_120, 202_120, 199_120, 195_120, 191_120],
      cashFlowAfterFinancing: [0, 48_380, 57_880, 69_750, 82_196, 95_132],
      totalInvestmentCost: [-5_360_500, 0, 0, 0, 0, 0],
      financingFunding: [3_250_000, 0, 0, 0, 0, 0],
      financingFees: [32_500, 0, 0, 0, 0, 0],
      saleValue: [0, 0, 0, 0, 0, 5_166_667],
      saleClosingCosts: [0, 0, 0, 0, 0, 103_333],
      remainingLoanBalance: [3_250_000, 3_215_000, 3_177_000, 3_136_000, 3_091_000, 3_050_000],
      financingPayoff: [0, 0, 0, 0, 0, 3_050_000],
      netSaleProceedsBeforeDebtPayoff: [0, 0, 0, 0, 0, 5_063_334],
      netSaleProceedsToEquity: [0, 0, 0, 0, 0, 2_013_334],
      unleveredCashFlow: [-5_360_500, 288_500, 298_000, 309_870, 322_316, 5_501_919],
      leveredCashFlow: [-2_110_500, 48_380, 57_880, 69_750, 82_196, 2_108_466],
    },
    propertyMix: {
      totalUnits: 12,
      residentialUnits: 12,
      eligibleResidentialUnits: 12,
      commercialUnits: 0,
      rentStabilizedUnits: 0,
      eligibleRevenueSharePct: 1,
      eligibleUnitSharePct: 1,
    },
    recommendedOffer: {
      askingPrice: 5_000_000,
      targetIrrPct: 16,
      irrAtAskingPct: 0.18,
      recommendedOfferLow: 4_850_000,
      recommendedOfferHigh: 5_000_000,
      discountToAskingPct: 0,
      targetMetAtAsking: true,
    },
    rentBreakdown: {
      current: {
        freeMarketResidential: 430_000,
        protectedResidential: null,
        commercial: null,
        total: 430_000,
      },
      stabilizedYearNumber: 2,
      stabilized: {
        freeMarketResidential: 739_600,
        protectedResidential: null,
        commercial: null,
        total: 739_600,
      },
      freeMarketResidentialLift: 309_600,
      totalLift: 309_600,
    },
    conditionReview: {
      source: "images_and_text",
      overallCondition: "Dated / value-add",
      renovationScope: "Moderate interior refresh",
      imageQuality: "Medium",
      confidence: 0.7,
      imageCountAnalyzed: 8,
      coverageSeen: ["exterior", "kitchens"],
      coverageMissing: ["roof", "mechanicals"],
      observedSignals: ["dated finishes"],
      textSignals: ["value-add language"],
      summaryBullets: ["Photos and OM copy support a value-add scope."],
    },
  };
}

function sampleDetails(): PropertyDetails {
  return {
    omData: {
      authoritative: {
        propertyInfo: {
          totalUnits: 12,
          unitsResidential: 12,
          buildingSqft: 8_400,
          propertyType: "Multifamily",
        },
      },
    },
    neighborhood: {
      primary: {
        name: "Chelsea",
        borough: "Manhattan",
      },
      metrics: {
        medianPricePsf: 1_050,
        medianRent: 4_500,
        medianHouseholdIncome: 142_000,
        sourceAsOf: "2026-05-01",
      },
    },
  };
}

describe("dossierTeaser", () => {
  it("assembles a two-page teaser data model from underwriting, scoring, listing, and neighborhood inputs", () => {
    const ctx = sampleContext();
    const scoringResult = computeDealScore({
      purchasePrice: 5_000_000,
      noi: 280_000,
      grossRentalIncome: 430_000,
      adjustedCapRatePct: 6.2,
      adjustedNoi: 310_000,
      irrPct: 0.18,
      cocPct: 0.045,
      equityMultiple: 1.92,
      recommendedOfferHigh: 5_000_000,
      blendedRentUpliftPct: 72,
      annualExpenseGrowthPct: 3,
      vacancyPct: 7.5,
      exitCapRatePct: 6,
      hasDetailedExpenseRows: true,
      totalUnits: 12,
      furnishingSetupCosts: 60_000,
      scoringProfile: "value_add_furnished_monthly_rental",
      riskProfile: {
        commercialRevenueSharePct: 0,
        rentStabilizedRevenueSharePct: 0,
        largestUnitRevenueSharePct: 0.09,
        rollover12moRevenueSharePct: 0.18,
        rentRollCoveragePct: 1,
        omDiscrepancyCount: 0,
        rapidOmMismatch: false,
        taxBurdenPct: 0.12,
        unsupportedRentGrowthPct: 0,
        missingLeaseDataPct: 0,
        missingOccupancyDataPct: 0,
        missingLeaseDataMajority: false,
        missingOccupancyDataMajority: false,
        smallAssetRiskLevel: "none",
        isPackageOm: false,
        missingEnrichmentGroup: false,
        explicitRecordMismatch: false,
        totalUnits: 12,
        usableRentRowsCount: 12,
        rentRowsCount: 12,
      },
    });
    ctx.dealScore = scoringResult.dealScore;

    const teaser = buildDossierTeaserData({
      ctx,
      details: sampleDetails(),
      listing: {
        title: "Chelsea multifamily",
        price: 5_000_000,
        sqft: 8_400,
        imageUrls: ["https://example.com/hero.jpg"],
        extra: {},
      },
      scoringResult,
      generatedAt: "2026-05-27T12:00:00.000Z",
      sponsor: {
        name: "Tyler Tsay",
        email: "tyler@example.com",
        organization: "Acme Capital",
      },
    });

    expect(teaser.heroImageUrl).toBe("https://example.com/hero.jpg");
    expect(teaser.strategyLabel).toBe("Furnished monthly-rental value-add");
    expect(teaser.assetSummary).toContain("12 units");
    expect(teaser.assetSummary).toContain("Ask $5,000,000");
    expect(teaser.assetSummary).toContain("$595 PSF");
    expect(teaser.neighborhoodLabel).toBe("Chelsea");
    expect(teaser.kpis.map((kpi) => kpi.label)).toEqual([
      "Deal Score",
      "Purchase Price",
      "Projected IRR",
      "Equity Multiple",
      "Current Cap",
      "Stabilized Cap",
    ]);
    expect(teaser.investmentHighlights.some((item) => item.title === "Neighborhood Marker")).toBe(true);
    expect(teaser.capitalStack.find((row) => row.label === "Upfront CapEx")?.sublabel).toContain("furnishing");
    expect(teaser.returnScenarios.map((scenario) => scenario.label)).toEqual(["Downside", "Base", "Upside"]);
    expect(teaser.sponsor.organization).toBe("Acme Capital");
    expect(teaser.risks).toContain("Elevated furnished-rent uplift (72.0%)");
    expect(teaser.provenance.some((line) => line.includes("value-add-furnished-monthly-rental"))).toBe(true);
    expect(teaser.operatingSnapshot.find((row) => row.label === "Neighborhood median PSF")?.value).toBe("$1,050");
  });

  it("prefers saved manual building SF and surfaces diligence risks from enrichment and pricing", () => {
    const ctx = sampleContext();
    ctx.purchasePrice = 10_000_000;
    ctx.assumptions.acquisition.purchasePrice = 10_000_000;
    ctx.propertyMix.rentStabilizedUnits = 2;
    const details: PropertyDetails = {
      ...sampleDetails(),
      dealDossier: {
        assumptions: {
          buildingSqft: 7_800,
        },
      },
      enrichment: {
        dob_complaints_summary: { openCount: 2 },
        hpd_violations_summary: { openCount: 3, rentImpairingOpen: 1 },
        housing_litigations_summary: { openCount: 1 },
      },
    };

    const teaser = buildDossierTeaserData({
      ctx,
      details,
      listing: {
        title: "Chelsea multifamily",
        price: 12_000_000,
        sqft: 3_150,
        imageUrls: [],
        extra: {},
      },
      generatedAt: "2026-05-27T12:00:00.000Z",
    });

    expect(teaser.assetSummary).toContain("7,800 SF");
    expect(teaser.assetSummary).toContain("Ask $12,000,000");
    expect(teaser.assetSummary).toContain("$1,538 PSF");
    expect(teaser.risks.some((risk) => risk.includes("open DOB complaint"))).toBe(true);
    expect(teaser.risks.some((risk) => risk.includes("open housing litigation"))).toBe(true);
    expect(teaser.risks.some((risk) => risk.includes("rent-stabilized"))).toBe(true);
    expect(teaser.risks.some((risk) => risk.includes("Modeled purchase PSF"))).toBe(true);
    expect(teaser.provenance.some((line) => line.includes("manual underwriting override (7,800 SF)"))).toBe(true);
  });

  it("renders the teaser data through the separate PDF path", async () => {
    const teaser = buildDossierTeaserData({
      ctx: sampleContext(),
      details: sampleDetails(),
      listing: null,
      generatedAt: "2026-05-27T12:00:00.000Z",
    });

    const pdf = await dossierTeaserToPdf(teaser);

    expect(pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(3_000);
  });
});
