/**
 * Rental Analysis API: competitor furnished-rental listings, monthly rate
 * observations, comp aggregation, target-property matching + suggested MTR
 * rent, and manual collection runs with diagnostics.
 *
 * Reads default to the active comp set (excluded listings hidden) and the
 * undiscounted monthly equivalent; query flags expose the rest.
 */

import { Router, type Request, type Response } from "express";
import { getPool } from "@re-sourcing/db";
import {
  COMPETITOR_SOURCES,
  DEFAULT_MAX_MIN_STAY_NIGHTS,
  type CompetitorListing,
  type CompetitorSource,
  type MonthlyRateObservation,
  type RentalMarketSummary,
} from "@re-sourcing/contracts";
import { listAdapters } from "../rentalAnalysis/adapters/registry.js";
import { haversineMiles, rankRentalComps, type MatchTarget } from "../rentalAnalysis/matching.js";
import { runRentalAnalysis } from "../rentalAnalysis/runRentalAnalysis.js";
import { suggestMtrRent, percentile } from "../rentalAnalysis/suggestRent.js";
import { listRunErrors, listScrapeRuns, mapCompetitorListing, mapObservation } from "../rentalAnalysis/store.js";
import { resolveOperatingYield } from "../deal/operatingYield.js";

const router = Router();

function parseSourceFilter(raw: unknown): CompetitorSource[] {
  if (typeof raw !== "string" || !raw.trim() || raw === "all") return [...COMPETITOR_SOURCES];
  const parts = raw.split(",").map((part) => part.trim().toLowerCase());
  const valid = COMPETITOR_SOURCES.filter((source) => parts.includes(source));
  return valid.length > 0 ? valid : [...COMPETITOR_SOURCES];
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function defaultMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
}

interface ListingWithObservation {
  listing: CompetitorListing;
  observation: MonthlyRateObservation | null;
}

interface ListingQueryFilters {
  sources: CompetitorSource[];
  month: string;
  quoteType: string;
  beds: number | null;
  bathsMin: number | null;
  sqftMin: number | null;
  sqftMax: number | null;
  neighborhood: string | null;
  confidence: string | null;
  includeExcluded: boolean;
  hideLowConfidence: boolean;
}

function parseFilters(req: Request): ListingQueryFilters {
  return {
    sources: parseSourceFilter(req.query.sources),
    month: typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : defaultMonth(),
    quoteType:
      typeof req.query.quoteType === "string" &&
      ["calendar_month", "rolling_30_nights", "rolling_60_nights", "rolling_90_nights", "rolling_180_nights"].includes(req.query.quoteType)
        ? req.query.quoteType
        : "calendar_month",
    beds: toNumber(req.query.beds),
    bathsMin: toNumber(req.query.bathsMin),
    sqftMin: toNumber(req.query.sqftMin),
    sqftMax: toNumber(req.query.sqftMax),
    neighborhood: typeof req.query.neighborhood === "string" && req.query.neighborhood.trim() ? req.query.neighborhood.trim() : null,
    confidence:
      typeof req.query.confidence === "string" && ["high", "medium", "low"].includes(req.query.confidence)
        ? req.query.confidence
        : null,
    includeExcluded: req.query.includeExcluded === "1",
    hideLowConfidence: req.query.hideLowConfidence === "1",
  };
}

/**
 * Listings + their latest observation for the selected month/quote type.
 * Falls back from calendar_month to rolling_30_nights per listing so a
 * source that only produced one quote shape still renders.
 */
