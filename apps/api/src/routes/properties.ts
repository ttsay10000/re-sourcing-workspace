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
  DealSignalsRepo,
  DocumentRepo,
  UserProfileRepo,
} from "@re-sourcing/db";
import type { PropertyDocumentCategory } from "@re-sourcing/contracts";
import multer from "multer";
import { randomUUID } from "crypto";
import { resolveInquiryFilePath } from "../inquiry/storage.js";
import { saveUploadedDocument, resolveUploadedDocFilePath, deleteUploadedDocumentFile, uploadedDocFileExists } from "../upload/uploadedDocStorage.js";
import { sendMessage as gmailSendMessage } from "../inquiry/gmailClient.js";
import type { PropertyDetails, RentalFinancials, RentalFinancialsFromLlm } from "@re-sourcing/contracts";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { normalizeAddressLineForDisplay, getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runRentalApiStep } from "../rental/rentalApiClient.js";
import { extractRentalFinancialsFromListing, extractRentalFinancialsFromText } from "../rental/extractRentalFinancialsFromListing.js";
import { extractTextFromUploadedFile, extractTextFromBuffer } from "../upload/extractTextFromUploadedFile.js";
import { suggestRentalDataGaps } from "../rental/suggestRentalDataGaps.js";
import { getRentRollComparison } from "../rental/rentRollComparison.js";
import { fetchNyDosEntityByName } from "../enrichment/nyDosEntity.js";
import { fetchAcrisDocumentsByOwnerName } from "../enrichment/acrisDocuments.js";
import { computeDealSignals } from "../deal/computeDealSignals.js";
import {
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveDossierAssumptions,
} from "../deal/underwritingModel.js";
import { resolveGeneratedDocPath, deleteGeneratedDocumentFile } from "../deal/generatedDocStorage.js";
import { readFile, unlink } from "fs/promises";

const router = Router();

const ENRICHMENT_RATE_LIMIT_DELAY_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 300;

/**
 * Run OM/Brochure LLM extraction and merge into property details. Used in background after upload
 * so the upload response can return immediately (avoids Render request timeout).
 */
async function runOmExtractionInBackground(
  propertyId: string,
  fileBuffer: Buffer,
  filename: string,
  pool: import("pg").Pool
): Promise<void> {
  const propertyRepo = new PropertyRepo({ pool });
  const text = await extractTextFromBuffer(fileBuffer, filename);
  const hasPdfSource = filename.toLowerCase().endsWith(".pdf");
  if (text.length < 50 && !hasPdfSource) {
    if (text.length > 0) console.warn("[documents/upload background] OM/Brochure text too short for LLM:", text.length, "chars");
    else console.warn("[documents/upload background] No text extracted from PDF");
    return;
  }
  const property = await propertyRepo.byId(propertyId);
  if (!property) return;
  const details = (property.details ?? {}) as Record<string, unknown>;
  const enrichmentContext =
    details.enrichment || details.bbl || details.taxCode
      ? JSON.stringify(
          { bbl: details.bbl, taxCode: details.taxCode, enrichment: details.enrichment },
          null,
          0
        ).slice(0, 4000)
      : undefined;
  const { fromLlm, omAnalysis } = await extractRentalFinancialsFromText(text, {
    forceOmStyle: true,
    enrichmentContext,
    documentFiles: hasPdfSource ? [{ filename, mimeType: "application/pdf", buffer: fileBuffer }] : undefined,
  });
  const hasFromLlm = fromLlm && typeof fromLlm === "object" && Object.keys(fromLlm).length > 0;
  const hasOmAnalysis = omAnalysis && typeof omAnalysis === "object";
  if (!hasFromLlm && !hasOmAnalysis) return;
  const prop = await propertyRepo.byId(propertyId);
  const existing = (prop?.details?.rentalFinancials ?? null) as RentalFinancials | null;
  const existingFromLlm = existing?.fromLlm ?? null;
  const mergedFromLlm =
    hasFromLlm && existingFromLlm && typeof existingFromLlm === "object"
      ? { ...existingFromLlm, ...fromLlm }
      : (fromLlm ?? existingFromLlm ?? undefined);
  const rentalFinancials: RentalFinancials = {
    ...(existing ?? {}),
    fromLlm: mergedFromLlm as RentalFinancialsFromLlm | undefined,
    omAnalysis: hasOmAnalysis ? omAnalysis : (existing?.omAnalysis ?? undefined),
    source: existing?.source ?? "llm",
    lastUpdatedAt: new Date().toISOString(),
  };
  await propertyRepo.mergeDetails(propertyId, { rentalFinancials });
  console.log("[documents/upload background] OM LLM merged for property", propertyId);
}

