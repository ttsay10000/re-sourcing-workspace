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
  InquiryEmailRepo,
  InquiryDocumentRepo,
  InquirySendRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import type { PropertyDocumentCategory } from "@re-sourcing/contracts";
import multer from "multer";
import { randomUUID } from "crypto";
import { resolveInquiryFilePath } from "../inquiry/storage.js";
import { saveUploadedDocument, resolveUploadedDocFilePath, deleteUploadedDocumentFile } from "../upload/uploadedDocStorage.js";
import { sendMessage as gmailSendMessage } from "../inquiry/gmailClient.js";
import type { RentalFinancials, RentalFinancialsFromLlm } from "@re-sourcing/contracts";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { normalizeAddressLineForDisplay, getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runRentalApiStep } from "../rental/rentalApiClient.js";
import { extractRentalFinancialsFromListing } from "../rental/extractRentalFinancialsFromListing.js";
import { suggestRentalDataGaps } from "../rental/suggestRentalDataGaps.js";
import { fetchNyDosEntityByName } from "../enrichment/nyDosEntity.js";
import { fetchAcrisDocumentsByOwnerName } from "../enrichment/acrisDocuments.js";

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

      // Enrichment runs the same pipeline for every property: BBL resolve → Phase 1 (owner cascade + tax code) → permits → 7 modules. Pre-pass: resolve and persist BBL for every property first so CO and other BBL-dependent modules run for all.
      if (!skipPermitEnrichment && propertyIds.length > 0) {
        enrichmentSummary.ran = true;
        const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
        for (let i = 0; i < propertyIds.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
          await getBBLForProperty(propertyIds[i]!, { appToken });
        }
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

/** POST /api/properties/run-enrichment - re-run enrichment for existing canonical properties only. Body: { propertyIds: string[] }. Assumes BBL/details are already set; runs same pipeline (BBL resolve → Phase 1 → permits → 7 modules) and updates data. Returns same permitEnrichment shape as from-listings. */
router.post("/properties/run-enrichment", async (req: Request, res: Response) => {
  try {
    const raw = req.body?.propertyIds;
    const propertyIds = Array.isArray(raw)
      ? (raw as unknown[]).filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
      : [];
    if (propertyIds.length === 0) {
      res.status(400).json({ error: "propertyIds required (non-empty array)." });
      return;
    }

    const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
    // Pre-pass: resolve and persist BBL for every property so CO and other BBL-dependent modules run for all.
    for (let i = 0; i < propertyIds.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
      await getBBLForProperty(propertyIds[i]!, { appToken });
    }
    const byModule: Record<string, number> = {};
    let success = 0;
    let failed = 0;
    for (let i = 0; i < propertyIds.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
      const out = await runEnrichmentForProperty(propertyIds[i]!, undefined, {
        appToken,
        rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
      });
      if (out.ok) success++;
      else failed++;
      for (const [name, r] of Object.entries(out.results)) {
        byModule[name] = (byModule[name] ?? 0) + (r.ok ? 1 : 0);
      }
    }

    res.json({
      ok: true,
      permitEnrichment: {
        ran: true,
        success,
        failed,
        byModule,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties run-enrichment]", err);
    res.status(503).json({ error: "Failed to run enrichment.", details: message });
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
];

/** GET /api/properties/pipeline-stats - counts for raw listings, canonical properties, and per-module completion for pipeline progress. ?includeRemaining=1 adds remainingByModule (property IDs not yet completed per module). */
router.get("/properties/pipeline-stats", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const includeRemaining = req.query.includeRemaining === "1" || req.query.includeRemaining === "true";
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
    const payload: Record<string, unknown> = {
      rawListings,
      canonicalProperties,
      enrichment,
    };
    if (includeRemaining) {
      const remainingResult = await pool.query<{ enrichment_name: string; property_id: string }>(
        `WITH completed AS (
          SELECT property_id, enrichment_name FROM property_enrichment_state WHERE last_success_at IS NOT NULL
        ),
        modules AS (
          SELECT unnest(ARRAY['permits','hpd_registration','certificate_of_occupancy','zoning_ztl','dob_complaints','hpd_violations','housing_litigations']) AS enrichment_name
        )
        SELECT m.enrichment_name, p.id AS property_id
        FROM properties p
        CROSS JOIN modules m
        LEFT JOIN completed c ON c.property_id = p.id AND c.enrichment_name = m.enrichment_name
        WHERE c.property_id IS NULL`
      );
      const remainingByModule: Record<string, { count: number; propertyIds: string[] }> = {};
      for (const { key } of ENRICHMENT_MODULES) {
        const ids = remainingResult.rows.filter((r) => r.enrichment_name === key).map((r) => r.property_id);
        remainingByModule[key] = { count: ids.length, propertyIds: ids };
      }
      payload.remainingByModule = remainingByModule;
    }
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties pipeline-stats]", err);
    res.status(503).json({ error: "Failed to load pipeline stats.", details: message });
  }
});

const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB

const VALID_UPLOAD_CATEGORIES: PropertyDocumentCategory[] = [
  "OM",
  "Brochure",
  "Rent Roll",
  "Financial Model",
  "T12 / Operating Summary",
  "Other",
];

function parseUploadCategory(cat: unknown): PropertyDocumentCategory {
  const s = typeof cat === "string" ? cat.trim() : "";
  if (VALID_UPLOAD_CATEGORIES.includes(s as PropertyDocumentCategory)) return s as PropertyDocumentCategory;
  return "Other";
}

/** GET /api/properties/ny-dos-entity?name=... - NY DOS entity details for a business name (LLC, Corp, etc.). Returns N/A when name does not look like a business entity. */
router.get("/properties/ny-dos-entity", async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (!name) {
      res.json({ entity: null, nA: true, reason: "No name provided." });
      return;
    }
    const entity = await fetchNyDosEntityByName(name, {
      appToken: process.env.SOCRATA_APP_TOKEN ?? process.env.NY_OPEN_DATA_APP_TOKEN ?? null,
      timeoutMs: 15_000,
    });
    res.json({ entity, nA: entity == null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties ny-dos-entity]", err);
    res.status(503).json({ error: "Failed to fetch NY DOS entity.", details: message });
  }
});

/** GET /api/properties/acris-documents?name=... - ACRIS documents from NYC Open Data by owner name. Optional ?bbl= to filter by BBL. */
router.get("/properties/acris-documents", async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "Query parameter 'name' is required.", documents: [] });
      return;
    }
    const bbl = typeof req.query.bbl === "string" ? req.query.bbl.trim() || null : null;
    const documents = await fetchAcrisDocumentsByOwnerName(name, {
      appToken: process.env.SOCRATA_APP_TOKEN ?? null,
      timeoutMs: 60_000,
      bbl,
    });
    res.json({ documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties acris-documents]", err);
    res.status(503).json({ error: "Failed to fetch ACRIS documents.", details: message, documents: [] });
  }
});

