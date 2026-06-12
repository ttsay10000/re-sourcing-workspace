/**
 * Unified comp review queue: every extracted comparable awaiting user
 * confirmation before it reaches the Comp Analysis table and the Yield Map
 * comp layer.
 *
 *   GET  /api/comps/review-queue — pending market-doc extractions (with their
 *        source report + period) and pending broker-package comp items, in one
 *        normalized shape so the analyst can check the extracted fields.
 *   POST /api/comps/review       — batch approve/reject. Market-doc decisions
 *        re-roll the affected neighborhood summaries (rejected comps leave the
 *        medians); broker decisions set the package item review status the
 *        promote flow already requires.
 */
import { Router, type Request, type Response } from "express";
import { getPool, MarketCompRepo } from "@re-sourcing/db";
import type {
  CompReviewDecision,
  CompReviewQueueItem,
  CompReviewQueueResponse,
  CompReviewResult,
  MarketPriceType,
} from "@re-sourcing/contracts";
import { resynthesizeNeighborhoods } from "../marketContext/ingestMarketDocument.js";
import { PgMarketContextStore } from "../marketContext/store.js";

const router = Router();

const QUEUE_LIMIT = 200;
const MAX_DECISIONS = 200;

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value.replace(/[$,%\s,]/g, "")) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : new Date(0).toISOString();
}

function confidenceLabel(value: number | null): string | null {
  if (value == null) return null;
  if (value >= 0.8) return "high";
  if (value >= 0.6) return "medium";
  return "low";
}

function packageTypeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

router.get("/comps/review-queue", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();

    const marketRows = await new MarketCompRepo({ pool }).listPendingWithDocuments(QUEUE_LIMIT);
    const marketItems: CompReviewQueueItem[] = marketRows.map(({ comp, document }) => ({
      id: comp.id,
      source: "market_doc",
      address: comp.address,
      propertyName: null,
      neighborhood: comp.neighborhoodRaw,
      borough: comp.borough,
      units: comp.unitsTotal,
      gsf: comp.gsf,
      salePrice: comp.salePrice,
      saleDate: comp.saleDate,
      capRatePct: comp.capRate != null ? comp.capRate * 100 : null,
      grm: comp.grm,
      pricePsf: comp.pricePsf,
      pricePerUnit:
        comp.salePrice != null && comp.unitsTotal != null && comp.unitsTotal > 0
          ? comp.salePrice / comp.unitsTotal
          : null,
      noi: null,
      assetType: comp.assetType,
      priceType: comp.priceType,
      confidence: comp.confidence,
      cherryPickRisk: comp.cherryPickRisk,
      buyer: comp.buyer,
      saleConditions: comp.saleConditions,
      notes: comp.notesShort,
      sourceLabel: [
        document?.publisher ?? document?.filename ?? "Market document",
        document?.reportTitle ?? null,
      ]
        .filter(Boolean)
        .join(" · "),
      sourceDetail: document?.periodCovered ?? null,
      documentId: document?.id ?? comp.documentId,
      packageId: null,
      createdAt: comp.createdAt,
    }));

    const brokerResult = await pool.query(
      `SELECT i.id, i.item_type, i.normalized_payload, i.reviewed_payload, i.confidence, i.created_at,
              pkg.id AS package_id, pkg.package_type, pkg.created_at AS package_created_at,
              p.canonical_address AS subject_address
       FROM broker_comp_extracted_items i
       INNER JOIN broker_comp_packages pkg ON pkg.id = i.package_id
       INNER JOIN properties p ON p.id = i.property_id
       WHERE i.item_type IN ('sale_comp', 'pricing_comp')
         AND i.review_status = 'pending'
       ORDER BY i.created_at DESC
       LIMIT $1`,
      [QUEUE_LIMIT]
    );
    const brokerItems: CompReviewQueueItem[] = brokerResult.rows.map((row) => {
      const payload = {
        ...((row.normalized_payload as Record<string, unknown> | null) ?? {}),
        ...((row.reviewed_payload as Record<string, unknown> | null) ?? {}),
      };
      const salePrice = toNumber(payload.salePrice);
      const units = toNumber(payload.units);
      return {
        id: String(row.id),
        source: "broker" as const,
        address: toText(payload.address ?? payload.propertyAddress),
        propertyName: toText(payload.propertyName),
        neighborhood: toText(payload.neighborhood),
        borough: toText(payload.borough),
        units,
        gsf: toNumber(payload.gsf ?? payload.squareFeet),
        salePrice,
        saleDate: toText(payload.saleDate),
        capRatePct: toNumber(payload.capRatePct ?? payload.capRate),
        grm: toNumber(payload.grm ?? payload.grossRentMultiplier),
        pricePsf: toNumber(payload.pricePerSqft ?? payload.salePsf ?? payload.soldPpsf ?? payload.askingPpsf),
        pricePerUnit:
          toNumber(payload.pricePerUnit) ??
          (salePrice != null && units != null && units > 0 ? salePrice / units : null),
        noi: toNumber(payload.noi),
        assetType: toText(payload.assetType),
        priceType: null as MarketPriceType | null,
        confidence: confidenceLabel(toNumber(row.confidence)),
        cherryPickRisk: false,
        buyer: toText(payload.buyer ?? payload.purchaser),
        saleConditions: [],
        notes: toText(payload.notes ?? payload.note),
        sourceLabel: `Broker package · ${packageTypeLabel(String(row.package_type))}`,
        sourceDetail: String(row.subject_address).split(",")[0] ?? null,
        documentId: null,
        packageId: String(row.package_id),
        createdAt: toIso(row.created_at),
      };
    });

    const items = [...marketItems, ...brokerItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const payload: CompReviewQueueResponse = {
      items,
      counts: { marketDoc: marketItems.length, broker: brokerItems.length },
    };
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[comps review-queue]", err);
    res.status(503).json({ error: "Failed to load the comp review queue.", details: message });
  }
});

