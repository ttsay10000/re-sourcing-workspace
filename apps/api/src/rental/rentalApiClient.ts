/**
 * Rental data via RapidAPI GET rentals/url.
 * Builds StreetEasy building URL from canonical address, probes units 1-10, 1A-6C, A-L, GARDEN, DUPLEX, PARLOR, GROUND.
 */

import type { RentalUnitRow, RentalFinancials } from "@re-sourcing/contracts";
import { addressToStreeteasyBuildingSlug, buildStreeteasyBuildingUrl } from "./addressToSlug.js";

const RENTALS_URL_ENDPOINT = "https://nyc-real-estate-api.p.rapidapi.com/rentals/url";
const RENTALS_SEARCH_ENDPOINT = "https://nyc-real-estate-api.p.rapidapi.com/rentals/search";
const HOST = "nyc-real-estate-api.p.rapidapi.com";

/** Default areas for search fallback (Manhattan downtown + midtown; expand if needed). */
const DEFAULT_SEARCH_AREAS = "all-downtown,all-midtown";
const SEARCH_FALLBACK_LIMIT = Number(process.env.RENTAL_SEARCH_FALLBACK_LIMIT || 50);

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

/** Log API error for debugging (404 = "Requested listing id not found" common for older/off-market building URLs). */
function logRentalApiError(streeteasyUrl: string, status: number, body: string): void {
  if (!RENTAL_DEBUG && status === 404) return;
  const preview = body.slice(0, 80).replace(/\n/g, " ");
  console.warn(`[rental] ${status} for ${streeteasyUrl.slice(0, 60)}… — ${preview}`);
}

/** GET rental details by StreetEasy building URL or listing URL. Returns null on 404, error, or empty. */
export async function fetchRentalByUrl(streeteasyUrl: string): Promise<Record<string, unknown> | null> {
  const url = new URL(RENTALS_URL_ENDPOINT);
  url.searchParams.set("url", streeteasyUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RENTAL_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: headers(),
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await res.text();
    clearTimeout(timeout);
    if (!res.ok) {
      logRentalApiError(streeteasyUrl, res.status, text);
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
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;
    for (const key of ["data", "rental", "result", "listing", "property"]) {
      const inner = obj[key];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
    }
    return obj;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch"))) {
      if (RENTAL_DEBUG) console.warn(`[rental] timeout or fetch error for ${streeteasyUrl.slice(0, 50)}…`);
      return null;
    }
    throw err;
  }
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

/** GET rentals/search returns listings with id, price, url (e.g. https://www.streeteasy.com/rental/4631921). */
async function fetchRentalsSearch(areas: string, limit: number): Promise<{ id: string; price: number; url: string }[]> {
  const url = new URL(RENTALS_SEARCH_ENDPOINT);
  url.searchParams.set("areas", areas);
  url.searchParams.set("limit", String(Math.min(limit, 500)));
  const res = await fetch(url.toString(), { headers: headers(), redirect: "follow" });
  if (!res.ok) return [];
  const data = (await res.json()) as { listings?: Array<{ id?: string; price?: number; url?: string }> };
  const list = data?.listings ?? [];
  return list
    .filter((l) => l?.url && String(l.url).includes("streeteasy"))
    .map((l) => ({ id: String(l.id ?? ""), price: Number(l.price) || 0, url: String(l.url ?? "") }));
}

/** True if API address (e.g. "241 Washington Place #2") matches our street number and street name. */
function addressMatches(apiAddress: string | null | undefined, ourAddressLine: string): boolean {
  if (!apiAddress || !ourAddressLine) return false;
  const a = apiAddress.toLowerCase().replace(/#/g, " ");
  const ours = ourAddressLine.toLowerCase();
  const numMatch = ours.match(/^\d+/);
  const streetNum = numMatch ? numMatch[0] : "";
  if (!streetNum) return a.includes(ours) || ours.includes(a);
  if (!a.includes(streetNum)) return false;
  const rest = ours.slice(streetNum.length).trim().split(/\s+/);
  const streetPart = rest[0]; // e.g. "west", "east"
  const streetNumPart = rest[1]; // e.g. "20th", "22nd"
  if (streetPart && !a.includes(streetPart)) return false;
  if (streetNumPart) {
    const digitPart = streetNumPart.replace(/\D/g, "");
    if (digitPart && !a.includes(digitPart)) return false;
  }
  return true;
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
      const raw = await fetchRentalByUrl(buildingUrl);
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

  if (units.length === 0 || (units.length < 3 && process.env.RENTAL_SEARCH_FALLBACK === "1")) {
    const listings = await fetchRentalsSearch(DEFAULT_SEARCH_AREAS, SEARCH_FALLBACK_LIMIT);
    for (const list of listings) {
      if (!list.url) continue;
      const raw = await fetchRentalByUrl(list.url);
      if (!raw || !addressMatches(String(raw.address ?? ""), addressLine)) continue;
      const addrStr = String(raw.address ?? "");
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
