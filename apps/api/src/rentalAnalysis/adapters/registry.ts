/**
 * Adapter registry. Rove and Blueground are registered but disabled
 * ("coming soon") so the UI source controls, run pipeline, and diagnostics
 * already know about them; flipping enabled=true with a real implementation
 * is the only change needed to launch a source.
 */

import type { CompetitorListing, CompetitorSource, QuoteSpec } from "@re-sourcing/contracts";
import { HausAdapter } from "./hausAdapter.js";
import {
  SourceUnavailableError,
  type DiscoveredListing,
  type ObservationDraft,
  type PricingProviderAdapter,
} from "./types.js";

class ComingSoonAdapter implements PricingProviderAdapter {
  readonly enabled = false;
  readonly supportsDateQuotes = false;

  constructor(readonly source: CompetitorSource) {}

  private unavailable(): never {
    throw new SourceUnavailableError(this.source, `${this.source} adapter is not implemented yet.`, false);
  }

  discoverListings(): Promise<DiscoveredListing[]> {
    this.unavailable();
  }

  fetchListingMetadata(): Promise<Partial<DiscoveredListing>> {
    this.unavailable();
  }

  fetchQuote(_listing: CompetitorListing, _quoteSpec: QuoteSpec): Promise<ObservationDraft> {
    this.unavailable();
  }

  normalizeQuote(): ObservationDraft {
    this.unavailable();
  }
}

const adapters: Record<CompetitorSource, PricingProviderAdapter> = {
  haus: new HausAdapter(),
  rove: new ComingSoonAdapter("rove"),
  blueground: new ComingSoonAdapter("blueground"),
};

export function getAdapter(source: CompetitorSource): PricingProviderAdapter {
  return adapters[source];
}

export function listAdapters(): PricingProviderAdapter[] {
  return Object.values(adapters);
}