/**
 * Re-run OM/Brochure financial extraction for a property when it has uploaded OM/Brochure docs.
 * Uses file on disk when present; otherwise uses file_content from DB (for hosted deployments).
 */
export async function refreshOmFinancialsForProperty(
  propertyId: string,
  pool: import("pg").Pool
): Promise<{ documentsProcessed: number; documentsSkippedNoFile: number; error?: string }> {
  const propertyRepo = new PropertyRepo({ pool });
  const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) return { documentsProcessed: 0, documentsSkippedNoFile: 0, error: "Property not found" };
  const docs = await uploadedDocRepo.listByPropertyId(propertyId);
  const omOrBrochure = docs.filter((d) => d.category === "OM" || d.category === "Brochure");
  let documentsProcessed = 0;
  let documentsSkippedNoFile = 0;
  for (const doc of omOrBrochure) {
    let text: string;
    let fileBuffer: Buffer | null = null;
    const fileContent = await uploadedDocRepo.getFileContent(doc.id);
    if (fileContent && fileContent.length > 0) {
      fileBuffer = fileContent;
      text = await extractTextFromBuffer(fileContent, doc.filename ?? "document");
    } else if (uploadedDocFileExists(doc.filePath)) {
      fileBuffer = await readFile(resolveUploadedDocFilePath(doc.filePath));
      text = await extractTextFromUploadedFile(doc.filePath, doc.filename ?? undefined);
    } else {
      documentsSkippedNoFile++;
      continue;
    }
    try {
      const hasPdfSource = !!fileBuffer && (doc.filename ?? "").toLowerCase().endsWith(".pdf");
      if (text.length < 50 && !hasPdfSource) continue;
      const details = (property.details ?? {}) as Record<string, unknown>;
      const enrichmentContext =
        details.enrichment || details.bbl || details.taxCode
          ? JSON.stringify(
              { bbl: details.bbl, taxCode: details.taxCode, enrichment: details.enrichment },
              null,
              0
            ).slice(0, 4000)
          : undefined;
      const { fromLlm, omAnalysis } = await extractRentalFinancialsFromText(text, {
        forceOmStyle: true,
        enrichmentContext,
        documentFiles:
          hasPdfSource && fileBuffer
            ? [{ filename: doc.filename ?? "document.pdf", mimeType: "application/pdf", buffer: fileBuffer }]
            : undefined,
      });
      const hasFromLlm = fromLlm && typeof fromLlm === "object" && Object.keys(fromLlm).length > 0;
      const hasOmAnalysis = omAnalysis && typeof omAnalysis === "object";
      if (hasFromLlm || hasOmAnalysis) {
        const prop = await propertyRepo.byId(propertyId);
        const existing = (prop?.details?.rentalFinancials ?? null) as RentalFinancials | null;
        const existingFromLlm = existing?.fromLlm ?? null;
        const mergedFromLlm =
          hasFromLlm && existingFromLlm && typeof existingFromLlm === "object"
            ? { ...existingFromLlm, ...fromLlm }
            : (fromLlm ?? existingFromLlm ?? undefined);
        const rentalFinancials: RentalFinancials = {
          ...(existing ?? {}),
          fromLlm: mergedFromLlm as RentalFinancialsFromLlm | undefined,
          omAnalysis: hasOmAnalysis ? omAnalysis : (existing?.omAnalysis ?? undefined),
          source: existing?.source ?? "llm",
          lastUpdatedAt: new Date().toISOString(),
        };
        await propertyRepo.mergeDetails(propertyId, { rentalFinancials });
        documentsProcessed++;
      }
    } catch (e) {
      console.warn("[refreshOmFinancialsForProperty]", propertyId, doc.filename, e instanceof Error ? e.message : e);
    }
  }
  return { documentsProcessed, documentsSkippedNoFile };
}

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
         l.price AS listing_price, l.listed_at AS listing_listed_at, l.city AS listing_city,
         (CASE
           WHEN EXISTS (SELECT 1 FROM property_inquiry_documents d WHERE d.property_id = p.id)
             OR EXISTS (SELECT 1 FROM property_uploaded_documents u WHERE u.property_id = p.id AND u.category = 'OM')
           THEN 'OM received'
           WHEN EXISTS (SELECT 1 FROM property_inquiry_sends s WHERE s.property_id = p.id)
           THEN 'OM pending'
           ELSE 'Not received'
         END) AS om_status,
         ds.deal_score
       FROM properties p
       LEFT JOIN listing_property_matches m ON m.property_id = p.id
       LEFT JOIN listings l ON l.id = m.listing_id
       LEFT JOIN LATERAL (SELECT deal_score FROM deal_signals WHERE property_id = p.id ORDER BY generated_at DESC LIMIT 1) ds ON true
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
        omStatus: (row.om_status as string) ?? "Not received",
        dealScore: row.deal_score != null ? Number(row.deal_score) : null,
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

      // Run rental flow for each new property: RapidAPI + LLM on listing to populate financials.
      let rentalFlowSummary: { ran: boolean; success: number; failed: number } = { ran: false, success: 0, failed: 0 };
      if (propertyIds.length > 0) {
        rentalFlowSummary.ran = true;
        const pool = getPool();
        for (let i = 0; i < propertyIds.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
          try {
            await runRentalFlowForProperty(propertyIds[i]!, pool);
            rentalFlowSummary.success++;
          } catch {
            rentalFlowSummary.failed++;
          }
        }
      }

      res.json({
        ok: true,
        created: results.length,
        results,
        permitEnrichment: enrichmentSummary.ran
          ? { ran: true, success: enrichmentSummary.success, failed: enrichmentSummary.failed, byModule: enrichmentSummary.byModule }
          : { ran: false },
        rentalFlow: rentalFlowSummary.ran ? rentalFlowSummary : undefined,
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

    // After enrichment, refresh OM/Brochure financials for each property when the uploaded doc file exists on disk (senior-analyst LLM populates property card financial section).
    const pool = getPool();
    let omFinancialsProcessed = 0;
    let omFinancialsSkippedNoFile = 0;
    for (const propertyId of propertyIds) {
      const result = await refreshOmFinancialsForProperty(propertyId, pool);
      omFinancialsProcessed += result.documentsProcessed;
      omFinancialsSkippedNoFile += result.documentsSkippedNoFile;
    }

    res.json({
      ok: true,
      permitEnrichment: {
        ran: true,
        success,
        failed,
        byModule,
      },
      omFinancialsRefresh: {
        documentsProcessed: omFinancialsProcessed,
        documentsSkippedNoFile: omFinancialsSkippedNoFile,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties run-enrichment]", err);
    res.status(503).json({ error: "Failed to run enrichment.", details: message });
  }
});

/** POST /api/properties/:id/refresh-om-financials - re-run OM/Brochure LLM extraction for this property using uploaded docs. Only processes docs whose file exists on disk. */
router.post("/properties/:id/refresh-om-financials", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id as string;
    if (!propertyId?.trim()) {
      res.status(400).json({ error: "Property ID required." });
      return;
    }
    const pool = getPool();
    const result = await refreshOmFinancialsForProperty(propertyId.trim(), pool);
    if (result.error) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({
      ok: true,
      documentsProcessed: result.documentsProcessed,
      documentsSkippedNoFile: result.documentsSkippedNoFile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties refresh-om-financials]", err);
    res.status(503).json({ error: "Failed to refresh OM financials.", details: message });
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

/** Multer file-size error: return 413 with hint about Render proxy limits. */
function handleUploadMulterError(_req: Request, res: Response, next: (err?: unknown) => void) {
  return (err: unknown) => {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "File too large",
        details: "Max 25 MB per file. On Render, the proxy may reject bodies before that; try a smaller PDF (<10 MB) or compress the file.",
        maxBytes: 25 * 1024 * 1024,
      });
      return;
    }
    next(err);
  };
}

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

