/**
 * Deal dossier via LLM: full document with intelligent analysis.
 * Uses senior-analyst prompt; UnderwritingContext + optional DossierNeighborhoodContext + optional OmAnalysis.
 * All underwriting calculations (current NOI, adjusted NOI, furnished scenario, mortgage, IRR, assumptions) are passed in so the LLM fills the dossier. Falls back to template when key missing or LLM fails.
 */

import OpenAI from "openai";
import { getDossierModel } from "../enrichment/openaiModels.js";
import type { UnderwritingContext, DossierNeighborhoodContext } from "./underwritingContext.js";
import type { OmAnalysis } from "@re-sourcing/contracts";
import { DOSSIER_SYSTEM_INSTRUCTION, DOSSIER_USER_PROMPT_PREFIX } from "./dossierPrompt.js";

function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function serializeUnderwritingContext(ctx: UnderwritingContext): string {
  const a = ctx.assumptions;
  const generatedDate = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `Generated date (use in header): ${generatedDate}`,
    `Address: ${ctx.canonicalAddress}`,
    `Area: ${ctx.listingCity ?? "—"}`,
    `Units: ${ctx.unitCount ?? "—"}`,
    `Deal score: ${ctx.dealScore != null ? `${ctx.dealScore}/100` : "—"}`,
    `Current NOI: ${ctx.currentNoi != null ? `$${fmt(ctx.currentNoi)}` : "—"}`,
    `Current gross rent (annual): ${ctx.currentGrossRent != null ? `$${fmt(ctx.currentGrossRent)}` : "—"}`,
    `Current expenses total: ${ctx.currentExpensesTotal != null ? `$${fmt(ctx.currentExpensesTotal)}` : "—"}`,
    `Asset cap rate: ${ctx.assetCapRate != null ? pct(ctx.assetCapRate) : "—"}`,
  ];
  if (ctx.propertyOverview) {
    if (ctx.propertyOverview.taxCode) lines.push(`Tax code: ${ctx.propertyOverview.taxCode}`);
    if (ctx.propertyOverview.hpdRegistrationId) lines.push(`HPD registration ID: ${ctx.propertyOverview.hpdRegistrationId}`);
    if (ctx.propertyOverview.hpdRegistrationDate) lines.push(`HPD last registration date: ${ctx.propertyOverview.hpdRegistrationDate}`);
    if (ctx.propertyOverview.bbl) lines.push(`BBL: ${ctx.propertyOverview.bbl}`);
  }
  if (ctx.financialFlags && ctx.financialFlags.length > 0) {
    lines.push(`Financial flags (use as 1–2 bullets in Current State): ${ctx.financialFlags.join("; ")}`);
  }
  if (ctx.rentRollRows && ctx.rentRollRows.length > 0) {
    lines.push("Rent roll (use each row in Gross rent table):");
    ctx.rentRollRows.forEach((r) => lines.push(`  - ${r.label}: $${fmt(r.annualRent)} annual`));
  }
  if (ctx.expenseRows && ctx.expenseRows.length > 0) {
    lines.push("Expenses (use each row in Expenses table):");
    ctx.expenseRows.forEach((e) => lines.push(`  - ${e.lineItem}: $${fmt(e.amount)}`));
  }
  if (ctx.furnishedRental) {
    const fr = ctx.furnishedRental;
    const mgmtFee = fr.managementFeeAmount ?? 0;
    const adjExpExMgmt = fr.adjustedExpenses - mgmtFee;
    lines.push(
      "Furnished rental scenario:",
      `  Adjusted gross income: $${fmt(fr.adjustedGrossIncome)}`,
      `  Adjusted expenses (ex. mgmt): $${fmt(adjExpExMgmt)}`,
      `  Management fee amount: $${fmt(mgmtFee)} (${a.managementFeePct ?? 8}% of gross)`,
      `  Adjusted NOI: $${fmt(fr.adjustedNoi)}`,
      `  Adjusted cap rate: ${fr.adjustedCapRatePct != null ? pct(fr.adjustedCapRatePct) : "—"}`,
      `  Expected sale price at exit cap: ${fr.expectedSalePriceAtExitCap != null ? `$${fmt(fr.expectedSalePriceAtExitCap)}` : "—"} (exit cap ${pct(a.exitCapPct)})`
    );
  }
  if (ctx.mortgage) {
    const cf = (ctx.furnishedRental?.adjustedNoi ?? 0) - ctx.mortgage.annualDebtService;
    lines.push(
      "Financing:",
      `  Loan principal: $${fmt(ctx.mortgage.principal)}`,
      `  Annual debt service: $${fmt(ctx.mortgage.annualDebtService)}`,
      `  Annual cash flow: $${fmt(cf)}`
    );
  }
  if (ctx.amortizationSchedule && ctx.amortizationSchedule.length > 0) {
    lines.push("Amortization by year (use for Financing table):");
    ctx.amortizationSchedule.forEach((row) => {
      lines.push(`  Y${row.year}: principal $${fmt(row.principalPayment)}, interest $${fmt(row.interestPayment)}, debt service $${fmt(row.debtService)}`);
    });
  }
  if (ctx.irr) {
    const irr3 = ctx.irr.irr3yrPct != null ? (ctx.irr.irr3yrPct * 100).toFixed(2) + "%" : "—";
    const irr5 = ctx.irr.irr5yrPct != null ? (ctx.irr.irr5yrPct * 100).toFixed(2) + "%" : (ctx.irr.irrPct != null ? (ctx.irr.irrPct * 100).toFixed(2) + "%" : "—");
    const em = ctx.irr.equityMultiple != null ? `${ctx.irr.equityMultiple.toFixed(2)}x` : "—";
    const coc = ctx.irr.coc != null ? (ctx.irr.coc * 100).toFixed(2) + "%" : "—";
    lines.push(
      "Returns:",
      `  3-year IRR: ${irr3}`,
      `  5-year IRR: ${irr5}`,
      `  Equity multiple: ${em}`,
      `  Cash-on-cash (year 1): ${coc}`
    );
  }
  lines.push(
    "Assumptions:",
    `  LTV: ${pct(a.ltvPct)}, Interest rate: ${pct(a.interestRatePct)}, Amortization: ${a.amortizationYears ?? "—"} years`,
    `  Exit cap: ${pct(a.exitCapPct)}, Rent uplift: ${a.rentUpliftPct != null ? `${a.rentUpliftPct}%` : "—"}, Expense increase: ${a.expenseIncreasePct != null ? `${a.expenseIncreasePct}%` : "—"}, Management fee: ${a.managementFeePct != null ? `${a.managementFeePct}%` : "—"}`
  );
  if (a.expectedAppreciationPct != null) {
    lines.push(`  Expected appreciation: ${a.expectedAppreciationPct}%/yr`);
  }
  if (ctx.projectedValueFromAppreciation != null) {
    lines.push(`  Projected value (appreciation) at year 5: $${fmt(ctx.projectedValueFromAppreciation)}`);
  }
  return lines.join("\n");
}

