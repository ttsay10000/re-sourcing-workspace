/**
 * NYC Real Estate API (RapidAPI) client.
 * Two endpoints:
 * - GET Active Sales (sales/search): areas + filters → list of listings with URLs.
 * - GET Sale details by URL: single url param → full property details.
 */

import type { ListingNormalized } from "@re-sourcing/contracts";

const BASE_URL = "https://nyc-real-estate-api.p.rapidapi.com/sales/search";
const HOST = "nyc-real-estate-api.p.rapidapi.com";

/** Criteria for GET Active Sales; areas is required (e.g. "all-downtown,all-midtown"). */
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
  const sqft = raw.square_feet ?? raw.sqft ?? raw.sqft_feet;
  const numSqft = typeof sqft === "number" ? sqft : typeof sqft === "string" ? Number(sqft) : null;
  const url = (raw.url ?? raw.link ?? raw.listing_url ?? "").trim() || "#";

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
    sqft: numSqft && !Number.isNaN(numSqft) ? numSqft : null,
    url,
    title: (raw.title ?? address) || null,
    description: null,
    lat: null,
    lon: null,
    imageUrls: null,
    listedAt: null,
    extra: { apiSegment: sourceLabel },
  };
}

/** Fetch from sales/search with optional query params. */
async function fetchSales(params: Record<string, string | number> = {}): Promise<ApiListing[]> {
  const url = new URL(BASE_URL);
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
}> {
  const params: Record<string, string | number> = {
    areas: criteria.areas.trim() || "all-downtown,all-midtown",
  };
  if (criteria.minPrice != null) params.minPrice = criteria.minPrice;
  if (criteria.maxPrice != null) params.maxPrice = criteria.maxPrice;
  if (criteria.minBeds != null) params.minBeds = criteria.minBeds;
  if (criteria.maxBeds != null) params.maxBeds = criteria.maxBeds;
  if (criteria.minBaths != null) params.minBaths = criteria.minBaths;
  if (criteria.maxHoa != null) params.maxHoa = criteria.maxHoa;
  if (criteria.maxTax != null) params.maxTax = criteria.maxTax;
  if (criteria.amenities != null && criteria.amenities.trim()) params.amenities = criteria.amenities.trim();
  if (criteria.types != null && criteria.types.trim()) params.types = criteria.types.trim();
  if (criteria.limit != null) params.limit = criteria.limit;
  if (criteria.offset != null) params.offset = criteria.offset;

  const raw = await fetchSales(params);
  const listings = raw.map((r) => mapListing(r, "active"));
  const urls = listings.map((l) => l.url).filter((u) => u && u !== "#");
  return { listings, urls };
}

/**
 * Fetch sale details for a single listing by its StreetEasy URL.
 * GET Sale details by URL; response shape is API-specific (returned as-is for property data).
 */
export async function fetchSaleDetailsByUrl(streeteasyUrl: string): Promise<Record<string, unknown>> {
  const url = new URL(BASE_URL);
  url.searchParams.set("url", streeteasyUrl);
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NYC Real Estate API sale details error ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as unknown;
  return (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
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
