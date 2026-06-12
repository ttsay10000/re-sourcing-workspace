/**
 * Stage 2a: neighborhood rollups. All math (medians, ranges, counts) is
 * computed here in code — the synthesis LLM only words the bullets.
 *
 * Median rules: only address-level comps with price_type = "closed", resolved
 * to the polygon, sale_date in the trailing 12 months, and not flagged
 * cherry_pick_risk. Minimum n = 3; below that the stats stay null and the
 * popup falls back to a single submarket-level market_stats row labeled with
 * its publisher. Aggregates are NEVER averaged across publishers — their
 * universes differ (Alpha: 5+ units ≥$1M citywide; AY: ≥$5M south of 96th;
 * Ariel: 10+ unit focus, splits Northern Manhattan), which is how Q1 2026 can
 * print Manhattan both "down 13% QoQ" (Ariel, below-96th) and "up 93.8% QoQ"
 * (Alpha, all Manhattan). A fallback therefore always cites exactly one stat row.
 */
import type { MarketComp, MarketStat, NeighborhoodRecord, NeighborhoodSummary } from "@re-sourcing/contracts";
import { fallbackSubmarketsFor } from "./neighborhoodResolve.js";

export const ROLLUP_MIN_N = 3;
const TRAILING_MONTHS = 12;

/**
 * Sale-condition prints that are not arm's-length fee-simple building trades:
 * portfolio allocations, partial interests, note sales, and ground leases
 * never enter median math (they would corrupt $/SF and cap medians). Estate /
 * vacant / 1031 / distressed prints stay in — they are real clearing prices
 * whose flags explain them.
 */
const NON_COMPARABLE_CONDITIONS = new Set(["portfolio_sale", "partial_interest", "note_sale", "ground_lease"]);

export function isNonComparableSale(comp: Pick<MarketComp, "saleConditions">): boolean {
  return (comp.saleConditions ?? []).some((condition) => NON_COMPARABLE_CONDITIONS.has(condition));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rangeOf(values: number[]): [number, number] | null {
  if (values.length === 0) return null;
  return [Math.min(...values), Math.max(...values)];
}

function withinTrailingMonths(saleDate: string | null, asOf: Date, months: number): boolean {
  if (!saleDate) return false;
  const date = new Date(saleDate);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - months);
  return date >= cutoff && date <= asOf;
}

/** Corroborated comps (research + broker tags) count as research. */
export function effectiveSourceType(comp: MarketComp): "market_research" | "broker_provided" {
  const list = comp.provenanceList.length > 0 ? comp.provenanceList : [comp.provenance];
  return list.some((p) => p.source_type === "market_research") ? "market_research" : "broker_provided";
}

function reportShortName(comp: MarketComp): string {
  const research = comp.provenanceList.find((p) => p.source_type === "market_research");
  const provenance = research ?? comp.provenance;
  return provenance.report_title ?? provenance.publisher ?? "broker document";
}

export interface NeighborhoodRollupDraft extends Omit<NeighborhoodSummary, "updatedAt" | "bullets" | "regulatorySkew"> {
  /** Comps included in the medians (closed, resolved, trailing 12mo, not cherry-picked). */
  includedComps: MarketComp[];
  /** Excluded-but-viewable records (cherry-picked / asking) for pins + toggles. */
  excludedComps: MarketComp[];
  topComps: MarketComp[];
  /** Deterministic skew from the data; synthesis may reword it. */
  regulatorySkew: string | null;
  /** The single stat row backing fallback_context, when used. */
  fallbackStat: MarketStat | null;
}

const FALLBACK_METRIC_PRIORITY = [
  "median_cap_rate",
  "avg_cap_rate",
  "median_price_psf",
  "avg_price_psf",
  "median_psf",
  "avg_psf",
];

/** Only pricing levels can back a popup fallback — never volume/transaction counts. */
function isPricingMetric(metric: string): boolean {
  return /psf|price_per_sf|cap_rate/.test(metric);
}

function metricLabel(stat: MarketStat): string {
  if (/cap_rate/.test(stat.metric)) {
    const pct = stat.value > 1 ? stat.value : stat.value * 100;
    return `${/median/.test(stat.metric) ? "median" : "avg"} cap ${pct.toFixed(2)}%`;
  }
  return `${/median/.test(stat.metric) ? "median" : "avg"} $${Math.round(stat.value).toLocaleString("en-US")}/SF`;
}

function periodLabel(period: string | null): string | null {
  if (!period) return null;
  if (period === "trailing_6mo") return "trailing 6-mo";
  if (period === "trailing_12mo") return "trailing 12-mo";
  return period.replace(/_/g, " ");
}

function segmentLabel(segment: string | null): string | null {
  if (!segment) return null;
  if (/free_market/.test(segment)) return "FM";
  if (/rent_stabilized|rs/.test(segment)) return "RS";
  return segment.replace(/_/g, " ");
}

/**
 * Pick ONE submarket stat (single publisher) to back a thin neighborhood.
 * Most specific submarket wins, then metric priority, then recency.
 */
