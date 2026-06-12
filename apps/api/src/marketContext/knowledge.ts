/**
 * Stage 3: the living market knowledge base + per-upload analyst brief.
 *
 * After every successful ingest the analyst step receives the current
 * knowledge narrative, THIS document's extracted comps/stats, and prior stats
 * + neighborhood rollups for the same metrics/geographies. The LLM (prompt
 * knowledge_v1) returns {document_brief, knowledge}; output is validated
 * defensively and, when no model is configured or the output fails
 * validation, a deterministic numbers-only brief + merge keeps the knowledge
 * base growing — ingest never blocks on a model. Raw output is persisted in
 * market_llm_outputs under stage "knowledge"; each update appends a new
 * versioned market_knowledge_entries row (auditable history).
 */
import type {
  MarketAssetType,
  MarketDocClassification,
  MarketDocIngestReport,
  MarketDocument,
  MarketDocumentBrief,
  MarketHeadline,
  MarketHeadlinesResponse,
  MarketKnowledgeAttentionNote,
  MarketKnowledgeClaim,
  MarketKnowledgeDiscrepancy,
  MarketDocumentNotes,
  MarketKnowledgeEntry,
  MarketKnowledgeExecInsight,
  MarketKnowledgeNarrative,
  MarketKnowledgeSubmarketTrend,
  MarketPriceType,
  MarketStat,
  MarketTrendDirection,
  NeighborhoodRecord,
} from "@re-sourcing/contracts";
import { KNOWLEDGE_PROMPT, MARKET_PROMPT_VERSIONS } from "./prompts.js";
import type { MarketLlmRunner } from "./llmAdapter.js";
import { median } from "./rollup.js";
import type { MarketContextStore } from "./store.js";

const MAX_TEXT_CHARS = 160;
const MAX_BRIEF_BULLETS = 6;
const MIN_BRIEF_BULLETS = 3;
const MAX_CLAIMS_PER_SCOPE = 5;
const MAX_EXEC_INSIGHTS = 5;
const MAX_TRENDS = 12;
const MAX_MOVEMENTS = 10;
const MAX_ATTENTION_NOTES = 8;
const MAX_DISCREPANCIES = 12;
const MAX_SOURCES = 24;
const MAX_HEADLINES = 6;
/** Conflict thresholds: cap rates in bps, $/SF and other levels relative. */
const DISCREPANCY_CAP_BPS = 75;
const DISCREPANCY_LEVEL_PCT = 0.2;

export const EMPTY_KNOWLEDGE_NARRATIVE: MarketKnowledgeNarrative = {
  asOf: null,
  executiveSummary: [],
  submarketTrends: [],
  assetTypeAttention: [],
  capRatePsfMovements: [],
  discrepancies: [],
  sources: [],
};

/** Structural subset of a comp the knowledge step needs (MergedComp and MarketComp both satisfy it). */
export interface KnowledgeCompInput {
  address: string;
  neighborhoodId: string | null;
  salePrice: number | null;
  priceType: MarketPriceType;
  saleDate: string | null;
  pricePsf: number | null;
  unitsTotal: number | null;
  pctRentStabilized: number | null;
  capRate: number | null;
  assetType: MarketAssetType | null;
  cherryPickRisk: boolean;
  isSubjectProperty: boolean;
}

// ---------------------------------------------------------------------------
// Formatting helpers (numbers only; every line names its source).
// ---------------------------------------------------------------------------

