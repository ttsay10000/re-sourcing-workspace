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

/** Request body: filters sent from frontend (no hardcoded numbers). */
export interface RunRequestBody {
  areas: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  maxBeds?: number | null;
  minBaths?: number | null;
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
    amenities: body.amenities ?? undefined,
    types: body.types ?? undefined,
    limit: body.limit != null ? Math.min(Number(body.limit), 200) : 100,
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
  const beds = Number(raw.bedrooms ?? raw.beds ?? 0) || 0;
  const baths = Number(raw.bathrooms ?? raw.baths ?? 0) || 0;
  const sqft = raw.sqft != null ? Number(raw.sqft) : null;
  const url = (raw._fetchUrl != null ? String(raw._fetchUrl) : raw.url != null ? String(raw.url) : "").trim() || "#";
  const listedAt = raw.listedAt != null ? String(raw.listedAt) : null;
  const images = raw.images;
  const imageUrls = Array.isArray(images) ? (images as string[]) : null;
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
    sqft: sqft && !Number.isNaN(sqft) ? sqft : null,
    url,
    title: address !== "—" ? address : null,
    description: raw.description != null ? String(raw.description) : null,
    lat: null,
    lon: null,
    imageUrls,
    listedAt,
    extra: Object.keys(extra).length ? extra : null,
  };
}

/** Send this run's properties to property data (listings + snapshots). No auto-populate; user-triggered only. */
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
    const listingRepo = new db.ListingRepo({ pool });
    const snapshotRepo = new db.SnapshotRepo({ pool });

    const results: { listingId: string; externalId: string; created: boolean }[] = [];
    for (let i = 0; i < run.properties.length; i++) {
      const normalized = runPropertyToNormalized(run.properties[i] as Record<string, unknown>, i);
      const { listing, created } = await listingRepo.upsert(normalized);
      await snapshotRepo.create({
        listingId: listing.id,
        runId: null,
        rawPayloadPath: "inline",
        metadata: { testRunId: run.id, capturedAt: new Date().toISOString() },
      });
      results.push({ listingId: listing.id, externalId: normalized.externalId, created });
    }
    res.json({ ok: true, sent: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-to-property-data]", err);
    res.status(503).json({ error: "Database unavailable or failed to persist.", details: message });
  }
});

export default router;
