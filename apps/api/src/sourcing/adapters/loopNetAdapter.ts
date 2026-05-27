import type { ListingNormalized } from "@re-sourcing/contracts";
import type { SourceAdapter, SourceAdapterRunBody } from "./types.js";

const BASE_URL = "https://www.loopnet.com";
const MAX_MANUAL_URLS = 5;
const LOOPNET_FETCH_TIMEOUT_MS = Number(process.env.LOOPNET_FETCH_TIMEOUT_MS || 15_000);
const LOOPNET_MAX_HTML_BYTES = Number(process.env.LOOPNET_MAX_HTML_BYTES || 3_000_000);

type LoopNetExtractionStatus = "extracted" | "partial" | "blocked" | "failed" | "scaffold";

interface FetchHtmlResult {
  ok: boolean;
  status: number | null;
  statusText: string | null;
  contentType: string | null;
  html: string | null;
  finalUrl: string;
  blockedReason?: string;
  error?: string;
}

export interface LoopNetCriteria extends Record<string, unknown> {
  location: string;
  propertyType: "multifamily";
  listingType: "for-sale";
  minPrice?: number;
  maxPrice?: number;
  minSqft?: number;
  maxSqft?: number;
  limit: number;
  manualUrls: string[];
  searchUrl: string;
}

export function normalizeLoopNetLocation(location: string): string {
  return location
    .trim()
    .replace(/,/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildLoopNetSearchUrl(criteria: {
  location: string;
  minPrice?: number;
  maxPrice?: number;
  minSqft?: number;
  maxSqft?: number;
}): string {
  const slug = normalizeLoopNetLocation(criteria.location || "New York, NY") || "new-york-ny";
  const params = new URLSearchParams();
  if (criteria.minPrice != null) params.set("min-price", String(criteria.minPrice));
  if (criteria.maxPrice != null) params.set("max-price", String(criteria.maxPrice));
  if (criteria.minSqft != null) params.set("min-size", String(criteria.minSqft));
  if (criteria.maxSqft != null) params.set("max-size", String(criteria.maxSqft));
  const query = params.toString();
  return `${BASE_URL}/search/apartment-buildings/${slug}/for-sale/${query ? `?${query}` : ""}`;
}

export function extractLoopNetListingId(url: string): string | null {
  const match = /\/(\d[\d-]*)\/?$/.exec(url.trim().replace(/\/+$/, ""));
  return match?.[1] ?? null;
}

export function isLoopNetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "loopnet.com" || parsed.hostname.endsWith(".loopnet.com");
  } catch {
    return false;
  }
}

function cleanManualUrls(body: SourceAdapterRunBody): string[] {
  const urls = [
    ...(Array.isArray(body.manualUrls) ? body.manualUrls : []),
    ...(typeof body.manualUrl === "string" ? [body.manualUrl] : []),
  ];
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean).filter(isLoopNetUrl))].slice(0, MAX_MANUAL_URLS);
}

function parseMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== "string") return 0;
  const normalized = value.toLowerCase();
  if (normalized.includes("request") || normalized.includes("negotiable") || normalized.includes("/")) return 0;
  const multiplier = normalized.includes("million") || /\d\s*m\b/i.test(value) ? 1_000_000 : 1;
  const parsed = Number(value.replace(/[$,\s]/g, "").replace(/million|m\b/i, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * multiplier) : 0;
}

function parseSqft(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== "string") return null;
  const match = /([\d,]+)/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,%/a-z\s]/gi, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed == null ? null : Math.round(parsed);
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/dt|\/dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function htmlLines(html: string): string[] {
  return stripTags(html)
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function absoluteUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(decodeHtmlEntities(href), baseUrl).toString();
  } catch {
    return null;
  }
}

function getMetaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const metaPattern = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']*)["'])[^>]*>`, "i");
  const match = metaPattern.exec(html);
  return match?.[1] ? cleanText(match[1]) : null;
}

function getTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? cleanText(stripTags(match[1])) : null;
}

function parseJsonLdScripts(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html)) != null) {
    const raw = decodeHtmlEntities(match[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      collectJsonLdObjects(parsed, out);
    } catch {
      // Ignore malformed embedded JSON and continue with meta/tag extraction.
    }
  }
  return out;
}

function collectJsonLdObjects(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdObjects(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  out.push(obj);
  const graph = obj["@graph"];
  if (Array.isArray(graph)) collectJsonLdObjects(graph, out);
}

function extractSchemaAddress(objects: Record<string, unknown>[]): Record<string, string | null> {
  for (const obj of objects) {
    const address = obj.address;
    if (typeof address === "string") return splitAddress(address);
    if (address && typeof address === "object") {
      const a = address as Record<string, unknown>;
      return {
        address: stringOrNull(a.streetAddress) ?? stringOrNull(a.name),
        city: stringOrNull(a.addressLocality),
        state: stringOrNull(a.addressRegion),
        zip: stringOrNull(a.postalCode),
      };
    }
  }
  return {};
}

function extractSchemaImages(objects: Record<string, unknown>[]): string[] {
  const values: string[] = [];
  for (const obj of objects) {
    const image = obj.image ?? obj.photo;
    if (typeof image === "string") values.push(image);
    else if (Array.isArray(image)) {
      for (const item of image) {
        if (typeof item === "string") values.push(item);
        else if (item && typeof item === "object") {
          const url = (item as Record<string, unknown>).url ?? (item as Record<string, unknown>).contentUrl;
          if (typeof url === "string") values.push(url);
        }
      }
    } else if (image && typeof image === "object") {
      const url = (image as Record<string, unknown>).url ?? (image as Record<string, unknown>).contentUrl;
      if (typeof url === "string") values.push(url);
    }
  }
  return uniqueStrings(values);
}

function extractSchemaPrice(objects: Record<string, unknown>[]): unknown {
  for (const obj of objects) {
    const offers = obj.offers;
    if (offers && typeof offers === "object") {
      const offer = Array.isArray(offers) ? offers[0] : offers;
      if (offer && typeof offer === "object") {
        const price = (offer as Record<string, unknown>).price ?? (offer as Record<string, unknown>).lowPrice;
        if (price != null) return price;
      }
    }
    if (obj.price != null) return obj.price;
  }
  return null;
}

function extractSchemaGeo(objects: Record<string, unknown>[]): { lat?: number | null; lon?: number | null } {
  for (const obj of objects) {
    const geo = obj.geo;
    if (!geo || typeof geo !== "object") continue;
    const g = geo as Record<string, unknown>;
    const lat = numberOrNull(g.latitude ?? g.lat);
    const lon = numberOrNull(g.longitude ?? g.lon);
    if (lat != null || lon != null) return { lat, lon };
  }
  return {};
}

function findLineValue(lines: string[], labels: string[]): string | null {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/:$/, "").toLowerCase();
    const label = normalizedLabels.find((candidate) => line === candidate || line.endsWith(candidate));
    if (!label) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const next = lines[j]!;
      if (next && !normalizedLabels.includes(next.toLowerCase().replace(/:$/, ""))) return next;
    }
  }
  return null;
}

function findInlineValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*:?\\s*([^\\n|]{1,120})`, "i").exec(text);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function findSpec(html: string, labels: string[]): string | null {
  const lines = htmlLines(html);
  return findLineValue(lines, labels) ?? findInlineValue(stripTags(html), labels);
}

