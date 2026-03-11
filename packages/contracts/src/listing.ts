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
  /** Rental/rent price history (date, price, event) when applicable. */
  rentalPriceHistory?: PriceHistoryEntry[] | null;
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

/** Derived listing activity summary from price history; not persisted directly. */
export interface ListingActivitySummary {
  /** Date to sort on: latest market activity date, else listed date. */
  sortDate: string | null;
  /** Latest dated price-history event, normalized to YYYY-MM-DD when parseable. */
  lastActivityDate: string | null;
  /** Raw latest event type from price history, e.g. LISTED or Price Decrease. */
  lastActivityEvent: string | null;
  /** Latest event price when parseable. */
  lastActivityPrice: number | null;
  /** True when price history provides an activity signal beyond a stale updated_at timestamp. */
  hasMeaningfulActivity: boolean;
  /** Most recent event where the price changed versus the prior event. */
  latestPriceChangeDate: string | null;
  latestPriceChangeEvent: string | null;
  latestPriceChangePrice: number | null;
  /** Signed change vs. the prior event. Negative = price cut. */
  latestPriceChangeAmount: number | null;
  /** Signed percent change vs. the prior event. Negative = price cut. */
  latestPriceChangePercent: number | null;
  /** Convenience fields for the latest price decrease, if any. */
  latestPriceDecreaseDate: string | null;
  latestPriceDecreasePrice: number | null;
  latestPriceDecreaseAmount: number | null;
  latestPriceDecreasePercent: number | null;
  totalPriceDrops: number;
  /** Current ask discount versus the original listed price for the active history chain. */
  currentDiscountFromOriginalAskAmount: number | null;
  currentDiscountFromOriginalAskPct: number | null;
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
  /** Derived from listedAt + priceHistory on read; not guaranteed to be persisted. */
  lastActivity?: ListingActivitySummary | null;
  createdAt: string;
  updatedAt: string;
}
