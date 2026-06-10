/**
 * Rental Analysis persistence: competitor listings upsert on
 * (source, source_listing_id); observations append-only per run so pricing
 * history and seasonality stay reconstructable.
 */

import type { Pool } from "pg";
import type {
  CompetitorListing,
  CompetitorSource,
  MonthlyRateObservation,
  RentalScrapeRunSummary,
  RentalScrapeStage,
} from "@re-sourcing/contracts";
import type { DiscoveredListing, ObservationDraft } from "./adapters/types.js";

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date().toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

export function mapCompetitorListing(row: Record<string, unknown>): CompetitorListing {
  return {
    id: String(row.id),
    source: row.source as CompetitorSource,
    sourceListingId: String(row.source_listing_id),
    url: String(row.url),
    title: (row.title as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    neighborhood: (row.neighborhood as string | null) ?? null,
    borough: (row.borough as string | null) ?? null,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    beds: toNumber(row.beds),
    baths: toNumber(row.baths),
    sqft: toNumber(row.sqft),
    guests: toNumber(row.guests),
    minStayNights: toNumber(row.min_stay_nights),
    maxStayNights: toNumber(row.max_stay_nights),
    availableFrom: toIsoOrNull(row.available_from)?.slice(0, 10) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    excludedFromComps: Boolean(row.excluded_from_comps),
    exclusionReason: (row.exclusion_reason as string | null) ?? null,
    scrapeStatus: row.scrape_status as CompetitorListing["scrapeStatus"],
    scrapeTimestamp: toIso(row.scrape_timestamp),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapObservation(row: Record<string, unknown>): MonthlyRateObservation {
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    source: row.source as CompetitorSource,
    listingUrl: String(row.listing_url),
    checkIn: toIso(row.check_in).slice(0, 10),
    checkOut: toIso(row.check_out).slice(0, 10),
    nights: toNumber(row.nights) ?? 0,
    calendarMonth: (row.calendar_month as string | null) ?? null,
    quoteType: row.quote_type as MonthlyRateObservation["quoteType"],
    availabilityStatus: row.availability_status as MonthlyRateObservation["availabilityStatus"],
    displayedAdr: toNumber(row.displayed_adr),
    displayedMonthlyRate: toNumber(row.displayed_monthly_rate),
    accommodationSubtotalEffective: toNumber(row.accommodation_subtotal_effective),
    accommodationSubtotalUndiscounted: toNumber(row.accommodation_subtotal_undiscounted),
    effectiveAdr: toNumber(row.effective_adr),
    undiscountedAdr: toNumber(row.undiscounted_adr),
    effectiveMonthlyEquivalent: toNumber(row.effective_monthly_equivalent),
    undiscountedMonthlyEquivalent: toNumber(row.undiscounted_monthly_equivalent),
    discountAmount: toNumber(row.discount_amount),
    discountLabels: Array.isArray(row.discount_labels) ? (row.discount_labels as string[]) : null,
    feesExcluded: Boolean(row.fees_excluded),
    taxesExcluded: Boolean(row.taxes_excluded),
    cleaningFee: toNumber(row.cleaning_fee),
    serviceFee: toNumber(row.service_fee),
    taxes: toNumber(row.taxes),
    otherFees: toNumber(row.other_fees),
    normalizationStatus: row.normalization_status as MonthlyRateObservation["normalizationStatus"],
    confidence: row.confidence as MonthlyRateObservation["confidence"],
    rawText: (row.raw_text as string | null) ?? null,
    scrapedAt: toIso(row.scraped_at),
  };
}

export async function upsertCompetitorListing(
  pool: Pool,
  listing: DiscoveredListing
): Promise<CompetitorListing> {
  const result = await pool.query(
    `INSERT INTO competitor_listings (
       source, source_listing_id, url, title, address, neighborhood, borough,
       latitude, longitude, beds, baths, sqft, guests,
       min_stay_nights, max_stay_nights, available_from, image_url,
       excluded_from_comps, exclusion_reason, scrape_status, scrape_timestamp, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now(), now()
     )
     ON CONFLICT (source, source_listing_id) DO UPDATE SET
       url = EXCLUDED.url,
       title = COALESCE(EXCLUDED.title, competitor_listings.title),
       address = COALESCE(EXCLUDED.address, competitor_listings.address),
       neighborhood = COALESCE(EXCLUDED.neighborhood, competitor_listings.neighborhood),
       borough = COALESCE(EXCLUDED.borough, competitor_listings.borough),
       latitude = COALESCE(EXCLUDED.latitude, competitor_listings.latitude),
       longitude = COALESCE(EXCLUDED.longitude, competitor_listings.longitude),
       beds = COALESCE(EXCLUDED.beds, competitor_listings.beds),
       baths = COALESCE(EXCLUDED.baths, competitor_listings.baths),
       sqft = COALESCE(EXCLUDED.sqft, competitor_listings.sqft),
       guests = COALESCE(EXCLUDED.guests, competitor_listings.guests),
       min_stay_nights = COALESCE(EXCLUDED.min_stay_nights, competitor_listings.min_stay_nights),
       max_stay_nights = COALESCE(EXCLUDED.max_stay_nights, competitor_listings.max_stay_nights),
       available_from = COALESCE(EXCLUDED.available_from, competitor_listings.available_from),
       image_url = COALESCE(EXCLUDED.image_url, competitor_listings.image_url),
       excluded_from_comps = EXCLUDED.excluded_from_comps,
       exclusion_reason = EXCLUDED.exclusion_reason,
       scrape_status = EXCLUDED.scrape_status,
       scrape_timestamp = now(),
       updated_at = now()
     RETURNING *`,
    [
      listing.source,
      listing.sourceListingId,
      listing.url,
      listing.title ?? null,
      listing.address ?? null,
      listing.neighborhood ?? null,
      listing.borough ?? null,
      listing.latitude ?? null,
      listing.longitude ?? null,
      listing.beds ?? null,
      listing.baths ?? null,
      listing.sqft ?? null,
      listing.guests ?? null,
      listing.minStayNights ?? null,
      listing.maxStayNights ?? null,
      listing.availableFrom ?? null,
      listing.imageUrl ?? null,
      listing.excludedFromComps,
      listing.exclusionReason ?? null,
      listing.scrapeStatus,
    ]
  );
  return mapCompetitorListing(result.rows[0]);
}

export async function insertObservation(
  pool: Pool,
  runId: string | null,
  draft: ObservationDraft
): Promise<MonthlyRateObservation> {
  const result = await pool.query(
    `INSERT INTO competitor_rate_observations (
       listing_id, run_id, source, listing_url, check_in, check_out, nights, calendar_month,
       quote_type, availability_status, displayed_adr, displayed_monthly_rate,
       accommodation_subtotal_effective, accommodation_subtotal_undiscounted,
       effective_adr, undiscounted_adr, effective_monthly_equivalent, undiscounted_monthly_equivalent,
       discount_amount, discount_labels, fees_excluded, taxes_excluded,
       cleaning_fee, service_fee, taxes, other_fees,
       normalization_status, confidence, raw_text, scraped_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
     )
     RETURNING *`,
    [
      draft.listingId,
      runId,
      draft.source,
      draft.listingUrl,
      draft.checkIn,
      draft.checkOut,
      draft.nights,
      draft.calendarMonth ?? null,
      draft.quoteType,
      draft.availabilityStatus,
      draft.displayedAdr ?? null,
      draft.displayedMonthlyRate ?? null,
      draft.accommodationSubtotalEffective ?? null,
      draft.accommodationSubtotalUndiscounted ?? null,
      draft.effectiveAdr ?? null,
      draft.undiscountedAdr ?? null,
      draft.effectiveMonthlyEquivalent ?? null,
      draft.undiscountedMonthlyEquivalent ?? null,
      draft.discountAmount ?? null,
      JSON.stringify(draft.discountLabels ?? []),
      draft.feesExcluded,
      draft.taxesExcluded,
      draft.cleaningFee ?? null,
      draft.serviceFee ?? null,
      draft.taxes ?? null,
      draft.otherFees ?? null,
      draft.normalizationStatus,
      draft.confidence,
      draft.rawText ?? null,
      draft.scrapedAt,
    ]
  );
  return mapObservation(result.rows[0]);
}

export async function createScrapeRun(pool: Pool, source: CompetitorSource, quoteSpecs: unknown): Promise<string> {
  const result = await pool.query(
    `INSERT INTO competitor_scrape_runs (source, status, quote_specs) VALUES ($1, 'running', $2) RETURNING id`,
    [source, JSON.stringify(quoteSpecs ?? null)]
  );
  return String(result.rows[0].id);
}

export interface ScrapeRunCounts {
  discoveredCount: number;
  metadataSuccessCount: number;
  metadataFailureCount: number;
  pricingSuccessCount: number;
  pricingFailureCount: number;
  excludedCount: number;
}

export async function finishScrapeRun(
  pool: Pool,
  runId: string,
  status: "completed" | "failed",
  counts: ScrapeRunCounts,
  note?: string | null
): Promise<void> {
  await pool.query(
    `UPDATE competitor_scrape_runs SET
       status = $2, finished_at = now(),
       discovered_count = $3, metadata_success_count = $4, metadata_failure_count = $5,
       pricing_success_count = $6, pricing_failure_count = $7, excluded_count = $8,
       note = $9
     WHERE id = $1`,
    [
      runId,
      status,
      counts.discoveredCount,
      counts.metadataSuccessCount,
      counts.metadataFailureCount,
      counts.pricingSuccessCount,
      counts.pricingFailureCount,
      counts.excludedCount,
      note ?? null,
    ]
  );
}

export async function recordScrapeError(
  pool: Pool,
  runId: string | null,
  source: CompetitorSource,
  stage: RentalScrapeStage,
  message: string,
  options: { listingId?: string | null; url?: string | null; retryable?: boolean } = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO competitor_scrape_errors (run_id, source, listing_id, url, stage, message, retryable)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [runId, source, options.listingId ?? null, options.url ?? null, stage, message.slice(0, 2000), options.retryable ?? false]
  );
}

export async function listScrapeRuns(pool: Pool, limit = 20): Promise<RentalScrapeRunSummary[]> {
  const runs = await pool.query(
    `SELECT r.*,
       (SELECT COUNT(*) FROM competitor_scrape_errors e WHERE e.run_id = r.id) AS error_count
     FROM competitor_scrape_runs r
     ORDER BY r.started_at DESC
     LIMIT $1`,
    [limit]
  );
  return runs.rows.map((row) => ({
    id: String(row.id),
    source: row.source as CompetitorSource,
    status: row.status as RentalScrapeRunSummary["status"],
    startedAt: toIso(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
    discoveredCount: toNumber(row.discovered_count) ?? 0,
    metadataSuccessCount: toNumber(row.metadata_success_count) ?? 0,
    metadataFailureCount: toNumber(row.metadata_failure_count) ?? 0,
    pricingSuccessCount: toNumber(row.pricing_success_count) ?? 0,
    pricingFailureCount: toNumber(row.pricing_failure_count) ?? 0,
    excludedCount: toNumber(row.excluded_count) ?? 0,
    errorCount: toNumber(row.error_count) ?? 0,
    note: (row.note as string | null) ?? null,
  }));
}

export async function listRunErrors(pool: Pool, runId: string, limit = 100) {
  const result = await pool.query(
    `SELECT * FROM competitor_scrape_errors WHERE run_id = $1 ORDER BY created_at LIMIT $2`,
    [runId, limit]
  );
  return result.rows.map((row) => ({
    source: row.source as CompetitorSource,
    listingId: row.listing_id != null ? String(row.listing_id) : null,
    url: (row.url as string | null) ?? null,
    stage: row.stage as RentalScrapeStage,
    message: String(row.message),
    retryable: Boolean(row.retryable),
    createdAt: toIso(row.created_at),
  }));
}
