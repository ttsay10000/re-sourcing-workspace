/**
 * Deal score via LLM: qualitative + quantitative. Uses underwriting metrics and risk data (violations,
 * complaints, litigation, rent-stabilized units) to output a 0–100 deal score and short rationale.
 * Rubric: asset cap 50 pts (5%+ max, 4–5% = 30–50, &lt;4% low); IRR tiers (25%+ = top); risk = deduct
 * per rent-stab unit and for complaints/violations/litigation by severity.
 */

import OpenAI from "openai";
import { getDealScoringModel } from "../enrichment/openaiModels.js";

export interface DealScoringLlmInputs {
  /** Asset cap rate (current NOI / purchase price), e.g. 5.2. */
  assetCapRatePct: number | null;
  /** Hold-period IRR as decimal (e.g. 0.22 = 22%). */
  irr5yrPct: number | null;
  /** Cash-on-cash as decimal (e.g. 0.10 = 10%). */
  cocPct: number | null;
  /** Hold period used for the IRR calculation. */
  holdPeriodYears?: number | null;
  /** Number of rent-stabilized units (deduct points per unit). */
  rentStabilizedUnitCount: number;
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

1) ASSET CAP RATE (max 50 points)
- 5% or higher: maxed out (50 points).
- 4% to 5%: 30–50 points (scale up as cap approaches 5%).
- Under 4%: low (0–30 points; 3–4% in the teens to mid-20s, below 3% minimal).

2) IRR — HOLD PERIOD (adds to score; target 25%+ = top deal)
- 25% or higher: top tier — strong positive (add up to ~30 points).
- 20–25%: good — add meaningful points (~15–20).
- 15–20%: moderate (~5–10 points).
- Below 15%: weak or no IRR contribution.

3) RISK — DEDUCT POINTS (do not add; only subtract)
- Rent-stabilized units: deduct points for EACH rent-stabilized unit (they limit rent growth and exit). E.g. 5–10 points per unit depending on share of building.
- Complaints / violations / litigation:
  - None or all closed: no deduction (clean is good).
  - Open or recent: remove points based on severity (open HPD rent-impairing = severe; open DOB complaints; open housing litigations; penalties).
  - Scale severity: many open or rent-impairing = larger deduction; few or closed = smaller.

Output a single JSON object with exactly two keys:
- "dealScore": number (0–100, integer).
- "rationale": string (2–4 sentences: what drove the score up and what drove it down).

Output only the JSON object, no markdown or extra text.`;

function buildScoringPrompt(inputs: DealScoringLlmInputs): string {
  const lines: string[] = [
    "Score this deal using the rubric. Output only JSON: { \"dealScore\": number, \"rationale\": \"...\" }",
    "",
    "QUANTITATIVE",
    `Asset cap rate: ${inputs.assetCapRatePct != null ? `${inputs.assetCapRatePct.toFixed(2)}%` : "—"}`,
    `${inputs.holdPeriodYears ?? 5}-year IRR: ${inputs.irr5yrPct != null ? `${(inputs.irr5yrPct * 100).toFixed(2)}%` : "—"}`,
    `Cash-on-cash: ${inputs.cocPct != null ? `${(inputs.cocPct * 100).toFixed(2)}%` : "—"}`,
    `Rent-stabilized units: ${inputs.rentStabilizedUnitCount}`,
    "",
    "RISK DATA",
    `HPD violations — total: ${inputs.hpdTotal ?? 0}, open: ${inputs.hpdOpenCount ?? 0}, rent-impairing open: ${inputs.hpdRentImpairingOpen ?? 0}`,
    `DOB complaints — open: ${inputs.dobOpenCount ?? 0}, last 30 days: ${inputs.dobCount30 ?? 0}, last 365 days: ${inputs.dobCount365 ?? 0}${inputs.dobTopCategories?.length ? `; top categories: ${inputs.dobTopCategories.map((c) => `${c.name} (${c.count})`).join(", ")}` : ""}`,
    `Housing litigations — total: ${inputs.litigationTotal ?? 0}, open: ${inputs.litigationOpenCount ?? 0}, total penalty: ${inputs.litigationTotalPenalty ?? 0}`,
  ];
  if (inputs.address) lines.push("", `Address: ${inputs.address}`);
  if (inputs.riskBullets && inputs.riskBullets.length > 0) {
    lines.push("", "QUALITATIVE / CONTEXT (from dossier or OM)");
    inputs.riskBullets.forEach((b) => lines.push(`- ${b}`));
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

/**
 * Call LLM to produce deal score (0–100) and rationale. Returns null if API key missing or parse fails.
 */
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
