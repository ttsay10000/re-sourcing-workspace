/**
 * Live AI market review: the cross-document synthesis behind the market-docs
 * page panel. On refresh it takes EVERY currently included document's analyst
 * notes (excluded/removed documents drop out by construction), groups
 * same-publisher periods for QoQ comparisons, and asks the model for the
 * small-multifamily acquisitions read: smaller-building pricing, cap-rate
 * compression, buyer/seller activity, loan environment, opportunities, and
 * cross-brokerage discrepancies.
 *
 * The OpenAI model is preferred for this synthesis pass (notes were already
 * read by Gemini per document); when it fails the other provider is retried,
 * and with no model at all a deterministic digest assembles the per-document
 * notes so the panel never renders empty. Raw output persists in
 * market_llm_outputs under stage "review"; each refresh appends a versioned
 * market_reviews row.
 */
import type {
  MarketDocument,
  MarketKnowledgeEntry,
  MarketReview,
  MarketReviewDiscrepancy,
  MarketReviewQoqComparison,
  MarketReviewRecord,
  MarketStat,
} from "@re-sourcing/contracts";
import type { AppendMarketReviewParams } from "@re-sourcing/db";
import type { InsertMarketLlmOutputParams } from "@re-sourcing/db";
import { claimFromStat, compareStatLine } from "./knowledge.js";
import type { MarketLlmRunner } from "./llmAdapter.js";
import { MARKET_PROMPT_VERSIONS, MARKET_REVIEW_PROMPT } from "./prompts.js";

const MAX_REVIEW_DOCS = 24;
const MAX_PROMPT_STATS = 60;
const MAX_TEXT_CHARS = 220;
const CAPS = {
  marketPulse: 6,
  smallMultifamilyFocus: 8,
  capRateTrends: 8,
  buyerSellerActivity: 8,
  loanEnvironment: 6,
  opportunities: 8,
  qoqComparisons: 8,
  qoqChanges: 6,
  discrepancies: 8,
  positions: 4,
  sources: 24,
} as const;

function clamp(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_TEXT_CHARS ? trimmed : `${trimmed.slice(0, MAX_TEXT_CHARS - 1)}…`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cleanStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(clamp)
    .slice(0, max);
}

/** "Publisher — period (title)" used in sources and per-doc labels. */
export function reviewSourceLabel(document: MarketDocument): string {
  const publisher = document.publisher ?? document.filename;
  const period = document.period_covered ?? "period n/a";
  return document.report_title ? `${publisher} — ${period} (${document.report_title})` : `${publisher} — ${period}`;
}

