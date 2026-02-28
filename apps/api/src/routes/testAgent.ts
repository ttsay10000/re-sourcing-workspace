/**
 * Test agent route: fetch NYC Real Estate API (active + past 3 months sales).
 * Test runs are kept in memory for review in Runs and Listings; not saved to listings DB.
 */

import { Router, type Request, type Response } from "express";
import type { ListingNormalized } from "@re-sourcing/contracts";
import { fetchActiveAndPastSales } from "../nycRealEstateApi.js";

const router = Router();

/** In-memory store for test runs (for review only; not the real listings DB). */
interface StoredTestRun {
  id: string;
  createdAt: string;
  requestBody: RunRequestBody;
  searchUrl: string;
  stubsCount: number;
  listings: ListingNormalized[];
  errors: { stubUrl: string; message: string }[];
}

const testRunsStore: StoredTestRun[] = [];

/** Request body for run: optional limits. */
interface RunRequestBody {
  activeLimit?: number | null;
  pastLimit?: number | null;
}

/** Response shape for run. */
interface RunResponse {
  runId: string;
  searchUrl: string;
  stubsCount: number;
  listings: ListingNormalized[];
  errors?: { stubUrl: string; message: string }[];
}

router.post("/test-agent/run-first-page", async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as RunRequestBody;
    const activeLimit = body.activeLimit != null ? Number(body.activeLimit) : 50;
    const pastLimit = body.pastLimit != null ? Number(body.pastLimit) : 50;

    const listings: ListingNormalized[] = [];
    const errors: { stubUrl: string; message: string }[] = [];

    try {
      const combined = await fetchActiveAndPastSales({
        activeLimit: Math.min(activeLimit, 200),
        pastLimit: Math.min(pastLimit, 200),
      });
      listings.push(...combined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ stubUrl: "https://nyc-real-estate-api.p.rapidapi.com/sales/search", message });
    }

    const runId = crypto.randomUUID();
    const searchUrl = "https://rapidapi.com/ntd119/api/nyc-real-estate-api";
    const stored: StoredTestRun = {
      id: runId,
      createdAt: new Date().toISOString(),
      requestBody: body,
      searchUrl,
      stubsCount: listings.length,
      listings,
      errors,
    };
    testRunsStore.push(stored);

    const payload: RunResponse = {
      runId,
      searchUrl,
      stubsCount: listings.length,
      listings,
    };
    if (errors.length > 0) payload.errors = errors;
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** List test runs (newest first) for Runs page. */
router.get("/test-agent/runs", (_req: Request, res: Response) => {
  const runs = [...testRunsStore].reverse().map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    searchUrl: r.searchUrl,
    stubsCount: r.stubsCount,
    listingsCount: r.listings.length,
    errorsCount: r.errors.length,
  }));
  res.json({ runs });
});

/** Get one test run with full listings for Runs detail / Listings. */
router.get("/test-agent/runs/:id", (req: Request, res: Response) => {
  const run = testRunsStore.find((r) => r.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "Test run not found." });
    return;
  }
  res.json(run);
});

export default router;