function splitAddress(value: string): Record<string, string | null> {
  const cleaned = cleanText(value);
  const comma = /^(.*?),\s*([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i.exec(cleaned);
  if (comma) {
    return {
      address: cleanText(comma[1] ?? ""),
      city: cleanText(comma[2] ?? ""),
      state: cleanText(comma[3] ?? "").toUpperCase(),
      zip: comma[4] ?? null,
    };
  }
  const noComma = /^(.*?\b(?:st|street|ave|avenue|road|rd|place|pl|blvd|boulevard|dr|drive|ln|lane|way)\b)\s+([^,]+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i.exec(cleaned);
  if (noComma) {
    return {
      address: cleanText(noComma[1] ?? ""),
      city: cleanText(noComma[2] ?? ""),
      state: cleanText(noComma[3] ?? "").toUpperCase(),
      zip: noComma[4] ?? null,
    };
  }
  return { address: cleaned, city: null, state: null, zip: null };
}

function titleCaseAddressSlug(slug: string): string {
  const directionAbbreviations = new Set(["e", "w", "n", "s", "ne", "nw", "se", "sw", "ny"]);
  const streetSuffixes: Record<string, string> = { st: "St", ave: "Ave", rd: "Rd", pl: "Pl" };
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (/^\d+(?:st|nd|rd|th)?$/i.test(part)) return part.toLowerCase();
      if (directionAbbreviations.has(lower)) return lower.toUpperCase();
      if (streetSuffixes[lower]) return streetSuffixes[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function addressFromLoopNetUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = /\/Listing\/([^/]+)\/\d+/i.exec(parsed.pathname);
    if (!match?.[1]) return null;
    const withoutLocation = match[1]
      .replace(/-new-york-ny$/i, "")
      .replace(/-manhattan-ny$/i, "")
      .replace(/-brooklyn-ny$/i, "")
      .replace(/-queens-ny$/i, "")
      .replace(/-bronx-ny$/i, "")
      .replace(/-staten-island-ny$/i, "");
    return titleCaseAddressSlug(withoutLocation);
  } catch {
    return null;
  }
}

function extractAnchors(html: string, baseUrl: string): Array<{ url: string; label: string }> {
  const anchors: Array<{ url: string; label: string }> = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) != null) {
    const url = match[1] ? absoluteUrl(match[1], baseUrl) : null;
    if (!url) continue;
    const label = cleanText(stripTags(match[2] ?? ""));
    anchors.push({ url, label });
  }
  return anchors;
}

function extractLoopNetAttachments(html: string, url: string): Record<string, unknown>[] {
  return extractAnchors(html, url)
    .filter((anchor) => /offering memorandum|\bom\b|brochure|flyer|package|attachment|download|\.pdf/i.test(`${anchor.label} ${anchor.url}`))
    .map((anchor) => {
      const isPdf = /\.pdf(?:[?#]|$)/i.test(anchor.url);
      return {
        source: "loopnet",
        kind: /offering memorandum|\bom\b/i.test(anchor.label) ? "offering_memorandum" : "listing_attachment",
        label: anchor.label || (isPdf ? "PDF attachment" : "Listing attachment"),
        url: anchor.url,
        downloadableWithoutAuth: isPdf,
        requiresManualAuth: false,
        handoffStatus: isPdf ? "ready_for_document_import" : "manual_review_required",
      };
    });
}

function extractBrokerContact(html: string): Record<string, unknown> {
  const text = stripTags(html);
  const mailMatch = /mailto:([^"'>\s?]+)/i.exec(html);
  const phoneMatch = /tel:([^"'>\s]+)/i.exec(html) ?? /(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/.exec(text);
  const brokerName =
    findSpec(html, ["Listing Broker", "Broker", "Contact", "Presented By"])
    ?? null;
  return {
    broker_name: brokerName,
    broker_email: mailMatch?.[1] ? decodeURIComponent(mailMatch[1]) : null,
    broker_phone: phoneMatch?.[1] ? cleanText(phoneMatch[1]) : null,
  };
}

function isLikelyBlockedHtml(html: string): string | null {
  const text = stripTags(html).toLowerCase();
  if (/access denied|permission to access|akamai|captcha|verify you are human|unusual traffic|bot detection/.test(text)) {
    return "Source returned an access-denied, CAPTCHA, or bot-protection page.";
  }
  return null;
}

async function fetchLoopNetHtml(url: string): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOPNET_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; RE-Sourcing-Flow/1.0; +manual-link-ingestion)",
      },
    });
    const contentType = response.headers.get("content-type");
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > LOOPNET_MAX_HTML_BYTES) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        contentType,
        html: null,
        finalUrl: response.url || url,
        error: `LoopNet page is too large to ingest safely (${contentLength} bytes).`,
      };
    }
    const html = await response.text();
    const blockedReason = response.status === 401 || response.status === 403 ? `HTTP ${response.status} ${response.statusText}` : isLikelyBlockedHtml(html);
    return {
      ok: response.ok && !blockedReason,
      status: response.status,
      statusText: response.statusText,
      contentType,
      html,
      finalUrl: response.url || url,
      blockedReason: blockedReason ?? undefined,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: null,
      contentType: null,
      html: null,
      finalUrl: url,
      error: error instanceof Error && error.name === "AbortError"
        ? "Timed out fetching LoopNet listing HTML."
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function loopNetScaffold(url: string, status: LoopNetExtractionStatus, diagnostics?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: extractLoopNetListingId(url),
    url,
    _fetchUrl: url,
    name: addressFromLoopNetUrl(url) ?? "LoopNet manual listing",
    address: addressFromLoopNetUrl(url),
    city: "New York",
    state: "NY",
    property_type: "multifamily",
    listing_type: "for-sale",
    ingestionMode: "manual_url",
    extractionStatus: status,
    extractionDiagnostics: diagnostics ?? null,
  };
}