async function loadListingsWithObservations(filters: ListingQueryFilters): Promise<ListingWithObservation[]> {
  const pool = getPool();
  const listingsResult = await pool.query(
    `SELECT * FROM competitor_listings
     WHERE source = ANY($1)
       AND ($2 OR excluded_from_comps = false)
     ORDER BY source, neighborhood NULLS LAST, title NULLS LAST`,
    [filters.sources, filters.includeExcluded]
  );
  const listings = listingsResult.rows.map(mapCompetitorListing);
  if (listings.length === 0) return [];

  const observationsResult = await pool.query(
    `SELECT DISTINCT ON (listing_id, quote_type) *
     FROM competitor_rate_observations
     WHERE listing_id = ANY($1)
       AND calendar_month = $2
       AND quote_type IN ($3, 'rolling_30_nights')
     ORDER BY listing_id, quote_type, scraped_at DESC`,
    [listings.map((listing) => listing.id), filters.month, filters.quoteType]
  );
  const byListing = new Map<string, MonthlyRateObservation[]>();
  for (const row of observationsResult.rows) {
    const observation = mapObservation(row);
    byListing.set(observation.listingId, [...(byListing.get(observation.listingId) ?? []), observation]);
  }

  let rows: ListingWithObservation[] = listings.map((listing) => {
    const observations = byListing.get(listing.id) ?? [];
    const preferred =
      observations.find((observation) => observation.quoteType === filters.quoteType) ??
      observations.find((observation) => observation.quoteType === "rolling_30_nights") ??
      null;
    return { listing, observation: preferred };
  });

  rows = rows.filter(({ listing, observation }) => {
    if (filters.beds != null && (listing.beds == null || Math.round(listing.beds) !== Math.round(filters.beds))) return false;
    if (filters.bathsMin != null && (listing.baths == null || listing.baths < filters.bathsMin)) return false;
    if (filters.sqftMin != null && (listing.sqft == null || listing.sqft < filters.sqftMin)) return false;
    if (filters.sqftMax != null && (listing.sqft == null || listing.sqft > filters.sqftMax)) return false;
    if (
      filters.neighborhood &&
      !(listing.neighborhood ?? "").toLowerCase().includes(filters.neighborhood.toLowerCase())
    ) {
      return false;
    }
    if (filters.confidence && observation && observation.confidence !== filters.confidence) return false;
    if (filters.hideLowConfidence && observation?.confidence === "low") return false;
    return true;
  });

  return rows;
}

function monthlyEquivalentOf(observation: MonthlyRateObservation, useEffective: boolean): number | null {
  const value = useEffective
    ? observation.effectiveMonthlyEquivalent ?? observation.undiscountedMonthlyEquivalent
    : observation.undiscountedMonthlyEquivalent ?? observation.effectiveMonthlyEquivalent;
  return value ?? null;
}

function buildSummary(
  rows: ListingWithObservation[],
  filters: ListingQueryFilters,
  totals: { excludedCount: number },
  useEffective: boolean
): RentalMarketSummary {
  const priced = rows.filter(
    (row): row is { listing: CompetitorListing; observation: MonthlyRateObservation } =>
      row.observation != null && monthlyEquivalentOf(row.observation, useEffective) != null
  );
  const monthly = priced
    .map((row) => monthlyEquivalentOf(row.observation, useEffective) as number)
    .sort((a, b) => a - b);
  const adrs = priced
    .map((row) => (useEffective ? row.observation.effectiveAdr : row.observation.undiscountedAdr))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);

  return {
    month: filters.month,
    quoteType: filters.quoteType === "rolling_30_nights" ? "rolling_30_nights" : "calendar_month",
    sourceFilter: filters.sources,
    bedroomCount: filters.beds,
    neighborhood: filters.neighborhood,
    radiusMiles: null,
    compCount: monthly.length,
    excludedCount: totals.excludedCount,
    unavailableCount: rows.filter((row) => row.observation?.availabilityStatus === "unavailable").length,
    lowConfidenceCount: rows.filter((row) => row.observation?.confidence === "low").length,
    averageMonthlyRate:
      monthly.length > 0 ? Math.round(monthly.reduce((sum, value) => sum + value, 0) / monthly.length) : null,
    medianMonthlyRate: monthly.length > 0 ? Math.round(percentile(monthly, 0.5) as number) : null,
    p25MonthlyRate: monthly.length > 0 ? Math.round(percentile(monthly, 0.25) as number) : null,
    p75MonthlyRate: monthly.length > 0 ? Math.round(percentile(monthly, 0.75) as number) : null,
    averageAdr: adrs.length > 0 ? Math.round(adrs.reduce((sum, value) => sum + value, 0) / adrs.length) : null,
    medianAdr: adrs.length > 0 ? Math.round(percentile(adrs, 0.5) as number) : null,
  };
}