/** GET /api/properties/:id/acris-documents - ACRIS documents for property, using owner name from details (owner module / permits). Optional BBL filter from property. */
router.get("/properties/:id/acris-documents", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId, documents: [] });
      return;
    }
    const details = (property.details as Record<string, unknown>) ?? {};
    const enrichment = details.enrichment as Record<string, unknown> | undefined;
    const permitsSummary = enrichment?.permits_summary as Record<string, unknown> | undefined;
    const ownerModuleName = details.ownerModuleName ?? details.owner_module_name;
    const ownerModuleBusiness = details.ownerModuleBusiness ?? details.owner_module_business;
    const permOwnerName = permitsSummary?.owner_name;
    const permOwnerBusiness = permitsSummary?.owner_business_name;
    const candidates = [
      ownerModuleBusiness,
      permOwnerBusiness,
      ownerModuleName,
      permOwnerName,
    ].filter((c) => c != null && String(c).trim() !== "");
    const ownerName = typeof candidates[0] === "string" ? candidates[0].trim() : "";
    if (!ownerName) {
      res.json({ propertyId, documents: [], reason: "No owner name on property (set owner module or run permit enrichment)." });
      return;
    }
    const bbl = details.bblBase ?? details.bbl ?? null;
    const bblStr = typeof bbl === "string" ? bbl : typeof bbl === "number" ? String(bbl) : null;
    const documents = await fetchAcrisDocumentsByOwnerName(ownerName, {
      appToken: process.env.SOCRATA_APP_TOKEN ?? null,
      timeoutMs: 60_000,
      bbl: bblStr,
    });
    res.json({ propertyId, documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties :id acris-documents]", err);
    res.status(503).json({ error: "Failed to fetch ACRIS documents for property.", details: message, documents: [] });
  }
});