export function extractLoopNetDetailsFromHtml(html: string, url: string): Record<string, unknown> {
  const jsonLd = parseJsonLdScripts(html);
  const schemaAddress = extractSchemaAddress(jsonLd);
  const metaTitle = getMetaContent(html, "og:title") ?? getTitle(html);
  const description =
    getMetaContent(html, "og:description")
    ?? getMetaContent(html, "description")
    ?? findSpec(html, ["Description", "Property Description", "Executive Summary"]);
  const addressText =
    schemaAddress.address
    ?? findSpec(html, ["Address"])
    ?? (metaTitle?.includes(",") ? splitAddress(metaTitle).address : null)
    ?? addressFromLoopNetUrl(url);
  const split = addressText ? splitAddress(addressText) : {};
  const images = uniqueStrings([
    getMetaContent(html, "og:image"),
    ...extractSchemaImages(jsonLd),
    ...Array.from(html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi))
      .map((match) => match[1] ? absoluteUrl(match[1], url) : null),
  ]).filter((imageUrl) => !/logo|icon|sprite/i.test(imageUrl));
  const attachments = extractLoopNetAttachments(html, url);
  const broker = extractBrokerContact(html);
  const geo = extractSchemaGeo(jsonLd);
  const text = stripTags(html);
  const raw: Record<string, unknown> = {
    id: extractLoopNetListingId(url),
    url,
    _fetchUrl: url,
    name: metaTitle?.replace(/\s+\|\s+LoopNet.*$/i, "") ?? addressText ?? addressFromLoopNetUrl(url),
    title: metaTitle,
    address: split.address ?? schemaAddress.address ?? addressText ?? addressFromLoopNetUrl(url),
    city: schemaAddress.city ?? split.city ?? (/\bNew York\b/i.test(text) ? "New York" : null),
    state: schemaAddress.state ?? split.state ?? (/\bNY\b/i.test(text) ? "NY" : null),
    zip_code: schemaAddress.zip ?? split.zip,
    price: extractSchemaPrice(jsonLd) ?? findSpec(html, ["Price", "Sale Price", "Asking Price"]),
    description,
    images,
    latitude: geo.lat,
    longitude: geo.lon,
    property_type: findSpec(html, ["Property Type", "Property Subtype"]) ?? "multifamily",
    property_subtype: findSpec(html, ["Property Subtype", "Subtype"]),
    listing_status: findSpec(html, ["Status", "Listing Status"]),
    listed_at: findSpec(html, ["Date Listed", "Listed"]),
    units: findSpec(html, ["Units", "No. Units", "Number of Units", "Unit Count"]),
    cap_rate: findSpec(html, ["Cap Rate"]),
    price_per_sqft: findSpec(html, ["Price/SF", "Price / SF", "Price/Gross SF", "Price Per SF"]),
    building_size: findSpec(html, ["Building Size", "Building Size SF", "Gross SF", "Rentable Building Area"]),
    lot_size: findSpec(html, ["Lot Size", "Land Area"]),
    zoning: findSpec(html, ["Zoning"]),
    year_built: findSpec(html, ["Year Built"]),
    apn: findSpec(html, ["APN", "Parcel Number", "Parcel ID"]),
    taxes: findSpec(html, ["Taxes", "Property Taxes"]),
    noi: findSpec(html, ["NOI", "Net Operating Income"]),
    attachments,
    attachmentHandoff: {
      source: "loopnet",
      publicDocumentsFound: attachments.filter((attachment) => attachment.downloadableWithoutAuth === true).length,
      status: attachments.length > 0 ? "ready_for_review" : "none_found",
      note: "Public PDF links are metadata handoffs for OM/document import; protected or non-PDF links require manual review.",
    },
    ...broker,
  };
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null && value !== undefined));
}

