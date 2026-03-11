/**
 * Deal discovery API: list scored deals (properties with deal_signals where deal_score IS NOT NULL).
 */

import { Router, type Request, type Response } from "express";
import { deriveListingActivitySummary, type PriceHistoryEntry, type PropertyDetails } from "@re-sourcing/contracts";
import { getPool, UserProfileRepo } from "@re-sourcing/db";
import { analyzePropertyForUnderwriting } from "../deal/propertyAssumptions.js";
import {
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveDossierAssumptions,
} from "../deal/underwritingModel.js";

const router = Router();

type SortKey = "deal_score" | "adjusted_cap_rate" | "asset_cap_rate" | "rent_upside" | "price";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function noiFromDetails(details: PropertyDetails | null): number | null {
  const om = details?.rentalFinancials?.omAnalysis;
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const noi =
    (ui?.noi as number | undefined) ??
    om?.noiReported ??
    (income?.NOI as number | undefined) ??
    details?.rentalFinancials?.fromLlm?.noi;
  return toFiniteNumber(noi);
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
  const parsed = toFiniteNumber(gross);
  return parsed != null && parsed > 0 ? parsed : null;
}

function inferAggregateBeds(details: PropertyDetails | null, fallback: number | null): number | null {
  if (fallback != null && Number.isFinite(fallback)) return fallback;
  const omRoll = details?.rentalFinancials?.omAnalysis?.rentRoll;
  if (Array.isArray(omRoll) && omRoll.length > 0) {
    const totalBeds = omRoll.reduce((sum, row) => sum + (toFiniteNumber((row as Record<string, unknown>).beds) ?? 0), 0);
    return totalBeds > 0 ? totalBeds : null;
  }
  const llmRoll = details?.rentalFinancials?.fromLlm?.rentalNumbersPerUnit;
  if (Array.isArray(llmRoll) && llmRoll.length > 0) {
    const totalBeds = llmRoll.reduce((sum, row) => sum + (toFiniteNumber((row as Record<string, unknown>).beds) ?? 0), 0);
    return totalBeds > 0 ? totalBeds : null;
  }
  return null;
}

function inferAggregateBaths(details: PropertyDetails | null, fallback: number | null): number | null {
  if (fallback != null && Number.isFinite(fallback)) return fallback;
  const omRoll = details?.rentalFinancials?.omAnalysis?.rentRoll;
  if (Array.isArray(omRoll) && omRoll.length > 0) {
    const totalBaths = omRoll.reduce((sum, row) => sum + (toFiniteNumber((row as Record<string, unknown>).baths) ?? 0), 0);
    return totalBaths > 0 ? totalBaths : null;
  }
  const llmRoll = details?.rentalFinancials?.fromLlm?.rentalNumbersPerUnit;
  if (Array.isArray(llmRoll) && llmRoll.length > 0) {
    const totalBaths = llmRoll.reduce((sum, row) => sum + (toFiniteNumber((row as Record<string, unknown>).baths) ?? 0), 0);
    return totalBaths > 0 ? totalBaths : null;
  }
  return null;
}