/** GET /api/properties/:id/documents - list inquiry documents (attachments) for property, with source (from_address). */
router.get("/properties/:id/documents", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const docRepo = new InquiryDocumentRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const documents = await docRepo.listByPropertyIdWithSource(propertyId);
    res.json({ propertyId, documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties documents list]", err);
    res.status(503).json({ error: "Failed to list documents.", details: message });
  }
});

/** GET /api/properties/:id/documents/:docId/file - serve inquiry document file. */
router.get("/properties/:id/documents/:docId/file", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, docId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const docRepo = new InquiryDocumentRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const doc = await docRepo.byId(docId);
    if (!doc || doc.propertyId !== propertyId) {
      res.status(404).json({ error: "Document not found", docId });
      return;
    }
    const absolutePath = resolveInquiryFilePath(doc.filePath);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.filename)}"`);
    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: "Failed to send file" });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties document file]", err);
    if (!res.headersSent) res.status(503).json({ error: "Failed to serve file.", details: message });
  }
});

/** GET /api/properties/:id/uploaded-documents - list user-uploaded documents (OM, Brochure, etc.) for property. */
router.get("/properties/:id/uploaded-documents", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const docRepo = new PropertyUploadedDocumentRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const documents = await docRepo.listByPropertyId(propertyId);
    res.json({ propertyId, documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties uploaded-documents list]", err);
    res.status(503).json({ error: "Failed to list uploaded documents.", details: message });
  }
});

/** GET /api/properties/:id/uploaded-documents/:docId/file - serve uploaded document file. */
router.get("/properties/:id/uploaded-documents/:docId/file", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, docId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const docRepo = new PropertyUploadedDocumentRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const doc = await docRepo.byId(docId);
    if (!doc || doc.propertyId !== propertyId) {
      res.status(404).json({ error: "Document not found", docId });
      return;
    }
    const absolutePath = resolveUploadedDocFilePath(doc.filePath);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.filename)}"`);
    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: "Failed to send file" });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties uploaded-document file]", err);
    if (!res.headersSent) res.status(503).json({ error: "Failed to serve file.", details: message });
  }
});

/** DELETE /api/properties/:id/uploaded-documents/:docId - remove an uploaded document (and its file from disk). */
router.delete("/properties/:id/uploaded-documents/:docId", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, docId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const docRepo = new PropertyUploadedDocumentRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const doc = await docRepo.byId(docId);
    if (!doc || doc.propertyId !== propertyId) {
      res.status(404).json({ error: "Document not found", docId });
      return;
    }
    await deleteUploadedDocumentFile(doc.filePath);
    const deleted = await docRepo.delete(docId);
    if (!deleted) {
      res.status(404).json({ error: "Document not found", docId });
      return;
    }
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties delete uploaded-document]", err);
    res.status(503).json({ error: "Failed to delete document.", details: message });
  }
});

