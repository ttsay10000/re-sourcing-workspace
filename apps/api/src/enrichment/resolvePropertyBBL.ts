/**
 * Resolve BBL/BIN for a property from details, linked listing extra, or Geoclient (address).
 * Same flow as test: property has details.bbl set so modules can run. Permit enrichment
 * can also set BBL via permit API address lookup; we fall back to Geoclient when missing.
 */

import {
  getPool,
  PropertyRepo,
  MatchRepo,
  ListingRepo,
} from "@re-sourcing/db";
import { getBblFromDetails, getBblBaseFromDetails, getBinFromDetails } from "./propertyKeys.js";
import { resolveBBLFromAddress, resolveBBLFromLatLon } from "./geoclient.js";
import { resolveCondoBblForQuery } from "./resolveCondoBbl.js";
import { normalizeBorough } from "./permits/normalizers.js";

export interface ResolvedBBL {
  bbl: string | null;
  bin: string | null;
}

/**
 * Get BBL/BIN from the linked listing's extra (GET sale details), if present.
 * No Geoclient; permit enrichment uses address match to permit API for BBL.
 */
export async function resolveBBLFromListing(
  matchRepo: MatchRepo,
  listingRepo: ListingRepo,
  propertyId: string
): Promise<{ bbl: string; bin?: string; lat?: number; lon?: number } | null> {
  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  const match = matches[0];
  if (!match) return null;
  const listing = await listingRepo.byId(match.listingId);
  if (!listing) return null;

  const extra = listing.extra && typeof listing.extra === "object" ? (listing.extra as Record<string, unknown>) : null;
  if (extra) {
    const bbl = extra.bbl ?? extra.BBL ?? extra.borough_block_lot;
    const bin = extra.bin ?? extra.BIN ?? extra.building_identification_number;
    const bblStr = typeof bbl === "string" && /^\d{10}$/.test(bbl.trim()) ? bbl.trim() : null;
    if (bblStr) {
      const lat = listing.lat != null && typeof listing.lat === "number" ? listing.lat : undefined;
      const lon = listing.lon != null && typeof listing.lon === "number" ? listing.lon : undefined;
      return { bbl: bblStr, bin: typeof bin === "string" ? bin.trim() : undefined, lat, lon };
    }
  }

  return null;
}

/** Suffixes that listing sources (e.g. Streeteasy) append to addresses; Geoclient does not recognize them. */
const STREET_SUFFIXES_TO_STRIP = new Set([
  "MULTIFAMILY", "CONDO", "CONDOMINIUM", "COOP", "CO-OP", "COOPERATIVE",
  "RENTAL", "BUILDING", "CONDOMINIUMS", "CONDOS",
  "MIXED-USE", "MIXED-USE-TO", "MIXED-USE-TOWER", "TOWNHOUSE", "TWNH",
]);

/** Unit/apt tokens (e.g. #1, #2A, #TWNH) that Geoclient and permit API expect to be omitted from street name. */
function isUnitLikeToken(word: string): boolean {
  return /^#\S+$/.test(word.trim());
}

