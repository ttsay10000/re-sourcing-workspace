import type { MatchStatus } from "./enums.js";

/**
 * One candidate for matching a listing to a property.
 */
export interface DedupeCandidate {
  propertyId: string;
  confidence: number;
  reasons: DedupeReasons;
}

/**
 * Breakdown of why a match was suggested.
 */
export interface DedupeReasons {
  addressMatch?: boolean;
  normalizedAddressDistance?: number;
  coordinateDistance?: number;
  priceConsistent?: boolean;
  other?: string[];
}

/**
 * Item in the dedupe queue: a listing with its candidates.
 */
export interface DedupeQueueItem {
  listingId: string;
  candidates: DedupeCandidate[];
}

/**
 * Listing–property match row (dedupe result).
 */
export interface ListingPropertyMatch {
  id: string;
  listingId: string;
  propertyId: string;
  confidence: number;
  reasons: DedupeReasons;
  status: MatchStatus;
  createdAt: string;
}
