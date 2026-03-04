/**
 * NYC Geoclient API: reverse geocode (lat/lon) and forward geocode (address → BBL/BIN).
 * v1 (lat/lon): GEOCLIENT_APP_ID and GEOCLIENT_APP_KEY (deprecated).
 * v2 (address): GEOCLIENT_SUBSCRIPTION_KEY (NYC API Developers Portal, api-portal.nyc.gov).
 * Address endpoint: houseNumber, street, and borough (or zip). Borough can be name or number (1–5).
 */

const GEOCODE_URL = "https://api.cityofnewyork.us/geoclient/v1/address.json";

/**
 * Geoclient v2 base URL. Official portal: https://api-portal.nyc.gov (api=geoclient-current-v2).
 * Override with GEOCLIENT_BASE_URL if your gateway differs.
 */
const GEOCLIENT_V2_BASE = process.env.GEOCLIENT_BASE_URL?.trim() || "https://api.nyc.gov/geoclient/v2";

/** NYC borough code to name (Geoclient accepts either). */
export const BOROUGH_NUMBER_TO_NAME: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

/**
 * Geoclient sometimes returns BIN "1000000" when no real BIN is available (placeholder).
 * That value is shared by many buildings in NYC data and is not a valid property-level BIN.
 * Treat it as missing so callers rely on BBL-only lookups where appropriate.
 */
const BIN_PLACEHOLDER_IGNORE = new Set(["1000000", "0", ""]);

function normalizeBin(raw: string | number | null | undefined | unknown): string | undefined {
  const s = raw != null ? String(raw).trim() : "";
  if (!s || BIN_PLACEHOLDER_IGNORE.has(s)) return undefined;
  return s;
}

function getSubscriptionKey(): string | null {
  const key = process.env.GEOCLIENT_SUBSCRIPTION_KEY?.trim();
  return key || null;
}

function getCredentials(): { appId: string; appKey: string } | null {
  const appId = process.env.GEOCLIENT_APP_ID?.trim();
  const appKey = process.env.GEOCLIENT_APP_KEY?.trim();
  if (!appId || !appKey) return null;
  return { appId, appKey };
}

/**
 * Call NYC Geoclient address endpoint with lat/lon for reverse geocode.
 * Returns BBL (10-digit) and optional BIN if found; null otherwise.
 */
export async function resolveBBLFromLatLon(
  lat: number,
  lon: number
): Promise<{ bbl: string; bin?: string } | null> {
  const creds = getCredentials();
  if (!creds) return null;
  if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const url = new URL(GEOCODE_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("app_id", creds.appId);
  url.searchParams.set("app_key", creds.appKey);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    if (!data || typeof data !== "object") return null;

    const obj = data as Record<string, unknown>;
    const addr = obj.address as Record<string, unknown> | undefined;
    if (!addr || typeof addr !== "object") return null;

    const boroughCode = addr.boroughCode ?? addr.borough_code;
    const block = addr.block ?? addr.blockNumber;
    const lot = addr.lot ?? addr.lotNumber;
    const bblField = addr.bbl;
    const binField = addr.bin ?? addr.binNumber;

    if (bblField != null && typeof bblField === "string" && /^\d{10}$/.test(bblField.trim())) {
      const bbl = bblField.trim();
      const bin = normalizeBin(binField);
      return { bbl, bin };
    }

    if (
      boroughCode != null &&
      block != null &&
      lot != null
    ) {
      const b = String(boroughCode).trim().slice(0, 1);
      const bl = String(block).trim().padStart(5, "0").slice(-5);
      const lo = String(lot).trim().padStart(4, "0").slice(-4);
      const bbl = `${b}${bl}${lo}`;
      if (bbl.length === 10 && /^\d+$/.test(bbl)) {
        const bin = normalizeBin(binField);
        return { bbl, bin };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Geoclient v2 Address endpoint (api-portal.nyc.gov, geoclient-current-v2).
 * Params: houseNumber, street, and either borough or zip (from sale details / property details).
 * Borough can be name ("Manhattan") or NYC borough number ("1"–"5": 1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island).
 * Use zip when borough is missing (e.g. from property/listing zip). Requires GEOCLIENT_SUBSCRIPTION_KEY.
 */
export async function resolveBBLFromAddress(
  houseNumber: string,
  street: string,
  boroughOrZip: { borough?: string | null; zip?: string | null }
): Promise<{ bbl: string; bin?: string; lat?: number; lon?: number } | null> {
  const key = getSubscriptionKey();
  if (!key) return null;
  const house = String(houseNumber).trim();
  const streetTrim = String(street).trim();
  if (!house || !streetTrim) return null;

  const borough = boroughOrZip.borough != null ? String(boroughOrZip.borough).trim() : "";
  const zip = boroughOrZip.zip != null ? String(boroughOrZip.zip).trim().replace(/\D/g, "").slice(0, 5) : "";
  if (!borough && !zip) return null;

  const base = GEOCLIENT_V2_BASE.replace(/\/$/, "");
  const url = new URL(`${base}/address.json`);
  url.searchParams.set("houseNumber", house);
  url.searchParams.set("street", streetTrim);
  if (borough) url.searchParams.set("borough", borough);
  else url.searchParams.set("zip", zip);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": key },
    });
    if (!res.ok) return null;
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    if (!data || typeof data !== "object") return null;

    const obj = data as Record<string, unknown>;
    const addr = obj.address as Record<string, unknown> | undefined;
    if (!addr || typeof addr !== "object") return null;

    const grc = addr.geosupportReturnCode ?? addr.returnCode1a ?? addr.returnCode1e;
    const code = grc != null ? String(grc).trim() : "";
    if (code !== "00" && code !== "01") return null;

    const bblField = addr.bbl;
    const binField = addr.buildingIdentificationNumber ?? addr.bin ?? addr.binNumber;
    if (bblField != null && typeof bblField === "string" && /^\d{10}$/.test(bblField.trim())) {
      const bbl = bblField.trim();
      const bin = normalizeBin(binField);
      const latVal = addr.latitude;
      const lonVal = addr.longitude;
      const lat = typeof latVal === "number" && !Number.isNaN(latVal) ? latVal : undefined;
      const lon = typeof lonVal === "number" && !Number.isNaN(lonVal) ? lonVal : undefined;
      return { bbl, bin, lat, lon };
    }

    const boroughCode = addr.boroughCode ?? addr.borough_code;
    const block = addr.block ?? addr.bblTaxBlock ?? addr.blockNumber;
    const lot = addr.lot ?? addr.bblTaxLot ?? addr.lotNumber;
    if (boroughCode != null && block != null && lot != null) {
      const b = String(boroughCode).trim().slice(0, 1);
      const bl = String(block).trim().padStart(5, "0").slice(-5);
      const lo = String(lot).trim().padStart(4, "0").slice(-4);
      const bbl = `${b}${bl}${lo}`;
      if (bbl.length === 10 && /^\d+$/.test(bbl)) {
        const bin = normalizeBin(binField);
        const latVal = addr.latitude;
        const lonVal = addr.longitude;
        const lat = typeof latVal === "number" && !Number.isNaN(latVal) ? latVal : undefined;
        const lon = typeof lonVal === "number" && !Number.isNaN(lonVal) ? lonVal : undefined;
        return { bbl, bin, lat, lon };
      }
    }
  } catch {
    // ignore
  }
  return null;
}
