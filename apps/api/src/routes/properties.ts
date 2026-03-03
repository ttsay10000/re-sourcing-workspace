/**
 * Canonical properties API: list, create from raw listings, link matches.
 * Optionally runs permit + 7 enrichment modules after creating/linking properties.
 */

import { Router, type Request, type Response } from "express";
import {
  getPool,
  ListingRepo,
  PropertyRepo,
  MatchRepo,
  PermitRepo,
  PropertyEnrichmentStateRepo,
  HpdViolationsRepo,
  DobComplaintsRepo,
  HousingLitigationsRepo,
  AffordableHousingRepo,
} from "@re-sourcing/db";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { normalizeAddressLineForDisplay } from "../enrichment/resolvePropertyBBL.js";

const router = Router();

const ENRICHMENT_RATE_LIMIT_DELAY_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 300;

/** GET /api/properties - list canonical properties. ?includeListingSummary=1 adds primary listing price, listedAt, city for filter/sort. */
router.get("/properties", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const includeListingSummary = req.query.includeListingSummary === "1" || req.query.includeListingSummary === "true";
    if (!includeListingSummary) {
      const repo = new PropertyRepo({ pool });
      const properties = await repo.list({ limit: 500 });
      res.json({ properties, total: properties.length });
      return;
    }
    const r = await pool.query(
      `SELECT DISTINCT ON (p.id)
         p.id, p.canonical_address, p.details, p.created_at, p.updated_at,
         l.price AS listing_price, l.listed_at AS listing_listed_at, l.city AS listing_city
       FROM properties p
       LEFT JOIN listing_property_matches m ON m.property_id = p.id
       LEFT JOIN listings l ON l.id = m.listing_id
       ORDER BY p.id, m.confidence DESC NULLS LAST, m.created_at DESC
       LIMIT 500`
    );
    const properties = r.rows.map((row: Record<string, unknown>) => {
      const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");
      const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "");
      const listingListedAt = row.listing_listed_at != null
        ? (row.listing_listed_at instanceof Date ? row.listing_listed_at.toISOString() : String(row.listing_listed_at))
        : null;
      return {
        id: row.id,
        canonicalAddress: row.canonical_address,
        details: row.details ?? null,
        createdAt,
        updatedAt,
        primaryListing: {
          price: row.listing_price != null ? Number(row.listing_price) : null,
          listedAt: listingListedAt,
          city: (row.listing_city as string) ?? null,
        },
      };
    });
    res.json({ properties, total: properties.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties list]", err);
    res.status(503).json({ error: "Failed to load properties.", details: message });
  }
});

