/**
 * Deal score via LLM: qualitative + quantitative. Uses underwriting metrics and risk data
 * to output a 0–100 deal score and short rationale.
 */

import OpenAI from "openai";
import { getDealScoringModel } from "../enrichment/openaiModels.js";

export interface DealScoringLlmInputs {
  /** Asset cap rate (current NOI / purchase price), e.g. 5.2. */
  assetCapRatePct: number | null;
  /** Stabilized cap rate at the current ask. */
  adjustedCapRatePct?: number | null;
  /** Hold-period IRR as decimal (e.g. 0.22 = 22%). */
  irrPct: number | null;
  /** Hold-period equity multiple. */
  equityMultiple?: number | null;
  /** Cash-on-cash as decimal (e.g. 0.10 = 10%). */
  cocPct: number | null;
  /** Hold period used for the IRR calculation. */
  holdPeriodYears?: number | null;
  /** Target IRR percentage used for the recommended offer solve. */
  targetIrrPct?: number | null;
  /** Suggested anchor offer below the max. */
  recommendedOfferLow?: number | null;
  /** Maximum offer that still clears target IRR. */
  recommendedOfferHigh?: number | null;
  /** Discount required from ask to clear target IRR. */
  requiredDiscountPct?: number | null;
  /** Number of rent-stabilized units (deduct points per unit). */
  rentStabilizedUnitCount: number;
  /** Number of commercial units. */
  commercialUnitCount?: number;
  /** Effective blended rent uplift after protected-unit exclusions. */
  blendedRentUpliftPct?: number | null;
  /** HPD violations summary. */
  hpdTotal?: number;
  hpdOpenCount?: number;
  hpdRentImpairingOpen?: number;
  /** DOB complaints summary. */
  dobOpenCount?: number;
  dobCount30?: number;
  dobCount365?: number;
  dobTopCategories?: Array<{ name: string; count: number }>;
  /** Housing litigations summary. */
  litigationTotal?: number;
  litigationOpenCount?: number;
  litigationTotalPenalty?: number;
  /** Optional: address for context. */
  address?: string | null;
  /** Optional: brief dossier or OM risk bullets for qualitative context. */
  riskBullets?: string[];
}

export interface DealScoringLlmResult {
  dealScore: number;
  rationale: string;
}

