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
 *
 * Yields are quoted on a pricing basis (`ask_source` query param):
 * - "listed" (default): NOI ÷ listed ask (OM asking price → matched listing).
 * - "whisper": NOI ÷ the latest broker whisper price / pricing opinion.
 * - "user": the underwriting view — stored signal cap rate (computed on the
 *   negotiated/entered purchase price), falling back to NOI ÷ manual ask.
 * Every row also carries all three yields so the UI can compare bases without
 * refetching. `flagged=1` defaults to the "user" basis: its flags audit the
 * stored signals, not the marketed price.
 */

import { Router, type Request, type Response } from "express";
import { getPool, NeighborhoodRepo } from "@re-sourcing/db";
import {
  deriveBasisYield,
  resolveOperatingYield,
  sanitizeRatePct,
  type LtrAskSource,
  type OperatingYieldFlag,
} from "../deal/operatingYield.js";
import {
  buildNeighborhoodIndex,
  normalizeNeighborhoodName,
  resolveNeighborhoodId,
} from "../marketContext/neighborhoodResolve.js";

const router = Router();

interface OperatingCompRow {
  propertyId: string;
  canonicalAddress: string;
  borough: string | null;
  neighborhood: string | null;
  dealState: string | null;
  dealStage: string | null;
  /** Saved-deal status (deal-progress board input); lets the UI show the exact board stage. */
  savedStatus: string | null;
  lat: number | null;
  lng: number | null;
  units: number | null;
  /** The price behind ltrYieldPct — the requested basis's price. */
  askingPrice: number | null;
  /** LTR yield on the requested pricing basis (see ltrYieldBySource for all three). */
  ltrYieldPct: number | null;
  /** LTR yield recomputed on every pricing basis; null where that basis has no price/NOI. */
  ltrYieldBySource: Record<LtrAskSource, number | null>;
  /** listed = OM ask → matched listing; whisper = latest broker pricing opinion; user = manual/negotiated (signal basis). */
  askBySource: Record<LtrAskSource, number | null>;
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
  /** True when the yield comes from an unpromoted OM extraction run still awaiting manual review. */
  pendingReview: boolean;
}

/** NYC BBL borough digit → display name; backfills boroughs enrichment hasn't resolved yet. */
const BBL_BOROUGHS: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