/** Sortable key for period strings ("Q1 2026", "Jan–Feb 2026"); ingest time breaks ties. */
function periodSortKey(period: string | null, createdAt: string): string {
  if (period) {
    const quarter = period.match(/Q([1-4])\s*[' ]?(\d{2,4})/i);
    if (quarter) {
      const year = quarter[2].length === 2 ? `20${quarter[2]}` : quarter[2];
      return `${year}-Q${quarter[1]}`;
    }
    const year = period.match(/(20\d{2})/);
    if (year) return `${year[1]}-${period.toLowerCase()}`;
  }
  return `0000-${createdAt}`;
}

// ---------------------------------------------------------------------------
// Defensive validation of the model's review JSON.
// ---------------------------------------------------------------------------

export function validateReviewOutput(parsed: Record<string, unknown> | null): Omit<MarketReview, "sources"> | null {
  if (!parsed) return null;
  const headline = asString(parsed.headline);

  const qoqComparisons: MarketReviewQoqComparison[] = [];
  if (Array.isArray(parsed.qoq_comparisons)) {
    for (const raw of parsed.qoq_comparisons) {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const publisher = asString(row.publisher);
      const fromPeriod = asString(row.from_period);
      const toPeriod = asString(row.to_period);
      const changes = cleanStrings(row.changes, CAPS.qoqChanges);
      if (!publisher || !fromPeriod || !toPeriod || changes.length === 0) continue;
      qoqComparisons.push({ publisher, fromPeriod, toPeriod, changes });
      if (qoqComparisons.length >= CAPS.qoqComparisons) break;
    }
  }

  const discrepancies: MarketReviewDiscrepancy[] = [];
  if (Array.isArray(parsed.discrepancies)) {
    for (const raw of parsed.discrepancies) {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const topic = asString(row.topic);
      if (!topic) continue;
      const positions = Array.isArray(row.positions)
        ? row.positions
            .filter((pos): pos is Record<string, unknown> => pos != null && typeof pos === "object" && !Array.isArray(pos))
            .map((pos) => ({
              source: asString(pos.source) ?? "unknown",
              period: asString(pos.period),
              claim: clamp(asString(pos.claim) ?? ""),
            }))
            .filter((pos) => pos.claim.length > 0)
            .slice(0, CAPS.positions)
        : [];
      if (positions.length === 0) continue;
      discrepancies.push({ topic: clamp(topic), positions, note: asString(row.note) });
      if (discrepancies.length >= CAPS.discrepancies) break;
    }
  }

  const review = {
    headline: headline ? clamp(headline) : "",
    marketPulse: cleanStrings(parsed.market_pulse, CAPS.marketPulse),
    smallMultifamilyFocus: cleanStrings(parsed.small_multifamily_focus, CAPS.smallMultifamilyFocus),
    capRateTrends: cleanStrings(parsed.cap_rate_trends, CAPS.capRateTrends),
    buyerSellerActivity: cleanStrings(parsed.buyer_seller_activity, CAPS.buyerSellerActivity),
    loanEnvironment: cleanStrings(parsed.loan_environment, CAPS.loanEnvironment),
    opportunities: cleanStrings(parsed.opportunities, CAPS.opportunities),
    qoqComparisons,
    discrepancies,
  };
  const hasContent = review.headline.length > 0 && (review.marketPulse.length > 0 || review.smallMultifamilyFocus.length > 0);
  return hasContent ? review : null;
}

// ---------------------------------------------------------------------------
// Deterministic digest (no-model fallback): bubble up the per-document notes.
// ---------------------------------------------------------------------------

/** Same-publisher level stats paired across different periods → QoQ change lines. */
export function deterministicQoqComparisons(stats: MarketStat[]): MarketReviewQoqComparison[] {
  const byPublisher = new Map<string, MarketStat[]>();
  for (const stat of stats) {
    const publisher = stat.provenance.publisher;
    if (!publisher || stat.metricType !== "level") continue;
    const list = byPublisher.get(publisher) ?? [];
    list.push(stat);
    byPublisher.set(publisher, list);
  }

  const comparisons: MarketReviewQoqComparison[] = [];
  for (const [publisher, list] of byPublisher) {
    const bySeries = new Map<string, MarketStat[]>();
    for (const stat of list) {
      const key = [stat.metric, stat.submarketId ?? stat.geoName.toLowerCase(), stat.segment ?? ""].join("|");
      const series = bySeries.get(key) ?? [];
      series.push(stat);
      bySeries.set(key, series);
    }
    const periodPairs = new Map<string, { changes: string[]; fromPeriod: string; toPeriod: string }>();
    for (const series of bySeries.values()) {
      const distinct = [...new Map(series.map((stat) => [stat.period ?? stat.createdAt, stat])).values()].sort(
        (a, b) => periodSortKey(a.period, a.createdAt).localeCompare(periodSortKey(b.period, b.createdAt))
      );
      if (distinct.length < 2) continue;
      const prior = distinct[distinct.length - 2];
      const current = distinct[distinct.length - 1];
      if ((current.period ?? "") === (prior.period ?? "")) continue;
      const pairKey = `${prior.period ?? "?"}→${current.period ?? "?"}`;
      const pair = periodPairs.get(pairKey) ?? {
        changes: [],
        fromPeriod: prior.period ?? "prior",
        toPeriod: current.period ?? "current",
      };
      if (pair.changes.length < CAPS.qoqChanges) pair.changes.push(clamp(compareStatLine(current, prior)));
      periodPairs.set(pairKey, pair);
    }
    for (const pair of periodPairs.values()) {
      comparisons.push({ publisher, fromPeriod: pair.fromPeriod, toPeriod: pair.toPeriod, changes: pair.changes });
      if (comparisons.length >= CAPS.qoqComparisons) return comparisons;
    }
  }
  return comparisons;
}

function gatherNoteLines(
  documents: MarketDocument[],
  pick: (doc: MarketDocument) => string[] | undefined,
  max: number
): string[] {
  const lines: string[] = [];
  for (const doc of documents) {
    const publisher = doc.publisher ?? doc.filename;
    for (const line of pick(doc) ?? []) {
      lines.push(clamp(`${line} [${publisher}]`));
      if (lines.length >= max) return lines;
    }
  }
  return lines;
}

export function deterministicReview(params: {
  documents: MarketDocument[];
  stats: MarketStat[];
  knowledge: MarketKnowledgeEntry | null;
}): MarketReview {
  const { documents, stats, knowledge } = params;
  const latestPeriod =
    [...documents]
      .map((doc) => doc.period_covered)
      .filter((period): period is string => period != null)
      .sort((a, b) => periodSortKey(a, "").localeCompare(periodSortKey(b, "")))
      .at(-1) ?? null;

  const execTexts = (knowledge?.narrative.executiveSummary ?? []).map((insight) => clamp(insight.text));
  const statClaims = stats
    .filter((stat) => /cap_rate|cap\b|psf|price_per_sf/.test(stat.metric))
    .slice(0, CAPS.capRateTrends)
    .map((stat) => claimFromStat(stat).text);

  return {
    headline: clamp(
      `Numbers-only digest of ${documents.length} report${documents.length === 1 ? "" : "s"}` +
        `${latestPeriod ? ` through ${latestPeriod}` : ""} (no review model configured)`
    ),
    marketPulse: execTexts.length > 0 ? execTexts.slice(0, CAPS.marketPulse) : statClaims.slice(0, CAPS.marketPulse),
    smallMultifamilyFocus: gatherNoteLines(documents, (doc) => doc.llmNotes?.smallBuildingFocus, CAPS.smallMultifamilyFocus),
    capRateTrends: statClaims,
    buyerSellerActivity: gatherNoteLines(documents, (doc) => doc.llmNotes?.buyerActivity, CAPS.buyerSellerActivity),
    loanEnvironment: gatherNoteLines(documents, (doc) => doc.llmNotes?.financing, CAPS.loanEnvironment),
    opportunities: gatherNoteLines(documents, (doc) => doc.llmNotes?.investmentRelevance, CAPS.opportunities),
    qoqComparisons: deterministicQoqComparisons(stats),
    discrepancies: (knowledge?.narrative.discrepancies ?? [])
      .filter((item) => item.status === "open")
      .slice(0, CAPS.discrepancies)
      .map((item) => ({
        topic: clamp(item.topic),
        positions: [
          {
            source: item.sources.join(", ") || "knowledge base",
            period: null,
            claim: clamp(item.detail),
          },
        ],
        note: null,
      })),
    sources: documents.slice(0, CAPS.sources).map(reviewSourceLabel),
  };
}

// ---------------------------------------------------------------------------
// LLM input + orchestration.
// ---------------------------------------------------------------------------

export function buildReviewInput(params: { documents: MarketDocument[]; stats: MarketStat[] }): string {
  const documents = params.documents.slice(0, MAX_REVIEW_DOCS);
  return JSON.stringify(
    {
      documents: documents.map((doc) => ({
        publisher: doc.publisher,
        report_title: doc.report_title,
        period_covered: doc.period_covered,
        source_type: doc.source_type,
        document_class: doc.document_class,
        geo_scope: doc.geo_scope,
        coverage_universe: doc.coverage_universe,
        filename: doc.filename,
        ingested_at: doc.createdAt,
        analyst_notes: doc.llmNotes
          ? {
              overview: doc.llmNotes.overview,
              neighborhoods: doc.llmNotes.neighborhoods,
              asset_types: doc.llmNotes.assetTypes,
              buyer_activity: doc.llmNotes.buyerActivity,
              notable_transactions: doc.llmNotes.notableTransactions,
              cap_rate_psf: doc.llmNotes.capRatePsf,
              financing: doc.llmNotes.financing,
              small_building_focus: doc.llmNotes.smallBuildingFocus,
              regulatory: doc.llmNotes.regulatory,
              risks_watch_items: doc.llmNotes.risksWatchItems,
              investment_relevance: doc.llmNotes.investmentRelevance,
            }
          : null,
        analyst_brief: doc.documentBrief
          ? {
              what_it_says: doc.documentBrief.whatItSays,
              compared_to_prior: doc.documentBrief.comparedToPrior,
              discrepancies: doc.documentBrief.discrepancies,
            }
          : null,
      })),
      stats: params.stats.slice(0, MAX_PROMPT_STATS).map((stat) => ({
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
    null,
    2
  );
}

export interface RefreshMarketReviewParams {
  /** Currently included documents (caller filters out excluded/failed rows). */
  documents: MarketDocument[];
  /** Stats already filtered to non-excluded documents. */
  stats: MarketStat[];
  knowledge: MarketKnowledgeEntry | null;
  llm: MarketLlmRunner | null;
  saveLlmOutput: (params: InsertMarketLlmOutputParams) => Promise<void>;
  appendReview: (params: AppendMarketReviewParams) => Promise<MarketReviewRecord>;
}

/** Regenerate the live review from the current corpus and append a new version. */
export async function refreshMarketReview(params: RefreshMarketReviewParams): Promise<MarketReviewRecord> {
  const documents = [...params.documents].sort((a, b) =>
    periodSortKey(b.period_covered, b.createdAt).localeCompare(periodSortKey(a.period_covered, a.createdAt))
  );
  const promptVersion = MARKET_PROMPT_VERSIONS.review;

  let validated: ReturnType<typeof validateReviewOutput> = null;
  let provider: string | null = null;
  let model: string | null = null;

  if (params.llm && documents.length > 0) {
    const prompt = `${MARKET_REVIEW_PROMPT}\n\nSUPPLIED RECORDS:\n${buildReviewInput({ documents, stats: params.stats })}`;
    // Synthesis pass prefers the OpenAI model; retry once on the other
    // provider when the first returns nothing parseable.
    for (const preferred of ["openai", "gemini"] as const) {
      const result = await params.llm({ stage: "review", prompt, provider: preferred });
      await params.saveLlmOutput({
        documentId: null,
        stage: "review",
        promptVersion,
        provider: result.provider,
        model: result.model,
        rawOutput: result.rawOutput,
        parsed: result.parsed,
      });
      validated = validateReviewOutput(result.parsed);
      if (validated) {
        provider = result.provider;
        model = result.model;
        break;
      }
    }
  }

  const review: MarketReview = validated
    ? { ...validated, sources: documents.slice(0, CAPS.sources).map(reviewSourceLabel) }
    : deterministicReview({ documents, stats: params.stats, knowledge: params.knowledge });

  return params.appendReview({
    review,
    includedDocumentIds: documents.map((doc) => doc.id),
    promptVersion: validated ? promptVersion : "deterministic",
    provider: validated ? provider : null,
    model: validated ? model : null,
  });
}

/** Staleness: the stored review covered a different document set than today's corpus. */
export function isReviewStale(record: MarketReviewRecord | null, currentDocumentIds: string[]): boolean {
  if (!record) return currentDocumentIds.length > 0;
  const stored = new Set(record.includedDocumentIds);
  if (stored.size !== currentDocumentIds.length) return true;
  return currentDocumentIds.some((id) => !stored.has(id));
}
