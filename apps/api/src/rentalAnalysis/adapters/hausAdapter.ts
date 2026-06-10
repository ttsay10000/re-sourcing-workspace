/**
 * Haus / StayHaus V1 adapter.
 *
 * Discovery: the public furnished-apartments search page plus sitemap.xml,
 * keeping any URL that looks like a listing detail page.
 * Metadata: JSON-LD (schema.org Apartment/Product/offers) preferred, then
 * OpenGraph/meta tags, then conservative text patterns (beds/baths/sqft/
 * guests/min-stay/price). Visible monthly price / ADR become fallback
 * observations ("effective_rate_only") until the date-entry quote flow is
 * wired; the orchestrator already samples 12 months of QuoteSpecs through
 * fetchQuote when a quote endpoint is available.
 */

import type { CompetitorListing, QuoteSpec } from "@re-sourcing/contracts";
import { normalizeQuote, type RawQuoteLineItems } from "../normalize.js";
import {
  FetchBlockedError,
  politeFetch,
} from "./politeFetch.js";
import {
  SourceUnavailableError,
  type DiscoveredListing,
  type ObservationDraft,
  type PricingProviderAdapter,
} from "./types.js";

const HAUS_BASE_URL = process.env.HAUS_BASE_URL || "https://stayhaus.co";
const HAUS_SEARCH_PATH = process.env.HAUS_SEARCH_PATH || "/new-york-furnished-apartments/";
/**
 * Optional operator-configured quote endpoint template, e.g.
 * "https://stayhaus.co/api/quote?listing={listingId}&checkin={checkIn}&checkout={checkOut}&guests={guests}".
 * Left unset, Haus runs on visible-price fallback observations.
 */
const HAUS_QUOTE_ENDPOINT_TEMPLATE = process.env.HAUS_QUOTE_ENDPOINT || "";

const LISTING_PATH_PATTERN = /\/(?:new-york-furnished-apartments|listings?|apartments?|homes?|properties)\/([a-z0-9][a-z0-9-]{2,})\/?$/i;
const NON_LISTING_SLUGS = new Set([
  "new-york-furnished-apartments",
  "about", "contact", "faq", "blog", "search", "terms", "privacy", "login", "signup",
]);

function asAbsoluteUrl(href: string): string | null {
  try {
    return new URL(href, HAUS_BASE_URL).toString();
  } catch {
    return null;
  }
}

/** Extract listing detail URLs from search-page/sitemap HTML or XML. */
export function parseHausListingUrls(html: string): string[] {
  const urls = new Set<string>();
  const hrefPattern = /(?:href="([^"#?]+)[^"]*"|<loc>\s*([^<\s]+)\s*<\/loc>)/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) != null) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const absolute = asAbsoluteUrl(raw.trim());
    if (!absolute) continue;
    let parsed: URL;
    try {
      parsed = new URL(absolute);
    } catch {
      continue;
    }
    if (!parsed.host.includes(new URL(HAUS_BASE_URL).host)) continue;
    const pathMatch = LISTING_PATH_PATTERN.exec(parsed.pathname);
    if (!pathMatch) continue;
    if (NON_LISTING_SLUGS.has(pathMatch[1].toLowerCase())) continue;
    parsed.search = "";
    parsed.hash = "";
    urls.add(parsed.toString());
  }
  return [...urls];
}

function toNumberLoose(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function collectJsonLdObjects(html: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html)) != null) {
    try {
      const parsed: unknown = JSON.parse(match[1].trim());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length > 0) {
        const item = queue.shift();
        if (item == null || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        objects.push(record);
        if (Array.isArray(record["@graph"])) queue.push(...(record["@graph"] as unknown[]));
      }
    } catch {
      // Malformed JSON-LD block — skip it, text patterns still apply.
    }
  }
  return objects;
}

function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property.replace(/[:/]/g, "\\$&")}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const inverted = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property.replace(/[:/]/g, "\\$&")}["']`,
    "i"
  );
  return pattern.exec(html)?.[1] ?? inverted.exec(html)?.[1] ?? null;
}

function textPattern(html: string, pattern: RegExp): number | null {
  const match = pattern.exec(html);
  return match ? toNumberLoose(match[1]) : null;
}

export interface HausParsedMetadata {
  title: string | null;
  address: string | null;
  neighborhood: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  guests: number | null;
  minStayNights: number | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
  visibleMonthlyRate: number | null;
  visibleAdr: number | null;
}

