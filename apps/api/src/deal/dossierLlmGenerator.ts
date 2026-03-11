/**
 * Deal dossier via LLM: full document with intelligent analysis.
 * Uses senior-analyst prompt; UnderwritingContext + optional DossierNeighborhoodContext + optional OmAnalysis.
 * All underwriting calculations (current NOI, adjusted NOI, furnished scenario, mortgage, IRR, assumptions) are passed in so the LLM fills the dossier. Falls back to template when key missing or LLM fails.
 */

import OpenAI from "openai";
import { getDossierModel, getDossierReasoningEffort, supportsReasoningEffort } from "../enrichment/openaiModels.js";
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

function confidenceLabel(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 0.75) return "high";
  if (value >= 0.5) return "moderate";
  return "low";
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
  if (ctx.conditionReview) {
    lines.push("Condition / media review:");
    if (ctx.conditionReview.overallCondition) lines.push(`  Overall condition: ${ctx.conditionReview.overallCondition}`);
    if (ctx.conditionReview.renovationScope) lines.push(`  Renovation scope: ${ctx.conditionReview.renovationScope}`);
    lines.push(
      `  Photo review: ${ctx.conditionReview.imageCountAnalyzed} image(s); image quality ${ctx.conditionReview.imageQuality ?? "—"}; confidence ${confidenceLabel(ctx.conditionReview.confidence)}`
    );
    if (ctx.conditionReview.coverageSeen && ctx.conditionReview.coverageSeen.length > 0) {
      lines.push(`  Photos cover: ${ctx.conditionReview.coverageSeen.join(", ")}`);
    }
    if (ctx.conditionReview.coverageMissing && ctx.conditionReview.coverageMissing.length > 0) {
      lines.push(`  Not visible in photos: ${ctx.conditionReview.coverageMissing.join(", ")}`);
    }
    if (ctx.conditionReview.observedSignals && ctx.conditionReview.observedSignals.length > 0) {
      lines.push(`  Condition signals: ${ctx.conditionReview.observedSignals.join("; ")}`);
    }
    if (ctx.conditionReview.summaryBullets && ctx.conditionReview.summaryBullets.length > 0) {
      lines.push(`  Summary bullets: ${ctx.conditionReview.summaryBullets.join("; ")}`);
    }
  }
  if (ctx.financialFlags && ctx.financialFlags.length > 0) {
    lines.push(`Financial flags (use as 1–2 bullets in Current State): ${ctx.financialFlags.join("; ")}`);
  }
  if (ctx.propertyMix) {
    lines.push(
      `Property mix: residential ${ctx.propertyMix.residentialUnits}, eligible residential ${ctx.propertyMix.eligibleResidentialUnits}, rent-stabilized ${ctx.propertyMix.rentStabilizedUnits}, commercial ${ctx.propertyMix.commercialUnits}`
    );
  }
  if (ctx.recommendedOffer) {
    lines.push(
      "Recommended offer:",
      `  Target IRR: ${ctx.recommendedOffer.targetIrrPct != null ? pct(ctx.recommendedOffer.targetIrrPct) : "—"}`,
      `  IRR at asking: ${ctx.recommendedOffer.irrAtAskingPct != null ? `${(ctx.recommendedOffer.irrAtAskingPct * 100).toFixed(2)}%` : "—"}`,
      `  Recommended offer low: ${ctx.recommendedOffer.recommendedOfferLow != null ? `$${fmt(ctx.recommendedOffer.recommendedOfferLow)}` : "—"}`,
      `  Recommended offer high: ${ctx.recommendedOffer.recommendedOfferHigh != null ? `$${fmt(ctx.recommendedOffer.recommendedOfferHigh)}` : "—"}`,
      `  Discount to asking: ${ctx.recommendedOffer.discountToAskingPct != null ? pct(ctx.recommendedOffer.discountToAskingPct) : "—"}`
    );
  }
  if (ctx.rentRollRows && ctx.rentRollRows.length > 0) {
    lines.push("Rent roll (use each row in Gross rent table):");
    ctx.rentRollRows.forEach((r) => lines.push(`  - ${r.label}: $${fmt(r.annualRent)} annual`));
  }
  if (ctx.expenseRows && ctx.expenseRows.length > 0) {
    lines.push("Expenses (use each row in Expenses table):");
    ctx.expenseRows.forEach((e) => lines.push(`  - ${e.lineItem}: $${fmt(e.amount)}`));
  }
  lines.push(
    "Acquisition:",
    `  Purchase price: ${a.acquisition.purchasePrice != null ? `$${fmt(a.acquisition.purchasePrice)}` : "—"}`,
    `  Purchase closing costs: $${fmt(ctx.acquisition.purchaseClosingCosts)} (${a.acquisition.purchaseClosingCostPct != null ? pct(a.acquisition.purchaseClosingCostPct) : "—"})`,
    `  Renovation costs: $${fmt(a.acquisition.renovationCosts)}`,
    `  Furnishing/setup costs: $${fmt(a.acquisition.furnishingSetupCosts)}`,
    `  Total project cost: $${fmt(ctx.acquisition.totalProjectCost)}`,
    `  Initial equity invested: $${fmt(ctx.acquisition.initialEquityInvested)}`
  );
  lines.push(
    "Stabilized operations:",
    `  Adjusted gross rent: $${fmt(ctx.operating.adjustedGrossRent)}`,
    `  Adjusted operating expenses: $${fmt(ctx.operating.adjustedOperatingExpenses)}`,
    `  Management fee amount: $${fmt(ctx.operating.managementFeeAmount)} (${a.operating.managementFeePct != null ? pct(a.operating.managementFeePct) : "—"})`,
    `  Stabilized NOI: $${fmt(ctx.operating.stabilizedNoi)}`,
    `  Stabilized cap rate: ${ctx.adjustedCapRate != null ? pct(ctx.adjustedCapRate) : "—"}`
  );
  lines.push(
    "Financing:",
    `  Loan amount: $${fmt(ctx.financing.loanAmount)}`,
    `  Annual debt service: $${fmt(ctx.financing.annualDebtService)}`,
    `  Remaining balance at exit: $${fmt(ctx.financing.remainingLoanBalanceAtExit)}`,
    `  Annual operating cash flow: $${fmt(ctx.cashFlows.annualOperatingCashFlow)}`
  );
  if (ctx.amortizationSchedule && ctx.amortizationSchedule.length > 0) {
    lines.push("Amortization by year (use for Financing table):");
    ctx.amortizationSchedule.forEach((row) => {
      lines.push(`  Y${row.year}: principal $${fmt(row.principalPayment)}, interest $${fmt(row.interestPayment)}, debt service $${fmt(row.debtService)}`);
    });
  }
  const irr = ctx.returns.irrPct != null ? (ctx.returns.irrPct * 100).toFixed(2) + "%" : "—";
  const em = ctx.returns.equityMultiple != null ? `${ctx.returns.equityMultiple.toFixed(2)}x` : "—";
  const coc = ctx.returns.year1CashOnCashReturn != null ? (ctx.returns.year1CashOnCashReturn * 100).toFixed(2) + "%" : "—";
  const avgCoc = ctx.returns.averageCashOnCashReturn != null ? (ctx.returns.averageCashOnCashReturn * 100).toFixed(2) + "%" : "—";
  lines.push(
    "Exit:",
    `  Hold period: ${a.holdPeriodYears ?? "—"} years`,
    `  Exit cap rate: ${a.exit.exitCapPct != null ? pct(a.exit.exitCapPct) : "—"}`,
    `  Exit closing costs: ${a.exit.exitClosingCostPct != null ? pct(a.exit.exitClosingCostPct) : "—"}`,
    `  Exit property value: $${fmt(ctx.exit.exitPropertyValue)}`,
    `  Net proceeds to equity: $${fmt(ctx.exit.netProceedsToEquity)}`
  );
  lines.push(
    "Returns:",
    `  IRR: ${irr}`,
    `  Equity multiple: ${em}`,
    `  Cash-on-cash (year 1): ${coc}`,
    `  Average cash-on-cash: ${avgCoc}`
  );
  lines.push(
    "Assumptions:",
    `  Purchase closing costs: ${a.acquisition.purchaseClosingCostPct != null ? pct(a.acquisition.purchaseClosingCostPct) : "—"}, Renovation: $${fmt(a.acquisition.renovationCosts)}, Furnishing/setup: $${fmt(a.acquisition.furnishingSetupCosts)}`,
    `  LTV: ${a.financing.ltvPct != null ? pct(a.financing.ltvPct) : "—"}, Interest rate: ${a.financing.interestRatePct != null ? pct(a.financing.interestRatePct) : "—"}, Amortization: ${a.financing.amortizationYears ?? "—"} years`,
    `  Exit cap: ${a.exit.exitCapPct != null ? pct(a.exit.exitCapPct) : "—"}, Exit closing costs: ${a.exit.exitClosingCostPct != null ? pct(a.exit.exitClosingCostPct) : "—"}, Rent uplift base: ${a.operating.rentUpliftPct != null ? `${a.operating.rentUpliftPct}%` : "—"}, Rent uplift blended: ${a.operating.blendedRentUpliftPct != null ? `${a.operating.blendedRentUpliftPct}%` : "—"}, Expense increase: ${a.operating.expenseIncreasePct != null ? `${a.operating.expenseIncreasePct}%` : "—"}, Management fee: ${a.operating.managementFeePct != null ? `${a.operating.managementFeePct}%` : "—"}, Target IRR: ${a.targetIrrPct != null ? pct(a.targetIrrPct) : "—"}`
  );
  if (ctx.sensitivities && ctx.sensitivities.length > 0) {
    lines.push("Sensitivity analysis:");
    ctx.sensitivities.forEach((sensitivity) => {
      const irrRange =
        sensitivity.ranges.irrPct.min != null && sensitivity.ranges.irrPct.max != null
          ? `${(sensitivity.ranges.irrPct.min * 100).toFixed(2)}% to ${(sensitivity.ranges.irrPct.max * 100).toFixed(2)}%`
          : "—";
      const cocRange =
        sensitivity.ranges.year1CashOnCashReturn.min != null &&
        sensitivity.ranges.year1CashOnCashReturn.max != null
          ? `${(sensitivity.ranges.year1CashOnCashReturn.min * 100).toFixed(2)}% to ${(sensitivity.ranges.year1CashOnCashReturn.max * 100).toFixed(2)}%`
          : "—";
      lines.push(
        `  ${sensitivity.title}: base ${sensitivity.inputLabel.toLowerCase()} ${sensitivity.baseCase.valuePct != null ? pct(sensitivity.baseCase.valuePct) : "—"}, IRR range ${irrRange}, CoC range ${cocRange}`
      );
      sensitivity.scenarios.forEach((scenario) => {
        lines.push(
          `    ${pct(scenario.valuePct)} => NOI $${fmt(scenario.stabilizedNoi)}, IRR ${scenario.irrPct != null ? `${(scenario.irrPct * 100).toFixed(2)}%` : "—"}, CoC ${scenario.year1CashOnCashReturn != null ? `${(scenario.year1CashOnCashReturn * 100).toFixed(2)}%` : "—"}`
        );
      });
    });
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
  if (om.propertyInfo && typeof om.propertyInfo === "object") {
    parts.push("OM property info: " + JSON.stringify(om.propertyInfo));
  }
  if (om.income && typeof om.income === "object") {
    parts.push("OM income summary: " + JSON.stringify(om.income));
  }
  if (om.revenueComposition && typeof om.revenueComposition === "object") {
    parts.push("OM revenue composition: " + JSON.stringify(om.revenueComposition));
  }
  if (om.uiFinancialSummary && typeof om.uiFinancialSummary === "object") {
    parts.push("UI Financial Summary: " + JSON.stringify(om.uiFinancialSummary));
  }
  if (Array.isArray(om.reportedDiscrepancies) && om.reportedDiscrepancies.length > 0) {
    parts.push("OM reported discrepancies: " + JSON.stringify(om.reportedDiscrepancies));
  }
  if (om.sourceCoverage && typeof om.sourceCoverage === "object") {
    parts.push("OM source coverage: " + JSON.stringify(om.sourceCoverage));
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

  prompt += `\nProduce the full dossier now. Use the section list from the system instruction. Include every number from the underwriting data. For OM / Investment Highlights and Key Takeaways, avoid generic broker language: every bullet should use hard numbers and, when possible, an explicit delta, percentage, or underwriting implication. Output plain text only.\n`;
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
  const model = getDossierModel();
  const reasoningEffort = getDossierReasoningEffort();

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: DOSSIER_SYSTEM_INSTRUCTION },
        { role: "user", content: prompt },
      ],
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
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
