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

/**
 * Extract price history (date, price, event) from listing page content via OpenAI.
 * Looks for the "Property history" / "Price history" section with a table of DATE, PRICE, EVENT.
 */
export async function extractPriceHistory(listingUrl: string): Promise<PriceHistoryEntry[] | null> {
  const key = getApiKey();
  if (!key) return null;

  if (!listingUrl || listingUrl === "#" || !listingUrl.startsWith("http")) return null;

  const html = await fetchPageContent(listingUrl);
  if (!html || html.length < 100) return null;

  const openai = new OpenAI({ apiKey: key });

  const prompt = `Below is HTML from a real estate listing page (often StreetEasy). Find the "Property history" or "Price history" section that contains a table with columns like DATE, PRICE, and EVENT. Each row has a date, a price (e.g. $6,999,000), and an event (e.g. "Price decreased by 5%", "Listed by Keller Williams NYC"). Extract every row from that table in order (newest first typically).

Respond with a JSON object with a single key "entries" that is an array of objects. Each object must have: "date" (string, e.g. "1/13/2026"), "price" (string or number, e.g. "$6,999,000" or 6999000), "event" (string). If you cannot find any price history table, return {"entries":[]}.

HTML:
${html}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    const parsed = JSON.parse(content) as unknown;
    let arr: unknown[] = [];
    if (parsed && typeof parsed === "object" && "entries" in parsed && Array.isArray((parsed as { entries: unknown[] }).entries)) {
      arr = (parsed as { entries: unknown[] }).entries;
    } else if (Array.isArray(parsed)) {
      arr = parsed;
    }

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
    return result.length > 0 ? result : null;
  } catch (err) {
    console.error("[priceHistoryEnrichment]", err);
    return null;
  }
}