/** GET /api/deals - list scored deals for discovery feed. */
router.get("/deals", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const profileRepo = new UserProfileRepo({ pool });
    const sort = (req.query.sort as SortKey) || "deal_score";
    const order = req.query.order === "asc" ? "ASC" : "DESC";
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const sortColumn =
      sort === "adjusted_cap_rate"
        ? "ls.adjusted_cap_rate"
        : sort === "asset_cap_rate"
          ? "ls.asset_cap_rate"
          : sort === "rent_upside"
            ? "ls.rent_upside"
            : sort === "price"
              ? "l.price"
              : "ls.deal_score";
    const orderClause = `${sortColumn} ${order} NULLS LAST`;

    const r = await pool.query(
      `WITH latest_signal AS (
         SELECT DISTINCT ON (property_id) id, property_id, deal_score, asset_cap_rate, adjusted_cap_rate, rent_upside,
           irr_pct, equity_multiple, coc_pct, hold_years, current_noi, adjusted_noi, generated_at
         FROM deal_signals
         WHERE deal_score IS NOT NULL
         ORDER BY property_id, generated_at DESC
       )
       SELECT
         p.id,
         p.canonical_address AS address,
         p.details,
         l.price,
         l.beds,
         l.baths,
         l.listed_at,
         l.price_history,
         COALESCE((l.image_urls)[1], (l.extra->'images'->0)::text) AS first_image_url,
         jsonb_array_length(COALESCE(p.details->'rentalFinancials'->'rentalUnits', '[]'::jsonb)) AS units_from_rental,
         (p.details->'rentalFinancials'->'fromLlm'->'rentalNumbersPerUnit')::jsonb AS om_units,
         gd.id AS dossier_document_id,
         gd.file_name AS dossier_file_name,
         gd.created_at AS dossier_created_at,
         ls.deal_score,
         ls.asset_cap_rate,
         ls.adjusted_cap_rate,
         ls.rent_upside,
         ls.irr_pct,
         ls.equity_multiple,
         ls.coc_pct,
         ls.hold_years,
         ls.current_noi,
         ls.adjusted_noi,
         ls.generated_at
       FROM properties p
       INNER JOIN latest_signal ls ON ls.property_id = p.id
       LEFT JOIN LATERAL (
         SELECT listing_id FROM listing_property_matches WHERE property_id = p.id ORDER BY confidence DESC NULLS LAST, created_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN listings l ON l.id = m.listing_id
       LEFT JOIN LATERAL (
         SELECT id, file_name, created_at
         FROM documents
         WHERE property_id = p.id AND source = 'generated_dossier'
         ORDER BY created_at DESC
         LIMIT 1
       ) gd ON true
       ORDER BY ${orderClause}, p.id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    await profileRepo.ensureDefault();
    const profile = await profileRepo.getDefault();

    const deals = r.rows.map((row: Record<string, unknown>) => {
      const details = (row.details ?? null) as PropertyDetails | null;
      const omUnits = row.om_units as unknown[] | null;
      const unitsFromRental = row.units_from_rental != null ? Number(row.units_from_rental) : null;
      const mix = analyzePropertyForUnderwriting(details);
      const units = mix.totalUnits ?? (unitsFromRental != null && unitsFromRental > 0 ? unitsFromRental : (omUnits?.length ?? null));
      const currentNoi = noiFromDetails(details);
      const currentGrossRent = grossRentFromDetails(details) ?? (currentNoi != null ? currentNoi * 1.5 : null);
      const askingPrice = row.price != null ? Number(row.price) : null;
      const listedAt = row.listed_at instanceof Date ? row.listed_at.toISOString() : (row.listed_at as string | null) ?? null;
      const listingActivity = deriveListingActivitySummary({
        listedAt,
        currentPrice: askingPrice,
        priceHistory: (row.price_history as PriceHistoryEntry[] | null) ?? null,
      });
      const assumptions = resolveDossierAssumptions(profile, askingPrice, null, { details });
      const recommendedOffer = computeRecommendedOffer({
        assumptions,
        currentGrossRent,
        currentNoi,
      });
      const projection = computeUnderwritingProjection({
        assumptions,
        currentGrossRent,
        currentNoi,
      });
      const dossierCreatedAt = row.dossier_created_at instanceof Date
        ? row.dossier_created_at.toISOString()
        : (row.dossier_created_at as string | null) ?? null;

      return {
        id: row.id,
        address: row.address ?? "",
        price: askingPrice,
        imageUrl: typeof row.first_image_url === "string" ? row.first_image_url : null,
        totalUnits: units,
        beds: inferAggregateBeds(details, toFiniteNumber(row.beds)),
        baths: inferAggregateBaths(details, toFiniteNumber(row.baths)),
        listedAt,
        lastActivity: listingActivity,
        residentialUnits: mix.residentialUnits,
        commercialUnits: mix.commercialUnits,
        rentStabilizedUnits: mix.rentStabilizedUnits,
        eligibleResidentialUnits: mix.eligibleResidentialUnits,
        recommendedOfferLow: recommendedOffer.recommendedOfferLow,
        recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
        targetIrrPct: recommendedOffer.targetIrrPct,
        discountToAskingPct: recommendedOffer.discountToAskingPct,
        irrAtAskingPct: recommendedOffer.irrAtAskingPct,
        targetMetAtAsking: recommendedOffer.targetMetAtAsking,
        stabilizedNoi: projection.operating.stabilizedNoi,
        annualDebtService: projection.financing.annualDebtService,
        dossierDocumentId: typeof row.dossier_document_id === "string" ? row.dossier_document_id : null,
        dossierFileName: typeof row.dossier_file_name === "string" ? row.dossier_file_name : null,
        dossierCreatedAt,
        dealScore: row.deal_score != null ? Number(row.deal_score) : null,
        assetCapRate: row.asset_cap_rate != null ? Number(row.asset_cap_rate) : null,
        adjustedCapRate: row.adjusted_cap_rate != null ? Number(row.adjusted_cap_rate) : null,
        rentUpside: row.rent_upside != null ? Number(row.rent_upside) : null,
        irrPct: row.irr_pct != null ? Number(row.irr_pct) : null,
        equityMultiple: row.equity_multiple != null ? Number(row.equity_multiple) : null,
        cocPct: row.coc_pct != null ? Number(row.coc_pct) : null,
        holdYears: row.hold_years != null ? Number(row.hold_years) : null,
        currentNoi: row.current_noi != null ? Number(row.current_noi) : null,
        adjustedNoi: row.adjusted_noi != null ? Number(row.adjusted_noi) : null,
        generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : row.generated_at,
      };
    });

    const countResult = await pool.query(
      `WITH latest_signal AS (
         SELECT DISTINCT ON (property_id) property_id
         FROM deal_signals
         WHERE deal_score IS NOT NULL
         ORDER BY property_id, generated_at DESC
       )
       SELECT COUNT(*) AS total FROM properties p INNER JOIN latest_signal ls ON ls.property_id = p.id`
    );
    const total = Number((countResult.rows[0] as Record<string, unknown>)?.total ?? 0);

    res.json({ deals, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deals list]", err);
    res.status(503).json({ error: "Failed to load deals.", details: message });
  }
});

export default router;
