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
  const lines: string[] = [
    `Address: ${ctx.canonicalAddress}`,
    `Purchase price: ${ctx.purchasePrice != null ? `$${fmt(ctx.purchasePrice)}` : "—"}`,
    `Area: ${ctx.listingCity ?? "—"}`,
    `Units: ${ctx.unitCount ?? "—"}`,
    `Deal score: ${ctx.dealScore != null ? `${ctx.dealScore}/100` : "—"}`,
    `Current NOI: ${ctx.currentNoi != null ? `$${fmt(ctx.currentNoi)}` : "—"}`,
    `Current gross rent (annual): ${ctx.currentGrossRent != null ? `$${fmt(ctx.currentGrossRent)}` : "—"}`,
    `Asset cap rate: ${ctx.assetCapRate != null ? pct(ctx.assetCapRate) : "—"}`,
    `Adjusted cap rate: ${ctx.adjustedCapRate != null ? pct(ctx.adjustedCapRate) : "—"}`,
  ];
  if (ctx.furnishedRental) {
    lines.push(
      `Furnished scenario — rent uplift: ${a.rentUpliftPct != null ? `${a.rentUpliftPct}%` : "—"}`,
      `  Adjusted gross income: $${fmt(ctx.furnishedRental.adjustedGrossIncome)}`,
      `  Adjusted expenses: $${fmt(ctx.furnishedRental.adjustedExpenses)}`,
      `  Adjusted NOI: $${fmt(ctx.furnishedRental.adjustedNoi)}`,
      `  Adjusted cap rate: ${ctx.furnishedRental.adjustedCapRatePct != null ? pct(ctx.furnishedRental.adjustedCapRatePct) : "—"}`
    );
  }
  if (ctx.mortgage) {
    const cf = (ctx.furnishedRental?.adjustedNoi ?? 0) - ctx.mortgage.annualDebtService;
    lines.push(
      `Mortgage — principal: $${fmt(ctx.mortgage.principal)}, annual debt service: $${fmt(ctx.mortgage.annualDebtService)}, annual cash flow: $${fmt(cf)}`
    );
  }
  if (ctx.irr) {
    lines.push(
      `Returns — IRR: ${ctx.irr.irrPct != null ? `${(ctx.irr.irrPct * 100).toFixed(2)}%` : "—"}, equity multiple: ${ctx.irr.equityMultiple ?? "—"}, cash-on-cash: ${ctx.irr.coc != null ? `${(ctx.irr.coc * 100).toFixed(2)}%` : "—"}`
    );
  }
  lines.push(
    `Assumptions — LTV: ${pct(a.ltvPct)}, rate: ${pct(a.interestRatePct)}, amort: ${a.amortizationYears ?? "—"} yr, exit cap: ${pct(a.exitCapPct)}, rent uplift: ${a.rentUpliftPct != null ? `${a.rentUpliftPct}%` : "—"}, expense increase: ${a.expenseIncreasePct != null ? `${a.expenseIncreasePct}%` : "—"}, mgmt fee: ${a.managementFeePct != null ? `${a.managementFeePct}%` : "—"}, expected appreciation: ${a.expectedAppreciationPct != null ? `${a.expectedAppreciationPct}%/yr` : "—"}`
  );
  if (ctx.projectedValueFromAppreciation != null) {
    lines.push(`Projected value (appreciation) at exit: $${fmt(ctx.projectedValueFromAppreciation)}`);
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
