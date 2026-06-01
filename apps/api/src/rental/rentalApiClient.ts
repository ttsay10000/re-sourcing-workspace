/**
 * Rental data via RapidAPI GET rentals/url.
 * Builds StreetEasy building URL from canonical address, probes units 1-10, 1A-6C, A-L, GARDEN, DUPLEX, PARLOR, GROUND.
 */

import type { RentalUnitRow, RentalFinancials } from "@re-sourcing/contracts";
import { addressToStreeteasyBuildingSlug, buildStreeteasyBuildingUrl } from "./addressToSlug.js";

const RENTALS_URL_ENDPOINT = "https://nyc-real-estate-api.p.rapidapi.com/rentals/url";
const RENTALS_SEARCH_ENDPOINT = "https://nyc-real-estate-api.p.rapidapi.com/rentals/search";
const HOST = "nyc-real-estate-api.p.rapidapi.com";

/** Default areas for search fallback. Override with RENTAL_SEARCH_AREAS if a run should be tighter. */
const DEFAULT_SEARCH_AREAS = [
  "all-downtown",
  "all-midtown",
  "all-upper-east-side",
  "all-upper-west-side",
  "all-upper-manhattan",
].join(",");
const SEARCH_FALLBACK_LIMIT = Number(process.env.RENTAL_SEARCH_FALLBACK_LIMIT || 50);
const SEARCH_FALLBACK_ENABLED = process.env.RENTAL_SEARCH_FALLBACK !== "0";
const RENTAL_REQUEST_DELAY_MS =
  Number(process.env.RAPIDAPI_RENTAL_REQUEST_DELAY_MS || process.env.RENTAL_API_REQUEST_DELAY_MS) || 250;
const RENTAL_RATE_LIMIT_RETRY_MS =
  Number(process.env.RAPIDAPI_RENTAL_RATE_LIMIT_RETRY_MS || process.env.RENTAL_API_RATE_LIMIT_RETRY_MS) ||
  Math.max(1500, RENTAL_REQUEST_DELAY_MS * 4);

const RENTAL_UNIT_SUFFIXES: string[] = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "1A", "1B", "1C", "2A", "2B", "2C", "3A", "3B", "3C",
  "4A", "4B", "4C", "5A", "5B", "5C", "6A", "6B", "6C",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
  "GARDEN", "DUPLEX", "PARLOR", "GROUND",
];

function getApiKey(): string {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    throw new Error("RAPIDAPI_KEY environment variable is required for rental API.");
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    "x-rapidapi-host": HOST,
    "x-rapidapi-key": getApiKey(),
  };
}

const RENTAL_TIMEOUT_MS = Number(process.env.RAPIDAPI_RENTAL_TIMEOUT_MS || 10000);
const RENTAL_DEBUG = process.env.RENTAL_DEBUG === "1" || process.env.RENTAL_DEBUG === "true";
let lastRentalApiRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRentalApiSlot(): Promise<void> {
  if (RENTAL_REQUEST_DELAY_MS <= 0) return;
  const now = Date.now();
  const waitMs = Math.max(0, lastRentalApiRequestAt + RENTAL_REQUEST_DELAY_MS - now);
  if (waitMs > 0) await sleep(waitMs);
  lastRentalApiRequestAt = Date.now();
}

/** Log API error for debugging (404 = "Requested listing id not found" common for older/off-market building URLs). */
function logRentalApiError(streeteasyUrl: string, status: number, body: string): void {
  if (!RENTAL_DEBUG && status === 404) return;
  const preview = body.slice(0, 80).replace(/\n/g, " ");
  console.warn(`[rental] ${status} for ${streeteasyUrl.slice(0, 60)}… — ${preview}`);
}

function rentalApiErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRentalApiAccessError(error: unknown): boolean {
  const message = rentalApiErrorMessage(error);
  return /\b(401|403|429)\b|not subscribed|too many requests|rate limit|unauthorized/i.test(message);
}

function normalizeRentalApiAccessError(error: unknown, context: string): Error {
  const message = rentalApiErrorMessage(error);
  if (/not subscribed|403/i.test(message)) {
    return new Error(`RapidAPI rental ${context} is not available for this key or subscription.`);
  }
  if (/too many requests|429|rate limit/i.test(message)) {
    return new Error(`RapidAPI rental ${context} is rate-limited right now. Try again after the API window resets.`);
  }
  if (/unauthorized|401/i.test(message)) {
    return new Error(`RapidAPI rental ${context} rejected the configured API key.`);
  }
  return new Error(message || `RapidAPI rental ${context} failed.`);
}