/** Parse one Haus listing detail page (JSON-LD → meta tags → text patterns). */
export function parseHausListingMetadata(html: string): HausParsedMetadata {
  const result: HausParsedMetadata = {
    title: null,
    address: null,
    neighborhood: null,
    beds: null,
    baths: null,
    sqft: null,
    guests: null,
    minStayNights: null,
    latitude: null,
    longitude: null,
    imageUrl: null,
    visibleMonthlyRate: null,
    visibleAdr: null,
  };

  for (const node of collectJsonLdObjects(html)) {
    const type = String(node["@type"] ?? "").toLowerCase();
    if (/apartment|accommodation|product|house|residence|vacationrental|lodging/.test(type)) {
      result.title ??= typeof node.name === "string" ? node.name : null;
      const address = node.address as Record<string, unknown> | string | undefined;
      if (typeof address === "string") result.address ??= address;
      else if (address && typeof address === "object") {
        const street = typeof address.streetAddress === "string" ? address.streetAddress : null;
        const locality = typeof address.addressLocality === "string" ? address.addressLocality : null;
        result.address ??= [street, locality].filter(Boolean).join(", ") || null;
        result.neighborhood ??= typeof address.addressLocality === "string" ? address.addressLocality : null;
      }
      const geo = node.geo as Record<string, unknown> | undefined;
      if (geo && typeof geo === "object") {
        result.latitude ??= toNumberLoose(geo.latitude);
        result.longitude ??= toNumberLoose(geo.longitude);
      }
      result.beds ??= toNumberLoose(node.numberOfBedrooms ?? node.numberOfRooms);
      result.baths ??= toNumberLoose(node.numberOfBathroomsTotal ?? node.numberOfFullBathrooms);
      const floorSize = node.floorSize as Record<string, unknown> | undefined;
      if (floorSize && typeof floorSize === "object") result.sqft ??= toNumberLoose(floorSize.value);
      result.guests ??= toNumberLoose(node.occupancy != null ? (node.occupancy as Record<string, unknown>).value : null);
      const image = node.image;
      if (typeof image === "string") result.imageUrl ??= image;
      else if (Array.isArray(image) && typeof image[0] === "string") result.imageUrl ??= image[0];

      const offers = (Array.isArray(node.offers) ? node.offers[0] : node.offers) as
        | Record<string, unknown>
        | undefined;
      if (offers && typeof offers === "object") {
        const price = toNumberLoose(offers.price ?? (offers.priceSpecification as Record<string, unknown> | undefined)?.price);
        const unit = String(
          (offers.priceSpecification as Record<string, unknown> | undefined)?.unitCode ??
            (offers.priceSpecification as Record<string, unknown> | undefined)?.unitText ??
            ""
        ).toLowerCase();
        if (price != null && price > 0) {
          if (/mon|mo/.test(unit) || price > 1200) result.visibleMonthlyRate ??= price;
          else result.visibleAdr ??= price;
        }
      }
    }
  }

  result.title ??= metaContent(html, "og:title");
  result.imageUrl ??= metaContent(html, "og:image");

  result.beds ??= textPattern(html, /(\d+(?:\.\d+)?)\s*(?:bed(?:room)?s?|br\b)/i);
  result.baths ??= textPattern(html, /(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba\b)/i);
  result.sqft ??= textPattern(html, /([\d,]{3,6})\s*(?:sq\.?\s*ft|sf\b|square\s+feet)/i);
  result.guests ??= textPattern(html, /(?:sleeps|guests?[:\s]+)\s*(\d{1,2})/i);
  result.minStayNights ??= textPattern(html, /(?:minimum|min\.?)\s*(?:stay|term)[:\s]*(\d{1,3})\s*(?:night|day)/i);
  const minStayMonths = textPattern(html, /(?:minimum|min\.?)\s*(?:stay|term)[:\s]*(\d{1,2})\s*month/i);
  if (result.minStayNights == null && minStayMonths != null) result.minStayNights = minStayMonths * 30;

  result.visibleMonthlyRate ??= textPattern(html, /\$\s*([\d,]{4,7})\s*(?:\/|per\s*)(?:month|mo\b)/i);
  result.visibleAdr ??= textPattern(html, /\$\s*([\d,]{2,5})\s*(?:\/|per\s*)(?:night|nt\b)/i);

  return result;
}

function listingSlugFromUrl(url: string): string {
  const match = LISTING_PATH_PATTERN.exec(new URL(url).pathname);
  return match?.[1] ?? new URL(url).pathname.replace(/\W+/g, "-").replace(/^-+|-+$/g, "");
}

function blockedToUnavailable(err: unknown): never {
  if (err instanceof FetchBlockedError) {
    throw new SourceUnavailableError("haus", err.message, false);
  }
  throw err;
}

export class HausAdapter implements PricingProviderAdapter {
  readonly source = "haus" as const;
  readonly enabled = true;
  get supportsDateQuotes(): boolean {
    return HAUS_QUOTE_ENDPOINT_TEMPLATE.length > 0;
  }