function serializeNeighborhoodContext(n: DossierNeighborhoodContext): string {
  const lines: string[] = [
    `Neighborhood: ${n.neighborhoodName ?? n.neighborhoodKey ?? "—"}`,
    `Median price/sf: ${n.medianPricePsf != null ? fmt(n.medianPricePsf) : "—"}`,
    `Median rent/sf: ${n.medianRentPsf != null ? fmt(n.medianRentPsf) : "—"}`,
    `Median asset cap rate: ${n.medianAssetCapRate != null ? pct(n.medianAssetCapRate) : "—"}`,
    `Subject price/sf: ${n.subjectPricePsf != null ? fmt(n.subjectPricePsf) : "—"}`,
    `Subject rent/sf: ${n.subjectRentPsf != null ? fmt(n.subjectRentPsf) : "—"}`,
    `Price discount/premium %: ${n.priceDiscountPct != null ? `${n.priceDiscountPct}%` : "—"}`,
    `Yield spread (asset): ${n.yieldSpreadAsset != null ? `${n.yieldSpreadAsset}%` : "—"}`,
    `Yield spread (adjusted): ${n.yieldSpreadAdjusted != null ? `${n.yieldSpreadAdjusted}%` : "—"}`,
    `Supply risk: ${n.supplyRiskFlag === true ? "Elevated" : n.supplyRiskFlag === false ? "Normal" : "—"}`,
    `Momentum: ${n.momentumFlag ?? "—"}`,
  ];
  return lines.join("\n");
}

