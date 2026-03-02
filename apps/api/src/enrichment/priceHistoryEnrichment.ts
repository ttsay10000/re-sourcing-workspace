/**
 * Price history enrichment: fetch listing URL and use OpenAI to extract the
 * "Property history" section (date, price, event table) from StreetEasy-style pages.
 */

import type { PriceHistoryEntry } from "@re-sourcing/contracts";
import OpenAI from "openai";

function getApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== "string" || key.trim() === "") return null;
  return key.trim();
}

/**
 * Fetch page content from a listing URL. Uses a browser-like User-Agent to reduce blocking.
 */
async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 150000); // cap size for API
  } catch {
    return null;
  }
}

function parsePriceHistoryEntries(arr: unknown[]): PriceHistoryEntry[] {
  const result: PriceHistoryEntry[] = [];
  for (const raw of arr) {
    if (raw && typeof raw === "object" && raw !== null && "date" in raw && "event" in raw) {
      const o = raw as Record<string, unknown>;
      result.push({
        date: String(o.date ?? ""),
        price: o.price != null ? (typeof o.price === "number" ? o.price : String(o.price)) : "",
        event: String(o.event ?? ""),
      });
    }
  }
  return result;
}

export interface PriceHistoryEnrichmentResult {
  priceHistory: PriceHistoryEntry[] | null;
  rentalPriceHistory: PriceHistoryEntry[] | null;
}

/**
 * Extract sale/list price history and rental price history (when present) from listing page via OpenAI.
 * Returns both; either or both may be empty.
 */
export async function extractPriceHistory(listingUrl: string): Promise<PriceHistoryEnrichmentResult> {
  const empty: PriceHistoryEnrichmentResult = { priceHistory: null, rentalPriceHistory: null };
  const key = getApiKey();
  if (!key) return empty;

  if (!listingUrl || listingUrl === "#" || !listingUrl.startsWith("http")) return empty;

  const html = await fetchPageContent(listingUrl);
  if (!html || html.length < 100) return empty;

  const openai = new OpenAI({ apiKey: key });

  const prompt = `Below is HTML from a real estate listing page (often StreetEasy). Extract price history tables if present.

1) "Property history" or "Price history" (sale/list): table with DATE, PRICE, EVENT (e.g. "Price decreased by 5%", "Listed by Keller Williams NYC"). Put in "entries".
2) "Rental price history" or "Rent history": if the page has a separate table for rental/rent price changes, put those rows in "rentalEntries" (same shape: date, price, event). If there is no rental history table, use "rentalEntries": [].

Respond with a JSON object with two keys: "entries" (array for sale/list price history) and "rentalEntries" (array for rental price history). Each object: "date" (string), "price" (string or number), "event" (string). If no sale history found, return {"entries":[], "rentalEntries":[]}.

HTML:
${html}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return empty;

    const parsed = JSON.parse(content) as unknown;
    let entries: unknown[] = [];
    let rentalEntries: unknown[] = [];
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      if (Array.isArray(o.entries)) entries = o.entries;
      if (Array.isArray(o.rentalEntries)) rentalEntries = o.rentalEntries;
    }

    const priceHistory = parsePriceHistoryEntries(entries);
    const rentalPriceHistory = parsePriceHistoryEntries(rentalEntries);
    return {
      priceHistory: priceHistory.length > 0 ? priceHistory : null,
      rentalPriceHistory: rentalPriceHistory.length > 0 ? rentalPriceHistory : null,
    };
  } catch (err) {
    console.error("[priceHistoryEnrichment]", err);
    return empty;
  }
}
