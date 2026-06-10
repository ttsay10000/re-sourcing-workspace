/**
 * End-to-end ingest for uploaded market PDFs:
 *   classify → extract (provenance injected) → resolve neighborhoods →
 *   dedupe/upsert comps → store stats → rollup + synthesize affected
 *   neighborhoods → analyst brief + knowledge-base merge → ingest report.
 *
 * Multi-file uploads go through ingestMarketDocumentBatch: every document row
 * is created up-front (so the ingest log shows the whole batch as processing),
 * the per-document LLM stages (classify + extract) fan out as a concurrency-
 * limited batch, and the store-mutating stages run sequentially in upload
 * order so cross-document dedupe and the versioned knowledge ledger behave
 * exactly as they would for one-at-a-time uploads.
 *
 * Raw LLM output is persisted per stage keyed by document + prompt version.
 * Unresolved neighborhood names go to the review queue (comps kept with
 * neighborhood_id = null) — never silently dropped.
 */
import type { MarketDocBatchItem, MarketDocIngestReport, MarketDocument, MarketStat } from "@re-sourcing/contracts";
import type { UpsertMarketCompParams } from "@re-sourcing/db";
import { createAsyncTaskQueue } from "../asyncTaskQueue.js";
import { extractTextMetadataFromBuffer } from "../upload/extractTextFromUploadedFile.js";
import { classifyMarketDocument } from "./classify.js";
import { extractMarketDocument, type ExtractMarketDocumentResult } from "./extract.js";
import { runMarketLlm, type MarketLlmRunner } from "./llmAdapter.js";
import {
  buildNeighborhoodIndex,
  resolveNeighborhoodId,
  resolveSubmarketId,
  fallbackSubmarketsFor,
} from "./neighborhoodResolve.js";
import { isSameDeal, mergeComps, normalizeCompAddress, type MergedComp } from "./dedupe.js";
import { computeNeighborhoodRollup } from "./rollup.js";
import { synthesizeNeighborhood } from "./synthesize.js";
import { updateMarketKnowledge } from "./knowledge.js";
import { MARKET_PROMPT_VERSIONS } from "./prompts.js";
import type { MarketContextStore } from "./store.js";

export interface IngestMarketDocumentParams {
  filename: string;
  contentType: string | null;
  buffer: Buffer;
  store: MarketContextStore;
  llm?: MarketLlmRunner;
  /** Rollup reference date (tests pin this; defaults to now). */
  asOf?: Date;
}

export interface MarketDocBatchFile {
  filename: string;
  contentType: string | null;
  buffer: Buffer;
}

export interface IngestMarketDocumentBatchParams {
  files: MarketDocBatchFile[];
  store: MarketContextStore;
  llm?: MarketLlmRunner;
  asOf?: Date;
  /** Parallelism for the classify/extract LLM phase; defaults from MARKET_INGEST_MAX_CONCURRENCY. */
  maxConcurrency?: number;
}

const DEFAULT_MARKET_INGEST_MAX_CONCURRENCY = 3;

export function resolveMarketIngestMaxConcurrency(raw = process.env.MARKET_INGEST_MAX_CONCURRENCY): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_MARKET_INGEST_MAX_CONCURRENCY;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MARKET_INGEST_MAX_CONCURRENCY;
  return Math.floor(parsed);
}

function compToUpsertParams(comp: MergedComp, documentId: string | null): UpsertMarketCompParams {
  return {
    documentId,
    address: comp.address,
    addressNormalized: comp.addressNormalized,
    neighborhoodRaw: comp.neighborhoodRaw,
    neighborhoodId: comp.neighborhoodId,
    borough: comp.borough,
    salePrice: comp.salePrice,
    priceType: comp.priceType,
    saleDate: comp.saleDate,
    gsf: comp.gsf,
    pricePsf: comp.pricePsf,
    unitsTotal: comp.unitsTotal,
    unitsResi: comp.unitsResi,
    pctRentStabilized: comp.pctRentStabilized,
    capRate: comp.capRate,
    assetType: comp.assetType,
    notesShort: comp.notesShort,
    cherryPickRisk: comp.cherryPickRisk,
    isSubjectProperty: comp.isSubjectProperty,
    confidence: comp.confidence,
    rawText: comp.rawText,
    provenance: comp.provenance,
    provenanceList: comp.provenanceList,
    lat: comp.lat,
    lng: comp.lng,
  };
}

