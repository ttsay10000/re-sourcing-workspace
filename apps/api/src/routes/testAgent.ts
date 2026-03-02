/**
 * Test agent route: two-step NYC Real Estate API flow.
 * POST starts a run (returns runId immediately); backend runs GET Active Sales then GET Sale details per URL.
 * Runs are stored in memory with step progress, timer, and properties (raw data lake).
 * Data is NOT auto-populated to property data; user must click "Send to property data" per run.
 */

import { Router, type Request, type Response } from "express";
import type { ListingNormalized, PriceHistoryEntry } from "@re-sourcing/contracts";
import type { NycsSearchCriteria } from "../nycRealEstateApi.js";
import { fetchActiveSalesWithCriteria, fetchSaleDetailsByUrl } from "../nycRealEstateApi.js";
import { enrichBrokers } from "../enrichment/brokerEnrichment.js";
import { computeDuplicateScores } from "../dedup/addressDedup.js";

const router = Router();

type StepStatus = "pending" | "running" | "completed" | "failed";

/** In-memory store for test runs. */
interface StoredTestRun {
  id: string;
  startedAt: string;
  criteria: RunRequestBody;
  step1Status: StepStatus;
  step1Count: number;
  step1Error: string | null;
  step2Status: StepStatus;
  step2Count: number;
  step2Total: number;
  step2Error: string | null;
  /** Full sale details per URL (raw data lake). */
  properties: Record<string, unknown>[];
  errors: { url?: string; message: string }[];
}

const testRunsStore: StoredTestRun[] = [];

/** Request body: filters sent from frontend; matches Active Sales Search API params. */
export interface RunRequestBody {
  areas: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  maxBeds?: number | null;
  minBaths?: number | null;
  maxHoa?: number | null;
  maxTax?: number | null;
  amenities?: string | null;
  types?: string | null;
  limit?: number | null;
  offset?: number | null;
}

function toCriteria(body: RunRequestBody): NycsSearchCriteria {
  return {
    areas: body.areas?.trim() || "all-downtown,all-midtown",
    minPrice: body.minPrice != null ? Number(body.minPrice) : undefined,
    maxPrice: body.maxPrice != null ? Number(body.maxPrice) : undefined,
    minBeds: body.minBeds != null ? Number(body.minBeds) : undefined,
    maxBeds: body.maxBeds != null ? Number(body.maxBeds) : undefined,
    minBaths: body.minBaths != null ? Number(body.minBaths) : undefined,
    maxHoa: body.maxHoa != null ? Number(body.maxHoa) : undefined,
    maxTax: body.maxTax != null ? Number(body.maxTax) : undefined,
    amenities: body.amenities ?? undefined,
    types: body.types ?? undefined,
    limit: body.limit != null ? Math.min(Number(body.limit), 500) : 100,
    offset: body.offset != null ? Number(body.offset) : undefined,
  };
}

/** Run the two-step flow in the background and update the stored run. */
async function runTwoStepFlow(run: StoredTestRun): Promise<void> {
  const criteria = toCriteria(run.criteria);

  // Step 1: GET Active Sales
  run.step1Status = "running";
  try {
    const { urls } = await fetchActiveSalesWithCriteria(criteria);
    run.step1Count = urls.length;
    run.step1Status = "completed";
    run.step1Error = null;

    // Step 2: GET Sale details by URL for each
    run.step2Total = urls.length;
    run.step2Status = "running";
    run.step2Error = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const details = await fetchSaleDetailsByUrl(urls[i]);
        run.properties.push({ ...details, _fetchUrl: urls[i] });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        run.errors.push({ url: urls[i], message });
      }
      run.step2Count = i + 1;
      // Small delay to avoid rate limits
      if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 200));
    }
    run.step2Status = "completed";
  } catch (err) {
    run.step1Status = "failed";
    run.step1Error = err instanceof Error ? err.message : String(err);
    run.step2Status = "failed";
    run.step2Error = run.step1Error;
  }
}

