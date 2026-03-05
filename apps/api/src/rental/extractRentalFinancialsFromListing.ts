/**
 * Step 2: Extract rental-related financials from listing description, OM, or email/attachments via LLM.
 * For long text (OM/brochure), asks for full structured tables: NOI, cap rate, expenses, per-unit rent roll.
 */

import type { RentalFinancialsFromLlm, ExpenseLineItem, RentalNumberPerUnit } from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getEnrichmentModel } from "../enrichment/openaiModels.js";

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

/**
 * Call LLM to extract NOI, cap rate, rental estimates, etc. from listing text.
 * Returns null if no key or no meaningful content.
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
  return extractRentalFinancialsFromText(text);
}

const OM_STYLE_MIN_LENGTH = 2500;

/**
 * Extract rental financials from arbitrary text (e.g. inquiry email body, OM PDF text, brochure).
 * For long text (likely OM/brochure), uses a thorough prompt and returns structured expensesTable and rentalNumbersPerUnit for table display.
 */
export async function extractRentalFinancialsFromText(text: string): Promise<RentalFinancialsFromLlm | null> {
  const key = getApiKey();
  if (!key) return null;
  const trimmed = (text ?? "").trim();
  if (!trimmed || trimmed.length < 20) return null;

  const isOmStyle = trimmed.length >= OM_STYLE_MIN_LENGTH;
  const openai = new OpenAI({ apiKey: key });

  const prompt = isOmStyle
    ? `Below is text from an Offering Memorandum (OM), brochure, or similar NYC property document. Read through the FULL document and extract all financial and rental information into a structured format.

Return a JSON object with these keys (use null for missing):
- noi: number (Net Operating Income)
- capRate: number (cap rate as a percentage, e.g. 4.5 for 4.5%)
- grossRentTotal: number (total gross rental income per year if stated)
- totalExpenses: number (total expenses per year if stated)
- expensesTable: array of { "lineItem": string, "amount": number } for each expense line (e.g. Real Estate Taxes, Insurance, Utilities, Water, Maintenance, etc.). Use the exact line item names from the document.
- rentalNumbersPerUnit: array of { "unit": string, "monthlyRent": number, "annualRent": number, "note": string (optional, e.g. "Rent Stabilized") } for each unit in the rent roll. Prefer both monthly and annual when available.
- rentalEstimates: string (short summary only if you need to capture something that doesn't fit in the tables)
- otherFinancials: string (any other financial notes not in the tables)

Be thorough: read the entire document. Extract every expense line and every unit with rent. If nothing financial is found, return {"otherFinancials": null}.

Text:
${trimmed.slice(0, 14000)}`
    : `Below is text from a NYC real estate listing or inquiry (description, email body, or attachment). Extract any financial or rental-related information.

Return a JSON object with these keys (use null for missing):
- noi: number (Net Operating Income if mentioned)
- capRate: number (cap rate % if mentioned)
- grossRentTotal: number (total gross rent if mentioned)
- totalExpenses: number (total expenses if mentioned)
- expensesTable: array of { "lineItem": string, "amount": number } for each expense line if a breakdown is given
- rentalEstimates: string (any rental income or rent roll summary in text form)
- rentalNumbersPerUnit: array of { "unit": string, "monthlyRent": number (optional), "annualRent": number (optional), "rent": number (optional), "note": string (optional) } if per-unit rents are mentioned
- otherFinancials: string (taxes, expenses, other numbers that could be relevant)

Only include keys where you found relevant data. Be concise. If nothing financial or rental-related is found, return {"otherFinancials": null}.

Text:
${trimmed.slice(0, 15000)}`;

  try {
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    let jsonStr = content.trim();
    const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const result: RentalFinancialsFromLlm = {};
    if (parsed.noi != null && typeof parsed.noi === "number") result.noi = parsed.noi;
    if (parsed.capRate != null && typeof parsed.capRate === "number") result.capRate = parsed.capRate;
    if (parsed.grossRentTotal != null && typeof parsed.grossRentTotal === "number") result.grossRentTotal = parsed.grossRentTotal;
    if (parsed.totalExpenses != null && typeof parsed.totalExpenses === "number") result.totalExpenses = parsed.totalExpenses;
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
        return {
          unit: typeof u.unit === "string" ? u.unit.trim() : undefined,
          monthlyRent: monthly ?? (rent != null ? rent : (annual != null ? annual / 12 : undefined)),
          annualRent: annual ?? (rent != null ? rent * 12 : (monthly != null ? monthly * 12 : undefined)),
          rent: rent ?? monthly ?? (annual != null ? annual / 12 : undefined),
          note: typeof u.note === "string" ? u.note.trim() || undefined : undefined,
        } as RentalNumberPerUnit;
      });
    }
    if (typeof parsed.otherFinancials === "string" && parsed.otherFinancials.trim())
      result.otherFinancials = parsed.otherFinancials.trim();

    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    console.warn("[extractRentalFinancialsFromText]", err instanceof Error ? err.message : err);
    return null;
  }
}