/** Recompute + persist summaries for the given neighborhoods (post-write state). */
export async function resynthesizeNeighborhoods(params: {
  neighborhoodIds: string[];
  store: MarketContextStore;
  llm: MarketLlmRunner | null;
  documentId: string | null;
  asOf?: Date;
}): Promise<void> {
  if (params.neighborhoodIds.length === 0) return;
  const neighborhoods = await params.store.listNeighborhoods();
  const byId = new Map(neighborhoods.map((hood) => [hood.id, hood]));
  const comps = await params.store.listCompsByNeighborhoods(params.neighborhoodIds);

  for (const neighborhoodId of params.neighborhoodIds) {
    const neighborhood = byId.get(neighborhoodId);
    if (!neighborhood) continue;
    const submarketStats = await params.store.listStatsBySubmarkets(fallbackSubmarketsFor(neighborhood));
    const draft = computeNeighborhoodRollup({
      neighborhood,
      comps,
      submarketStats,
      asOf: params.asOf,
    });
    const synthesis = await synthesizeNeighborhood({ draft, llm: params.llm });
    if (synthesis.llm) {
      await params.store.saveLlmOutput({
        documentId: params.documentId,
        neighborhoodId,
        stage: "synthesize",
        promptVersion: synthesis.promptVersion,
        provider: synthesis.llm.provider,
        model: synthesis.llm.model,
        rawOutput: synthesis.llm.rawOutput,
        parsed: synthesis.llm.parsed,
      });
    }
    await params.store.upsertSummary({
      neighborhoodId,
      compCount12mo: draft.compCount12mo,
      nResearch: draft.nResearch,
      nBroker: draft.nBroker,
      nCherryPickExcluded: draft.nCherryPickExcluded,
      nAskingExcluded: draft.nAskingExcluded,
      medianCapRate: draft.medianCapRate,
      capRateRange: draft.capRateRange,
      medianPsf: draft.medianPsf,
      psfRange: draft.psfRange,
      regulatorySkew: synthesis.regulatorySkew,
      bullets: synthesis.bullets,
      fallbackContext: draft.fallbackContext,
      dataFreshness: draft.dataFreshness,
      sources: draft.sources,
      topComps: draft.topComps,
    });
  }
}

/** Output of the LLM-heavy stage 1 (classify + extract); safe to compute concurrently across documents. */
interface PreparedMarketDocument {
  document: MarketDocument;
  classification: Awaited<ReturnType<typeof classifyMarketDocument>>["classification"];
  flagForReview: boolean;
  extraction: ExtractMarketDocumentResult;
  flags: string[];
}

/**
 * Stage 1 for one document: text extraction + classify + extract. Only writes
 * per-document rows (LLM outputs, classification), never shared state, so a
 * batch can run several documents through this phase concurrently.
 */
async function prepareMarketDocument(params: {
  document: MarketDocument;
  buffer: Buffer;
  store: MarketContextStore;
  llm: MarketLlmRunner;
}): Promise<PreparedMarketDocument> {
  const { store, document } = params;

  const textMetadata = await extractTextMetadataFromBuffer(params.buffer, document.filename);
  const pages = textMetadata.pages ?? [];
  const fullText =
    pages.length > 0
      ? pages.map((page) => `[Page ${page.pageNumber}]\n${page.textSample}`).join("\n\n")
      : textMetadata.text;

  // Stage 1a: classify.
  const pdf = { buffer: params.buffer, filename: document.filename };
  const classifyResult = await classifyMarketDocument({ pdf, pages, llm: params.llm });
  await store.saveLlmOutput({
    documentId: document.id,
    stage: "classify",
    promptVersion: classifyResult.promptVersion,
    provider: classifyResult.llm.provider,
    model: classifyResult.llm.model,
    rawOutput: classifyResult.llm.rawOutput,
    parsed: classifyResult.llm.parsed,
  });
  const { classification } = classifyResult;
  await store.saveClassification(document.id, classification, classifyResult.flagForReview);

  // Stage 1b: extract (classifier provenance injected; extractor cannot override source_type).
  const extraction = await extractMarketDocument({
    pdf,
    documentText: fullText || null,
    classification,
    documentId: document.id,
    llm: params.llm,
  });
  await store.saveLlmOutput({
    documentId: document.id,
    stage: "extract",
    promptVersion: extraction.promptVersion,
    provider: extraction.llm.provider,
    model: extraction.llm.model,
    rawOutput: extraction.llm.rawOutput,
    parsed: extraction.llm.parsed,
  });

  const flags = [...extraction.flags];
  if (classifyResult.flagForReview) flags.push("classifier confidence low — flagged for review");

  return { document, classification, flagForReview: classifyResult.flagForReview, extraction, flags };
}

