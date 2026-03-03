/**
 * Address deduplication: duplicate likelihood score (0-100) per listing.
 * Only scores high when both street number and street name match; otherwise 0.
 * 100 = likely duplicate (same building).
 */

import stringSimilarity from "string-similarity";
import { stripUnitFromAddressLine } from "../enrichment/resolvePropertyBBL.js";

const DUPLICATE_SCORE_THRESHOLD = 80;

export function getDuplicateScoreThreshold(): number {
  const env = process.env.DUPLICATE_SCORE_THRESHOLD;
  if (env != null) {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
  }
  return DUPLICATE_SCORE_THRESHOLD;
}

function normalizeAddressForCompare(address: string): string {
  return (address ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse address line into street number (first token) and street name (rest). Strips units first. */
function parseAddressParts(addressLine: string): { streetNumber: string; streetName: string } {
  const normalized = normalizeAddressForCompare(addressLine);
  const stripped = stripUnitFromAddressLine(normalized);
  const parts = stripped.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { streetNumber: "", streetName: "" };
  if (parts.length === 1) return { streetNumber: parts[0] ?? "", streetName: "" };
  return {
    streetNumber: parts[0] ?? "",
    streetName: parts.slice(1).join(" "),
  };
}

/** Normalize street number for comparison (e.g. "123-A" → "123a"). */
function normalizeStreetNumber(token: string): string {
  return (token ?? "").toLowerCase().replace(/\W/g, "").trim();
}

export interface ListingForDedup {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * For each listing, compute duplicate score 0-100. Only scores high when another listing
 * has the same street number and a similar street name (same building). If street number
 * or street name does not match, score is 0. Same listing is skipped (no self-match).
 */
export function computeDuplicateScores(listings: ListingForDedup[]): { id: string; duplicateScore: number }[] {
  if (listings.length === 0) return [];

  const parts = listings.map((l) => parseAddressParts(l.address));

  return listings.map((listing, i) => {
    let maxScore = 0;
    const numI = normalizeStreetNumber(parts[i].streetNumber);
    const nameI = parts[i].streetName;
    for (let j = 0; j < listings.length; j++) {
      if (i === j) continue;
      const numJ = normalizeStreetNumber(parts[j].streetNumber);
      if (!numI || !numJ || numI !== numJ) continue;
      if (!nameI || !parts[j].streetName) continue;
      const sim = stringSimilarity.compareTwoStrings(nameI, parts[j].streetName);
      const score = Math.round(sim * 100);
      if (score > maxScore) maxScore = score;
    }
    return { id: listing.id, duplicateScore: maxScore };
  });
}
