import { describe, expect, it } from "vitest";
import {
  MAX_UNDERWRITING_HOLD_PERIOD_YEARS,
  computeRecommendedOffer,
  computeUnderwritingProjection,
  defaultAnnualPropertyTaxGrowthPctFromNycTaxCode,
  resolveAssetCapRateNoiBasis,
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
        occupancyTaxPct: 0,
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
    expect(projection.cashFlows.annualPrincipalPaydowns).toHaveLength(5);
    expect(projection.cashFlows.equityCashFlowSeries).toHaveLength(6);
    expect(projection.cashFlows.equityCashFlowSeries[0]).toBeCloseTo(-450_000, 2);
    expect(projection.cashFlows.finalYearCashFlow).toBeGreaterThan(projection.cashFlows.annualOperatingCashFlow);
    expect(projection.cashFlows.annualEquityGain).toBeCloseTo(
      projection.cashFlows.annualOperatingCashFlow + projection.cashFlows.annualPrincipalPaydown,
      2
    );

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
    expect(projection.returns.year1EquityYield).not.toBeNull();
    expect((projection.returns.year1EquityYield ?? 0)).toBeGreaterThan(
      projection.returns.year1CashOnCashReturn ?? -1
    );
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
        occupancyTaxPct: 0,
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
    expect(projection.yearly.managementFee[1]).toBeCloseTo(4_488, 2);
    expect(projection.yearly.noi[1]).toBeCloseTo(43_712, 2);
    expect(projection.yearly.cashFlowFromOperations[1]).toBeCloseTo(42_512, 2);
    expect(projection.cashFlows.annualPrincipalPaydown).toBeCloseTo(
      projection.yearly.principalPaid[1] ?? 0,
      2
    );
    expect(projection.cashFlows.annualEquityGain).toBeCloseTo(
      (projection.yearly.cashFlowAfterFinancing[1] ?? 0) + (projection.yearly.principalPaid[1] ?? 0),
      2
    );

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
      1_000_000,
      { occupancyTaxPct: 0 }
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

  it("removes explicit management-fee lines from the expense base before projecting opex", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-4c",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 3,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 0,
        defaultExpenseIncrease: 20,
        defaultManagementFee: 8,
        defaultVacancyPct: 0,
        defaultLeadTimeMonths: 0,
        defaultAnnualRentGrowthPct: 0,
        defaultAnnualOtherIncomeGrowthPct: 0,
        defaultAnnualExpenseGrowthPct: 0,
        defaultAnnualPropertyTaxGrowthPct: 8,
        defaultRecurringCapexAnnual: 0,
        defaultLoanFeePct: 0,
      },
      1_000_000,
      { occupancyTaxPct: 0 }
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 100_000,
      currentNoi: 82_000,
      currentExpensesTotal: 18_000,
      expenseRows: [
        { lineItem: "Property Taxes", amount: 10_000 },
        { lineItem: "Insurance", amount: 5_000 },
        { lineItem: "Management Fee", amount: 3_000 },
      ],
    });

    expect(projection.yearly.expenseLineItems.map((row) => row.lineItem)).toEqual([
      "Property Taxes",
      "Insurance",
    ]);
    expect(projection.operating.currentExpenses).toBeCloseTo(15_000, 2);
    expect(projection.operating.adjustedOperatingExpenses).toBeCloseTo(18_000, 2);
    expect(projection.yearly.managementFee[1]).toBeCloseTo(8_000, 2);
    expect(projection.yearly.totalOperatingExpenses[1]).toBeCloseTo(26_000, 2);
    expect(projection.yearly.totalOperatingExpenses[2]).toBeCloseTo(26_960, 2);
  });

  it("honors explicit replace-management treatment even when the line item name is generic", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-4d",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 3,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 0,
        defaultExpenseIncrease: 20,
        defaultManagementFee: 8,
        defaultVacancyPct: 0,
        defaultLeadTimeMonths: 0,
        defaultAnnualRentGrowthPct: 0,
        defaultAnnualOtherIncomeGrowthPct: 0,
        defaultAnnualExpenseGrowthPct: 0,
        defaultAnnualPropertyTaxGrowthPct: 8,
        defaultRecurringCapexAnnual: 0,
        defaultLoanFeePct: 0,
      },
      1_000_000,
      { occupancyTaxPct: 0 }
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 100_000,
      currentNoi: 82_000,
      currentExpensesTotal: 18_000,
      expenseRows: [
        { lineItem: "Property Taxes", amount: 10_000 },
        { lineItem: "Insurance", amount: 5_000 },
        { lineItem: "Payroll Allocation", amount: 3_000, treatment: "replace_management" },
      ],
    });

    expect(projection.yearly.expenseLineItems.map((row) => row.lineItem)).toEqual([
      "Property Taxes",
      "Insurance",
    ]);
    expect(projection.operating.currentExpenses).toBeCloseTo(15_000, 2);
    expect(projection.yearly.totalOperatingExpenses[1]).toBeCloseTo(26_000, 2);
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
      { occupancyTaxPct: 0 },
      {
        details: {
          omData: {
            authoritative: {
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

  it("applies uplift, vacancy, and lead time only to eligible free-market rent while protected rent stays flat", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-protected",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 3,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 50,
        defaultExpenseIncrease: 0,
        defaultManagementFee: 8,
        defaultVacancyPct: 10,
        defaultLeadTimeMonths: 2,
        defaultAnnualRentGrowthPct: 5,
        defaultAnnualOtherIncomeGrowthPct: 0,
        defaultAnnualExpenseGrowthPct: 0,
        defaultAnnualPropertyTaxGrowthPct: 0,
        defaultRecurringCapexAnnual: 0,
        defaultLoanFeePct: 0,
      },
      1_000_000,
      { occupancyTaxPct: 0 },
      {
        details: {
          omData: {
            authoritative: {
              propertyInfo: { totalUnits: 4, unitsResidential: 3, unitsCommercial: 1 },
              rentRoll: [
                { unit: "1", annualRent: 120_000, unitCategory: "Residential" },
                { unit: "2", annualRent: 80_000, unitCategory: "Residential", rentType: "Rent Stabilized" },
                { unit: "Store", annualRent: 100_000, unitCategory: "Commercial" },
              ],
            },
          },
        },
      }
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 300_000,
      currentNoi: 240_000,
    });

    expect(assumptions.operating.blendedRentUpliftPct).toBeCloseTo(20, 2);
    expect(projection.yearly.grossRentalIncome[1]).toBeCloseTo(360_000, 2);
    expect(projection.yearly.grossRentalIncome[2]).toBeCloseTo(369_000, 2);
    expect(projection.yearly.vacancyLoss[1]).toBeCloseTo(18_000, 2);
    expect(projection.yearly.vacancyLoss[2]).toBeCloseTo(18_900, 2);
    expect(projection.yearly.leadTimeLoss[1]).toBeCloseTo(30_000, 2);
  });

  it("adds vacant free-market residential projected rent into the uplift base", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-vacant-project",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 3,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 70,
        defaultExpenseIncrease: 0,
        defaultManagementFee: 0,
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
      { occupancyTaxPct: 0 }
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 152_400,
      currentNoi: 152_400,
      conservativeProjectedLeaseUpRent: 72_000,
    });

    expect(projection.yearly.grossRentalIncome[1]).toBeCloseTo(381_480, 2);
    expect(projection.yearly.grossRentalIncome[1]).toBeCloseTo((152_400 + 72_000) * 1.7, 2);
    expect(projection.yearly.grossRentalIncome[1]).not.toBeCloseTo(152_400 * 1.7 + 72_000, 2);
  });

  it("keeps protected projected rent outside the uplift base", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-protected-vacant-project",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 3,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 70,
        defaultExpenseIncrease: 0,
        defaultManagementFee: 0,
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
      { occupancyTaxPct: 0 }
    );

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 152_400,
      currentNoi: 152_400,
      conservativeProjectedLeaseUpRent: 86_400,
      protectedProjectedLeaseUpRent: 14_400,
    });

    expect(projection.yearly.grossRentalIncome[1]).toBeCloseTo(395_880, 2);
    expect(projection.yearly.grossRentalIncome[1]).toBeCloseTo((152_400 + 72_000) * 1.7 + 14_400, 2);
  });

  it("reconstructs the ask-cap NOI basis from current gross rent and expenses when vacant projected rent is available", () => {
    const noiBasis = resolveAssetCapRateNoiBasis({
      currentNoi: 79_794,
      currentGrossRent: 152_400,
      currentExpensesTotal: 64_986,
      conservativeProjectedLeaseUpRent: 72_000,
    });

    expect(noiBasis).toBe(159_414);
  });

  it("maps NYC tax classes to normalized underwriting tax-growth defaults", () => {
    expect(defaultAnnualPropertyTaxGrowthPctFromNycTaxCode("1")).toBe(3);
    expect(defaultAnnualPropertyTaxGrowthPctFromNycTaxCode(" 2b ")).toBe(3);
    expect(defaultAnnualPropertyTaxGrowthPctFromNycTaxCode("2")).toBe(4);
    expect(defaultAnnualPropertyTaxGrowthPctFromNycTaxCode("4")).toBe(4);
    expect(defaultAnnualPropertyTaxGrowthPctFromNycTaxCode("3")).toBeNull();
    expect(defaultAnnualPropertyTaxGrowthPctFromNycTaxCode(null)).toBeNull();
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
    expect(autoAssumptions.operating.annualPropertyTaxGrowthPct).toBe(3);

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
      1_400_000,
      { occupancyTaxPct: 0 }
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

  it("uses per-unit overrides for furnishing, occupancy-aware revenue, and recommended-offer math", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-unit-model",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 5,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 0,
        defaultExpenseIncrease: 0,
        defaultManagementFee: 0,
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
      1_400_000,
      {
        furnishingSetupCosts: 0,
        occupancyTaxPct: 0,
      }
    );

    const unitRows = [
      {
        rowId: "market-1",
        unitLabel: "Unit 1",
        underwrittenAnnualRent: 100_000,
        rentUpliftPct: 20,
        occupancyPct: 80,
        furnishingCost: 10_000,
        onboardingFee: 2_500,
        monthlyHospitalityExpense: 300,
        includeInUnderwriting: true,
        isProtected: false,
      },
      {
        rowId: "protected-2",
        unitLabel: "Unit 2",
        underwrittenAnnualRent: 80_000,
        rentUpliftPct: 0,
        occupancyPct: 100,
        furnishingCost: 0,
        onboardingFee: 0,
        monthlyHospitalityExpense: 100,
        includeInUnderwriting: true,
        isProtected: true,
      },
    ] as const;

    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 180_000,
      currentNoi: 180_000,
      unitRows: [...unitRows],
    });
    const recommendedOfferWithUnitRows = computeRecommendedOffer({
      assumptions,
      currentGrossRent: 180_000,
      currentNoi: 180_000,
      unitRows: [...unitRows],
    });
    const recommendedOfferWithoutUnitRows = computeRecommendedOffer({
      assumptions,
      currentGrossRent: 180_000,
      currentNoi: 180_000,
    });

    expect(projection.assumptions.acquisition.furnishingSetupCosts).toBe(10_000);
    expect(projection.assumptions.acquisition.onboardingCosts).toBe(2_500);
    expect(projection.assumptions.operating.blendedRentUpliftPct).toBeCloseTo(11.11, 2);
    expect(projection.yearly.grossRentalIncome[1]).toBeCloseTo(200_000, 2);
    expect(projection.yearly.vacancyLoss[1]).toBeCloseTo(24_000, 2);
    expect(projection.operating.adjustedGrossRent).toBeCloseTo(176_000, 2);
    expect(
      projection.yearly.expenseLineItems.find((row) => row.lineItem === "Monthly hospitality / unit opex")
        ?.yearlyAmounts[0]
    ).toBe(4_800);
    expect(recommendedOfferWithUnitRows.irrAtAskingPct ?? 0).toBeLessThan(
      recommendedOfferWithoutUnitRows.irrAtAskingPct ?? 0
    );
  });
});