export function normalizeLoopNetPayload(raw: Record<string, unknown>, index: number): ListingNormalized {
  const url = stringOrNull(raw._fetchUrl) ?? stringOrNull(raw.url) ?? "#";
  const listingId = stringOrNull(raw.id) ?? stringOrNull(raw.listing_id) ?? extractLoopNetListingId(url) ?? `manual-${index}`;
  const name = stringOrNull(raw.name) ?? stringOrNull(raw.title);
  const address = stringOrNull(raw.address) ?? name ?? "LoopNet listing";
  const city = stringOrNull(raw.city) ?? "New York";
  const state = stringOrNull(raw.state) ?? "NY";
  const zip = stringOrNull(raw.zip_code) ?? stringOrNull(raw.zip) ?? "";
  const brokerName = stringOrNull(raw.broker_name) ?? stringOrNull(raw.brokerName);
  const brokerCompany = stringOrNull(raw.broker_company) ?? stringOrNull(raw.brokerCompany);
  const brokerPhone = stringOrNull(raw.broker_phone) ?? stringOrNull(raw.brokerPhone);
  const brokerEmail = stringOrNull(raw.broker_email) ?? stringOrNull(raw.brokerEmail);
  const images = Array.isArray(raw.images)
    ? raw.images.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : stringOrNull(raw.image_url)
      ? [stringOrNull(raw.image_url)!]
      : null;
  const rest = { ...raw };
  delete rest._fetchUrl;
  const extra: Record<string, unknown> = {
    ...rest,
    sourceAdapter: "loopnet",
    sourceDisplayName: "LoopNet",
    propertyType: raw.property_type ?? "multifamily",
    propertySubtype: raw.property_subtype ?? null,
    listingType: raw.listing_type ?? "for-sale",
    units: integerOrNull(raw.units) ?? raw.units ?? null,
    capRate: raw.cap_rate ?? null,
    pricePerSqft: raw.price_per_sqft ?? null,
    lotSize: raw.lot_size ?? null,
    zoning: raw.zoning ?? null,
    apn: raw.apn ?? raw.parcel ?? null,
    taxes: raw.taxes ?? null,
    noi: raw.noi ?? null,
    yearBuilt: integerOrNull(raw.year_built) ?? raw.year_built ?? null,
    listingStatus: raw.listing_status ?? null,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    attachmentHandoff: raw.attachmentHandoff ?? null,
    extractionStatus: raw.extractionStatus ?? null,
    extractionDiagnostics: raw.extractionDiagnostics ?? null,
    brokerCompany,
  };
  const lat = numberOrNull(raw.latitude ?? raw.lat);
  const lon = numberOrNull(raw.longitude ?? raw.lon);

  return {
    source: "loopnet",
    externalId: `loopnet:${listingId}`,
    address,
    city,
    state,
    zip,
    price: parseMoney(raw.price),
    beds: integerOrNull(raw.beds) ?? 0,
    baths: integerOrNull(raw.baths) ?? 0,
    sqft: parseSqft(raw.size_sqft ?? raw.building_size_sqft ?? raw.building_size ?? raw.size),
    url,
    title: name,
    description: stringOrNull(raw.description),
    lat,
    lon,
    imageUrls: images,
    listedAt: stringOrNull(raw.listed_at) ?? stringOrNull(raw.listedAt),
    agentNames: brokerName ? [brokerName] : null,
    agentEnrichment: brokerName
      ? [{ name: brokerName, firm: brokerCompany, phone: brokerPhone, email: brokerEmail }]
      : null,
    extra,
  };
}