const DEAL_SCORING_SYSTEM = `You are a senior real estate investment analyst scoring a NYC multifamily/commercial deal on a 0–100 scale. Your score combines quantitative metrics with qualitative risk judgment.

SCORING RUBRIC (use as the backbone; you may adjust for context):

1) PRICE QUALITY AT ASK (largest driver)
- The ask cap rate is the clearest pricing signal. Higher cap rate at ask means better pricing.
- A low ask cap rate with a large required discount to hit the target IRR should score poorly.

2) NEGOTIATION ROOM / RECOMMENDED OFFER
- If the current ask already clears the target IRR, that is strongly positive.
- If only a small discount is needed, still workable.
- If the required discount is large enough that an offer is likely unrealistic, score should fall sharply.

3) RETURNS AT ASK
- IRR, cash-on-cash, and stabilized cap rate still matter, but less than pricing.
- 25%+ IRR is top tier; sub-20% IRR is a drag.
- If IRR is below 10%, the score should usually stay below 50.
- If IRR is negative, the score should rarely exceed 35, even with a decent current cap rate.
- If equity multiple is below 1.0x or the required discount is greater than 25%, score should stay low.

4) RISK — DEDUCT POINTS (do not add; only subtract)
- Rent-stabilized units: deduct points for EACH rent-stabilized unit (they limit rent growth and exit).
- Commercial units are not automatically bad, but they do reduce residential conversion upside when the thesis depends on uplift.
- Complaints / violations / litigation:
  - None or all closed: no deduction (clean is good).
  - Open or recent: remove points based on severity (open HPD rent-impairing = severe; open DOB complaints; open housing litigations; penalties).
  - Scale severity: many open or rent-impairing = larger deduction; few or closed = smaller.

Output a single JSON object with exactly two keys:
- "dealScore": number (0–100, integer).
- "rationale": string (2–4 sentences: what drove the score up and what drove it down).

Output only the JSON object, no markdown or extra text.`;

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function buildScoringPrompt(inputs: DealScoringLlmInputs): string {
  const lines: string[] = [
    "Score this deal using the rubric. Output only JSON: { \"dealScore\": number, \"rationale\": \"...\" }",
    "",
    "QUANTITATIVE",
    `Asset cap rate: ${inputs.assetCapRatePct != null ? `${inputs.assetCapRatePct.toFixed(2)}%` : "—"}`,
    `Stabilized cap rate: ${inputs.adjustedCapRatePct != null ? `${inputs.adjustedCapRatePct.toFixed(2)}%` : "—"}`,
    `${inputs.holdPeriodYears ?? 5}-year IRR: ${inputs.irrPct != null ? `${(inputs.irrPct * 100).toFixed(2)}%` : "—"}`,
    `Equity multiple: ${inputs.equityMultiple != null ? `${inputs.equityMultiple.toFixed(2)}x` : "—"}`,
    `Cash-on-cash: ${inputs.cocPct != null ? `${(inputs.cocPct * 100).toFixed(2)}%` : "—"}`,
    `Rent-stabilized units: ${inputs.rentStabilizedUnitCount}`,
    `Commercial units: ${inputs.commercialUnitCount ?? 0}`,
    `Blended rent uplift: ${inputs.blendedRentUpliftPct != null ? `${inputs.blendedRentUpliftPct.toFixed(2)}%` : "—"}`,
    `Target IRR: ${inputs.targetIrrPct != null ? `${inputs.targetIrrPct.toFixed(2)}%` : "—"}`,
    `Recommended offer low: ${fmtMoney(inputs.recommendedOfferLow)}`,
    `Recommended offer high: ${fmtMoney(inputs.recommendedOfferHigh)}`,
    `Required discount to clear target IRR: ${inputs.requiredDiscountPct != null ? `${inputs.requiredDiscountPct.toFixed(2)}%` : "—"}`,
    "",
    "RISK DATA",
    `HPD violations — total: ${inputs.hpdTotal ?? 0}, open: ${inputs.hpdOpenCount ?? 0}, rent-impairing open: ${inputs.hpdRentImpairingOpen ?? 0}`,
    `DOB complaints — open: ${inputs.dobOpenCount ?? 0}, last 30 days: ${inputs.dobCount30 ?? 0}, last 365 days: ${inputs.dobCount365 ?? 0}${inputs.dobTopCategories?.length ? `; top categories: ${inputs.dobTopCategories.map((c) => `${c.name} (${c.count})`).join(", ")}` : ""}`,
    `Housing litigations — total: ${inputs.litigationTotal ?? 0}, open: ${inputs.litigationOpenCount ?? 0}, total penalty: ${inputs.litigationTotalPenalty ?? 0}`,
  ];
  if (inputs.address) lines.push("", `Address: ${inputs.address}`);
  if (inputs.riskBullets && inputs.riskBullets.length > 0) {
    lines.push("", "QUALITATIVE / CONTEXT (from dossier or OM)");
    inputs.riskBullets.forEach((bullet) => lines.push(`- ${bullet}`));
  }
  lines.push("", "Output only the JSON object.");
  return lines.join("\n");
}

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

function parseScoreResponse(content: string): DealScoringLlmResult | null {
  const trimmed = content.trim().replace(/^```json?\s*|\s*```$/g, "");
  try {
    const obj = JSON.parse(trimmed) as { dealScore?: unknown; rationale?: unknown };
    const score = typeof obj.dealScore === "number" ? obj.dealScore : Number(obj.dealScore);
    if (Number.isNaN(score)) return null;
    const rationale = typeof obj.rationale === "string" ? obj.rationale : String(obj.rationale ?? "");
    const dealScore = Math.max(0, Math.min(100, Math.round(score)));
    return { dealScore, rationale };
  } catch {
    return null;
  }
}

export async function scoreDealWithLlm(inputs: DealScoringLlmInputs): Promise<DealScoringLlmResult | null> {
  const key = getApiKey();
  if (!key) return null;

  const openai = new OpenAI({ apiKey: key });
  const prompt = buildScoringPrompt(inputs);

  try {
    const completion = await openai.chat.completions.create({
      model: getDealScoringModel(),
      messages: [
        { role: "system", content: DEAL_SCORING_SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    return parseScoreResponse(content);
  } catch (err) {
    console.warn("[scoreDealWithLlm]", err instanceof Error ? err.message : err);
    return null;
  }
}
