/**
 * Deal dossier: formatted document (Property Overview, Key Metrics, Furnished Rental Scenario,
 * Financial Summary, Risk Signals, Key Takeaways). Numbers aligned with Excel pro forma.
 */

import type { UnderwritingContext } from "./underwritingContext.js";

function num(n: number | null | undefined): number {
  return n != null && !Number.isNaN(n) ? n : 0;
}

function fmt(n: number): string {
  return num(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function pct(n: number | null | undefined): string {
  return n != null && !Number.isNaN(n) ? `${n.toFixed(2)}%` : "—";
}

export function buildDossierText(ctx: UnderwritingContext): string {
  const lines: string[] = [];

  lines.push("DEAL DOSSIER");
  lines.push("============");
  lines.push("");
  lines.push(`Deal score: ${ctx.dealScore != null ? `${ctx.dealScore}/100` : "—"}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push("1. PROPERTY OVERVIEW");
  lines.push("--------------------");
  lines.push(`Address: ${ctx.canonicalAddress}`);
  lines.push(`Purchase price: ${ctx.purchasePrice != null ? `$${fmt(ctx.purchasePrice)}` : "—"}`);
  lines.push(`Area: ${ctx.listingCity ?? "—"}`);
  lines.push(`Units: ${ctx.unitCount ?? "—"}`);
  lines.push("");

  lines.push("2. KEY METRICS");
  lines.push("--------------");
  lines.push(`Current NOI: ${ctx.currentNoi != null ? `$${fmt(ctx.currentNoi)}` : "—"}`);
  lines.push(`Asset cap rate: ${pct(ctx.assetCapRate)}`);
  lines.push(`Adjusted cap rate: ${pct(ctx.adjustedCapRate)}`);
  lines.push("");

  if (ctx.furnishedRental) {
    lines.push("3. FURNISHED RENTAL SCENARIO");
    lines.push("------------------------------");
    lines.push(`Rent uplift: ${ctx.assumptions.rentUpliftPct != null ? `${ctx.assumptions.rentUpliftPct}%` : "—"}`);
    lines.push(`Adjusted gross income: $${fmt(ctx.furnishedRental.adjustedGrossIncome)}`);
    lines.push(`Adjusted expenses: $${fmt(ctx.furnishedRental.adjustedExpenses)}`);
    lines.push(`Adjusted NOI: $${fmt(ctx.furnishedRental.adjustedNoi)}`);
    lines.push(`Adjusted cap rate: ${pct(ctx.furnishedRental.adjustedCapRatePct)}`);
    lines.push("");
  }

  lines.push("4. FINANCIAL SUMMARY");
  lines.push("--------------------");
  if (ctx.mortgage) {
    lines.push(`Loan principal: $${fmt(ctx.mortgage.principal)}`);
    lines.push(`Annual debt service: $${fmt(ctx.mortgage.annualDebtService)}`);
    const cf = (ctx.furnishedRental?.adjustedNoi ?? 0) - ctx.mortgage.annualDebtService;
    lines.push(`Annual cash flow: $${fmt(cf)}`);
  } else {
    lines.push("No mortgage assumptions applied.");
  }
  lines.push("");

  if (ctx.irr) {
    lines.push("5. RETURNS");
    lines.push("----------");
    lines.push(`IRR: ${ctx.irr.irrPct != null ? `${(ctx.irr.irrPct * 100).toFixed(2)}%` : "—"}`);
    lines.push(`Equity multiple: ${ctx.irr.equityMultiple != null ? ctx.irr.equityMultiple.toFixed(2) : "—"}`);
    lines.push(`Cash-on-cash: ${ctx.irr.coc != null ? `${(ctx.irr.coc * 100).toFixed(2)}%` : "—"}`);
    lines.push("");
  }

  lines.push("6. ASSUMPTIONS USED");
  lines.push("--------------------");
  lines.push(`LTV: ${pct(ctx.assumptions.ltvPct)}`);
  lines.push(`Interest rate: ${pct(ctx.assumptions.interestRatePct)}`);
  lines.push(`Amortization: ${ctx.assumptions.amortizationYears ?? "—"} years`);
  lines.push(`Exit cap: ${pct(ctx.assumptions.exitCapPct)}`);
  if (ctx.assumptions.expectedAppreciationPct != null) {
    lines.push(`Expected appreciation: ${ctx.assumptions.expectedAppreciationPct}%/yr`);
  }
  if (ctx.projectedValueFromAppreciation != null) {
    lines.push(`Projected value (appreciation): $${fmt(ctx.projectedValueFromAppreciation)} at year 5`);
  }
  lines.push("");

  lines.push("7. KEY TAKEAWAYS");
  lines.push("-----------------");
  if (ctx.dealScore != null) {
    lines.push(`• Deal score: ${ctx.dealScore}/100`);
  }
  if (ctx.furnishedRental?.adjustedCapRatePct != null) {
    lines.push(`• Adjusted cap: ${ctx.furnishedRental.adjustedCapRatePct.toFixed(2)}%`);
  }
  if (ctx.irr?.irrPct != null) {
    lines.push(`• Projected IRR: ${(ctx.irr.irrPct * 100).toFixed(2)}%`);
  }
  lines.push("");

  return lines.join("\n");
}

/** Format a table row for PDF parsing: pipe-separated cells. */
function tableRow(cells: string[]): string {
  return "| " + cells.join(" | ") + " |";
}

/**
 * Build dossier text with structured sections and pipe-separated tables for PDF rendering.
 * Used only as fallback when the dossier content LLM returns empty. All calculations and
 * data are passed to the LLM so it can generate this same structure; this template
 * ensures a valid PDF when the API is unavailable or fails.
 */
export function buildDossierStructuredText(ctx: UnderwritingContext): string {
  const lines: string[] = [];

  lines.push("DEAL DOSSIER");
  lines.push("============");
  lines.push("");
  lines.push(`Deal score: ${ctx.dealScore != null ? `${ctx.dealScore}/100` : "—"}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push("1. PROPERTY OVERVIEW");
  lines.push("--------------------");
  lines.push(`Address: ${ctx.canonicalAddress}`);
  lines.push(`Area: ${ctx.listingCity ?? "—"}`);
  lines.push(`Units: ${ctx.unitCount != null ? String(ctx.unitCount) : "—"}`);
  if (ctx.propertyOverview) {
    if (ctx.propertyOverview.taxCode) lines.push(`Tax code: ${ctx.propertyOverview.taxCode}`);
    if (ctx.propertyOverview.hpdRegistrationId) lines.push(`HPD registration: ${ctx.propertyOverview.hpdRegistrationId}`);
    if (ctx.propertyOverview.hpdRegistrationDate) lines.push(`HPD last registration: ${ctx.propertyOverview.hpdRegistrationDate}`);
    if (ctx.propertyOverview.bbl) lines.push(`BBL: ${ctx.propertyOverview.bbl}`);
  }
  lines.push("");

  lines.push("2. CURRENT STATE: FINANCIALS");
  lines.push("-----------------------------");
  if (ctx.financialFlags && ctx.financialFlags.length > 0) {
    ctx.financialFlags.slice(0, 2).forEach((f) => lines.push(`• ${f}`));
    lines.push("");
  }
  const grossRentTotal = ctx.currentGrossRent ?? 0;
  const expensesTotal = ctx.currentExpensesTotal ?? (grossRentTotal - (ctx.currentNoi ?? 0));
  const noi = ctx.currentNoi ?? grossRentTotal - expensesTotal;
  const capRate = ctx.assetCapRate;

  const rentRows = ctx.rentRollRows && ctx.rentRollRows.length > 0 ? ctx.rentRollRows : [{ label: "Gross rent", annualRent: grossRentTotal }];
  lines.push(tableRow(["Gross rent", "Annual"]));
  rentRows.forEach((r) => lines.push(tableRow([r.label, `$${fmt(r.annualRent)}`])));
  lines.push(tableRow(["**Total gross rent**", `$${fmt(grossRentTotal)}`]));
  lines.push("");

  const expRows = ctx.expenseRows && ctx.expenseRows.length > 0 ? ctx.expenseRows : [{ lineItem: "Expenses", amount: expensesTotal }];
  lines.push(tableRow(["Expenses", "Annual"]));
  expRows.forEach((e) => lines.push(tableRow([e.lineItem, `$${fmt(e.amount)}`])));
  lines.push(tableRow(["**Total expenses**", `$${fmt(expensesTotal)}`]));
  lines.push("");
  lines.push(tableRow(["—— Gross rent minus expenses ——", ""]));
  lines.push(tableRow(["**NOI**", `$${fmt(noi)}`]));
  lines.push(tableRow(["Cap rate", capRate != null ? pct(capRate) : "—"]));
  lines.push("");

  if (ctx.furnishedRental) {
    lines.push("3. FURNISHED RENTAL SCENARIO");
    lines.push("------------------------------");
    const fr = ctx.furnishedRental;
    const mgmtFee = fr.managementFeeAmount ?? 0;
    const adjExpensesWithoutMgmt = fr.adjustedExpenses - mgmtFee;
    lines.push(tableRow(["Adjusted gross income", `$${fmt(fr.adjustedGrossIncome)}`]));
    lines.push(tableRow(["Adjusted expenses (ex. mgmt)", `$${fmt(adjExpensesWithoutMgmt)}`]));
    const mgmtPct = ctx.assumptions.managementFeePct ?? 8;
    lines.push(tableRow([`Management fee (${mgmtPct}% of gross rents)`, `$${fmt(mgmtFee)}`]));
    lines.push(tableRow(["**NOI (gross income − expenses − mgmt fee)**", `$${fmt(fr.adjustedNoi)}`]));
    lines.push(tableRow(["Adjusted cap rate", fr.adjustedCapRatePct != null ? pct(fr.adjustedCapRatePct) : "—"]));
    if (fr.expectedSalePriceAtExitCap != null && ctx.assumptions.exitCapPct != null) {
      lines.push(tableRow([`Expected sale price at ${ctx.assumptions.exitCapPct}% cap rate`, `$${fmt(fr.expectedSalePriceAtExitCap)}`]));
    }
    lines.push("");
  }

  lines.push("4. FINANCING & CASH FLOW");
  lines.push("-------------------------");
  if (ctx.mortgage) {
    lines.push(`Loan principal: $${fmt(ctx.mortgage.principal)}`);
    lines.push(`Annual debt service: $${fmt(ctx.mortgage.annualDebtService)}`);
    const cf = (ctx.furnishedRental?.adjustedNoi ?? 0) - ctx.mortgage.annualDebtService;
    lines.push(`Annual cash flow: $${fmt(cf)}`);
    if (ctx.amortizationSchedule && ctx.amortizationSchedule.length > 0) {
      lines.push("");
      const schedule = ctx.amortizationSchedule;
      const headers = ["Year", ...schedule.map((r) => `Y${r.year}`)];
      lines.push(tableRow(headers));
      lines.push(tableRow(["Principal", ...schedule.map((r) => `$${fmt(r.principalPayment)}`)]));
      lines.push(tableRow(["Interest", ...schedule.map((r) => `$${fmt(r.interestPayment)}`)]));
      lines.push(tableRow(["**Total debt service**", ...schedule.map((r) => `$${fmt(r.debtService)}`)]));
    }
  } else {
    lines.push("No mortgage assumptions applied.");
  }
  lines.push("");

  lines.push("5. RETURNS");
  lines.push("----------");
  if (ctx.irr) {
    const irr3 = ctx.irr.irr3yrPct != null ? (ctx.irr.irr3yrPct * 100).toFixed(2) + "%" : "—";
    const irr5 = ctx.irr.irr5yrPct != null ? (ctx.irr.irr5yrPct * 100).toFixed(2) + "%" : (ctx.irr.irrPct != null ? (ctx.irr.irrPct * 100).toFixed(2) + "%" : "—");
    lines.push(tableRow(["3-year IRR", irr3]));
    lines.push(tableRow(["5-year IRR", irr5]));
    const em = ctx.irr.equityMultiple != null ? `${ctx.irr.equityMultiple.toFixed(2)}x` : "—";
    lines.push(tableRow(["Equity multiple", em]));
    lines.push(tableRow(["Cash-on-cash (year 1)", ctx.irr.coc != null ? `${(ctx.irr.coc * 100).toFixed(2)}%` : "—"]));
  }
  lines.push("");

  lines.push("6. ASSUMPTIONS USED");
  lines.push("--------------------");
  lines.push(`LTV: ${pct(ctx.assumptions.ltvPct)}`);
  lines.push(`Interest rate: ${pct(ctx.assumptions.interestRatePct)}`);
  lines.push(`Amortization: ${ctx.assumptions.amortizationYears ?? "—"} years`);
  lines.push(`Exit cap: ${pct(ctx.assumptions.exitCapPct)}`);
  lines.push(`Rent uplift: ${ctx.assumptions.rentUpliftPct != null ? `${ctx.assumptions.rentUpliftPct}%` : "—"}`);
  lines.push(`Expense increase: ${ctx.assumptions.expenseIncreasePct != null ? `${ctx.assumptions.expenseIncreasePct}%` : "—"}`);
  lines.push(`Management fee: ${ctx.assumptions.managementFeePct != null ? `${ctx.assumptions.managementFeePct}%` : "—"}`);
  if (ctx.assumptions.expectedAppreciationPct != null) {
    lines.push(`Expected appreciation: ${ctx.assumptions.expectedAppreciationPct}%/yr`);
  }
  if (ctx.projectedValueFromAppreciation != null) {
    lines.push(`Projected value (appreciation): $${fmt(ctx.projectedValueFromAppreciation)} at year 5`);
  }
  lines.push("");

  return lines.join("\n");
}

/** Return dossier as UTF-8 buffer for saving to file. */
export function buildDossierBuffer(ctx: UnderwritingContext): Buffer {
  return Buffer.from(buildDossierText(ctx), "utf-8");
}
