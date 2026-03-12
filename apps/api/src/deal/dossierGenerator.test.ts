import { describe, expect, it } from "vitest";
import { buildDossierStructuredText } from "./dossierGenerator.js";
import type { UnderwritingContext } from "./underwritingContext.js";

function sampleContext(): UnderwritingContext {
  return {
    propertyId: "property-1",
    canonicalAddress: "123 Main St, New York, NY",
    purchasePrice: 1_000_000,
    listingCity: "New York",
    currentNoi: 80_000,
    currentGrossRent: 120_000,
    unitCount: 6,
    dealScore: 82,
    assetCapRate: 8,
    adjustedCapRate: 8.47,
    assumptions: {
      acquisition: {
        purchasePrice: 1_000_000,
        purchaseClosingCostPct: 3,
        renovationCosts: 100_000,
        furnishingSetupCosts: 20_000,
      },
      financing: {
        ltvPct: 70,
        interestRatePct: 6,
        amortizationYears: 30,
      },
      operating: {
        rentUpliftPct: 10,
        blendedRentUpliftPct: 8,
        expenseIncreasePct: 5,
        managementFeePct: 4,
        annualPropertyTaxGrowthPct: 3,
      },
      holdPeriodYears: 5,
      targetIrrPct: 14,
      exit: {
        exitCapPct: 6,
        exitClosingCostPct: 2,
      },
    },
    acquisition: {
      purchaseClosingCosts: 30_000,
      totalProjectCost: 1_150_000,
      loanAmount: 700_000,
      equityRequiredForPurchase: 300_000,
      initialEquityInvested: 450_000,
      year0CashFlow: -450_000,
    },
    financing: {
      loanAmount: 700_000,
      monthlyPayment: 4_196.84,
      annualDebtService: 50_362.08,
      remainingLoanBalanceAtExit: 651_000,
    },
    operating: {
      currentExpenses: 40_000,
      adjustedGrossRent: 132_000,
      adjustedOperatingExpenses: 42_000,
      managementFeeAmount: 5_280,
      stabilizedNoi: 84_720,
    },
    exit: {
      exitPropertyValue: 1_412_000,
      saleClosingCosts: 28_240,
      netSaleProceedsBeforeDebtPayoff: 1_383_760,
      remainingLoanBalance: 651_000,
      netProceedsToEquity: 732_760,
    },
    cashFlows: {
      annualOperatingCashFlow: 34_357.92,
      annualOperatingCashFlows: [34_357.92, 34_357.92, 34_357.92, 34_357.92, 34_357.92],
      annualPrincipalPaydown: 8_704.73,
      annualPrincipalPaydowns: [8_704.73, 9_242.35, 9_813.18, 10_419.29, 11_062.84],
      annualEquityGain: 43_062.65,
      annualEquityGains: [43_062.65, 43_600.27, 44_171.1, 44_777.21, 45_420.76],
      finalYearCashFlow: 767_117.92,
      equityCashFlowSeries: [-450_000, 34_357.92, 34_357.92, 34_357.92, 34_357.92, 767_117.92],
    },
    yearlyCashFlow: {
      years: [0, 1, 2, 3, 4, 5],
      endingLabels: ["Y0", "Y1", "Y2", "Y3", "Y4", "Y5"],
      propertyValue: [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
      grossRentalIncome: [0, 132_000, 132_000, 132_000, 132_000, 132_000],
      otherIncome: [0, 0, 0, 0, 0, 0],
      vacancyLoss: [0, 19_800, 19_800, 19_800, 19_800, 19_800],
      leadTimeLoss: [0, 22_000, 0, 0, 0, 0],
      netRentalIncome: [0, 90_200, 112_200, 112_200, 112_200, 112_200],
      managementFee: [0, 5_280, 5_280, 5_280, 5_280, 5_280],
      expenseLineItems: [
        { lineItem: "Taxes", annualGrowthPct: 8, baseAmount: 20_000, yearlyAmounts: [20_000, 21_600, 23_328, 25_194, 27_210] },
      ],
      totalOperatingExpenses: [0, 47_280, 48_880, 50_608, 52_474, 54_490],
      noi: [0, 42_920, 63_320, 61_592, 59_726, 57_710],
      recurringCapex: [0, 0, 0, 0, 0, 0],
      cashFlowFromOperations: [0, 42_920, 63_320, 61_592, 59_726, 57_710],
      capRateOnPurchase: [null, 0.04292, 0.06332, 0.061592, 0.059726, 0.05771],
      debtService: [0, 50_362.08, 50_362.08, 50_362.08, 50_362.08, 50_362.08],
      principalPaid: [0, 8_704.73, 9_242.35, 9_813.18, 10_419.29, 11_062.84],
      interestPaid: [0, 41_657.35, 41_119.73, 40_548.9, 39_942.79, 39_299.24],
      cashFlowAfterFinancing: [0, -7_442.08, 12_957.92, 11_229.92, 9_363.92, 7_347.92],
      totalInvestmentCost: [-1_150_000, 0, 0, 0, 0, 0],
      financingFunding: [700_000, 0, 0, 0, 0, 0],
      financingFees: [0, 0, 0, 0, 0, 0],
      saleValue: [0, 0, 0, 0, 0, 1_412_000],
      saleClosingCosts: [0, 0, 0, 0, 0, 28_240],
      remainingLoanBalance: [700_000, 691_295.27, 682_052.92, 672_239.74, 661_820.45, 651_000],
      financingPayoff: [0, 0, 0, 0, 0, 651_000],
      netSaleProceedsBeforeDebtPayoff: [0, 0, 0, 0, 0, 1_383_760],
      netSaleProceedsToEquity: [0, 0, 0, 0, 0, 732_760],
      unleveredCashFlow: [-1_150_000, 42_920, 63_320, 61_592, 59_726, 1_441_470],
      leveredCashFlow: [-450_000, -7_442.08, 12_957.92, 11_229.92, 9_363.92, 740_107.92],
    },
    returns: {
      irrPct: 0.156,
      equityMultiple: 2.02,
      year1CashOnCashReturn: 0.076,
      averageCashOnCashReturn: 0.076,
      year1EquityYield: 0.0957,
      averageEquityYield: 0.0976,
    },
    rentRollRows: [
      { label: "Unit 1", annualRent: 24_000 },
    ],
    expenseRows: [
      { lineItem: "Taxes", amount: 20_000 },
    ],
    currentExpensesTotal: 40_000,
    financialFlags: ["Purchase price: $1,000,000"],
    propertyOverview: {
      taxCode: "2A",
    },
    propertyMix: {
      totalUnits: 6,
      residentialUnits: 6,
      eligibleResidentialUnits: 6,
      commercialUnits: 0,
      rentStabilizedUnits: 0,
      totalAnnualRent: 24_000,
      commercialAnnualRent: 0,
      rentStabilizedAnnualRent: 0,
      freeMarketAnnualRent: 24_000,
      eligibleRevenueSharePct: 1,
      eligibleUnitSharePct: 1,
    },
    recommendedOffer: {
      askingPrice: 1_000_000,
      targetIrrPct: 14,
      irrAtAskingPct: 0.156,
      recommendedOfferLow: 950_000,
      recommendedOfferHigh: 980_000,
      discountToAskingPct: 2,
      targetMetAtAsking: true,
    },
    conditionReview: {
      source: "images_and_text",
      overallCondition: "Dated / value-add",
      renovationScope: "Moderate",
      imageQuality: "Medium",
      confidence: 0.62,
      imageCountAnalyzed: 5,
      coverageSeen: ["exterior", "kitchen", "bathroom"],
      coverageMissing: ["mechanicals", "roof"],
      observedSignals: ["dated kitchen finishes", "bathrooms appear older"],
      textSignals: ["value-add / dated-condition language"],
      summaryBullets: ["Photos show dated interiors and the OM explicitly frames the asset as value-add."],
    },
  };
}

describe("buildDossierStructuredText", () => {
  it("includes property condition review in the overview section", () => {
    const text = buildDossierStructuredText(sampleContext());

    expect(text).toContain(
      "Property-tax growth source: auto NYC underwriting default for tax class 2A (3.00% normalized annual tax-growth assumption for small Class 2 property)."
    );
    expect(text).toContain("Condition: Dated / value-add");
    expect(text).toContain("Renovation scope: Moderate");
    expect(text).toContain("Photo review: 5 image(s) analyzed; image quality Medium; confidence moderate");
    expect(text).toContain("Photos cover: exterior, kitchen, bathroom");
    expect(text).toContain("Not visible in photos: mechanicals, roof");
    expect(text).not.toContain("IRR at asking");
    expect(text).toContain("**Gross rental income**");
    expect(text).toContain("Vacancy loss");
    expect(text).toContain("Operating expenses ex management");
    expect(text).toContain("Management fee (4%)");
    expect(text).toContain("Principal paydown (equity build)");
    expect(text).toContain("NSP before debt payoff");
    expect(text).toContain("Total cash uses incl. financing fees");
    expect(text).toContain("Equity yield (year 1)");
    expect(text).toContain("| **CF after financing (cash)** | **$0** | **($7,442)** |");
    expect(text).toContain("| **Levered CF** | **($450,000)** | **($7,442)** |");
  });

  it("renders package notes in the property overview", () => {
    const ctx = sampleContext();
    ctx.canonicalAddress = "18-20 Christopher Street, Manhattan, NY 10014";
    ctx.propertyOverview = {
      taxCode: "2A",
      packageNote:
        "Package OM covers multiple buildings or lots (Block 593, Lots 42 and 43); property-level BBL and HPD registration data may reflect only the canonical listing address.",
    };

    const text = buildDossierStructuredText(ctx);

    expect(text).toContain("Address: 18-20 Christopher Street, Manhattan, NY 10014");
    expect(text).toContain("Package note: Package OM covers multiple buildings or lots (Block 593, Lots 42 and 43); property-level BBL and HPD registration data may reflect only the canonical listing address.");
  });

  it("renders a sale-cap sensitivity table with IRR by exit cap", () => {
    const ctx = sampleContext();
    ctx.sensitivities = [
      {
        key: "exit_cap_rate",
        title: "Sale Cap Rate Sensitivity",
        inputLabel: "Sale cap rate (%)",
        baseCase: {
          valuePct: 6,
          irrPct: 0.156,
          year1CashOnCashReturn: 0.076,
          year1EquityYield: 0.0957,
        },
        ranges: {
          irrPct: { min: 0.132, max: 0.184 },
          year1CashOnCashReturn: { min: 0.076, max: 0.076 },
          year1EquityYield: { min: 0.0957, max: 0.0957 },
        },
        scenarios: [
          {
            valuePct: 5,
            irrPct: 0.184,
            year1CashOnCashReturn: 0.076,
            year1EquityYield: 0.0957,
            stabilizedNoi: 84_720,
            annualOperatingCashFlow: 34_357.92,
            exitPropertyValue: 1_694_400,
            netProceedsToEquity: 1_009_272,
          },
          {
            valuePct: 5.5,
            irrPct: 0.169,
            year1CashOnCashReturn: 0.076,
            year1EquityYield: 0.0957,
            stabilizedNoi: 84_720,
            annualOperatingCashFlow: 34_357.92,
            exitPropertyValue: 1_540_364,
            netProceedsToEquity: 858_557,
          },
          {
            valuePct: 6.5,
            irrPct: 0.143,
            year1CashOnCashReturn: 0.076,
            year1EquityYield: 0.0957,
            stabilizedNoi: 84_720,
            annualOperatingCashFlow: 34_357.92,
            exitPropertyValue: 1_303_385,
            netProceedsToEquity: 626_317,
          },
          {
            valuePct: 7,
            irrPct: 0.132,
            year1CashOnCashReturn: 0.076,
            year1EquityYield: 0.0957,
            stabilizedNoi: 84_720,
            annualOperatingCashFlow: 34_357.92,
            exitPropertyValue: 1_210_286,
            netProceedsToEquity: 535_080,
          },
        ],
      },
    ];

    const text = buildDossierStructuredText(ctx);

    expect(text).toContain("• Base sale cap rate (%): 6.00%; IRR range 13.20% to 18.40% across alternate sale-cap assumptions");
    expect(text).toContain("| Sale cap rate (%) | Exit value | Net sale proceeds to equity | IRR |");
    expect(text).toContain("| 5.00% | $1,694,400 | $1,009,272 | 18.40% |");
    expect(text).toContain("| **Base (6.00%)** | **$1,412,000** | **$732,760** | **15.60%** |");
    expect(text).toContain("| 7.00% | $1,210,286 | $535,080 | 13.20% |");
    expect(text.indexOf("| 5.50% |")).toBeLessThan(text.indexOf("| **Base (6.00%)** |"));
    expect(text.indexOf("| **Base (6.00%)** |")).toBeLessThan(text.indexOf("| 6.50% |"));
  });
});
