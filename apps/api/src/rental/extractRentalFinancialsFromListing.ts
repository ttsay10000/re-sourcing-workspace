/**
 * Step 2: Extract rental-related financials from listing description and building name via LLM.
 * Merged into property.details.rentalFinancials without overwriting existing data (e.g. from RapidAPI).
 */

import type { RentalFinancialsFromLlm } from "@re-sourcing/contracts";
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

/**
 * Extract rental financials from arbitrary text (e.g. inquiry email body + attachment text). Same LLM prompt as listing.
 */
export async function extractRentalFinancialsFromText(text: string): Promise<RentalFinancialsFromLlm | null> {
  const key = getApiKey();
  if (!key) return null;
  const trimmed = (text ?? "").trim();
  if (!trimmed || trimmed.length < 20) return null;

  const openai = new OpenAI({ apiKey: key });
  const prompt = `Below is text from a NYC real estate listing or inquiry (description, email body, or attachment). Extract any financial or rental-related information.

Return a JSON object with these keys (use null for missing):
- noi: number (Net Operating Income if mentioned)
- capRate: number (cap rate % if mentioned)
- rentalEstimates: string (any rental income or rent roll summary in text form)
- rentalNumbersPerUnit: array of { unit: string, rent: number, note?: string } if per-unit rents are mentioned
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
    if (typeof parsed.rentalEstimates === "string" && parsed.rentalEstimates.trim())
      result.rentalEstimates = parsed.rentalEstimates.trim();
    if (Array.isArray(parsed.rentalNumbersPerUnit))
      result.rentalNumbersPerUnit = parsed.rentalNumbersPerUnit as RentalFinancialsFromLlm["rentalNumbersPerUnit"];
    if (typeof parsed.otherFinancials === "string" && parsed.otherFinancials.trim())
      result.otherFinancials = parsed.otherFinancials.trim();

    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    console.warn("[extractRentalFinancialsFromText]", err instanceof Error ? err.message : err);
    return null;
  }
}