/** POST /api/properties/:id/documents/upload - upload a document (multipart: file + category). */
router.post(
  "/properties/:id/documents/upload",
  uploadMemory.single("file"),
  async (req: Request, res: Response) => {
    try {
      const { id: propertyId } = req.params;
      const pool = getPool();
      const propertyRepo = new PropertyRepo({ pool });
      const docRepo = new PropertyUploadedDocumentRepo({ pool });
      const property = await propertyRepo.byId(propertyId);
      if (!property) {
        res.status(404).json({ error: "Property not found", propertyId });
        return;
      }
      const file = (req as Request & { file?: { buffer: Buffer; originalname?: string; mimetype?: string } })?.file;
      if (!file || !file.buffer) {
        res.status(400).json({ error: "Missing file. Send multipart/form-data with field 'file'." });
        return;
      }
      const category = parseUploadCategory(req.body?.category);
      const source = typeof req.body?.source === "string" ? req.body.source.trim() || null : null;
      const docId = randomUUID();
      const filename = file.originalname?.trim() || "document";
      const filePath = await saveUploadedDocument(propertyId, docId, filename, file.buffer);
      const inserted = await docRepo.insert({
        id: docId,
        propertyId,
        filename,
        contentType: file.mimetype || null,
        filePath,
        category,
        source,
      });
      res.status(201).json({ propertyId, document: inserted });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[properties documents upload]", err);
      res.status(503).json({ error: "Failed to upload document.", details: message });
    }
  }
);

/** GET /api/properties/:id/inquiry-emails - list inquiry emails for property. */
router.get("/properties/:id/inquiry-emails", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const emailRepo = new InquiryEmailRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const emails = await emailRepo.listByPropertyId(propertyId);
    res.json({ propertyId, emails });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties inquiry-emails list]", err);
    res.status(503).json({ error: "Failed to list inquiry emails.", details: message });
  }
});

/** POST /api/properties/:id/send-inquiry-email - send inquiry email via Gmail API. Body: { to, subject, body }. */
router.post("/properties/:id/send-inquiry-email", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const { to, subject, body } = req.body ?? {};
    if (typeof to !== "string" || !to.trim()) {
      res.status(400).json({ error: "Missing or invalid 'to' address." });
      return;
    }
    const subj = typeof subject === "string" ? subject.trim() : "";
    const b = typeof body === "string" ? body : "";
    const result = await gmailSendMessage(to.trim(), subj || "Inquiry", b);
    const inquirySendRepo = new InquirySendRepo({ pool });
    const { sentAt } = await inquirySendRepo.create(propertyId, result.id);
    res.json({ ok: true, messageId: result.id, sentAt });
  } catch (err) {
    const message = (() => {
      if (err instanceof Error) {
        const g = err as Error & {
          response?: {
            data?: {
              error?: string | { message?: string; errors?: Array<{ message?: string }> };
              message?: string;
            };
          };
        };
        const d = g.response?.data;
        if (d) {
          const e = d.error;
          if (typeof e === "string") return e;
          if (e && typeof e === "object" && typeof e.message === "string") return e.message;
          if (e && typeof e === "object" && Array.isArray(e.errors) && e.errors[0]?.message) return e.errors[0].message;
          if (typeof d.message === "string") return d.message;
        }
        return g.message;
      }
      return String(err);
    })();
    console.error("[properties send-inquiry-email]", err);
    res.status(503).json({ error: "Failed to send email.", details: message });
  }
});

