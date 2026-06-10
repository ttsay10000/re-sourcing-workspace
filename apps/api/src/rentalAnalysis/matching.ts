/**
 * Rental comp matching: rank competitor listings against a target acquisition
 * property by relevance, not just distance. Score components mirror the spec
 * (distance, neighborhood, bedrooms, sqft similarity, confidence, term
 * comparability) and each result carries a human explanation + display labels.
 */

import type { CompetitorListing, RentalCompMatchScore, RentalConfidence } from "@re-sourcing/contracts";

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface MatchTarget {
  propertyId: string;
  latitude?: number | null;
  longitude?: number | null;
  neighborhood?: string | null;
  borough?: string | null;
  /** Typical bedroom count of the target's units (median of the mix). */
  beds?: number | null;
  /** Typical unit square footage when known. */
  unitSqft?: number | null;
}

export interface MatchableObservation {
  confidence: RentalConfidence;
  normalizationStatus: string;
  availabilityStatus: string;
}

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/** 0–25: full credit inside ~0.35mi, fading to 0 by 2.5mi. */
function distanceScoreOf(miles: number | null): number {
  if (miles == null) return 8; // unknown coordinates: mild neutral credit
  if (miles <= 0.35) return 25;
  if (miles >= 2.5) return 0;
  return Math.round(25 * (1 - (miles - 0.35) / (2.5 - 0.35)));
}

/** 0–20: exact bedroom match 20, ±1 gets 10, otherwise 0. Unknown 6. */
function bedroomScoreOf(targetBeds: number | null | undefined, listingBeds: number | null | undefined): number {
  if (targetBeds == null || listingBeds == null) return 6;
  const diff = Math.abs(targetBeds - listingBeds);
  if (diff === 0) return 20;
  if (diff <= 1) return 10;
  return 0;
}

/** 0–15 by sqft ratio similarity. Unknown 5. */
function sqftScoreOf(targetSqft: number | null | undefined, listingSqft: number | null | undefined): number {
  if (!targetSqft || !listingSqft || targetSqft <= 0 || listingSqft <= 0) return 5;
  const ratio = Math.min(targetSqft, listingSqft) / Math.max(targetSqft, listingSqft);
  if (ratio >= 0.85) return 15;
  if (ratio >= 0.7) return 10;
  if (ratio >= 0.5) return 5;
  return 0;
}

/** 0–15: same neighborhood 15, same borough 7, otherwise 0. */
function neighborhoodScoreOf(target: MatchTarget, listing: CompetitorListing): number {
  if (norm(target.neighborhood) && norm(target.neighborhood) === norm(listing.neighborhood)) return 15;
  if (norm(target.borough) && norm(target.borough) === norm(listing.borough)) return 7;
  return 0;
}

/** 0–15 from the best observation's confidence + normalization cleanliness. */
function confidenceScoreOf(observation: MatchableObservation | null): number {
  if (!observation) return 0;
  const base = observation.confidence === "high" ? 12 : observation.confidence === "medium" ? 8 : 4;
  const cleanBonus =
    observation.normalizationStatus === "subtotal_clean_no_fees_taxes" ||
    observation.normalizationStatus === "discount_removed"
      ? 3
      : 0;
  return base + cleanBonus;
}

/** 0–10: full when bookable monthly, 0 when excluded for terms. */
function termScoreOf(listing: CompetitorListing): number {
  if (listing.excludedFromComps) return 0;
  if (listing.minStayNights != null && listing.minStayNights > 31) return 5;
  return 10;
}

export function scoreRentalComp(
  target: MatchTarget,
  listing: CompetitorListing,
  observation: MatchableObservation | null
): RentalCompMatchScore {
  const distanceMiles =
    target.latitude != null && target.longitude != null && listing.latitude != null && listing.longitude != null
      ? haversineMiles(target.latitude, target.longitude, listing.latitude, listing.longitude)
      : null;

  const distanceScore = distanceScoreOf(distanceMiles);
  const bedroomMatchScore = bedroomScoreOf(target.beds, listing.beds);
  const sqftSimilarityScore = sqftScoreOf(target.unitSqft, listing.sqft);
  const neighborhoodScore = neighborhoodScoreOf(target, listing);
  const confidenceScore = confidenceScoreOf(observation);
  const termComparabilityScore = termScoreOf(listing);

  const totalScore =
    distanceScore +
    bedroomMatchScore +
    sqftSimilarityScore +
    neighborhoodScore +
    confidenceScore +
    termComparabilityScore;

  const labels: string[] = [];
  const explanationParts: string[] = [];

  if (listing.excludedFromComps) {
    labels.push(listing.exclusionReason === "Minimum stay exceeds monthly comp threshold"
      ? "Excluded: minimum stay too long"
      : "Excluded");
    explanationParts.push(listing.exclusionReason ?? "Excluded from comps");
  }
  if (distanceMiles != null && distanceMiles <= 0.5) {
    labels.push("Nearby");
    explanationParts.push(`${distanceMiles.toFixed(2)} mi away`);
  } else if (distanceMiles != null) {
    explanationParts.push(`${distanceMiles.toFixed(1)} mi away`);
  }
  if (neighborhoodScore === 15) {
    explanationParts.push("same neighborhood");
  } else if (neighborhoodScore === 7) {
    explanationParts.push("same borough");
  }
  if (bedroomMatchScore === 20) {
    labels.push("Same bedroom count");
    explanationParts.push(`${listing.beds} BR match`);
  }
  if (sqftSimilarityScore >= 10 && listing.sqft != null) {
    labels.push("Similar SF");
    explanationParts.push(`${Math.round(listing.sqft)} SF comparable`);
  }
  if (observation?.confidence === "high") {
    labels.push("High confidence");
    explanationParts.push("high-confidence pricing");
  }

  return {
    listingId: listing.id,
    targetPropertyId: target.propertyId,
    totalScore,
    distanceScore,
    bedroomMatchScore,
    sqftSimilarityScore,
    neighborhoodScore,
    qualityScore: null,
    confidenceScore,
    termComparabilityScore,
    explanation: explanationParts.length > 0 ? explanationParts.join("; ") : "Limited match data",
    labels,
    distanceMiles: distanceMiles != null ? Math.round(distanceMiles * 100) / 100 : null,
  };
}

/**
 * Rank listings for a target; the best overall (non-excluded) result gets the
 * "Best match" label prepended.
 */
export function rankRentalComps(
  target: MatchTarget,
  rows: Array<{ listing: CompetitorListing; observation: MatchableObservation | null }>
): RentalCompMatchScore[] {
  const scored = rows
    .map(({ listing, observation }) => scoreRentalComp(target, listing, observation))
    .sort((a, b) => b.totalScore - a.totalScore);
  const best = scored.find((score) => !score.labels.some((label) => label.startsWith("Excluded")));
  if (best) best.labels = ["Best match", ...best.labels];
  return scored;
}
