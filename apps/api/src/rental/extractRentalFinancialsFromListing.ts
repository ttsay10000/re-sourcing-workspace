/**
 * Extract rental-related financials from listing description, OM, or email/attachments via LLM.
 * Used by: (1) processInbox when broker/thread emails have OM attachments, (2) POST upload when user uploads OM/Brochure.
 * When OM-style: uses senior-analyst prompt and returns full OmAnalysis + derived fromLlm. Otherwise returns fromLlm only.
 */

import type {
  RentalFinancialsFromLlm,
  ExpenseLineItem,
  RentalNumberPerUnit,
  OmAnalysis,
  OmRentRollRow,
} from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getEnrichmentModel } from "../enrichment/openaiModels.js";
import { OM_ANALYSIS_PROMPT_PREFIX } from "./omAnalysisPrompt.js";

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

export interface ExtractRentalFinancialsResult {
  fromLlm: RentalFinancialsFromLlm | null;
  omAnalysis?: OmAnalysis | null;
}

/**
 * Call LLM to extract NOI, cap rate, rental estimates, etc. from listing text (short).
 * Returns legacy fromLlm only; for full OM analysis use extractRentalFinancialsFromText with forceOmStyle or long text.
 */
export async function extractRentalFinancialsFromListing(
  description: string | null | undefined,
  buildingName: string | null | undefined
): Promise<RentalFinancialsFromLlm | null> {
  const key = getApiKey();
  if (!key) return null;
  const desc = (description ?? "").trim();
  const building = (buildingName ?? "").trim();
  const text = [building ? `Building name: ${building}` : "", desc].filter(Boolean).join("\n\n");
  const result = await extractRentalFinancialsFromText(text);
  return result.fromLlm;
}

const OM_STYLE_MIN_LENGTH = 2500;

/** Cap rate and furnished cap rate: store as percentage number (5.47 for 5.47%). */
const UI_PERCENT_KEYS = ["capRate", "adjustedCapRate", "furnishedCapRate", "rentUpsidePercent"];
/** Ratio/occupancy: store as decimal 0–1 (0.24 for 24%). */
const UI_RATIO_KEYS = ["expenseRatio", "breakEvenOccupancy"];
/** Dollar amounts: keep as number, no % scaling. */
const UI_DOLLAR_KEYS = ["price", "pricePerUnit", "pricePerSqft", "grossRent", "noi", "furnishedNOI"];

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,%\s]/g, "");
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Normalize LLM uiFinancialSummary so cap rates are percentage numbers (5.47), ratios are decimals (0.24),
 * and string/dollar values are coerced to numbers for consistent UI display.
 */
function normalizeUiFinancialSummary(
  raw: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const num = toNum(value);
    if (num === null) {
      out[key] = value;
      continue;
    }
    if (UI_PERCENT_KEYS.includes(key)) {
      // LLM may return 0.0547 (decimal) or 5.47 (percentage). Store as percentage.
      out[key] = num > 0 && num <= 1 ? num * 100 : num;
    } else if (UI_RATIO_KEYS.includes(key)) {
      // Store as decimal 0–1 (0.24 = 24%). LLM may return 0.0024 (wrong); scale to 0.24.
      if (num > 0 && num <= 0.02) out[key] = num * 100; // e.g. 0.0024 -> 0.24
      else if (num > 1 && num <= 100) out[key] = num / 100; // e.g. 24 -> 0.24
      else out[key] = num;
    } else if (UI_DOLLAR_KEYS.includes(key) || key.includes("price") || key.includes("Rent") || key.includes("noi") || key.includes("NOI")) {
      out[key] = num;
    } else {
      out[key] = typeof value === "number" ? value : num;
    }
  }
  return out;
}

export interface ExtractRentalFinancialsOptions {
  /** When true, use the full senior-analyst OM prompt regardless of text length. Use for uploaded OM/Brochure. */
  forceOmStyle?: boolean;
  /** Optional enrichment context (HPD, violations, permits, etc.) to append for the LLM. */
  enrichmentContext?: string;
}