/** "manhattan" / "MANHATTAN" → "Manhattan"; leaves multi-word values title-cased per word. */
function titleCaseBorough(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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


/** No neighborhood data yet: anything at/above this sale $/SF flags as high end. */
const DEFAULT_HIGH_PSF = 2000;

interface NeighborhoodPsfEntry {
  /** Canonical neighborhood id when resolvable, else the normalized raw name. */
  key: string;
  name: string;
  borough: string | null;
  /** Names the client can match listing/StreetEasy area labels against. */
  aliases: string[];
  medianPsf: number;
  count: number;
  dealCount: number;
  compCount: number;
}

/**
 * GET /api/comps/neighborhood-psf — median sale $/SF per neighborhood, blended
 * from our own deals (latest signals; ask/GSF fallback) and ingested market
 * research comps. StreetEasy/listing area labels resolve through the same
 * alias map the market layer uses, so publisher and listing names converge on
 * one polygon. Powers neighborhood-aware $/SF highlighting on the pipeline.
 */
router.get("/comps/neighborhood-psf", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const neighborhoods = await new NeighborhoodRepo({ pool }).listAll().catch(() => []);
    const index = buildNeighborhoodIndex(neighborhoods);
    const recordById = new Map(neighborhoods.map((hood) => [hood.id, hood]));

    const dealRows = await pool.query(
      `SELECT
         COALESCE(
           p.details#>>'{neighborhood,primary,name}',
           p.details#>>'{neighborhood,primary,neighborhood}',
           l.extra->>'neighborhood',
           l.extra->>'neighborhoodName',
           l.extra->>'area',
           l.extra->>'area_name'
         ) AS neighborhood_raw,
         p.details#>>'{neighborhood,primary,borough}' AS borough,
         COALESCE(
           ds.price_psf,
           CASE WHEN l.price > 0 AND l.sqft > 0 THEN l.price / l.sqft END
         ) AS price_psf
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT li.price, li.sqft, li.extra
         FROM listing_property_matches m
         INNER JOIN listings li ON li.id = m.listing_id
         WHERE m.property_id = p.id AND m.status <> 'rejected'
         ORDER BY (m.status = 'accepted') DESC, m.confidence DESC, m.created_at DESC
         LIMIT 1
       ) l ON true
       LEFT JOIN LATERAL (
         SELECT price_psf FROM deal_signals
         WHERE property_id = p.id
         ORDER BY generated_at DESC
         LIMIT 1
       ) ds ON true`
    );

    const compRows = await pool.query(
      `SELECT c.neighborhood_id, c.neighborhood_raw, c.price_psf
       FROM market_comps c
       LEFT JOIN market_documents d ON d.id = c.document_id
       WHERE c.price_psf IS NOT NULL AND c.price_psf > 0
         AND c.review_status != 'rejected'
         AND (c.document_id IS NULL OR d.excluded_at IS NULL)`
    );

    interface Bucket {
      key: string;
      name: string;
      borough: string | null;
      aliases: Set<string>;
      psfs: number[];
      dealCount: number;
      compCount: number;
    }
    const buckets = new Map<string, Bucket>();
    const add = (
      rawName: string | null,
      resolvedId: string | null,
      borough: string | null,
      psf: number | null,
      source: "deal" | "comp"
    ) => {
      if (psf == null || !Number.isFinite(psf) || psf <= 0) return;
      const id = resolvedId ?? (rawName ? resolveNeighborhoodId(rawName, index) : null);
      const record = id ? recordById.get(id) : undefined;
      const key = id ?? (rawName ? normalizeNeighborhoodName(rawName) : "");
      if (!key) return;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          name: record?.name ?? rawName?.trim() ?? key,
          borough: record?.borough ?? titleCaseBorough(borough),
          aliases: new Set(record ? [record.name, ...record.aliases] : rawName ? [rawName.trim()] : []),
          psfs: [],
          dealCount: 0,
          compCount: 0,
        };
        buckets.set(key, bucket);
      }
      if (rawName) bucket.aliases.add(rawName.trim());
      bucket.psfs.push(psf);
      if (source === "deal") bucket.dealCount++;
      else bucket.compCount++;
    };

    for (const row of dealRows.rows) {
      add(
        (row.neighborhood_raw as string | null) ?? null,
        null,
        (row.borough as string | null) ?? null,
        toNumber(row.price_psf),
        "deal"
      );
    }
    for (const row of compRows.rows) {
      add(
        (row.neighborhood_raw as string | null) ?? null,
        (row.neighborhood_id as string | null) ?? null,
        null,
        toNumber(row.price_psf),
        "comp"
      );
    }

    const entries: NeighborhoodPsfEntry[] = [...buckets.values()]
      .map((bucket) => {
        const sorted = [...bucket.psfs].sort((a, b) => a - b);
        return {
          key: bucket.key,
          name: bucket.name,
          borough: bucket.borough,
          aliases: [...bucket.aliases],
          medianPsf: median(sorted) ?? 0,
          count: bucket.psfs.length,
          dealCount: bucket.dealCount,
          compCount: bucket.compCount,
        };
      })
      .filter((entry) => entry.medianPsf > 0)
      .sort((a, b) => b.count - a.count);

    res.json({ neighborhoods: entries, defaultHighPsf: DEFAULT_HIGH_PSF });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[comps neighborhood-psf]", err);
    res.status(503).json({ error: "Failed to compute neighborhood $/SF medians.", details: message });
  }
});