function serializeOmAnalysis(om: OmAnalysis): string {
  const parts: string[] = [];
  if (om.uiFinancialSummary && typeof om.uiFinancialSummary === "object") {
    parts.push("UI Financial Summary: " + JSON.stringify(om.uiFinancialSummary));
  }
  if (Array.isArray(om.investmentTakeaways) && om.investmentTakeaways.length > 0) {
    parts.push("Investment takeaways:\n" + om.investmentTakeaways.map((t) => `• ${t}`).join("\n"));
  }
  if (om.recommendedOfferAnalysis && typeof om.recommendedOfferAnalysis === "object") {
    parts.push("Recommended offer: " + JSON.stringify(om.recommendedOfferAnalysis));
  }
  if (om.nycRegulatorySummary && typeof om.nycRegulatorySummary === "object") {
    parts.push("NYC regulatory: " + JSON.stringify(om.nycRegulatorySummary));
  }
  if (om.dossierMemo && typeof om.dossierMemo === "object") {
    const memoLines = Object.entries(om.dossierMemo)
      .filter(([, v]: [string, unknown]) => typeof v === "string" && (v as string).trim())
      .map(([k, v]: [string, string]) => `## ${k}\n${v.trim()}`);
    parts.push("OM investment memo (use as base content, align with underwriting data below):\n" + memoLines.join("\n\n"));
  }
  return parts.join("\n\n");
}

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

/**
 * Build the user prompt with underwriting data (all calculations), optional neighborhood, and optional OM analysis.
 */
function buildPrompt(
  ctx: UnderwritingContext,
  neighborhood: DossierNeighborhoodContext | null,
  omAnalysis: OmAnalysis | null | undefined
): string {
  const dataBlock = serializeUnderwritingContext(ctx);
  let prompt = DOSSIER_USER_PROMPT_PREFIX + dataBlock;

  if (omAnalysis && (omAnalysis.dossierMemo || omAnalysis.investmentTakeaways?.length || omAnalysis.uiFinancialSummary)) {
    const omBlock = serializeOmAnalysis(omAnalysis);
    prompt += `\n--- OM / PROPERTY PAGE ANALYSIS (integrate into OM / Investment Highlights section) ---\n${omBlock}\n`;
  }

  if (neighborhood && (neighborhood.neighborhoodKey ?? neighborhood.neighborhoodName)) {
    const neighborhoodBlock = serializeNeighborhoodContext(neighborhood);
    prompt += `\n--- NEIGHBORHOOD SNAPSHOT ---\n${neighborhoodBlock}\n`;
  }

  prompt += `\nProduce the full dossier now. Use the section list from the system instruction. Include every number from the underwriting data. Output plain text only.\n`;
  return prompt;
}

/**
 * Generate dossier body via LLM. Returns null if OPENAI_API_KEY is missing, or on API error/empty response (caller should fall back to template).
 */
export async function buildDossierWithLlm(
  ctx: UnderwritingContext,
  neighborhoodContext: DossierNeighborhoodContext | null,
  omAnalysis?: OmAnalysis | null
): Promise<string | null> {
  const key = getApiKey();
  if (!key) return null;

  const openai = new OpenAI({ apiKey: key });
  const prompt = buildPrompt(ctx, neighborhoodContext, omAnalysis ?? null);

  try {
    const completion = await openai.chat.completions.create({
      model: getDossierModel(),
      messages: [
        { role: "system", content: DOSSIER_SYSTEM_INSTRUCTION },
        { role: "user", content: prompt },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    console.warn("[buildDossierWithLlm]", err instanceof Error ? err.message : err);
    return null;
  }
}
