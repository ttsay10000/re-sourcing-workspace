/**
 * Operating comps ("living database") read API.
 *
 * Every property that has a calculated LTR yield (asset cap rate from the
 * latest deal signals — the reconstructed-actuals NOI basis over price) is a
 * comp row, regardless of pipeline state. Dead deals stay queryable.
 *
 * The derived fallback (no signal yet) mirrors the same basis: reconstruct NOI
 * from extracted gross rent + other income − expenses, and only fall back to
 * the broker-stated NOI when reconstruction is impossible.
 */

import { Router, type Request, type Response } from "express";
import { getPool } from "@re-sourcing/db";
import { resolveOperatingYield, sanitizeRatePct, type OperatingYieldFlag } from "../deal/operatingYield.js";

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
  /** "signal" = stored deal_signals row; "derived" = NOI ÷ ask computed at read time; null when flagged. */
  yieldSource: "signal" | "derived" | null;
  /** Set when the deal's yield data is untrustworthy (0%/negative cap, $0 NOI); excluded from all stats. */
  yieldFlag: OperatingYieldFlag | null;
  yieldFlagDetail: string | null;
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
  // flagged=1 → only deals with yield data-quality flags (home-page follow-ups).
  const flaggedOnly = req.query.flagged === "1";

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
         ds.generated_at AS signal_at,
         lst.listing_price,
         p.details#>>'{omData,authoritative,currentFinancials,grossRentalIncome}' AS fallback_rent_om,
         p.details#>>'{omData,authoritative,currentFinancials,otherIncome}' AS fallback_other_income_om,
         p.details#>>'{omData,authoritative,expenses,totalExpenses}' AS fallback_expense_total_om,
         p.details#>>'{omData,authoritative,currentFinancials,operatingExpenses}' AS fallback_expenses_om,
         p.details#>>'{omData,authoritative,currentFinancials,noi}' AS fallback_noi_om,
         p.details#>>'{rentalFinancials,omAnalysis,currentFinancials,noi}' AS fallback_noi_analysis,
         p.details#>>'{rentalFinancials,fromLlm,noi}' AS fallback_noi_llm,
         p.details#>>'{manualSourceFacts,askingPrice}' AS fallback_ask_manual,
         p.details#>>'{omData,authoritative,propertyInfo,askingPrice}' AS fallback_ask_om
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT *
         FROM deal_signals s
         WHERE s.property_id = p.id
         ORDER BY s.generated_at DESC
         LIMIT 1
       ) ds ON TRUE
       LEFT JOIN LATERAL (
         SELECT l.price AS listing_price
         FROM listing_property_matches m
         INNER JOIN listings l ON l.id = m.listing_id
         WHERE m.property_id = p.id AND m.status <> 'rejected'
         ORDER BY (m.status = 'accepted') DESC, m.confidence DESC NULLS LAST, m.created_at DESC
         LIMIT 1
       ) lst ON TRUE
       WHERE ds.asset_cap_rate IS NOT NULL
          OR p.details#>>'{omData,authoritative,currentFinancials,noi}' IS NOT NULL
          OR p.details#>>'{rentalFinancials,omAnalysis,currentFinancials,noi}' IS NOT NULL
          OR p.details#>>'{rentalFinancials,fromLlm,noi}' IS NOT NULL
       ORDER BY ds.asset_cap_rate DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );

    let rows: OperatingCompRow[] = result.rows
      .map((row) => {
        const signalLtr = toNumber(row.asset_cap_rate);
        const fallbackRent = toNumber(row.fallback_rent_om);
        const fallbackExpenses =
          toNumber(row.fallback_expense_total_om) ?? toNumber(row.fallback_expenses_om);
        const reconstructedNoi =
          fallbackRent != null && fallbackExpenses != null
            ? fallbackRent + (toNumber(row.fallback_other_income_om) ?? 0) - fallbackExpenses
            : null;
        const fallbackNoi =
          reconstructedNoi ??
          toNumber(row.fallback_noi_om) ?? toNumber(row.fallback_noi_analysis) ?? toNumber(row.fallback_noi_llm);
        const fallbackAsk =
          toNumber(row.fallback_ask_manual) ?? toNumber(row.fallback_ask_om) ?? toNumber(row.listing_price);
        const resolved = resolveOperatingYield({ signalLtrPct: signalLtr, fallbackNoi, fallbackAsk });
        // Rows with neither a usable yield nor a data-quality flag carry no
        // information for this view; flagged rows stay visible for follow-up.
        if (resolved.ltrYieldPct == null && resolved.flag == null) return null;
        const mtrYieldPct = resolved.flag == null ? sanitizeRatePct(toNumber(row.adjusted_cap_rate)) : null;
        const comp: OperatingCompRow = {
          propertyId: String(row.property_id),
          canonicalAddress: String(row.canonical_address),
          borough: (row.borough as string | null) ?? null,
          neighborhood: (row.neighborhood as string | null) ?? null,
          dealState: (row.deal_state as string | null) ?? null,
          dealStage: (row.deal_stage as string | null) ?? null,
          lat: toNumber(row.lat),
          lng: toNumber(row.lng),
          units: toNumber(row.units),
          ltrYieldPct: resolved.ltrYieldPct,
          mtrYieldPct,
          yieldSpreadPct: mtrYieldPct != null ? toNumber(row.yield_spread) : null,
          currentNoi: toNumber(row.current_noi) ?? fallbackNoi,
          pricePerUnit: toNumber(row.price_per_unit),
          pricePsf: toNumber(row.price_psf),
          expenseRatioPct: toNumber(row.expense_ratio),
          dealScore: toNumber(row.deal_score),
          signalAt: row.signal_at instanceof Date ? row.signal_at.toISOString() : (row.signal_at as string | null),
          yieldSource: resolved.yieldSource,
          yieldFlag: resolved.flag,
          yieldFlagDetail: resolved.flagDetail,
        };
        return comp;
      })
      .filter((row): row is OperatingCompRow => row != null)
      .sort((a, b) => (b.ltrYieldPct ?? -Infinity) - (a.ltrYieldPct ?? -Infinity));

    if (flaggedOnly) rows = rows.filter((row) => row.yieldFlag != null);
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
        // Flagged rows carry null yields, so every aggregate below already excludes them.
        flaggedCount: rows.filter((row) => row.yieldFlag != null).length,
        averageLtrYieldPct: average,
        medianLtrYieldPct: median,
        boroughStats,
      },
    });
  } catch (err) {
    console.error("[comps operating]", err);
    const pgCode = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : String(err);
    // Only show the migration hint when the missing object is part of migration 056.
    const missingMigration056Column =
      pgCode === "42703" && /\b(deal_state|deal_stage|stage_order|stage_entered_at|lat|lng|geocode_source|geocoded_at)\b/i.test(message);
    const migrationHint =
      missingMigration056Column || pgCode === "42P01"
        ? " The database schema is behind — run `npm run db:migrate` (migration 056 adds deal_stage/lat/lng)."
        : "";
    res.status(500).json({ error: `Failed to load operating comps.${migrationHint}`, details: message });
  }
});

export default router;