/** Single route: POST to start a run. Returns runId; two-step flow runs in background. */
router.post("/test-agent/run", (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as RunRequestBody;
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const run: StoredTestRun = {
      id: runId,
      startedAt,
      criteria: body,
      step1Status: "pending",
      step1Count: 0,
      step1Error: null,
      step2Status: "pending",
      step2Count: 0,
      step2Total: 0,
      step2Error: null,
      properties: [],
      errors: [],
    };
    testRunsStore.unshift(run);
    res.status(202).json({ runId, startedAt });

    runTwoStepFlow(run).catch((err) => {
      if (run.step1Status !== "failed") {
        run.step1Status = "failed";
        run.step1Error = err instanceof Error ? err.message : String(err);
      }
      run.step2Status = "failed";
      run.step2Error = run.step1Error;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** List test runs (newest first) with step progress and timer. */
router.get("/test-agent/runs", (_req: Request, res: Response) => {
  const runs = testRunsStore.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    criteria: r.criteria,
    step1Status: r.step1Status,
    step1Count: r.step1Count,
    step1Error: r.step1Error,
    step2Status: r.step2Status,
    step2Count: r.step2Count,
    step2Total: r.step2Total,
    step2Error: r.step2Error,
    propertiesCount: r.properties.length,
    errorsCount: r.errors.length,
  }));
  res.json({ runs });
});

/** Get one test run with full properties (raw data lake). */
router.get("/test-agent/runs/:id", (req: Request, res: Response) => {
  const run = testRunsStore.find((r) => r.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "Test run not found." });
    return;
  }
  res.json(run);
});

/** Map one run property (GET sale details + _fetchUrl) to ListingNormalized. */
function runPropertyToNormalized(raw: Record<string, unknown>, index: number): ListingNormalized {
  const id = raw.id != null ? String(raw.id) : raw.address != null ? String(raw.address) : `run-${index}`;
  const address = (raw.address != null ? String(raw.address) : "").trim() || "—";
  const borough = (raw.borough != null ? String(raw.borough) : "").trim() || "New York";
  const city = borough.charAt(0).toUpperCase() + borough.slice(1).toLowerCase().replace(/-/g, " ");
  const zip = (raw.zipcode != null ? String(raw.zipcode) : raw.zip != null ? String(raw.zip) : "").trim() || "";
  const price = Number(raw.price ?? raw.closedPrice ?? 0) || 0;
  // Preserve decimals (e.g. 7.5 baths); DB stores NUMERIC(4,1). Only clamp to >= 0.
  const bedsNum = Number(raw.bedrooms ?? raw.beds ?? 0) || 0;
  const bathsNum = Number(raw.bathrooms ?? raw.baths ?? 0) || 0;
  const beds = bedsNum >= 0 ? bedsNum : 0;
  const baths = bathsNum >= 0 ? bathsNum : 0;
  // DB sqft is INTEGER; API may return decimals — coerce to whole number or null
  const sqftRaw = raw.sqft != null ? Number(raw.sqft) : NaN;
  const sqft =
    !Number.isNaN(sqftRaw) && sqftRaw >= 0 ? Math.round(sqftRaw) : null;
  const url = (raw._fetchUrl != null ? String(raw._fetchUrl) : raw.url != null ? String(raw.url) : "").trim() || "#";
  const listedAt = raw.listedAt != null ? String(raw.listedAt) : null;
  const images = raw.images;
  const imageUrls = Array.isArray(images) ? (images as string[]).filter((u): u is string => typeof u === "string") : null;
  const agentNames = (() => {
    const a = raw.agents;
    if (Array.isArray(a) && a.length > 0) {
      return a.map((x) => (x != null ? String(x).trim() : "")).filter(Boolean);
    }
    const single = raw.broker_name ?? raw.broker ?? raw.listing_agent ?? raw.agent_name ?? raw.agent;
    if (single != null && String(single).trim()) return [String(single).trim()];
    return null;
  })();
  const latLon = parseLatLonFromRaw(raw);
  const { _fetchUrl: _u, ...rest } = raw;
  const extra = rest as Record<string, unknown>;
  const { monthlyHoa, monthlyTax } = parseMonthlyHoaTaxFromRaw(raw);
  if (monthlyHoa != null) extra.monthlyHoa = monthlyHoa;
  if (monthlyTax != null) extra.monthlyTax = monthlyTax;
  const { priceHistory, rentalPriceHistory } = parsePriceHistoriesFromRaw(raw);
  return {
    source: "streeteasy",
    externalId: id,
    address,
    city,
    state: "NY",
    zip,
    price,
    beds,
    baths,
    sqft,
    url,
    title: address !== "—" ? address : null,
    description: raw.description != null ? String(raw.description) : null,
    lat: latLon?.lat ?? null,
    lon: latLon?.lon ?? null,
    imageUrls,
    listedAt,
    agentNames,
    priceHistory: priceHistory ?? undefined,
    rentalPriceHistory: rentalPriceHistory ?? undefined,
    extra: Object.keys(extra).length ? extra : null,
  };
}

