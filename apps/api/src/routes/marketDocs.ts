/**
 * Market context API: upload + ingest market PDFs (broker docs and research
 * reports), per-document analyst notes, document removal/restore (live-review
 * inclusion control), the live AI market review, neighborhood summaries for
 * the Yield Map overlay, market comps by provenance, and the living knowledge
 * base (GET /api/market-knowledge) + Yield Map headlines (GET /api/market-headlines).
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  getPool,
  MarketCompRepo,
  MarketDocumentRepo,
  MarketKnowledgeRepo,
  MarketLlmOutputRepo,
  MarketReviewRepo,
  NeighborhoodRepo,
  NeighborhoodSummaryRepo,
  MarketStatRepo,
} from "@re-sourcing/db";
import type {
  MarketComp,
  MarketDocIngestReport,
  MarketDocument,
  MarketDocumentListItem,
  MarketHeadlinesResponse,
  MarketKnowledgeResponse,
  MarketReviewResponse,
  NeighborhoodSummaryWithGeo,
} from "@re-sourcing/contracts";
import { ingestMarketDocument, resynthesizeNeighborhoods } from "../marketContext/ingestMarketDocument.js";
import { PgMarketContextStore } from "../marketContext/store.js";
import { computeMarketHeadlines } from "../marketContext/knowledge.js";
import { runMarketLlm } from "../marketContext/llmAdapter.js";
import { isReviewStale, refreshMarketReview } from "../marketContext/review.js";
import { computeNeighborhoodRollup, effectiveSourceType, withReadTimeFallback } from "../marketContext/rollup.js";
import { fallbackSubmarketsFor } from "../marketContext/neighborhoodResolve.js";
import {
  MARKET_PROMPT_V3_VERSION,
  MARKET_PROMPT_V3_PILLAR_SUMMARY,
  GEMINI_MARKET_EXTRACTION_CORE_PROMPT,
  MARKET_COMPS_ROUTING_PROMPT,
  GEMINI_MARKET_SPECIAL_RULES_PROMPT,
  MARKET_DOCUMENT_REVIEW_PROMPT,
  INDIVIDUAL_REVIEW_ANALYSIS_QUESTIONS_PROMPT,
  LIVE_MARKET_ANALYSIS_PROMPT,
  LIVE_MARKET_ANALYSIS_REQUIRED_BEHAVIOR_PROMPT,
  buildGeminiMarketExtractionPrompt,
  buildMarketDocumentReviewPrompt,
  buildLiveMarketAnalysisPrompt,
} from "../brokerComps/marketPromptV3.js";

const router = Router();

const MARKET_DOC_MAX_BYTES = 50 * 1024 * 1024;
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MARKET_DOC_MAX_BYTES },
});

function handleMarketDocMulterError(_req: Request, res: Response, next: (err?: unknown) => void) {
  return (err: unknown) => {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large", details: "Max 50 MB per market document.", maxBytes: MARKET_DOC_MAX_BYTES });
      return;
    }
    next(err);
  };
}

// Upload → classify → extract → synthesize; returns the ingest report.
router.post(
  "/market-docs",
  (req, res, next) => {
    uploadMemory.single("file")(req, res, handleMarketDocMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname?: string; mimetype?: string } }).file;
      if (!file?.buffer) {
        res.status(400).json({ error: "Missing file. Send multipart/form-data with field 'file'." });
        return;
      }
      const store = new PgMarketContextStore(getPool());
      const report = await ingestMarketDocument({
        filename: file.originalname?.trim() || "market-document.pdf",
        contentType: file.mimetype || null,
        buffer: file.buffer,
        store,
      });
      // Pipeline failures still return the report (200): the document row
      // exists with status "failed" + stored error, so the client can show
      // per-file state and offer a retry. 503 is reserved for pre-insert
      // failures (multer, DB down) in the catch below.
      res.status(report.status === "failed" ? 200 : 201).json({ report });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[market-docs upload]", err);
      res.status(503).json({ error: "Failed to ingest market document.", details: message });
    }
  }
);

// Batch upload: process each file sequentially so one bad report never sinks
// the batch. The existing single-file endpoint stays supported for current UI.
router.post(
  "/market-docs/batch",
  (req, res, next) => {
    uploadMemory.array("files", 10)(req, res, handleMarketDocMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    const files = ((req as Request & {
      files?: Array<{ buffer: Buffer; originalname?: string; mimetype?: string }>;
    }).files ?? []).filter((file) => file?.buffer);
    if (files.length === 0) {
      res.status(400).json({ error: "Missing files. Send multipart/form-data with field 'files'." });
      return;
    }
    const store = new PgMarketContextStore(getPool());
    const reports: MarketDocIngestReport[] = [];
    for (const file of files) {
      try {
        reports.push(
          await ingestMarketDocument({
            filename: file.originalname?.trim() || "market-document.pdf",
            contentType: file.mimetype || null,
            buffer: file.buffer,
            store,
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[market-docs batch upload]", err);
        reports.push({
          documentId: "",
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
          flags: [`pre-insert failure: ${message}`],
          status: "failed",
          error: message,
        });
      }
    }
    const succeeded = reports.filter((report) => report.status !== "failed").length;
    res.status(succeeded > 0 ? 201 : 200).json({ reports, count: reports.length, succeeded });
  }
);

// Re-run ingestion for a failed document using its stored file bytes.
router.post("/market-docs/:id/retry", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new MarketDocumentRepo({ pool });
    const document = await repo.byId(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Market document not found.", documentId: req.params.id });
      return;
    }
    if (document.status !== "failed") {
      res.status(409).json({ error: `Only failed documents can be retried (status: ${document.status}).` });
      return;
    }
    const buffer = await repo.getFileContent(document.id);
    if (!buffer) {
      res.status(409).json({ error: "Original file bytes not stored — re-upload the document." });
      return;
    }
    const store = new PgMarketContextStore(pool);
    // Clear partial writes from the failed attempt; merged comps keep their
    // original document_id and survive.
    await store.deleteCompsByDocument(document.id);
    await store.deleteStatsByDocument(document.id);
    const report = await ingestMarketDocument({
      filename: document.filename,
      contentType: document.contentType,
      buffer,
      store,
      existingDocument: document,
    });
    res.status(report.status === "failed" ? 200 : 201).json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-docs retry]", err);
    res.status(503).json({ error: "Failed to retry market document.", details: message });
  }
});

/**
 * Possible-duplicate detection for the ingest log: documents sharing
 * publisher + period + class (or an identical filename) point at the earliest
 * included upload via duplicateOfId so the UI can flag and exclude repeats.
 */
