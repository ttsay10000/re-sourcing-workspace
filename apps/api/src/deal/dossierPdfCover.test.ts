import { describe, expect, it } from "vitest";
import type { PropertyDetails } from "@re-sourcing/contracts";
import { buildDossierPdfCoverData } from "./dossierPdfCover.js";
import type { UnderwritingContext } from "./underwritingContext.js";

describe("buildDossierPdfCoverData", () => {
  it("maps underwriting and OM inputs into the first-page cover summary", () => {
    const ctx: UnderwritingContext = {
      propertyId: "prop-1",
      canonicalAddress: "347 East 19th Street, New York, NY 10003",
      purchasePrice: 3_999_999,
      listingCity: "Manhattan",
      currentNoi: 165_000,
      currentGrossRent: 280_000,
      currentOtherIncome: 1_400,
      unitCount: 2,
      dealScore: 82,
      conservativeProjectedLeaseUpRent: 15_000,
      currentStateNoi: 197_368,
      assetCapRateNoiBasis: 197_368,
      assetCapRate: 4.94,
      adjustedCapRate: 6.98,
      assumptions: {
        acquisition: {
          purchasePrice: 3_999_999,
          purchaseClosingCostPct: 2,
          renovationCosts: 55_000,
          furnishingSetupCosts: 0,
        },
        financing: {
          ltvPct: 65,
          interestRatePct: 6,
          amortizationYears: 30,
          loanFeePct: 1,
        },
        operating: {
          rentUpliftPct: 18,
          blendedRentUpliftPct: 18,
          expenseIncreasePct: 8,
          managementFeePct: 4,
          vacancyPct: 5,
          leadTimeMonths: 3,
          annualRentGrowthPct: 3,
          annualOtherIncomeGrowthPct: 2,
          annualExpenseGrowthPct: 3,
          annualPropertyTaxGrowthPct: 3,
          recurringCapexAnnual: 6_000,
        },
        holdPeriodYears: 5,
        targetIrrPct: 22,
        exit: {
          exitCapPct: 5.75,
          exitClosingCostPct: 2,
        },
      },
      acquisition: {
        purchaseClosingCosts: 80_000,
        financingFees: 20_000,
        totalProjectCost: 4_154_999,
        loanAmount: 2_599_999,
        equityRequiredForPurchase: 1_400_000,
        initialEquityInvested: 1_500_000,
        year0CashFlow: -1_500_000,
      },
      financing: {
        loanAmount: 2_599_999,
        financingFees: 20_000,
        monthlyPayment: 15_600,
        annualDebtService: 187_200,
        remainingLoanBalanceAtExit: 2_400_000,
        principalPaydownAtExit: 199_999,
      },
      operating: {
        currentExpenses: 114_632,
        currentOtherIncome: 1_400,
        adjustedGrossRent: 535_704,
        adjustedOperatingExpenses: 154_000,
        managementFeeAmount: 22_378,
        stabilizedNoi: 278_970,
      },
      exit: {
        exitPropertyValue: 4_800_000,
        saleClosingCosts: 96_000,
        netSaleProceedsBeforeDebtPayoff: 4_704_000,
        remainingLoanBalance: 2_400_000,
        principalPaydownToDate: 199_999,
        netProceedsToEquity: 2_304_000,
      },
      cashFlows: {
        annualOperatingCashFlow: 88_000,
        annualOperatingCashFlows: [88_000, 96_000, 102_000, 108_000, 114_000],
        annualPrincipalPaydown: 32_000,
        annualPrincipalPaydowns: [32_000, 35_000, 39_000, 44_000, 49_000],
        annualEquityGain: 120_000,
        annualEquityGains: [120_000, 131_000, 141_000, 152_000, 163_000],
        annualUnleveredCashFlows: [200_000, 210_000, 220_000, 230_000, 240_000],
        finalYearCashFlow: 2_420_000,
        unleveredCashFlowSeries: [-4_154_999, 200_000, 210_000, 220_000, 230_000, 4_944_000],
        equityCashFlowSeries: [-1_500_000, 88_000, 96_000, 102_000, 108_000, 2_420_000],
      },
      returns: {
        irrPct: 0.22,
        equityMultiple: 2.1,
        year1CashOnCashReturn: 0.058,
        averageCashOnCashReturn: 0.074,
        year1EquityYield: 0.08,
        averageEquityYield: 0.11,
      },
      propertyOverview: {
        taxCode: "1",
      },
      expenseRows: [
        { lineItem: "Taxes", amount: 90_000 },
        { lineItem: "Insurance", amount: 8_000 },
      ],
      currentExpensesTotal: 114_632,
      financialFlags: ["Sample flag"],
      yearlyCashFlow: {
        years: [0, 1, 2, 3, 4, 5],
        endingLabels: ["Y0", "Y1", "Y2", "Y3", "Y4", "Y5"],
        propertyValue: [3_999_999, 4_119_999, 4_243_599, 4_370_907, 4_502_034, 4_637_095],
        grossRentalIncome: [0, 480_000, 535_704, 551_775, 568_328, 585_378],
        otherIncome: [0, 1_400, 1_428, 1_457, 1_486, 1_516],
        vacancyLoss: [0, 24_000, 26_785, 27_589, 28_416, 29_269],
        leadTimeLoss: [0, 30_000, 0, 0, 0, 0],
        netRentalIncome: [0, 427_400, 510_347, 525_643, 541_398, 557_625],
        managementFee: [0, 19_200, 21_428, 22_071, 22_733, 23_415],
        expenseLineItems: [],
        totalOperatingExpenses: [0, 138_000, 176_378, 181_669, 187_119, 192_733],
        noi: [0, 289_400, 278_970, 343_974, 354_279, 364_892],
        recurringCapex: [0, 6_000, 6_000, 6_000, 6_000, 6_000],
        cashFlowFromOperations: [0, 283_400, 272_970, 337_974, 348_279, 358_892],
        capRateOnPurchase: [null, 0.072, 0.0697, 0.086, 0.0885, 0.0912],
        debtService: [0, 187_200, 187_200, 187_200, 187_200, 187_200],
        principalPaid: [0, 32_000, 35_000, 39_000, 44_000, 49_000],
        interestPaid: [0, 155_200, 152_200, 148_200, 143_200, 138_200],
        cashFlowAfterFinancing: [0, 96_200, 85_770, 150_774, 161_079, 171_692],
        totalInvestmentCost: [-4_154_999, 0, 0, 0, 0, 0],
        financingFunding: [2_599_999, 0, 0, 0, 0, 0],
        financingFees: [20_000, 0, 0, 0, 0, 0],
        saleValue: [0, 0, 0, 0, 0, 6_345_948],
        saleClosingCosts: [0, 0, 0, 0, 0, 126_919],
        remainingLoanBalance: [2_599_999, 2_567_999, 2_532_999, 2_493_999, 2_449_999, 2_400_000],
        financingPayoff: [0, 0, 0, 0, 0, 2_400_000],
        netSaleProceedsBeforeDebtPayoff: [0, 0, 0, 0, 0, 6_219_029],
        netSaleProceedsToEquity: [0, 0, 0, 0, 0, 3_819_029],
        unleveredCashFlow: [-4_154_999, 283_400, 272_970, 337_974, 348_279, 6_577_921],
        leveredCashFlow: [-1_500_000, 96_200, 85_770, 150_774, 161_079, 3_990_721],
      },
      propertyMix: {
        totalUnits: 2,
        residentialUnits: 2,
        eligibleResidentialUnits: 2,
        commercialUnits: 0,
        rentStabilizedUnits: 0,
        eligibleRevenueSharePct: 1,
        eligibleUnitSharePct: 1,
      },
      recommendedOffer: {
        askingPrice: 3_999_999,
        targetIrrPct: 22,
        irrAtAskingPct: 0.19,
        recommendedOfferLow: 3_610_000,
        recommendedOfferHigh: 3_800_000,
        discountToAskingPct: 5,
        targetMetAtAsking: false,
      },
    };

    const details: PropertyDetails = {
      taxCode: "1",
      omData: {
        authoritative: {
          propertyInfo: {
            totalUnits: 2,
            unitsResidential: 2,
            buildingSqft: 5_940,
            yearBuilt: 1930,
            zoning: "R8B",
            propertyType: "townhouse",
          },
        },
      },
      enrichment: {
        zoning: {
          zoningDistrict1: "R8B",
        },
      },
    };

    const cover = buildDossierPdfCoverData({
      ctx,
      details,
      listing: {
        title: "Prime Gramercy townhouse",
        price: 3_999_999,
        beds: 4,
        baths: 2.5,
        sqft: 5_940,
        imageUrls: ["https://example.com/photo.jpg"],
        extra: { buildingType: "townhouse" },
      },
    });

    expect(cover.address).toBe("347 East 19th Street, New York, NY 10003");
    expect(cover.backgroundImageUrl).toBe("https://example.com/photo.jpg");
    expect(cover.propertyInfo.rows[0]).toEqual({
      label: "Asset class",
      value: "MF townhouse",
      emphasis: false,
    });
    expect(cover.propertyInfo.rows[1]?.value).toBe("5,940 SQFT");
    expect(cover.acquisitionInfo.rows[2]?.value).toBe("$3,999,999");
    expect(cover.acquisitionInfo.rows[3]?.value).toBe("$3,800,000 / $640 PSF");
    expect(cover.keyFinancials.rows[0]?.value).toBe("$296,400 (projected)");
    expect(cover.keyFinancials.rows[2]?.value).toBe("$197,368");
    expect(cover.keyFinancials.rows[7]?.value).toBe("+41%");
    expect(cover.expectedReturns.rows[0]?.value).toBe("$55,000");
    expect(cover.expectedReturns.rows[3]?.value).toBe("22.00%");
  });
});
