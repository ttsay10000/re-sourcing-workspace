/**
 * Test agent route: two-step NYC Real Estate API flow.
 * POST starts a run (returns runId immediately); backend runs GET Active Sales then GET Sale details per URL.
 * Runs are stored in memory with step progress, timer, and properties (raw data lake).
 * Data is NOT auto-populated to property data; user must click "Send to property data" per run.
 */

import { Router, type Request, type Response } from "express";
import type { ListingNormalized } from "@re-sourcing/contracts";
import type { NycsSearchCriteria } from "../nycRealEstateApi.js";
import { fetchActiveSalesWithCriteria, fetchSaleDetailsByUrl } from "../nycRealEstateApi.js";

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
  /** Exclude these property types after Step 2 (e.g. "condo,coop,house" → multifamily only). Step 1 is sent without types so API returns all. */
  excludeTypes?: string | null;
  limit?: number | null;
  offset?: number | null;
}

function toCriteria(body: RunRequestBody): NycsSearchCriteria {
  // When excluding types (e.g. multifamily only), do not send types so Step 1 returns all; we filter after Step 2.
  const useExclude = (body.excludeTypes ?? "").trim().length > 0;
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
    types: useExclude ? undefined : (body.types ?? undefined),
    limit: body.limit != null ? Math.min(Number(body.limit), 500) : 100,
    offset: body.offset != null ? Number(body.offset) : undefined,
  };
}

/** Keys the NYC/StreetEasy API may use for property type in sale details (camelCase and snake_case). */
const PROPERTY_TYPE_KEYS = ["propertyType", "property_type", "type", "listing_type", "category"] as const;

/** Get property type from a detail object, checking multiple possible API response keys. */
function getPropertyType(p: Record<string, unknown>): string {
  for (const key of PROPERTY_TYPE_KEYS) {
    const v = p[key];
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
  }
  const building = p.building;
  if (building && typeof building === "object" && building !== null && !Array.isArray(building)) {
    const b = building as Record<string, unknown>;
    const v = b.type ?? b.propertyType ?? b.property_type;
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Normalize property type for matching (API may return "co-op", "Multi-Family", "multi family").
 * Lowercase, trim, remove hyphens and spaces so "multi family" and "Multi-Family" both become "multifamily".
 */
function normalizePropertyType(pt: unknown): string {
  if (pt == null || typeof pt !== "string") return "";
  return pt
    .toLowerCase()
    .trim()
    .replace(/-/g, "")
    .replace(/\s+/g, "");
}

/**
 * Classify a normalized property type into a canonical bucket so type math is consistent.
 * This is intentionally heuristic because the upstream API is not consistent in naming.
 */
function classifyPropertyType(normalizedType: string): "condo" | "coop" | "house" | "multifamily" | "townhouse" | "other" {
  if (!normalizedType) return "other";

  // Coop / co-op
  if (normalizedType === "coop" || normalizedType === "cooperative" || normalizedType.includes("coop")) return "coop";

  // Condo / condominium
  if (normalizedType === "condo" || normalizedType === "condominium" || normalizedType.includes("condo")) return "condo";

  // Townhouse should not be treated as "house" for multifamily-only.
  if (normalizedType === "townhouse" || normalizedType.includes("townhouse")) return "townhouse";

  // Multifamily: "multifamily", "multi-family", "2 family", "three family home", "four family home",
  // "five family home", etc., "rental building", "mixed-use building"
  if (
    normalizedType.includes("multifamily") ||
    normalizedType.includes("multiunit") ||
    normalizedType.includes("multiunits") ||
    normalizedType.includes("multifam") ||
    normalizedType.includes("rentalbuilding") ||
    normalizedType.includes("mixedusebuilding") ||
    /^(two|three|four|five|six|seven|eight|nine|ten)family(home)?/.test(normalizedType) ||
    normalizedType.includes("twofamily") ||
    normalizedType.includes("threefamily") ||
    normalizedType.includes("fourfamily") ||
    normalizedType.includes("fivefamily") ||
    normalizedType.includes("sixfamily") ||
    normalizedType.includes("sevenfamily") ||
    normalizedType.includes("eightfamily") ||
    normalizedType.includes("ninefamily") ||
    normalizedType.includes("2family") ||
    normalizedType.includes("3family") ||
    normalizedType.includes("4family") ||
    normalizedType.includes("5family") ||
    normalizedType.includes("6family") ||
    normalizedType.includes("7family") ||
    normalizedType.includes("8family") ||
    normalizedType.includes("9family") ||
    normalizedType.includes("2unit") ||
    normalizedType.includes("3unit") ||
    normalizedType.includes("4unit") ||
    normalizedType.includes("5unit") ||
    normalizedType.includes("6unit") ||
    // be careful: "singlefamily..." should not match this
    (normalizedType.includes("family") && normalizedType.includes("unit") && !normalizedType.includes("singlefamily")) ||
    (normalizedType.includes("family") && !normalizedType.includes("singlefamily") && normalizedType.match(/\b(2|3|4|5|6|7|8|9|10)\b/) != null)
  ) {
    return "multifamily";
  }

  // House: single-family residence / home / house
  if (
    normalizedType === "house" ||
    normalizedType === "sfr" ||
    normalizedType.includes("singlefamily") ||
    normalizedType.includes("singlefamilyresidence") ||
    normalizedType.includes("singlefamilyhome") ||
    normalizedType.includes("singlefamilyhouse") ||
    normalizedType.includes("home") ||
    normalizedType.includes("house")
  ) {
    return "house";
  }

  return "other";
}

/** Filter out properties whose type is in the exclude list (e.g. condo, coop, house → keep multifamily and others). */
function applyExcludeTypes(properties: Record<string, unknown>[], excludeTypesCsv: string): void {
  const exclude = excludeTypesCsv
    .split(",")
    .map((s) => normalizePropertyType(s.trim()))
    .filter(Boolean);
  if (exclude.length === 0) return;
  const excludeSet = new Set(exclude);
  const toRemove = new Set<number>();
  properties.forEach((p, i) => {
    const raw = getPropertyType(p);
    const pt = normalizePropertyType(raw);
    const bucket = classifyPropertyType(pt);
    if (excludeSet.has(bucket)) toRemove.add(i);
  });
  // Remove in reverse order so indices stay valid
  [...toRemove].sort((a, b) => b - a).forEach((i) => properties.splice(i, 1));
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
    // Apply exclude-types filter (e.g. exclude condo, coop, house → keep multifamily)
    const excludeCsv = (run.criteria.excludeTypes ?? "").trim();
    if (excludeCsv) applyExcludeTypes(run.properties, excludeCsv);
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
  const { _fetchUrl: _u, ...rest } = raw;
  const extra = rest as Record<string, unknown>;
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
    lat: null,
    lon: null,
    imageUrls,
    listedAt,
    agentNames,
    extra: Object.keys(extra).length ? extra : null,
  };
}

/** Send this run's properties to property data (listings + snapshots). No auto-populate; user-triggered only. Uses a transaction so all-or-nothing. */
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
    } else if (/column.*does not exist|relation.*does not exist/i.test(message)) {
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
