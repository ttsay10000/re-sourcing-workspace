/**
 * UI v2 saved deals and deal progress API.
 *
 * This router is intentionally isolated from the legacy profile/deals routes so
 * a later integration step can mount it without changing existing workflows.
 */

import { Router, type Request, type Response } from "express";
import type { Pool } from "pg";
import type {
  DealStatus,
  SavedDeal,
  UiV2DealProgressSummaryResponse,
  UiV2PipelineStatus,
  UiV2SavedDealsListResponse,
} from "@re-sourcing/contracts";
import { getPool, UserProfileRepo } from "@re-sourcing/db";
import { resolveEffectiveDealScore } from "../deal/effectiveDealScore.js";
import { getPropertyDossierSummary, hasCompletedDealDossier } from "../deal/propertyDossierState.js";
import { resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const PROGRESS_SECTION_LIMIT = 12;

const DEAL_STATUSES = new Set<DealStatus>(["new", "interesting", "saved", "dossier_generated", "rejected"]);
const UI_V2_STATUSES = new Set<UiV2PipelineStatus>([
  "new",
  "screening",
  "interesting",
  "saved",
  "underwriting",
  "outreach",
  "awaiting_broker",
  "om_received",
  "dossier_generated",
  "offer_review",
  "rejected",
  "archived",
]);

type JsonRecord = Record<string, unknown>;

interface SavedProgressBaseRow {
  saved_deal_id: string | null;
  saved_user_id: string | null;
  saved_deal_status: DealStatus | string | null;
  saved_deal_created_at: Date | string | null;
  property_id: string;
  canonical_address: string;
  details: JsonRecord | null;
  property_created_at: Date | string;
  property_updated_at: Date | string;
  listing_id: string | null;
  listing_source: string | null;
  listing_price: number | string | null;
  listing_sqft: number | string | null;
  listing_url: string | null;
  listing_title: string | null;
  listing_image_urls: string[] | null;
  listing_extra: JsonRecord | null;
  latest_signal_deal_score: number | string | null;
  latest_signal_asset_cap_rate: number | string | null;
  latest_signal_adjusted_cap_rate: number | string | null;
  latest_signal_rent_upside: number | string | null;
  latest_signal_irr_pct: number | string | null;
  latest_signal_coc_pct: number | string | null;
  latest_signal_generated_at: Date | string | null;
  override_score: number | string | null;
  latest_om_status: string | null;
  latest_om_completed_at: Date | string | null;
  uploaded_doc_count: number | string | null;
  inquiry_doc_count: number | string | null;
  generated_doc_count: number | string | null;
  open_action_item_count: number | string | null;
  latest_inquiry_sent_at: Date | string | null;
  rejection_reason_code?: string | null;
  rejection_reason_label?: string | null;
  rejection_note?: string | null;
  rejected_at?: Date | string | null;
}

interface SavedDealV2Row {
  savedDeal: SavedDeal;
  propertyId: string;
  canonicalAddress: string;
  displayAddress: string;
  source: string | null;
  price: number | null;
  units: number | null;
  sqft: number | null;
  pricePerUnit: number | null;
  capRate: number | null;
  rentUpside: number | null;
  irrPct: number | null;
  cocPct: number | null;
  dealScore: number | null;
  status: UiV2PipelineStatus;
  tags: string[];
  neighborhood: string | null;
  borough: string | null;
  firstImageUrl: string | null;
  listingUrl: string | null;
  omStatus: string;
  documentCount: number;
  openActionItemCount: number;
  latestOutreachAt: string | null;
  rejection: {
    reasonCode: string;
    reasonLabel: string | null;
    note: string | null;
    rejectedAt: string | null;
  } | null;
  updatedAt: string;
}

interface ProgressPropertyRow {
  propertyId: string;
  canonicalAddress: string;
  displayAddress: string;
  source: string | null;
  price: number | null;
  units: number | null;
  dealScore: number | null;
  status: UiV2PipelineStatus;
  savedDealStatus: string | null;
  tags: string[];
  omStatus: string;
  openActionItemCount: number;
  updatedAt: string;
}

interface ProgressSection {
  id: "saved" | "underwriting" | "outreach" | "awaiting_broker" | "om_received" | "rejected";
  label: string;
  count: number;
  rows: ProgressPropertyRow[];
}

type SavedDealsV2Response = UiV2SavedDealsListResponse & {
  savedDeals: UiV2SavedDealsListResponse["savedDeals"] & {
    rows: SavedDealV2Row[];
  };
};

type DealProgressV2Response = UiV2DealProgressSummaryResponse & {
  sections: ProgressSection[];
  rejectionReasons?: Array<{ reasonCode: string; count: number }>;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toIso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function toIsoOrNull(value: unknown): string | null {
  const iso = toIso(value);
  return iso.length > 0 ? iso : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toInteger(value: unknown): number {
  const parsed = toNumber(value);
  return parsed == null ? 0 : Math.trunc(parsed);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

function parseOffset(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function parseStatusFilter(value: unknown): DealStatus[] {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return rawValues
    .map((entry) => String(entry).trim())
    .filter((entry): entry is DealStatus => DEAL_STATUSES.has(entry as DealStatus));
}

function readPipeline(details: JsonRecord | null): JsonRecord {
  return isJsonRecord(details?.pipeline) ? details.pipeline : {};
}

function readTags(details: JsonRecord | null): string[] {
  const pipeline = readPipeline(details);
  const source = Array.isArray(pipeline.tags) ? pipeline.tags : Array.isArray(details?.tags) ? details.tags : [];
  return Array.from(new Set(source.map((tag) => String(tag).trim()).filter(Boolean)));
}

function readLocation(details: JsonRecord | null): { neighborhood: string | null; borough: string | null } {
  const overview = isJsonRecord(details?.propertyOverview) ? details.propertyOverview : {};
  const location = isJsonRecord(details?.location) ? details.location : {};
  return {
    neighborhood:
      stringOrNull(overview.neighborhood)
      ?? stringOrNull(location.neighborhood)
      ?? stringOrNull(details?.neighborhood),
    borough: stringOrNull(overview.borough) ?? stringOrNull(location.borough) ?? stringOrNull(details?.borough),
  };
}

function readFirstImageUrl(row: SavedProgressBaseRow): string | null {
  if (Array.isArray(row.listing_image_urls)) {
    const image = row.listing_image_urls.find((url) => typeof url === "string" && url.trim().length > 0);
    if (image) return image.trim();
  }
  const images = isJsonRecord(row.listing_extra) && Array.isArray(row.listing_extra.images) ? row.listing_extra.images : [];
  const image = images.find((url) => typeof url === "string" && url.trim().length > 0);
  return typeof image === "string" ? image.trim() : null;
}

function mapLegacyStatus(status: string | null): UiV2PipelineStatus {
  const direct = status != null && UI_V2_STATUSES.has(status as UiV2PipelineStatus) ? (status as UiV2PipelineStatus) : null;
  if (direct != null) return direct;
  switch (status) {
    case "enrichment_running":
    case "enrichment_complete":
      return "screening";
    case "needs_om":
    case "om_requested":
      return "outreach";
    case "follow_up_needed":
      return "awaiting_broker";
    case "om_received":
      return "om_received";
    case "underwriting":
      return "underwriting";
    case "saved_watchlist":
      return "saved";
    case "loi_sent":
    case "negotiation":
    case "contract_signed":
    case "diligence_escrow":
      return "offer_review";
    case "closed":
      return "archived";
    case "rejected_removed":
      return "rejected";
    default:
      return "new";
  }
}

function deriveStatus(row: SavedProgressBaseRow): UiV2PipelineStatus {
  const details = row.details;
  const pipeline = readPipeline(details);
  if (row.rejected_at != null || stringOrNull(pipeline.rejectedAt) != null || pipeline.status === "rejected_removed") {
    return "rejected";
  }
  const uiStatus = stringOrNull(pipeline.uiV2Status);
  if (uiStatus != null && UI_V2_STATUSES.has(uiStatus as UiV2PipelineStatus)) return uiStatus as UiV2PipelineStatus;
  if (hasCompletedDealDossier(details as never)) return "dossier_generated";
  return mapLegacyStatus(stringOrNull(pipeline.status));
}

function deriveOmStatus(row: SavedProgressBaseRow): string {
  if (row.latest_om_status != null) return row.latest_om_status;
  if (toInteger(row.inquiry_doc_count) > 0 || toInteger(row.uploaded_doc_count) > 0) return "received";
  return "none";
}

function resolveDealScore(row: SavedProgressBaseRow): number | null {
  const details = row.details;
  const dossierSummary = getPropertyDossierSummary(details as never);
  const calculated =
    dossierSummary?.calculatedDealScore
    ?? dossierSummary?.dealScore
    ?? toNumber(row.latest_signal_deal_score)
    ?? null;
  const override = row.override_score != null
    ? {
        id: "",
        propertyId: row.property_id,
        score: Number(row.override_score),
        reason: "",
        createdBy: null,
        createdAt: "",
        clearedAt: null,
      }
    : null;
  return resolveEffectiveDealScore(calculated, override);
}

function latestTimestamp(values: unknown[]): string {
  const timestamps = values
    .map((value) => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((value): value is number => value != null);
  if (timestamps.length === 0) return new Date().toISOString();
  return new Date(Math.max(...timestamps)).toISOString();
}

function mapSavedDeal(row: SavedProgressBaseRow): SavedDeal {
  return {
    id: row.saved_deal_id ?? "",
    userId: row.saved_user_id ?? "",
    propertyId: row.property_id,
    dealStatus: DEAL_STATUSES.has(row.saved_deal_status as DealStatus) ? (row.saved_deal_status as DealStatus) : "saved",
    createdAt: toIso(row.saved_deal_created_at),
  };
}

function mapSavedRow(row: SavedProgressBaseRow): SavedDealV2Row {
  const details = row.details;
  const units = resolvePreferredOmUnitCount(details as never);
  const price = toNumber(row.listing_price);
  const location = readLocation(details);
  const documentCount = toInteger(row.uploaded_doc_count) + toInteger(row.inquiry_doc_count) + toInteger(row.generated_doc_count);
  return {
    savedDeal: mapSavedDeal(row),
    propertyId: row.property_id,
    canonicalAddress: row.canonical_address,
    displayAddress: row.canonical_address,
    source: row.listing_source,
    price,
    units,
    sqft: toNumber(row.listing_sqft),
    pricePerUnit: price != null && units != null && units > 0 ? Math.round(price / units) : null,
    capRate: toNumber(row.latest_signal_adjusted_cap_rate) ?? toNumber(row.latest_signal_asset_cap_rate),
    rentUpside: toNumber(row.latest_signal_rent_upside),
    irrPct: toNumber(row.latest_signal_irr_pct),
    cocPct: toNumber(row.latest_signal_coc_pct),
    dealScore: resolveDealScore(row),
    status: deriveStatus(row),
    tags: readTags(details),
    neighborhood: location.neighborhood,
    borough: location.borough,
    firstImageUrl: readFirstImageUrl(row),
    listingUrl: row.listing_url,
    omStatus: deriveOmStatus(row),
    documentCount,
    openActionItemCount: toInteger(row.open_action_item_count),
    latestOutreachAt: toIsoOrNull(row.latest_inquiry_sent_at),
    rejection: row.rejected_at != null || row.rejection_reason_code != null
      ? {
          reasonCode: row.rejection_reason_code ?? "other",
          reasonLabel: row.rejection_reason_label ?? null,
          note: row.rejection_note ?? null,
          rejectedAt: toIsoOrNull(row.rejected_at),
        }
      : null,
    updatedAt: latestTimestamp([
      row.property_updated_at,
      row.saved_deal_created_at,
      row.latest_signal_generated_at,
      row.latest_om_completed_at,
      row.rejected_at,
    ]),
  };
}

function mapProgressRow(row: SavedProgressBaseRow): ProgressPropertyRow {
  const saved = mapSavedRow(row);
  return {
    propertyId: saved.propertyId,
    canonicalAddress: saved.canonicalAddress,
    displayAddress: saved.displayAddress,
    source: saved.source,
    price: saved.price,
    units: saved.units,
    dealScore: saved.dealScore,
    status: saved.status,
    savedDealStatus: row.saved_deal_status,
    tags: saved.tags,
    omStatus: saved.omStatus,
    openActionItemCount: saved.openActionItemCount,
    updatedAt: saved.updatedAt,
  };
}

async function getDefaultUserId(): Promise<string> {
  const pool = getPool();
  return new UserProfileRepo({ pool }).ensureDefault();
}

async function hasTable(pool: Pool, tableName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [tableName]);
  return result.rows[0]?.exists === true;
}

function rejectionSelect(hasRejections: boolean): string {
  if (!hasRejections) {
    return `
       NULL::text AS rejection_reason_code,
       NULL::text AS rejection_reason_label,
       NULL::text AS rejection_note,
       NULL::timestamptz AS rejected_at`;
  }
  return `
       pr.reason_code AS rejection_reason_code,
       pr.reason_label AS rejection_reason_label,
       pr.note AS rejection_note,
       pr.rejected_at`;
}

function rejectionJoin(hasRejections: boolean): string {
  if (!hasRejections) return "";
  return `
     LEFT JOIN LATERAL (
       SELECT reason_code, reason_label, note, rejected_at
       FROM property_rejections
       WHERE property_id = p.id AND restored_at IS NULL
       ORDER BY rejected_at DESC
       LIMIT 1
     ) pr ON true`;
}

function baseSelectSql(hasRejections: boolean, savedOnly: boolean): string {
  return `SELECT
       sd.id AS saved_deal_id,
       sd.user_id AS saved_user_id,
       sd.deal_status AS saved_deal_status,
       sd.created_at AS saved_deal_created_at,
       p.id AS property_id,
       p.canonical_address,
       p.details,
       p.created_at AS property_created_at,
       p.updated_at AS property_updated_at,
       l.id AS listing_id,
       l.source AS listing_source,
       l.price AS listing_price,
       l.sqft AS listing_sqft,
       l.url AS listing_url,
       l.title AS listing_title,
       l.image_urls AS listing_image_urls,
       l.extra AS listing_extra,
       ds.deal_score AS latest_signal_deal_score,
       ds.asset_cap_rate AS latest_signal_asset_cap_rate,
       ds.adjusted_cap_rate AS latest_signal_adjusted_cap_rate,
       ds.rent_upside AS latest_signal_rent_upside,
       ds.irr_pct AS latest_signal_irr_pct,
       ds.coc_pct AS latest_signal_coc_pct,
       ds.generated_at AS latest_signal_generated_at,
       dso.score AS override_score,
       om.status AS latest_om_status,
       om.completed_at AS latest_om_completed_at,
       COALESCE(ud.uploaded_doc_count, 0) AS uploaded_doc_count,
       COALESCE(idoc.inquiry_doc_count, 0) AS inquiry_doc_count,
       COALESCE(gdoc.generated_doc_count, 0) AS generated_doc_count,
       COALESCE(ai.open_action_item_count, 0) AS open_action_item_count,
       pis.sent_at AS latest_inquiry_sent_at,
       ${rejectionSelect(hasRejections)}
     FROM ${savedOnly ? "saved_deals sd INNER JOIN properties p ON p.id = sd.property_id" : "properties p LEFT JOIN saved_deals sd ON sd.property_id = p.id AND sd.user_id = $1"}
     LEFT JOIN LATERAL (
       SELECT l.*
       FROM listing_property_matches m
       INNER JOIN listings l ON l.id = m.listing_id
       WHERE m.property_id = p.id
       ORDER BY (m.status = 'accepted') DESC, m.confidence DESC, m.created_at DESC
       LIMIT 1
     ) l ON true
     LEFT JOIN LATERAL (
       SELECT *
       FROM deal_signals
       WHERE property_id = p.id
       ORDER BY generated_at DESC
       LIMIT 1
     ) ds ON true
     LEFT JOIN LATERAL (
       SELECT *
       FROM deal_score_overrides
       WHERE property_id = p.id AND cleared_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
     ) dso ON true
     LEFT JOIN LATERAL (
       SELECT *
       FROM om_ingestion_runs
       WHERE property_id = p.id
       ORDER BY started_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) om ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS uploaded_doc_count
       FROM property_uploaded_documents
       WHERE property_id = p.id
     ) ud ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS inquiry_doc_count
       FROM property_inquiry_documents
       WHERE property_id = p.id
     ) idoc ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS generated_doc_count
       FROM documents
       WHERE property_id = p.id
     ) gdoc ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS open_action_item_count
       FROM property_action_items
       WHERE property_id = p.id AND status = 'open'
     ) ai ON true
     LEFT JOIN LATERAL (
       SELECT sent_at
       FROM property_inquiry_sends
       WHERE property_id = p.id
       ORDER BY sent_at DESC NULLS LAST
       LIMIT 1
     ) pis ON true
     ${rejectionJoin(hasRejections)}`;
}

async function fetchSavedRows(
  pool: Pool,
  userId: string,
  statuses: DealStatus[],
  limit: number,
  offset: number,
  hasRejections: boolean
): Promise<{ rows: SavedProgressBaseRow[]; total: number }> {
  const filters = ["sd.user_id = $1"];
  const params: unknown[] = [userId];
  if (statuses.length > 0) {
    params.push(statuses);
    filters.push(`sd.deal_status::text = ANY($${params.length}::text[])`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM saved_deals sd ${where}`,
    params
  );
  const rowParams = [...params, limit, offset];
  const result = await pool.query<SavedProgressBaseRow>(
    `${baseSelectSql(hasRejections, true)}
     ${where}
     ORDER BY sd.created_at DESC
     LIMIT $${rowParams.length - 1}
     OFFSET $${rowParams.length}`,
    rowParams
  );
  return {
    rows: result.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

async function fetchProgressRows(pool: Pool, userId: string, hasRejections: boolean): Promise<SavedProgressBaseRow[]> {
  const result = await pool.query<SavedProgressBaseRow>(
    `${baseSelectSql(hasRejections, false)}
     ORDER BY p.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

function buildProgressSections(rows: ProgressPropertyRow[]): ProgressSection[] {
  const sectionLabels: Record<ProgressSection["id"], string> = {
    saved: "Saved Deals",
    underwriting: "Underwriting",
    outreach: "Outreach",
    awaiting_broker: "Awaiting Broker",
    om_received: "OM Received",
    rejected: "Rejected",
  };
  const ids = Object.keys(sectionLabels) as ProgressSection["id"][];
  return ids.map((id) => {
    const matches =
      id === "saved"
        ? rows.filter((row) => row.savedDealStatus != null || row.status === "saved")
        : rows.filter((row) => row.status === id);
    return {
      id,
      label: sectionLabels[id],
      count: matches.length,
      rows: matches.slice(0, PROGRESS_SECTION_LIMIT),
    };
  });
}

async function fetchRejectionReasonCounts(pool: Pool, hasRejections: boolean): Promise<Array<{ reasonCode: string; count: number }> | undefined> {
  if (!hasRejections) return undefined;
  const result = await pool.query<{ reason_code: string; count: string }>(
    `SELECT reason_code, COUNT(*)::text AS count
     FROM property_rejections
     WHERE restored_at IS NULL
     GROUP BY reason_code
     ORDER BY COUNT(*) DESC, reason_code ASC`
  );
  return result.rows.map((row) => ({ reasonCode: row.reason_code, count: Number(row.count) }));
}

router.get("/ui-v2/saved-deals", async (req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const pool = getPool();
    const limit = clampLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const statuses = parseStatusFilter(req.query.status);
    const hasRejections = await hasTable(pool, "property_rejections");
    const { rows, total } = await fetchSavedRows(pool, userId, statuses, limit, offset, hasRejections);
    const enrichedRows = rows.map(mapSavedRow);
    const response: SavedDealsV2Response = {
      savedDeals: {
        deals: enrichedRows.map((row) => row.savedDeal),
        rows: enrichedRows,
        total,
        limit,
        offset,
      },
    };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ui-v2 saved-deals]", err);
    res.status(503).json({ error: "Failed to list v2 saved deals.", details: message });
  }
});

router.get("/ui-v2/deal-progress", async (_req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const pool = getPool();
    const hasRejections = await hasTable(pool, "property_rejections");
    const [baseRows, rejectionReasons] = await Promise.all([
      fetchProgressRows(pool, userId, hasRejections),
      fetchRejectionReasonCounts(pool, hasRejections),
    ]);
    const rows = baseRows.map(mapProgressRow);
    const sections = buildProgressSections(rows);
    const sectionCount = (id: ProgressSection["id"]) => sections.find((section) => section.id === id)?.count ?? 0;
    const updatedAt = latestTimestamp(baseRows.flatMap((row) => [
      row.property_updated_at,
      row.saved_deal_created_at,
      row.latest_signal_generated_at,
      row.latest_om_completed_at,
      row.rejected_at,
    ]));
    const response: DealProgressV2Response = {
      summary: {
        savedCount: sectionCount("saved"),
        underwritingCount: sectionCount("underwriting"),
        outreachCount: sectionCount("outreach"),
        awaitingBrokerCount: sectionCount("awaiting_broker"),
        omReceivedCount: sectionCount("om_received"),
        rejectedCount: sectionCount("rejected"),
        updatedAt,
      },
      sections,
      ...(rejectionReasons ? { rejectionReasons } : {}),
    };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ui-v2 deal-progress]", err);
    res.status(503).json({ error: "Failed to load v2 deal progress.", details: message });
  }
});

export default router;