export function pickFallbackStat(neighborhood: NeighborhoodRecord, stats: MarketStat[]): MarketStat | null {
  const scopes = fallbackSubmarketsFor(neighborhood);
  for (const scope of scopes) {
    const candidates = stats.filter(
      (stat) => stat.submarketId === scope && stat.metricType === "level" && isPricingMetric(stat.metric)
    );
    if (candidates.length === 0) continue;
    const byPriority = [...candidates].sort((a, b) => {
      const ai = FALLBACK_METRIC_PRIORITY.findIndex((metric) => a.metric.includes(metric) || metric.includes(a.metric));
      const bi = FALLBACK_METRIC_PRIORITY.findIndex((metric) => b.metric.includes(metric) || metric.includes(b.metric));
      const aRank = ai === -1 ? FALLBACK_METRIC_PRIORITY.length : ai;
      const bRank = bi === -1 ? FALLBACK_METRIC_PRIORITY.length : bi;
      if (aRank !== bRank) return aRank - bRank;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return byPriority[0] ?? null;
  }
  return null;
}

export function buildFallbackContext(stat: MarketStat): string {
  const pieces = [stat.geoName];
  const segment = segmentLabel(stat.segment);
  if (segment) pieces.push(segment);
  const publisher = stat.provenance.publisher ?? "unknown publisher";
  const period = periodLabel(stat.period);
  return `Submarket: ${pieces.join(" ")} ${metricLabel(stat)} (${publisher}${period ? `, ${period}` : ""})`;
}

/**
 * Read-time refresh of a stored summary's fallback line. A research report
 * ingested AFTER a thin neighborhood was last synthesized may carry the
 * submarket stat it should fall back to; summaries are only re-synthesized for
 * neighborhoods the new document touched, so the freshest single-publisher
 * stat is overlaid when serving the map payload instead.
 */
export function withReadTimeFallback<T extends { medianCapRate: number | null; medianPsf: number | null; fallbackContext: string | null }>(
  summary: T,
  neighborhood: NeighborhoodRecord,
  stats: MarketStat[]
): T {
  if (summary.medianCapRate != null || summary.medianPsf != null) return summary;
  const stat = pickFallbackStat(neighborhood, stats);
  if (!stat) return summary;
  return { ...summary, fallbackContext: buildFallbackContext(stat) };
}

export function computeNeighborhoodRollup(params: {
  neighborhood: NeighborhoodRecord;
  comps: MarketComp[];
  submarketStats: MarketStat[];
  asOf?: Date;
}): NeighborhoodRollupDraft {
  const asOf = params.asOf ?? new Date();
  const inHood = params.comps.filter((comp) => comp.neighborhoodId === params.neighborhood.id);
  const recent = inHood.filter((comp) => withinTrailingMonths(comp.saleDate, asOf, TRAILING_MONTHS));

  const included = recent.filter(
    (comp) => comp.priceType === "closed" && !comp.cherryPickRisk && !isNonComparableSale(comp)
  );
  const cherryPicked = recent.filter((comp) => comp.cherryPickRisk);
  const asking = inHood.filter((comp) => comp.priceType === "asking");
  const nonComparable = recent.filter((comp) => isNonComparableSale(comp));
  const excluded = [...new Set([...cherryPicked, ...asking, ...nonComparable])];

  const caps = included.map((comp) => comp.capRate).filter((value): value is number => value != null);
  const psfs = included.map((comp) => comp.pricePsf).filter((value): value is number => value != null);

  const enough = included.length >= ROLLUP_MIN_N;
  const medianCapRate = enough && caps.length >= ROLLUP_MIN_N ? median(caps) : null;
  const medianPsf = enough && psfs.length >= ROLLUP_MIN_N ? median(psfs) : null;

  const nResearch = included.filter((comp) => effectiveSourceType(comp) === "market_research").length;

  const rsValues = included
    .map((comp) => comp.pctRentStabilized)
    .filter((value): value is number => value != null);
  const rsMedian = median(rsValues);
  const regulatorySkew =
    rsMedian == null
      ? null
      : rsMedian <= 0.1
        ? "mostly free-market"
        : rsMedian <= 0.5
          ? "mixed RS / free-market"
          : "RS-heavy";

  const freshness =
    included.length > 0
      ? included.map((comp) => comp.saleDate).filter((d): d is string => d != null).sort().at(-1) ?? null
      : null;

  const sources = [...new Set([...included, ...excluded].map((comp) => reportShortName(comp)))];

  const needsFallback = medianCapRate == null && medianPsf == null;
  const fallbackStat = needsFallback ? pickFallbackStat(params.neighborhood, params.submarketStats) : null;

  const topComps = [...included]
    .sort((a, b) => (b.saleDate ?? "").localeCompare(a.saleDate ?? ""))
    .slice(0, 3);

  return {
    neighborhoodId: params.neighborhood.id,
    compCount12mo: included.length,
    nResearch,
    nBroker: included.length - nResearch,
    nCherryPickExcluded: cherryPicked.length,
    nAskingExcluded: asking.length,
    medianCapRate,
    capRateRange: enough ? rangeOf(caps) : null,
    medianPsf,
    psfRange: enough ? rangeOf(psfs) : null,
    regulatorySkew,
    fallbackContext: fallbackStat ? buildFallbackContext(fallbackStat) : null,
    dataFreshness: freshness,
    sources,
    includedComps: included,
    excludedComps: excluded,
    topComps,
    fallbackStat,
  };
}
