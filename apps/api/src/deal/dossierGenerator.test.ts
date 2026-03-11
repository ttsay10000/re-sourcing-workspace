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
        annualPropertyTaxGrowthPct: 8,
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
      finalYearCashFlow: 767_117.92,
      equityCashFlowSeries: [-450_000, 34_357.92, 34_357.92, 34_357.92, 34_357.92, 767_117.92],
    },
    returns: {
      irrPct: 0.156,
      equityMultiple: 2.02,
      year1CashOnCashReturn: 0.076,
      averageCashOnCashReturn: 0.076,
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
      "Property-tax growth source: auto from NYC tax class 2A cap (8.00% annual assessed-value cap for small Class 2 property)."
    );
    expect(text).toContain("Condition: Dated / value-add");
    expect(text).toContain("Renovation scope: Moderate");
    expect(text).toContain("Photo review: 5 image(s) analyzed; image quality Medium; confidence moderate");
    expect(text).toContain("Photos cover: exterior, kitchen, bathroom");
    expect(text).toContain("Not visible in photos: mechanicals, roof");
    expect(text).not.toContain("IRR at asking");
    expect(text).toContain("Year 1 cash flow after debt service");
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
});