/**
 * Derive legacy fromLlm from OmAnalysis for backward compatibility and property page fallback.
 */
function fromLlmFromOmAnalysis(om: OmAnalysis): RentalFinancialsFromLlm {
  const income = om.income as Record<string, unknown> | undefined;
  const expenses = om.expenses as { totalExpenses?: number; expensesTable?: ExpenseLineItem[] } | undefined;
  const valuation = om.valuationMetrics as Record<string, unknown> | undefined;
  const financial = om.financialMetrics as Record<string, unknown> | undefined;
  const ui = om.uiFinancialSummary as Record<string, unknown> | undefined;
  const noi =
    om.noiReported ??
    (income?.NOI as number | undefined) ??
    (valuation?.NOI as number | undefined) ??
    (financial?.noi as number | undefined) ??
    (ui?.noi as number | undefined);
  let capRate =
    (valuation?.capRate as number | undefined) ?? (ui?.capRate as number | undefined);
  // LLM may return cap rate as decimal (0.0356); we store and display as percentage (3.56)
  if (capRate != null && typeof capRate === "number" && capRate > 0 && capRate <= 1) capRate = capRate * 100;
  const grossRentTotal =
    (income?.grossRentActual as number | undefined) ??
    (income?.grossRentPotential as number | undefined) ??
    (income?.effectiveGrossIncome as number | undefined) ??
    (ui?.grossRent as number | undefined);
  const totalExpenses = expenses?.totalExpenses;
  const expensesTable = expenses?.expensesTable;
  const rentRoll = om.rentRoll ?? [];
  const investmentTakeaways = om.investmentTakeaways ?? [];

  const rentalNumbersPerUnit: RentalNumberPerUnit[] = rentRoll.map((r: OmRentRollRow) => ({
    unit: r.unit,
    monthlyRent: r.monthlyRent,
    annualRent: r.annualRent ?? (r.monthlyRent != null ? r.monthlyRent * 12 : undefined),
    beds: r.beds,
    baths: r.baths,
    sqft: r.sqft,
    occupied: r.occupied,
    lastRentedDate: r.lastRentedDate,
    dateVacant: r.dateVacant,
    note: [r.rentType, r.tenantStatus, r.notes].filter(Boolean).join("; ") || undefined,
  }));

  const out: RentalFinancialsFromLlm = {};
  if (noi != null && typeof noi === "number") out.noi = noi;
  if (capRate != null && typeof capRate === "number") out.capRate = capRate;
  if (grossRentTotal != null && typeof grossRentTotal === "number") out.grossRentTotal = grossRentTotal;
  if (totalExpenses != null && typeof totalExpenses === "number") out.totalExpenses = totalExpenses;
  if (Array.isArray(expensesTable) && expensesTable.length > 0) out.expensesTable = expensesTable;
  if (rentalNumbersPerUnit.length > 0) out.rentalNumbersPerUnit = rentalNumbersPerUnit;
  if (investmentTakeaways.length > 0)
    out.keyTakeaways = (investmentTakeaways as string[]).map((t: string) => (t.startsWith("•") ? t : `• ${t}`)).join("\n");
  return out;
}

/**
 * Extract rental financials from arbitrary text (e.g. inquiry email body, OM PDF text, brochure).
 * When OM-style (long text or forceOmStyle): uses senior-analyst prompt, returns full omAnalysis + derived fromLlm.
 * Otherwise: uses short prompt, returns fromLlm only.
 */
