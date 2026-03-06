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

/** Return dossier as UTF-8 buffer for saving to file. */
export function buildDossierBuffer(ctx: UnderwritingContext): Buffer {
  return Buffer.from(buildDossierText(ctx), "utf-8");
}