/** GET /api/properties/:id/documents - unified list: inquiry docs + uploaded docs + generated (dossier, Excel). */
router.get("/properties/:id/documents", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const inquiryDocRepo = new InquiryDocumentRepo({ pool });
    const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
    const generatedDocRepo = new DocumentRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const [inquiryDocs, uploadedDocs, generatedDocs] = await Promise.all([
      inquiryDocRepo.listByPropertyIdWithSource(propertyId),
      uploadedDocRepo.listByPropertyId(propertyId),
      generatedDocRepo.listByPropertyId(propertyId),
    ]);
    const unified = [
      ...inquiryDocs.map((d) => ({
        id: d.id,
        fileName: d.filename,
        fileType: d.contentType ?? null,
        source: d.source ?? "inquiry",
        sourceType: "inquiry" as const,
        createdAt: d.createdAt,
      })),
      ...uploadedDocs.map((d) => ({
        id: d.id,
        fileName: d.filename,
        fileType: d.contentType ?? null,
        source: d.category ?? "uploaded",
        sourceType: "uploaded" as const,
        createdAt: d.createdAt,
      })),
      ...generatedDocs.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType ?? null,
        source: d.source,
        sourceType: "generated" as const,
        createdAt: d.createdAt,
      })),
    ].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    res.json({ propertyId, documents: unified });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties documents list]", err);
    res.status(503).json({ error: "Failed to list documents.", details: message });
  }
});