function computeDuplicateOf(documents: MarketDocument[]): Map<string, string> {
  const groups = new Map<string, MarketDocument[]>();
  for (const doc of documents) {
    const keys: string[] = [];
    if (doc.publisher && doc.period_covered) {
      keys.push(`meta|${doc.publisher.toLowerCase()}|${doc.period_covered.toLowerCase()}|${doc.document_class}`);
    }
    keys.push(`file|${doc.filename.trim().toLowerCase()}`);
    for (const key of keys) {
      const list = groups.get(key) ?? [];
      list.push(doc);
      groups.set(key, list);
    }
  }
  const duplicateOf = new Map<string, string>();
  for (const list of groups.values()) {
    const unique = [...new Map(list.map((doc) => [doc.id, doc])).values()];
    if (unique.length < 2) continue;
    const sorted = unique.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const original = sorted.find((doc) => !doc.excludedAt) ?? sorted[0];
    for (const doc of sorted) {
      if (doc.id !== original.id && !duplicateOf.has(doc.id)) duplicateOf.set(doc.id, original.id);
    }
  }
  return duplicateOf;
}

// Ingest log: classification + notes + duplicate flags + pending-comp counts.
router.get("/market-docs", async (_req: Request, res: Response) => {
  try {
    const repo = new MarketDocumentRepo({ pool: getPool() });
    const [rows, pendingCounts] = await Promise.all([repo.list(200), repo.pendingCompCounts()]);
    const duplicateOf = computeDuplicateOf(rows);
    const documents: MarketDocumentListItem[] = rows.map((doc) => ({
      ...doc,
      duplicateOfId: duplicateOf.get(doc.id) ?? null,
      pendingComps: pendingCounts.get(doc.id) ?? 0,
    }));
    res.json({ documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-docs list]", err);
    res.status(503).json({ error: "Failed to list market documents.", details: message });
  }
});

// Prompt transparency for analyst tuning: exact v3 prompt templates with runtime placeholders.
router.get("/market-docs/prompts", async (_req: Request, res: Response) => {
  const geminiTemplate = buildGeminiMarketExtractionPrompt({
    filename: "[uploaded PDF filename]",
    pageCount: null,
    textPreview: "[selectable PDF text preview inserted here when available]",
  });
  const documentReviewTemplate = buildMarketDocumentReviewPrompt({
    filename: "[uploaded PDF filename]",
    geminiExtractionJson: {
      schemaVersion: "market_doc_extraction_v3",
      note: "runtime Gemini extraction JSON is inserted here",
    },
    textPreview: "[selectable PDF text preview inserted here when available]",
  });
  const liveReviewTemplate = buildLiveMarketAnalysisPrompt({
    propertyContextJson: { note: "runtime current deal/property context JSON is inserted here" },
    approvedDocumentReviews: ["included market_doc_review_v3 objects are inserted here"],
    approvedMarketCompsTableRows: ["approved marketCompsTableRows are inserted here"],
    approvedCompItems: ["approved broker comp items are inserted here"],
    excludedOrWatchRows: ["excluded/watch rows are inserted here for caveat context"],
    previousSnapshot: { note: "latest saved live_market_analysis_v3 snapshot is inserted here" },
  });
  res.json({
    version: MARKET_PROMPT_V3_VERSION,
    sections: [
      { key: "pillar-summary", label: "Prompt pillars", text: MARKET_PROMPT_V3_PILLAR_SUMMARY },
      { key: "gemini-core", label: "Gemini extraction core", text: GEMINI_MARKET_EXTRACTION_CORE_PROMPT },
      { key: "comp-routing", label: "Market comps routing", text: MARKET_COMPS_ROUTING_PROMPT },
      { key: "special-rules", label: "Document-type special rules", text: GEMINI_MARKET_SPECIAL_RULES_PROMPT },
      { key: "document-review", label: "GPT individual document review", text: MARKET_DOCUMENT_REVIEW_PROMPT },
      { key: "document-review-questions", label: "Individual review analysis questions", text: INDIVIDUAL_REVIEW_ANALYSIS_QUESTIONS_PROMPT },
      { key: "live-review", label: "Live market review", text: LIVE_MARKET_ANALYSIS_PROMPT },
      { key: "live-review-behavior", label: "Live review required behavior", text: LIVE_MARKET_ANALYSIS_REQUIRED_BEHAVIOR_PROMPT },
      { key: "full-gemini-template", label: "Full Gemini prompt template", text: geminiTemplate },
      { key: "full-document-review-template", label: "Full GPT document-review prompt template", text: documentReviewTemplate },
      { key: "full-live-review-template", label: "Full live-review prompt template", text: liveReviewTemplate },
    ],
  });
});

// Full analyst notes for one document (the ingest log's Notes panel).
router.get("/market-docs/:id/notes", async (req: Request, res: Response) => {
  try {
    const repo = new MarketDocumentRepo({ pool: getPool() });
    const document = await repo.byId(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Market document not found.", documentId: req.params.id });
      return;
    }
    res.json({ documentId: document.id, notes: document.llmNotes ?? null, brief: document.documentBrief ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-docs notes]", err);
    res.status(503).json({ error: "Failed to load document notes.", details: message });
  }
});

/**
 * Soft-remove a document (?reason=duplicate marks duplicate exclusions): its
 * uncorroborated comps are rejected out of rollups + comp surfaces, its stats
 * leave fallbacks, and the live AI review goes stale until refreshed.
 */
router.delete("/market-docs/:id", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new MarketDocumentRepo({ pool });
    const existing = await repo.byId(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Market document not found.", documentId: req.params.id });
      return;
    }
    if (existing.excludedAt) {
      res.json({ document: existing, rejectedComps: 0, resynthesizedNeighborhoods: [] });
      return;
    }
    const reason = req.query.reason === "duplicate" ? "duplicate" : "removed";
    const document = await repo.setExcluded(existing.id, reason);
    const affected = await new MarketCompRepo({ pool }).rejectForExcludedDocument(existing.id);
    const neighborhoodIds = [...new Set(affected.map((row) => row.neighborhoodId).filter((id): id is string => id != null))];
    // Deterministic re-rollup (no model) so map fills drop the removed data immediately.
    await resynthesizeNeighborhoods({
      neighborhoodIds,
      store: new PgMarketContextStore(pool),
      llm: null,
      documentId: existing.id,
    });
    res.json({ document, rejectedComps: affected.length, resynthesizedNeighborhoods: neighborhoodIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-docs remove]", err);
    res.status(503).json({ error: "Failed to remove market document.", details: message });
  }
});

// Restore an excluded document; its rejected comps go back through review.
router.post("/market-docs/:id/restore", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new MarketDocumentRepo({ pool });
    const existing = await repo.byId(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Market document not found.", documentId: req.params.id });
      return;
    }
    const document = existing.excludedAt ? await repo.restore(existing.id) : existing;
    const affected = existing.excludedAt
      ? await new MarketCompRepo({ pool }).reopenForRestoredDocument(existing.id, existing.excludedAt)
      : [];
    const neighborhoodIds = [...new Set(affected.map((row) => row.neighborhoodId).filter((id): id is string => id != null))];
    await resynthesizeNeighborhoods({
      neighborhoodIds,
      store: new PgMarketContextStore(pool),
      llm: null,
      documentId: existing.id,
    });
    res.json({ document, reopenedComps: affected.length, resynthesizedNeighborhoods: neighborhoodIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-docs restore]", err);
    res.status(503).json({ error: "Failed to restore market document.", details: message });
  }
});