export const loopNetAdapter: SourceAdapter<LoopNetCriteria> = {
  id: "loopnet",
  displayName: "LoopNet",
  listingSource: "loopnet",
  capabilities: {
    manualSearch: true,
    savedSearch: false,
    manualUrlIngestion: true,
  },
  defaultEnabled: false,
  buildManualCriteria(body) {
    const location = body.location?.trim() || "New York, NY";
    const criteria: LoopNetCriteria = {
      location,
      propertyType: "multifamily",
      listingType: "for-sale",
      limit: Math.min(Math.max(Number(body.limit ?? MAX_MANUAL_URLS) || MAX_MANUAL_URLS, 1), MAX_MANUAL_URLS),
      manualUrls: cleanManualUrls(body),
      searchUrl: buildLoopNetSearchUrl({
        location,
        minPrice: body.minPrice ?? undefined,
        maxPrice: body.maxPrice ?? undefined,
        minSqft: body.minSqft ?? undefined,
        maxSqft: body.maxSqft ?? undefined,
      }),
    };
    if (body.minPrice != null) criteria.minPrice = Number(body.minPrice);
    if (body.maxPrice != null) criteria.maxPrice = Number(body.maxPrice);
    if (body.minSqft != null) criteria.minSqft = Number(body.minSqft);
    if (body.maxSqft != null) criteria.maxSqft = Number(body.maxSqft);
    return criteria;
  },
  async fetchSearch(criteria) {
    const warnings = [
      "LoopNet adapter is manual/on-demand only. Open the search URL, review results, then paste up to 5 listing URLs.",
    ];
    return {
      urls: criteria.manualUrls,
      metadata: {
        searchUrl: criteria.searchUrl,
        location: criteria.location,
        propertyType: criteria.propertyType,
        listingType: criteria.listingType,
        maxManualUrls: MAX_MANUAL_URLS,
      },
      warnings: criteria.manualUrls.length > 0 ? [] : warnings,
    };
  },
  async fetchDetailsByUrl(url) {
    if (!isLoopNetUrl(url)) throw new Error("LoopNet URL required.");
    const fetched = await fetchLoopNetHtml(url);
    if (!fetched.ok || !fetched.html) {
      return loopNetScaffold(url, fetched.blockedReason ? "blocked" : "failed", {
        httpStatus: fetched.status,
        statusText: fetched.statusText,
        contentType: fetched.contentType,
        finalUrl: fetched.finalUrl,
        blockedReason: fetched.blockedReason ?? null,
        error: fetched.error ?? null,
        note: "LoopNet did not expose unauthenticated HTML to this server. No CAPTCHA, paywall, or protected download bypass was attempted.",
      });
    }
    const extracted = extractLoopNetDetailsFromHtml(fetched.html, fetched.finalUrl || url);
    const hasCoreFields = Boolean(stringOrNull(extracted.address) || stringOrNull(extracted.price) || stringOrNull(extracted.description));
    return {
      ...loopNetScaffold(url, hasCoreFields ? "extracted" : "partial"),
      ...extracted,
      _fetchUrl: url,
      url: fetched.finalUrl || url,
      ingestionMode: "manual_url_html_extraction",
      extractionStatus: hasCoreFields ? "extracted" : "partial",
      extractionDiagnostics: {
        httpStatus: fetched.status,
        statusText: fetched.statusText,
        contentType: fetched.contentType,
        finalUrl: fetched.finalUrl,
      },
    };
  },
  normalize: normalizeLoopNetPayload,
  validateManualUrl: isLoopNetUrl,
};