/** GET /api/properties/:id - single property with full details (for fresh enrichment data in UI). */
router.get("/properties/:id", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new PropertyRepo({ pool });
    const property = await repo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const inquirySendRepo = new InquirySendRepo({ pool });
    const lastInquirySentAt = await inquirySendRepo.getLastSentAt(propertyId);
    res.json({
      id: property.id,
      canonicalAddress: property.canonicalAddress,
      details: property.details ?? null,
      createdAt: property.createdAt,
      updatedAt: property.updatedAt,
      lastInquirySentAt: lastInquirySentAt ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties get by id]", err);
    res.status(503).json({ error: "Failed to load property.", details: message });
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

/** Merge new fromLlm into existing; only set non-null keys so we don't overwrite with null. */
function mergeFromLlm(
  existing: RentalFinancialsFromLlm | null | undefined,
  incoming: RentalFinancialsFromLlm | null | undefined
): RentalFinancialsFromLlm | null {
  if (!incoming || typeof incoming !== "object") return existing ?? null;
  const out = { ...(existing && typeof existing === "object" ? existing : {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (v != null && (typeof v !== "string" || v.trim() !== "")) (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** POST /api/properties/run-rental-flow - Run steps 1 (RapidAPI) + 2 (LLM on listing) for selected or all properties. */
router.post("/properties/run-rental-flow", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const matchRepo = new MatchRepo({ pool });
    const listingRepo = new ListingRepo({ pool });

    const propertyIds = Array.isArray(req.body?.propertyIds) && req.body.propertyIds.length > 0
      ? (req.body.propertyIds as string[]).filter((id: unknown) => typeof id === "string" && id.trim().length > 0)
      : (await propertyRepo.list({ limit: 200 })).map((p) => p.id);

    const results: { propertyId: string; rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string }[] = [];
    const delayMs = ENRICHMENT_RATE_LIMIT_DELAY_MS;

    for (const propertyId of propertyIds) {
      try {
        const property = await propertyRepo.byId(propertyId);
        if (!property) {
          results.push({ propertyId, rentalUnitsCount: 0, hasLlmFinancials: false, error: "Property not found" });
          continue;
        }

        const existing = (property.details?.rentalFinancials ?? null) as RentalFinancials | null;

        let apiResult: Partial<RentalFinancials> = {};
        try {
          apiResult = await runRentalApiStep(property.canonicalAddress);
        } catch (e) {
          console.warn(`[run-rental-flow] ${propertyId} RapidAPI step failed:`, e instanceof Error ? e.message : e);
        }

        const rentalUnits = (apiResult.rentalUnits && apiResult.rentalUnits.length > 0)
          ? apiResult.rentalUnits
          : (existing?.rentalUnits ?? null);

        let fromLlm: RentalFinancialsFromLlm | null = null;
        const { matches } = await matchRepo.list({ propertyId, limit: 1 });
        const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;
        if (listing) {
          const desc = (listing.description ?? "").trim();
          const fallback = [listing.title, listing.address].filter(Boolean).join(" – ") || "";
          fromLlm = await extractRentalFinancialsFromListing(
            desc.length >= 20 ? listing.description : (fallback ? `Listing: ${fallback}. No description.` : null),
            listing.title ?? listing.address ?? undefined
          );
        }
        const mergedFromLlm = mergeFromLlm(existing?.fromLlm ?? null, fromLlm);

        const dataGap = await suggestRentalDataGaps(
          listing ? { beds: listing.beds, baths: listing.baths, address: listing.address, title: listing.title, descriptionSnippet: listing.description?.slice(0, 400) } : null,
          rentalUnits ?? []
        );
        let finalFromLlm = mergedFromLlm;
        if (dataGap) {
          finalFromLlm = mergeFromLlm(finalFromLlm ?? null, { dataGapSuggestions: dataGap }) ?? { dataGapSuggestions: dataGap };
        }

        const rentalFinancials: RentalFinancials = {
          rentalUnits: rentalUnits ?? undefined,
          fromLlm: finalFromLlm ?? undefined,
          source: apiResult.rentalUnits?.length ? "rapidapi" : (finalFromLlm ? "llm" : existing?.source ?? undefined),
          lastUpdatedAt: new Date().toISOString(),
        };

        await propertyRepo.mergeDetails(propertyId, { rentalFinancials });
        results.push({
          propertyId,
          rentalUnitsCount: rentalUnits?.length ?? 0,
          hasLlmFinancials: !!finalFromLlm && Object.keys(finalFromLlm).length > 0,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ propertyId, rentalUnitsCount: 0, hasLlmFinancials: false, error: message });
      }

      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    res.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties run-rental-flow]", err);
    res.status(503).json({ error: "Run rental flow failed.", details: message });
  }
});

export default router;
