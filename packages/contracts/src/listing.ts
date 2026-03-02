import type { ListingSource } from "./enums.js";

/**
 * Normalized listing shape used by scraper and manual entry.
 * Source-agnostic; all sources map to this form.
 */
export interface ListingNormalized {
  /** Source system (e.g. streeteasy, manual). */
  source: ListingSource;
  /** External ID from the source (e.g. StreetEasy listing ID). */
  externalId: string;
  /** Street / building address line. */
  address: string;
  /** City. */
  city: string;
  /** State or region code. */
  state: string;
  /** Postal code. */
  zip: string;
  /** Asking price in dollars. */
  price: number;
  /** Number of bedrooms. */
  beds: number;
  /** Number of bathrooms. */
  baths: number;
  /** Square footage (optional). */
  sqft?: number | null;
  /** Listing URL. */
  url: string;
  /** Listing title or headline. */
  title?: string | null;
  /** Raw description text. */
  description?: string | null;
  /** Latitude (optional). */
  lat?: number | null;
  /** Longitude (optional). */
  lon?: number | null;
  /** Image URLs (optional). */
  imageUrls?: string[] | null;
  /** Listed date (ISO string). */
  listedAt?: string | null;
  /** Agent names from source (e.g. GET sale details); for LLM enrichment. */
  agentNames?: string[] | null;
  /** Enriched broker/agent data (firm, email, phone) from OpenAI lookup. */
  agentEnrichment?: AgentEnrichmentEntry[] | null;
  /** Price history (date, price, event) extracted from listing URL. */
  priceHistory?: PriceHistoryEntry[] | null;
  /** Any extra fields that don't map to core schema. */
  extra?: Record<string, unknown> | null;
}

/** Single enriched agent entry (firm, email, phone). */
export interface AgentEnrichmentEntry {
  name: string;
  firm?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Single price history row (from Property history section). */
export interface PriceHistoryEntry {
  date: string;
  price: string | number;
  event: string;
}

/**
 * Listing row as stored in DB (includes lifecycle and timestamps).
 */
export interface ListingRow extends ListingNormalized {
  id: string;
  lifecycleState: "active" | "missing" | "pruned";
  firstSeenAt: string;
  lastSeenAt: string;
  missingSince?: string | null;
  prunedAt?: string | null;
  /** When this listing was first sent to property data from a run. */
  uploadedAt?: string | null;
  /** Test run ID that first sent this listing to property data. */
  uploadedRunId?: string | null;
  /** Duplicate likelihood score 0–100 (100 = likely duplicate). */
  duplicateScore?: number | null;
  createdAt: string;
  updatedAt: string;
}