export async function extractRentalFinancialsFromText(
  text: string,
  options?: ExtractRentalFinancialsOptions
): Promise<ExtractRentalFinancialsResult> {
  const key = getApiKey();
  if (!key) {
    console.warn("[extractRentalFinancialsFromText] OPENAI_API_KEY missing or invalid; skipping OpenAI call.");
    return { fromLlm: null, omAnalysis: null };
  }
  const trimmed = (text ?? "").trim();
  if (!trimmed || trimmed.length < 20) {
    console.warn("[extractRentalFinancialsFromText] Text too short for LLM (length:", trimmed.length, "); skipping OpenAI call.");
    return { fromLlm: null, omAnalysis: null };
  }

  const isOmStyle = options?.forceOmStyle === true || trimmed.length >= OM_STYLE_MIN_LENGTH;
  /** For OM-style, use more context so long/complex OMs (e.g. full Executive Summary + appendices) are not truncated; rent roll often appears later in the doc. */
  const omDocLimit = 48000;
  const docLimit = isOmStyle ? omDocLimit : 15000;
  const docSnippet = trimmed.slice(0, docLimit);
  console.log("[extractRentalFinancialsFromText] Calling OpenAI model=" + getEnrichmentModel() + " isOmStyle=" + isOmStyle + " promptChars=" + (OM_ANALYSIS_PROMPT_PREFIX.length + docSnippet.length) + (trimmed.length > docLimit ? " (doc truncated)" : ""));
  const openai = new OpenAI({ apiKey: key });

  const documentSection =
    (options?.enrichmentContext ? `Additional enrichment data:\n${options.enrichmentContext}\n\n` : "") +
    `Document text (OM/listing):\n${docSnippet}`;

  const prompt = isOmStyle
    ? OM_ANALYSIS_PROMPT_PREFIX + documentSection
    : `Below is text from a NYC real estate listing or inquiry (description, email body, or attachment). Extract any financial or rental-related information into a JSON object. Keep string fields concise and readable.

Return a JSON object with these keys (use null for missing):
- noi: number (Net Operating Income if mentioned)
- capRate: number (cap rate % if mentioned)
- grossRentTotal: number (total gross rent if mentioned)
- totalExpenses: number (total expenses if mentioned)
- expensesTable: array of { "lineItem": string, "amount": number } for each expense line if a breakdown is given
- rentalEstimates: string (brief summary of rent roll or income; not a raw dump)
- rentalNumbersPerUnit: array of { "unit": string, "monthlyRent": number (optional), "annualRent": number (optional), "rent": number (optional), "beds": number (optional), "baths": number (optional), "sqft": number (optional), "note": string (optional) } if per-unit rents are mentioned
- otherFinancials: string (taxes, expenses, HOA, other numbers — clean "Item: $X" format)
- keyTakeaways: string (optional; 1–3 bullet points if the text highlights value, condition, or risks)

Only include keys where you found relevant data. If nothing financial or rental-related is found, return {"otherFinancials": null}.

Text:
${trimmed.slice(0, 15000)}`;

  try {
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string")
      return { fromLlm: null, omAnalysis: null };

    let jsonStr = content.trim();
    const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (isOmStyle) {
      const rawUi = (parsed.uiFinancialSummary as Record<string, unknown>) ?? undefined;
      const omAnalysis: OmAnalysis = {
        propertyInfo: (parsed.propertyInfo as Record<string, unknown>) ?? undefined,
        rentRoll: Array.isArray(parsed.rentRoll)
          ? (parsed.rentRoll as OmRentRollRow[])
          : undefined,
        income: (parsed.income as Record<string, unknown>) ?? undefined,
        expenses: (parsed.expenses as OmAnalysis["expenses"]) ?? undefined,
        financialMetrics: (parsed.financialMetrics as Record<string, unknown>) ?? undefined,
        valuationMetrics: (parsed.valuationMetrics as Record<string, unknown>) ?? undefined,
        underwritingMetrics: (parsed.underwritingMetrics as Record<string, unknown>) ?? undefined,
        nycRegulatorySummary: (parsed.nycRegulatorySummary as Record<string, unknown>) ?? undefined,
        furnishedModel: (parsed.furnishedModel as Record<string, unknown>) ?? undefined,
        investmentTakeaways: Array.isArray(parsed.investmentTakeaways)
          ? (parsed.investmentTakeaways as string[])
          : undefined,
        recommendedOfferAnalysis: (parsed.recommendedOfferAnalysis as Record<string, unknown>) ?? undefined,
        uiFinancialSummary: normalizeUiFinancialSummary(rawUi),
        dossierMemo: (parsed.dossierMemo as Record<string, string>) ?? undefined,
        noiReported:
          typeof parsed.noiReported === "number" && !Number.isNaN(parsed.noiReported)
            ? parsed.noiReported
            : undefined,
      };
      const fromLlm = fromLlmFromOmAnalysis(omAnalysis);
      return { fromLlm, omAnalysis };
    }

    const result: RentalFinancialsFromLlm = {};
    if (parsed.noi != null && typeof parsed.noi === "number") result.noi = parsed.noi;
    if (parsed.capRate != null && typeof parsed.capRate === "number") result.capRate = parsed.capRate;
    if (parsed.grossRentTotal != null && typeof parsed.grossRentTotal === "number")
      result.grossRentTotal = parsed.grossRentTotal;
    if (parsed.totalExpenses != null && typeof parsed.totalExpenses === "number")
      result.totalExpenses = parsed.totalExpenses;
    if (Array.isArray(parsed.expensesTable) && parsed.expensesTable.length > 0) {
      result.expensesTable = (parsed.expensesTable as Array<{ lineItem?: unknown; amount?: unknown }>)
        .map((e) => ({ lineItem: String(e?.lineItem ?? "").trim(), amount: Number(e?.amount) || 0 }))
        .filter((e) => e.lineItem.length > 0) as ExpenseLineItem[];
    }
    if (typeof parsed.rentalEstimates === "string" && parsed.rentalEstimates.trim())
      result.rentalEstimates = parsed.rentalEstimates.trim();
    if (Array.isArray(parsed.rentalNumbersPerUnit) && parsed.rentalNumbersPerUnit.length > 0) {
      result.rentalNumbersPerUnit = (parsed.rentalNumbersPerUnit as Array<Record<string, unknown>>).map((u) => {
        const monthly = typeof u.monthlyRent === "number" ? u.monthlyRent : null;
        const annual = typeof u.annualRent === "number" ? u.annualRent : null;
        const rent = typeof u.rent === "number" ? u.rent : null;
        const beds = typeof u.beds === "number" && !Number.isNaN(u.beds) ? u.beds : undefined;
        const baths = typeof u.baths === "number" && !Number.isNaN(u.baths) ? u.baths : undefined;
        const sqft = typeof u.sqft === "number" && !Number.isNaN(u.sqft) && u.sqft > 0 ? u.sqft : undefined;
        return {
          unit: typeof u.unit === "string" ? u.unit.trim() : undefined,
          monthlyRent: monthly ?? (rent != null ? rent : (annual != null ? annual / 12 : undefined)),
          annualRent: annual ?? (rent != null ? rent * 12 : (monthly != null ? monthly * 12 : undefined)),
          rent: rent ?? monthly ?? (annual != null ? annual / 12 : undefined),
          beds,
          baths,
          sqft,
          note: typeof u.note === "string" ? u.note.trim() || undefined : undefined,
        } as RentalNumberPerUnit;
      });
    }
    if (typeof parsed.otherFinancials === "string" && parsed.otherFinancials.trim())
      result.otherFinancials = parsed.otherFinancials.trim();
    if (typeof parsed.keyTakeaways === "string" && parsed.keyTakeaways.trim())
      result.keyTakeaways = parsed.keyTakeaways.trim();

    return {
      fromLlm: Object.keys(result).length > 0 ? result : null,
      omAnalysis: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
    console.error(
      "[extractRentalFinancialsFromText] OpenAI call failed:",
      msg,
      code ? `(code: ${code})` : "",
      status ? `(status: ${status})` : ""
    );
    if (err && typeof err === "object" && "error" in err) {
      const apiErr = (err as { error?: { message?: string; code?: string } }).error;
      if (apiErr?.message) console.error("[extractRentalFinancialsFromText] API error:", apiErr.message, apiErr.code ?? "");
    }
    return { fromLlm: null, omAnalysis: null };
  }
}
