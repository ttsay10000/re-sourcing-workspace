/**
 * Test agent route: two-step NYC Real Estate API flow.
 * POST starts a run (returns runId immediately); backend runs GET Active Sales then GET Sale details per URL.
 * Runs are stored in memory with step progress, timer, and properties (raw data lake).
 */

import { Router, type Request, type Response } from "express";
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
        run.properties.push(details);
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

export default router;
