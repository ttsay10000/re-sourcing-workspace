/**
 * NYC Real Estate API (RapidAPI) client. Uses RAPIDAPI_KEY env for both endpoints.
 *
 * Step 1 — GET active properties:
 *   GET https://nyc-real-estate-api.p.rapidapi.com/sales/search
 *   Querystring: areas, minPrice, maxPrice, minBeds, maxBeds, minBaths, maxHoa, maxTax, amenities, types, limit, offset
 *   (each from run filters / UI when starting a run).
 *
 * Step 2 — GET sale details per listing:
 *   GET https://nyc-real-estate-api.p.rapidapi.com/sales/url
 *   Querystring: url=<StreetEasy URL from step 1>. No areas or other search params.
 */

import type { ListingNormalized } from "@re-sourcing/contracts";

const SALES_SEARCH_URL = "https://nyc-real-estate-api.p.rapidapi.com/sales/search";
const SALES_URL_ENDPOINT = "https://nyc-real-estate-api.p.rapidapi.com/sales/url";
const SALES_ID_ENDPOINT_BASE = "https://nyc-real-estate-api.p.rapidapi.com/sales";
const HOST = "nyc-real-estate-api.p.rapidapi.com";

/**
 * Criteria for GET Active Sales; areas is required (e.g. "all-downtown,all-midtown").
 * types: comma-separated; API supports condo, coop, house, multi_family.
 * amenities: e.g. washer_dryer, dishwasher, private_outdoor_space, laundry, elevator, doorman.
 * See https://streasy.gitbook.io/search-api
 */
export interface NycsSearchCriteria {
  areas: string;
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  maxBeds?: number;
  minBaths?: number;
  maxHoa?: number;
  maxTax?: number;
  amenities?: string;
  types?: string;
  requestedTypes?: string;
  limit?: number;
  offset?: number;
}

/** Raw listing shape from API (flexible for varying response structure). */
interface ApiListing {
  id?: string;
  listing_id?: string;
  address?: string;
  street_address?: string;
  formatted_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  zip?: string;
  postal_code?: string;
  price?: number;
  list_price?: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  baths?: number;
  square_feet?: number;
  sqft?: number;
  sqft_feet?: number;
  url?: string;
  link?: string;
  listing_url?: string;
  title?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = firstNumber(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

function readPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current;
}

function firstPositiveNumberFromPaths(root: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = firstNumber(readPath(root, path));
    if (value != null && value > 0) return value;
  }
  return null;
}

function getApiKey(): string {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    throw new Error("RAPIDAPI_KEY environment variable is required for NYC Real Estate API.");
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    "x-rapidapi-host": HOST,
    "x-rapidapi-key": getApiKey(),
  };
}

/** Map a single API listing to ListingNormalized. */
function mapListing(raw: ApiListing, sourceLabel: "active" | "past"): ListingNormalized {
  const externalId = String(raw.id ?? raw.listing_id ?? raw.address ?? "").trim() || "unknown";
  const address = [raw.address ?? raw.street_address ?? raw.formatted_address ?? ""].filter(Boolean).join(", ").trim() || "—";
  const city = (raw.city ?? "").trim() || "New York";
  const state = (raw.state ?? "").trim() || "NY";
  const zip = String(raw.zip_code ?? raw.zip ?? raw.postal_code ?? "").trim() || "";
  const price = Number(raw.price ?? raw.list_price) || 0;
  const beds = Number(raw.bedrooms ?? raw.beds) || 0;
  const baths = Number(raw.bathrooms ?? raw.baths) || 0;
  const numSqft = firstPositiveNumber(
    raw.square_feet,
    raw.sqft,
    raw.sqft_feet,
    raw.squareFeet,
    raw.gross_square_feet,
    raw.grossSqft,
    raw.building_sqft,
    raw.buildingSqft,
    raw.building_size,
    raw.buildingSize,
    firstPositiveNumberFromPaths(raw, [
      ["building", "sqft"],
      ["building", "squareFeet"],
      ["building", "square_feet"],
      ["building", "grossSqft"],
      ["property", "sqft"],
      ["property", "squareFeet"],
    ])
  );
  const sourcePricePerSqft = firstPositiveNumber(
    raw.ppsqft,
    raw.pricePerSqft,
    raw.price_per_sqft,
    raw.price_per_square_foot,
    raw.psf,
    raw.price_psf
  );
  const pricePerSqft = sourcePricePerSqft ?? (price > 0 && numSqft != null ? Math.round(price / numSqft) : null);
  const url = (raw.url ?? raw.link ?? raw.listing_url ?? "").trim() || "#";
  const images = Array.isArray(raw.images)
    ? (raw.images as unknown[]).filter((image): image is string => typeof image === "string" && image.trim().length > 0)
    : null;
  const agents = Array.isArray(raw.agents)
    ? (raw.agents as unknown[])
        .map((agent) => (typeof agent === "string" ? agent.trim() : ""))
        .filter(Boolean)
    : null;
  const latitude = Number(raw.latitude ?? raw.lat);
  const longitude = Number(raw.longitude ?? raw.lon);
  const listedAt = raw.listedAt ?? raw.listed_at;

  return {
    source: "nyc_api",
    externalId,
    address,
    city,
    state,
    zip,
    price,
    beds,
    baths,
    sqft: numSqft != null ? Math.round(numSqft) : null,
    url,
    title: (raw.title ?? address) || null,
    description: typeof raw.description === "string" ? raw.description : null,
    lat: Number.isFinite(latitude) ? latitude : null,
    lon: Number.isFinite(longitude) ? longitude : null,
    imageUrls: images && images.length > 0 ? images : null,
    listedAt: listedAt != null ? String(listedAt) : null,
    agentNames: agents && agents.length > 0 ? agents : null,
    extra: {
      apiSegment: sourceLabel,
      status: raw.status ?? null,
      borough: raw.borough ?? null,
      neighborhood: raw.neighborhood ?? raw.neighborhood_name ?? null,
      zipcode: raw.zipcode ?? raw.zip_code ?? raw.zip ?? null,
      propertyType: raw.propertyType ?? raw.property_type ?? null,
      sqft: numSqft != null ? Math.round(numSqft) : null,
      squareFeet: numSqft != null ? Math.round(numSqft) : null,
      ppsqft: pricePerSqft,
      pricePerSqft,
      daysOnMarket: raw.daysOnMarket ?? raw.days_on_market ?? null,
      monthlyHoa: raw.monthlyHoa ?? raw.monthly_hoa ?? null,
      monthlyTax: raw.monthlyTax ?? raw.monthly_tax ?? null,
      builtIn: raw.builtIn ?? raw.built_in ?? null,
      amenities: raw.amenities ?? null,
      building: raw.building ?? null,
      floorplans: raw.floorplans ?? null,
      closedAt: raw.closedAt ?? raw.closed_at ?? null,
      closedPrice: raw.closed_price ?? raw.closedPrice ?? null,
    },
  };
}

