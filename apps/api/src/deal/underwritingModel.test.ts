import { describe, expect, it } from "vitest";
import {
  MAX_UNDERWRITING_HOLD_PERIOD_YEARS,
  conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode,
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveDossierAssumptions,
} from "./underwritingModel.js";

describe("underwritingModel", () => {
  it("builds the equity cash flow series from acquisition, financing, operations, and exit buckets", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-1",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 5,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 10,
        defaultExpenseIncrease: 5,
        defaultManagementFee: 4,
        defaultVacancyPct: 0,
        defaultLeadTimeMonths: 0,
        defaultAnnualRentGrowthPct: 0,
        defaultAnnualOtherIncomeGrowthPct: 0,
        defaultAnnualExpenseGrowthPct: 0,
        defaultAnnualPropertyTaxGrowthPct: 0,
        defaultRecurringCapexAnnual: 0,
        defaultLoanFeePct: 0,
      },
      1_000_000,
      {
        renovationCosts: 100_000,
        furnishingSetupCosts: 20_000,
      }
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 120_000,
      currentNoi: 80_000,
    });

    expect(projection.acquisition.purchaseClosingCosts).toBeCloseTo(30_000, 2);
    expect(projection.acquisition.totalProjectCost).toBeCloseTo(1_150_000, 2);
    expect(projection.acquisition.loanAmount).toBeCloseTo(700_000, 2);
    expect(projection.acquisition.initialEquityInvested).toBeCloseTo(450_000, 2);
    expect(projection.acquisition.year0CashFlow).toBeCloseTo(-450_000, 2);

    expect(projection.operating.adjustedGrossRent).toBeCloseTo(132_000, 2);
    expect(projection.operating.adjustedOperatingExpenses).toBeCloseTo(42_000, 2);
    expect(projection.operating.managementFeeAmount).toBeCloseTo(5_280, 2);
    expect(projection.operating.stabilizedNoi).toBeCloseTo(84_720, 2);

    expect(projection.yearly.cashFlowFromOperations[0]).toBe(0);
    expect(projection.yearly.totalInvestmentCost[0]).toBeCloseTo(-1_150_000, 2);
    expect(projection.cashFlows.annualOperatingCashFlows).toHaveLength(5);
    expect(projection.cashFlows.equityCashFlowSeries).toHaveLength(6);
    expect(projection.cashFlows.equityCashFlowSeries[0]).toBeCloseTo(-450_000, 2);
    expect(projection.cashFlows.finalYearCashFlow).toBeGreaterThan(projection.cashFlows.annualOperatingCashFlow);

    expect(projection.exit.exitPropertyValue).toBeCloseTo(1_412_000, 2);
    expect(projection.exit.saleClosingCosts).toBeCloseTo(28_240, 2);
    expect(projection.exit.netProceedsToEquity).toBeGreaterThan(0);
    expect(projection.financing.remainingLoanBalanceAtExit).toBeCloseTo(
      projection.exit.remainingLoanBalance,
      2
    );

    expect(projection.returns.irr).not.toBeNull();
    expect(projection.returns.equityMultiple).toBeGreaterThan(1);
    expect(projection.returns.year1CashOnCashReturn).not.toBeNull();
    expect(projection.returns.averageCashOnCashReturn).not.toBeNull();
  });

  it("applies vacancy and lead-time deductions while recovering principal paydown through the exit payoff", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-3",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 5,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 10,
        defaultExpenseIncrease: 5,
        defaultManagementFee: 4,
        defaultVacancyPct: 15,
        defaultLeadTimeMonths: 2,
        defaultAnnualRentGrowthPct: 1,
        defaultAnnualOtherIncomeGrowthPct: 0,
        defaultAnnualExpenseGrowthPct: 0,
        defaultAnnualPropertyTaxGrowthPct: 0,
        defaultRecurringCapexAnnual: 1_200,
        defaultLoanFeePct: 0,
      },
      1_000_000,
      {
        renovationCosts: 100_000,
        furnishingSetupCosts: 20_000,
      }
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 120_000,
      currentNoi: 80_000,
    });

    expect(projection.yearly.grossRentalIncome[1]).toBeCloseTo(132_000, 2);
    expect(projection.yearly.vacancyLoss[1]).toBeCloseTo(19_800, 2);
    expect(projection.yearly.leadTimeLoss[1]).toBeCloseTo(22_000, 2);
    expect(projection.yearly.managementFee[1]).toBeCloseTo(5_280, 2);
    expect(projection.yearly.noi[1]).toBeCloseTo(42_920, 2);
    expect(projection.yearly.cashFlowFromOperations[1]).toBeCloseTo(41_720, 2);

    expect(projection.exit.principalPaydownToDate).toBeCloseTo(
      projection.financing.loanAmount - projection.exit.remainingLoanBalance,
      2
    );
    expect(projection.exit.netProceedsToEquity).toBeCloseTo(
      projection.exit.netSaleProceedsBeforeDebtPayoff - projection.exit.remainingLoanBalance,
      2
    );
    expect(projection.exit.netProceedsToEquity).toBeCloseTo(
      projection.exit.netSaleProceedsBeforeDebtPayoff -
        (projection.financing.loanAmount - projection.exit.principalPaydownToDate),
      2
    );
  });

  it("applies a conservative blended opex growth fallback when taxes cannot be isolated", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-4b",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 3,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 10,
        defaultExpenseIncrease: 0,
        defaultManagementFee: 4,
        defaultVacancyPct: 0,
        defaultLeadTimeMonths: 0,
        defaultAnnualRentGrowthPct: 0,
        defaultAnnualOtherIncomeGrowthPct: 0,
        defaultAnnualExpenseGrowthPct: 0,
        defaultAnnualPropertyTaxGrowthPct: 8,
        defaultRecurringCapexAnnual: 0,
        defaultLoanFeePct: 0,
      },
      1_000_000
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 120_000,
      currentNoi: 80_000,
      currentExpensesTotal: 40_000,
    });

    expect(projection.yearly.expenseLineItems).toHaveLength(1);
    expect(projection.yearly.expenseLineItems[0]?.annualGrowthPct).toBe(8);
    expect(projection.yearly.expenseLineItems[0]?.yearlyAmounts).toEqual([40_000, 43_200, 46_656]);
  });

  it("caps hold periods to the supported Excel model horizon", () => {
    const assumptions = resolveDossierAssumptions(
      null,
      1_000_000,
      {
        holdPeriodYears: 99,
      }
    );

    expect(assumptions.holdPeriodYears).toBe(MAX_UNDERWRITING_HOLD_PERIOD_YEARS);
  });

  it("blends rent uplift and furnishing defaults around protected units", () => {
    const assumptions = resolveDossierAssumptions(
      null,
      5_000_000,
      null,
      {
        details: {
          rentalFinancials: {
            omAnalysis: {
              propertyInfo: { totalUnits: 4, unitsResidential: 3, unitsCommercial: 1 },
              rentRoll: [
                { unit: "1", annualRent: 100_000, beds: 2, sqft: 900, unitCategory: "Residential" },
                { unit: "2", annualRent: 100_000, beds: 2, sqft: 850, unitCategory: "Residential" },
                { unit: "Store", annualRent: 100_000, unitCategory: "Retail" },
                { unit: "4", annualRent: 100_000, beds: 1, sqft: 700, rentType: "Rent Stabilized" },
              ],
            },
          },
        },
      }
    );

    expect(assumptions.propertyMix.commercialUnits).toBe(1);
    expect(assumptions.propertyMix.rentStabilizedUnits).toBe(1);
    expect(assumptions.propertyMix.eligibleResidentialUnits).toBe(2);
    expect(assumptions.operating.rentUpliftPct).toBe(76.3);
    expect(assumptions.operating.blendedRentUpliftPct).toBeCloseTo(38.15, 2);
    expect(assumptions.acquisition.furnishingSetupCosts).toBe(22_500);
  });

  it("maps NYC tax classes to conservative property-tax growth defaults", () => {
    expect(conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode("1")).toBe(6);
    expect(conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode(" 2b ")).toBe(8);
    expect(conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode("2")).toBe(20);
    expect(conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode("4")).toBe(20);
    expect(conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode("3")).toBeNull();
    expect(conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode(null)).toBeNull();
  });

  it("uses NYC tax-class auto defaults before profile fallback while preserving explicit overrides", () => {
    const profile = {
      id: "profile-4",
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      defaultPurchaseClosingCostPct: 3,
      defaultLtv: 64,
      defaultInterestRate: 6,
      defaultAmortization: 30,
      defaultHoldPeriodYears: 2,
      defaultExitCap: 5,
      defaultExitClosingCostPct: 6,
      defaultRentUplift: 76.3,
      defaultExpenseIncrease: 0,
      defaultManagementFee: 8,
      defaultTargetIrrPct: 25,
      defaultVacancyPct: 15,
      defaultLeadTimeMonths: 2,
      defaultAnnualRentGrowthPct: 1,
      defaultAnnualOtherIncomeGrowthPct: 0,
      defaultAnnualExpenseGrowthPct: 0,
      defaultAnnualPropertyTaxGrowthPct: 6,
      defaultRecurringCapexAnnual: 1_200,
      defaultLoanFeePct: 0.63,
    };

    const autoAssumptions = resolveDossierAssumptions(profile, 5_000_000, null, {
      details: { taxCode: "2A" },
    });
    expect(autoAssumptions.operating.annualPropertyTaxGrowthPct).toBe(8);

    const fallbackAssumptions = resolveDossierAssumptions(profile, 5_000_000, null, {
      details: { taxCode: "3" },
    });
    expect(fallbackAssumptions.operating.annualPropertyTaxGrowthPct).toBe(6);

    const explicitOverrideAssumptions = resolveDossierAssumptions(
      profile,
      5_000_000,
      { annualPropertyTaxGrowthPct: 11 },
      { details: { taxCode: "4" } }
    );
    expect(explicitOverrideAssumptions.operating.annualPropertyTaxGrowthPct).toBe(11);
  });

  it("solves for a lower recommended offer when the ask misses the target IRR", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-2",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 5,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 10,
        defaultExpenseIncrease: 5,
        defaultManagementFee: 4,
        defaultTargetIrrPct: 25,
        defaultVacancyPct: 0,
        defaultLeadTimeMonths: 0,
        defaultAnnualRentGrowthPct: 0,
        defaultAnnualOtherIncomeGrowthPct: 0,
        defaultAnnualExpenseGrowthPct: 0,
        defaultAnnualPropertyTaxGrowthPct: 0,
        defaultRecurringCapexAnnual: 0,
        defaultLoanFeePct: 0,
      },
      1_400_000
    );

    const recommendedOffer = computeRecommendedOffer({
      assumptions,
      currentGrossRent: 120_000,
      currentNoi: 80_000,
    });

    expect(recommendedOffer.recommendedOfferHigh).not.toBeNull();
    expect(recommendedOffer.recommendedOfferHigh ?? 0).toBeLessThan(1_400_000);
    expect(recommendedOffer.discountToAskingPct ?? 0).toBeGreaterThan(0);
    expect(recommendedOffer.targetMetAtAsking).toBe(false);
  });
});