/** DELETE /api/properties/:id/documents/:docId - delete a document. Query: sourceType=inquiry|uploaded|generated (required). */
router.delete("/properties/:id/documents/:docId", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, docId } = req.params;
    const sourceType = req.query.sourceType as string | undefined;
    if (!sourceType || !["inquiry", "uploaded", "generated"].includes(sourceType)) {
      res.status(400).json({ error: "Query sourceType is required and must be inquiry, uploaded, or generated." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }

    if (sourceType === "generated") {
      const generatedDocRepo = new DocumentRepo({ pool });
      const doc = await generatedDocRepo.byId(docId);
      if (!doc || doc.propertyId !== propertyId) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      await deleteGeneratedDocumentFile(doc.storagePath);
      const deleted = await generatedDocRepo.delete(docId);
      if (!deleted) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      res.status(200).json({ ok: true, propertyId, docId });
      return;
    }

    if (sourceType === "inquiry") {
      const inquiryDocRepo = new InquiryDocumentRepo({ pool });
      const doc = await inquiryDocRepo.byId(docId);
      if (!doc || doc.propertyId !== propertyId) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      const absolutePath = resolveInquiryFilePath(doc.filePath);
      await unlink(absolutePath).catch(() => {});
      const deleted = await inquiryDocRepo.delete(docId);
      if (!deleted) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      res.status(200).json({ ok: true, propertyId, docId });
      return;
    }

    if (sourceType === "uploaded") {
      const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
      const doc = await uploadedDocRepo.byId(docId);
      if (!doc || doc.propertyId !== propertyId) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      await deleteUploadedDocumentFile(doc.filePath);
      const deleted = await uploadedDocRepo.delete(docId);
      if (!deleted) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      res.status(200).json({ ok: true, propertyId, docId });
      return;
    }

    res.status(400).json({ error: "Invalid sourceType." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties delete document]", err);
    if (!res.headersSent) res.status(503).json({ error: "Failed to delete document.", details: message });
  }
});