/** Extract sale and rental price history arrays from GET sale details payload. */
function parsePriceHistoriesFromRaw(raw: Record<string, unknown>): {
  priceHistory?: PriceHistoryEntry[] | null;
  rentalPriceHistory?: PriceHistoryEntry[] | null;
} {
  const coerceEntries = (value: unknown): PriceHistoryEntry[] | null => {
    if (!Array.isArray(value)) return null;
    const out: PriceHistoryEntry[] = [];
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const date = obj.date ?? (obj as Record<string, unknown>).Date ?? obj.listedDate ?? obj.timestamp;
      const price = obj.price ?? (obj as Record<string, unknown>).Price ?? obj.amount;
      const event = obj.event ?? (obj as Record<string, unknown>).Event ?? obj.type ?? obj.reason;
      if (date == null || price == null || event == null) continue;
      out.push({
        date: String(date),
        price: typeof price === "number" || typeof price === "string" ? price : String(price),
        event: String(event),
      });
    }
    return out.length ? out : null;
  };

  const saleHistorySource =
    (raw as Record<string, unknown>).priceHistory ??
    (raw as Record<string, unknown>).price_history ??
    (raw as Record<string, unknown>).history ??
    (raw as Record<string, unknown>).saleHistory ??
    (raw as Record<string, unknown>).sale_history;

  const rentalHistorySource =
    (raw as Record<string, unknown>).rentalPriceHistory ??
    (raw as Record<string, unknown>).rental_price_history ??
    (raw as Record<string, unknown>).rentHistory ??
    (raw as Record<string, unknown>).rental_history;

  const priceHistory = coerceEntries(saleHistorySource);
  const rentalPriceHistory = coerceEntries(rentalHistorySource);

  return {
    priceHistory: priceHistory ?? undefined,
    rentalPriceHistory: rentalPriceHistory ?? undefined,
  };
}

/** Extract monthly HOA and tax from GET sale details (for display and financial calculations). */
function parseMonthlyHoaTaxFromRaw(raw: Record<string, unknown>): { monthlyHoa?: number; monthlyTax?: number } {
  const hoaRaw = raw.monthlyHoa ?? raw.monthly_hoa ?? raw.hoa ?? raw.hoa_fee ?? (raw.fees as Record<string, unknown>)?.hoa ?? (raw.fees as Record<string, unknown>)?.monthly_hoa;
  const taxRaw = raw.monthlyTax ?? raw.monthly_tax ?? raw.tax ?? raw.monthly_taxes ?? (raw.fees as Record<string, unknown>)?.tax ?? (raw.fees as Record<string, unknown>)?.monthly_tax;
  const toNum = (v: unknown): number | undefined => {
    if (v == null) return undefined;
    const n = typeof v === "number" && !Number.isNaN(v) ? v : typeof v === "string" ? parseFloat(String(v).replace(/[$,]/g, "")) : NaN;
    return !Number.isNaN(n) && n >= 0 ? n : undefined;
  };
  return { monthlyHoa: toNum(hoaRaw), monthlyTax: toNum(taxRaw) };
}

