import OpenAI from "openai";
import {
  getDossierModel,
  getDossierReasoningEffort,
  supportsReasoningEffort,
} from "../enrichment/openaiModels.js";
import type { UnderwritingContext } from "./underwritingContext.js";

export type DealAnalysisSummaryMetricKey =
  | "address"
  | "area"
  | "units"
  | "deal_score"
  | "investment_profile"
  | "target_acquisition_date"
  | "purchase_price"
  | "total_capitalization"
  | "loan_amount"
  | "cash_required"
  | "current_gross_rent"
  | "current_noi"
  | "stabilized_noi"
  | "hold_period"
  | "exit_cap"
  | "gross_sale_value"
  | "net_sale_value"
  | "levered_irr"
  | "unlevered_irr"
  | "avg_cash_on_cash"
  | "equity_multiple"
  | "target_irr";

export interface DealAnalysisWorkbookBoxBlueprint {
  title: string;
  metricKeys: DealAnalysisSummaryMetricKey[];
}

export interface DealAnalysisWorkbookBlueprint {
  workbookTitle: string;
  assumptionsSubtitle: string;
  summarySubtitle: string;
  cashFlowHeading: string;
  summaryBoxes: DealAnalysisWorkbookBoxBlueprint[];
}

const ALLOWED_METRIC_KEYS = new Set<DealAnalysisSummaryMetricKey>([
  "address",
  "area",
  "units",
  "deal_score",
  "investment_profile",
  "target_acquisition_date",
  "purchase_price",
  "total_capitalization",
  "loan_amount",
  "cash_required",
  "current_gross_rent",
  "current_noi",
  "stabilized_noi",
  "hold_period",
  "exit_cap",
  "gross_sale_value",
  "net_sale_value",
  "levered_irr",
  "unlevered_irr",
  "avg_cash_on_cash",
  "equity_multiple",
  "target_irr",
]);

const FALLBACK_BLUEPRINT: DealAnalysisWorkbookBlueprint = {
  workbookTitle: "Deal Dossier Workbook",
  assumptionsSubtitle:
    "Blue text marks hard-coded inputs from the current deal analysis. Formula-linked cells update downstream model tabs automatically.",
  summarySubtitle:
    "This export is built so hard-coded assumptions stay blue and every downstream summary or cash-flow output remains formula-linked.",
  cashFlowHeading: "Projected YoY Cash Flow",
  summaryBoxes: [
    {
      title: "Property Snapshot",
      metricKeys: ["address", "area", "units", "deal_score"],
    },
    {
      title: "Acquisition",
      metricKeys: ["purchase_price", "total_capitalization", "loan_amount", "cash_required"],
    },
    {
      title: "Operations",
      metricKeys: ["current_gross_rent", "current_noi", "stabilized_noi", "hold_period"],
    },
    {
      title: "Returns",
      metricKeys: ["levered_irr", "unlevered_irr", "avg_cash_on_cash", "equity_multiple"],
    },
  ],
};

const SYSTEM_PROMPT = `You are arranging the visible layout for a real estate deal-analysis Excel export.

You must return STRICT JSON only. No markdown fences. No commentary.

The workbook itself will already be formula-driven. Your job is to choose:
- a concise workbook title,
- short subtitles for the assumptions and summary tabs,
- a short heading for the YoY cash flow table,
- and exactly 4 summary boxes with short titles and 3-4 metric keys each.

Important workbook rules:
- Hard-coded assumption cells will be shown in blue text.
- Every visible downstream output cell will be formula-linked.
- Choose the most decision-useful grouping for an acquisition / underwriting workflow.
- Reuse the allowed metric keys exactly as provided. Do not invent new keys.
- Keep titles professional and concise.

Return JSON with this exact shape:
{
  "workbookTitle": "string",
  "assumptionsSubtitle": "string",
  "summarySubtitle": "string",
  "cashFlowHeading": "string",
  "summaryBoxes": [
    { "title": "string", "metricKeys": ["allowed_key_1", "allowed_key_2", "allowed_key_3"] }
  ]
}`;

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  return key.length >= 10 ? key : null;
}

function fmtCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtPct(value: number | null | undefined, alreadyRatio = false): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const numeric = alreadyRatio ? value * 100 : value;
  return `${numeric.toFixed(2)}%`;
}

