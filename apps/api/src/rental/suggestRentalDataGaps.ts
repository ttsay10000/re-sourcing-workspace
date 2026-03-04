/**
 * LLM step: compare sale listing (beds, baths, etc.) to rental units from RapidAPI and suggest if data might be missing.
 * E.g. "Sale listing shows 4 beds but rental units only sum to 2 beds – consider requesting OM."
 */

import type { RentalUnitRow } from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getEnrichmentModel } from "../enrichment/openaiModels.js";

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

export interface SaleListingSummary {
  beds?: number | null;
  baths?: number | null;
  address?: string | null;
  title?: string | null;
  descriptionSnippet?: string | null;
}

/**
 * Ask LLM to compare sale listing to rental units and suggest if data might be incomplete.
 * Returns a short suggestion string or null.
 */
export async function suggestRentalDataGaps(
  saleListing: SaleListingSummary | null,
  rentalUnits: RentalUnitRow[]
): Promise<string | null> {
  const key = getApiKey();
  if (!key) return null;

  const listingBeds = saleListing?.beds ?? null;
  const listingBaths = saleListing?.baths ?? null;
  const unitCount = rentalUnits.length;
  const sumBeds = rentalUnits.reduce((s, u) => s + (u.beds ?? 0), 0);
  const sumBaths = rentalUnits.reduce((s, u) => s + (u.baths ?? 0), 0);

  const openai = new OpenAI({ apiKey: key });
  const prompt = `You are comparing a NYC sale listing to rental unit data we pulled from an API (RapidAPI often returns partial results).

Sale listing: ${listingBeds != null ? `${listingBeds} beds` : "beds unknown"}, ${listingBaths != null ? `${listingBaths} baths` : "baths unknown"}. ${saleListing?.address ? `Address: ${saleListing.address}` : ""} ${saleListing?.title ? `Title: ${saleListing.title}` : ""}
${saleListing?.descriptionSnippet ? `Description snippet: ${String(saleListing.descriptionSnippet).slice(0, 500)}` : ""}

Rental units we have from API: ${unitCount} unit(s). Total beds across those units: ${sumBeds}. Total baths: ${sumBaths}.
${rentalUnits.length > 0 ? `Per unit: ${rentalUnits.map((u) => `unit ${u.unit ?? "?"}: ${u.beds ?? "?"} bed, ${u.baths ?? "?"} bath`).join("; ")}` : "No rental units returned."}

If the sale listing implies more beds, baths, or units than our rental data shows (e.g. sale has 4 beds but we only have 2 beds across units), reply with one short sentence suggesting data may be incomplete and to consider requesting an OM or rent roll. Otherwise reply with exactly: NO_GAP`;

  try {
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      messages: [{ role: "user", content: prompt }],
    });
    const content = (completion.choices[0]?.message?.content ?? "").trim();
    if (!content || content.toUpperCase() === "NO_GAP") return null;
    return content.slice(0, 500);
  } catch (err) {
    console.warn("[suggestRentalDataGaps]", err instanceof Error ? err.message : err);
    return null;
  }
}
