/**
 * Deal discovery API: list scored deals (properties with deal_signals where deal_score IS NOT NULL).
 */

import { Router, type Request, type Response } from "express";
import { deriveListingActivitySummary, type PriceHistoryEntry, type PropertyDetails } from "@re-sourcing/contracts";
import { getPool } from "@re-sourcing/db";
import { analyzePropertyForUnderwriting } from "../deal/propertyAssumptions.js";
import { getPropertyDossierSummary } from "../deal/propertyDossierState.js";
import { resolvePreferredOmRentRoll, resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";

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

function inferAggregateBeds(details: PropertyDetails | null, fallback: number | null): number | null {
  if (fallback != null && Number.isFinite(fallback)) return fallback;
  const omRoll = resolvePreferredOmRentRoll(details);
  if (omRoll.length > 0) {
    const totalBeds = omRoll.reduce((sum, row) => sum + (toFiniteNumber((row as Record<string, unknown>).beds) ?? 0), 0);
    return totalBeds > 0 ? totalBeds : null;
  }
  return null;
}

function inferAggregateBaths(details: PropertyDetails | null, fallback: number | null): number | null {
  if (fallback != null && Number.isFinite(fallback)) return fallback;
  const omRoll = resolvePreferredOmRentRoll(details);
  if (omRoll.length > 0) {
    const totalBaths = omRoll.reduce((sum, row) => sum + (toFiniteNumber((row as Record<string, unknown>).baths) ?? 0), 0);
    return totalBaths > 0 ? totalBaths : null;
  }
  return null;
}

/** GET /api/deals - list scored deals for discovery feed. */
router.get("/deals", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
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
              : "COALESCE(ov.score, ls.deal_score)";
    const orderClause = `${sortColumn} ${order} NULLS LAST`;

    const r = await pool.query(
      `SELECT
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
         gd.id AS dossier_document_id,
         gd.file_name AS dossier_file_name,
         gd.created_at AS dossier_created_at,
         ls.deal_score AS calculated_deal_score,
         ls.asset_cap_rate,
         ls.adjusted_cap_rate,
         ls.rent_upside,
         ls.irr_pct,
         ls.equity_multiple,
         ls.coc_pct,
         ls.hold_years,
         ls.current_noi,
         ls.adjusted_noi,
         ls.score_breakdown,
         ls.risk_profile,
         ls.risk_flags,
         ls.cap_reasons,
         ls.confidence_score,
         ls.score_sensitivity,
         ls.score_version,
         ov.id AS score_override_id,
         ov.score AS score_override_score,
         ov.reason AS score_override_reason,
         ov.created_by AS score_override_created_by,
         ov.created_at AS score_override_created_at,
         ls.generated_at
       FROM properties p
       INNER JOIN LATERAL (
         SELECT *
         FROM deal_signals
         WHERE property_id = p.id
           AND deal_score IS NOT NULL
           AND (
             (
               COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') <> ''
               AND id::text = p.details->'dealDossier'->'summary'->>'dealSignalsId'
             )
             OR (
               COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') = ''
               AND COALESCE(
                 NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsGeneratedAt', ''),
                 NULLIF(p.details->'dealDossier'->'summary'->>'generatedAt', '')
               ) <> ''
               AND generated_at <= COALESCE(
                 NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsGeneratedAt', ''),
                 NULLIF(p.details->'dealDossier'->'summary'->>'generatedAt', '')
               )::timestamptz
             )
             OR (
               COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') = ''
               AND COALESCE(
                 NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsGeneratedAt', ''),
                 NULLIF(p.details->'dealDossier'->'summary'->>'generatedAt', '')
               ) = ''
             )
           )
         ORDER BY
           CASE
             WHEN COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') <> ''
               AND id::text = p.details->'dealDossier'->'summary'->>'dealSignalsId'
             THEN 0
             ELSE 1
           END,
           generated_at DESC
         LIMIT 1
       ) ls ON true
       LEFT JOIN LATERAL (
         SELECT listing_id FROM listing_property_matches WHERE property_id = p.id ORDER BY confidence DESC NULLS LAST, created_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN listings l ON l.id = m.listing_id
       INNER JOIN LATERAL (
         SELECT id, file_name, created_at
         FROM documents
         WHERE property_id = p.id AND source = 'generated_dossier'
         ORDER BY created_at DESC
         LIMIT 1
       ) gd ON true
       LEFT JOIN LATERAL (
         SELECT id, score, reason, created_by, created_at
         FROM deal_score_overrides
         WHERE property_id = p.id AND cleared_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
       ) ov ON true
       ORDER BY ${orderClause}, p.id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const deals = r.rows.map((row: Record<string, unknown>) => {
      const details = (row.details ?? null) as PropertyDetails | null;
      const dossierSummary = getPropertyDossierSummary(details);
      const unitsFromRental = row.units_from_rental != null ? Number(row.units_from_rental) : null;
      const mix = analyzePropertyForUnderwriting(details);
      const units =
        resolvePreferredOmUnitCount(details)
        ?? mix.totalUnits
        ?? (unitsFromRental != null && unitsFromRental > 0 ? unitsFromRental : null);
      const askingPrice = row.price != null ? Number(row.price) : null;
      const listedAt = row.listed_at instanceof Date ? row.listed_at.toISOString() : (row.listed_at as string | null) ?? null;
      const listingActivity = deriveListingActivitySummary({
        listedAt,
        currentPrice: askingPrice,
        priceHistory: (row.price_history as PriceHistoryEntry[] | null) ?? null,
      });
      const dossierCreatedAt = row.dossier_created_at instanceof Date
        ? row.dossier_created_at.toISOString()
        : (row.dossier_created_at as string | null) ?? null;
      const generatedAt = dossierSummary?.generatedAt
        ?? (row.generated_at instanceof Date ? row.generated_at.toISOString() : (row.generated_at as string | null) ?? null);
      const calculatedDealScore =
        dossierSummary?.calculatedDealScore
        ?? dossierSummary?.dealScore
        ?? (row.calculated_deal_score != null ? Number(row.calculated_deal_score) : null);

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
        recommendedOfferLow: dossierSummary?.recommendedOfferLow ?? null,
        recommendedOfferHigh: dossierSummary?.recommendedOfferHigh ?? null,
        targetIrrPct: dossierSummary?.targetIrrPct ?? null,
        discountToAskingPct: dossierSummary?.discountToAskingPct ?? null,
        irrAtAskingPct: dossierSummary?.irrAtAskingPct ?? null,
        targetMetAtAsking: dossierSummary?.targetMetAtAsking === true,
        stabilizedNoi: dossierSummary?.stabilizedNoi ?? (row.adjusted_noi != null ? Number(row.adjusted_noi) : null),
        annualDebtService: dossierSummary?.annualDebtService ?? null,
        year1EquityYield: dossierSummary?.year1EquityYield ?? null,
        dossierDocumentId: typeof row.dossier_document_id === "string" ? row.dossier_document_id : null,
        dossierFileName: typeof row.dossier_file_name === "string" ? row.dossier_file_name : null,
        dossierCreatedAt,
        dealScore:
          row.score_override_score != null
            ? Number(row.score_override_score)
            : calculatedDealScore != null
              ? calculatedDealScore
              : null,
        calculatedDealScore,
        assetCapRate: row.asset_cap_rate != null ? Number(row.asset_cap_rate) : null,
        adjustedCapRate: row.adjusted_cap_rate != null ? Number(row.adjusted_cap_rate) : null,
        rentUpside: row.rent_upside != null ? Number(row.rent_upside) : null,
        irrPct: dossierSummary?.irrPct ?? (row.irr_pct != null ? Number(row.irr_pct) : null),
        equityMultiple: dossierSummary?.equityMultiple ?? (row.equity_multiple != null ? Number(row.equity_multiple) : null),
        cocPct: dossierSummary?.cocPct ?? (row.coc_pct != null ? Number(row.coc_pct) : null),
        holdYears: dossierSummary?.holdYears ?? (row.hold_years != null ? Number(row.hold_years) : null),
        currentNoi: dossierSummary?.currentNoi ?? (row.current_noi != null ? Number(row.current_noi) : null),
        adjustedNoi: dossierSummary?.adjustedNoi ?? (row.adjusted_noi != null ? Number(row.adjusted_noi) : null),
        confidenceScore: row.confidence_score != null ? Number(row.confidence_score) : null,
        scoreBreakdown: (row.score_breakdown as Record<string, unknown> | null) ?? null,
        riskProfile: (row.risk_profile as Record<string, unknown> | null) ?? null,
        riskFlags: (row.risk_flags as string[] | null) ?? null,
        capReasons: (row.cap_reasons as string[] | null) ?? null,
        scoreSensitivity: (row.score_sensitivity as Record<string, unknown> | null) ?? null,
        scoreVersion: (row.score_version as string | null) ?? null,
        scoreOverride:
          row.score_override_id != null
            ? {
                id: String(row.score_override_id),
                propertyId: String(row.id),
                score: Number(row.score_override_score),
                reason: String(row.score_override_reason ?? ""),
                createdBy: (row.score_override_created_by as string) ?? null,
                createdAt:
                  row.score_override_created_at instanceof Date
                    ? row.score_override_created_at.toISOString()
                    : String(row.score_override_created_at ?? ""),
                clearedAt: null,
              }
            : null,
        generatedAt,
      };
    }).filter((deal) => deal.dealScore != null || deal.calculatedDealScore != null);

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM properties p
       INNER JOIN LATERAL (
         SELECT 1
         FROM deal_signals
         WHERE property_id = p.id
           AND deal_score IS NOT NULL
           AND (
             (
               COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') <> ''
               AND id::text = p.details->'dealDossier'->'summary'->>'dealSignalsId'
             )
             OR (
               COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') = ''
               AND COALESCE(
                 NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsGeneratedAt', ''),
                 NULLIF(p.details->'dealDossier'->'summary'->>'generatedAt', '')
               ) <> ''
               AND generated_at <= COALESCE(
                 NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsGeneratedAt', ''),
                 NULLIF(p.details->'dealDossier'->'summary'->>'generatedAt', '')
               )::timestamptz
             )
             OR (
               COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') = ''
               AND COALESCE(
                 NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsGeneratedAt', ''),
                 NULLIF(p.details->'dealDossier'->'summary'->>'generatedAt', '')
               ) = ''
             )
           )
         ORDER BY
           CASE
             WHEN COALESCE(NULLIF(p.details->'dealDossier'->'summary'->>'dealSignalsId', ''), '') <> ''
               AND id::text = p.details->'dealDossier'->'summary'->>'dealSignalsId'
             THEN 0
             ELSE 1
           END,
           generated_at DESC
         LIMIT 1
       ) ls ON true
       INNER JOIN LATERAL (
         SELECT 1
         FROM documents
         WHERE property_id = p.id AND source = 'generated_dossier'
         ORDER BY created_at DESC
         LIMIT 1
       ) gd ON true`
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