// Current live AI review + staleness vs the included-document set.
router.get("/market-review", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const [latest, included] = await Promise.all([
      new MarketReviewRepo({ pool }).latest(),
      new MarketDocumentRepo({ pool }).listIncluded(),
    ]);
    const payload: MarketReviewResponse = {
      review: latest,
      stale: isReviewStale(latest, included.map((doc) => doc.id)),
      currentDocumentCount: included.length,
    };
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-review]", err);
    res.status(503).json({ error: "Failed to load the live market review.", details: message });
  }
});

/**
 * Regenerate the live AI review from every included document's notes (the
 * OpenAI model synthesizes; Gemini is the retry; deterministic digest when no
 * model is configured). Appends a new market_reviews version.
 */
router.post("/market-review/refresh", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const [included, stats, knowledge] = await Promise.all([
      new MarketDocumentRepo({ pool }).listIncluded(),
      new MarketStatRepo({ pool }).list(1000),
      new MarketKnowledgeRepo({ pool }).latest().catch(() => null),
    ]);
    if (included.length === 0) {
      const payload: MarketReviewResponse = { review: null, stale: false, currentDocumentCount: 0 };
      res.json(payload);
      return;
    }
    const record = await refreshMarketReview({
      documents: included,
      stats,
      knowledge,
      llm: runMarketLlm,
      saveLlmOutput: (params) => new MarketLlmOutputRepo({ pool }).insert(params),
      appendReview: (params) => new MarketReviewRepo({ pool }).append(params),
    });
    const payload: MarketReviewResponse = { review: record, stale: false, currentDocumentCount: included.length };
    res.status(201).json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-review refresh]", err);
    res.status(503).json({ error: "Failed to refresh the live market review.", details: message });
  }
});

