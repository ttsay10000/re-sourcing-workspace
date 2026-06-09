/**
 * Operating comps ("living database") read API.
 *
 * Every property that has a calculated LTR yield (asset cap rate from the
 * latest deal signals — derived from extracted OM/doc NOI over price) is a
 * comp row, regardless of pipeline state. Dead deals stay queryable.
 */

import { Router, type Request, type Response } from "express";
import { getPool } from "@re-sourcing/db";

const router = Router();

interface OperatingCompRow {
  propertyId: string;
  canonicalAddress: string;
  borough: string | null;
  neighborhood: string | null;
  dealState: string | null;
  dealStage: string | null;
  lat: number | null;
  lng: number | null;
  units: number | null;
  ltrYieldPct: number | null;
  mtrYieldPct: number | null;
  yieldSpreadPct: number | null;
  currentNoi: number | null;
  pricePerUnit: number | null;
  pricePsf: number | null;
  expenseRatioPct: number | null;
  dealScore: number | null;
  signalAt: string | null;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

router.get("/comps/operating", async (req: Request, res: Response) => {
  const borough = typeof req.query.borough === "string" ? req.query.borough.trim().toLowerCase() : "";
  const minYield = toNumber(req.query.minYield);
  const maxYield = toNumber(req.query.maxYield);
  const limit = Math.max(1, Math.min(toNumber(req.query.limit) ?? 500, 1000));

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT
         p.id AS property_id,
         p.canonical_address,
         p.deal_state,
         p.deal_stage,
         p.lat,
         p.lng,
         p.details#>>'{neighborhood,primary,borough}' AS borough,
         COALESCE(
           p.details#>>'{neighborhood,primary,name}',
           p.details#>>'{neighborhood,primary,neighborhood}'
         ) AS neighborhood,
         CASE
           WHEN p.details#>>'{omData,authoritative,propertyInfo,totalUnits}' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (p.details#>>'{omData,authoritative,propertyInfo,totalUnits}')::numeric
           WHEN p.details#>>'{rentalFinancials,omAnalysis,propertyInfo,totalUnits}' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (p.details#>>'{rentalFinancials,omAnalysis,propertyInfo,totalUnits}')::numeric
           ELSE NULL
         END AS units,
         ds.asset_cap_rate,
         ds.adjusted_cap_rate,
         ds.yield_spread,
         ds.current_noi,
         ds.price_per_unit,
         ds.price_psf,
         ds.expense_ratio,
         ds.deal_score,
         ds.created_at AS signal_at
       FROM properties p
       JOIN LATERAL (
         SELECT *
         FROM deal_signals s
         WHERE s.property_id = p.id
         ORDER BY s.created_at DESC
         LIMIT 1
       ) ds ON TRUE
       WHERE ds.asset_cap_rate IS NOT NULL
       ORDER BY ds.asset_cap_rate DESC
       LIMIT $1`,
      [limit]
    );

    let rows: OperatingCompRow[] = result.rows.map((row) => ({
      propertyId: String(row.property_id),
      canonicalAddress: String(row.canonical_address),
      borough: (row.borough as string | null) ?? null,
      neighborhood: (row.neighborhood as string | null) ?? null,
      dealState: (row.deal_state as string | null) ?? null,
      dealStage: (row.deal_stage as string | null) ?? null,
      lat: toNumber(row.lat),
      lng: toNumber(row.lng),
      units: toNumber(row.units),
      ltrYieldPct: toNumber(row.asset_cap_rate),
      mtrYieldPct: toNumber(row.adjusted_cap_rate),
      yieldSpreadPct: toNumber(row.yield_spread),
      currentNoi: toNumber(row.current_noi),
      pricePerUnit: toNumber(row.price_per_unit),
      pricePsf: toNumber(row.price_psf),
      expenseRatioPct: toNumber(row.expense_ratio),
      dealScore: toNumber(row.deal_score),
      signalAt: row.signal_at instanceof Date ? row.signal_at.toISOString() : (row.signal_at as string | null),
    }));

    if (borough) rows = rows.filter((row) => (row.borough ?? "").toLowerCase().includes(borough));
    if (minYield != null) rows = rows.filter((row) => row.ltrYieldPct != null && row.ltrYieldPct >= minYield);
    if (maxYield != null) rows = rows.filter((row) => row.ltrYieldPct != null && row.ltrYieldPct <= maxYield);

    const yields = rows
      .map((row) => row.ltrYieldPct)
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b);
    const median = yields.length > 0 ? yields[Math.floor((yields.length - 1) / 2)] : null;
    const average = yields.length > 0 ? yields.reduce((sum, value) => sum + value, 0) / yields.length : null;

    const byBorough = new Map<string, number[]>();
    for (const row of rows) {
      const key = row.borough?.trim() || "Unknown";
      if (row.ltrYieldPct == null) continue;
      byBorough.set(key, [...(byBorough.get(key) ?? []), row.ltrYieldPct]);
    }
    const boroughStats = [...byBorough.entries()]
      .map(([name, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return {
          borough: name,
          count: sorted.length,
          medianLtrYieldPct: sorted[Math.floor((sorted.length - 1) / 2)],
          minLtrYieldPct: sorted[0],
          maxLtrYieldPct: sorted[sorted.length - 1],
        };
      })
      .sort((a, b) => b.count - a.count);

    res.json({
      comps: rows,
      summary: {
        count: rows.length,
        withCoordinates: rows.filter((row) => row.lat != null && row.lng != null).length,
        averageLtrYieldPct: average,
        medianLtrYieldPct: median,
        boroughStats,
      },
    });
  } catch (err) {
    console.error("[comps operating]", err);
    res.status(500).json({ error: "Failed to load operating comps." });
  }
});

export default router;
