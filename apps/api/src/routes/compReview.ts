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
import { getPool, MarketCompRepo, NeighborhoodRepo } from "@re-sourcing/db";
import type {
  CompReviewDecision,
  CompReviewQueueItem,
  CompReviewQueueResponse,
  CompReviewReviewedFields,
  CompReviewResult,
  MarketAssetType,
  MarketPriceType,
} from "@re-sourcing/contracts";
import { normalizeCompAddress } from "../marketContext/dedupe.js";
import { resynthesizeNeighborhoods } from "../marketContext/ingestMarketDocument.js";
import {
  buildNeighborhoodIndex,
  resolveNeighborhoodId,
  type NeighborhoodIndex,
} from "../marketContext/neighborhoodResolve.js";
import { PgMarketContextStore } from "../marketContext/store.js";

const router = Router();

const QUEUE_LIMIT = 200;
const MAX_DECISIONS = 200;
const PRICE_TYPES: MarketPriceType[] = ["closed", "asking", "in_contract", "unknown"];
const MARKET_ASSET_TYPES: MarketAssetType[] = [
  "multifamily",
  "mixed-use",
  "office",
  "retail",
  "development",
  "conversion",
];

type QueryRunner = Pick<ReturnType<typeof getPool>, "query">;

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value.replace(/[$,%\s,]/g, "")) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasField<K extends keyof CompReviewReviewedFields>(
  fields: CompReviewReviewedFields,
  key: K
): boolean {
  return Object.prototype.hasOwnProperty.call(fields, key);
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

function parseReviewedFields(
  value: unknown
): { ok: true; fields: CompReviewReviewedFields | null } | { ok: false } {
  if (value == null) return { ok: true, fields: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const row = value as Record<string, unknown>;
  const fields: CompReviewReviewedFields = {};

  if ("address" in row) fields.address = toText(row.address);
  if ("neighborhood" in row) fields.neighborhood = toText(row.neighborhood);
  if ("borough" in row) fields.borough = toText(row.borough);
  if ("units" in row) fields.units = toNumber(row.units);
  if ("gsf" in row) fields.gsf = toNumber(row.gsf);
  if ("salePrice" in row) fields.salePrice = toNumber(row.salePrice);
  if ("saleDate" in row) fields.saleDate = toText(row.saleDate);
  if ("capRatePct" in row) fields.capRatePct = toNumber(row.capRatePct);
  if ("grm" in row) fields.grm = toNumber(row.grm);
  if ("pricePsf" in row) fields.pricePsf = toNumber(row.pricePsf);
  if ("pricePerUnit" in row) fields.pricePerUnit = toNumber(row.pricePerUnit);
  if ("noi" in row) fields.noi = toNumber(row.noi);
  if ("assetType" in row) fields.assetType = toText(row.assetType);
  if ("priceType" in row) {
    fields.priceType = PRICE_TYPES.includes(row.priceType as MarketPriceType)
      ? (row.priceType as MarketPriceType)
      : null;
  }
  if ("buyer" in row) fields.buyer = toText(row.buyer);
  if ("notes" in row) fields.notes = toText(row.notes);

  return { ok: true, fields: Object.keys(fields).length > 0 ? fields : null };
}

function hasReviewedFields(fields: CompReviewReviewedFields | null | undefined): fields is CompReviewReviewedFields {
  return fields != null && Object.keys(fields).length > 0;
}

function reviewedFieldsToBrokerPayload(fields: CompReviewReviewedFields): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (hasField(fields, "address")) payload.address = fields.address ?? null;
  if (hasField(fields, "neighborhood")) payload.neighborhood = fields.neighborhood ?? null;
  if (hasField(fields, "borough")) payload.borough = fields.borough ?? null;
  if (hasField(fields, "units")) payload.units = fields.units ?? null;
  if (hasField(fields, "gsf")) payload.gsf = fields.gsf ?? null;
  if (hasField(fields, "salePrice")) payload.salePrice = fields.salePrice ?? null;
  if (hasField(fields, "saleDate")) payload.saleDate = fields.saleDate ?? null;
  if (hasField(fields, "capRatePct")) payload.capRatePct = fields.capRatePct ?? null;
  if (hasField(fields, "grm")) payload.grm = fields.grm ?? null;
  if (hasField(fields, "pricePsf")) {
    payload.pricePsf = fields.pricePsf ?? null;
    payload.pricePerSqft = fields.pricePsf ?? null;
  }
  if (hasField(fields, "pricePerUnit")) payload.pricePerUnit = fields.pricePerUnit ?? null;
  if (hasField(fields, "noi")) payload.noi = fields.noi ?? null;
  if (hasField(fields, "assetType")) payload.assetType = fields.assetType ?? null;
  if (hasField(fields, "priceType")) payload.priceType = fields.priceType ?? null;
  if (hasField(fields, "buyer")) payload.buyer = fields.buyer ?? null;
  if (hasField(fields, "notes")) payload.notes = fields.notes ?? null;
  return payload;
}

function toSqlDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function toInteger(value: unknown): number | null {
  const numeric = toNumber(value);
  return numeric == null ? null : Math.round(numeric);
}

function toMarketAssetType(value: unknown): MarketAssetType | null {
  const text = toText(value);
  return MARKET_ASSET_TYPES.includes(text as MarketAssetType) ? (text as MarketAssetType) : null;
}

function toMarketPriceType(value: unknown): MarketPriceType {
  return PRICE_TYPES.includes(value as MarketPriceType) ? (value as MarketPriceType) : "unknown";
}

async function applyMarketReviewedFields(
  db: QueryRunner,
  id: string,
  fields: CompReviewReviewedFields,
  neighborhoodIndex: NeighborhoodIndex
): Promise<{ updated: number; neighborhoodIds: string[] }> {
  const values: unknown[] = [id];
  const sets = ["review_status = 'approved'", "reviewed_at = now()", "updated_at = now()"];
  const addValue = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (hasField(fields, "address")) {
    const address = toText(fields.address);
    if (address) {
      addValue("address", address);
      addValue("address_normalized", normalizeCompAddress(address));
      sets.push("lat = NULL", "lng = NULL");
    }
  }
  if (hasField(fields, "neighborhood")) {
    const neighborhood = toText(fields.neighborhood);
    addValue("neighborhood_raw", neighborhood);
    addValue("neighborhood_id", resolveNeighborhoodId(neighborhood, neighborhoodIndex));
  }
  if (hasField(fields, "borough")) addValue("borough", fields.borough ?? null);
  if (hasField(fields, "units")) addValue("units_total", toInteger(fields.units));
  if (hasField(fields, "gsf")) addValue("gsf", fields.gsf ?? null);
  if (hasField(fields, "salePrice")) addValue("sale_price", fields.salePrice ?? null);
  if (hasField(fields, "saleDate")) addValue("sale_date", toSqlDate(fields.saleDate));
  if (hasField(fields, "capRatePct")) {
    addValue("cap_rate", fields.capRatePct == null ? null : fields.capRatePct / 100);
  }
  if (hasField(fields, "grm")) addValue("grm", fields.grm ?? null);
  if (hasField(fields, "pricePsf")) addValue("price_psf", fields.pricePsf ?? null);
  if (hasField(fields, "pricePerUnit")) addValue("price_per_unit", fields.pricePerUnit ?? null);
  if (hasField(fields, "noi")) addValue("noi", fields.noi ?? null);
  if (hasField(fields, "assetType")) addValue("asset_type", toMarketAssetType(fields.assetType));
  if (hasField(fields, "priceType")) addValue("price_type", toMarketPriceType(fields.priceType));
  if (hasField(fields, "buyer")) addValue("buyer", fields.buyer ?? null);
  if (hasField(fields, "notes")) addValue("notes_short", fields.notes ?? null);

  const result = await db.query(
    `WITH before AS (
       SELECT neighborhood_id FROM market_comps WHERE id = $1
     ),
     updated AS (
       UPDATE market_comps
       SET ${sets.join(", ")}
       WHERE id = $1 AND is_subject_property = false
       RETURNING neighborhood_id
     )
     SELECT before.neighborhood_id AS old_neighborhood_id,
            updated.neighborhood_id AS neighborhood_id
     FROM before
     INNER JOIN updated ON true`,
    values
  );
  const row = result.rows[0] as { old_neighborhood_id?: unknown; neighborhood_id?: unknown } | undefined;
  if (!row) return { updated: 0, neighborhoodIds: [] };
  return {
    updated: 1,
    neighborhoodIds: [toText(row.old_neighborhood_id), toText(row.neighborhood_id)].filter(
      (value): value is string => value != null
    ),
  };
}

router.get("/comps/review-queue", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();

    const [marketRows, brokerResult] = await Promise.all([
      new MarketCompRepo({ pool }).listPendingWithDocuments(QUEUE_LIMIT),
      pool.query(
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
      ),
    ]);
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
        comp.pricePerUnit ??
        (comp.salePrice != null && comp.unitsTotal != null && comp.unitsTotal > 0
          ? comp.salePrice / comp.unitsTotal
          : null),
      noi: comp.noi,
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
        priceType: PRICE_TYPES.includes(payload.priceType as MarketPriceType)
          ? (payload.priceType as MarketPriceType)
          : null,
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
    const reviewedFields = parseReviewedFields(row.reviewedFields);
    if (!reviewedFields.ok) return null;
    decisions.push({ id, source, action, reviewedFields: reviewedFields.fields });
  }
  return decisions;
}