/** Unit/suite patterns to strip so Geoclient and permit API get building-level address only. */
const UNIT_SUFFIX_REGEX = /\s+(Apt\.?|Apartment|Unit|Suite|Ste\.?|Floor|Fl\.?|Bsmt\.?|Basement)(\s*[#\dA-Za-z\-]+)?$/i;
const HASH_UNIT_REGEX = /\s+#\S*$/;

/**
 * Strip unit numbers and suite/apt designators from an address line so geo lookup uses building address only.
 * e.g. "123 Main St Apt 4B" → "123 Main St", "456 Park Ave #5" → "456 Park Ave".
 */
export function stripUnitFromAddressLine(addressLine: string): string {
  let s = addressLine.trim();
  if (!s) return s;
  s = s.replace(HASH_UNIT_REGEX, "");
  s = s.replace(UNIT_SUFFIX_REGEX, "");
  return s.trim();
}

function stripListingTypeFromStreet(street: string): string {
  const words = street.trim().split(/\s+/);
  const filtered = words.filter(
    (w) => !STREET_SUFFIXES_TO_STRIP.has(w.toUpperCase()) && !isUnitLikeToken(w)
  );
  return filtered.join(" ").trim();
}

/** Normalize a listing address line (e.g. "18 Christopher Street MULTIFAMILY" → "18 Christopher Street") for Geoclient and display. Strips unit numbers so geo lookup uses building-level address. */
export function normalizeAddressLineForDisplay(addressLine: string): string {
  const t = stripUnitFromAddressLine(addressLine.trim());
  if (!t) return addressLine.trim();
  const parts = t.split(/\s+/);
  if (parts.length <= 1) return t;
  const houseNumber = parts[0];
  const street = stripListingTypeFromStreet(parts.slice(1).join(" "));
  return [houseNumber, street].filter(Boolean).join(" ");
}

/** Parse canonical_address or listing into houseNumber, street, borough, zip for Geoclient. Strips unit numbers so lookup uses building-level address. */
function parseAddressForGeoclient(
  canonicalAddress: string,
  listing: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null } | null
): { houseNumber: string; street: string; borough: string; zip: string } | null {
  let addressPart = listing?.address?.trim() ?? (canonicalAddress.split(",")[0]?.trim() ?? "");
  addressPart = stripUnitFromAddressLine(addressPart);
  const parts = addressPart.split(/\s+/);
  const houseNumber = parts[0] ?? "";
  let street = parts.slice(1).join(" ").trim();
  street = stripListingTypeFromStreet(street);
  if (!houseNumber || !street) return null;

  const boroughFromListing = listing?.city ? normalizeBorough(listing.city) : "";
  const boroughFromCanonical = canonicalAddress.split(",")[1]?.trim() ?? "";
  const borough = boroughFromListing || (boroughFromCanonical ? normalizeBorough(boroughFromCanonical) : "");
  const stateZip = listing?.zip ?? canonicalAddress.split(",")[2]?.trim() ?? "";
  const zip = typeof stateZip === "string" ? stateZip.replace(/\D/g, "").slice(0, 5) : "";

  if (!borough && !zip) return null;
  return { houseNumber, street, borough, zip };
}

export type GeocodeResult = {
  propertyId: string;
  ok: boolean;
  /** Already had lat/lng columns set — nothing to do. */
  alreadyGeocoded?: boolean;
  /** Where the coordinates came from: details (earlier BBL resolve), listing, or geoclient. */
  source?: "details" | "listing" | "geoclient";
  error?: string;
};

/**
 * Populate the top-level properties.lat/lng columns (what the yield map reads).
 * BBL resolution stores geoclient lat/lon inside details JSONB only, and the
 * listing backfill misses properties sourced without a matched listing (e.g.
 * direct OM uploads) — this step closes both gaps. Sources in order:
 * details.lat/lon, matched listing, then a Geoclient address lookup.
 */
export async function geocodePropertyCoordinates(propertyId: string): Promise<GeocodeResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });

  const property = await propertyRepo.byId(propertyId);
  if (!property) return { propertyId, ok: false, error: "Property not found." };

  const existing = await pool.query(`SELECT lat, lng FROM properties WHERE id = $1`, [propertyId]);
  const row = existing.rows[0] as { lat: number | string | null; lng: number | string | null } | undefined;
  if (row && row.lat != null && row.lng != null) {
    return { propertyId, ok: true, alreadyGeocoded: true };
  }

  const persist = async (lat: number, lon: number, source: "details" | "listing" | "geoclient"): Promise<GeocodeResult> => {
    await pool.query(
      `UPDATE properties SET lat = $2, lng = $3, geocode_source = $4, geocoded_at = now() WHERE id = $1`,
      [propertyId, lat, lon, source]
    );
    return { propertyId, ok: true, source };
  };

  const asFiniteNumber = (value: unknown): number | null => {
    const numeric = typeof value === "string" ? Number(value) : value;
    return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
  };

  // 1. Coordinates an earlier BBL resolve already stored in details JSONB.
  const details = (property.details as Record<string, unknown>) ?? {};
  const detailsLat = asFiniteNumber(details.lat);
  const detailsLon = asFiniteNumber(details.lon ?? details.lng);
  if (detailsLat != null && detailsLon != null) return persist(detailsLat, detailsLon, "details");

  // 2. Best matched listing.
  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  const match = matches[0];
  const listing = match ? await listingRepo.byId(match.listingId) : null;
  const listingLat = asFiniteNumber(listing?.lat);
  const listingLon = asFiniteNumber(listing?.lon);
  if (listingLat != null && listingLon != null) return persist(listingLat, listingLon, "listing");

  // 3. Geoclient forward geocode from the canonical/listing address.
  const parsed = parseAddressForGeoclient(property.canonicalAddress ?? "", listing);
  if (!parsed) {
    return { propertyId, ok: false, error: "Address could not be parsed into house number + street + borough/zip." };
  }
  const resolved = await resolveBBLFromAddress(parsed.houseNumber, parsed.street, {
    borough: parsed.borough || undefined,
    zip: parsed.zip || undefined,
  });
  if (!resolved) {
    return {
      propertyId,
      ok: false,
      error: `Geoclient could not resolve "${parsed.houseNumber} ${parsed.street}" (check GEOCLIENT_SUBSCRIPTION_KEY and the address).`,
    };
  }
  if (resolved.lat == null || resolved.lon == null) {
    return { propertyId, ok: false, error: "Geoclient matched the address but returned no coordinates." };
  }
  // Keep details in sync too: BBL/BIN may be new information for enrichment.
  const merge: Record<string, unknown> = { lat: resolved.lat, lon: resolved.lon };
  if (!getBblFromDetails(details) && resolved.bbl) merge.bbl = resolved.bbl;
  if (!getBinFromDetails(details) && resolved.bin) merge.bin = resolved.bin;
  await propertyRepo.mergeDetails(propertyId, merge);
  return persist(resolved.lat, resolved.lon, "geoclient");
}

