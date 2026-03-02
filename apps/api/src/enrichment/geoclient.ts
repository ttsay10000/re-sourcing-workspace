/**
 * NYC Geoclient API: reverse geocode (lat/lon) to BBL/BIN for permit enrichment.
 * Optional: set GEOCLIENT_APP_ID and GEOCLIENT_APP_KEY (NYC developer portal).
 * If unset or API fails, returns null and caller falls back to address-based lookup.
 */

const GEOCODE_URL = "https://api.cityofnewyork.us/geoclient/v1/address.json";

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
    const data = (await res.json()) as unknown;
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
      const bin = binField != null && String(binField).trim() ? String(binField).trim() : undefined;
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
        const bin = binField != null && String(binField).trim() ? String(binField).trim() : undefined;
        return { bbl, bin };
      }
    }
  } catch {
    // ignore
  }
  return null;
}