/** Extract latitude and longitude from GET sale details payload (defensive to common key names). */
function parseLatLonFromRaw(raw: Record<string, unknown>): { lat: number; lon: number } | null {
  const coords = raw.coordinates as Record<string, unknown> | undefined;
  const loc = raw.location as Record<string, unknown> | undefined;
  const geo = raw.geo as Record<string, unknown> | undefined;
  const geom = raw.geometry as Record<string, unknown> | undefined;
  const geomCoords = Array.isArray(geom?.coordinates) ? (geom!.coordinates as number[]) : null;
  const latRaw =
    raw.latitude ?? raw.lat ?? coords?.latitude ?? coords?.lat
    ?? loc?.lat ?? geo?.lat ?? (geomCoords != null && geomCoords.length >= 2 ? geomCoords[1] : undefined);
  const lonRaw =
    raw.longitude ?? raw.lon ?? coords?.longitude ?? coords?.lon
    ?? loc?.lon ?? geo?.lon ?? (geomCoords != null && geomCoords.length >= 2 ? geomCoords[0] : undefined);
  const lat = typeof latRaw === "number" && !Number.isNaN(latRaw) ? latRaw : (typeof latRaw === "string" ? parseFloat(latRaw) : NaN);
  const lon = typeof lonRaw === "number" && !Number.isNaN(lonRaw) ? lonRaw : (typeof lonRaw === "string" ? parseFloat(lonRaw) : NaN);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Send this run's properties to property data (listings + snapshots). No auto-populate; user-triggered only.
 * Flow: for new listings run broker LLM enrichment only; price history comes from GET sale details (Step 2).
 * Upsert listing (with enrichment) → create snapshot with full metadata.
 */
router.post("/test-agent/runs/:id/send-to-property-data", async (req: Request, res: Response) => {
  const run = testRunsStore.find((r) => r.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "Test run not found." });
    return;
  }
  if (run.properties.length === 0) {
    res.status(400).json({ error: "Run has no properties to send." });
    return;
  }
  try {
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listingRepo = new db.ListingRepo({ pool, client });
      const snapshotRepo = new db.SnapshotRepo({ pool, client });

      const results: { listingId: string; externalId: string; created: boolean }[] = [];
      let listingsCreated = 0;
      let listingsUpdated = 0;
      for (let i = 0; i < run.properties.length; i++) {
        const normalized = runPropertyToNormalized(run.properties[i] as Record<string, unknown>, i);
        const existing = await listingRepo.bySourceAndExternalId(normalized.source, normalized.externalId);

        // LLM enrichment only for new listings; existing rows in raw listings keep their current data
        if (existing) {
          normalized.agentEnrichment = existing.agentEnrichment ?? null;
          normalized.priceHistory = existing.priceHistory ?? null;
          normalized.rentalPriceHistory = existing.rentalPriceHistory ?? null;
        } else {
          const propertyContext = [normalized.address, normalized.city, normalized.zip].filter(Boolean).join(", ") || undefined;
          const agentEnrichment = await enrichBrokers(normalized.agentNames, propertyContext);
          if (agentEnrichment && agentEnrichment.length > 0) {
            normalized.agentEnrichment = agentEnrichment;
          }
          // Price history comes only from GET sale details (Step 2); no LLM extraction.
        }

        // Dedupe by listing ID (source + external_id): upsert updates existing or inserts new
        const { listing, created } = await listingRepo.upsert(normalized, {
          uploadedRunId: run.id,
        });
        if (created) listingsCreated++;
        else listingsUpdated++;
        const rawPayload = run.properties[i] as Record<string, unknown>;
        let metadata: Record<string, unknown>;
        try {
          metadata = {
            testRunId: run.id,
            capturedAt: new Date().toISOString(),
            rawPayload,
            // Store LLM outputs in snapshot so they're persisted and we have a full record
            agentEnrichment: normalized.agentEnrichment ?? null,
            priceHistory: normalized.priceHistory ?? null,
            rentalPriceHistory: normalized.rentalPriceHistory ?? null,
          };
          JSON.stringify(metadata);
        } catch (_ser) {
          throw new Error("Snapshot payload could not be serialized (e.g. circular reference).");
        }
        await snapshotRepo.create({
          listingId: listing.id,
          runId: null,
          rawPayloadPath: "inline",
          metadata,
        });
        results.push({ listingId: listing.id, externalId: normalized.externalId, created });
      }
      // Dedup: always scan all active listings so duplicate_score is correct for every row (new and existing)
      const { listings: allActive } = await listingRepo.list({ lifecycleState: "active", limit: 1000 });
      const dedupUpdates = computeDuplicateScores(
        allActive.map((l) => ({ id: l.id, address: l.address, city: l.city, state: l.state, zip: l.zip }))
      );
      await listingRepo.updateDuplicateScores(dedupUpdates);

      let runNumber: number | null = null;
      try {
        await client.query(
          `INSERT INTO property_data_run_log (run_id, criteria, listings_created, listings_updated)
           VALUES ($1, $2, $3, $4)`,
          [run.id, JSON.stringify(run.criteria), listingsCreated, listingsUpdated]
        );
        const logRow = await client.query(
          "SELECT run_number FROM property_data_run_log WHERE run_id = $1 ORDER BY sent_at DESC LIMIT 1",
          [run.id]
        );
        runNumber = logRow.rows[0]?.run_number ?? null;
      } catch (logErr) {
        if (!/relation "property_data_run_log" does not exist/i.test(String(logErr))) throw logErr;
      }
      await client.query("COMMIT");
      res.json({
        ok: true,
        sent: results.length,
        created: listingsCreated,
        updated: listingsUpdated,
        runNumber,
        results,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-to-property-data]", err);
    let errorMessage: string;
    if (/DATABASE_URL is required|connection|ECONNREFUSED|getPool|config/i.test(message)) {
      errorMessage =
        "Database unavailable. Set DATABASE_URL in the API environment and ensure Postgres is running.";
    } else if (/column.*does not exist|relation.*does not exist|more expressions than target columns/i.test(message)) {
      errorMessage =
        "Database schema is out of date. Run migrations: npm run db:migrate (with DATABASE_URL set).";
    } else {
      errorMessage = "Database unavailable or failed to persist.";
    }
    res.status(503).json({ error: errorMessage, details: message });
  }
});

