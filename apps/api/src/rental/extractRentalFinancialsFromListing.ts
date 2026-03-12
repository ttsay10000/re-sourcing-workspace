import OpenAI from "openai";
import type {
  ExpenseLineItem,
  RentalFinancialsFromLlm,
  RentalNumberPerUnit,
} from "@re-sourcing/contracts";
import { getEnrichmentModel } from "../enrichment/openaiModels.js";
import { sanitizeRentalNumberRows } from "./omAnalysisUtils.js";

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

function parseJsonObject(content: string | null | undefined): Record<string, unknown> | null {
  if (!content || typeof content !== "string") return null;
  let jsonStr = content.trim();
  const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (codeBlock) jsonStr = codeBlock[1].trim();
  return JSON.parse(jsonStr) as Record<string, unknown>;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function extractRentalFinancialsFromListing(
  description: string | null | undefined,
  buildingName: string | null | undefined
): Promise<RentalFinancialsFromLlm | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const desc = (description ?? "").trim();
  const building = (buildingName ?? "").trim();
  const text = [building ? `Building name: ${building}` : "", desc].filter(Boolean).join("\n\n");
  if (text.length < 20) return null;

  const prompt = `Below is text from a NYC real estate listing or inquiry. Extract any financial or rental-related information into a JSON object. Keep string fields concise and readable.

Return a JSON object with these keys (use null for missing):
- noi: number
- capRate: number
- grossRentTotal: number
- totalExpenses: number
- expensesTable: array of { "lineItem": string, "amount": number }
- rentalEstimates: string
- rentalNumbersPerUnit: array of { "unit": string, "monthlyRent": number (optional), "annualRent": number (optional), "rent": number (optional), "beds": number (optional), "baths": number (optional), "sqft": number (optional), "note": string (optional) }
- otherFinancials: string
- keyTakeaways: string

Only include keys where you found relevant data. If nothing financial or rental-related is found, return {"otherFinancials": null}.

Text:
${text.slice(0, 15000)}`;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const parsed = parseJsonObject(completion.choices[0]?.message?.content);
    if (!parsed) return null;

    const result: RentalFinancialsFromLlm = {};
    const noi = toNumber(parsed.noi);
    const capRate = toNumber(parsed.capRate);
    const grossRentTotal = toNumber(parsed.grossRentTotal);
    const totalExpenses = toNumber(parsed.totalExpenses);
    if (noi != null) result.noi = noi;
    if (capRate != null) result.capRate = capRate;
    if (grossRentTotal != null) result.grossRentTotal = grossRentTotal;
    if (totalExpenses != null) result.totalExpenses = totalExpenses;
    if (Array.isArray(parsed.expensesTable) && parsed.expensesTable.length > 0) {
      result.expensesTable = (parsed.expensesTable as Array<{ lineItem?: unknown; amount?: unknown }>)
        .map((entry) => ({
          lineItem: String(entry?.lineItem ?? "").trim(),
          amount: Number(entry?.amount) || 0,
        }))
        .filter((entry) => entry.lineItem.length > 0) as ExpenseLineItem[];
    }
    if (typeof parsed.rentalEstimates === "string" && parsed.rentalEstimates.trim()) {
      result.rentalEstimates = parsed.rentalEstimates.trim();
    }
    if (Array.isArray(parsed.rentalNumbersPerUnit) && parsed.rentalNumbersPerUnit.length > 0) {
      const rows = (parsed.rentalNumbersPerUnit as Array<Record<string, unknown>>).map((unit) => {
        const monthly = toNumber(unit.monthlyRent);
        const annual = toNumber(unit.annualRent);
        const rent = toNumber(unit.rent);
        return {
          unit: typeof unit.unit === "string" ? unit.unit.trim() : undefined,
          monthlyRent: monthly ?? rent ?? (annual != null ? annual / 12 : undefined),
          annualRent: annual ?? (rent != null ? rent * 12 : (monthly != null ? monthly * 12 : undefined)),
          rent: rent ?? monthly ?? (annual != null ? annual / 12 : undefined),
          beds: toNumber(unit.beds),
          baths: toNumber(unit.baths),
          sqft: toNumber(unit.sqft),
          note: typeof unit.note === "string" ? unit.note.trim() || undefined : undefined,
        } as RentalNumberPerUnit;
      });
      const cleanedRows = sanitizeRentalNumberRows(rows);
      if (cleanedRows.length > 0) result.rentalNumbersPerUnit = cleanedRows;
    }
    if (typeof parsed.otherFinancials === "string" && parsed.otherFinancials.trim()) {
      result.otherFinancials = parsed.otherFinancials.trim();
    }
    if (typeof parsed.keyTakeaways === "string" && parsed.keyTakeaways.trim()) {
      result.keyTakeaways = parsed.keyTakeaways.trim();
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extractRentalFinancialsFromListing] OpenAI call failed:", message);
    return null;
  }
}
