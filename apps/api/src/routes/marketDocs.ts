/**
 * Market context API: upload + ingest market PDFs (broker docs and research
 * reports), read neighborhood summaries for the Yield Map overlay, and query
 * extracted market comps by provenance.
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { getPool, MarketCompRepo, MarketDocumentRepo, NeighborhoodRepo, NeighborhoodSummaryRepo, MarketStatRepo } from "@re-sourcing/db";
import type { MarketComp, NeighborhoodSummaryWithGeo } from "@re-sourcing/contracts";
import { ingestMarketDocument } from "../marketContext/ingestMarketDocument.js";
import { PgMarketContextStore } from "../marketContext/store.js";
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
      res.status(201).json({ report });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[market-docs upload]", err);
      res.status(503).json({ error: "Failed to ingest market document.", details: message });
    }
  }
);

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