router.get("/comps/operating", async (req: Request, res: Response) => {
  const borough = typeof req.query.borough === "string" ? req.query.borough.trim().toLowerCase() : "";
  const minYield = toNumber(req.query.minYield);
  const maxYield = toNumber(req.query.maxYield);
  const limit = Math.max(1, Math.min(toNumber(req.query.limit) ?? 500, 1000));
  // flagged=1 → only deals with yield data-quality flags (home-page follow-ups).
  const flaggedOnly = req.query.flagged === "1";
  // include_pending=1 → also return properties whose only numbers live in an
  // unpromoted OM extraction run (status needs_review/completed). They carry
  // pendingReview=true so the UI can mark them and gate them behind a toggle.
  const includePending = req.query.include_pending === "1";
  // Pricing basis for ltrYieldPct/yieldFlag/stats. Listed pricing is the
  // default so negotiated/entered prices can't inflate the map; flagged=1
  // stays on the user basis because its flags audit the stored signals.
  const askSourceParam = typeof req.query.ask_source === "string" ? req.query.ask_source.trim().toLowerCase() : "";
  const askSource: LtrAskSource =
    askSourceParam === "listed" || askSourceParam === "whisper" || askSourceParam === "user"
      ? askSourceParam
      : flaggedOnly
        ? "user"
        : "listed";

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT
         p.id AS property_id,
         p.canonical_address,
         p.deal_state,
         p.deal_stage,
         sd.deal_status AS saved_status,
         COALESCE(p.lat, CASE WHEN p.details->>'lat' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (p.details->>'lat')::double precision END) AS lat,
         COALESCE(p.lng, CASE WHEN p.details->>'lon' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (p.details->>'lon')::double precision END) AS lng,
         p.details#>>'{neighborhood,primary,borough}' AS borough,
         LEFT(p.details->>'bbl', 1) AS bbl_borough_digit,
         COALESCE(
           p.details#>>'{neighborhood,primary,name}',
           p.details#>>'{neighborhood,primary,neighborhood}',
           p.details#>>'{omData,authoritative,propertyInfo,neighborhood}',
           p.details#>>'{rentalFinancials,omAnalysis,propertyInfo,neighborhood}',
           lst.listing_extra->>'neighborhood',
           lst.listing_extra->>'neighborhoodName',
           lst.listing_extra->>'neighborhood_name',
           lst.listing_extra->>'area',
           lst.listing_extra->>'area_name'
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
         wsp.whisper_price,
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
         SELECT d.deal_status
         FROM saved_deals d
         WHERE d.property_id = p.id
         ORDER BY d.created_at DESC
         LIMIT 1
       ) sd ON TRUE
       LEFT JOIN LATERAL (
         SELECT l.price AS listing_price, l.extra AS listing_extra
         FROM listing_property_matches m
         INNER JOIN listings l ON l.id = m.listing_id
         WHERE m.property_id = p.id AND m.status <> 'rejected'
         ORDER BY (m.status = 'accepted') DESC, m.confidence DESC NULLS LAST, m.created_at DESC
         LIMIT 1
       ) lst ON TRUE
       -- Latest whisper price / broker pricing opinion (manual entry or comp-package
       -- extraction); analyst-reviewed amounts win over the extracted value.
       LEFT JOIN LATERAL (
         SELECT w.amount_text::numeric AS whisper_price
         FROM (
           SELECT COALESCE(NULLIF(i.reviewed_payload->>'amount', ''), i.normalized_payload->>'amount') AS amount_text,
                  i.created_at
           FROM broker_comp_extracted_items i
           WHERE i.property_id = p.id AND i.item_type = 'pricing_opinion' AND i.review_status <> 'rejected'
         ) w
         WHERE w.amount_text ~ '^[0-9]+(\\.[0-9]+)?$' AND w.amount_text::numeric > 0
         ORDER BY w.created_at DESC
         LIMIT 1
       ) wsp ON TRUE
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
        const listedAsk = toNumber(row.fallback_ask_om) ?? toNumber(row.listing_price);
        const whisperAsk = toNumber(row.whisper_price);
        const manualAsk = toNumber(row.fallback_ask_manual);
        const fallbackAsk = manualAsk ?? listedAsk;
        // Listed/whisper yields are always recomputed from NOI ÷ that basis's
        // price; the stored signal can't stand in for them because it was
        // produced on the underwriting (user) price. The signal's NOI does
        // backstop rows whose extraction details no longer carry one.
        const basisNoi = fallbackNoi ?? toNumber(row.current_noi);
        const resolvedBySource: Record<LtrAskSource, ReturnType<typeof resolveOperatingYield>> = {
          listed: deriveBasisYield(basisNoi, listedAsk),
          whisper: deriveBasisYield(basisNoi, whisperAsk),
          user: resolveOperatingYield({ signalLtrPct: signalLtr, fallbackNoi, fallbackAsk }),
        };
        const resolved = resolvedBySource[askSource];
        // Rows where no basis produces a usable yield or a data-quality flag
        // carry no information for this view; flagged rows stay visible for
        // follow-up, and rows missing only the selected basis's price stay
        // visible so the basis toggle never hides deals entirely.
        const isEmpty = (value: ReturnType<typeof resolveOperatingYield>) =>
          value.ltrYieldPct == null && value.flag == null;
        if (isEmpty(resolvedBySource.listed) && isEmpty(resolvedBySource.whisper) && isEmpty(resolvedBySource.user)) {
          return null;
        }
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
          borough: titleCaseBorough(
            (row.borough as string | null) ?? BBL_BOROUGHS[String(row.bbl_borough_digit ?? "")] ?? null
          ),
          neighborhood: (row.neighborhood as string | null) ?? null,
          dealState: (row.deal_state as string | null) ?? null,
          dealStage: (row.deal_stage as string | null) ?? null,
          savedStatus: (row.saved_status as string | null) ?? null,
          lat: toNumber(row.lat),
          lng: toNumber(row.lng),
          units: toNumber(row.units),
          askingPrice: askSource === "listed" ? listedAsk : askSource === "whisper" ? whisperAsk : fallbackAsk,
          ltrYieldPct: resolved.ltrYieldPct,
          ltrYieldBySource: {
            listed: resolvedBySource.listed.ltrYieldPct,
            whisper: resolvedBySource.whisper.ltrYieldPct,
            user: resolvedBySource.user.ltrYieldPct,
          },
          askBySource: { listed: listedAsk, whisper: whisperAsk, user: fallbackAsk },
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
          pendingReview: false,
        };
        return comp;
      })
      .filter((row): row is OperatingCompRow => row != null);

    if (includePending) {
      const seen = new Set(rows.map((row) => row.propertyId));
      const pendingResult = await pool.query(
        `SELECT
           p.id AS property_id,
           p.canonical_address,
           p.deal_state,
           p.deal_stage,
           sd.deal_status AS saved_status,
           COALESCE(p.lat, CASE WHEN p.details->>'lat' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (p.details->>'lat')::double precision END) AS lat,
           COALESCE(p.lng, CASE WHEN p.details->>'lon' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (p.details->>'lon')::double precision END) AS lng,
           p.details#>>'{neighborhood,primary,borough}' AS borough,
           LEFT(p.details->>'bbl', 1) AS bbl_borough_digit,
           COALESCE(
             p.details#>>'{neighborhood,primary,name}',
             p.details#>>'{neighborhood,primary,neighborhood}',
             p.details#>>'{omData,authoritative,propertyInfo,neighborhood}',
             p.details#>>'{rentalFinancials,omAnalysis,propertyInfo,neighborhood}',
             lst.listing_extra->>'neighborhood',
             lst.listing_extra->>'neighborhoodName',
             lst.listing_extra->>'neighborhood_name',
             lst.listing_extra->>'area',
             lst.listing_extra->>'area_name'
           ) AS neighborhood,
           p.created_at AS sourced_at,
           run.status AS run_status,
           run.started_at AS run_started_at,
           snap.snapshot,
           lst.listing_price,
           wsp.whisper_price
         FROM properties p
         JOIN LATERAL (
           SELECT r.id, r.status, r.started_at
           FROM om_ingestion_runs r
           WHERE r.property_id = p.id AND r.status IN ('needs_review', 'completed')
           ORDER BY r.started_at DESC
           LIMIT 1
         ) run ON TRUE
         LEFT JOIN LATERAL (
           SELECT es.snapshot FROM om_extracted_snapshots es WHERE es.run_id = run.id LIMIT 1
         ) snap ON TRUE
         LEFT JOIN LATERAL (
           SELECT d.deal_status
           FROM saved_deals d
           WHERE d.property_id = p.id
           ORDER BY d.created_at DESC
           LIMIT 1
         ) sd ON TRUE
         LEFT JOIN LATERAL (
           SELECT l.price AS listing_price, l.extra AS listing_extra
           FROM listing_property_matches m
           INNER JOIN listings l ON l.id = m.listing_id
           WHERE m.property_id = p.id AND m.status <> 'rejected'
           ORDER BY (m.status = 'accepted') DESC, m.confidence DESC NULLS LAST, m.created_at DESC
           LIMIT 1
         ) lst ON TRUE
         LEFT JOIN LATERAL (
           SELECT w.amount_text::numeric AS whisper_price
           FROM (
             SELECT COALESCE(NULLIF(i.reviewed_payload->>'amount', ''), i.normalized_payload->>'amount') AS amount_text,
                    i.created_at
             FROM broker_comp_extracted_items i
             WHERE i.property_id = p.id AND i.item_type = 'pricing_opinion' AND i.review_status <> 'rejected'
           ) w
           WHERE w.amount_text ~ '^[0-9]+(\\.[0-9]+)?$' AND w.amount_text::numeric > 0
           ORDER BY w.created_at DESC
           LIMIT 1
         ) wsp ON TRUE
         ORDER BY run.started_at DESC
         LIMIT $1`,
        [limit]
      );
      for (const row of pendingResult.rows) {
        const propertyId = String(row.property_id);
        // Promoted/signal-bearing rows win; the pending view only fills gaps.
        if (seen.has(propertyId)) continue;
        const snapshot = (row.snapshot ?? null) as {
          propertyInfo?: Record<string, unknown> | null;
          currentFinancials?: Record<string, unknown> | null;
          expenses?: Record<string, unknown> | null;
        } | null;
        const info = snapshot?.propertyInfo ?? null;
        const current = snapshot?.currentFinancials ?? null;
        const gross = toNumber(current?.grossRentalIncome);
        const expenses = toNumber(snapshot?.expenses?.totalExpenses) ?? toNumber(current?.operatingExpenses);
        const reconstructedNoi =
          gross != null && expenses != null ? gross + (toNumber(current?.otherIncome) ?? 0) - expenses : null;
        const noi = reconstructedNoi ?? toNumber(current?.noi);
        // Snapshot ask is the OM's marketed price, so listed and user coincide
        // here — pending rows have no manual price or stored signal yet.
        const ask = toNumber(info?.askingPrice) ?? toNumber(row.listing_price);
        const whisperAsk = toNumber(row.whisper_price);
        const resolvedBySource: Record<LtrAskSource, ReturnType<typeof resolveOperatingYield>> = {
          listed: deriveBasisYield(noi, ask),
          whisper: deriveBasisYield(noi, whisperAsk),
          user: resolveOperatingYield({ signalLtrPct: null, fallbackNoi: noi, fallbackAsk: ask }),
        };
        const resolved = resolvedBySource[askSource];
        if (
          resolvedBySource.listed.ltrYieldPct == null && resolvedBySource.listed.flag == null &&
          resolvedBySource.whisper.ltrYieldPct == null && resolvedBySource.whisper.flag == null &&
          resolvedBySource.user.ltrYieldPct == null && resolvedBySource.user.flag == null
        ) {
          continue;
        }
        const units = toNumber(info?.totalUnits);
        const gsf = toNumber(info?.grossSquareFeet) ?? toNumber(info?.grossSf) ?? toNumber(info?.squareFootage);
        seen.add(propertyId);
        rows.push({
          propertyId,
          canonicalAddress: String(row.canonical_address),
          borough: titleCaseBorough(
            (row.borough as string | null) ?? BBL_BOROUGHS[String(row.bbl_borough_digit ?? "")] ?? null
          ),
          neighborhood: (row.neighborhood as string | null) ?? null,
          dealState: (row.deal_state as string | null) ?? null,
          dealStage: (row.deal_stage as string | null) ?? null,
          savedStatus: (row.saved_status as string | null) ?? null,
          lat: toNumber(row.lat),
          lng: toNumber(row.lng),
          units,
          askingPrice: askSource === "whisper" ? whisperAsk : ask,
          ltrYieldPct: resolved.ltrYieldPct,
          ltrYieldBySource: {
            listed: resolvedBySource.listed.ltrYieldPct,
            whisper: resolvedBySource.whisper.ltrYieldPct,
            user: resolvedBySource.user.ltrYieldPct,
          },
          askBySource: { listed: ask, whisper: whisperAsk, user: ask },
          mtrYieldPct: null,
          yieldSpreadPct: null,
          currentNoi: noi,
          pricePerUnit: ask != null && units != null && units > 0 ? ask / units : null,
          pricePsf: ask != null && gsf != null && gsf > 0 ? ask / gsf : null,
          expenseRatioPct: null,
          dealScore: null,
          signalAt: null,
          yieldSource: resolved.yieldSource,
          yieldFlag: resolved.flag,
          yieldFlagDetail: resolved.flagDetail,
          sourcedAt: toIsoString(row.sourced_at),
          firstYieldPct: null,
          firstYieldAt: toIsoString(row.run_started_at),
          yieldDeltaPct: null,
          yieldTrend: null,
          yieldHistory: [],
          pendingReview: true,
        });
      }
    }

    rows = rows.sort((a, b) => (b.ltrYieldPct ?? -Infinity) - (a.ltrYieldPct ?? -Infinity));

    // Canonicalize neighborhood labels through the market layer's alias map so
    // enrichment names, StreetEasy area labels, and OM-derived strings all land
    // on the same polygon names the map renders ("kips-bay"/"Kips Bay NoMad"
    // variants stop fragmenting the per-hood stats into Unknowns).
    try {
      const hoods = await new NeighborhoodRepo({ pool }).listAll();
      if (hoods.length > 0) {
        const index = buildNeighborhoodIndex(hoods);
        const nameById = new Map(hoods.map((hood) => [hood.id, hood.name]));
        for (const row of rows) {
          if (!row.neighborhood) continue;
          const id = resolveNeighborhoodId(row.neighborhood, index);
          const canonical = id ? nameById.get(id) : null;
          if (canonical) row.neighborhood = canonical;
        }
      }
    } catch (err) {
      console.warn("[comps operating] neighborhood canonicalization skipped", err instanceof Error ? err.message : err);
    }

    if (flaggedOnly) rows = rows.filter((row) => row.yieldFlag != null);
    if (borough) rows = rows.filter((row) => (row.borough ?? "").toLowerCase().includes(borough));
    if (minYield != null) rows = rows.filter((row) => row.ltrYieldPct != null && row.ltrYieldPct >= minYield);
    if (maxYield != null) rows = rows.filter((row) => row.ltrYieldPct != null && row.ltrYieldPct <= maxYield);

    // Summary stats stay on reviewed data only — pending extractions are
    // returned for display but never move the medians until promoted.
    const statsRows = rows.filter((row) => !row.pendingReview);
    const yields = statsRows
      .map((row) => row.ltrYieldPct)
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b);
    const medianYield = median(yields);
    const average = yields.length > 0 ? yields.reduce((sum, value) => sum + value, 0) / yields.length : null;

    const byBorough = new Map<string, number[]>();
    for (const row of statsRows) {
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
    for (const row of statsRows) {
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
        /** Pricing basis every yield/stat in this response is quoted on. */
        askSource,
        count: rows.length,
        withCoordinates: rows.filter((row) => row.lat != null && row.lng != null).length,
        // Flagged rows carry null yields, so every aggregate below already excludes them.
        flaggedCount: rows.filter((row) => row.yieldFlag != null).length,
        pendingCount: rows.filter((row) => row.pendingReview).length,
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
