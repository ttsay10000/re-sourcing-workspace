/**
 * Provider adapter architecture. One adapter per competitor source; the
 * orchestrator only talks to this interface, so Rove/Blueground slot in
 * without touching the run pipeline.
 *
 * Compliance contract for every adapter implementation:
 * - public pages / public APIs / visible quote flows only;
 * - never bypass authentication, paywalls, CAPTCHAs, or bot defenses;
 * - respect robots.txt and rate limits;
 * - when a source blocks automated access, throw SourceUnavailableError so
 *   the run marks the source unavailable instead of attempting evasion.
 */

import type {
  CompetitorListing,
  CompetitorSource,
  MonthlyRateObservation,
  QuoteSpec,
} from "@re-sourcing/contracts";

/** Listing fields an adapter can produce before storage assigns ids. */
export type DiscoveredListing = Omit<CompetitorListing, "id" | "scrapeTimestamp" | "updatedAt"> & {
  scrapeTimestamp?: string;
};

export type ObservationDraft = Omit<MonthlyRateObservation, "id">;

export class SourceUnavailableError extends Error {
  readonly source: CompetitorSource;
  readonly retryable: boolean;

  constructor(source: CompetitorSource, message: string, retryable = false) {
    super(message);
    this.name = "SourceUnavailableError";
    this.source = source;
    this.retryable = retryable;
  }
}

export interface PricingProviderAdapter {
  source: CompetitorSource;
  /** False while an adapter is registered but not yet implemented ("coming soon"). */
  enabled: boolean;
  /** Whether fetchQuote can produce date-specific quotes (vs visible-price fallback only). */
  supportsDateQuotes: boolean;

  discoverListings(): Promise<DiscoveredListing[]>;

  fetchListingMetadata(listing: DiscoveredListing): Promise<Partial<DiscoveredListing>>;

  /**
   * Date-specific quote for one listing. Adapters without a working quote
   * flow yet should throw SourceUnavailableError("...", retryable=true);
   * the orchestrator then falls back to visible-price observations.
   */
  fetchQuote(listing: CompetitorListing, quoteSpec: QuoteSpec): Promise<ObservationDraft>;

  /** Pure normalization (raw payload → observation); unit-testable per source. */
  normalizeQuote(rawQuote: unknown, listing: CompetitorListing, quoteSpec: QuoteSpec): ObservationDraft;
}
