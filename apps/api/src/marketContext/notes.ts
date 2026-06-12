/**
 * Per-document analyst notes (market_documents.llm_notes): the robust
 * "what would an acquisitions analyst pull out of this report" summary that
 * opens from the ingest log.
 *
 * Two-stage chain: the read pass (Gemini, native PDF) takes exhaustive notes;
 * the refine pass (OpenAI) dedupes, cross-checks against the structured
 * extraction, and sharpens the investment read. Either stage may be skipped
 * when its provider is unavailable; with no model at all a deterministic
 * numbers-only fallback keeps the Notes panel populated — ingest never blocks
 * on a model. Raw output for both passes is persisted in market_llm_outputs
 * under stage "notes".
 */
import type {
  MarketDocClassification,
  MarketDocumentNotes,
  MarketNotesAssetTypeTake,
  MarketNotesNeighborhoodTake,
  MarketStat,
  MarketTrendDirection,
} from "@re-sourcing/contracts";
import { claimFromStat, type KnowledgeCompInput } from "./knowledge.js";
import type { MarketLlmRunner } from "./llmAdapter.js";
import { MARKET_PROMPT_VERSIONS, NOTES_READ_PROMPT, NOTES_REFINE_PROMPT } from "./prompts.js";
import { median } from "./rollup.js";
import type { MarketContextStore } from "./store.js";

const MAX_NOTE_CHARS = 220;
const LIST_CAPS = {
  overview: 5,
  neighborhoods: 14,
  assetTypes: 10,
  buyerActivity: 8,
  notableTransactions: 12,
  capRatePsf: 10,
  financing: 8,
  smallBuildingFocus: 8,
  regulatory: 6,
  risksWatchItems: 8,
  investmentRelevance: 6,
} as const;
const MAX_PROMPT_COMPS = 40;
const MAX_PROMPT_STATS = 40;

/** Comp fields the notes stage needs (MergedComp satisfies it). */
export interface NotesCompInput extends KnowledgeCompInput {
  neighborhoodRaw?: string | null;
  notesShort?: string | null;
}