/** GET rental details by StreetEasy building URL or listing URL. Returns null on 404, error, or empty. */
export async function fetchRentalByUrl(streeteasyUrl: string): Promise<Record<string, unknown> | null> {
  const url = new URL(RENTALS_URL_ENDPOINT);
  url.searchParams.set("url", streeteasyUrl);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RENTAL_TIMEOUT_MS);
    try {
      await waitForRentalApiSlot();
      const res = await fetch(url.toString(), {
        headers: headers(),
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await res.text();
      clearTimeout(timeout);
      if (!res.ok) {
        logRentalApiError(streeteasyUrl, res.status, text);
        if (res.status === 429 && attempt === 0) {
          await sleep(RENTAL_RATE_LIMIT_RETRY_MS);
          continue;
        }
        if (res.status === 404 || res.status >= 500) return null;
        throw new Error(`Rental API error ${res.status}: ${text || res.statusText}`);
      }
      let data: unknown;
      try {
        data = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        logRentalApiError(streeteasyUrl, res.status, text);
        return null;
      }
      return unwrapRentalApiResponse(data);
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch"))) {
        if (RENTAL_DEBUG) console.warn(`[rental] timeout or fetch error for ${streeteasyUrl.slice(0, 50)}…`);
        return null;
      }
      throw err;
    }
  }
  return null;
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasRentalListingShape(value: Record<string, unknown>): boolean {
  return [
    "address",
    "price",
    "rent",
    "list_price",
    "rental_price",
    "monthly_rent",
    "bedrooms",
    "beds",
    "bathrooms",
    "baths",
    "sqft",
    "square_feet",
    "status",
    "images",
    "photos",
  ].some((key) => value[key] != null);
}

export function unwrapRentalApiResponse(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const firstListing = data.find((item): item is Record<string, unknown> => isRecord(item) && hasRentalListingShape(item));
    return firstListing ?? (isRecord(data[0]) ? data[0] : null);
  }
  if (!isRecord(data)) return null;
  let current: Record<string, unknown> = data;
  for (let i = 0; i < 8; i++) {
    if (hasRentalListingShape(current)) return current;
    const next = ["data", "rental", "result", "listing", "property"].find((key) => {
      const inner = current[key];
      return isRecord(inner) || Array.isArray(inner);
    });
    if (!next) break;
    const inner = current[next];
    if (Array.isArray(inner)) {
      const firstListing = inner.find((item): item is Record<string, unknown> => isRecord(item) && hasRentalListingShape(item));
      return firstListing ?? (isRecord(inner[0]) ? inner[0] : null);
    }
    current = inner as Record<string, unknown>;
  }
  return current;
}

/**
 * Map API response to RentalUnitRow.
 * Per Get Rental By URL docs (streeteasy.gitbook.io): price = current ask when status "open", last rent when status "sold"/closed.
 * streeteasyUrl: the Streeteasy listing URL used to fetch this unit (for linking Unit #N → listing).
 */
export function mapApiResponseToRentalUnitRow(raw: Record<string, unknown>, unit: string, streeteasyUrl?: string | null): RentalUnitRow {
  const price = raw.price ?? raw.rent ?? raw.list_price ?? raw.rental_price ?? raw.monthly_rent;
  const beds = raw.bedrooms ?? raw.beds ?? raw.bed;
  const baths = raw.bathrooms ?? raw.baths ?? raw.bath;
  const sqft = raw.square_feet ?? raw.sqft ?? raw.sqft_feet ?? raw.area;
  const listedDate =
    raw.listedAt ??
    raw.listed_at ??
    raw.list_date ??
    raw.available_date ??
    raw.date ??
    raw.listed_date ??
    raw.list_date_iso;
  const lastRented =
    raw.closedAt ??
    raw.last_rented ??
    raw.last_rented_date ??
    raw.last_rented_at ??
    raw.lease_end ??
    raw.last_leased ??
    raw.last_lease_date ??
    raw.rented_at ??
    raw.date_last_rented ??
    raw.closed_at ??
    raw.availableFrom;
  const status = raw.status != null ? parseStr(raw.status) : null;
  const imagesRaw = raw.images ?? raw.photos ?? raw.photos_list;
  const images =
    Array.isArray(imagesRaw) && imagesRaw.length > 0
      ? (imagesRaw as unknown[]).filter((u): u is string => typeof u === "string")
      : null;
  return {
    unit,
    rentalPrice: parseNum(price),
    status,
    sqft: parseNum(sqft),
    listedDate: parseStr(listedDate),
    lastRentedDate: parseStr(lastRented),
    beds: parseNum(beds),
    baths: parseNum(baths),
    images: images && images.length > 0 ? images : null,
    source: "rapidapi",
    streeteasyUrl: streeteasyUrl && String(streeteasyUrl).trim() ? String(streeteasyUrl).trim() : null,
  };
}