function parseDecisions(body: unknown): CompReviewDecision[] | null {
  const raw = (body as { decisions?: unknown } | null)?.decisions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DECISIONS) return null;
  const decisions: CompReviewDecision[] = [];
  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const source = row.source === "market_doc" || row.source === "broker" ? row.source : null;
    const action = row.action === "approve" || row.action === "reject" ? row.action : null;
    if (!id || !source || !action) return null;
    decisions.push({ id, source, action });
  }
  return decisions;
}

router.post("/comps/review", async (req: Request, res: Response) => {
  const decisions = parseDecisions(req.body);
  if (!decisions) {
    res.status(400).json({
      error: `Body must be { decisions: [{ id, source: "market_doc" | "broker", action: "approve" | "reject" }] } with 1-${MAX_DECISIONS} entries.`,
    });
    return;
  }

  try {
    const pool = getPool();
    let updated = 0;
    const affectedNeighborhoods = new Set<string>();

    const marketRepo = new MarketCompRepo({ pool });
    for (const action of ["approve", "reject"] as const) {
      const ids = decisions
        .filter((decision) => decision.source === "market_doc" && decision.action === action)
        .map((decision) => decision.id);
      if (ids.length === 0) continue;
      const rows = await marketRepo.setReviewStatus(ids, action === "approve" ? "approved" : "rejected");
      updated += rows.length;
      for (const row of rows) if (row.neighborhoodId) affectedNeighborhoods.add(row.neighborhoodId);
    }

    for (const action of ["approve", "reject"] as const) {
      const ids = decisions
        .filter((decision) => decision.source === "broker" && decision.action === action)
        .map((decision) => decision.id);
      if (ids.length === 0) continue;
      const result = await pool.query(
        `UPDATE broker_comp_extracted_items
         SET review_status = $2, reviewed_at = now(), updated_at = now()
         WHERE id = ANY($1::uuid[]) AND item_type IN ('sale_comp', 'pricing_comp')`,
        [ids, action === "approve" ? "accepted" : "rejected"]
      );
      updated += result.rowCount ?? 0;
    }

    // Rejected market comps leave the medians; approvals can change them too
    // (a previously rejected comp re-approved). Deterministic re-roll, no model.
    const neighborhoodIds = [...affectedNeighborhoods];
    await resynthesizeNeighborhoods({
      neighborhoodIds,
      store: new PgMarketContextStore(pool),
      llm: null,
      documentId: null,
    });

    const payload: CompReviewResult = { updated, resynthesizedNeighborhoods: neighborhoodIds };
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[comps review]", err);
    res.status(503).json({ error: "Failed to apply comp review decisions.", details: message });
  }
});

export default router;