router.get("/neighborhood-summary/:id", async (req: Request, res: Response) => {
  try {
    const repo = new NeighborhoodSummaryRepo({ pool: getPool() });
    const summary = await repo.byId(req.params.id);
    if (!summary) {
      res.status(404).json({ error: "No summary for neighborhood.", neighborhoodId: req.params.id });
      return;
    }
    res.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[neighborhood-summary]", err);
    res.status(503).json({ error: "Failed to load neighborhood summary.", details: message });
  }
});

/**
 * Bulk payload for the Yield Map overlay: every neighborhood polygon plus its
 * summary. Neighborhoods without enough closed comps get a read-time
 * fallback-only summary (single submarket stat, publisher named) so the map
 * can render the hatched fill. ?source_type=market_research|broker_provided
 * recomputes stats for that slice (stored bullets are all-source, so they are
 * omitted on filtered views).
 */
router.get("/neighborhood-summaries", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const sourceFilter =
      req.query.source_type === "market_research" || req.query.source_type === "broker_provided"
        ? (req.query.source_type as string)
        : null;
    const neighborhoodRepo = new NeighborhoodRepo({ pool });
    const summaryRepo = new NeighborhoodSummaryRepo({ pool });
    const compRepo = new MarketCompRepo({ pool });
    const statRepo = new MarketStatRepo({ pool });

    const neighborhoods = await neighborhoodRepo.listAll();
    const stored = new Map((await summaryRepo.listAll()).map((summary) => [summary.neighborhoodId, summary]));
    const allComps = await compRepo.listByNeighborhoods(neighborhoods.map((hood) => hood.id));
    const allStats = await statRepo.list(1000);

    const summaries: NeighborhoodSummaryWithGeo[] = neighborhoods.map((hood) => {
      const baseComps = allComps.filter((comp) => comp.neighborhoodId === hood.id);
      const comps = sourceFilter
        ? baseComps.filter((comp) => effectiveSourceType(comp) === sourceFilter)
        : baseComps;
      const existing = !sourceFilter ? stored.get(hood.id) : undefined;
      const scopes = fallbackSubmarketsFor(hood);
      const submarketStats = allStats.filter((stat) => stat.submarketId != null && scopes.includes(stat.submarketId));

      if (existing && !sourceFilter) {
        return {
          ...withReadTimeFallback(existing, hood, submarketStats),
          name: hood.name,
          borough: hood.borough,
          submarketId: hood.submarketId,
          aliases: hood.aliases,
          polygon: hood.polygon,
        };
      }
      const draft = computeNeighborhoodRollup({ neighborhood: hood, comps, submarketStats });
      return {
        neighborhoodId: hood.id,
        compCount12mo: draft.compCount12mo,
        nResearch: draft.nResearch,
        nBroker: draft.nBroker,
        nCherryPickExcluded: draft.nCherryPickExcluded,
        nAskingExcluded: draft.nAskingExcluded,
        medianCapRate: draft.medianCapRate,
        capRateRange: draft.capRateRange,
        medianPsf: draft.medianPsf,
        psfRange: draft.psfRange,
        regulatorySkew: draft.regulatorySkew,
        bullets: [],
        fallbackContext: draft.fallbackContext,
        dataFreshness: draft.dataFreshness,
        sources: draft.sources,
        topComps: draft.topComps,
        updatedAt: new Date().toISOString(),
        name: hood.name,
        borough: hood.borough,
        submarketId: hood.submarketId,
        aliases: hood.aliases,
        polygon: hood.polygon,
      };
    });

    // Asking-price broker records render as hollow pins, never in fills/medians.
    const askingPins: MarketComp[] = allComps.filter(
      (comp) => comp.priceType === "asking" && comp.lat != null && comp.lng != null
    );

    res.json({ summaries, askingPins });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[neighborhood-summaries]", err);
    res.status(503).json({ error: "Failed to load neighborhood summaries.", details: message });
  }
});

