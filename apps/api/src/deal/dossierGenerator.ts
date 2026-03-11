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

function sensitivityRangeLabel(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null || Number.isNaN(min) || Number.isNaN(max)) return "—";
  return `${(min * 100).toFixed(2)}% to ${(max * 100).toFixed(2)}%`;
}

function offerRangeLabel(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null || high == null || Number.isNaN(low) || Number.isNaN(high)) return "—";
  return `$${fmt(low)} to $${fmt(high)}`;
}

function moneyLabel(value: number | null | undefined): string {
  return value != null && !Number.isNaN(value) ? `$${fmt(value)}` : "—";
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

  lines.push("2. RECOMMENDED OFFER");
  lines.push("--------------------");
  lines.push(`Target IRR: ${pct(ctx.assumptions.targetIrrPct)}`);
  lines.push(`IRR at asking: ${ctx.recommendedOffer?.irrAtAskingPct != null ? `${(ctx.recommendedOffer.irrAtAskingPct * 100).toFixed(2)}%` : "—"}`);
  lines.push(`Recommended offer range: ${offerRangeLabel(ctx.recommendedOffer?.recommendedOfferLow, ctx.recommendedOffer?.recommendedOfferHigh)}`);
  lines.push(`Discount to asking: ${pct(ctx.recommendedOffer?.discountToAskingPct)}`);
  lines.push("");

  lines.push("3. KEY METRICS");
  lines.push("--------------");
  lines.push(`Current NOI: ${ctx.currentNoi != null ? `$${fmt(ctx.currentNoi)}` : "—"}`);
  lines.push(`Asset cap rate: ${pct(ctx.assetCapRate)}`);
  lines.push(`Stabilized NOI: $${fmt(ctx.operating.stabilizedNoi)}`);
  lines.push(`Stabilized cap rate: ${pct(ctx.adjustedCapRate)}`);
  lines.push("");

  lines.push("4. ACQUISITION & FINANCING");
  lines.push("--------------------------");
  lines.push(`Purchase closing costs: $${fmt(ctx.acquisition.purchaseClosingCosts)}`);
  lines.push(`Total project cost: $${fmt(ctx.acquisition.totalProjectCost)}`);
  lines.push(`Loan amount: $${fmt(ctx.financing.loanAmount)}`);
  lines.push(`Initial equity invested: $${fmt(ctx.acquisition.initialEquityInvested)}`);
  lines.push(`Annual debt service: $${fmt(ctx.financing.annualDebtService)}`);
  lines.push("");

  lines.push("5. OPERATIONS & EXIT");
  lines.push("--------------------");
  lines.push(`Adjusted gross rent: $${fmt(ctx.operating.adjustedGrossRent)}`);
  lines.push(`Adjusted operating expenses: $${fmt(ctx.operating.adjustedOperatingExpenses)}`);
  lines.push(`Management fee: $${fmt(ctx.operating.managementFeeAmount)}`);
  lines.push(`Annual operating cash flow: $${fmt(ctx.cashFlows.annualOperatingCashFlow)}`);
  lines.push(`Exit property value: $${fmt(ctx.exit.exitPropertyValue)}`);
  lines.push(`Net proceeds to equity: $${fmt(ctx.exit.netProceedsToEquity)}`);
  lines.push("");

  lines.push("6. RETURNS");
  lines.push("----------");
  lines.push(`IRR: ${ctx.returns.irrPct != null ? `${(ctx.returns.irrPct * 100).toFixed(2)}%` : "—"}`);
  lines.push(`Equity multiple: ${ctx.returns.equityMultiple != null ? ctx.returns.equityMultiple.toFixed(2) : "—"}`);
  lines.push(`Year 1 cash-on-cash: ${ctx.returns.year1CashOnCashReturn != null ? `${(ctx.returns.year1CashOnCashReturn * 100).toFixed(2)}%` : "—"}`);
  lines.push(`Average cash-on-cash: ${ctx.returns.averageCashOnCashReturn != null ? `${(ctx.returns.averageCashOnCashReturn * 100).toFixed(2)}%` : "—"}`);
  lines.push("");

  lines.push("7. ASSUMPTIONS USED");
  lines.push("--------------------");
  lines.push(`Purchase closing costs: ${pct(ctx.assumptions.acquisition.purchaseClosingCostPct)}`);
  lines.push(`Renovation costs: $${fmt(num(ctx.assumptions.acquisition.renovationCosts))}`);
  lines.push(`Furnishing/setup costs: $${fmt(num(ctx.assumptions.acquisition.furnishingSetupCosts))}`);
  lines.push(`LTV: ${pct(ctx.assumptions.financing.ltvPct)}`);
  lines.push(`Interest rate: ${pct(ctx.assumptions.financing.interestRatePct)}`);
  lines.push(`Amortization: ${ctx.assumptions.financing.amortizationYears ?? "—"} years`);
  lines.push(`Rent uplift (base): ${pct(ctx.assumptions.operating.rentUpliftPct)}`);
  lines.push(`Rent uplift (blended): ${pct(ctx.assumptions.operating.blendedRentUpliftPct)}`);
  lines.push(`Expense increase: ${pct(ctx.assumptions.operating.expenseIncreasePct)}`);
  lines.push(`Management fee: ${pct(ctx.assumptions.operating.managementFeePct)}`);
  lines.push(`Hold period: ${ctx.assumptions.holdPeriodYears ?? "—"} years`);
  lines.push(`Exit cap: ${pct(ctx.assumptions.exit.exitCapPct)}`);
  lines.push(`Exit closing costs: ${pct(ctx.assumptions.exit.exitClosingCostPct)}`);
  lines.push(`Target IRR: ${pct(ctx.assumptions.targetIrrPct)}`);
  lines.push("");

  if (ctx.sensitivities && ctx.sensitivities.length > 0) {
    lines.push("8. SENSITIVITY ANALYSIS");
    lines.push("------------------------");
    ctx.sensitivities.forEach((sensitivity) => {
      lines.push(`${sensitivity.title}:`);
      lines.push(`Base case ${sensitivity.inputLabel.toLowerCase()}: ${pct(sensitivity.baseCase.valuePct)}`);
      lines.push(
        `IRR range: ${sensitivityRangeLabel(
          sensitivity.ranges.irrPct.min,
          sensitivity.ranges.irrPct.max
        )}`
      );
      lines.push(
        `Year 1 CoC range: ${sensitivityRangeLabel(
          sensitivity.ranges.year1CashOnCashReturn.min,
          sensitivity.ranges.year1CashOnCashReturn.max
        )}`
      );
    });
    lines.push("");
  }

  lines.push("9. KEY TAKEAWAYS");
  lines.push("-----------------");
  if (ctx.dealScore != null) {
    lines.push(`• Deal score: ${ctx.dealScore}/100`);
  }
  if (ctx.adjustedCapRate != null) {
    lines.push(`• Stabilized cap: ${ctx.adjustedCapRate.toFixed(2)}%`);
  }
  if (ctx.returns.irrPct != null) {
    lines.push(`• Projected IRR: ${(ctx.returns.irrPct * 100).toFixed(2)}%`);
  }
  if (ctx.recommendedOffer?.discountToAskingPct != null && ctx.recommendedOffer.discountToAskingPct > 0) {
    lines.push(`• Needs ${ctx.recommendedOffer.discountToAskingPct.toFixed(1)}% discount to clear target IRR`);
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

  lines.push("2. RECOMMENDED OFFER");
  lines.push("--------------------");
  lines.push(tableRow(["Target IRR", pct(ctx.assumptions.targetIrrPct)]));
  lines.push(tableRow(["IRR at asking", ctx.recommendedOffer?.irrAtAskingPct != null ? `${(ctx.recommendedOffer.irrAtAskingPct * 100).toFixed(2)}%` : "—"]));
  lines.push(tableRow(["Recommended offer range", offerRangeLabel(ctx.recommendedOffer?.recommendedOfferLow, ctx.recommendedOffer?.recommendedOfferHigh)]));
  lines.push(tableRow(["Discount to asking", pct(ctx.recommendedOffer?.discountToAskingPct)]));
  lines.push("");

  lines.push("3. CURRENT STATE: FINANCIALS");
  lines.push("-----------------------------");
  if (ctx.financialFlags && ctx.financialFlags.length > 0) {
    ctx.financialFlags.slice(0, 3).forEach((f) => lines.push(`• ${f}`));
    lines.push("");
  }
  const hasCurrentFinancials = ctx.currentGrossRent != null || ctx.currentNoi != null;
  const grossRentTotal = ctx.currentGrossRent;
  const expensesTotal =
    ctx.currentExpensesTotal ??
    (ctx.currentGrossRent != null && ctx.currentNoi != null ? ctx.currentGrossRent - ctx.currentNoi : null);
  const noi =
    ctx.currentNoi ??
    (ctx.currentGrossRent != null && expensesTotal != null ? ctx.currentGrossRent - expensesTotal : null);
  const capRate = ctx.assetCapRate;

  lines.push(tableRow(["Gross rent", "Annual"]));
  if (ctx.rentRollRows && ctx.rentRollRows.length > 0) {
    ctx.rentRollRows.forEach((r) => lines.push(tableRow([r.label, `$${fmt(r.annualRent)}`])));
    lines.push(tableRow(["**Total gross rent**", moneyLabel(grossRentTotal)]));
  } else if (grossRentTotal != null) {
    lines.push(tableRow(["Gross rent", moneyLabel(grossRentTotal)]));
    lines.push(tableRow(["**Total gross rent**", moneyLabel(grossRentTotal)]));
  } else {
    lines.push(tableRow(["Current gross rent not extracted from OM text", "—"]));
  }
  lines.push("");

  lines.push(tableRow(["Expenses", "Annual"]));
  if (ctx.expenseRows && ctx.expenseRows.length > 0) {
    ctx.expenseRows.forEach((e) => lines.push(tableRow([e.lineItem, `$${fmt(e.amount)}`])));
    lines.push(tableRow(["**Total expenses**", moneyLabel(expensesTotal)]));
  } else if (expensesTotal != null) {
    lines.push(tableRow(["Expenses", moneyLabel(expensesTotal)]));
    lines.push(tableRow(["**Total expenses**", moneyLabel(expensesTotal)]));
  } else {
    lines.push(tableRow(["Current expenses not extracted from OM text", "—"]));
  }
  lines.push("");
  lines.push(tableRow(["—— Gross rent minus expenses ——", ""]));
  lines.push(tableRow(["**NOI**", moneyLabel(noi)]));
  lines.push(tableRow(["Cap rate", capRate != null ? pct(capRate) : "—"]));
  lines.push("");

  lines.push("4. STABILIZED OPERATIONS");
  lines.push("------------------------");
  if (!hasCurrentFinancials) {
    lines.push("• Stabilized operations are not reliable yet because the OM text did not yield enough current rent / NOI data.");
  }
  lines.push(tableRow(["Adjusted gross rent", moneyLabel(hasCurrentFinancials ? ctx.operating.adjustedGrossRent : null)]));
  lines.push(tableRow(["Adjusted operating expenses", moneyLabel(hasCurrentFinancials ? ctx.operating.adjustedOperatingExpenses : null)]));
  lines.push(tableRow([`Management fee (${ctx.assumptions.operating.managementFeePct ?? 0}% of gross rent)`, moneyLabel(hasCurrentFinancials ? ctx.operating.managementFeeAmount : null)]));
  lines.push(tableRow(["**Stabilized NOI**", moneyLabel(hasCurrentFinancials ? ctx.operating.stabilizedNoi : null)]));
  lines.push(tableRow(["Stabilized cap rate", hasCurrentFinancials && ctx.adjustedCapRate != null ? pct(ctx.adjustedCapRate) : "—"]));
  lines.push("");

  lines.push("5. FINANCING & CASH FLOW");
  lines.push("-------------------------");
  lines.push(tableRow(["Purchase closing costs", `$${fmt(ctx.acquisition.purchaseClosingCosts)}`]));
  lines.push(tableRow(["Total project cost", `$${fmt(ctx.acquisition.totalProjectCost)}`]));
  lines.push(tableRow(["Loan amount", `$${fmt(ctx.financing.loanAmount)}`]));
  lines.push(tableRow(["Initial equity invested", `$${fmt(ctx.acquisition.initialEquityInvested)}`]));
  lines.push(tableRow(["Annual debt service", `$${fmt(ctx.financing.annualDebtService)}`]));
  lines.push(tableRow(["Annual operating cash flow", moneyLabel(hasCurrentFinancials ? ctx.cashFlows.annualOperatingCashFlow : null)]));
  lines.push(tableRow(["Final year cash flow", moneyLabel(hasCurrentFinancials ? ctx.cashFlows.finalYearCashFlow : null)]));
  if (ctx.amortizationSchedule && ctx.amortizationSchedule.length > 0) {
    lines.push("");
    const schedule = ctx.amortizationSchedule;
    const headers = ["Year", ...schedule.map((r) => `Y${r.year}`)];
    lines.push(tableRow(headers));
    lines.push(tableRow(["Principal", ...schedule.map((r) => `$${fmt(r.principalPayment)}`)]));
    lines.push(tableRow(["Interest", ...schedule.map((r) => `$${fmt(r.interestPayment)}`)]));
    lines.push(tableRow(["Debt service", ...schedule.map((r) => `$${fmt(r.debtService)}`)]));
    lines.push(tableRow(["Ending balance", ...schedule.map((r) => `$${fmt(r.endingBalance)}`)]));
  }
  lines.push("");

  lines.push("6. EXIT");
  lines.push("-------");
  lines.push(tableRow(["Hold period", `${ctx.assumptions.holdPeriodYears ?? "—"} years`]));
  lines.push(tableRow(["Exit property value", moneyLabel(hasCurrentFinancials ? ctx.exit.exitPropertyValue : null)]));
  lines.push(tableRow(["Sale closing costs", moneyLabel(hasCurrentFinancials ? ctx.exit.saleClosingCosts : null)]));
  lines.push(tableRow(["Net sale proceeds before debt payoff", moneyLabel(hasCurrentFinancials ? ctx.exit.netSaleProceedsBeforeDebtPayoff : null)]));
  lines.push(tableRow(["Remaining loan balance", `$${fmt(ctx.exit.remainingLoanBalance)}`]));
  lines.push(tableRow(["**Net proceeds to equity**", moneyLabel(hasCurrentFinancials ? ctx.exit.netProceedsToEquity : null)]));
  lines.push("");

  lines.push("7. RETURNS");
  lines.push("----------");
  lines.push(tableRow([`IRR (${ctx.assumptions.holdPeriodYears ?? "—"}-year)`, hasCurrentFinancials && ctx.returns.irrPct != null ? `${(ctx.returns.irrPct * 100).toFixed(2)}%` : "—"]));
  lines.push(tableRow(["Equity multiple", hasCurrentFinancials && ctx.returns.equityMultiple != null ? `${ctx.returns.equityMultiple.toFixed(2)}x` : "—"]));
  lines.push(tableRow(["Cash-on-cash (year 1)", hasCurrentFinancials && ctx.returns.year1CashOnCashReturn != null ? `${(ctx.returns.year1CashOnCashReturn * 100).toFixed(2)}%` : "—"]));
  lines.push(tableRow(["Average cash-on-cash", hasCurrentFinancials && ctx.returns.averageCashOnCashReturn != null ? `${(ctx.returns.averageCashOnCashReturn * 100).toFixed(2)}%` : "—"]));
  lines.push("");

  lines.push("8. ASSUMPTIONS USED");
  lines.push("--------------------");
  lines.push(`Purchase closing costs: ${pct(ctx.assumptions.acquisition.purchaseClosingCostPct)}`);
  lines.push(`Renovation costs: $${fmt(num(ctx.assumptions.acquisition.renovationCosts))}`);
  lines.push(`Furnishing/setup costs: $${fmt(num(ctx.assumptions.acquisition.furnishingSetupCosts))}`);
  lines.push(`LTV: ${pct(ctx.assumptions.financing.ltvPct)}`);
  lines.push(`Interest rate: ${pct(ctx.assumptions.financing.interestRatePct)}`);
  lines.push(`Amortization: ${ctx.assumptions.financing.amortizationYears ?? "—"} years`);
  lines.push(`Rent uplift (base): ${pct(ctx.assumptions.operating.rentUpliftPct)}`);
  lines.push(`Rent uplift (blended): ${pct(ctx.assumptions.operating.blendedRentUpliftPct)}`);
  lines.push(`Expense increase: ${pct(ctx.assumptions.operating.expenseIncreasePct)}`);
  lines.push(`Management fee: ${pct(ctx.assumptions.operating.managementFeePct)}`);
  lines.push(`Hold period: ${ctx.assumptions.holdPeriodYears ?? "—"} years`);
  lines.push(`Exit cap: ${pct(ctx.assumptions.exit.exitCapPct)}`);
  lines.push(`Exit closing costs: ${pct(ctx.assumptions.exit.exitClosingCostPct)}`);
  lines.push(`Target IRR: ${pct(ctx.assumptions.targetIrrPct)}`);
  lines.push("");

  if (hasCurrentFinancials && ctx.sensitivities && ctx.sensitivities.length > 0) {
    lines.push("9. SENSITIVITY ANALYSIS");
    lines.push("------------------------");
    ctx.sensitivities.forEach((sensitivity) => {
      lines.push(`• ${sensitivity.title}`);
      lines.push(
        `• Base case ${sensitivity.inputLabel.toLowerCase()}: ${pct(sensitivity.baseCase.valuePct)}; IRR range ${sensitivityRangeLabel(
          sensitivity.ranges.irrPct.min,
          sensitivity.ranges.irrPct.max
        )}; CoC range ${sensitivityRangeLabel(
          sensitivity.ranges.year1CashOnCashReturn.min,
          sensitivity.ranges.year1CashOnCashReturn.max
        )}`
      );
      lines.push(tableRow([sensitivity.inputLabel, "Stabilized NOI", "IRR", "Cash-on-cash"]));
      lines.push(
        tableRow([
          `Base (${pct(sensitivity.baseCase.valuePct)})`,
          `$${fmt(ctx.operating.stabilizedNoi)}`,
          ctx.returns.irrPct != null ? `${(ctx.returns.irrPct * 100).toFixed(2)}%` : "—",
          ctx.returns.year1CashOnCashReturn != null
            ? `${(ctx.returns.year1CashOnCashReturn * 100).toFixed(2)}%`
            : "—",
        ])
      );
      sensitivity.scenarios.forEach((scenario) => {
        lines.push(
          tableRow([
            pct(scenario.valuePct),
            `$${fmt(scenario.stabilizedNoi)}`,
            scenario.irrPct != null ? `${(scenario.irrPct * 100).toFixed(2)}%` : "—",
            scenario.year1CashOnCashReturn != null
              ? `${(scenario.year1CashOnCashReturn * 100).toFixed(2)}%`
              : "—",
          ])
        );
      });
      lines.push("");
    });
  }

  return lines.join("\n");
}

/** Return dossier as UTF-8 buffer for saving to file. */
export function buildDossierBuffer(ctx: UnderwritingContext): Buffer {
  return Buffer.from(buildDossierText(ctx), "utf-8");
}