/** DELETE /api/properties - clear all canonical properties (matches and enrichment data CASCADE). Requires ?confirm=1. */
router.delete("/properties", async (req: Request, res: Response) => {
  const confirmed = req.query.confirm === "1";
  if (!confirmed) {
    res.status(400).json({
      error: "Confirmation required. Use ?confirm=1 to clear all canonical properties.",
    });
    return;
  }
  try {
    const pool = getPool();
    await pool.query("DELETE FROM properties");
    res.json({ ok: true, deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties delete all]", err);
    res.status(503).json({ error: "Failed to clear canonical properties.", details: message });
  }
});

/** POST /api/properties/from-listings - create canonical properties from raw listings, link via matches. Runs permit enrichment unless ?skipPermitEnrichment=1. Body may include listingIds: string[] to send only those listings (must be active); otherwise all active listings are used. */
router.post("/properties/from-listings", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listingRepo = new ListingRepo({ pool, client });
      const propertyRepo = new PropertyRepo({ pool, client });
      const matchRepo = new MatchRepo({ pool, client });

      const listingIds = Array.isArray(req.body?.listingIds) && req.body.listingIds.length > 0
        ? (req.body.listingIds as string[]).filter((id: unknown) => typeof id === "string" && id.trim().length > 0)
        : undefined;
      const listFilters: { lifecycleState: "active"; limit: number; ids?: string[] } = { lifecycleState: "active", limit: 1000 };
      if (listingIds != null && listingIds.length > 0) listFilters.ids = listingIds;
      const { listings } = await listingRepo.list(listFilters);
      const results: { listingId: string; propertyId: string; canonicalAddress: string }[] = [];

      for (const listing of listings) {
        const addressLine = normalizeAddressLineForDisplay(listing.address?.trim() ?? "");
        const canonicalAddress = [addressLine, listing.city, listing.state, listing.zip]
          .filter(Boolean)
          .join(", ") || listing.address || "Unknown";
        const property = await propertyRepo.create(canonicalAddress);
        await matchRepo.create({
          listingId: listing.id,
          propertyId: property.id,
          confidence: 1,
          reasons: { addressMatch: true, normalizedAddressDistance: 0 },
        });
        // If GET sale details (listing.extra) included BBL/BIN or monthly HOA/tax, persist on property.
        // Also copy lat/lon from listing so enrichment can resolve BBL via Geoclient when needed.
        const extra = listing.extra as Record<string, unknown> | null | undefined;
        const merge: Record<string, unknown> = {};
        if (listing.lat != null && typeof listing.lat === "number" && !Number.isNaN(listing.lat) &&
            listing.lon != null && typeof listing.lon === "number" && !Number.isNaN(listing.lon)) {
          merge.lat = listing.lat;
          merge.lon = listing.lon;
        }
        if (extra && typeof extra === "object") {
          const bbl = extra.bbl ?? extra.BBL ?? extra.borough_block_lot;
          const bin = extra.bin ?? extra.BIN ?? extra.building_identification_number;
          const bblStr = typeof bbl === "string" && /^\d{10}$/.test(bbl.trim()) ? bbl.trim() : null;
          if (bblStr) {
            merge.bbl = bblStr;
            if (typeof bin === "string" && bin.trim()) merge.bin = bin.trim();
          }
          const hoa = extra.monthlyHoa ?? extra.monthly_hoa ?? extra.hoa;
          const tax = extra.monthlyTax ?? extra.monthly_tax ?? extra.tax;
          if (typeof hoa === "number" && !Number.isNaN(hoa) && hoa >= 0) merge.monthlyHoa = hoa;
          else if (typeof hoa === "string" && hoa.trim()) {
            const n = parseFloat(hoa.replace(/[$,]/g, ""));
            if (!Number.isNaN(n) && n >= 0) merge.monthlyHoa = n;
          }
          if (typeof tax === "number" && !Number.isNaN(tax) && tax >= 0) merge.monthlyTax = tax;
          else if (typeof tax === "string" && tax.trim()) {
            const n = parseFloat(tax.replace(/[$,]/g, ""));
            if (!Number.isNaN(n) && n >= 0) merge.monthlyTax = n;
          }
        }
        if (Object.keys(merge).length > 0) await propertyRepo.mergeDetails(property.id, merge);
        results.push({ listingId: listing.id, propertyId: property.id, canonicalAddress });
      }

      await client.query("COMMIT");

      const skipPermitEnrichment = req.query.skipPermitEnrichment === "1" || req.query.skipPermitEnrichment === "true";
      const propertyIds = [...new Set(results.map((r) => r.propertyId))];
      let enrichmentSummary: { ran: boolean; success: number; failed: number; byModule?: Record<string, number> } = {
        ran: false,
        success: 0,
        failed: 0,
      };

      // Enrichment runs the same pipeline for every property: BBL resolve → Phase 1 (owner cascade + tax code) → permits → 7 modules (zoning, CO, HPD reg, HPD violations, DOB complaints, litigations, affordable housing). Each property is processed independently by propertyId; there is no shared state between iterations.
      if (!skipPermitEnrichment && propertyIds.length > 0) {
        enrichmentSummary.ran = true;
        const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
        const byModule: Record<string, number> = {};
        for (let i = 0; i < propertyIds.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
          const out = await runEnrichmentForProperty(propertyIds[i]!, undefined, {
            appToken,
            rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
          });
          const allOk = out.ok;
          if (allOk) enrichmentSummary.success++;
          else enrichmentSummary.failed++;
          for (const [name, r] of Object.entries(out.results)) {
            byModule[name] = (byModule[name] ?? 0) + (r.ok ? 1 : 0);
          }
        }
        enrichmentSummary.byModule = byModule;
      }

      res.json({
        ok: true,
        created: results.length,
        results,
        permitEnrichment: enrichmentSummary.ran
          ? { ran: true, success: enrichmentSummary.success, failed: enrichmentSummary.failed, byModule: enrichmentSummary.byModule }
          : { ran: false },
      });
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

/** Enrichment module names used in property_enrichment_state (order matches pipeline). */
const ENRICHMENT_MODULES: { key: string; label: string }[] = [
  { key: "permits", label: "Permits" },
  { key: "hpd_registration", label: "HPD Registration" },
  { key: "certificate_of_occupancy", label: "Certificate of Occupancy" },
  { key: "zoning_ztl", label: "Zoning" },
  { key: "dob_complaints", label: "DOB Complaints" },
  { key: "hpd_violations", label: "HPD Violations" },
  { key: "housing_litigations", label: "Housing Litigations" },
  { key: "affordable_housing", label: "Affordable Housing" },
];

/** GET /api/properties/pipeline-stats - counts for raw listings, canonical properties, and per-module completion for pipeline progress. */
router.get("/properties/pipeline-stats", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const [rawResult, canonicalResult, enrichmentResult] = await Promise.all([
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM listings WHERE lifecycle_state = 'active'"),
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM properties"),
      pool.query<{ enrichment_name: string; count: string }>(
        `SELECT enrichment_name, count(DISTINCT property_id)::text AS count
         FROM property_enrichment_state
         WHERE last_success_at IS NOT NULL
         GROUP BY enrichment_name`
      ),
    ]);
    const rawListings = parseInt(rawResult.rows[0]?.count ?? "0", 10);
    const canonicalProperties = parseInt(canonicalResult.rows[0]?.count ?? "0", 10);
    const byModule: Record<string, number> = {};
    for (const row of enrichmentResult.rows) {
      byModule[row.enrichment_name] = parseInt(row.count, 10);
    }
    const enrichment = ENRICHMENT_MODULES.map(({ key, label }) => ({
      key,
      label,
      completed: byModule[key] ?? 0,
    }));
    res.json({
      rawListings,
      canonicalProperties,
      enrichment,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties pipeline-stats]", err);
    res.status(503).json({ error: "Failed to load pipeline stats.", details: message });
  }
});

/** GET /api/properties/:id/listing - primary (first) linked listing for this property, for display in canonical detail. */
router.get("/properties/:id/listing", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const matchRepo = new MatchRepo({ pool });
    const listingRepo = new ListingRepo({ pool });
    const { matches } = await matchRepo.list({ propertyId, limit: 1 });
    const match = matches[0];
    if (!match) {
      res.json({ propertyId, listing: null });
      return;
    }
    const listing = await listingRepo.byId(match.listingId);
    res.json({ propertyId, listing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties listing]", err);
    res.status(503).json({ error: "Failed to load primary listing.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/permits - DOB permit rows for unified violations/permits table. */
router.get("/properties/:id/enrichment/permits", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new PermitRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, permits: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment permits]", err);
    res.status(503).json({ error: "Failed to load permits.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/state - last run and outcome per enrichment module. */
router.get("/properties/:id/enrichment/state", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const stateRepo = new PropertyEnrichmentStateRepo({ pool });
    const names = [
      "permits",
      "zoning_ztl",
      "certificate_of_occupancy",
      "hpd_registration",
      "hpd_violations",
      "dob_complaints",
      "housing_litigations",
      "affordable_housing",
    ];
    const states: Record<string, { lastRefreshedAt: string; lastSuccessAt: string | null; lastError: string | null; statsJson: unknown }> = {};
    for (const name of names) {
      const row = await stateRepo.get(propertyId, name);
      if (row) {
        states[name] = {
          lastRefreshedAt: row.lastRefreshedAt,
          lastSuccessAt: row.lastSuccessAt,
          lastError: row.lastError,
          statsJson: row.statsJson ?? null,
        };
      }
    }
    res.json({ propertyId, states });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment state]", err);
    res.status(503).json({ error: "Failed to load enrichment state.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/violations - HPD violations rows. */
router.get("/properties/:id/enrichment/violations", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new HpdViolationsRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, violations: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment violations]", err);
    res.status(503).json({ error: "Failed to load violations.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/complaints - DOB complaints rows. */
router.get("/properties/:id/enrichment/complaints", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new DobComplaintsRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, complaints: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment complaints]", err);
    res.status(503).json({ error: "Failed to load complaints.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/litigations - Housing litigations rows. */
router.get("/properties/:id/enrichment/litigations", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new HousingLitigationsRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, litigations: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment litigations]", err);
    res.status(503).json({ error: "Failed to load litigations.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/affordable-housing - Affordable housing rows. */
router.get("/properties/:id/enrichment/affordable-housing", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new AffordableHousingRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, affordableHousing: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment affordable-housing]", err);
    res.status(503).json({ error: "Failed to load affordable housing.", details: message });
  }
});

export default router;