  async discoverListings(): Promise<DiscoveredListing[]> {
    const urls = new Set<string>();

    try {
      const searchPage = await politeFetch(new URL(HAUS_SEARCH_PATH, HAUS_BASE_URL).toString());
      for (const url of parseHausListingUrls(searchPage.text)) urls.add(url);
    } catch (err) {
      blockedToUnavailable(err);
    }

    // Sitemap is best-effort: discovery already worked if the search page parsed.
    try {
      const sitemap = await politeFetch(new URL("/sitemap.xml", HAUS_BASE_URL).toString());
      if (sitemap.status === 200) {
        for (const url of parseHausListingUrls(sitemap.text)) urls.add(url);
      }
    } catch {
      // Missing/blocked sitemap is not fatal.
    }

    if (urls.size === 0) {
      throw new SourceUnavailableError(
        "haus",
        "No listing URLs discovered from search page or sitemap — page structure may have changed.",
        true
      );
    }

    const now = new Date().toISOString();
    return [...urls].map((url) => ({
      source: "haus" as const,
      sourceListingId: listingSlugFromUrl(url),
      url,
      excludedFromComps: false,
      scrapeStatus: "discovered" as const,
      scrapeTimestamp: now,
    }));
  }

  async fetchListingMetadata(listing: DiscoveredListing): Promise<Partial<DiscoveredListing>> {
    let html: string;
    try {
      const page = await politeFetch(listing.url);
      if (page.status >= 400) {
        throw new SourceUnavailableError("haus", `Listing page ${listing.url} returned ${page.status}`, true);
      }
      html = page.text;
    } catch (err) {
      blockedToUnavailable(err);
    }

    const parsed = parseHausListingMetadata(html!);
    return {
      title: parsed.title,
      address: parsed.address,
      neighborhood: parsed.neighborhood,
      beds: parsed.beds,
      baths: parsed.baths,
      sqft: parsed.sqft,
      guests: parsed.guests,
      minStayNights: parsed.minStayNights,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      imageUrl: parsed.imageUrl,
      scrapeStatus: "metadata_collected",
      // Stash the visible pricing for the fallback observation pass.
      ...(parsed.visibleMonthlyRate != null || parsed.visibleAdr != null
        ? {
            visiblePricing: {
              monthlyRate: parsed.visibleMonthlyRate,
              adr: parsed.visibleAdr,
            },
          }
        : {}),
    } as Partial<DiscoveredListing> & {
      visiblePricing?: { monthlyRate: number | null; adr: number | null };
    };
  }

  async fetchQuote(listing: CompetitorListing, quoteSpec: QuoteSpec): Promise<ObservationDraft> {
    if (!this.supportsDateQuotes) {
      throw new SourceUnavailableError(
        "haus",
        "Haus date-entry quote endpoint not configured (HAUS_QUOTE_ENDPOINT); using visible-price fallback.",
        true
      );
    }
    const quoteUrl = HAUS_QUOTE_ENDPOINT_TEMPLATE
      .replaceAll("{listingId}", encodeURIComponent(listing.sourceListingId))
      .replaceAll("{checkIn}", quoteSpec.checkIn)
      .replaceAll("{checkOut}", quoteSpec.checkOut)
      .replaceAll("{guests}", String(quoteSpec.guests));
    try {
      const response = await politeFetch(quoteUrl);
      if (response.status >= 400) {
        throw new SourceUnavailableError("haus", `Quote endpoint returned ${response.status}`, true);
      }
      const payload: unknown = JSON.parse(response.text);
      return this.normalizeQuote(payload, listing, quoteSpec);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new SourceUnavailableError("haus", "Quote endpoint did not return JSON.", true);
      }
      blockedToUnavailable(err);
    }
  }

  normalizeQuote(rawQuote: unknown, listing: CompetitorListing, quoteSpec: QuoteSpec): ObservationDraft {
    const record = (rawQuote ?? {}) as Record<string, unknown>;
    const line: RawQuoteLineItems = {
      accommodationSubtotal: toNumberLoose(
        record.accommodationSubtotal ?? record.subtotal ?? record.rent ?? record.accommodation
      ),
      accommodationSubtotalBeforeDiscount: toNumberLoose(record.subtotalBeforeDiscount ?? record.originalSubtotal),
      discountAmount: toNumberLoose(record.discount ?? record.discountAmount),
      discountLabels: typeof record.discountLabel === "string" ? [record.discountLabel] : null,
      cleaningFee: toNumberLoose(record.cleaningFee),
      serviceFee: toNumberLoose(record.serviceFee),
      taxes: toNumberLoose(record.taxes ?? record.tax),
      otherFees: toNumberLoose(record.otherFees),
      displayedAdr: toNumberLoose(record.nightlyRate ?? record.adr),
      displayedMonthlyRate: toNumberLoose(record.monthlyRate),
      available: typeof record.available === "boolean" ? record.available : null,
      rawText: null,
    };
    const draft = normalizeQuote({
      listingId: listing.id,
      listingUrl: listing.url,
      source: "haus",
      quoteSpec,
      line,
    });
    return { ...draft, rawText: JSON.stringify(rawQuote).slice(0, 4000) };
  }
}
