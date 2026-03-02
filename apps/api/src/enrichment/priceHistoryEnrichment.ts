/**
 * Price history enrichment: fetch listing page HTML and ask the LLM to extract
 * price history into a clean bulleted list. (The LLM cannot browse URLs; we must send the content.)
 */

import type { PriceHistoryEntry } from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getPriceHistoryModel } from "./openaiModels.js";

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

/** Detect StreetEasy bot-block (PerimeterX captcha) page so we don't send it to the LLM. */
function isCaptchaOrBlockPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("access to this page has been denied") ||
    lower.includes("perimeterx") ||
    lower.includes("px-captcha")
  );
}

/** Fetch page HTML; may be blocked by bot protection (e.g. StreetEasy returns 403 or captcha body). */
async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      if (isStreetEasyUrl(url)) {
        console.warn(
          `[priceHistoryEnrichment] StreetEasy returned ${res.status} for ${url.slice(0, 60)}… — price history unavailable (site blocks server-side requests).`
        );
      }
      return null;
    }
    const text = await res.text();
    if (text.length < 500) return null;
    if (isStreetEasyUrl(url) && isCaptchaOrBlockPage(text)) {
      console.warn(
        "[priceHistoryEnrichment] StreetEasy returned a captcha/bot-block page instead of listing — price history unavailable."
      );
      return null;
    }
    return text.slice(0, 120000);
  } catch (err) {
    console.warn("[priceHistoryEnrichment] Fetch failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
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
 * Fetch listing page HTML, then ask the LLM to extract price history from it into a bulleted list.
 * If the fetch fails or returns a captcha/minimal page, we get no data (LLM cannot browse the URL).
 */
export async function extractPriceHistory(listingUrl: string): Promise<PriceHistoryEnrichmentResult> {
  const empty: PriceHistoryEnrichmentResult = { priceHistory: null, rentalPriceHistory: null };
  const key = getApiKey();
  if (!key) return empty;
  if (!listingUrl || listingUrl === "#" || !listingUrl.startsWith("http")) return empty;

  const html = await fetchPageHtml(listingUrl);
  if (!html) return empty;

  const openai = new OpenAI({ apiKey: key });
  const prompt = `Below is HTML from a real estate listing page (often StreetEasy). Extract the price history table(s) and produce a clean bulleted list.

Use this format for each row:
• Date: [date], Price: [price], Event: [event]

Look for sections like "Property history" or "Price history" (sale/list) and "Rental price history" or "Rent history". List sale/list entries first, then add a line "Rental price history", then any rental entries with the same bullet format. If you find no price history table, reply with only: No price history found.

HTML:
${html}`;

  try {
    const completion = await openai.chat.completions.create({
      model: getPriceHistoryModel(),
      messages: [{ role: "user", content: prompt }],
    });

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!content || content.toLowerCase().startsWith("no price history")) return empty;

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
