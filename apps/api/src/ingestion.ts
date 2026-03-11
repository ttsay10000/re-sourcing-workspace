/**
 * Ingestion scaffolding: source agents for search/listings.
 * NYC Real Estate API is used via the StreetEasy Agent flow and dedicated client; no URL-based search.
 */

import type { SearchProfile } from "@re-sourcing/contracts";

/**
 * Get search URLs for a profile.
 * NYC API is not URL-based; returns empty array. Use nycRealEstateApi for direct fetch.
 */
export function getSearchUrlsForProfile(_profile: SearchProfile): string[] {
  return [];
}

/**
 * Integration hook: log that ingestion uses NYC API (no StreetEasy URLs).
 */
export function logSearchUrlsForProfile(profile: SearchProfile): void {
  console.log("[ingestion] Profile", profile.id, "— NYC Real Estate API (no search URLs).");
}
