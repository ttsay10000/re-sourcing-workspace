/**
 * Deal discovery API: list scored deals (properties with deal_signals where deal_score IS NOT NULL).
 */

import { Router, type Request, type Response } from "express";
import { getPool } from "@re-sourcing/db";

const router = Router();

type SortKey = "deal_score" | "adjusted_cap_rate" | "asset_cap_rate" | "rent_upside" | "price";

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
         l.price,
         COALESCE((l.image_urls)[1], (l.extra->'images'->0)::text) AS first_image_url,
         jsonb_array_length(COALESCE(p.details->'rentalFinancials'->'rentalUnits', '[]'::jsonb)) AS units_from_rental,
         (p.details->'rentalFinancials'->'fromLlm'->'rentalNumbersPerUnit')::jsonb AS om_units,
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
       ORDER BY ${orderClause}, p.id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const deals = r.rows.map((row: Record<string, unknown>) => {
      const omUnits = row.om_units as unknown[] | null;
      const unitsFromRental = row.units_from_rental != null ? Number(row.units_from_rental) : null;
      const units = unitsFromRental != null && unitsFromRental > 0 ? unitsFromRental : (omUnits?.length ?? null);
      return {
        id: row.id,
        address: row.address ?? "",
        price: row.price != null ? Number(row.price) : null,
        imageUrl: typeof row.first_image_url === "string" ? row.first_image_url : null,
        totalUnits: units,
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