/** Fetch from sales/search with optional query params. */
async function fetchSales(params: Record<string, string | number> = {}): Promise<ApiListing[]> {
  const url = new URL(SALES_SEARCH_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NYC Real Estate API error ${res.status}: ${text || res.statusText}`);
  }

  const data = (await res.json()) as unknown;
  if (Array.isArray(data)) return data as ApiListing[];
  if (data && typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  for (const key of ["data", "results", "listings", "properties", "items"]) {
    const arr = obj[key];
    if (Array.isArray(arr)) return arr as ApiListing[];
  }
  return [];
}

/**
 * Fetch active sales with full criteria. Always sends areas (required); other params only if set.
 * Returns listings and their URLs for use in GET Sale details by URL.
 */
export async function fetchActiveSalesWithCriteria(criteria: NycsSearchCriteria): Promise<{
  listings: ListingNormalized[];
  urls: string[];
  metadata: Record<string, unknown>;
}> {
  const baseParams: Record<string, string | number> = {
    areas: criteria.areas.trim() || "all-downtown,all-midtown",
  };
  if (criteria.minPrice != null) baseParams.minPrice = criteria.minPrice;
  if (criteria.maxPrice != null) baseParams.maxPrice = criteria.maxPrice;
  if (criteria.minBeds != null) baseParams.minBeds = criteria.minBeds;
  if (criteria.maxBeds != null) baseParams.maxBeds = criteria.maxBeds;
  if (criteria.minBaths != null) baseParams.minBaths = criteria.minBaths;
  if (criteria.maxHoa != null) baseParams.maxHoa = criteria.maxHoa;
  if (criteria.maxTax != null) baseParams.maxTax = criteria.maxTax;
  if (criteria.amenities != null && criteria.amenities.trim()) baseParams.amenities = criteria.amenities.trim();
  if (criteria.types != null && criteria.types.trim()) baseParams.types = criteria.types.trim();

  const requestedLimit = Math.min(Math.max(criteria.limit ?? 100, 1), 500);
  const pageLimit = Math.min(requestedLimit, 100);
  const raw: ApiListing[] = [];
  const pages: Array<Record<string, number>> = [];
  const seenUrls = new Set<string>();

  if (criteria.offset != null) {
    const params = { ...baseParams, limit: requestedLimit, offset: criteria.offset };
    const page = await fetchSales(params);
    raw.push(...page);
    pages.push({ offset: criteria.offset, requestedLimit, returned: page.length, uniqueNew: page.length });
  } else {
    let offset = 0;
    for (let pageIndex = 0; pageIndex < 10 && raw.length < requestedLimit; pageIndex++) {
      const params = { ...baseParams, limit: pageLimit, offset };
      const page = await fetchSales(params);
      let uniqueNew = 0;
      for (const row of page) {
        const listing = mapListing(row, "active");
        const key = listing.url && listing.url !== "#" ? listing.url : `${listing.address}:${listing.price}:${listing.externalId}`;
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        raw.push(row);
        uniqueNew++;
        if (raw.length >= requestedLimit) break;
      }
      pages.push({ offset, requestedLimit: pageLimit, returned: page.length, uniqueNew });
      if (page.length === 0 || uniqueNew === 0) break;
      offset += page.length;
    }
  }

  const listings = raw.slice(0, requestedLimit).map((r) => mapListing(r, "active"));
  const urls = listings.map((l) => l.url).filter((u) => u && u !== "#");
  return {
    listings,
    urls,
    metadata: {
      criteria: {
        ...criteria,
        limit: requestedLimit,
      },
      requestParams: {
        ...baseParams,
        limit: requestedLimit,
      },
      pages,
      rawListingsReturned: raw.length,
      urlsReturned: urls.length,
      uniqueUrlsReturned: new Set(urls).size,
    },
  };
}

/**
 * Unwrap GET sale details response: many APIs return { data }, { listing }, or { result }.
 * Returns the inner listing payload so callers see flat priceHistory, agents, etc.
 */
function unwrapSaleDetailsResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const obj = data as Record<string, unknown>;
  for (const key of ["data", "listing", "result", "property", "details"]) {
    const inner = obj[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return { ...(inner as Record<string, unknown>), _responseRoot: obj };
    }
  }
  return obj;
}

/**
 * Fetch sale details for a single listing by its StreetEasy URL.
 * Uses GET /sales/url (not /sales/search); only the url querystring param is required.
 * Unwraps nested responses (e.g. { data: { ... } }) so price history and agents are at top level.
 */
/**
 * Normalize StreetEasy URL so RapidAPI returns 200 (API may 302 when URL has long query string).
 * Keeps path (e.g. /sale/1686201) and drops UTM/other query params.
 */
export function normalizeStreeteasyUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "streeteasy.com" && !u.hostname.endsWith(".streeteasy.com")) return url;
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export function extractStreetEasySaleIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname !== "streeteasy.com" && !parsed.hostname.endsWith(".streeteasy.com")) return null;
    const salePathMatch = parsed.pathname.match(/\/sale\/(\d+)(?:\/|$)/i);
    if (salePathMatch?.[1]) return salePathMatch[1];
    for (const key of ["listing_id", "listingId", "sale_id", "saleId", "id"]) {
      const value = parsed.searchParams.get(key);
      if (value && /^\d+$/.test(value.trim())) return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchSaleDetailsByUrl(streeteasyUrl: string): Promise<Record<string, unknown>> {
  const url = new URL(SALES_URL_ENDPOINT);
  url.searchParams.set("url", normalizeStreeteasyUrl(streeteasyUrl));
  const res = await fetch(url.toString(), { headers: headers(), redirect: "follow" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NYC Real Estate API sale details error ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as unknown;
  return unwrapSaleDetailsResponse(data);
}

export async function fetchSaleDetailsById(saleId: string | number): Promise<Record<string, unknown>> {
  const id = String(saleId).trim();
  if (!/^\d+$/.test(id)) throw new Error("StreetEasy sale ID must be numeric.");
  const res = await fetch(`${SALES_ID_ENDPOINT_BASE}/${encodeURIComponent(id)}`, {
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NYC Real Estate API sale details by ID error ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as unknown;
  return unwrapSaleDetailsResponse(data);
}

/**
 * Fetch active (current) sales from the API (legacy; no areas).
 */
export async function fetchActiveSales(options: { limit?: number; offset?: number } = {}): Promise<ListingNormalized[]> {
  const params: Record<string, string | number> = {};
  if (options.limit != null) params.limit = options.limit;
  if (options.offset != null) params.offset = options.offset;
  const raw = await fetchSales(params);
  return raw.map((r) => mapListing(r, "active"));
}

/**
 * Fetch past sales (recent off-market) for the last 3 months.
 * Uses date range parameters if the API supports them; otherwise returns recent sales.
 */
export async function fetchPastSalesLast3Months(options: { limit?: number; offset?: number } = {}): Promise<ListingNormalized[]> {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const params: Record<string, string | number> = {
    // Common param names for sold/past date range (API may use one of these)
    sale_date_from: threeMonthsAgo.toISOString().slice(0, 10),
    sale_date_to: now.toISOString().slice(0, 10),
  };
  if (options.limit != null) params.limit = options.limit;
  if (options.offset != null) params.offset = options.offset;

  try {
    const raw = await fetchSales(params);
    return raw.map((r) => mapListing(r, "past"));
  } catch {
    // If date params are not supported, try without (API may use different param names)
    const fallbackParams: Record<string, string | number> = {};
    if (options.limit != null) fallbackParams.limit = options.limit;
    if (options.offset != null) fallbackParams.offset = options.offset;
    const raw = await fetchSales(fallbackParams);
    return raw.map((r) => mapListing(r, "past"));
  }
}

/**
 * Fetch both active sales and past sales (last 3 months) and return combined list.
 * Past listings are marked in extra.apiSegment === "past".
 */
export async function fetchActiveAndPastSales(options: {
  activeLimit?: number;
  pastLimit?: number;
} = {}): Promise<ListingNormalized[]> {
  const [active, past] = await Promise.all([
    fetchActiveSales({ limit: options.activeLimit ?? 50 }),
    fetchPastSalesLast3Months({ limit: options.pastLimit ?? 50 }),
  ]);
  return [...active, ...past];
}
