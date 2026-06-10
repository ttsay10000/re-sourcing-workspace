/**
 * Keep the first-class properties.lat/lng geocode columns populated. Migration
 * 056 backfilled them once from matched listings, but every later write path
 * (BBL resolution, listing refresh, PLUTO geography) lands in the details JSON
 * only — so properties sourced or refreshed after that migration silently drop
 * off map views, which read properties.lat/lng exclusively.
 *
 * Source priority (building-level beats lot centroid):
 *   1. details.lat/lon — merged by BBL resolution (Geoclient or listing sale details)
 *   2. best matched listing lat/lon — same source the migration backfill used
 *   3. details.neighborhood.geography latitude/longitude — PLUTO lot centroid
 *   4. Geoclient address lookup — last resort when nothing has coordinates
 */

import { PropertyRepo } from "@re-sourcing/db";
import { resolveBBLFromAddress } from "./geoclient.js";
import { parseAddressForGeoclient } from "./resolvePropertyBBL.js";

export type GeocodeSource = "details" | "listing" | "pluto" | "geoclient";

export interface GeocodeCandidate {
  lat: number;
  lng: number;
  source: GeocodeSource;
}

export interface SyncPropertyGeocodeResult extends GeocodeCandidate {
  /** true when the properties.lat/lng columns were written this call. */
  updated: boolean;
}

function coordinate(value: unknown): number | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function validPair(lat: number | null, lng: number | null): lat is number {
  if (lat == null || lng == null) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  // (0,0) is the classic "no data" coordinate, never a real NYC property.
  if (lat === 0 && lng === 0) return false;
  return true;
}

/**
 * Pick the best available coordinates for a property. Pure so the priority
 * and validation rules are unit-testable without a database.
 */
export function pickGeocodeCandidate(params: {
  details: Record<string, unknown> | null | undefined;
  listingLat?: unknown;
  listingLon?: unknown;
}): GeocodeCandidate | null {
  const details = params.details && typeof params.details === "object" ? params.details : {};

  const detailsLat = coordinate((details as Record<string, unknown>).lat);
  const detailsLon = coordinate((details as Record<string, unknown>).lon);
  if (validPair(detailsLat, detailsLon)) return { lat: detailsLat, lng: detailsLon!, source: "details" };

  const listingLat = coordinate(params.listingLat);
  const listingLon = coordinate(params.listingLon);
  if (validPair(listingLat, listingLon)) return { lat: listingLat, lng: listingLon!, source: "listing" };

  const neighborhood = (details as Record<string, unknown>).neighborhood;
  const geography =
    neighborhood && typeof neighborhood === "object"
      ? (neighborhood as Record<string, unknown>).geography
      : null;
  if (geography && typeof geography === "object") {
    const plutoLat = coordinate((geography as Record<string, unknown>).latitude);
    const plutoLon = coordinate((geography as Record<string, unknown>).longitude);
    if (validPair(plutoLat, plutoLon)) return { lat: plutoLat, lng: plutoLon!, source: "pluto" };
  }

  return null;
}

/**
 * Apply the best available geocode to properties.lat/lng (+ geocode_source,
 * geocoded_at). Falls back to a Geoclient address lookup when no cached source
 * has coordinates, persisting the result into details like getBBLForProperty
 * does so the lookup only happens once. Never throws on a behind schema
 * (missing 056 columns) — logs and returns null instead, so enrichment and
 * listing refreshes keep working.
 */
export async function syncPropertyGeocode(
  propertyId: string,
  pool: import("pg").Pool
): Promise<SyncPropertyGeocodeResult | null> {
  let row:
    | {
        canonical_address: string | null;
        details: Record<string, unknown> | null;
        lat: number | null;
        lng: number | null;
        listing_lat: number | null;
        listing_lon: number | null;
      }
    | undefined;
  try {
    const result = await pool.query(
      `SELECT p.canonical_address, p.details, p.lat, p.lng,
              lst.lat AS listing_lat, lst.lon AS listing_lon
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT l.lat, l.lon
         FROM listing_property_matches m
         JOIN listings l ON l.id = m.listing_id
         WHERE m.property_id = p.id AND m.status <> 'rejected'
           AND l.lat IS NOT NULL AND l.lon IS NOT NULL
         ORDER BY (m.status = 'accepted') DESC, m.confidence DESC NULLS LAST
         LIMIT 1
       ) lst ON TRUE
       WHERE p.id = $1`,
      [propertyId]
    );
    row = result.rows[0];
  } catch (err) {
    warnOnSchemaBehind("read", err);
    return null;
  }
  if (!row) return null;

  let candidate = pickGeocodeCandidate({
    details: row.details,
    listingLat: row.listing_lat,
    listingLon: row.listing_lon,
  });

  if (!candidate) {
    const parsed = parseAddressForGeoclient(row.canonical_address ?? "", null);
    if (parsed) {
      const resolved = await resolveBBLFromAddress(parsed.houseNumber, parsed.street, {
        borough: parsed.borough || undefined,
        zip: parsed.zip || undefined,
      });
      if (resolved?.lat != null && resolved?.lon != null && validPair(resolved.lat, resolved.lon)) {
        candidate = { lat: resolved.lat, lng: resolved.lon, source: "geoclient" };
        const details = row.details && typeof row.details === "object" ? row.details : {};
        const merge: Record<string, unknown> = { lat: resolved.lat, lon: resolved.lon };
        if (resolved.bbl && typeof details.bbl !== "string") merge.bbl = resolved.bbl;
        if (resolved.bin && typeof details.bin !== "string") merge.bin = resolved.bin;
        await new PropertyRepo({ pool }).mergeDetails(propertyId, merge).catch(() => {});
      }
    }
  }
  if (!candidate) return null;

  const currentLat = coordinate(row.lat);
  const currentLng = coordinate(row.lng);
  if (currentLat === candidate.lat && currentLng === candidate.lng) {
    return { ...candidate, updated: false };
  }

  try {
    await pool.query(
      `UPDATE properties
       SET lat = $2, lng = $3, geocode_source = $4, geocoded_at = now(), updated_at = now()
       WHERE id = $1`,
      [propertyId, candidate.lat, candidate.lng, candidate.source]
    );
  } catch (err) {
    warnOnSchemaBehind("write", err);
    return null;
  }
  return { ...candidate, updated: true };
}

function warnOnSchemaBehind(phase: "read" | "write", err: unknown): void {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  const message = err instanceof Error ? err.message : String(err);
  if (code === "42703") {
    console.warn(
      `[syncPropertyGeocode] geo columns missing (${phase}) — run db:migrate (056_deal_stage_and_geo.sql): ${message}`
    );
  } else {
    console.warn(`[syncPropertyGeocode] ${phase} failed: ${message}`);
  }
}