/** List property data run log (all "Send to property data" runs) for data integrity comparison. */
router.get("/test-agent/property-data/runs", async (_req: Request, res: Response) => {
  try {
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const r = await pool.query(
      `SELECT run_number, run_id, sent_at, criteria, listings_created, listings_updated
       FROM property_data_run_log
       ORDER BY sent_at DESC
       LIMIT 200`
    );
    const runs = r.rows.map((row: Record<string, unknown>) => ({
      runNumber: row.run_number,
      runId: row.run_id,
      sentAt: row.sent_at != null ? new Date(row.sent_at as Date).toISOString() : null,
      criteria: row.criteria,
      listingsCreated: Number(row.listings_created ?? 0),
      listingsUpdated: Number(row.listings_updated ?? 0),
    }));
    res.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/relation "property_data_run_log" does not exist/i.test(message)) {
      res.json({ runs: [] });
      return;
    }
    console.error("[property-data runs list]", err);
    res.status(503).json({ error: "Failed to load run log.", details: message });
  }
});

/** Clear all raw listings (and their snapshots via CASCADE). For testing. Requires ?confirm=1 or body { confirm: true }. */
router.delete("/test-agent/property-data", async (req: Request, res: Response) => {
  const confirm = req.query.confirm === "1" || req.query.confirm === "true" || (req.body && req.body.confirm === true);
  if (!confirm) {
    res.status(400).json({
      error: "Confirmation required. Use ?confirm=1 or body { confirm: true } to clear all raw listings and snapshots.",
    });
    return;
  }
  try {
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const r = await pool.query("DELETE FROM listings RETURNING id");
    const deleted = r.rowCount ?? 0;
    res.json({ ok: true, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clear-property-data]", err);
    if (/DATABASE_URL is required|connection|ECONNREFUSED|getPool|config/i.test(message)) {
      res.status(503).json({
        error: "Database unavailable. Set DATABASE_URL and ensure Postgres is running.",
        details: message,
      });
    } else {
      res.status(503).json({ error: "Failed to clear property data.", details: message });
    }
  }
});

export default router;