router.post("/comps/review", async (req: Request, res: Response) => {
  const decisions = parseDecisions(req.body);
  if (!decisions) {
    res.status(400).json({
      error: `Body must be { decisions: [{ id, source: "market_doc" | "broker", action: "approve" | "reject", reviewedFields? }] } with 1-${MAX_DECISIONS} entries.`,
    });
    return;
  }

  try {
    const pool = getPool();
    let updated = 0;
    const affectedNeighborhoods = new Set<string>();

    const editedMarketDecisions = decisions.filter(
      (decision) =>
        decision.source === "market_doc" &&
        decision.action === "approve" &&
        hasReviewedFields(decision.reviewedFields)
    );
    const handledMarketIds = new Set<string>();
    if (editedMarketDecisions.length > 0) {
      const neighborhoodIndex = buildNeighborhoodIndex(await new NeighborhoodRepo({ pool }).listAll());
      for (const decision of editedMarketDecisions) {
        const fields = decision.reviewedFields;
        if (!hasReviewedFields(fields)) continue;
        const result = await applyMarketReviewedFields(pool, decision.id, fields, neighborhoodIndex);
        if (result.updated > 0) {
          handledMarketIds.add(decision.id);
          updated += result.updated;
          for (const neighborhoodId of result.neighborhoodIds) affectedNeighborhoods.add(neighborhoodId);
        }
      }
    }

    const marketRepo = new MarketCompRepo({ pool });
    for (const action of ["approve", "reject"] as const) {
      const ids = decisions
        .filter(
          (decision) =>
            decision.source === "market_doc" &&
            decision.action === action &&
            !handledMarketIds.has(decision.id)
        )
        .map((decision) => decision.id);
      if (ids.length === 0) continue;
      const rows = await marketRepo.setReviewStatus(ids, action === "approve" ? "approved" : "rejected");
      updated += rows.length;
      for (const row of rows) if (row.neighborhoodId) affectedNeighborhoods.add(row.neighborhoodId);
    }

    const handledBrokerIds = new Set<string>();
    for (const decision of decisions) {
      if (
        decision.source !== "broker" ||
        decision.action !== "approve" ||
        !hasReviewedFields(decision.reviewedFields)
      ) {
        continue;
      }
      const reviewedPayload = reviewedFieldsToBrokerPayload(decision.reviewedFields);
      const result = await pool.query(
        `UPDATE broker_comp_extracted_items
         SET review_status = 'accepted',
             reviewed_payload = COALESCE(reviewed_payload, '{}'::jsonb) || $2::jsonb,
             reviewed_at = now(),
             updated_at = now()
         WHERE id = $1::uuid AND item_type IN ('sale_comp', 'pricing_comp')`,
        [decision.id, JSON.stringify(reviewedPayload)]
      );
      if ((result.rowCount ?? 0) > 0) {
        handledBrokerIds.add(decision.id);
        updated += result.rowCount ?? 0;
      }
    }

    for (const action of ["approve", "reject"] as const) {
      const ids = decisions
        .filter(
          (decision) =>
            decision.source === "broker" &&
            decision.action === action &&
            !handledBrokerIds.has(decision.id)
        )
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
