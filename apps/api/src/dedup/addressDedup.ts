/**
 * Fuzzy address deduplication: compute duplicate likelihood score (0-100) per listing
 * by comparing normalized address strings. 100 = likely duplicate.
 */

import stringSimilarity from "string-similarity";

const DUPLICATE_SCORE_THRESHOLD = 80;

export function getDuplicateScoreThreshold(): number {
  const env = process.env.DUPLICATE_SCORE_THRESHOLD;
  if (env != null) {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
  }
  return DUPLICATE_SCORE_THRESHOLD;
}

/** Normalize only the address line for similarity; avoid inflating scores with shared city/state/zip. */
function normalizeAddressForCompare(address: string): string {
  return (address ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface ListingForDedup {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * For each listing, compute max similarity (0-1) with any other listing by normalized address.
 * Return duplicate score 0-100 (100 = duplicate). Same listing is skipped (no self-match).
 */
export function computeDuplicateScores(listings: ListingForDedup[]): { id: string; duplicateScore: number }[] {
  if (listings.length === 0) return [];

  const normalized = listings.map((l) => normalizeAddressForCompare(l.address));

  return listings.map((listing, i) => {
    let maxSim = 0;
    for (let j = 0; j < listings.length; j++) {
      if (i === j) continue;
      const sim = stringSimilarity.compareTwoStrings(normalized[i], normalized[j]);
      if (sim > maxSim) maxSim = sim;
    }
    const duplicateScore = Math.round(maxSim * 100);
    return { id: listing.id, duplicateScore };
  });
}
