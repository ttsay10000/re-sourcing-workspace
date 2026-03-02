/**
 * Listings API: raw listings for Property Data page and single listing for property card.
 * DB is loaded on request so the server can start without DATABASE_URL.
 */

import { Router, type Request, type Response } from "express";
import { getPool, mapListing, ListingRepo } from "@re-sourcing/db";

const router = Router();

/** GET /api/listings/duplicate-candidates?threshold=80 - listings with duplicate_score >= threshold. */
router.get("/listings/duplicate-candidates", async (req: Request, res: Response) => {
  try {
    const threshold = Math.min(100, Math.max(0, parseInt(req.query.threshold as string, 10) || 80));
    const pool = getPool();
    const r = await pool.query(
      `SELECT * FROM listings WHERE lifecycle_state = 'active' AND duplicate_score IS NOT NULL AND duplicate_score >= $1 ORDER BY duplicate_score DESC`,
      [threshold]
    );
    const listings = r.rows.map((row: Record<string, unknown>) => mapListing(row));
    res.json({ listings, threshold });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[listings duplicate-candidates]", err);
    res.status(503).json({ error: "Failed to load duplicate candidates.", details: message });
  }
});

router.get("/listings", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ListingRepo({ pool });
    const { listings, total } = await repo.list({
      lifecycleState: "active",
      limit: 500,
    });
    res.json({ listings, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[listings list]", err);
    res.status(503).json({ error: "Failed to load listings.", details: message });
  }
});

router.get("/listings/:id", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ListingRepo({ pool });
    const listing = await repo.byId(req.params.id);
    if (!listing) {
      res.status(404).json({ error: "Listing not found." });
      return;
    }
    res.json(listing);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[listing get]", err);
    res.status(503).json({ error: "Failed to load listing.", details: message });
  }
});

/** DELETE /api/listings/:id - remove raw listing (and snapshots via CASCADE). For merge/delete in Review duplicates. */
router.delete("/listings/:id", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ListingRepo({ pool });
    const listing = await repo.byId(req.params.id);
    if (!listing) {
      res.status(404).json({ error: "Listing not found." });
      return;
    }
    await pool.query("DELETE FROM listings WHERE id = $1", [req.params.id]);
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[listing delete]", err);
    res.status(503).json({ error: "Failed to delete listing.", details: message });
  }
});

export default router;
