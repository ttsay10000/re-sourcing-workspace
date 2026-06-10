/**
 * Read-only notification previews. The daily digest email pipeline stays in
 * notifications/dailyDigest.ts; this exposes its gather step so the home
 * dashboard can show "since yesterday" counts without sending anything.
 */
import { Router, type Request, type Response } from "express";
import { getPool } from "@re-sourcing/db";
import { buildDailyDigestSummary } from "../notifications/dailyDigest.js";

const router = Router();

router.get("/notifications/digest-preview", async (req: Request, res: Response) => {
  try {
    const hoursRaw = Number(req.query.hours);
    const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(hoursRaw, 24 * 7)) : 24;
    const until = new Date();
    const since = new Date(until.getTime() - hours * 60 * 60 * 1000);
    const summary = await buildDailyDigestSummary(since, until, getPool());

    const newProperties = [...summary.newByBorough.values()].reduce((sum, rows) => sum + rows.length, 0);
    const updatedProperties = [...summary.updatedByBorough.values()].reduce((sum, rows) => sum + rows.length, 0);
    res.json({
      since: summary.since,
      until: summary.until,
      newProperties,
      updatedProperties,
      emailsSent: summary.emailsSent,
      pendingOmCount: summary.pendingOmCount,
      omGeneratedCount: summary.omGeneratedCount,
      dossierGeneratedCount: summary.dossierGeneratedCount,
      topDealCount: summary.topDeals.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notifications digest-preview]", err);
    res.status(503).json({ error: "Failed to build digest preview.", details: message });
  }
});

export default router;