interface RentalSearchListing {
  id: string;
  price: number;
  url: string;
  address?: string | null;
}

function readFirstString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readFirstNumber(raw: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = parseNum(raw[key]);
    if (value != null) return value;
  }
  return 0;
}

function collectSearchObjects(data: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6) return [];
  if (Array.isArray(data)) return data.flatMap((item) => collectSearchObjects(item, depth + 1));
  if (!isRecord(data)) return [];

  const hasUrlishField =
    readFirstString(data, ["url", "listingUrl", "listing_url", "streeteasyUrl", "streeteasy_url", "permalink", "webUrl", "web_url"]) != null ||
    data.id != null ||
    data.listing_id != null;
  const direct = hasUrlishField ? [data] : [];
  const nestedKeys = ["listings", "results", "rentals", "items", "properties", "data", "response"];
  const nested = nestedKeys.flatMap((key) => collectSearchObjects(data[key], depth + 1));
  return [...direct, ...nested];
}

export function mapRentalsSearchResponse(data: unknown): RentalSearchListing[] {
  const seen = new Set<string>();
  const listings: RentalSearchListing[] = [];
  for (const raw of collectSearchObjects(data)) {
    const id = readFirstString(raw, ["id", "listing_id", "listingId"]) ?? "";
    const rawUrl = readFirstString(raw, ["url", "listingUrl", "listing_url", "streeteasyUrl", "streeteasy_url", "permalink", "webUrl", "web_url"]);
    const url = rawUrl && rawUrl.includes("streeteasy")
      ? rawUrl
      : id
        ? `https://www.streeteasy.com/rental/${id}`
        : "";
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push({
      id,
      price: readFirstNumber(raw, ["price", "rent", "rental_price", "monthly_rent", "list_price"]),
      url,
      address: readFirstString(raw, ["address", "addr", "display_address", "formattedAddress", "formatted_address"]),
    });
  }
  return listings;
}

export function rentalSearchAreasForAddress(_canonicalAddress?: string): string {
  return process.env.RENTAL_SEARCH_AREAS?.trim() || DEFAULT_SEARCH_AREAS;
}

/** GET rentals/search returns listings with id, price, url (e.g. https://www.streeteasy.com/rental/4631921). */
async function fetchRentalsSearch(areas: string, limit: number): Promise<RentalSearchListing[]> {
  const url = new URL(RENTALS_SEARCH_ENDPOINT);
  url.searchParams.set("areas", areas);
  url.searchParams.set("limit", String(Math.min(limit, 500)));
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForRentalApiSlot();
    const res = await fetch(url.toString(), { headers: headers(), redirect: "follow" });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429 && attempt === 0) {
        await sleep(RENTAL_RATE_LIMIT_RETRY_MS);
        continue;
      }
      if (res.status === 404) return [];
      throw new Error(`Rental search API error ${res.status}: ${text || res.statusText}`);
    }
    const data = text ? (JSON.parse(text) as unknown) : null;
    return mapRentalsSearchResponse(data);
  }
  return [];
}

/** True if API address (e.g. "241 Washington Place #2") matches our street number and street name. */
export function addressMatches(apiAddress: string | null | undefined, ourAddressLine: string): boolean {
  if (!apiAddress || !ourAddressLine) return false;
  const a = normalizeAddressForMatch(apiAddress);
  const ours = normalizeAddressForMatch(ourAddressLine);
  const numMatch = ours.match(/^\d+/);
  const streetNum = numMatch ? numMatch[0] : "";
  if (!streetNum) return a.includes(ours) || ours.includes(a);
  const apiTokens = new Set(a.split(" ").filter(Boolean));
  if (!apiTokens.has(streetNum)) return false;
  const suffixes = new Set(["street", "avenue", "place", "road", "boulevard", "drive", "lane", "terrace", "court"]);
  const requiredTokens = ours
    .slice(streetNum.length)
    .trim()
    .split(/\s+/)
    .filter((token) => token && !suffixes.has(token));
  return requiredTokens.length === 0 ? a.includes(ours) : requiredTokens.every((token) => apiTokens.has(token));
}

const ORDINAL_WORDS: Record<string, string> = {
  first: "1",
  second: "2",
  third: "3",
  fourth: "4",
  fifth: "5",
  sixth: "6",
  seventh: "7",
  eighth: "8",
  ninth: "9",
  tenth: "10",
  eleventh: "11",
  twelfth: "12",
};

