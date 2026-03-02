/**
 * Canonical properties API: list, create from raw listings, link matches.
 */

import { Router, type Request, type Response } from "express";
import { getPool, ListingRepo, PropertyRepo, MatchRepo } from "@re-sourcing/db";

const router = Router();

/** GET /api/properties - list canonical properties. */
router.get("/properties", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new PropertyRepo({ pool });
    const properties = await repo.list({ limit: 500 });
    res.json({ properties, total: properties.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties list]", err);
    res.status(503).json({ error: "Failed to load properties.", details: message });
  }
});

/** POST /api/properties/from-listings - create canonical properties from all active raw listings, link via matches. */
router.post("/properties/from-listings", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listingRepo = new ListingRepo({ pool, client });
      const propertyRepo = new PropertyRepo({ pool, client });
      const matchRepo = new MatchRepo({ pool, client });

      const { listings } = await listingRepo.list({ lifecycleState: "active", limit: 1000 });
      const results: { listingId: string; propertyId: string; canonicalAddress: string }[] = [];

      for (const listing of listings) {
        const canonicalAddress = [listing.address, listing.city, listing.state, listing.zip]
          .filter(Boolean)
          .join(", ") || listing.address || "Unknown";
        const property = await propertyRepo.create(canonicalAddress);
        await matchRepo.create({
          listingId: listing.id,
          propertyId: property.id,
          confidence: 1,
          reasons: { addressMatch: true, normalizedAddressDistance: 0 },
        });
        results.push({ listingId: listing.id, propertyId: property.id, canonicalAddress });
      }

      await client.query("COMMIT");
      res.json({ ok: true, created: results.length, results });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties from-listings]", err);
    if (/DATABASE_URL|connection|ECONNREFUSED|getPool/i.test(message)) {
      res.status(503).json({ error: "Database unavailable.", details: message });
    } else {
      res.status(503).json({ error: "Failed to create properties from listings.", details: message });
    }
  }
});

export default router;
