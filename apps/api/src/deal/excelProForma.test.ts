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

    expect(workbook.SheetNames).toEqual(["Assumptions", "Financing", "Cash Flow", "Summary"]);

    expect(workbook.Sheets.Financing?.B2?.f).toBe("Assumptions!B7*(Assumptions!B20/100)");
    expect(workbook.Sheets.Financing?.B3?.f).toBe("B2*(Assumptions!B23/100)");
    expect(workbook.Sheets.Financing?.F13?.f).toBe(
      "IF(B13=0,0,IF(A13*12>=$B$8,0,IF($B$7=0,MAX(0,$B$2-($B$9*12*A13)),MAX(0,$B$2*(1+$B$7)^(MIN(A13*12,$B$8))-$B$9*(((1+$B$7)^(MIN(A13*12,$B$8))-1)/$B$7)))))"
    );

    expect(workbook.Sheets["Cash Flow"]?.D7?.f).toBe(
      "IF(OR(D$5=0,D$5>Assumptions!B41),0,D8+D9+D10)"
    );
    expect(workbook.Sheets["Cash Flow"]?.I7?.f).toBe(
      "IF(OR(I$5=0,I$5>Assumptions!B41),0,I8+I9+I10)"
    );
    expect(workbook.Sheets["Cash Flow"]?.D8?.f).toBe(
      "IF(OR(D$5=0,D$5>Assumptions!B41),0,Assumptions!B13*(1+Assumptions!B26/100)*(1+Assumptions!B33/100)^(D$5-1))"
    );
    expect(workbook.Sheets["Cash Flow"]?.D9?.f).toBe(
      "IF(OR(D$5=0,D$5>Assumptions!B41),0,Assumptions!B14)"
    );
    expect(workbook.Sheets["Cash Flow"]?.D10?.f).toBe(
      "IF(OR(D$5=0,D$5>Assumptions!B41),0,Assumptions!B15*(1+Assumptions!B34/100)^(D$5-1))"
    );
    expect(workbook.Sheets["Cash Flow"]?.D20?.f).toBe(
      "IF(OR(D$5=0,D$5>Assumptions!B41),0,-MAX(0,D7+D12+D13)*(Assumptions!B29/100))"
    );
    expect(workbook.Sheets["Cash Flow"]?.A21?.v).toBe("Total operating expenses");
    expect(workbook.Sheets["Cash Flow"]?.C21?.f).toBe("IF(OR(C$5=0,C$5>Assumptions!B41),0,SUM(C17:C20))");
    expect(workbook.Sheets["Cash Flow"]?.D31?.f).toBe(
      'IF(OR(D$5=0,D$5>Assumptions!B41),"",IF(D26=0,"",D24/ABS(D26)))'
    );
    expect(workbook.Sheets["Cash Flow"]?.D32?.f).toBe(
      'IF(OR(D$5=0,D$5>Assumptions!B41),"",IF(Financing!$B$6=0,"",D29/Financing!$B$6))'
    );
    expect(workbook.Sheets["Cash Flow"]?.H37?.f).toBe(
      "IF(H$5=Assumptions!B41,-SUM(C23:H23),0)"
    );
    expect(workbook.Sheets["Cash Flow"]?.A43?.v).toBe("Total levered CF incl. exit");
    expect(workbook.Sheets["Cash Flow"]?.C43?.f).toBe("C29+C37+C35+C36+C40+C41+C42");

    expect(workbook.Sheets.Summary?.E10?.f).toBe(
      `IFERROR(IRR('Cash Flow'!C38:INDEX(38:38,3+Assumptions!B41)),"")`
    );
    expect(workbook.Sheets.Summary?.E11?.f).toBe(
      `IF(ABS('Cash Flow'!C38)=0,0,SUMPRODUCT(('Cash Flow'!D38:INDEX(38:38,3+Assumptions!B41))*--('Cash Flow'!D38:INDEX(38:38,3+Assumptions!B41)>0))/ABS('Cash Flow'!C38))`
    );
    expect(workbook.Sheets.Summary?.E13?.f).toBe(
      `IFERROR(IRR('Cash Flow'!C43:INDEX(43:43,3+Assumptions!B41)),"")`
    );
    expect(workbook.Sheets.Summary?.E14?.f).toBe(
      `IF(ABS('Cash Flow'!C43)=0,0,SUMPRODUCT(('Cash Flow'!D43:INDEX(43:43,3+Assumptions!B41))*--('Cash Flow'!D43:INDEX(43:43,3+Assumptions!B41)>0))/ABS('Cash Flow'!C43))`
    );
    expect(workbook.Sheets.Summary?.E15?.f).toBe(
      `IF(ABS('Cash Flow'!C43)=0,0,(AVERAGE('Cash Flow'!D29:INDEX(29:29,3+Assumptions!B41))-AVERAGE('Cash Flow'!D27:INDEX(27:27,3+Assumptions!B41)))/ABS('Cash Flow'!C43))`
    );
    expect(workbook.Sheets.Summary?.E16?.f).toBe(
      `Assumptions!B44/100`
    );
    expect(workbook.Sheets.Summary?.E7?.f).toBe(`Assumptions!B42/100`);
    expect(workbook.Sheets.Summary?.E6?.f).toBe(
      `INDEX('Cash Flow'!C22:M22,1,IF(Assumptions!B32>0,MIN(Assumptions!B41,2),MIN(Assumptions!B41,1))+1)`
    );
    expect(workbook.Sheets.Summary?.B11?.f).toBe("Assumptions!B11");
    expect(workbook.Sheets.Summary?.B12?.f).toBe("Financing!B3");
  });

  it("uses the conservative blended opex-growth fallback when no expense rows are available", () => {
    const ctx = sampleContext();
    delete ctx.expenseRows;

    const workbook = XLSX.read(buildExcelProForma(ctx), { type: "buffer" });

    expect(workbook.Sheets["Cash Flow"]?.B17?.f).toBe("MAX(Assumptions!B36/100,Assumptions!B37/100)");
  });

  it("uses the augmented ask-cap NOI basis when provided", () => {
    const ctx = sampleContext();
    ctx.assetCapRateNoiBasis = 152_000;

    const workbook = XLSX.read(buildExcelProForma(ctx), { type: "buffer" });

    expect(workbook.Sheets.Summary?.B6?.f).toBe("IF(Assumptions!B7=0,0,152000/Assumptions!B7)");
  });
});