/** Source controls: adapter availability for the tab's source buttons. */
router.get("/rental-analysis/sources", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const countsResult = await pool.query(
      `SELECT source,
              COUNT(*) AS listing_count,
              COUNT(*) FILTER (WHERE excluded_from_comps) AS excluded_count,
              MAX(scrape_timestamp) AS last_scraped_at
       FROM competitor_listings GROUP BY source`
    );
    const countsBySource = new Map(countsResult.rows.map((row) => [String(row.source), row]));
    res.json({
      sources: listAdapters().map((adapter) => {
        const counts = countsBySource.get(adapter.source);
        return {
          source: adapter.source,
          enabled: adapter.enabled,
          supportsDateQuotes: adapter.supportsDateQuotes,
          listingCount: counts ? Number(counts.listing_count) : 0,
          excludedCount: counts ? Number(counts.excluded_count) : 0,
          lastScrapedAt: counts?.last_scraped_at ?? null,
        };
      }),
      maxMinStayNights: DEFAULT_MAX_MIN_STAY_NIGHTS,
    });
  } catch (err) {
    console.error("[rental-analysis sources]", err);
    res.status(500).json({ error: "Failed to load rental sources.", details: err instanceof Error ? err.message : String(err) });
  }
});

/** Comp table + map pins for the selected month/quote type/filters. */
router.get("/rental-analysis/listings", async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    const useEffective = req.query.rates === "effective";
    const rows = await loadListingsWithObservations(filters);
    const pool = getPool();
    const excludedTotal = await pool.query(
      `SELECT COUNT(*) AS count FROM competitor_listings WHERE source = ANY($1) AND excluded_from_comps`,
      [filters.sources]
    );
    res.json({
      month: filters.month,
      quoteType: filters.quoteType,
      rows: rows.map(({ listing, observation }) => ({
        listing,
        observation,
        monthlyEquivalent: observation ? monthlyEquivalentOf(observation, useEffective) : null,
      })),
      summary: buildSummary(rows, filters, { excludedCount: Number(excludedTotal.rows[0]?.count ?? 0) }, useEffective),
    });
  } catch (err) {
    console.error("[rental-analysis listings]", err);
    res.status(500).json({ error: "Failed to load rental comps.", details: err instanceof Error ? err.message : String(err) });
  }
});

