/**
 * Listings API: raw listings for Property Data page and single listing for property card.
 * DB is loaded on request so the server can start without DATABASE_URL.
 */

import { Router, type Request, type Response } from "express";

const router = Router();

router.get("/listings", async (_req: Request, res: Response) => {
  try {
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const repo = new db.ListingRepo({ pool });
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
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const repo = new db.ListingRepo({ pool });
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

export default router;