function clamp(text: string, max = MAX_TEXT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function pctText(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function psfText(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}/SF`;
}

function moneyShort(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function signedPct(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function signedBps(deltaDecimal: number): string {
  const bps = Math.round(deltaDecimal * 10_000);
  return `${bps >= 0 ? "+" : ""}${bps}bps`;
}

function metricHuman(metric: string): string {
  return metric.replace(/_/g, " ").replace(/\bpsf\b/i, "$/SF").replace(/\bavg\b/i, "avg");
}

function periodHuman(period: string | null): string | null {
  if (!period) return null;
  if (period === "trailing_6mo") return "trailing 6-mo";
  if (period === "trailing_12mo") return "trailing 12-mo";
  return period.replace(/_/g, " ");
}

function segmentHuman(segment: string | null): string | null {
  if (!segment) return null;
  if (/free_market/.test(segment)) return "FM";
  if (/rent_stabilized|^rs\b/.test(segment)) return "RS";
  return segment.replace(/_/g, " ");
}

function citation(publisher: string | null, period: string | null): string {
  const pieces = [publisher ?? "unbranded", periodHuman(period)].filter(Boolean);
  return `(${pieces.join(", ")})`;
}

function isCapMetric(metric: string): boolean {
  return /cap_rate|cap\b/.test(metric);
}

function isPsfMetric(metric: string): boolean {
  return /psf|price_per_sf/.test(metric);
}

/** One deterministic, fully cited claim from a stored stat row — never blended. */
export function claimFromStat(stat: MarketStat): MarketKnowledgeClaim {
  const publisher = stat.provenance.publisher;
  const segment = segmentHuman(stat.segment);
  const scopeSeg = `${stat.geoName}${segment ? ` ${segment}` : ""}`;
  if (stat.metricType === "pct_change") {
    const period = stat.comparisonPeriod ?? periodHuman(stat.period) ?? "";
    return {
      text: clamp(`${metricHuman(stat.metric)} ${signedPct(stat.value)} ${period} — ${scopeSeg} ${citation(publisher, null)}`),
      metric: stat.metric,
      value: stat.value,
      unit: "%",
      source: publisher,
      period: stat.comparisonPeriod ?? stat.period,
    };
  }
  if (isCapMetric(stat.metric)) {
    const rate = stat.value > 1 ? stat.value / 100 : stat.value;
    return {
      text: clamp(`${/median/.test(stat.metric) ? "Median" : "Avg"} cap ${pctText(rate)} — ${scopeSeg} ${citation(publisher, stat.period)}`),
      metric: stat.metric,
      value: rate,
      unit: "%",
      source: publisher,
      period: stat.period,
    };
  }
  if (isPsfMetric(stat.metric)) {
    return {
      text: clamp(`${/median/.test(stat.metric) ? "Median" : "Avg"} ${psfText(stat.value)} — ${scopeSeg} ${citation(publisher, stat.period)}`),
      metric: stat.metric,
      value: stat.value,
      unit: "$/SF",
      source: publisher,
      period: stat.period,
    };
  }
  if (/transaction_count|deal_count|n_sales/.test(stat.metric)) {
    return {
      text: clamp(`${Math.round(stat.value)} trades — ${scopeSeg} ${citation(publisher, stat.period)}`),
      metric: stat.metric,
      value: stat.value,
      unit: "trades",
      source: publisher,
      period: stat.period,
    };
  }
  if (/dollar_volume|volume/.test(stat.metric)) {
    return {
      text: clamp(`${moneyShort(stat.value)} volume — ${scopeSeg} ${citation(publisher, stat.period)}`),
      metric: stat.metric,
      value: stat.value,
      unit: "$",
      source: publisher,
      period: stat.period,
    };
  }
  return {
    text: clamp(`${metricHuman(stat.metric)} ${stat.value} — ${scopeSeg} ${citation(publisher, stat.period)}`),
    metric: stat.metric,
    value: stat.value,
    unit: null,
    source: publisher,
    period: stat.period,
  };
}

function formatStatValue(stat: MarketStat): string {
  if (stat.metricType === "pct_change") return signedPct(stat.value);
  if (isCapMetric(stat.metric)) return pctText(stat.value > 1 ? stat.value / 100 : stat.value);
  if (isPsfMetric(stat.metric)) return psfText(stat.value);
  if (/dollar_volume|volume/.test(stat.metric)) return moneyShort(stat.value);
  return String(stat.value);
}

// ---------------------------------------------------------------------------
// Defensive validation of the LLM's {document_brief, knowledge} JSON.
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Bullets must be non-empty, carry a number, and stay near the 120-char cap. */
function cleanBullets(value: unknown, max: number, requireDigit = true): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= MAX_TEXT_CHARS && (!requireDigit || /\d/.test(item)))
    .slice(0, max);
}

function cleanClaims(value: unknown, max: number): MarketKnowledgeClaim[] {
  if (!Array.isArray(value)) return [];
  const claims: MarketKnowledgeClaim[] = [];
  for (const raw of value) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const text = asString(row.text);
    // Every claim must carry a number (priority e) — drop unnumbered ones.
    if (!text || text.length > MAX_TEXT_CHARS || !/\d/.test(text)) continue;
    claims.push({
      text,
      metric: asString(row.metric),
      value: asNumberOrNull(row.value),
      unit: asString(row.unit),
      source: asString(row.source),
      period: asString(row.period),
    });
    if (claims.length >= max) break;
  }
  return claims;
}

const DIRECTIONS: MarketTrendDirection[] = ["up", "down", "flat", "mixed"];
const ATTENTIONS = ["more", "less", "steady"] as const;

/** Exec insights are claims + optional trajectory direction. */
function cleanExecInsights(value: unknown, max: number): MarketKnowledgeExecInsight[] {
  if (!Array.isArray(value)) return [];
  const insights: MarketKnowledgeExecInsight[] = [];
  for (const raw of value) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const text = asString(row.text);
    if (!text || text.length > MAX_TEXT_CHARS || !/\d/.test(text)) continue;
    insights.push({
      text,
      metric: asString(row.metric),
      value: asNumberOrNull(row.value),
      unit: asString(row.unit),
      source: asString(row.source),
      period: asString(row.period),
      direction: DIRECTIONS.includes(row.direction as MarketTrendDirection)
        ? (row.direction as MarketTrendDirection)
        : null,
    });
    if (insights.length >= max) break;
  }
  return insights;
}

export interface KnowledgeBriefDraft {
  title: string | null;
  whatItSays: string[];
  comparedToPrior: string[];
  discrepancies: string[];
}

export interface KnowledgeValidationResult {
  brief: KnowledgeBriefDraft | null;
  narrative: MarketKnowledgeNarrative | null;
}

/** Parse the model's JSON defensively; either half may survive on its own. */
export function validateKnowledgeOutput(parsed: Record<string, unknown> | null): KnowledgeValidationResult {
  if (!parsed) return { brief: null, narrative: null };

  let brief: KnowledgeBriefDraft | null = null;
  const rawBrief = parsed.document_brief;
  if (rawBrief != null && typeof rawBrief === "object" && !Array.isArray(rawBrief)) {
    const row = rawBrief as Record<string, unknown>;
    const whatItSays = cleanBullets(row.what_it_says, MAX_BRIEF_BULLETS);
    if (whatItSays.length > 0) {
      brief = {
        title: asString(row.title),
        whatItSays,
        comparedToPrior: cleanBullets(row.compared_to_prior, MAX_BRIEF_BULLETS, false),
        discrepancies: cleanBullets(row.discrepancies, MAX_BRIEF_BULLETS, false),
      };
    }
  }

  let narrative: MarketKnowledgeNarrative | null = null;
  const rawKnowledge = parsed.knowledge;
  if (rawKnowledge != null && typeof rawKnowledge === "object" && !Array.isArray(rawKnowledge)) {
    const row = rawKnowledge as Record<string, unknown>;
    const trends: MarketKnowledgeSubmarketTrend[] = [];
    if (Array.isArray(row.submarket_trends)) {
      for (const raw of row.submarket_trends) {
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
        const trend = raw as Record<string, unknown>;
        const scope = asString(trend.scope);
        if (!scope) continue;
        const direction = DIRECTIONS.includes(trend.direction as MarketTrendDirection)
          ? (trend.direction as MarketTrendDirection)
          : "mixed";
        const claims = cleanClaims(trend.claims, MAX_CLAIMS_PER_SCOPE);
        if (claims.length === 0) continue;
        trends.push({ scope, direction, claims });
        if (trends.length >= MAX_TRENDS) break;
      }
    }
    const attention: MarketKnowledgeAttentionNote[] = [];
    if (Array.isArray(row.asset_type_attention)) {
      for (const raw of row.asset_type_attention) {
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
        const note = raw as Record<string, unknown>;
        const segment = asString(note.segment);
        const text = asString(note.note);
        if (!segment || !text || text.length > MAX_TEXT_CHARS) continue;
        attention.push({
          segment,
          attention: ATTENTIONS.includes(note.attention as (typeof ATTENTIONS)[number])
            ? (note.attention as (typeof ATTENTIONS)[number])
            : "steady",
          note: text,
        });
        if (attention.length >= MAX_ATTENTION_NOTES) break;
      }
    }
    const discrepancies: MarketKnowledgeDiscrepancy[] = [];
    if (Array.isArray(row.discrepancies)) {
      for (const raw of row.discrepancies) {
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
        const item = raw as Record<string, unknown>;
        const topic = asString(item.topic);
        const detail = asString(item.detail);
        if (!topic || !detail) continue;
        discrepancies.push({
          topic,
          detail: clamp(detail, 240),
          sources: Array.isArray(item.sources)
            ? item.sources.filter((src): src is string => typeof src === "string").slice(0, 6)
            : [],
          status: item.status === "resolved" ? "resolved" : "open",
        });
        if (discrepancies.length >= MAX_DISCREPANCIES) break;
      }
    }
    const sources = Array.isArray(row.sources)
      ? row.sources.filter((src): src is string => typeof src === "string").slice(0, MAX_SOURCES)
      : [];
    const movements = cleanClaims(row.cap_rate_psf_movements, MAX_MOVEMENTS);
    const executiveSummary = cleanExecInsights(row.executive_summary, MAX_EXEC_INSIGHTS);
    if (trends.length > 0 || movements.length > 0 || sources.length > 0 || executiveSummary.length > 0) {
      narrative = {
        asOf: asString(row.as_of),
        executiveSummary,
        submarketTrends: trends,
        assetTypeAttention: attention,
        capRatePsfMovements: movements,
        discrepancies,
        sources,
      };
    }
  }

  return { brief, narrative };
}

// ---------------------------------------------------------------------------
// Deterministic brief + merge (no-model fallback; numbers straight from rows).
// ---------------------------------------------------------------------------

interface DeterministicInputs {
  classification: MarketDocClassification;
  filename: string;
  report: MarketDocIngestReport;
  comps: KnowledgeCompInput[];
  stats: MarketStat[];
  priorStats: MarketStat[];
  priorNarrative: MarketKnowledgeNarrative | null;
  summaries: KnowledgeSummaryInput[];
  neighborhoods: NeighborhoodRecord[];
}

/** Structural subset of a stored neighborhood summary used for comparisons + fallback headlines. */
export interface KnowledgeSummaryInput {
  neighborhoodId: string;
  compCount12mo: number;
  medianCapRate: number | null;
  medianPsf: number | null;
  dataFreshness: string | null;
  /** Report short names backing the rollup (skip self-only comparisons). */
  sources: string[];
}

function sourceLabel(classification: MarketDocClassification, filename: string): string {
  return `${classification.publisher ?? filename} — ${classification.period_covered ?? "period n/a"}`;
}

function statKey(stat: MarketStat): string {
  return [stat.metric, stat.metricType, stat.submarketId ?? stat.geoName.toLowerCase(), stat.segment ?? ""].join("|");
}

/** Latest prior stat matching metric + scope + segment (publisher may differ — both get cited). */
function latestPriorStat(stat: MarketStat, priorStats: MarketStat[]): MarketStat | null {
  const matches = priorStats
    .filter((prior) => statKey(prior) === statKey(stat))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return matches[0] ?? null;
}

export function compareStatLine(current: MarketStat, prior: MarketStat): string {
  const publisherPair =
    current.provenance.publisher === prior.provenance.publisher
      ? current.provenance.publisher ?? "unbranded"
      : `${current.provenance.publisher ?? "unbranded"} vs ${prior.provenance.publisher ?? "unbranded"}`;
  if (isCapMetric(current.metric) && current.metricType === "level") {
    const now = current.value > 1 ? current.value / 100 : current.value;
    const was = prior.value > 1 ? prior.value / 100 : prior.value;
    return clamp(
      `${current.geoName} ${metricHuman(current.metric)} ${pctText(now)} vs ${pctText(was)} prior — ${signedBps(now - was)} (${publisherPair})`
    );
  }
  const deltaPct = prior.value !== 0 ? ((current.value - prior.value) / Math.abs(prior.value)) * 100 : 0;
  return clamp(
    `${current.geoName} ${metricHuman(current.metric)} ${formatStatValue(current)} vs ${formatStatValue(prior)} prior — ${signedPct(deltaPct)} (${publisherPair})`
  );
}

function isStatConflict(current: MarketStat, prior: MarketStat): boolean {
  if (current.metricType !== "level") return false;
  if (isCapMetric(current.metric)) {
    const now = current.value > 1 ? current.value / 100 : current.value;
    const was = prior.value > 1 ? prior.value / 100 : prior.value;
    return Math.abs(now - was) * 10_000 >= DISCREPANCY_CAP_BPS;
  }
  if (prior.value === 0) return current.value !== 0;
  return Math.abs(current.value - prior.value) / Math.abs(prior.value) >= DISCREPANCY_LEVEL_PCT;
}

interface DocCompMedians {
  neighborhoodId: string;
  n: number;
  medianCap: number | null;
  medianPsf: number | null;
}

function docCompMediansByNeighborhood(comps: KnowledgeCompInput[]): DocCompMedians[] {
  const byHood = new Map<string, KnowledgeCompInput[]>();
  for (const comp of comps) {
    if (!comp.neighborhoodId || comp.isSubjectProperty || comp.priceType !== "closed") continue;
    const list = byHood.get(comp.neighborhoodId) ?? [];
    list.push(comp);
    byHood.set(comp.neighborhoodId, list);
  }
  return [...byHood.entries()].map(([neighborhoodId, list]) => ({
    neighborhoodId,
    n: list.length,
    medianCap: median(list.map((comp) => comp.capRate).filter((v): v is number => v != null)),
    medianPsf: median(list.map((comp) => comp.pricePsf).filter((v): v is number => v != null)),
  }));
}

/** Per-upload analyst brief computed entirely in code (model-free fallback). */
export function deterministicBrief(inputs: DeterministicInputs): KnowledgeBriefDraft {
  const { classification, report, comps, stats, priorStats, summaries, neighborhoods } = inputs;
  const hoodNames = new Map(neighborhoods.map((hood) => [hood.id, hood.name]));

  const whatItSays: string[] = [];
  whatItSays.push(
    clamp(
      `${classification.publisher ?? "Unbranded"} ${classification.document_class}: ${report.nComps} comps, ` +
        `${report.nStats} stats (${classification.period_covered ?? "period n/a"})`
    )
  );
  const statClaims = [...stats].sort((a, b) => {
    const rank = (stat: MarketStat) =>
      isCapMetric(stat.metric) || isPsfMetric(stat.metric) ? 0 : stat.metricType === "pct_change" ? 1 : 2;
    return rank(a) - rank(b);
  });
  for (const stat of statClaims.slice(0, 3)) whatItSays.push(claimFromStat(stat).text);

  const closed = comps.filter((comp) => comp.priceType === "closed" && !comp.isSubjectProperty);
  const caps = closed.map((comp) => comp.capRate).filter((v): v is number => v != null);
  const psfs = closed.map((comp) => comp.pricePsf).filter((v): v is number => v != null);
  const medCap = median(caps);
  const medPsf = median(psfs);
  if (closed.length >= 2 && (medCap != null || medPsf != null)) {
    const parts = [medCap != null ? `median cap ${pctText(medCap)}` : null, medPsf != null ? `median ${psfText(medPsf)}` : null]
      .filter(Boolean)
      .join(" / ");
    whatItSays.push(clamp(`Doc closed comps: ${parts} across ${closed.length} sales`));
  }
  const subject = comps.find((comp) => comp.isSubjectProperty);
  if (subject) {
    whatItSays.push(
      clamp(
        `Subject ${subject.address}: ${subject.salePrice != null ? `asking ${moneyShort(subject.salePrice)}` : "no price"}` +
          `${subject.capRate != null ? `, ${pctText(subject.capRate)} cap` : ""}${subject.unitsTotal != null ? `, ${subject.unitsTotal} units` : ""}`
      )
    );
  }
  if (whatItSays.length < MIN_BRIEF_BULLETS) {
    whatItSays.push(
      clamp(
        `${report.affectedNeighborhoods.length} neighborhoods touched; ${report.unresolvedNeighborhoods.length} unresolved names; ` +
          `${report.nCompsMerged} comps corroborated across sources`
      )
    );
  }

  const comparedToPrior: string[] = [];
  const discrepancies: string[] = [];

  // Stat vs latest prior stat for the same metric/scope/segment.
  for (const stat of stats) {
    const prior = latestPriorStat(stat, priorStats);
    if (!prior) continue;
    const line = compareStatLine(stat, prior);
    comparedToPrior.push(line);
    if (isStatConflict(stat, prior) && stat.provenance.publisher !== prior.provenance.publisher) {
      discrepancies.push(line);
    }
  }

  // Doc-internal conflicts: same metric + scope + segment + period, different values.
  const seen = new Map<string, MarketStat>();
  for (const stat of stats) {
    const key = `${statKey(stat)}|${stat.period ?? ""}|${stat.comparisonPeriod ?? ""}`;
    const twin = seen.get(key);
    if (twin && twin.value !== stat.value) {
      discrepancies.push(
        clamp(
          `Internal conflict: ${metricHuman(stat.metric)} ${stat.geoName} prints ${formatStatValue(stat)} and ${formatStatValue(twin)} in the same document`
        )
      );
    } else {
      seen.set(key, stat);
    }
  }

  // Doc comp medians vs the knowledge-base neighborhood rollups. For deal docs
  // (cherry-picked sets excluded from rollups) a wide gap is a discrepancy flag.
  const isDealDocument = classification.document_class === "om" || classification.document_class === "bov";
  const docLabel = classification.report_title ?? classification.publisher ?? "broker document";
  const summaryById = new Map(summaries.map((summary) => [summary.neighborhoodId, summary]));
  for (const docMedian of docCompMediansByNeighborhood(comps)) {
    const summary = summaryById.get(docMedian.neighborhoodId);
    if (!summary) continue;
    // A rollup built solely from this document is not "prior" data — skip.
    if (summary.sources.length > 0 && summary.sources.every((source) => source === docLabel)) continue;
    const name = hoodNames.get(docMedian.neighborhoodId) ?? docMedian.neighborhoodId;
    if (docMedian.medianCap != null && summary.medianCapRate != null) {
      const delta = docMedian.medianCap - summary.medianCapRate;
      const line = clamp(
        `${name}: doc median cap ${pctText(docMedian.medianCap)} vs ${pctText(summary.medianCapRate)} rollup (${summary.compCount12mo} comps) — ${signedBps(delta)}`
      );
      comparedToPrior.push(line);
      if (isDealDocument && Math.abs(delta) * 10_000 >= DISCREPANCY_CAP_BPS) {
        discrepancies.push(
          clamp(
            `${name}: broker comp set median cap ${pctText(docMedian.medianCap)} vs ${pctText(summary.medianCapRate)} neighborhood rollup — ${signedBps(delta)} (cherry-pick risk)`
          )
        );
      }
    } else if (docMedian.medianPsf != null && summary.medianPsf != null) {
      const deltaPct = ((docMedian.medianPsf - summary.medianPsf) / summary.medianPsf) * 100;
      comparedToPrior.push(
        clamp(
          `${name}: doc median ${psfText(docMedian.medianPsf)} vs ${psfText(summary.medianPsf)} rollup (${summary.compCount12mo} comps) — ${signedPct(deltaPct)}`
        )
      );
    }
  }

  return {
    title: classification.report_title ?? inputs.filename,
    whatItSays: whatItSays.slice(0, MAX_BRIEF_BULLETS),
    comparedToPrior: comparedToPrior.slice(0, MAX_BRIEF_BULLETS),
    discrepancies: discrepancies.slice(0, MAX_BRIEF_BULLETS),
  };
}

function directionFromStats(scopeStats: MarketStat[], prior: MarketTrendDirection | null): MarketTrendDirection {
  const changes = scopeStats.filter((stat) => stat.metricType === "pct_change");
  const up = changes.some((stat) => stat.value > 2);
  const down = changes.some((stat) => stat.value < -2);
  if (up && down) return "mixed";
  if (up) return "up";
  if (down) return "down";
  if (changes.length > 0) return "flat";
  return prior ?? "flat";
}

/** Segment attention counts the analyst watches (free-market sub-9-unit, RS share, 96th St split). */
function attentionNotes(inputs: DeterministicInputs): MarketKnowledgeAttentionNote[] {
  const { comps, classification, neighborhoods } = inputs;
  const closed = comps.filter((comp) => comp.priceType === "closed");
  if (closed.length === 0) return [];
  const cite = citation(classification.publisher, classification.period_covered);
  const notes: MarketKnowledgeAttentionNote[] = [];

  const fmSub9 = closed.filter(
    (comp) => comp.unitsTotal != null && comp.unitsTotal <= 8 && (comp.pctRentStabilized ?? 0) <= 0.1
  );
  if (fmSub9.length > 0) {
    notes.push({
      segment: "free-market sub-9-unit buildings",
      attention: fmSub9.length / closed.length >= 0.25 ? "more" : "steady",
      note: clamp(`${fmSub9.length} of ${closed.length} closed comps are FM sub-9-unit ${cite}`),
    });
  }
  const rsHeavy = closed.filter((comp) => (comp.pctRentStabilized ?? 0) >= 0.5);
  if (rsHeavy.length > 0) {
    notes.push({
      segment: "rent-stabilized ≥50% share",
      attention: rsHeavy.length / closed.length >= 0.5 ? "more" : "steady",
      note: clamp(`${rsHeavy.length} of ${closed.length} closed comps ≥50% RS ${cite}`),
    });
  }
  const submarketById = new Map(neighborhoods.map((hood) => [hood.id, hood.submarketId]));
  const north = closed.filter((comp) => comp.neighborhoodId && submarketById.get(comp.neighborhoodId) === "northern_manhattan");
  const south = closed.filter((comp) => comp.neighborhoodId && submarketById.get(comp.neighborhoodId) === "manhattan_below_96");
  if (north.length > 0 || south.length > 0) {
    notes.push({
      segment: "north vs south of 96th St",
      attention: north.length > south.length ? "more" : "steady",
      note: clamp(`${north.length} closed comps north of 96th vs ${south.length} south ${cite}`),
    });
  }
  return notes;
}

/** Code-only merge of this document's facts into the prior narrative. */
export function deterministicNarrativeMerge(inputs: DeterministicInputs): MarketKnowledgeNarrative {
  const prior = inputs.priorNarrative ?? EMPTY_KNOWLEDGE_NARRATIVE;
  const { classification, stats } = inputs;

  // Submarket trends keyed by verbatim scope (publisher universes stay distinct).
  const trends: MarketKnowledgeSubmarketTrend[] = prior.submarketTrends.map((trend) => ({
    ...trend,
    claims: [...trend.claims],
  }));
  const byScope = new Map(trends.map((trend) => [trend.scope.toLowerCase(), trend]));
  const statsByScope = new Map<string, MarketStat[]>();
  for (const stat of stats) {
    const list = statsByScope.get(stat.geoName) ?? [];
    list.push(stat);
    statsByScope.set(stat.geoName, list);
  }
  for (const [scope, scopeStats] of statsByScope) {
    const existing = byScope.get(scope.toLowerCase());
    const newClaims = scopeStats.map(claimFromStat);
    if (existing) {
      // Replace superseded claims (same metric + publisher), keep the rest.
      const kept = existing.claims.filter(
        (claim) => !newClaims.some((next) => next.metric === claim.metric && next.source === claim.source)
      );
      existing.claims = [...newClaims, ...kept].slice(0, MAX_CLAIMS_PER_SCOPE);
      existing.direction = directionFromStats(scopeStats, existing.direction);
    } else {
      const trend: MarketKnowledgeSubmarketTrend = {
        scope,
        direction: directionFromStats(scopeStats, null),
        claims: newClaims.slice(0, MAX_CLAIMS_PER_SCOPE),
      };
      trends.push(trend);
      byScope.set(scope.toLowerCase(), trend);
    }
  }

  // Asset-type attention: latest note per segment wins.
  const attention = [...prior.assetTypeAttention];
  for (const note of attentionNotes(inputs)) {
    const index = attention.findIndex((existing) => existing.segment === note.segment);
    if (index >= 0) attention[index] = note;
    else attention.push(note);
  }

  // Cap-rate / $PSF movements: pricing levels and pct-changes, newest first.
  const movementClaims = stats
    .filter((stat) => isCapMetric(stat.metric) || isPsfMetric(stat.metric) || stat.metricType === "pct_change")
    .map(claimFromStat);
  const movementKey = (claim: MarketKnowledgeClaim) => `${claim.metric ?? claim.text}|${claim.source ?? ""}`;
  const movements = [
    ...movementClaims,
    ...prior.capRatePsfMovements.filter(
      (claim) => !movementClaims.some((next) => movementKey(next) === movementKey(claim))
    ),
  ].slice(0, MAX_MOVEMENTS);

  // Open discrepancies accumulate (latest detail per topic wins).
  const discrepancies = [...prior.discrepancies];
  const briefDraft = deterministicBrief(inputs);
  for (const detail of briefDraft.discrepancies) {
    const topic = clamp(detail, 60);
    const index = discrepancies.findIndex((existing) => existing.topic === topic);
    const entry: MarketKnowledgeDiscrepancy = {
      topic,
      detail,
      sources: [classification.publisher ?? inputs.filename],
      status: "open",
    };
    if (index >= 0) discrepancies[index] = entry;
    else discrepancies.push(entry);
  }

  const sources = [...new Set([...prior.sources, sourceLabel(classification, inputs.filename)])];

  // Deterministic exec summary: cross-period deltas (same metric + scope)
  // lead, then the top movement — so the panel never renders empty without a
  // model. Direction stays null (no inference from formatted text).
  const freshExec: MarketKnowledgeExecInsight[] = [
    ...briefDraft.comparedToPrior.slice(0, 3).map((text) => ({
      text: clamp(text),
      metric: null,
      value: null,
      unit: null,
      source: null,
      period: null,
      direction: null,
    })),
    ...movements.slice(0, 1).map((claim) => ({ ...claim, direction: null })),
  ]
    .filter((insight, index, all) => all.findIndex((other) => other.text === insight.text) === index)
    .slice(0, MAX_EXEC_INSIGHTS - 1);
  const executiveSummary = freshExec.length > 0 ? freshExec : prior.executiveSummary ?? [];

  return {
    asOf: classification.period_covered ?? prior.asOf,
    executiveSummary,
    submarketTrends: trends.slice(0, MAX_TRENDS),
    assetTypeAttention: attention.slice(0, MAX_ATTENTION_NOTES),
    capRatePsfMovements: movements,
    discrepancies: discrepancies.slice(0, MAX_DISCREPANCIES),
    sources: sources.slice(0, MAX_SOURCES),
  };
}

// ---------------------------------------------------------------------------
// LLM input + orchestration.
// ---------------------------------------------------------------------------

const MAX_PROMPT_COMPS = 40;
const MAX_PROMPT_PRIOR_STATS = 40;
const MAX_PROMPT_ROLLUPS = 30;

export function buildKnowledgeInput(inputs: DeterministicInputs): string {
  const docMetrics = new Set(inputs.stats.map((stat) => stat.metric));
  const docScopes = new Set(inputs.stats.map((stat) => stat.submarketId).filter(Boolean));
  const relevantPrior = inputs.priorStats
    .filter((stat) => docMetrics.has(stat.metric) || (stat.submarketId != null && docScopes.has(stat.submarketId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PROMPT_PRIOR_STATS);
  const hoodNames = new Map(inputs.neighborhoods.map((hood) => [hood.id, hood.name]));
  return JSON.stringify(
    {
      current_knowledge_base: inputs.priorNarrative,
      this_upload: {
        classification: {
          source_type: inputs.classification.source_type,
          publisher: inputs.classification.publisher,
          document_class: inputs.classification.document_class,
          report_title: inputs.classification.report_title,
          period_covered: inputs.classification.period_covered,
          geo_scope: inputs.classification.geo_scope,
          filename: inputs.filename,
        },
        comps: inputs.comps.slice(0, MAX_PROMPT_COMPS).map((comp) => ({
          address: comp.address,
          neighborhood_id: comp.neighborhoodId,
          sale_price: comp.salePrice,
          price_type: comp.priceType,
          sale_date: comp.saleDate,
          price_psf: comp.pricePsf,
          units_total: comp.unitsTotal,
          pct_rent_stabilized: comp.pctRentStabilized,
          cap_rate: comp.capRate,
          asset_type: comp.assetType,
          cherry_pick_risk: comp.cherryPickRisk,
          is_subject_property: comp.isSubjectProperty,
        })),
        stats: inputs.stats.map((stat) => ({
          metric: stat.metric,
          metric_type: stat.metricType,
          value: stat.value,
          comparison_period: stat.comparisonPeriod,
          geo_name: stat.geoName,
          segment: stat.segment,
          period: stat.period,
          publisher: stat.provenance.publisher,
        })),
      },
      prior_stats_same_scope: relevantPrior.map((stat) => ({
        metric: stat.metric,
        metric_type: stat.metricType,
        value: stat.value,
        comparison_period: stat.comparisonPeriod,
        geo_name: stat.geoName,
        segment: stat.segment,
        period: stat.period,
        publisher: stat.provenance.publisher,
        recorded_at: stat.createdAt,
      })),
      neighborhood_rollups: inputs.summaries.slice(0, MAX_PROMPT_ROLLUPS).map((summary) => ({
        neighborhood: hoodNames.get(summary.neighborhoodId) ?? summary.neighborhoodId,
        comp_count_12mo: summary.compCount12mo,
        median_cap_rate: summary.medianCapRate,
        median_psf: summary.medianPsf,
        data_freshness: summary.dataFreshness,
      })),
    },
    null,
    2
  );
}

export interface UpdateMarketKnowledgeParams {
  document: MarketDocument;
  classification: MarketDocClassification;
  report: MarketDocIngestReport;
  comps: KnowledgeCompInput[];
  /** This document's saved stats. */
  stats: MarketStat[];
  /** This document's analyst notes (extra context for the merge prompt). */
  notes?: MarketDocumentNotes | null;
  store: MarketContextStore;
  llm: MarketLlmRunner | null;
  asOf?: Date;
}

export interface UpdateMarketKnowledgeResult {
  brief: MarketDocumentBrief;
  entry: MarketKnowledgeEntry;
}

/**
 * Generate + persist the per-upload brief, then fold it into the knowledge
 * base (new versioned entry). Falls back to the deterministic brief/merge when
 * no model is configured or its output fails validation.
 */
export async function updateMarketKnowledge(params: UpdateMarketKnowledgeParams): Promise<UpdateMarketKnowledgeResult> {
  const promptVersion = MARKET_PROMPT_VERSIONS.knowledge;
  const { store } = params;
  const priorEntry = await store.getLatestKnowledgeEntry();
  const allStats = await store.listAllStats();
  const inputs: DeterministicInputs = {
    classification: params.classification,
    filename: params.document.filename,
    report: params.report,
    comps: params.comps,
    stats: params.stats,
    priorStats: allStats.filter((stat) => stat.documentId !== params.document.id),
    priorNarrative: priorEntry?.narrative ?? null,
    summaries: await store.listAllSummaries(),
    neighborhoods: await store.listNeighborhoods(),
  };

  let brief: KnowledgeBriefDraft | null = null;
  let narrative: MarketKnowledgeNarrative | null = null;
  let provider: string | null = null;
  let model: string | null = null;

  if (params.llm) {
    // The per-document analyst notes ride along as extra context (financing,
    // buyer activity, small-building reads that the comp/stat rows miss).
    const notesContext = params.notes
      ? `\n\nTHIS UPLOAD'S ANALYST NOTES:\n${JSON.stringify(
          {
            overview: params.notes.overview,
            buyer_activity: params.notes.buyerActivity,
            cap_rate_psf: params.notes.capRatePsf,
            financing: params.notes.financing,
            small_building_focus: params.notes.smallBuildingFocus,
          },
          null,
          2
        )}`
      : "";
    const llm = await params.llm({
      stage: "knowledge",
      prompt: `${KNOWLEDGE_PROMPT}\n\nSUPPLIED RECORDS:\n${buildKnowledgeInput(inputs)}${notesContext}`,
    });
    await store.saveLlmOutput({
      documentId: params.document.id,
      stage: "knowledge",
      promptVersion,
      provider: llm.provider,
      model: llm.model,
      rawOutput: llm.rawOutput,
      parsed: llm.parsed,
    });
    const validated = validateKnowledgeOutput(llm.parsed);
    brief = validated.brief;
    narrative = validated.narrative;
    if (validated.brief || validated.narrative) {
      provider = llm.provider;
      model = llm.model;
    }
  }

  const briefDraft = brief ?? deterministicBrief(inputs);
  const finalBrief: MarketDocumentBrief = {
    title: briefDraft.title ?? params.classification.report_title ?? params.document.filename,
    whatItSays: briefDraft.whatItSays,
    comparedToPrior: briefDraft.comparedToPrior,
    discrepancies: briefDraft.discrepancies,
    incorporatedAt: (params.asOf ?? new Date()).toISOString(),
    promptVersion,
  };
  const finalNarrative = narrative ?? deterministicNarrativeMerge(inputs);

  await store.saveDocumentBrief(params.document.id, finalBrief);
  const entry = await store.appendKnowledgeEntry({
    documentId: params.document.id,
    narrative: finalNarrative,
    brief: finalBrief,
    promptVersion,
    provider,
    model,
  });
  return { brief: finalBrief, entry };
}

// ---------------------------------------------------------------------------
// Market headlines (Yield Map ticker). Never throws; never blends publishers.
// ---------------------------------------------------------------------------

function toneFromDirection(direction: MarketTrendDirection): MarketHeadline["tone"] {
  if (direction === "up") return "up";
  if (direction === "down") return "down";
  if (direction === "mixed") return "watch";
  return "neutral";
}

function toneFromValue(value: number | null): MarketHeadline["tone"] {
  if (value == null || value === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

export function headlinesFromKnowledge(entry: MarketKnowledgeEntry): MarketHeadline[] {
  const headlines: MarketHeadline[] = [];
  const seen = new Set<string>();
  // Normalized dedupe key — near-duplicate lines differing only in case or
  // whitespace previously rendered twice on the Yield Map strip.
  const dedupeKey = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const push = (text: string, tone: MarketHeadline["tone"], scope: string | null, source: string | null, asOf: string | null) => {
    const trimmed = clamp(text, 140);
    if (!trimmed || seen.has(dedupeKey(trimmed)) || headlines.length >= MAX_HEADLINES) return;
    seen.add(dedupeKey(trimmed));
    headlines.push({
      id: `kb-v${entry.version}-${headlines.length + 1}`,
      text: trimmed,
      tone,
      scope,
      source,
      asOf,
    });
  };
  const narrative = entry.narrative;
  // The exec read leads the strip — cross-report, trends-over-time takeaways.
  for (const insight of narrative.executiveSummary ?? []) {
    push(
      insight.text,
      insight.direction ? toneFromDirection(insight.direction) : "neutral",
      null,
      insight.source,
      insight.period ?? narrative.asOf
    );
  }
  for (const trend of narrative.submarketTrends) {
    const claim = trend.claims[0];
    if (!claim) continue;
    push(claim.text, toneFromDirection(trend.direction), trend.scope, claim.source, claim.period ?? narrative.asOf);
  }
  for (const claim of narrative.capRatePsfMovements) {
    push(
      claim.text,
      claim.unit === "%" && claim.metric != null && !isCapMetric(claim.metric) ? toneFromValue(claim.value) : "neutral",
      null,
      claim.source,
      claim.period ?? narrative.asOf
    );
  }
  for (const note of narrative.assetTypeAttention) {
    if (note.attention === "steady") continue;
    push(note.note, "watch", note.segment, null, narrative.asOf);
  }
  for (const discrepancy of narrative.discrepancies) {
    if (discrepancy.status !== "open") continue;
    push(discrepancy.detail, "watch", discrepancy.topic, discrepancy.sources[0] ?? null, narrative.asOf);
  }
  return headlines;
}

/** Rule-based headlines from neighborhood_summaries + market_stats deltas (no knowledge base / no LLM key). */
export function fallbackHeadlines(params: {
  summaries: KnowledgeSummaryInput[];
  stats: MarketStat[];
  neighborhoods: NeighborhoodRecord[];
}): MarketHeadline[] {
  const headlines: MarketHeadline[] = [];
  const seenScopes = new Set<string>();

  // 1. Publisher-scoped deltas (pct_change stats ARE the deltas — never blended).
  const changes = [...params.stats]
    .filter((stat) => stat.metricType === "pct_change")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const stat of changes) {
    const key = `${stat.metric}|${stat.submarketId ?? stat.geoName}|${stat.provenance.publisher ?? ""}`;
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    headlines.push({
      id: `fb-stat-${headlines.length + 1}`,
      text: clamp(
        `${stat.geoName} ${metricHuman(stat.metric)} ${signedPct(stat.value)} ${stat.comparisonPeriod ?? ""} — ${stat.provenance.publisher ?? "unbranded"}`,
        140
      ),
      tone: toneFromValue(stat.value),
      scope: stat.geoName,
      source: stat.provenance.publisher,
      asOf: stat.period,
    });
    if (headlines.length >= 4) break;
  }

  // 2. Neighborhood rollup levels, deepest comp coverage first.
  const hoodNames = new Map(params.neighborhoods.map((hood) => [hood.id, hood.name]));
  const ranked = [...params.summaries]
    .filter((summary) => summary.medianCapRate != null || summary.medianPsf != null)
    .sort((a, b) => b.compCount12mo - a.compCount12mo);
  for (const summary of ranked) {
    if (headlines.length >= MAX_HEADLINES) break;
    const name = hoodNames.get(summary.neighborhoodId) ?? summary.neighborhoodId;
    const figure =
      summary.medianCapRate != null
        ? `median cap ${pctText(summary.medianCapRate)}`
        : `median ${psfText(summary.medianPsf as number)}`;
    headlines.push({
      id: `fb-hood-${headlines.length + 1}`,
      text: clamp(`${name} ${figure} on ${summary.compCount12mo} closed trades (12mo) — market comps`, 140),
      tone: "neutral",
      scope: name,
      source: "market comps",
      asOf: summary.dataFreshness,
    });
  }
  return headlines.slice(0, MAX_HEADLINES);
}

/**
 * Exact GET /api/market-headlines payload. Knowledge base first; rule-based
 * fallback when it is empty; empty list when there is no data at all.
 */
export function computeMarketHeadlines(params: {
  knowledge: MarketKnowledgeEntry | null;
  summaries: KnowledgeSummaryInput[];
  stats: MarketStat[];
  neighborhoods: NeighborhoodRecord[];
}): MarketHeadlinesResponse {
  if (params.knowledge) {
    const headlines = headlinesFromKnowledge(params.knowledge);
    if (headlines.length > 0) {
      return {
        headlines,
        generatedAt: params.knowledge.createdAt,
        knowledgeVersion: params.knowledge.version,
      };
    }
  }
  const headlines = fallbackHeadlines(params);
  return {
    headlines,
    generatedAt: headlines.length > 0 ? new Date().toISOString() : null,
    knowledgeVersion: null,
  };
}