/** Month-by-month observations for one listing (pricing calendar drill-in). */
router.get("/rental-analysis/listings/:listingId/observations", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT DISTINCT ON (calendar_month, quote_type) *
       FROM competitor_rate_observations
       WHERE listing_id = $1
       ORDER BY calendar_month, quote_type, scraped_at DESC`,
      [req.params.listingId]
    );
    res.json({ observations: result.rows.map(mapObservation) });
  } catch (err) {
    console.error("[rental-analysis observations]", err);
    res.status(500).json({ error: "Failed to load observations.", details: err instanceof Error ? err.message : String(err) });
  }
});

interface TargetPropertyRow {
  propertyId: string;
  address: string;
  neighborhood: string | null;
  borough: string | null;
  lat: number | null;
  lng: number | null;
  units: number | null;
  gsf: number | null;
  medianBeds: number | null;
  unitSqft: number | null;
  mtrYieldPct: number | null;
  ltrYieldPct: number | null;
  askingPrice: number | null;
  monthlyMtrRentAssumption: number | null;
  monthlyLtrRentAssumption: number | null;
}

async function loadTargetProperty(propertyId: string): Promise<TargetPropertyRow | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
       p.id, p.canonical_address, p.lat, p.lng,
       p.details#>>'{neighborhood,primary,name}' AS neighborhood,
       p.details#>>'{neighborhood,primary,borough}' AS borough,
       p.details#>'{omData,authoritative,rentRoll}' AS rent_roll,
       p.details#>>'{omData,authoritative,propertyInfo,totalUnits}' AS om_units,
       p.details#>>'{omData,authoritative,propertyInfo,buildingSqft}' AS om_gsf,
       p.details#>>'{rentalFinancials,fromLlm,monthlyMtrRent}' AS mtr_rent_llm,
       p.details#>>'{rentalFinancials,fromLlm,monthlyLtrRent}' AS ltr_rent_llm,
       ds.asset_cap_rate, ds.adjusted_cap_rate,
       p.details#>>'{manualSourceFacts,askingPrice}' AS ask_manual,
       p.details#>>'{omData,authoritative,propertyInfo,askingPrice}' AS ask_om
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT asset_cap_rate, adjusted_cap_rate FROM deal_signals
       WHERE property_id = p.id ORDER BY generated_at DESC LIMIT 1
     ) ds ON TRUE
     WHERE p.id = $1`,
    [propertyId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const rentRoll = Array.isArray(row.rent_roll) ? (row.rent_roll as Array<Record<string, unknown>>) : [];
  const bedCounts = rentRoll
    .map((unit) => toNumber(unit.beds))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  const unitSqfts = rentRoll
    .map((unit) => toNumber(unit.sqft))
    .filter((value): value is number => value != null && value > 100)
    .sort((a, b) => a - b);

  const units = toNumber(row.om_units);
  const gsf = toNumber(row.om_gsf);
  const signalLtr = toNumber(row.asset_cap_rate);
  const resolved = resolveOperatingYield({ signalLtrPct: signalLtr, fallbackNoi: null, fallbackAsk: null });

  return {
    propertyId: String(row.id),
    address: String(row.canonical_address),
    neighborhood: (row.neighborhood as string | null) ?? null,
    borough: (row.borough as string | null) ?? null,
    lat: toNumber(row.lat),
    lng: toNumber(row.lng),
    units,
    gsf,
    medianBeds: bedCounts.length > 0 ? bedCounts[Math.floor((bedCounts.length - 1) / 2)] : null,
    unitSqft:
      unitSqfts.length > 0
        ? unitSqfts[Math.floor((unitSqfts.length - 1) / 2)]
        : gsf != null && units != null && units > 0
          ? Math.round((gsf * 0.85) / units)
          : null,
    mtrYieldPct: toNumber(row.adjusted_cap_rate),
    ltrYieldPct: resolved.ltrYieldPct,
    askingPrice: toNumber(row.ask_manual) ?? toNumber(row.ask_om),
    monthlyMtrRentAssumption: toNumber(row.mtr_rent_llm),
    monthlyLtrRentAssumption: toNumber(row.ltr_rent_llm),
  };
}

/** Target-property selector options (address + has-coordinates flag). */
router.get("/rental-analysis/targets", async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.id, p.canonical_address, p.lat, p.lng,
              p.details#>>'{neighborhood,primary,name}' AS neighborhood,
              (sd.property_id IS NOT NULL) AS saved
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT property_id FROM saved_deals d WHERE d.property_id = p.id LIMIT 1
       ) sd ON TRUE
       WHERE ($1 = '' OR LOWER(p.canonical_address) LIKE '%' || $1 || '%')
       ORDER BY (sd.property_id IS NOT NULL) DESC, p.created_at DESC
       LIMIT 30`,
      [q]
    );
    res.json({
      targets: result.rows.map((row) => ({
        propertyId: String(row.id),
        address: String(row.canonical_address),
        neighborhood: (row.neighborhood as string | null) ?? null,
        hasCoordinates: row.lat != null && row.lng != null,
        saved: Boolean(row.saved),
      })),
    });
  } catch (err) {
    console.error("[rental-analysis targets]", err);
    res.status(500).json({ error: "Failed to load target properties.", details: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Selected-property comparison: best-matched comps (ranked, labeled),
 * summary stats for the matched set, and the suggested low/base/high MTR rent.
 */
router.get("/rental-analysis/match", async (req: Request, res: Response) => {
  try {
    const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : "";
    if (!propertyId) {
      res.status(400).json({ error: "propertyId is required." });
      return;
    }
    const target = await loadTargetProperty(propertyId);
    if (!target) {
      res.status(404).json({ error: "Property not found." });
      return;
    }

    const filters = parseFilters(req);
    const radiusMiles = toNumber(req.query.radiusMiles) ?? 1.5;
    const useEffective = req.query.rates === "effective";
    const rows = await loadListingsWithObservations({ ...filters, includeExcluded: true });

    const matchTarget: MatchTarget = {
      propertyId: target.propertyId,
      latitude: target.lat,
      longitude: target.lng,
      neighborhood: target.neighborhood,
      borough: target.borough,
      beds: filters.beds ?? target.medianBeds,
      unitSqft: target.unitSqft,
    };

    const withinRadius = rows.filter(({ listing }) => {
      if (target.lat == null || target.lng == null || listing.latitude == null || listing.longitude == null) return true;
      return haversineMiles(target.lat, target.lng, listing.latitude, listing.longitude) <= radiusMiles;
    });

    const scores = rankRentalComps(
      matchTarget,
      withinRadius.map(({ listing, observation }) => ({ listing, observation }))
    );
    const rowByListingId = new Map(withinRadius.map((row) => [row.listing.id, row]));

    const ranked = scores
      .map((score) => {
        const row = rowByListingId.get(score.listingId);
        if (!row) return null;
        return {
          score,
          listing: row.listing,
          observation: row.observation,
          monthlyEquivalent: row.observation ? monthlyEquivalentOf(row.observation, useEffective) : null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);

    const suggestInputs = ranked
      .filter(
        (entry) =>
          !entry.listing.excludedFromComps &&
          entry.observation != null &&
          entry.monthlyEquivalent != null &&
          entry.observation.normalizationStatus !== "pricing_unavailable"
      )
      .slice(0, 10)
      .map((entry) => ({
        monthlyEquivalent: entry.monthlyEquivalent as number,
        adr: useEffective ? entry.observation?.effectiveAdr : entry.observation?.undiscountedAdr,
        confidence: entry.observation!.confidence,
        normalizationStatus: entry.observation!.normalizationStatus,
        distanceMiles: entry.score.distanceMiles,
        bedsMatch:
          matchTarget.beds != null && entry.listing.beds != null
            ? Math.round(matchTarget.beds) === Math.round(entry.listing.beds)
            : false,
      }));

    const suggestedRent = suggestMtrRent(target.propertyId, filters.month, suggestInputs);

    res.json({
      target,
      month: filters.month,
      quoteType: filters.quoteType,
      radiusMiles,
      comps: ranked,
      suggestedRent,
      summary: buildSummary(
        ranked
          .filter((entry) => !entry.listing.excludedFromComps)
          .map((entry) => ({ listing: entry.listing, observation: entry.observation })),
        filters,
        { excludedCount: ranked.filter((entry) => entry.listing.excludedFromComps).length },
        useEffective
      ),
    });
  } catch (err) {
    console.error("[rental-analysis match]", err);
    res.status(500).json({ error: "Failed to build rental comp match.", details: err instanceof Error ? err.message : String(err) });
  }
});

/** Manual collection run (V1). Fire-and-forget; poll /runs for completion. */
router.post("/rental-analysis/refresh", async (req: Request, res: Response) => {
  try {
    const source = typeof req.body?.source === "string" ? (req.body.source as CompetitorSource) : "haus";
    if (!COMPETITOR_SOURCES.includes(source)) {
      res.status(400).json({ error: `Unknown source "${source}".` });
      return;
    }
    const runPromise = runRentalAnalysis(source);
    runPromise.catch((err) => console.error("[rental-analysis refresh]", err));
    if (req.query.wait === "1") {
      const result = await runPromise;
      res.json({ started: true, ...result });
      return;
    }
    res.status(202).json({ started: true, source });
  } catch (err) {
    console.error("[rental-analysis refresh]", err);
    res.status(500).json({ error: "Failed to start rental analysis run.", details: err instanceof Error ? err.message : String(err) });
  }
});

/** Diagnostics: recent runs with stage counts; errors on demand. */
router.get("/rental-analysis/runs", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const runs = await listScrapeRuns(pool, Math.min(toNumber(req.query.limit) ?? 20, 100));
    res.json({ runs });
  } catch (err) {
    console.error("[rental-analysis runs]", err);
    res.status(500).json({ error: "Failed to load runs.", details: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/rental-analysis/runs/:runId/errors", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const errors = await listRunErrors(pool, req.params.runId);
    res.json({ errors });
  } catch (err) {
    console.error("[rental-analysis run errors]", err);
    res.status(500).json({ error: "Failed to load run errors.", details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
