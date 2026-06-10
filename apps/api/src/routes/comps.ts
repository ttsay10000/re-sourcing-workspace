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
  /** When the property first entered the system (properties.created_at). */
  sourcedAt: string | null;
  /** Cap rate of the first stored signal — the yield as first produced. */
  firstYieldPct: number | null;
  /** When the yield was first produced (first deal_signals row with a cap rate). */
  firstYieldAt: string | null;
  /** Latest minus first cap rate, in percentage points. Null until a second observation exists. */
  yieldDeltaPct: number | null;
  yieldTrend: "up" | "down" | "flat" | null;
  /** Distinct cap-rate observations: the first signal plus every refresh that changed the rate. */
  yieldHistory: Array<{ rate: number; at: string }>;
}

interface NeighborhoodStat {
  neighborhood: string;
  borough: string | null;
  count: number;
  medianLtrYieldPct: number;
  minLtrYieldPct: number;
  maxLtrYieldPct: number;
  trendUpCount: number;
  trendDownCount: number;
  trendFlatCount: number;
  /** Median of per-deal yield deltas (latest − first), where a delta exists. */
  medianYieldDeltaPct: number | null;
  /** Earliest first-yield date in the area (falls back to property created_at). */
  firstSourcedAt: string | null;
}

/** Yield moves smaller than this (in percentage points) read as flat — below display precision. */
const TREND_FLAT_EPSILON_PP = 0.005;

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function median(sortedAscending: number[]): number | null {
  return sortedAscending.length > 0 ? sortedAscending[Math.floor((sortedAscending.length - 1) / 2)] : null;
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
         p.created_at AS sourced_at,
         hist.yield_obs_count,
         hist.yield_history,
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
       -- Cap-rate timeline: the first signal plus every refresh where the rate changed
       -- (consecutive regenerations with the same rate collapse onto the first date).
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) AS yield_obs_count,
           json_agg(json_build_object('rate', t.asset_cap_rate, 'at', t.generated_at) ORDER BY t.generated_at)
             FILTER (WHERE t.prev_rate IS NULL OR t.asset_cap_rate <> t.prev_rate) AS yield_history
         FROM (
           SELECT h.asset_cap_rate, h.generated_at,
                  lag(h.asset_cap_rate) OVER (ORDER BY h.generated_at) AS prev_rate
           FROM deal_signals h
           -- Zero/negative stored rates are data errors (see resolveOperatingYield);
           -- keeping them out of the timeline stops fake "up" trends from a bad first extraction.
           WHERE h.property_id = p.id AND h.asset_cap_rate IS NOT NULL AND h.asset_cap_rate > 0
         ) t
       ) hist ON TRUE
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

        // Cap-rate timeline. Flagged rows get no trend: their stored rates are
        // data errors, and a 0% first extraction would read as a fake "up" move.
        const rawHistory =
          resolved.flag == null && Array.isArray(row.yield_history)
            ? (row.yield_history as Array<Record<string, unknown>>)
            : [];
        const yieldHistory = rawHistory
          .map((point) => ({ rate: toNumber(point.rate), at: toIsoString(point.at) }))
          .filter((point): point is { rate: number; at: string } => point.rate != null && point.at != null);
        const observationCount = toNumber(row.yield_obs_count) ?? 0;
        const firstPoint = yieldHistory[0] ?? null;
        const lastPoint = yieldHistory[yieldHistory.length - 1] ?? null;
        // A trend needs at least two observations; a refresh that left the rate
        // unchanged still counts as a (flat) second observation.
        let yieldDeltaPct: number | null = null;
        let yieldTrend: OperatingCompRow["yieldTrend"] = null;
        if (firstPoint && lastPoint && observationCount >= 2) {
          yieldDeltaPct = lastPoint.rate - firstPoint.rate;
          yieldTrend =
            yieldDeltaPct > TREND_FLAT_EPSILON_PP ? "up" : yieldDeltaPct < -TREND_FLAT_EPSILON_PP ? "down" : "flat";
        }

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
          signalAt: toIsoString(row.signal_at),
          yieldSource: resolved.yieldSource,
          yieldFlag: resolved.flag,
          yieldFlagDetail: resolved.flagDetail,
          sourcedAt: toIsoString(row.sourced_at),
          firstYieldPct: firstPoint?.rate ?? null,
          firstYieldAt: firstPoint?.at ?? null,
          yieldDeltaPct,
          yieldTrend,
          yieldHistory,
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
    const medianYield = median(yields);
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
          medianLtrYieldPct: median(sorted) as number,
          minLtrYieldPct: sorted[0],
          maxLtrYieldPct: sorted[sorted.length - 1],
        };
      })
      .sort((a, b) => b.count - a.count);

    const byNeighborhood = new Map<string, OperatingCompRow[]>();
    for (const row of rows) {
      if (row.ltrYieldPct == null) continue;
      const key = row.neighborhood?.trim() || "Unknown";
      byNeighborhood.set(key, [...(byNeighborhood.get(key) ?? []), row]);
    }
    const neighborhoodStats: NeighborhoodStat[] = [...byNeighborhood.entries()]
      .map(([name, members]) => {
        const sorted = members.map((m) => m.ltrYieldPct as number).sort((a, b) => a - b);
        const deltas = members
          .map((m) => m.yieldDeltaPct)
          .filter((value): value is number => value != null)
          .sort((a, b) => a - b);
        const firstDates = members
          .map((m) => m.firstYieldAt ?? m.sourcedAt)
          .filter((value): value is string => value != null)
          .sort();
        return {
          neighborhood: name,
          borough: members.find((m) => m.borough)?.borough ?? null,
          count: sorted.length,
          medianLtrYieldPct: median(sorted) as number,
          minLtrYieldPct: sorted[0],
          maxLtrYieldPct: sorted[sorted.length - 1],
          trendUpCount: members.filter((m) => m.yieldTrend === "up").length,
          trendDownCount: members.filter((m) => m.yieldTrend === "down").length,
          trendFlatCount: members.filter((m) => m.yieldTrend === "flat").length,
          medianYieldDeltaPct: median(deltas),
          firstSourcedAt: firstDates[0] ?? null,
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
        medianLtrYieldPct: medianYield,
        boroughStats,
        neighborhoodStats,
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
