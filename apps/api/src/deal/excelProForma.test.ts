import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildExcelProForma } from "./excelProForma.js";
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
        expenseIncreasePct: 5,
        managementFeePct: 4,
      },
      holdPeriodYears: 5,
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
      { label: "Unit 2", annualRent: 24_000 },
      { label: "Unit 3", annualRent: 24_000 },
      { label: "Unit 4", annualRent: 24_000 },
      { label: "Unit 5", annualRent: 12_000 },
      { label: "Unit 6", annualRent: 12_000 },
    ],
    expenseRows: [
      { lineItem: "Taxes", amount: 20_000 },
      { lineItem: "Insurance", amount: 8_000 },
      { lineItem: "Repairs", amount: 12_000 },
    ],
    currentExpensesTotal: 40_000,
    financialFlags: ["Purchase price: $1,000,000"],
    amortizationSchedule: [
      { year: 1, principalPayment: 8_704.73, interestPayment: 41_657.35, debtService: 50_362.08, endingBalance: 691_295.27 },
      { year: 2, principalPayment: 9_242.35, interestPayment: 41_119.73, debtService: 50_362.08, endingBalance: 682_052.92 },
      { year: 3, principalPayment: 9_813.18, interestPayment: 40_548.9, debtService: 50_362.08, endingBalance: 672_239.74 },
      { year: 4, principalPayment: 10_419.29, interestPayment: 39_942.79, debtService: 50_362.08, endingBalance: 661_820.45 },
      { year: 5, principalPayment: 11_062.84, interestPayment: 39_299.24, debtService: 50_362.08, endingBalance: 650_757.61 },
    ],
  };
}

describe("buildExcelProForma", () => {
  it("creates a workbook with linked formulas across the model sheets", () => {
    const workbook = XLSX.read(buildExcelProForma(sampleContext()), { type: "buffer" });

    expect(workbook.SheetNames).toEqual([
      "Assumptions",
      "CurrentFinancials",
      "Acquisition",
      "Operations",
      "Financing",
      "Exit",
      "CashFlow",
      "Returns",
      "Sensitivities",
      "Summary",
    ]);

    expect(workbook.Sheets.Acquisition?.B5?.f).toBe("B3*(B4/100)");
    expect(workbook.Sheets.Operations?.B14?.f).toBe("B11-B12-B13");
    expect(workbook.Sheets.Exit?.B10?.f).toBe("B8-B9");
    expect(workbook.Sheets.CashFlow?.B5?.f).toBe('IF(A5<=Exit!$B$3,C5+E5,"")');
    expect(workbook.Sheets.Returns?.B5?.f).toBe('IFERROR(IRR(CashFlow!B4:INDEX(CashFlow!B:B,4+Exit!B3)),"")');
    expect(workbook.Sheets.Sensitivities?.E8?.f).toBe('IFERROR(IRR(H8:INDEX(8:8,58)),"")');
    expect(workbook.Sheets.Summary?.B17?.f).toBe("Returns!B5");
  });
});