function serializeContext(ctx: UnderwritingContext): string {
  const lines = [
    `Address: ${ctx.canonicalAddress}`,
    `Area: ${ctx.listingCity ?? "n/a"}`,
    `Units: ${ctx.unitCount ?? "n/a"}`,
    `Deal score: ${ctx.dealScore ?? "n/a"}`,
    `Investment profile: ${ctx.assumptions.acquisition.investmentProfile ?? "n/a"}`,
    `Target acquisition date: ${ctx.assumptions.acquisition.targetAcquisitionDate ?? "n/a"}`,
    `Purchase price: ${fmtCurrency(ctx.assumptions.acquisition.purchasePrice)}`,
    `Total capitalization: ${fmtCurrency(
      (ctx.acquisition.totalProjectCost ?? 0) + (ctx.financing.financingFees ?? 0)
    )}`,
    `Loan amount: ${fmtCurrency(ctx.financing.loanAmount)}`,
    `Cash required: ${fmtCurrency(ctx.acquisition.initialEquityInvested)}`,
    `Current gross rent: ${fmtCurrency(
      (ctx.currentGrossRent ?? 0) + (ctx.currentOtherIncome ?? 0)
    )}`,
    `Current NOI: ${fmtCurrency(ctx.currentNoi)}`,
    `Stabilized NOI: ${fmtCurrency(ctx.operating.stabilizedNoi)}`,
    `Hold period: ${ctx.assumptions.holdPeriodYears ?? "n/a"} years`,
    `Exit cap: ${fmtPct(ctx.assumptions.exit.exitCapPct)}`,
    `Gross sale value: ${fmtCurrency(ctx.exit.exitPropertyValue)}`,
    `Net sale value: ${fmtCurrency(ctx.exit.netSaleProceedsBeforeDebtPayoff)}`,
    `Levered IRR: ${fmtPct(ctx.returns.irrPct, true)}`,
    `Unlevered IRR: will be calculated from workbook cash flows`,
    `Average cash-on-cash: ${fmtPct(ctx.returns.averageCashOnCashReturn, true)}`,
    `Equity multiple: ${
      ctx.returns.equityMultiple != null ? `${ctx.returns.equityMultiple.toFixed(2)}x` : "n/a"
    }`,
    `Target IRR: ${fmtPct(ctx.assumptions.targetIrrPct)}`,
    "",
    `Allowed metric keys: ${Array.from(ALLOWED_METRIC_KEYS).join(", ")}`,
  ];
  return lines.join("\n");
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function isShortText(value: unknown, min = 3, max = 160): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function sanitizeMetricKeys(value: unknown): DealAnalysisSummaryMetricKey[] | null {
  if (!Array.isArray(value)) return null;
  const keys = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is DealAnalysisSummaryMetricKey => ALLOWED_METRIC_KEYS.has(entry as DealAnalysisSummaryMetricKey));
  const unique = Array.from(new Set(keys));
  return unique.length >= 3 && unique.length <= 4 ? unique : null;
}

function sanitizeBlueprint(parsed: unknown): DealAnalysisWorkbookBlueprint | null {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (
    !isShortText(record.workbookTitle, 5, 80) ||
    !isShortText(record.assumptionsSubtitle, 20, 220) ||
    !isShortText(record.summarySubtitle, 20, 220) ||
    !isShortText(record.cashFlowHeading, 5, 80) ||
    !Array.isArray(record.summaryBoxes) ||
    record.summaryBoxes.length !== 4
  ) {
    return null;
  }

  const boxes: DealAnalysisWorkbookBoxBlueprint[] = [];
  for (const entry of record.summaryBoxes) {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const box = entry as Record<string, unknown>;
    if (!isShortText(box.title, 3, 40)) return null;
    const metricKeys = sanitizeMetricKeys(box.metricKeys);
    if (!metricKeys) return null;
    boxes.push({
      title: box.title.trim(),
      metricKeys,
    });
  }

  return {
    workbookTitle: record.workbookTitle.trim(),
    assumptionsSubtitle: record.assumptionsSubtitle.trim(),
    summarySubtitle: record.summarySubtitle.trim(),
    cashFlowHeading: record.cashFlowHeading.trim(),
    summaryBoxes: boxes,
  };
}

export async function buildDealAnalysisWorkbookBlueprint(
  ctx: UnderwritingContext
): Promise<DealAnalysisWorkbookBlueprint> {
  const apiKey = getApiKey();
  if (!apiKey) return FALLBACK_BLUEPRINT;

  const openai = new OpenAI({ apiKey });
  const model = getDossierModel();
  const reasoningEffort = getDossierReasoningEffort();

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: serializeContext(ctx) },
      ],
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
    });

    const content = completion.choices[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) return FALLBACK_BLUEPRINT;
    const parsed = JSON.parse(stripCodeFence(content));
    return sanitizeBlueprint(parsed) ?? FALLBACK_BLUEPRINT;
  } catch (err) {
    console.warn(
      "[buildDealAnalysisWorkbookBlueprint]",
      err instanceof Error ? err.message : err
    );
    return FALLBACK_BLUEPRINT;
  }
}

