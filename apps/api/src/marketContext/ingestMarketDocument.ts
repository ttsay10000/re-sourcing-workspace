/**
 * End-to-end ingest for one uploaded market PDF:
 *   classify → extract (provenance injected) → resolve neighborhoods →
 *   dedupe/upsert comps → store stats → rollup + synthesize affected
 *   neighborhoods → analyst brief + knowledge-base merge → ingest report.
 *
 * Raw LLM output is persisted per stage keyed by document + prompt version.
 * Unresolved neighborhood names go to the review queue (comps kept with
 * neighborhood_id = null) — never silently dropped.
 */
import type { MarketDocIngestReport, MarketDocument, MarketStat } from "@re-sourcing/contracts";
import type { UpsertMarketCompParams } from "@re-sourcing/db";
import { extractTextMetadataFromBuffer } from "../upload/extractTextFromUploadedFile.js";
import { classifyMarketDocument } from "./classify.js";
import { extractMarketDocument } from "./extract.js";
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
import { generateDocumentNotes } from "./notes.js";
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
  /** Re-run ingestion for an already-stored document (retry path) instead of inserting a new row. */
  existingDocument?: MarketDocument;
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
    grm: comp.grm,
    assetType: comp.assetType,
    buyer: comp.buyer,
    seller: comp.seller,
    saleConditions: comp.saleConditions,
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

export async function ingestMarketDocument(params: IngestMarketDocumentParams): Promise<MarketDocIngestReport> {
  const { store } = params;
  const llm = params.llm ?? runMarketLlm;
  const document =
    params.existingDocument ??
    (await store.insertDocument({
      filename: params.filename,
      contentType: params.contentType,
      fileContent: params.buffer,
    }));

  // Any stage throw marks THIS document failed (stage named in the stored
  // error) and returns a failure report instead of bubbling a 500 — one bad
  // file must never sink a batch or leave a statusless row.
  const stageRef = { current: "text extraction" };
  try {
    return await executeIngestPipeline(params, document, llm, stageRef);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = `${stageRef.current} failed: ${message}`;
    console.error(`[marketContext ingest] ${error}`, err);
    await store.setDocumentStatus(document.id, "failed", error).catch(() => undefined);
    const report: MarketDocIngestReport = {
      documentId: document.id,
      sourceType: "broker_provided",
      documentClass: "unknown",
      publisher: null,
      classifierConfidence: "low",
      flagForReview: true,
      nComps: 0,
      nCompsMerged: 0,
      nStats: 0,
      unresolvedNeighborhoods: [],
      affectedNeighborhoods: [],
      flags: [error],
      status: "failed",
      error,
    };
    await store.saveIngestReport(document.id, report).catch(() => undefined);
    return report;
  }
}

async function executeIngestPipeline(
  params: IngestMarketDocumentParams,
  document: MarketDocument,
  llm: MarketLlmRunner,
  stageRef: { current: string }
): Promise<MarketDocIngestReport> {
  const { store } = params;
  const textMetadata = await extractTextMetadataFromBuffer(params.buffer, params.filename);
  const pages = textMetadata.pages ?? [];
  const fullText =
    pages.length > 0
      ? pages.map((page) => `[Page ${page.pageNumber}]\n${page.textSample}`).join("\n\n")
      : textMetadata.text;

  // Stage 1a: classify.
  stageRef.current = "classification";
  const pdf = { buffer: params.buffer, filename: params.filename };
  const classifyResult = await classifyMarketDocument({ pdf, pages, llm });
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
  stageRef.current = "extraction";
  const extraction = await extractMarketDocument({
    pdf,
    documentText: fullText || null,
    classification,
    documentId: document.id,
    llm,
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
      flagForReview: classifyResult.flagForReview,
      nComps: 0,
      nCompsMerged: 0,
      nStats: 0,
      unresolvedNeighborhoods: [],
      affectedNeighborhoods: [],
      flags,
      status: "failed",
      error,
    };
    await store.saveIngestReport(document.id, report);
    return report;
  }

  // Resolve neighborhoods + coordinates.
  stageRef.current = "neighborhood resolution";
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
  // New rows enter the user review queue (review_status defaults to pending);
  // merges keep the existing row's review decision, except a rejected comp
  // re-corroborated by a new source goes back through review.
  stageRef.current = "comp/stat persistence";
  const candidates = await store.findCompsByNormalizedAddresses(normalizedAddresses);
  const candidatePool = [...candidates];
  let merged = 0;
  const affected = new Set<string>();
  const reopenedIds: string[] = [];
  for (const comp of incoming) {
    const match = candidatePool.find((existing) => isSameDeal(existing, comp));
    if (match) {
      const wasRejected = match.reviewStatus === "rejected";
      const mergedComp = mergeComps(match, comp);
      const saved = await store.replaceComp(match.id, compToUpsertParams(mergedComp, match.documentId ?? document.id));
      if (wasRejected) reopenedIds.push(saved.id);
      candidatePool[candidatePool.indexOf(match)] = saved;
      merged += 1;
      if (saved.neighborhoodId) affected.add(saved.neighborhoodId);
    } else {
      const saved = await store.insertComp(compToUpsertParams(comp, document.id));
      candidatePool.push(saved);
      if (saved.neighborhoodId) affected.add(saved.neighborhoodId);
    }
  }
  if (reopenedIds.length > 0) await store.setCompReviewStatus(reopenedIds, "pending");

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
  stageRef.current = "neighborhood synthesis";
  await resynthesizeNeighborhoods({
    neighborhoodIds: [...affected],
    store,
    llm,
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
    flagForReview: classifyResult.flagForReview,
    nComps: incoming.length,
    nCompsMerged: merged,
    nStats: savedStats.length,
    nCompsPendingReview: incoming.length - merged,
    unresolvedNeighborhoods: [...unresolved],
    affectedNeighborhoods: [...affected],
    flags,
    status: "succeeded",
  };

  // Stage 3: per-document analyst notes — the Gemini read → OpenAI refine
  // chain behind the ingest log's Notes panel and the live review corpus.
  // Failures never sink an otherwise successful ingest.
  let notes = null;
  try {
    notes = await generateDocumentNotes({
      documentId: document.id,
      filename: params.filename,
      classification,
      pdf,
      documentText: fullText || null,
      comps: incoming,
      stats: savedStats,
      store,
      llm,
      asOf: params.asOf,
    });
    report.notesGenerated = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[marketContext notes]", err);
    report.notesGenerated = false;
    report.flags.push(`document notes failed: ${message}`);
  }

  // Stage 4: analyst brief for this upload + fold it into the living knowledge
  // base (versioned). Failures never sink an otherwise successful ingest.
  try {
    const knowledge = await updateMarketKnowledge({
      document,
      classification,
      report,
      comps: incoming,
      stats: savedStats,
      notes,
      store,
      llm,
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

export { MARKET_PROMPT_VERSIONS };