/**
 * Stage 2+ for one document: dedupe/upsert comps, stats, neighborhood
 * synthesis, knowledge fold, ingest report. Mutates shared store state, so a
 * batch runs this sequentially in upload order.
 */
async function finalizeMarketDocument(
  prepared: PreparedMarketDocument,
  params: { store: MarketContextStore; llm: MarketLlmRunner; asOf?: Date }
): Promise<MarketDocIngestReport> {
  const { store } = params;
  const { document, classification, extraction } = prepared;
  const flags = [...prepared.flags];

  if (extraction.llm.parsed == null) {
    const error = extraction.llm.error ?? "extraction returned no parseable JSON";
    flags.push(`extraction failed: ${error}`);
    await store.setDocumentStatus(document.id, "failed", error);
    const report: MarketDocIngestReport = {
      documentId: document.id,
      sourceType: classification.source_type,
      documentClass: classification.document_class,
      publisher: classification.publisher,
      classifierConfidence: classification.classifier_confidence,
      flagForReview: prepared.flagForReview,
      nComps: 0,
      nCompsMerged: 0,
      nStats: 0,
      unresolvedNeighborhoods: [],
      affectedNeighborhoods: [],
      flags,
    };
    await store.saveIngestReport(document.id, report);
    return report;
  }

  // Resolve neighborhoods + coordinates.
  const neighborhoods = await store.listNeighborhoods();
  const index = buildNeighborhoodIndex(neighborhoods);
  const unresolved = new Set<string>();
  const normalizedAddresses = extraction.comps.map((comp) => normalizeCompAddress(comp.address));
  const coordinates = await store.matchPropertyCoordinates(normalizedAddresses);

  const incoming: MergedComp[] = extraction.comps.map((comp, i) => {
    const neighborhoodId = resolveNeighborhoodId(comp.neighborhoodRaw, index);
    if (comp.neighborhoodRaw && !neighborhoodId) unresolved.add(comp.neighborhoodRaw);
    const addressNormalized = normalizedAddresses[i];
    const coordinate = coordinates.get(addressNormalized) ?? null;
    return {
      ...comp,
      addressNormalized,
      neighborhoodId,
      provenanceList: [comp.provenance],
      lat: coordinate?.lat ?? null,
      lng: coordinate?.lng ?? null,
    };
  });

  // Dedupe against existing rows (and within this batch via sequential upserts).
  const candidates = await store.findCompsByNormalizedAddresses(normalizedAddresses);
  const candidatePool = [...candidates];
  let merged = 0;
  const affected = new Set<string>();
  for (const comp of incoming) {
    const match = candidatePool.find((existing) => isSameDeal(existing, comp));
    if (match) {
      const mergedComp = mergeComps(match, comp);
      const saved = await store.replaceComp(match.id, compToUpsertParams(mergedComp, match.documentId ?? document.id));
      candidatePool[candidatePool.indexOf(match)] = saved;
      merged += 1;
      if (saved.neighborhoodId) affected.add(saved.neighborhoodId);
    } else {
      const saved = await store.insertComp(compToUpsertParams(comp, document.id));
      candidatePool.push(saved);
      if (saved.neighborhoodId) affected.add(saved.neighborhoodId);
    }
  }

  // Stats: store with resolved submarket scope; values stay publisher-scoped.
  const savedStats: MarketStat[] = [];
  for (const stat of extraction.stats) {
    savedStats.push(
      await store.insertStat({
        documentId: document.id,
        metric: stat.metric,
        metricType: stat.metricType,
        value: stat.value,
        comparisonPeriod: stat.comparisonPeriod,
        geoLevel: stat.geoLevel,
        geoName: stat.geoName,
        submarketId: resolveSubmarketId(stat.geoName, stat.geoLevel),
        segment: stat.segment,
        period: stat.period,
        provenance: stat.provenance,
      })
    );
  }

  await store.setDocumentStatus(document.id, "extracted");

  // Stage 2: rollup + synthesis for neighborhoods touched by this document only.
  await resynthesizeNeighborhoods({
    neighborhoodIds: [...affected],
    store,
    llm: params.llm,
    documentId: document.id,
    asOf: params.asOf,
  });
  await store.setDocumentStatus(document.id, "synthesized");

  const report: MarketDocIngestReport = {
    documentId: document.id,
    sourceType: classification.source_type,
    documentClass: classification.document_class,
    publisher: classification.publisher,
    classifierConfidence: classification.classifier_confidence,
    flagForReview: prepared.flagForReview,
    nComps: incoming.length,
    nCompsMerged: merged,
    nStats: savedStats.length,
    unresolvedNeighborhoods: [...unresolved],
    affectedNeighborhoods: [...affected],
    flags,
  };

  // Stage 3: analyst brief for this upload + fold it into the living knowledge
  // base (versioned). Failures never sink an otherwise successful ingest.
  try {
    const knowledge = await updateMarketKnowledge({
      document,
      classification,
      report,
      comps: incoming,
      stats: savedStats,
      store,
      llm: params.llm,
      asOf: params.asOf,
    });
    report.brief = knowledge.brief;
    report.knowledgeVersion = knowledge.entry.version;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[marketContext knowledge]", err);
    report.flags.push(`knowledge update failed: ${message}`);
  }

  await store.saveIngestReport(document.id, report);
  return report;
}

