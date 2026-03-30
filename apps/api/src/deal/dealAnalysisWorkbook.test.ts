import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { buildDealAnalysisWorkbook } from "./dealAnalysisWorkbook.js";
import type { UnderwritingContext } from "./underwritingContext.js";

function findRowByLabel(worksheet: ExcelJS.Worksheet | undefined, label: string): number | null {
  if (!worksheet) return null;
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    if (worksheet.getCell(`A${row}`).value === label) {
      return row;
    }
  }
  return null;
}

function sampleContext(): UnderwritingContext {
  return {
    propertyId: "property-1",
    canonicalAddress: "123 Main St, New York, NY",
    purchasePrice: 1_000_000,
    listingCity: "New York",
    currentNoi: 80_000,
    currentGrossRent: 120_000,
    currentOtherIncome: 8_000,
    unitCount: 6,
    dealScore: 82,
    assetCapRateNoiBasis: 80_000,
    assetCapRate: 8,
    adjustedCapRate: 8.47,
    assumptions: {
      acquisition: {
        purchasePrice: 1_000_000,
        purchaseClosingCostPct: 3,
        renovationCosts: 100_000,
        furnishingSetupCosts: 20_000,
        onboardingCosts: 15_000,
        investmentProfile: "Value-add",
        targetAcquisitionDate: "2026-05-01",
      },
      financing: {
        ltvPct: 70,
        interestRatePct: 6,
        amortizationYears: 30,
        loanFeePct: 1,
      },
      operating: {
        rentUpliftPct: 10,
        blendedRentUpliftPct: 7.5,
        expenseIncreasePct: 5,
        managementFeePct: 4,
        occupancyTaxPct: 0,
        vacancyPct: 3,
        leadTimeMonths: 3,
        annualRentGrowthPct: 3,
        annualCommercialRentGrowthPct: 2,
        annualOtherIncomeGrowthPct: 2,
        annualExpenseGrowthPct: 3,
        annualPropertyTaxGrowthPct: 4,
        recurringCapexAnnual: 10_000,
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
      financingFees: 7_000,
      totalProjectCost: 1_165_000,
      loanAmount: 700_000,
      equityRequiredForPurchase: 300_000,
      initialEquityInvested: 472_000,
      year0CashFlow: -472_000,
    },
    financing: {
      loanAmount: 700_000,
      financingFees: 7_000,
      monthlyPayment: 4_196.84,
      annualDebtService: 50_362.08,
      remainingLoanBalanceAtExit: 651_000,
    },
    operating: {
      currentExpenses: 48_000,
      currentOtherIncome: 8_000,
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
      annualOperatingCashFlows: [34_357.92, 35_100, 35_900, 36_700, 37_500],
      annualUnleveredCashFlows: [55_000, 56_200, 57_400, 58_700, 59_900],
      unleveredCashFlowSeries: [-1_165_000, 55_000, 56_200, 57_400, 58_700, 1_471_900],
      finalYearCashFlow: 767_117.92,
      equityCashFlowSeries: [-472_000, 34_357.92, 35_100, 35_900, 36_700, 767_117.92],
    },
    returns: {
      irrPct: 0.156,
      equityMultiple: 2.02,
      year1CashOnCashReturn: 0.076,
      averageCashOnCashReturn: 0.076,
    },
    expenseRows: [
      { lineItem: "Taxes", amount: 20_000 },
      { lineItem: "Insurance", amount: 8_000 },
      { lineItem: "Repairs", amount: 12_000 },
    ],
    currentExpensesTotal: 48_000,
    yearlyCashFlow: {
      years: [0, 1, 2, 3, 4, 5],
      endingLabels: ["Y0", "Y1", "Y2", "Y3", "Y4", "Y5"],
      propertyValue: [1_000_000, 1_030_000, 1_060_900, 1_092_727, 1_125_508, 1_159_273],
      grossRentalIncome: [0, 132_000, 135_960, 140_039, 144_240, 148_567],
      otherIncome: [0, 8_000, 8_160, 8_323, 8_490, 8_659],
      vacancyLoss: [0, -3_960, -4_079, -4_201, -4_327, -4_457],
      leadTimeLoss: [0, -33_000, 0, 0, 0, 0],
      netRentalIncome: [0, 103_040, 140_041, 144_161, 148_403, 152_769],
      managementFee: [0, -3_801, -5_438, -5_602, -5_770, -5_943],
      expenseLineItems: [
        { lineItem: "Taxes", annualGrowthPct: 4, baseAmount: 20_000, yearlyAmounts: [20_800, 21_632, 22_497, 23_397, 24_333] },
        { lineItem: "Insurance", annualGrowthPct: 3, baseAmount: 8_000, yearlyAmounts: [8_240, 8_487, 8_742, 9_004, 9_274] },
        { lineItem: "Repairs", annualGrowthPct: 3, baseAmount: 12_000, yearlyAmounts: [12_360, 12_731, 13_113, 13_507, 13_912] },
      ],
      totalOperatingExpenses: [0, -45_201, -48_288, -49_954, -51_678, -53_462],
      noi: [0, 57_839, 91_753, 94_207, 96_725, 99_307],
      recurringCapex: [0, -10_000, -10_000, -10_000, -10_000, -10_000],
      reserveRelease: [0, 0, 0, 0, 0, 50_000],
      cashFlowFromOperations: [0, 47_839, 81_753, 84_207, 86_725, 89_307],
      capRateOnPurchase: [null, 0.0578, 0.0918, 0.0942, 0.0967, 0.0993],
      debtService: [0, -50_362.08, -50_362.08, -50_362.08, -50_362.08, -50_362.08],
      principalPaid: [0, -8_704.73, -9_242.35, -9_813.18, -10_419.29, -11_062.84],
      interestPaid: [0, -41_657.35, -41_119.73, -40_548.9, -39_942.79, -39_299.24],
      cashFlowAfterFinancing: [0, -2_523.16, 31_390.92, 33_844.92, 36_362.92, 38_944.92],
      totalInvestmentCost: [-1_165_000, 0, 0, 0, 0, 0],
      financingFunding: [700_000, 0, 0, 0, 0, 0],
      financingFees: [-7_000, 0, 0, 0, 0, 0],
      saleValue: [0, 0, 0, 0, 0, 1_655_117],
      saleClosingCosts: [0, 0, 0, 0, 0, -33_102],
      remainingLoanBalance: [700_000, 691_295, 682_053, 672_240, 661_820, 650_758],
      financingPayoff: [0, 0, 0, 0, 0, -650_758],
      netSaleProceedsBeforeDebtPayoff: [0, 0, 0, 0, 0, 1_622_015],
      netSaleProceedsToEquity: [0, 0, 0, 0, 0, 971_257],
      unleveredCashFlow: [-1_165_000, 47_839, 81_753, 84_207, 86_725, 1_761_322],
      leveredCashFlow: [693_000, -2_523.16, 31_390.92, 33_844.92, 36_362.92, 1_010_201.92],
    },
    propertyMix: {
      totalUnits: 6,
      residentialUnits: 6,
      eligibleResidentialUnits: 4,
      commercialUnits: 1,
      rentStabilizedUnits: 1,
      eligibleRevenueSharePct: 0.75,
      eligibleUnitSharePct: 0.67,
    },
    rentBreakdown: {
      current: {
        freeMarketResidential: 90_000,
        protectedResidential: 18_000,
        commercial: 12_000,
        total: 120_000,
      },
      stabilizedYearNumber: 2,
      stabilized: {
        freeMarketResidential: 108_900,
        protectedResidential: 18_000,
        commercial: 12_240,
        total: 139_140,
      },
      freeMarketResidentialLift: 18_900,
      totalLift: 19_140,
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildDealAnalysisWorkbook", () => {
  it("creates a styled workbook with visible analysis tabs and hidden support tabs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const { buffer } = await buildDealAnalysisWorkbook(sampleContext());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => [sheet.name, sheet.state])).toEqual([
      ["Assumptions", "visible"],
      ["FinancingModel", "hidden"],
      ["CashFlowModel", "hidden"],
      ["Summary", "visible"],
    ]);

    const assumptions = workbook.getWorksheet("Assumptions");
    const summary = workbook.getWorksheet("Summary");
    const financing = workbook.getWorksheet("FinancingModel");
    const cashFlow = workbook.getWorksheet("CashFlowModel");

    expect(assumptions).toBeDefined();
    expect(summary).toBeDefined();
    expect(financing).toBeDefined();
    expect(cashFlow).toBeDefined();

    expect(assumptions?.getCell("A1").value).toBe("Deal Dossier Workbook");
    expect(assumptions?.getCell("C13").value).toBe(1_000_000);
    expect(assumptions?.getCell("C13").font?.color?.argb).toBe("FF5B9BD5");
    expect((assumptions?.getCell("C23").value as ExcelJS.CellFormulaValue).formula).toBe(
      "CurrentFreeMarketResidentialGrossRent+CurrentProtectedResidentialGrossRent+CurrentCommercialGrossRent"
    );
    expect((assumptions?.getCell("C37").value as ExcelJS.CellFormulaValue).formula).toBe(
      "RentUpliftPct*(EligibleRevenueSharePct/100)"
    );

    expect((financing?.getCell("B2").value as ExcelJS.CellFormulaValue).formula).toBe(
      "PurchasePrice*(LtvPct/100)"
    );
    expect((financing?.getCell("D13").value as ExcelJS.CellFormulaValue).formula).toContain("PPMT");
    expect((financing?.getCell("E13").value as ExcelJS.CellFormulaValue).formula).toContain("IPMT");
    expect((cashFlow?.getCell("C7").value as ExcelJS.CellFormulaValue).formula).toBe(
      "IF(OR(C$5=0,C$5>HoldPeriodYears),0,C8+C9+C10)"
    );
    expect((cashFlow?.getCell("B8").value as ExcelJS.CellFormulaValue).formula).toBe(
      "BlendedRentUpliftPct/100"
    );
    expect((cashFlow?.getCell("D17").value as ExcelJS.CellFormulaValue).formula).toContain("B17");
    expect((cashFlow?.getCell("D17").value as ExcelJS.CellFormulaValue).result).toBe(-20_800);
    expect(cashFlow?.getCell("D17").fill?.fgColor?.argb).toBe("FFFFFFFF");
    const totalInvestmentCostRow = findRowByLabel(cashFlow, "Total investment cost");
    const totalLeveredCashFlowRow = findRowByLabel(cashFlow, "Total levered CF incl. exit");
    expect(totalInvestmentCostRow).not.toBeNull();
    expect(totalLeveredCashFlowRow).not.toBeNull();
    expect(
      (
        cashFlow?.getCell(`C${totalLeveredCashFlowRow!}`).value as ExcelJS.CellFormulaValue
      ).formula
    ).toContain(`C${totalInvestmentCostRow!}`);

    expect(summary?.views?.[0]?.showGridLines).toBe(false);
    expect(summary?.getCell("B20").numFmt).toBe("0.00%");
    expect((summary?.getCell("C5").value as ExcelJS.CellFormulaValue).formula).toBe("PropertyAddress");
    expect((summary?.getCell("C20").value as ExcelJS.CellFormulaValue).formula).toBe("CashFlowModel!C6");
    expect((summary?.getCell("H14").value as ExcelJS.CellFormulaValue).formula).toBe(
      "CalculatedEquityMultiple"
    );
  });
});