/** GET /api/properties/:id/documents/:docId/file - serve document file (generated, inquiry, or uploaded). */
router.get("/properties/:id/documents/:docId/file", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, docId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const generatedDocRepo = new DocumentRepo({ pool });
    const genDoc = await generatedDocRepo.byId(docId);
    if (genDoc && genDoc.propertyId === propertyId) {
      const fileContent = await generatedDocRepo.getFileContent(docId);
      if (fileContent && fileContent.length > 0) {
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(genDoc.fileName)}"`);
        if (genDoc.fileType) res.setHeader("Content-Type", genDoc.fileType);
        res.send(fileContent);
        return;
      }
      const absolutePath = resolveGeneratedDocPath(genDoc.storagePath);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(genDoc.fileName)}"`);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          console.error("[documents/file] sendFile failed (generated):", err instanceof Error ? err.message : err);
          res.status(500).json({ error: "Failed to send file", details: err instanceof Error ? err.message : "File may be missing or inaccessible" });
        }
      });
      return;
    }
    const inquiryDocRepo = new InquiryDocumentRepo({ pool });
    const inquiryDoc = await inquiryDocRepo.byId(docId);
    if (inquiryDoc && inquiryDoc.propertyId === propertyId) {
      const fileContent = await inquiryDocRepo.getFileContent(docId);
      if (fileContent && fileContent.length > 0) {
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(inquiryDoc.filename)}"`);
        if (inquiryDoc.contentType) res.setHeader("Content-Type", inquiryDoc.contentType);
        res.send(fileContent);
        return;
      }
      const absolutePath = resolveInquiryFilePath(inquiryDoc.filePath);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(inquiryDoc.filename)}"`);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          console.error("[documents/file] sendFile failed (inquiry):", err instanceof Error ? err.message : err);
          res.status(500).json({ error: "Failed to send file", details: err instanceof Error ? err.message : "File may be missing or inaccessible" });
        }
      });
      return;
    }
    const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
    const uploadedDoc = await uploadedDocRepo.byId(docId);
    if (uploadedDoc && uploadedDoc.propertyId === propertyId) {
      const fileContent = await uploadedDocRepo.getFileContent(docId);
      if (fileContent && fileContent.length > 0) {
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(uploadedDoc.filename)}"`);
        if (uploadedDoc.contentType) res.setHeader("Content-Type", uploadedDoc.contentType);
        res.send(fileContent);
        return;
      }
      if (!uploadedDocFileExists(uploadedDoc.filePath)) {
        res.status(404).json({ error: "Document file not found on disk", docId, hint: "On hosted deployments (e.g. Render), use a persistent disk or set UPLOADED_DOCS_PATH to a path that persists across restarts." });
        return;
      }
      const absolutePath = resolveUploadedDocFilePath(uploadedDoc.filePath);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(uploadedDoc.filename)}"`);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          console.error("[documents/file] sendFile failed (uploaded):", err instanceof Error ? err.message : err);
          res.status(500).json({ error: "Failed to send file", details: err instanceof Error ? err.message : "File may be missing or storage may not persist (e.g. ephemeral disk)." });
        }
      });
      return;
    }
    res.status(404).json({ error: "Document not found", docId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties document file]", err);
    if (!res.headersSent) res.status(503).json({ error: "Failed to serve file.", details: message });
  }
});

/** POST /api/properties/:id/documents/upload - upload a document (multipart: file + category). */
router.post(
  "/properties/:id/documents/upload",
  (req, res, next) => {
    uploadMemory.single("file")(req, res, handleUploadMulterError(req, res, next));
  },
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
        fileContent: file.buffer,
      });

      // Return immediately so Render/timeouts don't kill the request. OM/Brochure LLM runs in background.
      res.status(201).json({ propertyId, document: inserted });

      // When user uploads OM or Brochure, run senior-analyst LLM in background and merge when done.
      if (category === "OM" || category === "Brochure") {
        void runOmExtractionInBackground(propertyId, file.buffer, filename, pool).catch((e) => {
          console.error("[documents/upload background] OM/Brochure LLM failed:", e instanceof Error ? e.message : e);
        });
      }
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