export async function ingestMarketDocument(params: IngestMarketDocumentParams): Promise<MarketDocIngestReport> {
  const { store } = params;
  const llm = params.llm ?? runMarketLlm;
  const document = await store.insertDocument({
    filename: params.filename,
    contentType: params.contentType,
    fileContent: params.buffer,
  });
  const prepared = await prepareMarketDocument({ document, buffer: params.buffer, store, llm });
  return finalizeMarketDocument(prepared, { store, llm, asOf: params.asOf });
}

/**
 * Ingest several uploaded documents as one batch. Per-file failures are
 * isolated: the failing document is marked failed and the rest of the batch
 * still ingests; the returned items preserve upload order.
 */
export async function ingestMarketDocumentBatch(
  params: IngestMarketDocumentBatchParams
): Promise<MarketDocBatchItem[]> {
  const { store } = params;
  const llm = params.llm ?? runMarketLlm;

  // Phase 0: create every document row first so GET /api/market-docs shows the
  // whole batch (status "uploaded") while earlier files are still processing.
  const inserted: Array<{ file: MarketDocBatchFile; document: MarketDocument | null; error: string | null }> = [];
  for (const file of params.files) {
    try {
      const document = await store.insertDocument({
        filename: file.filename,
        contentType: file.contentType,
        fileContent: file.buffer,
      });
      inserted.push({ file, document, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[marketContext batch] insert failed for ${file.filename}:`, err);
      inserted.push({ file, document: null, error: message });
    }
  }

  // Phase 1 (batched LLM): classify + extract fan out with bounded concurrency.
  const queue = createAsyncTaskQueue(params.maxConcurrency ?? resolveMarketIngestMaxConcurrency());
  const preparedEntries = await Promise.all(
    inserted.map((entry) =>
      queue.run(async (): Promise<{ entry: (typeof inserted)[number]; prepared: PreparedMarketDocument | null; error: string | null }> => {
        if (!entry.document) return { entry, prepared: null, error: entry.error };
        try {
          const prepared = await prepareMarketDocument({ document: entry.document, buffer: entry.file.buffer, store, llm });
          return { entry, prepared, error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[marketContext batch] prepare failed for ${entry.file.filename}:`, err);
          await store.setDocumentStatus(entry.document.id, "failed", message).catch(() => undefined);
          return { entry, prepared: null, error: message };
        }
      })
    )
  );

  // Phase 2 (sequential, upload order): comps/stats writes, synthesis, and the
  // versioned knowledge folds — order-dependent shared state.
  const items: MarketDocBatchItem[] = [];
  for (const { entry, prepared, error } of preparedEntries) {
    if (!prepared) {
      items.push({ filename: entry.file.filename, documentId: entry.document?.id ?? null, report: null, error });
      continue;
    }
    try {
      const report = await finalizeMarketDocument(prepared, { store, llm, asOf: params.asOf });
      items.push({ filename: entry.file.filename, documentId: prepared.document.id, report, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[marketContext batch] finalize failed for ${entry.file.filename}:`, err);
      await store.setDocumentStatus(prepared.document.id, "failed", message).catch(() => undefined);
      items.push({ filename: entry.file.filename, documentId: prepared.document.id, report: null, error: message });
    }
  }
  return items;
}

export { MARKET_PROMPT_VERSIONS };