/**
 * Get BBL and optionally BIN for a property. Sources (in order): property.details,
 * linked listing extra (sale details), then Geoclient address lookup. When we resolve
 * condo billing → base BBL we persist bblBase in details for UI. Same logic as test:
 * ensure BBL is set on property so modules can run.
 */
export async function getBBLForProperty(
  propertyId: string,
  options: { appToken?: string | null } = {}
): Promise<ResolvedBBL | null> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });

  const property = await propertyRepo.byId(propertyId);
  if (!property) return null;

  const details = (property.details as Record<string, unknown>) ?? {};
  const bbl = getBblFromDetails(details);
  const bin = getBinFromDetails(details);
  if (bbl) {
    let bblBase = getBblBaseFromDetails(details);
    if (!bblBase) {
      bblBase = await resolveCondoBblForQuery(bbl, { appToken: options.appToken });
      if (bblBase) await propertyRepo.mergeDetails(propertyId, { bblBase });
    }
    return { bbl, bin: bin ?? null };
  }

  const fromListing = await resolveBBLFromListing(matchRepo, listingRepo, propertyId);
  if (fromListing?.bbl) {
    const merge: Record<string, unknown> = { bbl: fromListing.bbl };
    if (fromListing.bin) merge.bin = fromListing.bin;
    if (fromListing.lat != null) merge.lat = fromListing.lat;
    if (fromListing.lon != null) merge.lon = fromListing.lon;
    const bblBase = await resolveCondoBblForQuery(fromListing.bbl, { appToken: options.appToken });
    if (bblBase) merge.bblBase = bblBase;
    await propertyRepo.mergeDetails(propertyId, merge);
    return { bbl: fromListing.bbl, bin: fromListing.bin ?? null };
  }

  // Listing has lat/lon but no BBL (e.g. building page URL): resolve BBL via Geoclient reverse geocode.
  if (fromListing?.lat != null && fromListing?.lon != null) {
    const fromLatLon = await resolveBBLFromLatLon(fromListing.lat, fromListing.lon);
    if (fromLatLon?.bbl) {
      const merge: Record<string, unknown> = { bbl: fromLatLon.bbl, lat: fromListing.lat, lon: fromListing.lon };
      if (fromLatLon.bin) merge.bin = fromLatLon.bin;
      const bblBase = await resolveCondoBblForQuery(fromLatLon.bbl, { appToken: options.appToken });
      if (bblBase) merge.bblBase = bblBase;
      await propertyRepo.mergeDetails(propertyId, merge);
      return { bbl: fromLatLon.bbl, bin: fromLatLon.bin ?? null };
    }
  }

  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  const match = matches[0];
  const listing = match ? await listingRepo.byId(match.listingId) : null;
  const parsed = parseAddressForGeoclient(property.canonicalAddress ?? "", listing);
  if (parsed) {
    const fromGeoclient = await resolveBBLFromAddress(parsed.houseNumber, parsed.street, {
      borough: parsed.borough || undefined,
      zip: parsed.zip || undefined,
    });
    if (fromGeoclient?.bbl) {
      const merge: Record<string, unknown> = { bbl: fromGeoclient.bbl };
      if (fromGeoclient.bin) merge.bin = fromGeoclient.bin;
      if (fromGeoclient.lat != null) merge.lat = fromGeoclient.lat;
      if (fromGeoclient.lon != null) merge.lon = fromGeoclient.lon;
      const bblBase = await resolveCondoBblForQuery(fromGeoclient.bbl, { appToken: options.appToken });
      if (bblBase) merge.bblBase = bblBase;
      await propertyRepo.mergeDetails(propertyId, merge);
      return { bbl: fromGeoclient.bbl, bin: fromGeoclient.bin ?? null };
    }
  }

  return null;
}
