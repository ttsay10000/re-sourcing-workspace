/**
 * Resolve BBL/BIN for a property from details or from the linked raw listing (extra only).
 * Permit enrichment resolves BBL via address-based permit API lookup (exact + fuzzy);
 * the 7 modules use property.details (set by permit) or listing.extra when present.
 */

import {
  getPool,
  PropertyRepo,
  MatchRepo,
  ListingRepo,
} from "@re-sourcing/db";
import { getBblFromDetails, getBinFromDetails } from "./propertyKeys.js";

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

/**
 * Get BBL and optionally BIN for a property. If not in property.details,
 * returns from linked listing extra only. BBL is otherwise set by permit
 * enrichment via address-based permit API lookup (exact + fuzzy match).
 */
export async function getBBLForProperty(propertyId: string): Promise<ResolvedBBL | null> {
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
    return { bbl, bin: bin ?? null };
  }

  const fromListing = await resolveBBLFromListing(matchRepo, listingRepo, propertyId);
  if (fromListing?.bbl) {
    const merge: Record<string, unknown> = { bbl: fromListing.bbl };
    if (fromListing.bin) merge.bin = fromListing.bin;
    if (fromListing.lat != null) merge.lat = fromListing.lat;
    if (fromListing.lon != null) merge.lon = fromListing.lon;
    await propertyRepo.mergeDetails(propertyId, merge);
    return { bbl: fromListing.bbl, bin: fromListing.bin ?? null };
  }

  return null;
}
