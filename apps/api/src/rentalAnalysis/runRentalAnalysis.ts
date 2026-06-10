/**
 * Collection run orchestrator: discover → metadata → exclusion → pricing →
 * store, with per-stage error capture for the diagnostics view.
 *
 * Pricing strategy per listing:
 * - When the adapter supports date quotes, sample the 12-month QuoteSpec
 *   calendar (calendar-month + rolling-30; duration ladder for
 *   discount-sensitive sources).
 * - Otherwise fall back to one visible-price observation per forward month
 *   ("effective_rate_only"), so the Rental Analysis tab still has monthly
 *   rows to render and the calendar architecture stays in place.
 */

import type { CompetitorSource, QuoteSpec } from "@re-sourcing/contracts";
import { getPool } from "@re-sourcing/db";
import { getAdapter } from "./adapters/registry.js";
import { SourceUnavailableError, type DiscoveredListing } from "./adapters/types.js";
import { evaluateExclusion } from "./exclusion.js";
import { normalizeQuote } from "./normalize.js";
import { generateQuoteSpecs } from "./quoteSpecs.js";
import {
  createScrapeRun,
  finishScrapeRun,
  insertObservation,
  recordScrapeError,
  upsertCompetitorListing,
  type ScrapeRunCounts,
} from "./store.js";

const MAX_LISTINGS_PER_RUN = Number(process.env.RENTAL_MAX_LISTINGS_PER_RUN) || 60;
const MAX_QUOTES_PER_LISTING = Number(process.env.RENTAL_MAX_QUOTES_PER_LISTING) || 24;

interface VisiblePricing {
  monthlyRate: number | null;
  adr: number | null;
}

export interface RunRentalAnalysisResult {
  runId: string;
  source: CompetitorSource;
  status: "completed" | "failed";
  counts: ScrapeRunCounts;
  note: string | null;
}

export async function runRentalAnalysis(source: CompetitorSource): Promise<RunRentalAnalysisResult> {
  const pool = getPool();
  const adapter = getAdapter(source);
  const quoteSpecs = generateQuoteSpecs({
    includeDurationLadder: source === "blueground",
  });
  const runId = await createScrapeRun(pool, source, quoteSpecs);

  const counts: ScrapeRunCounts = {
    discoveredCount: 0,
    metadataSuccessCount: 0,
    metadataFailureCount: 0,
    pricingSuccessCount: 0,
    pricingFailureCount: 0,
    excludedCount: 0,
  };
  let note: string | null = null;

  const fail = async (stage: Parameters<typeof recordScrapeError>[3], err: unknown, url?: string | null) => {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = err instanceof SourceUnavailableError ? err.retryable : true;
    await recordScrapeError(pool, runId, source, stage, message, { url, retryable });
    return message;
  };

  try {
    if (!adapter.enabled) {
      throw new SourceUnavailableError(source, `${source} source is not enabled yet (coming soon).`, false);
    }

    let discovered: DiscoveredListing[];
    try {
      discovered = await adapter.discoverListings();
    } catch (err) {
      note = await fail("discovery", err);
      await finishScrapeRun(pool, runId, "failed", counts, note);
      return { runId, source, status: "failed", counts, note };
    }
    counts.discoveredCount = discovered.length;
    const limited = discovered.slice(0, MAX_LISTINGS_PER_RUN);
    if (discovered.length > limited.length) {
      note = `Capped at ${MAX_LISTINGS_PER_RUN} of ${discovered.length} discovered listings (RENTAL_MAX_LISTINGS_PER_RUN).`;
    }

    for (const discoveredListing of limited) {
      let merged: DiscoveredListing = discoveredListing;
      let visiblePricing: VisiblePricing | null = null;

      try {
        const metadata = await adapter.fetchListingMetadata(discoveredListing);
        const { visiblePricing: pricing, ...fields } = metadata as Partial<DiscoveredListing> & {
          visiblePricing?: VisiblePricing;
        };
        visiblePricing = pricing ?? null;
        merged = { ...discoveredListing, ...fields };
        counts.metadataSuccessCount++;
      } catch (err) {
        counts.metadataFailureCount++;
        await fail("metadata", err, discoveredListing.url);
        if (err instanceof SourceUnavailableError && !err.retryable) throw err;
        continue;
      }

      const exclusion = evaluateExclusion({ minStayNights: merged.minStayNights ?? null });
      if (exclusion.excluded) {
        counts.excludedCount++;
        merged = {
          ...merged,
          excludedFromComps: true,
          exclusionReason: exclusion.reason,
          scrapeStatus: "excluded",
        };
      }

      let stored;
      try {
        stored = await upsertCompetitorListing(pool, merged);
      } catch (err) {
        await fail("storage", err, merged.url);
        continue;
      }

      // Pricing pass. Excluded listings keep their stored row but are not
      // priced — they are diagnostics-only until the user opts in.
      if (stored.excludedFromComps) continue;

      let priced = false;
      if (adapter.supportsDateQuotes) {
        for (const quoteSpec of quoteSpecs.slice(0, MAX_QUOTES_PER_LISTING)) {
          try {
            const draft = await adapter.fetchQuote(stored, quoteSpec);
            await insertObservation(pool, runId, draft);
            priced = true;
          } catch (err) {
            await fail("quote_fetch", err, stored.url);
            if (err instanceof SourceUnavailableError && !err.retryable) throw err;
            break;
          }
        }
      } else if (visiblePricing && (visiblePricing.monthlyRate != null || visiblePricing.adr != null)) {
        // Visible-price fallback: one effective_rate_only observation per
        // forward month keeps the monthly calendar shape.
        const monthlySpecs = quoteSpecs.filter((spec: QuoteSpec) => spec.quoteType === "calendar_month");
        for (const quoteSpec of monthlySpecs) {
          try {
            const draft = normalizeQuote({
              listingId: stored.id,
              listingUrl: stored.url,
              source,
              quoteSpec,
              line: {
                displayedMonthlyRate: visiblePricing.monthlyRate,
                displayedAdr: visiblePricing.adr,
                rawText: "visible listing price fallback",
              },
            });
            await insertObservation(pool, runId, draft);
            priced = true;
          } catch (err) {
            await fail("storage", err, stored.url);
            break;
          }
        }
      }

      if (priced) {
        counts.pricingSuccessCount++;
        await pool.query(`UPDATE competitor_listings SET scrape_status = 'pricing_collected', updated_at = now() WHERE id = $1`, [stored.id]);
      } else {
        counts.pricingFailureCount++;
        await recordScrapeError(pool, runId, source, "quote_fetch", "No pricing observation produced for listing.", {
          listingId: stored.id,
          url: stored.url,
          retryable: true,
        });
        await pool.query(`UPDATE competitor_listings SET scrape_status = 'pricing_failed', updated_at = now() WHERE id = $1`, [stored.id]);
      }
    }

    await finishScrapeRun(pool, runId, "completed", counts, note);
    return { runId, source, status: "completed", counts, note };
  } catch (err) {
    note = err instanceof Error ? err.message : String(err);
    if (!(err instanceof SourceUnavailableError)) {
      await recordScrapeError(pool, runId, source, "discovery", note, { retryable: true });
    }
    await finishScrapeRun(pool, runId, "failed", counts, note);
    return { runId, source, status: "failed", counts, note };
  }
}