// Current knowledge-base state for the market-docs page panel.
router.get("/market-knowledge", async (_req: Request, res: Response) => {
  try {
    const repo = new MarketKnowledgeRepo({ pool: getPool() });
    const entry = await repo.latest();
    const payload: MarketKnowledgeResponse = {
      knowledge: entry
        ? {
            version: entry.version,
            updatedAt: entry.createdAt,
            narrative: entry.narrative,
            latestBrief: entry.brief,
            documentId: entry.documentId,
          }
        : null,
    };
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-knowledge]", err);
    res.status(503).json({ error: "Failed to load market knowledge base.", details: message });
  }
});

/**
 * Yield Map headlines: top current bullets from the knowledge base; when the
 * knowledge base is empty (or unreachable) a rule-based fallback is computed
 * from neighborhood_summaries / market_stats deltas. Never returns a 500 —
 * worst case is an empty list.
 */
router.get("/market-headlines", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const [knowledge, summaries, stats, neighborhoods] = await Promise.all([
      new MarketKnowledgeRepo({ pool }).latest().catch(() => null),
      new NeighborhoodSummaryRepo({ pool }).listAll().catch(() => []),
      new MarketStatRepo({ pool }).list(1000).catch(() => []),
      new NeighborhoodRepo({ pool }).listAll().catch(() => []),
    ]);
    res.json(computeMarketHeadlines({ knowledge, summaries, stats, neighborhoods }));
  } catch (err) {
    console.error("[market-headlines]", err);
    const empty: MarketHeadlinesResponse = { headlines: [], generatedAt: null, knowledgeVersion: null };
    res.json(empty);
  }
});

// Market comps with provenance filters: /api/comps?neighborhood=&source_type=&price_type=
router.get("/comps", async (req: Request, res: Response) => {
  try {
    const repo = new MarketCompRepo({ pool: getPool() });
    const reviewStatus =
      req.query.review_status === "pending" || req.query.review_status === "approved" || req.query.review_status === "rejected"
        ? req.query.review_status
        : null;
    const comps = await repo.list({
      neighborhoodId: typeof req.query.neighborhood === "string" ? req.query.neighborhood.trim() || null : null,
      sourceType: typeof req.query.source_type === "string" ? req.query.source_type.trim() || null : null,
      priceType: typeof req.query.price_type === "string" ? req.query.price_type.trim() || null : null,
      unresolvedOnly: req.query.unresolved === "1",
      reviewStatus,
    });
    res.json({ comps, count: comps.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market comps list]", err);
    res.status(503).json({ error: "Failed to list market comps.", details: message });
  }
});

export default router;