interface InquiryGuardState {
  propertyId: string;
  toAddress: string | null;
  lastInquirySentAt: string | null;
  hasOmDocument: boolean;
  sameRecipientSamePropertyAt: string | null;
  sameRecipientOtherProperties: Array<{ propertyId: string; canonicalAddress: string; sentAt: string }>;
}

function normalizeRecipientEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

async function getInquiryGuardState(
  pool: import("pg").Pool,
  propertyId: string,
  toAddress?: string | null
): Promise<InquiryGuardState> {
  const inquirySendRepo = new InquirySendRepo({ pool });
  const normalizedTo = normalizeRecipientEmail(toAddress);
  const [lastInquirySentAt, omResult, recipientHistory] = await Promise.all([
    inquirySendRepo.getLastSentAt(propertyId),
    pool.query<{ has_om_document: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM property_inquiry_documents d WHERE d.property_id = $1
       ) OR EXISTS (
         SELECT 1 FROM property_uploaded_documents u WHERE u.property_id = $1 AND u.category = 'OM'
       ) AS has_om_document`,
      [propertyId]
    ),
    normalizedTo ? inquirySendRepo.listByRecipient(normalizedTo) : Promise.resolve([]),
  ]);

  const sameRecipientSamePropertyAt =
    recipientHistory.find((row) => row.propertyId === propertyId)?.sentAt ?? null;
  const sameRecipientOtherProperties = recipientHistory.filter((row) => row.propertyId !== propertyId);

  return {
    propertyId,
    toAddress: normalizedTo,
    lastInquirySentAt,
    hasOmDocument: Boolean(omResult.rows[0]?.has_om_document),
    sameRecipientSamePropertyAt,
    sameRecipientOtherProperties,
  };
}

/** GET /api/properties/:id/inquiry-guard - persisted inquiry history for this property and optional broker email. */
router.get("/properties/:id/inquiry-guard", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const toAddress = typeof req.query.to === "string" ? req.query.to : null;
    const guard = await getInquiryGuardState(pool, propertyId, toAddress);
    res.json(guard);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties inquiry-guard]", err);
    res.status(503).json({ error: "Failed to load inquiry guard.", details: message });
  }
});

/** POST /api/properties/:id/mark-inquiry-sent - log a prior/manual inquiry so duplicate-send guardrails persist across refreshes. */
router.post("/properties/:id/mark-inquiry-sent", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const toAddress = normalizeRecipientEmail(req.body?.to);
    const sentAt = typeof req.body?.sentAt === "string" ? req.body.sentAt : null;
    const inquirySendRepo = new InquirySendRepo({ pool });
    const created = await inquirySendRepo.create(propertyId, null, {
      toAddress,
      source: "manual",
      sentAt,
    });
    const guard = await getInquiryGuardState(pool, propertyId, toAddress);
    res.status(201).json({
      ok: true,
      propertyId,
      inquirySend: {
        id: created.id,
        sentAt: created.sentAt,
        toAddress,
        source: "manual",
      },
      guard,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties mark-inquiry-sent]", err);
    res.status(503).json({ error: "Failed to record inquiry send.", details: message });
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
    const force = req.body?.force === true;
    if (typeof to !== "string" || !to.trim()) {
      res.status(400).json({ error: "Missing or invalid 'to' address." });
      return;
    }
    const normalizedTo = normalizeRecipientEmail(to);
    const guard = await getInquiryGuardState(pool, propertyId, normalizedTo);
    if (guard.hasOmDocument && !force) {
      res.status(409).json({
        error: "OM already received for this property. Inquiry email blocked.",
        code: "om_already_received",
        guard,
      });
      return;
    }
    if (guard.lastInquirySentAt && !force) {
      res.status(409).json({
        error: "An inquiry has already been logged for this property. Inquiry email blocked until you confirm a resend.",
        code: "inquiry_already_sent",
        guard,
      });
      return;
    }
    if (guard.sameRecipientOtherProperties.length > 0 && !force) {
      res.status(409).json({
        error: "This broker email has already been contacted for another property. Inquiry email blocked until you confirm.",
        code: "recipient_contacted_elsewhere",
        guard,
      });
      return;
    }
    const subj = typeof subject === "string" ? subject.trim() : "";
    const b = typeof body === "string" ? body : "";
    const result = await gmailSendMessage(to.trim(), subj || "Inquiry", b);
    const inquirySendRepo = new InquirySendRepo({ pool });
    const { sentAt } = await inquirySendRepo.create(propertyId, result.id, {
      toAddress: normalizedTo,
      source: "gmail_api",
    });
    res.json({ ok: true, messageId: result.id, sentAt, guard: await getInquiryGuardState(pool, propertyId, normalizedTo) });
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
    const signalsRepo = new DealSignalsRepo({ pool });
    const [lastInquirySentAt, latestSignals] = await Promise.all([
      inquirySendRepo.getLastSentAt(propertyId),
      signalsRepo.getLatestByPropertyId(propertyId),
    ]);
    const rentalFinancials = (property.details as Record<string, unknown> | null)?.rentalFinancials as RentalFinancials | undefined;
    const rentRollComparison = getRentRollComparison(rentalFinancials);
    res.json({
      id: property.id,
      canonicalAddress: property.canonicalAddress,
      details: property.details ?? null,
      createdAt: property.createdAt,
      updatedAt: property.updatedAt,
      lastInquirySentAt: lastInquirySentAt ?? null,
      rentRollComparison: rentRollComparison ?? undefined,
      dealScore: latestSignals?.dealScore ?? null,
      dealSignals: latestSignals ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties get by id]", err);
    res.status(503).json({ error: "Failed to load property.", details: message });
  }
});

function noiFromDetails(details: PropertyDetails | null): number | null {
  const om = details?.rentalFinancials?.omAnalysis;
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const noi =
    (ui?.noi as number | undefined) ??
    om?.noiReported ??
    (income?.NOI as number | undefined) ??
    details?.rentalFinancials?.fromLlm?.noi;
  if (noi != null && typeof noi === "number" && !Number.isNaN(noi)) return noi;
  return null;
}

function grossRentFromDetails(details: PropertyDetails | null): number | null {
  const om = details?.rentalFinancials?.omAnalysis;
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const gross =
    (ui?.grossRent as number | undefined) ??
    (income?.grossRentActual as number | undefined) ??
    (income?.grossRentPotential as number | undefined) ??
    details?.rentalFinancials?.fromLlm?.grossRentTotal;
  if (gross != null && typeof gross === "number" && !Number.isNaN(gross) && gross > 0) return gross;
  return null;
}

/** POST /api/properties/:id/compute-score - compute deal signals and full underwriting, persist to deal_signals, return score and signals. */
router.post("/properties/:id/compute-score", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const matchRepo = new MatchRepo({ pool });
    const listingRepo = new ListingRepo({ pool });
    const profileRepo = new UserProfileRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const { matches } = await matchRepo.list({ propertyId, limit: 1 });
    const match = matches[0];
    const listing = match ? await listingRepo.byId(match.listingId) : null;
    const purchasePrice = listing?.price ?? null;
    const primaryListing = {
      price: purchasePrice,
      city: listing?.city ?? null,
    };
    const details = property.details as PropertyDetails | null;
    const currentNoi = noiFromDetails(details);
    const currentGrossRent = grossRentFromDetails(details) ?? (currentNoi != null ? currentNoi * 1.5 : null);
    await profileRepo.ensureDefault();
    const profile = await profileRepo.getDefault();
    const assumptions = resolveDossierAssumptions(profile, purchasePrice, null, {
      details,
    });
    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent,
      currentNoi,
    });
    const hasCurrentFinancials = currentGrossRent != null && currentNoi != null;
    const recommendedOffer = computeRecommendedOffer({
      assumptions,
      currentGrossRent,
      currentNoi,
    });
    const input = {
      propertyId,
      canonicalAddress: property.canonicalAddress,
      details: property.details ?? null,
      primaryListing,
      irrPct: projection.returns.irr ?? null,
      cocPct: projection.returns.year1CashOnCashReturn ?? null,
      adjustedCapRatePct:
        assumptions.acquisition.purchasePrice != null && hasCurrentFinancials && projection.operating.stabilizedNoi >= 0
          ? (projection.operating.stabilizedNoi / assumptions.acquisition.purchasePrice) * 100
          : null,
      recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
      blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
      rentStabilizedUnitCount: assumptions.propertyMix.rentStabilizedUnits,
      commercialUnitCount: assumptions.propertyMix.commercialUnits,
    };
    const { insertParams, scoringResult } = computeDealSignals(input);
    const signalsRepo = new DealSignalsRepo({ pool });
    const row = await signalsRepo.insert({
      ...insertParams,
      dealScore: scoringResult.isScoreable ? scoringResult.dealScore : null,
      irrPct: projection.returns.irr ?? null,
      equityMultiple: projection.returns.equityMultiple ?? null,
      cocPct: projection.returns.year1CashOnCashReturn ?? null,
      holdYears: assumptions.holdPeriodYears,
      currentNoi: currentNoi ?? null,
      adjustedNoi: projection.operating.stabilizedNoi ?? currentNoi ?? null,
    });
    res.json({
      dealScore: row.dealScore ?? (scoringResult.isScoreable ? scoringResult.dealScore : null),
      dealSignals: row,
      scoringResult: {
        isScoreable: scoringResult.isScoreable,
        assetYieldScore: scoringResult.assetYieldScore,
        riskScore: scoringResult.riskScore,
        positiveSignals: scoringResult.positiveSignals,
        negativeSignals: scoringResult.negativeSignals,
        assetCapRate: scoringResult.assetCapRate,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties compute-score]", err);
    res.status(503).json({ error: "Failed to compute deal score.", details: message });
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

/** Run rental flow for a single property: RapidAPI rental-by-address + LLM extraction from linked listing. Used by from-listings, run-enrichment, and run-rental-flow. */
export async function runRentalFlowForProperty(
  propertyId: string,
  pool: import("pg").Pool
): Promise<{ rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string }> {
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) {
    return { rentalUnitsCount: 0, hasLlmFinancials: false, error: "Property not found" };
  }
  const existing = (property.details?.rentalFinancials ?? null) as RentalFinancials | null;
  let apiResult: Partial<RentalFinancials> = {};
  try {
    apiResult = await runRentalApiStep(property.canonicalAddress);
  } catch (e) {
    console.warn(`[runRentalFlowForProperty] ${propertyId} RapidAPI step failed:`, e instanceof Error ? e.message : e);
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
  return {
    rentalUnitsCount: rentalUnits?.length ?? 0,
    hasLlmFinancials: !!finalFromLlm && Object.keys(finalFromLlm).length > 0,
  };
}

/** POST /api/properties/run-rental-flow - Run rental flow for selected or all properties (on-demand re-run). Normally runs automatically after from-listings and run-enrichment. */
router.post("/properties/run-rental-flow", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const propertyIds = Array.isArray(req.body?.propertyIds) && req.body.propertyIds.length > 0
      ? (req.body.propertyIds as string[]).filter((id: unknown) => typeof id === "string" && id.trim().length > 0)
      : (await propertyRepo.list({ limit: 200 })).map((p) => p.id);

    const results: { propertyId: string; rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string }[] = [];
    const delayMs = ENRICHMENT_RATE_LIMIT_DELAY_MS;

    for (const propertyId of propertyIds) {
      try {
        const result = await runRentalFlowForProperty(propertyId, pool);
        results.push({ propertyId, ...result });
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
