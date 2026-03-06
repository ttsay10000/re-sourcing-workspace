/**
 * Excel pro forma: build workbook (Summary, Revenue, Expenses, Debt, Cash Flow, Returns).
 * Saves to buffer for writing to disk and inserting into documents.
 */

import * as XLSX from "xlsx";
import type { UnderwritingContext } from "./underwritingContext.js";

function num(n: number | null | undefined): number {
  return n != null && !Number.isNaN(n) ? n : 0;
}

function fmt(n: number): string {
  return num(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function buildExcelProForma(ctx: UnderwritingContext): Buffer {
  const wb = XLSX.utils.book_new();

  // Summary
  const summaryData: (string | number)[][] = [
    ["Deal Pro Forma Summary", ""],
    ["", ""],
    ["Property", ctx.canonicalAddress],
    ["Purchase price", num(ctx.purchasePrice)],
    ["Deal score", num(ctx.dealScore)],
    ["", ""],
    ["Current NOI", fmt(num(ctx.currentNoi))],
    ["Current cap rate (%)", ctx.purchasePrice ? ((num(ctx.currentNoi) / num(ctx.purchasePrice)) * 100).toFixed(2) : "—"],
    ["Adjusted NOI", ctx.furnishedRental ? fmt(ctx.furnishedRental.adjustedNoi) : "—"],
    ["Adjusted cap rate (%)", ctx.furnishedRental?.adjustedCapRatePct != null ? ctx.furnishedRental.adjustedCapRatePct.toFixed(2) : "—"],
    ["", ""],
    ["Loan principal", ctx.mortgage ? fmt(ctx.mortgage.principal) : "—"],
    ["Annual debt service", ctx.mortgage ? fmt(ctx.mortgage.annualDebtService) : "—"],
    ["", ""],
    ["IRR (%)", ctx.irr?.irrPct != null ? (ctx.irr.irrPct * 100).toFixed(2) : "—"],
    ["Equity multiple", ctx.irr?.equityMultiple != null ? ctx.irr.equityMultiple.toFixed(2) : "—"],
    ["CoC (%)", ctx.irr?.coc != null ? (ctx.irr.coc * 100).toFixed(2) : "—"],
    ["", ""],
    ["Expected appreciation (%/yr)", ctx.assumptions.expectedAppreciationPct != null ? ctx.assumptions.expectedAppreciationPct : "—"],
    ["Projected value (appreciation)", ctx.projectedValueFromAppreciation != null ? fmt(ctx.projectedValueFromAppreciation) : "—"],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // Revenue
  const revenueData: (string | number)[][] = [
    ["Revenue", ""],
    ["", ""],
    ["Current gross rent", fmt(num(ctx.currentGrossRent))],
    ["Rent uplift (%)", num(ctx.assumptions.rentUpliftPct)],
    ["Adjusted gross income", ctx.furnishedRental ? fmt(ctx.furnishedRental.adjustedGrossIncome) : "—"],
  ];
  const revenueSheet = XLSX.utils.aoa_to_sheet(revenueData);
  XLSX.utils.book_append_sheet(wb, revenueSheet, "Revenue");

  // Expenses
  const expenseBase = ctx.currentGrossRent != null && ctx.currentNoi != null ? num(ctx.currentGrossRent) - num(ctx.currentNoi) : 0;
  const expensesData: (string | number)[][] = [
    ["Expenses", ""],
    ["", ""],
    ["Current expenses (implied)", fmt(expenseBase)],
    ["Expense increase (%)", num(ctx.assumptions.expenseIncreasePct)],
    ["Management fee (%)", num(ctx.assumptions.managementFeePct)],
    ["Adjusted expenses", ctx.furnishedRental ? fmt(ctx.furnishedRental.adjustedExpenses) : "—"],
  ];
  const expensesSheet = XLSX.utils.aoa_to_sheet(expensesData);
  XLSX.utils.book_append_sheet(wb, expensesSheet, "Expenses");

  // Debt
  const debtData: (string | number)[][] = [
    ["Debt", ""],
    ["", ""],
    ["Purchase price", fmt(num(ctx.purchasePrice))],
    ["LTV (%)", num(ctx.assumptions.ltvPct)],
    ["Loan principal", ctx.mortgage ? fmt(ctx.mortgage.principal) : "—"],
    ["Interest rate (%)", num(ctx.assumptions.interestRatePct)],
    ["Amortization (years)", num(ctx.assumptions.amortizationYears)],
    ["Monthly payment", ctx.mortgage ? fmt(ctx.mortgage.monthlyPayment) : "—"],
    ["Annual debt service", ctx.mortgage ? fmt(ctx.mortgage.annualDebtService) : "—"],
  ];
  const debtSheet = XLSX.utils.aoa_to_sheet(debtData);
  XLSX.utils.book_append_sheet(wb, debtSheet, "Debt");

  // Cash Flow
  const adjNoi = ctx.furnishedRental?.adjustedNoi ?? 0;
  const ads = ctx.mortgage?.annualDebtService ?? 0;
  const cashFlowData: (string | number)[][] = [
    ["Cash Flow", ""],
    ["", ""],
    ["Adjusted NOI", fmt(adjNoi)],
    ["Less: Annual debt service", fmt(-ads)],
    ["Annual cash flow", fmt(adjNoi - ads)],
  ];
  const cashFlowSheet = XLSX.utils.aoa_to_sheet(cashFlowData);
  XLSX.utils.book_append_sheet(wb, cashFlowSheet, "Cash Flow");

  // Returns
  const returnsData: (string | number)[][] = [
    ["Returns", ""],
    ["", ""],
    ["IRR (%)", ctx.irr?.irrPct != null ? (ctx.irr.irrPct * 100).toFixed(2) : "—"],
    ["Equity multiple", ctx.irr?.equityMultiple != null ? ctx.irr.equityMultiple.toFixed(2) : "—"],
    ["Cash-on-cash (%)", ctx.irr?.coc != null ? (ctx.irr.coc * 100).toFixed(2) : "—"],
  ];
  const returnsSheet = XLSX.utils.aoa_to_sheet(returnsData);
  XLSX.utils.book_append_sheet(wb, returnsSheet, "Returns");

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}
