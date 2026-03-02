/**
 * Price history enrichment: fetch listing URL and extract the "Property history"
 * section. For StreetEasy URLs we first try DOM-based parsing (table after the
 * "Property history" heading); otherwise use OpenAI to extract from HTML.
 */

import type { PriceHistoryEntry } from "@re-sourcing/contracts";
import OpenAI from "openai";

function getApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== "string" || key.trim() === "") return null;
  return key.trim();
}

function isStreetEasyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "streeteasy.com" || u.hostname.endsWith(".streeteasy.com");
  } catch {
    return false;
  }
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

/** Strip HTML tags and normalize whitespace for cell text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find a heading (e.g. "Property history") in HTML and parse the next <table> into rows of [date, price, event].
 * Used only for StreetEasy so we don't depend on LLM when the section is present in the initial HTML.
 */
function extractTableAfterHeading(html: string, headingText: string): PriceHistoryEntry[] {
  const entries: PriceHistoryEntry[] = [];
  const lower = html.toLowerCase();
  const headingLower = headingText.toLowerCase();
  const idx = lower.indexOf(headingLower);
  if (idx === -1) return entries;
  const afterHeading = html.slice(idx);
  const tableStart = afterHeading.search(/<table[\s>]/i);
  if (tableStart === -1) return entries;
  const tableSlice = afterHeading.slice(tableStart);
  const tableEnd = tableSlice.search(/<\/table\s*>/i);
  const tableHtml = tableEnd === -1 ? tableSlice : tableSlice.slice(0, tableEnd + "</table>".length);
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  let rowMatch: RegExpExecArray | null;
  let isFirst = true;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]\s*>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]));
    }
    if (cells.length >= 3) {
      if (isFirst && cells[0].toLowerCase().includes("date") && cells[1].toLowerCase().includes("price")) {
        isFirst = false;
        continue;
      }
      entries.push({ date: cells[0] ?? "", price: cells[1] ?? "", event: cells[2] ?? "" });
    } else if (cells.length === 2) {
      if (!isFirst) entries.push({ date: cells[0] ?? "", price: cells[1] ?? "", event: "" });
    }
    isFirst = false;
  }
  return entries;
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
 * Extract sale/list price history and rental price history from listing page.
 * For StreetEasy URLs: first try DOM parsing (table after "Property history" / "Rental price history" headings).
 * If that returns nothing (e.g. SPA with no SSR) or URL is not StreetEasy, fall back to OpenAI.
 */
export async function extractPriceHistory(listingUrl: string): Promise<PriceHistoryEnrichmentResult> {
  const empty: PriceHistoryEnrichmentResult = { priceHistory: null, rentalPriceHistory: null };
  if (!listingUrl || listingUrl === "#" || !listingUrl.startsWith("http")) return empty;

  const html = await fetchPageContent(listingUrl);
  if (!html || html.length < 100) {
    console.warn("[priceHistoryEnrichment] fetch returned no or minimal HTML, url length=" + listingUrl.length);
    return empty;
  }

  const result: PriceHistoryEnrichmentResult = { priceHistory: null, rentalPriceHistory: null };

  if (isStreetEasyUrl(listingUrl)) {
    const fromDomSale = extractTableAfterHeading(html, "Property history");
    if (fromDomSale.length > 0) {
      result.priceHistory = fromDomSale;
    }
    const fromDomRental = extractTableAfterHeading(html, "Rental price history");
    const rentalRows = fromDomRental.length > 0 ? fromDomRental : extractTableAfterHeading(html, "Rent history");
    if (rentalRows.length > 0) {
      result.rentalPriceHistory = rentalRows;
    }
    if (result.priceHistory === null && html.toLowerCase().indexOf("property history") === -1) {
      console.warn("[priceHistoryEnrichment] StreetEasy URL but 'Property history' not in HTML (likely SPA); falling back to LLM");
    }
  }

  const needSale = result.priceHistory === null;
  const needRental = result.rentalPriceHistory === null;
  if (!needSale && !needRental) return result;

  const key = getApiKey();
  if (!key) return result;

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
    if (!content || typeof content !== "string") return result;

    const parsed = JSON.parse(content) as unknown;
    let entries: unknown[] = [];
    let rentalEntries: unknown[] = [];
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      if (Array.isArray(o.entries)) entries = o.entries;
      if (Array.isArray(o.rentalEntries)) rentalEntries = o.rentalEntries;
    }

    if (needSale) {
      const priceHistory = parsePriceHistoryEntries(entries);
      result.priceHistory = priceHistory.length > 0 ? priceHistory : null;
    }
    if (needRental) {
      const rentalPriceHistory = parsePriceHistoryEntries(rentalEntries);
      result.rentalPriceHistory = rentalPriceHistory.length > 0 ? rentalPriceHistory : null;
    }
    return result;
  } catch (err) {
    console.error("[priceHistoryEnrichment]", err);
    return result;
  }
}