function normalizeAddressForMatch(value: string): string {
  let out = value
    .toLowerCase()
    .replace(/#/g, " ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/[.,]/g, " ")
    .replace(/\b(w|w\.)\b/g, "west")
    .replace(/\b(e|e\.)\b/g, "east")
    .replace(/\b(n|n\.)\b/g, "north")
    .replace(/\b(s|s\.)\b/g, "south")
    .replace(/\b(st|st\.)\b/g, "street")
    .replace(/\b(ave|ave\.)\b/g, "avenue")
    .replace(/\b(pl|pl\.)\b/g, "place")
    .replace(/\b(rd|rd\.)\b/g, "road")
    .replace(/\b(blvd|blvd\.)\b/g, "boulevard")
    .replace(/\b(dr|dr\.)\b/g, "drive")
    .replace(/\b(ln|ln\.)\b/g, "lane")
    .replace(/\b(ter|terr|ter\.|terr\.)\b/g, "terrace")
    .replace(/\b(ct|ct\.)\b/g, "court");
  for (const [word, number] of Object.entries(ORDINAL_WORDS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, "g"), number);
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Fetch rental data for a building by probing unit URLs.
 * If building probe returns no/few units, fallback: GET rentals/search by area, then GET rentals/url for each listing and match by address.
 */
export async function fetchRentalsForAddress(canonicalAddress: string): Promise<RentalUnitRow[]> {
  const addressLine = (canonicalAddress ?? "").split(",")[0]?.trim() || canonicalAddress.trim();
  const slug = addressToStreeteasyBuildingSlug(addressLine);
  const units: RentalUnitRow[] = [];
  const seenKeys = new Set<string>();

  if (slug && slug !== "new_york") {
    for (const unitSuffix of RENTAL_UNIT_SUFFIXES) {
      const buildingUrl = buildStreeteasyBuildingUrl(slug, unitSuffix);
      let raw: Record<string, unknown> | null;
      try {
        raw = await fetchRentalByUrl(buildingUrl);
      } catch (error) {
        if (isRentalApiAccessError(error)) {
          const normalized = normalizeRentalApiAccessError(error, "URL lookup");
          console.warn(`[rental] ${normalized.message}`);
          if (units.length > 0) break;
          throw normalized;
        }
        throw error;
      }
      if (raw && Object.keys(raw).length > 0) {
        const row = mapApiResponseToRentalUnitRow(raw, unitSuffix, buildingUrl);
        const key = `${row.unit}-${row.rentalPrice ?? 0}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          units.push(row);
        }
      }
    }
  }

  if (SEARCH_FALLBACK_ENABLED && units.length < 3) {
    let listings: RentalSearchListing[];
    try {
      listings = await fetchRentalsSearch(rentalSearchAreasForAddress(canonicalAddress), SEARCH_FALLBACK_LIMIT);
    } catch (error) {
      const normalized = isRentalApiAccessError(error)
        ? normalizeRentalApiAccessError(error, "search fallback")
        : new Error(rentalApiErrorMessage(error));
      console.warn(`[rental] ${normalized.message}`);
      if (units.length > 0) return units;
      throw normalized;
    }
    for (const list of listings) {
      if (!list.url) continue;
      let raw: Record<string, unknown> | null;
      try {
        raw = await fetchRentalByUrl(list.url);
      } catch (error) {
        if (isRentalApiAccessError(error)) {
          const normalized = normalizeRentalApiAccessError(error, "listing lookup");
          console.warn(`[rental] ${normalized.message}`);
          if (units.length > 0) break;
          throw normalized;
        }
        throw error;
      }
      const rawAddress = String(raw?.address ?? list.address ?? "");
      if (!raw || !addressMatches(rawAddress, addressLine)) continue;
      const addrStr = rawAddress;
      const sharp = addrStr.match(/#\s*(\S+)/);
      const unitLabel = sharp ? sharp[1] ?? list.id : list.id;
      const row = mapApiResponseToRentalUnitRow(raw, unitLabel, list.url);
      const key = `${row.unit}-${row.rentalPrice ?? 0}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        units.push(row);
      }
    }
  }

  return units;
}

/**
 * Run rental flow (step 1): fetch rentals for address and return RentalFinancials to merge into property.details.
 */
export async function runRentalApiStep(canonicalAddress: string): Promise<Partial<RentalFinancials>> {
  const rentalUnits = await fetchRentalsForAddress(canonicalAddress);
  return {
    rentalUnits: rentalUnits.length > 0 ? rentalUnits : null,
    source: rentalUnits.length > 0 ? "rapidapi" : null,
    lastUpdatedAt: new Date().toISOString(),
  };
}
