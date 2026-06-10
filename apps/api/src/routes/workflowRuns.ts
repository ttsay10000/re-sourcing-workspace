/**
 * Workflow run status polling for the web UI's global process banner.
 * Read-only view over workflow_runs / workflow_run_steps (workflowTracker).
 */

import { Router, type Request, type Response } from "express";
import { listWorkflowRuns, listWorkflowRunsByIds } from "../workflow/workflowTracker.js";

const router = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET /api/workflow/runs?ids=a,b,c — runs by id; without ids, the latest runs. */
router.get("/workflow/runs", async (req: Request, res: Response) => {
  try {
    const rawIds = typeof req.query.ids === "string" ? req.query.ids : "";
    const ids = rawIds
      .split(",")
      .map((id) => id.trim())
      .filter((id) => UUID_PATTERN.test(id))
      .slice(0, 20);
    if (ids.length > 0) {
      const runs = await listWorkflowRunsByIds(ids);
      res.json({ runs });
      return;
    }
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 20;
    const runs = await listWorkflowRuns(limit);
    res.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[workflow runs]", err);
    res.status(503).json({ error: "Failed to load workflow runs.", details: message });
  }
});

export default router;
