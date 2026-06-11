/**
 * Market context API: upload + ingest market PDFs (broker docs and research
 * reports), read neighborhood summaries for the Yield Map overlay, query
 * extracted market comps by provenance, and serve the living knowledge base
 * (GET /api/market-knowledge) + Yield Map headlines (GET /api/market-headlines).
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  getPool,
  MarketCompRepo,
  MarketDocumentRepo,
  MarketKnowledgeRepo,
  NeighborhoodRepo,
  NeighborhoodSummaryRepo,
  MarketStatRepo,
} from "@re-sourcing/db";
import type {
  MarketComp,
  MarketHeadlinesResponse,
  MarketKnowledgeResponse,
  NeighborhoodSummaryWithGeo,
} from "@re-sourcing/contracts";
import { ingestMarketDocument } from "../marketContext/ingestMarketDocument.js";
import { PgMarketContextStore } from "../marketContext/store.js";
import { computeMarketHeadlines } from "../marketContext/knowledge.js";
import { computeNeighborhoodRollup, effectiveSourceType, withReadTimeFallback } from "../marketContext/rollup.js";
import { fallbackSubmarketsFor } from "../marketContext/neighborhoodResolve.js";

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

// Ingest log (flag_for_review surfaces here and in the UI).
router.get("/market-docs", async (_req: Request, res: Response) => {
  try {
    const repo = new MarketDocumentRepo({ pool: getPool() });
    const documents = await repo.list(100);
    res.json({ documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market-docs list]", err);
    res.status(503).json({ error: "Failed to list market documents.", details: message });
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
    const comps = await repo.list({
      neighborhoodId: typeof req.query.neighborhood === "string" ? req.query.neighborhood.trim() || null : null,
      sourceType: typeof req.query.source_type === "string" ? req.query.source_type.trim() || null : null,
      priceType: typeof req.query.price_type === "string" ? req.query.price_type.trim() || null : null,
      unresolvedOnly: req.query.unresolved === "1",
    });
    res.json({ comps, count: comps.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[market comps list]", err);
    res.status(503).json({ error: "Failed to list market comps.", details: message });
  }
});

export default router;