function clamp(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_NOTE_CHARS ? trimmed : `${trimmed.slice(0, MAX_NOTE_CHARS - 1)}…`;
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const DIRECTIONS: MarketTrendDirection[] = ["up", "down", "flat", "mixed"];

/** Defensive parse of either stage's JSON; null when there is no real content. */
export function validateNotesOutput(parsed: Record<string, unknown> | null): Omit<
  MarketDocumentNotes,
  "sourceLabel" | "generatedAt" | "promptVersion" | "providers"
> | null {
  if (!parsed) return null;

  const neighborhoods: MarketNotesNeighborhoodTake[] = [];
  if (Array.isArray(parsed.neighborhoods)) {
    for (const raw of parsed.neighborhoods) {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const name = asString(row.name);
      const takeaway = asString(row.takeaway);
      if (!name || !takeaway) continue;
      neighborhoods.push({ name: clamp(name), takeaway: clamp(takeaway) });
      if (neighborhoods.length >= LIST_CAPS.neighborhoods) break;
    }
  }

  const assetTypes: MarketNotesAssetTypeTake[] = [];
  if (Array.isArray(parsed.asset_types)) {
    for (const raw of parsed.asset_types) {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const segment = asString(row.segment);
      const note = asString(row.note);
      if (!segment || !note) continue;
      assetTypes.push({
        segment: clamp(segment),
        direction: DIRECTIONS.includes(row.direction as MarketTrendDirection)
          ? (row.direction as MarketTrendDirection)
          : "mixed",
        note: clamp(note),
      });
      if (assetTypes.length >= LIST_CAPS.assetTypes) break;
    }
  }

  const draft = {
    title: asString(parsed.title) ?? "",
    periodCovered: asString(parsed.period_covered),
    overview: cleanStrings(parsed.overview, LIST_CAPS.overview),
    neighborhoods,
    assetTypes,
    buyerActivity: cleanStrings(parsed.buyer_activity, LIST_CAPS.buyerActivity),
    notableTransactions: cleanStrings(parsed.notable_transactions, LIST_CAPS.notableTransactions),
    capRatePsf: cleanStrings(parsed.cap_rate_psf, LIST_CAPS.capRatePsf),
    financing: cleanStrings(parsed.financing, LIST_CAPS.financing),
    smallBuildingFocus: cleanStrings(parsed.small_building_focus, LIST_CAPS.smallBuildingFocus),
    regulatory: cleanStrings(parsed.regulatory, LIST_CAPS.regulatory),
    risksWatchItems: cleanStrings(parsed.risks_watch_items, LIST_CAPS.risksWatchItems),
    investmentRelevance: cleanStrings(parsed.investment_relevance, LIST_CAPS.investmentRelevance),
  };

  const hasContent =
    draft.overview.length > 0 ||
    draft.neighborhoods.length > 0 ||
    draft.capRatePsf.length > 0 ||
    draft.notableTransactions.length > 0;
  return hasContent ? draft : null;
}

function moneyShort(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function compLine(comp: NotesCompInput): string {
  const pieces = [
    comp.salePrice != null ? moneyShort(comp.salePrice) : null,
    comp.capRate != null ? `${(comp.capRate * 100).toFixed(2)}% cap` : null,
    comp.pricePsf != null ? `$${Math.round(comp.pricePsf)}/SF` : null,
    comp.unitsTotal != null ? `${comp.unitsTotal} units` : null,
    comp.assetType,
    comp.priceType !== "closed" ? comp.priceType : null,
  ].filter(Boolean);
  return clamp(`${comp.address} — ${pieces.join(", ")}`);
}

/** Numbers-only fallback notes straight from the extraction (no model). */
export function deterministicNotes(params: {
  classification: MarketDocClassification;
  filename: string;
  comps: NotesCompInput[];
  stats: MarketStat[];
}): Omit<MarketDocumentNotes, "sourceLabel" | "generatedAt" | "promptVersion" | "providers"> {
  const { classification, comps, stats } = params;
  const closed = comps.filter((comp) => comp.priceType === "closed" && !comp.isSubjectProperty);

  const overview: string[] = [
    clamp(
      `${classification.publisher ?? "Unbranded"} ${classification.document_class} — ${comps.length} deals extracted, ` +
        `${stats.length} aggregate stats (${classification.period_covered ?? "period n/a"})`
    ),
  ];
  for (const stat of stats.slice(0, 3)) overview.push(claimFromStat(stat).text);

  const byHood = new Map<string, NotesCompInput[]>();
  for (const comp of closed) {
    const name = comp.neighborhoodRaw?.trim();
    if (!name) continue;
    const list = byHood.get(name) ?? [];
    list.push(comp);
    byHood.set(name, list);
  }
  const neighborhoods: MarketNotesNeighborhoodTake[] = [...byHood.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, LIST_CAPS.neighborhoods)
    .map(([name, list]) => {
      const medPsf = median(list.map((comp) => comp.pricePsf).filter((v): v is number => v != null));
      const medCap = median(list.map((comp) => comp.capRate).filter((v): v is number => v != null));
      const figures = [
        medPsf != null ? `median $${Math.round(medPsf)}/SF` : null,
        medCap != null ? `median ${(medCap * 100).toFixed(2)}% cap` : null,
      ].filter(Boolean);
      return {
        name,
        takeaway: clamp(`${list.length} closed sale${list.length === 1 ? "" : "s"}${figures.length > 0 ? ` — ${figures.join(", ")}` : ""}`),
      };
    });

  const byAsset = new Map<string, NotesCompInput[]>();
  for (const comp of closed) {
    if (!comp.assetType) continue;
    const list = byAsset.get(comp.assetType) ?? [];
    list.push(comp);
    byAsset.set(comp.assetType, list);
  }
  const assetTypes: MarketNotesAssetTypeTake[] = [...byAsset.entries()].map(([segment, list]) => {
    const medPsf = median(list.map((comp) => comp.pricePsf).filter((v): v is number => v != null));
    return {
      segment,
      direction: "flat" as const,
      note: clamp(
        `${list.length} of ${closed.length} closed deals${medPsf != null ? `, median $${Math.round(medPsf)}/SF` : ""} (composition only — no trend printed)`
      ),
    };
  });

  const capRatePsf = stats
    .filter((stat) => /cap_rate|cap\b|psf|price_per_sf/.test(stat.metric) || stat.metricType === "pct_change")
    .slice(0, LIST_CAPS.capRatePsf)
    .map((stat) => claimFromStat(stat).text);

  const notable = [...closed]
    .sort((a, b) => (b.salePrice ?? 0) - (a.salePrice ?? 0))
    .slice(0, 5)
    .map(compLine);

  const small = closed.filter((comp) => comp.unitsTotal != null && comp.unitsTotal < 10);
  const smallFm = small.filter((comp) => (comp.pctRentStabilized ?? 0) <= 0.1);
  const smallBuildingFocus: string[] = [];
  if (small.length > 0) {
    const medPsf = median(small.map((comp) => comp.pricePsf).filter((v): v is number => v != null));
    smallBuildingFocus.push(
      clamp(
        `${small.length} of ${closed.length} closed deals are sub-10-unit (${smallFm.length} free-market)` +
          `${medPsf != null ? ` — median $${Math.round(medPsf)}/SF` : ""}`
      )
    );
  }

  const investmentRelevance: string[] = [];
  const cheapest = [...byHood.entries()]
    .map(([name, list]) => ({
      name,
      n: list.length,
      medPsf: median(list.map((comp) => comp.pricePsf).filter((v): v is number => v != null)),
    }))
    .filter((row) => row.medPsf != null && row.n >= 2)
    .sort((a, b) => (a.medPsf as number) - (b.medPsf as number))[0];
  if (cheapest) {
    investmentRelevance.push(
      clamp(`Lowest document median $/SF: ${cheapest.name} at $${Math.round(cheapest.medPsf as number)}/SF across ${cheapest.n} sales`)
    );
  }

  return {
    title: classification.report_title ?? params.filename,
    periodCovered: classification.period_covered,
    overview: overview.slice(0, LIST_CAPS.overview),
    neighborhoods,
    assetTypes,
    buyerActivity: [],
    notableTransactions: notable,
    capRatePsf,
    financing: [],
    smallBuildingFocus,
    regulatory: [],
    risksWatchItems: [],
    investmentRelevance,
  };
}

function refineInput(params: {
  classification: MarketDocClassification;
  filename: string;
  draft: Record<string, unknown> | null;
  comps: NotesCompInput[];
  stats: MarketStat[];
}): string {
  return JSON.stringify(
    {
      classification: {
        source_type: params.classification.source_type,
        publisher: params.classification.publisher,
        document_class: params.classification.document_class,
        report_title: params.classification.report_title,
        period_covered: params.classification.period_covered,
        geo_scope: params.classification.geo_scope,
        filename: params.filename,
      },
      draft_notes: params.draft,
      structured_extraction: {
        comps: params.comps.slice(0, MAX_PROMPT_COMPS).map((comp) => ({
          address: comp.address,
          neighborhood: comp.neighborhoodRaw ?? null,
          sale_price: comp.salePrice,
          price_type: comp.priceType,
          sale_date: comp.saleDate,
          price_psf: comp.pricePsf,
          units_total: comp.unitsTotal,
          pct_rent_stabilized: comp.pctRentStabilized,
          cap_rate: comp.capRate,
          asset_type: comp.assetType,
          notes: comp.notesShort ?? null,
          is_subject_property: comp.isSubjectProperty,
        })),
        stats: params.stats.slice(0, MAX_PROMPT_STATS).map((stat) => ({
          metric: stat.metric,
          metric_type: stat.metricType,
          value: stat.value,
          comparison_period: stat.comparisonPeriod,
          geo_name: stat.geoName,
          segment: stat.segment,
          period: stat.period,
        })),
      },
    },
    null,
    2
  );
}

export interface GenerateDocumentNotesParams {
  documentId: string;
  filename: string;
  classification: MarketDocClassification;
  pdf: { buffer: Buffer; filename: string } | null;
  documentText: string | null;
  comps: NotesCompInput[];
  stats: MarketStat[];
  store: MarketContextStore;
  llm: MarketLlmRunner | null;
  asOf?: Date;
}

/** Run the read → refine chain, persist raw outputs + the final notes, and return them. */
export async function generateDocumentNotes(params: GenerateDocumentNotesParams): Promise<MarketDocumentNotes> {
  const providers: string[] = [];
  let draft: ReturnType<typeof validateNotesOutput> = null;
  let draftRaw: Record<string, unknown> | null = null;
  let refined: ReturnType<typeof validateNotesOutput> = null;
  let promptVersion: string = MARKET_PROMPT_VERSIONS.notesRead;

  if (params.llm) {
    // Read pass: native PDF when available (Gemini-preferred).
    const read = await params.llm({
      stage: "notes",
      prompt: NOTES_READ_PROMPT,
      pdf: params.pdf,
      documentText: params.documentText,
      provider: "gemini",
    });
    await params.store.saveLlmOutput({
      documentId: params.documentId,
      stage: "notes",
      promptVersion: MARKET_PROMPT_VERSIONS.notesRead,
      provider: read.provider,
      model: read.model,
      rawOutput: read.rawOutput,
      parsed: read.parsed,
    });
    draft = validateNotesOutput(read.parsed);
    if (draft) {
      draftRaw = read.parsed;
      providers.push(`${read.provider}/${read.model}`);
    }

    // Refine pass: text-only (the structured extraction is the cross-check),
    // OpenAI-preferred. Runs even when the read pass failed — the extraction
    // alone is enough to write useful notes.
    const refine = await params.llm({
      stage: "notes",
      prompt: `${NOTES_REFINE_PROMPT}\n\nSUPPLIED RECORDS:\n${refineInput({
        classification: params.classification,
        filename: params.filename,
        draft: draftRaw,
        comps: params.comps,
        stats: params.stats,
      })}`,
      provider: "openai",
    });
    await params.store.saveLlmOutput({
      documentId: params.documentId,
      stage: "notes",
      promptVersion: MARKET_PROMPT_VERSIONS.notesRefine,
      provider: refine.provider,
      model: refine.model,
      rawOutput: refine.rawOutput,
      parsed: refine.parsed,
    });
    refined = validateNotesOutput(refine.parsed);
    if (refined) {
      promptVersion = MARKET_PROMPT_VERSIONS.notesRefine;
      providers.push(`${refine.provider}/${refine.model}`);
    }
  }

  const body =
    refined ??
    draft ??
    deterministicNotes({
      classification: params.classification,
      filename: params.filename,
      comps: params.comps,
      stats: params.stats,
    });
  if (!refined && !draft) {
    promptVersion = "deterministic";
    providers.push("deterministic");
  }

  const notes: MarketDocumentNotes = {
    ...body,
    title: body.title || params.classification.report_title || params.filename,
    periodCovered: body.periodCovered ?? params.classification.period_covered,
    sourceLabel: `${params.classification.publisher ?? params.filename} — ${
      body.periodCovered ?? params.classification.period_covered ?? "period n/a"
    }`,
    generatedAt: (params.asOf ?? new Date()).toISOString(),
    promptVersion,
    providers,
  };

  await params.store.saveDocumentNotes(params.documentId, notes);
  return notes;
}
