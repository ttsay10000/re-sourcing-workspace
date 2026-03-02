/**
 * Price history enrichment: ask the LLM to find price history from the listing URL
 * and return a clean bulleted list. No HTML fetch; prompt includes the link only.
 */

import type { PriceHistoryEntry } from "@re-sourcing/contracts";
import OpenAI from "openai";

function getApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== "string" || key.trim() === "") return null;
  return key.trim();
}

export interface PriceHistoryEnrichmentResult {
  priceHistory: PriceHistoryEntry[] | null;
  rentalPriceHistory: PriceHistoryEntry[] | null;
}

/**
 * Parse bulleted lines containing Date, Price, Event (e.g. "• Date: X, Price: Y, Event: Z").
 * Tolerates variations in punctuation and order.
 */
function parseBulletedPriceHistory(text: string): PriceHistoryEntry[] {
  const entries: PriceHistoryEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (lower === "rental price history" || lower.startsWith("sale/list") || lower === "property history") continue;
    const dateMatch = t.match(/Date:\s*([^,|]+)/i);
    const priceMatch = t.match(/Price:\s*([^,|]+)/i);
    const eventMatch = t.match(/Event:\s*(.+)?$/i);
    const date = dateMatch ? dateMatch[1].trim() : "";
    const price = priceMatch ? priceMatch[1].trim() : "";
    const event = eventMatch ? eventMatch[1].trim() : "";
    if (date || price || event) {
      entries.push({ date, price, event });
    }
  }
  return entries.filter((e) => e.date || e.price || e.event);
}

/**
 * Ask the LLM to find price history from the given listing URL and produce a clean bulleted list.
 * No HTML fetch; the model uses the link (e.g. with browsing if available) or returns what it can.
 */
export async function extractPriceHistory(listingUrl: string): Promise<PriceHistoryEnrichmentResult> {
  const empty: PriceHistoryEnrichmentResult = { priceHistory: null, rentalPriceHistory: null };
  const key = getApiKey();
  if (!key) return empty;
  if (!listingUrl || listingUrl === "#" || !listingUrl.startsWith("http")) return empty;

  const openai = new OpenAI({ apiKey: key });
  const prompt = `Please find the price history from this link and produce the results in a clean bulleted list.

Use this format for each entry:
• Date: [date], Price: [price], Event: [event]

If the page has both sale/list price history and rental price history, list the sale/list entries first, then add a line "Rental price history", then list rental entries with the same bullet format.

Link: ${listingUrl}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return empty;

    const allEntries = parseBulletedPriceHistory(content);
    if (allEntries.length === 0) return empty;

    const rentalIndex = content.toLowerCase().indexOf("rental price history");
    let priceHistory: PriceHistoryEntry[];
    let rentalPriceHistory: PriceHistoryEntry[] | null = null;
    if (rentalIndex > -1 && allEntries.length > 1) {
      const saleSection = content.slice(0, rentalIndex);
      const rentalSection = content.slice(rentalIndex);
      priceHistory = parseBulletedPriceHistory(saleSection);
      rentalPriceHistory = parseBulletedPriceHistory(rentalSection);
      if (rentalPriceHistory.length === 0) rentalPriceHistory = null;
    } else {
      priceHistory = allEntries;
    }

    return {
      priceHistory: priceHistory.length > 0 ? priceHistory : null,
      rentalPriceHistory: rentalPriceHistory && rentalPriceHistory.length > 0 ? rentalPriceHistory : null,
    };
  } catch (err) {
    console.error("[priceHistoryEnrichment]", err);
    return empty;
  }
}
