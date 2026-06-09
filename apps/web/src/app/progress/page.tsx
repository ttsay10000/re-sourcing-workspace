"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import {
  UI_V2_REJECTION_REASON_OPTIONS,
  type UiV2DealPathDecision,
  type UiV2DealPathState,
  type UiV2PipelineStatus,
  type UiV2RejectionReasonCode,
} from "@re-sourcing/contracts";
import styles from "./progress.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const BULK_STAGE_MOVE_ID = "__bulk_stage_move__";
const OM_ANALYSIS_BULK_ID = "__bulk_om_analysis__";
const DOSSIER_BULK_ID = "__bulk_dossier__";

type Summary = {
  savedCount?: number;
  underwritingCount?: number;
  outreachCount?: number;
  awaitingBrokerCount?: number;
  omReceivedCount?: number;
  rejectedCount?: number;
  updatedAt?: string | null;
};

type ProgressRow = {
  savedDeal?: SavedDealRow["savedDeal"];
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  source?: string | null;
  price?: number | null;
  units?: number | null;
  sqft?: number | null;
  pricePerSqft?: number | null;
  dealScore?: number | null;
  ltrYocPct?: number | null;
  mtrYocPct?: number | null;
  status?: string | null;
  savedDealStatus?: string | null;
  tags?: string[];
  omStatus?: string | null;
  hasOm?: boolean;
  hasComps?: boolean;
  hasDossier?: boolean;
  dealPath?: UiV2DealPathState | null;
  openActionItemCount?: number | null;
  updatedAt?: string | null;
};

type ProgressSection = {
  id:
    | "om_requested"
    | "underwriting"
    | "tour_scheduled"
    | "tour_completed_awaiting_inputs"
    | "offer_review"
    | "negotiation"
    | "contract_signed"
    | "deal_closed"
    | string;
  label?: string;
  count?: number;
  rows?: ProgressRow[];
};

type SavedDealRow = {
  savedDeal?: {
    id?: string;
    propertyId?: string;
    dealStatus?: string;
    createdAt?: string;
  };
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  source?: string | null;
  price?: number | null;
  units?: number | null;
  sqft?: number | null;
  pricePerSqft?: number | null;
  dealScore?: number | null;
  ltrYocPct?: number | null;
  mtrYocPct?: number | null;
  status?: string | null;
  tags?: string[];
  omStatus?: string | null;
  hasOm?: boolean;
  hasComps?: boolean;
  hasDossier?: boolean;
  dealPath?: UiV2DealPathState | null;
  openActionItemCount?: number | null;
  updatedAt?: string | null;
};

type DealFlowRow = ProgressRow & {
  propertyId: string;
};

type DealProgressResponse = {
  summary?: Summary;
  sections?: ProgressSection[];
  rejectionReasons?: Array<{ reasonCode?: string; count?: number }>;
  error?: string;
  details?: string;
};

type SavedDealsResponse = {
  savedDeals?: {
    rows?: SavedDealRow[];
    deals?: Array<{ id?: string; propertyId?: string; dealStatus?: string; createdAt?: string }>;
    total?: number;
  };
  error?: string;
  details?: string;
};

type OmRefreshResponse = {
  documentsProcessed?: number;
  status?: string | null;
  error?: string;
  details?: string;
};

type DossierGenerateResponse = {
  dealScore?: number | null;
  error?: string;
  details?: string;
};

type SavedDealSection = {
  id: string;
  label: string;
  description?: string;
  rows: DealFlowRow[];
  targetStatus?: UiV2PipelineStatus;
  moveLabel?: string;
};

type SavedStatusGroup = {
  id: string;
  label: string;
  description: string;
  statuses: string[];
  targetStatus?: UiV2PipelineStatus;
  moveLabel?: string;
};

type MovableSavedStatusGroup = SavedStatusGroup & {
  targetStatus: UiV2PipelineStatus;
  moveLabel: string;
};

type DealPathFormState = {
  tourScheduledAt: string;
  tourNotes: string;
  postTourDecision: UiV2DealPathDecision;
  targetPrice: string;
  offerAmount: string;
  offerNotes: string;
  loiContingenciesText: string;
  loiContingencyNotes: string;
  rejectionReasonCode: UiV2RejectionReasonCode | "";
  rejectionNotes: string;
};

type RejectFormState = {
  propertyId: string;
  address: string;
  reasonCode: UiV2RejectionReasonCode | "";
  note: string;
};

const SECTION_ORDER: ProgressSection[] = [
  { id: "om_not_requested", label: "OM Not Requested", count: 0, rows: [] },
  { id: "om_requested", label: "OM Requested", count: 0, rows: [] },
  { id: "underwriting", label: "Underwriting", count: 0, rows: [] },
  { id: "tour_requested", label: "Tour Requested", count: 0, rows: [] },
  { id: "tour_scheduled", label: "Tour Scheduled", count: 0, rows: [] },
  { id: "tour_completed_awaiting_inputs", label: "Tour Completed", count: 0, rows: [] },
  { id: "offer_review", label: "LOI Offered", count: 0, rows: [] },
  { id: "negotiation", label: "Negotiation", count: 0, rows: [] },
  { id: "contract_signed", label: "Contract Signed/Diligence", count: 0, rows: [] },
  { id: "deal_closed", label: "Deal Closed", count: 0, rows: [] },
];

const SAVED_STATUS_GROUPS: SavedStatusGroup[] = [
  {
    id: "om_not_requested",
    label: "OM Not Requested",
    description: "Saved deals where the OM request has not started.",
    statuses: [],
  },
  {
    id: "om_requested",
    label: "OM Requested",
    description: "OMs and related materials requested from brokers.",
    statuses: ["outreach", "awaiting_broker"],
    targetStatus: "awaiting_broker",
    moveLabel: "OM Requested",
  },
  {
    id: "underwriting",
    label: "Underwriting",
    description: "Saved deals, received OMs, and active underwriting work.",
    statuses: ["saved", "underwriting", "om_received", "dossier_generated"],
    targetStatus: "underwriting",
    moveLabel: "Underwriting",
  },
  {
    id: "tour_requested",
    label: "Tour Requested",
    description: "Tour requested and waiting for a confirmed time.",
    statuses: ["tour_scheduled"],
    targetStatus: "tour_scheduled",
    moveLabel: "Tour Requested",
  },
  {
    id: "tour_scheduled",
    label: "Tour Scheduled",
    description: "Tour date is confirmed; waiting on visit.",
    statuses: [],
  },
  {
    id: "tour_completed_awaiting_inputs",
    label: "Tour Completed",
    description: "Tour date has passed; notes and post-tour decision needed.",
    statuses: ["tour_completed_awaiting_inputs"],
    targetStatus: "tour_completed_awaiting_inputs",
    moveLabel: "Tour Completed",
  },
  {
    id: "loi_offered",
    label: "LOI Offered",
    description: "Offer has been sent or is ready to track.",
    statuses: ["offer_review"],
    targetStatus: "offer_review",
    moveLabel: "LOI Offered",
  },
  {
    id: "negotiation",
    label: "Negotiation",
    description: "Pricing, terms, and counterparty negotiation.",
    statuses: ["negotiation"],
    targetStatus: "negotiation",
    moveLabel: "Negotiation",
  },
  {
    id: "contract_signed",
    label: "Contract Signed/Diligence",
    description: "Contract signed with diligence underway.",
    statuses: ["contract_signed"],
    targetStatus: "contract_signed",
    moveLabel: "Contract Signed/Diligence",
  },
  {
    id: "deal_closed",
    label: "Deal Closed",
    description: "Closed deals and archived active pursuits.",
    statuses: ["deal_closed", "archived"],
    targetStatus: "deal_closed",
    moveLabel: "Deal Closed",
  },
];

const MOVE_STAGE_OPTIONS = SAVED_STATUS_GROUPS
  .filter((group): group is MovableSavedStatusGroup =>
    Boolean(group.targetStatus && group.moveLabel)
  )
  .filter((group) => group.targetStatus !== "rejected");

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatUnitLabel(value: number | null | undefined): string | null {
  const formatted = formatNumber(value);
  if (formatted === "—") return null;
  return `${formatted} ${formatted === "1" ? "unit" : "units"}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function datetimeLocalFromIso(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formValue(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

function dealPathFormFromState(dealPath: UiV2DealPathState | null | undefined): DealPathFormState {
  return {
    tourScheduledAt: datetimeLocalFromIso(dealPath?.tourScheduledAt),
    tourNotes: dealPath?.tourNotes ?? "",
    postTourDecision: dealPath?.postTourDecision ?? "pending",
    targetPrice: formValue(dealPath?.targetPrice),
    offerAmount: formValue(dealPath?.offerAmount),
    offerNotes: dealPath?.offerNotes ?? "",
    loiContingenciesText: (dealPath?.loiContingencies ?? []).join("\n"),
    loiContingencyNotes: dealPath?.loiContingencyNotes ?? "",
    rejectionReasonCode: dealPath?.rejectionReasonCode ?? "",
    rejectionNotes: dealPath?.rejectionNotes ?? "",
  };
}

function dealPathPayload(form: DealPathFormState): Record<string, unknown> {
  return {
    tourScheduledAt: form.tourScheduledAt.trim() || null,
    tourNotes: form.tourNotes.trim() || null,
    postTourDecision: form.postTourDecision,
    targetPrice: form.targetPrice.trim() || null,
    offerAmount: form.offerAmount.trim() || null,
    offerNotes: form.offerNotes.trim() || null,
    loiContingencies: form.loiContingenciesText
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean),
    loiContingencyNotes: form.loiContingencyNotes.trim() || null,
    rejectionReasonCode: form.postTourDecision === "reject" ? form.rejectionReasonCode : null,
    rejectionNotes: form.postTourDecision === "reject" ? form.rejectionNotes.trim() || null : null,
  };
}

function needsTourInputs(row: DealFlowRow): boolean {
  return row.status === "tour_completed_awaiting_inputs" && (row.dealPath?.postTourDecision == null || row.dealPath.postTourDecision === "pending");
}

function hasScheduledTour(row: ProgressRow): boolean {
  return Boolean(row.dealPath?.tourScheduledAt);
}

function labelFromKey(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const normalized = value.trim().toLowerCase();
  const specialLabels: Record<string, string> = {
    awaiting_broker: "OM Requested",
    contract_signed: "Contract Signed",
    deal_closed: "Deal Closed",
    dossier_generated: "Dossier Generated",
    loopnet: "LoopNet",
    offer_review: "LOI Offered",
    om_not_requested: "OM Not Requested",
    om_received: "OM Received",
    streeteasy: "StreetEasy",
    tour_requested: "Tour Requested",
    tour_scheduled: "Tour Scheduled",
    tour_completed_awaiting_inputs: "Tour Completed",
  };
  if (specialLabels[normalized]) return specialLabels[normalized];
  return normalized
    .split("_")
    .flatMap((part) => part.split("-"))
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function tagClass(tag: string): string {
  const normalized = normalizeTag(tag);
  if (["high_priority", "mtr_candidate", "tax_advantage", "below_replacement"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagOpportunity}`;
  }
  if (["broker_relationship", "follow_up", "partner_review", "toured"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagRelationship}`;
  }
  if (["needs_om", "needs_rent_roll", "needs_city_data", "om_requested"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagAction}`;
  }
  if (["distressed_seller", "rent_stab_risk", "duplicate", "rejected"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagRisk}`;
  }
  return `${styles.tagChip} ${styles.tagNeutral}`;
}

function sectionCount(summary: Summary | null, sectionId: string, fallback: number): number {
  if (!summary) return fallback;
  switch (sectionId) {
    case "saved":
      return summary.savedCount ?? fallback;
    case "underwriting":
      return summary.underwritingCount ?? fallback;
    case "outreach":
      return summary.outreachCount ?? fallback;
    case "awaiting_broker":
      return summary.awaitingBrokerCount ?? fallback;
    case "om_received":
      return summary.omReceivedCount ?? fallback;
    case "rejected":
      return summary.rejectedCount ?? fallback;
    default:
      return fallback;
  }
}

function normalizeSections(data: DealProgressResponse): ProgressSection[] {
  const byId = new Map((data.sections ?? []).map((section) => [section.id, section]));
  const tourRows = Array.isArray(byId.get("tour_scheduled")?.rows) ? byId.get("tour_scheduled")!.rows! : [];
  const known = SECTION_ORDER.map((base) => {
    const incoming = byId.get(base.id);
    const incomingRows = Array.isArray(incoming?.rows) ? incoming.rows : [];
    const rows =
      base.id === "tour_requested" && !byId.has("tour_requested")
        ? tourRows.filter((row) => !hasScheduledTour(row))
        : base.id === "tour_scheduled"
          ? incomingRows.filter(hasScheduledTour)
          : incomingRows;
    const count =
      base.id === "tour_requested" || base.id === "tour_scheduled"
        ? rows.length
        : sectionCount(data.summary ?? null, base.id, incoming?.count ?? rows.length);
    return {
      ...base,
      ...incoming,
      label: base.id === "tour_scheduled" ? base.label : incoming?.label || base.label,
      count,
      rows,
    };
  }).filter((section) => section.id !== "om_not_requested" || byId.has("om_not_requested"));
  const extras = (data.sections ?? []).filter((section) => !SECTION_ORDER.some((base) => base.id === section.id));
  return [...known, ...extras];
}

function normalizeSavedDeals(data: SavedDealsResponse): SavedDealRow[] {
  const rows = data.savedDeals?.rows;
  if (Array.isArray(rows)) return rows;
  return (data.savedDeals?.deals ?? [])
    .filter((deal) => typeof deal.propertyId === "string")
    .map((deal) => ({
      propertyId: deal.propertyId as string,
      savedDeal: deal,
      status: deal.dealStatus ?? "saved",
      updatedAt: deal.createdAt ?? null,
    }));
}

function searchableText(row: ProgressRow): string {
  return [
    row.propertyId,
    row.canonicalAddress,
    row.displayAddress,
    row.source,
    row.status,
    row.savedDealStatus,
    row.omStatus,
    ...(row.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function searchableSavedDealText(row: SavedDealRow): string {
  return [
    row.propertyId,
    row.canonicalAddress,
    row.displayAddress,
    row.source,
    row.status,
    row.savedDeal?.dealStatus,
    row.omStatus,
    ...(row.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function statusClass(status: string | null | undefined): string {
  if (status === "rejected") return `${styles.statusPill} ${styles.statusDanger}`;
  if (
    status === "saved" ||
    status === "om_received" ||
    status === "dossier_generated" ||
    status === "contract_signed" ||
    status === "deal_closed"
  ) {
    return `${styles.statusPill} ${styles.statusSuccess}`;
  }
  if (status === "underwriting" || status === "offer_review" || status === "negotiation" || status === "awaiting_broker") {
    return `${styles.statusPill} ${styles.statusWarning}`;
  }
  if (status === "outreach" || status === "screening") return `${styles.statusPill} ${styles.statusInfo}`;
  return `${styles.statusPill} ${styles.statusNeutral}`;
}

function scoreClass(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return `${styles.scorePill} ${styles.scoreEmpty}`;
  if (score >= 70) return `${styles.scorePill} ${styles.scoreStrong}`;
  if (score >= 50) return `${styles.scorePill} ${styles.scoreWatch}`;
  return `${styles.scorePill} ${styles.scoreWeak}`;
}

function rowStatus(row: DealFlowRow): string {
  return row.status || row.savedDeal?.dealStatus || "saved";
}

function savedDealHasUploadedOm(row: DealFlowRow): boolean {
  if (row.hasOm === true) return true;
  const normalized = String(row.omStatus ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return ["available", "received", "om_received", "uploaded", "reviewed", "promoted", "ready"].includes(normalized);
}

function moveStatusForRow(row: DealFlowRow): UiV2PipelineStatus {
  const status = rowStatus(row);
  if (status === "dossier_generated" || status === "om_received") return "underwriting";
  if (status === "outreach") return "awaiting_broker";
  if (status === "interesting" || status === "screening" || status === "new") return "saved";
  if (status === "archived") return "deal_closed";
  if (status === "rejected") return "saved";
  return MOVE_STAGE_OPTIONS.some((option) => option.targetStatus === status)
    ? (status as UiV2PipelineStatus)
    : "saved";
}

function moveLabelForStatus(status: UiV2PipelineStatus): string {
  return MOVE_STAGE_OPTIONS.find((option) => option.targetStatus === status)?.moveLabel ?? labelFromKey(status);
}

function buildSavedStatusSections(rows: SavedDealRow[]): SavedDealSection[] {
  const claimed = new Set<string>();
  const sections = SAVED_STATUS_GROUPS.map((group) => {
    const matches = rows.filter((row) => group.statuses.includes(rowStatus(row)));
    matches.forEach((row) => claimed.add(row.propertyId));
    return {
      id: group.id,
      label: group.label,
      description: group.description,
      rows: matches,
      targetStatus: group.targetStatus,
      moveLabel: group.moveLabel,
    };
  });
  const otherRows = rows.filter((row) => !claimed.has(row.propertyId));
  return otherRows.length > 0
    ? [...sections, { id: "other", label: "Other Saved", description: "Saved deals outside the standard stages.", rows: otherRows }]
    : sections;
}

function buildSavedTagSections(rows: SavedDealRow[]): SavedDealSection[] {
  const byTag = new Map<string, SavedDealRow[]>();
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      const trimmed = tag.trim();
      if (!trimmed) continue;
      const current = byTag.get(trimmed) ?? [];
      current.push(row);
      byTag.set(trimmed, current);
    }
  }
  return [...byTag.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([tag, tagRows]) => ({
      id: tag,
      label: labelFromKey(tag),
      rows: tagRows,
    }));
}

async function patchSavedDealStatus(propertyId: string, nextStatus: UiV2PipelineStatus): Promise<void> {
  const response = await fetch(`${API_BASE}/api/ui-v2/properties/${propertyId}/status`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: nextStatus, source: "progress_table" }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
  if (!response.ok) throw new Error(data.error || data.details || "Failed to move deal stage.");
}

async function refreshPropertyOmAnalysis(propertyId: string): Promise<OmRefreshResponse> {
  const response = await fetch(`${API_BASE}/api/properties/${propertyId}/refresh-om-financials`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoPromote: true }),
  });
  const data = (await response.json().catch(() => ({}))) as OmRefreshResponse;
  if (!response.ok) throw new Error(data.error || data.details || "Failed to refresh OM analysis.");
  return data;
}

async function rerunPropertyDossier(propertyId: string): Promise<DossierGenerateResponse> {
  const response = await fetch(`${API_BASE}/api/dossier/generate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyId }),
  });
  const data = (await response.json().catch(() => ({}))) as DossierGenerateResponse;
  if (!response.ok) throw new Error(data.error || data.details || "Failed to rerun dossier.");
  return data;
}

function ProgressPageContent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sections, setSections] = useState<ProgressSection[]>(SECTION_ORDER);
  const [savedDealRows, setSavedDealRows] = useState<SavedDealRow[]>([]);
  const [rejectionReasons, setRejectionReasons] = useState<Array<{ reasonCode?: string; count?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageMoveBusy, setStageMoveBusy] = useState<string | null>(null);
  const [bulkWorkflowBusy, setBulkWorkflowBusy] = useState<typeof OM_ANALYSIS_BULK_ID | typeof DOSSIER_BULK_ID | null>(null);
  const [bulkTargetStatus, setBulkTargetStatus] = useState<UiV2PipelineStatus>("awaiting_broker");
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(() => new Set());
  const [draggedDeal, setDraggedDeal] = useState<DealFlowRow | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [editingDealPathId, setEditingDealPathId] = useState<string | null>(null);
  const [dealPathForms, setDealPathForms] = useState<Record<string, DealPathFormState>>({});
  const [dealPathSavingId, setDealPathSavingId] = useState<string | null>(null);
  const [rejectState, setRejectState] = useState<RejectFormState | null>(null);
  const [rejectSavingId, setRejectSavingId] = useState<string | null>(null);

  const loadProgress = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const progressResponse = await fetch(`${API_BASE}/api/ui-v2/deal-progress`);
      const progressData = (await progressResponse.json().catch(() => ({}))) as DealProgressResponse;
      if (!progressResponse.ok) throw new Error(progressData.error || progressData.details || "Failed to load deal progress");
      setSummary(progressData.summary ?? null);
      setSections(normalizeSections(progressData));
      setSavedDealRows([]);
      setRejectionReasons(Array.isArray(progressData.rejectionReasons) ? progressData.rejectionReasons : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deal progress");
      setSummary(null);
      setSections(SECTION_ORDER);
      setSavedDealRows([]);
      setRejectionReasons([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const moveSavedDeals = useCallback(
    async (rows: DealFlowRow[], nextStatus: UiV2PipelineStatus, options?: { clearSelection?: boolean }) => {
      const uniqueRows = [...new Map(rows.map((row) => [row.propertyId, row])).values()];
      const rowsToMove = uniqueRows.filter((row) => moveStatusForRow(row) !== nextStatus);
      if (rowsToMove.length === 0) return;
      setStageMoveBusy(rowsToMove.length === 1 ? rowsToMove[0].propertyId : BULK_STAGE_MOVE_ID);
      setError(null);
      try {
        const results = await Promise.all(
          rowsToMove.map(async (row) => {
            try {
              await patchSavedDealStatus(row.propertyId, nextStatus);
              return { propertyId: row.propertyId, ok: true as const };
            } catch (err) {
              return {
                propertyId: row.propertyId,
                ok: false as const,
                message: err instanceof Error ? err.message : "Failed to move deal stage.",
              };
            }
          })
        );
        const movedIds = new Set(results.filter((result) => result.ok).map((result) => result.propertyId));
        if (movedIds.size > 0) {
          if (options?.clearSelection) {
            setSelectedDealIds((current) => {
              const next = new Set(current);
              movedIds.forEach((propertyId) => next.delete(propertyId));
              return next;
            });
          }
          await loadProgress("refresh");
        }
        const failures = results.filter((result) => !result.ok);
        if (failures.length > 0) {
          const label = moveLabelForStatus(nextStatus);
          setError(`${failures.length} of ${rowsToMove.length} selected deal${rowsToMove.length === 1 ? "" : "s"} could not move to ${label}.`);
        }
      } finally {
        setStageMoveBusy(null);
      }
    },
    [loadProgress]
  );

  const dropSavedDeal = useCallback(
    (section: SavedDealSection) => {
      const row = draggedDeal;
      setDraggedDeal(null);
      setDragOverSectionId(null);
      if (!row || !section.targetStatus) return;
      const movingSelection = selectedDealIds.has(row.propertyId);
      const loadedRows = sections.flatMap((progressSection) => progressSection.rows ?? []);
      const rowsToMove = movingSelection ? loadedRows.filter((deal) => selectedDealIds.has(deal.propertyId)) : [row];
      void moveSavedDeals(rowsToMove, section.targetStatus, { clearSelection: movingSelection });
    },
    [draggedDeal, moveSavedDeals, sections, selectedDealIds]
  );

  const filteredSections = useMemo(() => {
    if (!query) return sections;
    return sections.map((section) => ({
      ...section,
      rows: (section.rows ?? []).filter((row) => searchableText(row).includes(query)),
    }));
  }, [query, sections]);

  const flowRows = useMemo(() => sections.flatMap((section) => section.rows ?? []), [sections]);
  const filteredFlowRows = useMemo(() => filteredSections.flatMap((section) => section.rows ?? []), [filteredSections]);
  const editingDealPathRow = useMemo(
    () => flowRows.find((row) => row.propertyId === editingDealPathId) ?? null,
    [editingDealPathId, flowRows]
  );

  useEffect(() => {
    setSelectedDealIds((current) => {
      if (current.size === 0) return current;
      const validIds = new Set(flowRows.map((row) => row.propertyId));
      const next = new Set([...current].filter((propertyId) => validIds.has(propertyId)));
      return next.size === current.size ? current : next;
    });
  }, [flowRows]);

  const selectedSavedDeals = useMemo(
    () => flowRows.filter((row) => selectedDealIds.has(row.propertyId)),
    [flowRows, selectedDealIds]
  );
  const selectedSavedDealsWithOm = useMemo(
    () => selectedSavedDeals.filter(savedDealHasUploadedOm),
    [selectedSavedDeals]
  );
  const visibleSavedDealIds = useMemo(() => filteredFlowRows.map((row) => row.propertyId), [filteredFlowRows]);
  const allVisibleSelected =
    visibleSavedDealIds.length > 0 && visibleSavedDealIds.every((propertyId) => selectedDealIds.has(propertyId));
  const someVisibleSelected =
    visibleSavedDealIds.length > 0 && visibleSavedDealIds.some((propertyId) => selectedDealIds.has(propertyId));
  const bulkMoveBusy = stageMoveBusy === BULK_STAGE_MOVE_ID;
  const bulkControlsBusy = bulkMoveBusy || bulkWorkflowBusy != null;

  const toggleSavedDealSelected = useCallback((propertyId: string, selected: boolean) => {
    setSelectedDealIds((current) => {
      const next = new Set(current);
      if (selected) next.add(propertyId);
      else next.delete(propertyId);
      return next;
    });
  }, []);

  const toggleVisibleSavedDeals = useCallback(() => {
    setSelectedDealIds((current) => {
      const next = new Set(current);
      if (visibleSavedDealIds.every((propertyId) => next.has(propertyId))) {
        visibleSavedDealIds.forEach((propertyId) => next.delete(propertyId));
      } else {
        visibleSavedDealIds.forEach((propertyId) => next.add(propertyId));
      }
      return next;
    });
  }, [visibleSavedDealIds]);

  const startDealPathEdit = useCallback((row: DealFlowRow) => {
    setEditingDealPathId(row.propertyId);
    setDealPathForms((current) => ({
      ...current,
      [row.propertyId]: current[row.propertyId] ?? dealPathFormFromState(row.dealPath),
    }));
  }, []);

  const updateDealPathField = useCallback(
    <K extends keyof DealPathFormState>(propertyId: string, field: K, value: DealPathFormState[K]) => {
      setDealPathForms((current) => ({
        ...current,
        [propertyId]: {
          ...(current[propertyId] ?? dealPathFormFromState(flowRows.find((row) => row.propertyId === propertyId)?.dealPath)),
          [field]: value,
        },
      }));
    },
    [flowRows]
  );

  const saveDealPathForRow = useCallback(
    async (row: DealFlowRow, event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = dealPathForms[row.propertyId] ?? dealPathFormFromState(row.dealPath);
      if (form.postTourDecision === "reject" && !form.rejectionReasonCode) {
        setError("Choose a rejection reason before rejecting after a tour.");
        return;
      }
      setDealPathSavingId(row.propertyId);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(`${API_BASE}/api/ui-v2/properties/${row.propertyId}/deal-path`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealPath: dealPathPayload(form),
            actorName: "progress_table",
            source: "progress_table",
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
        if (!response.ok) {
          throw new Error(data.error || data.details || "Failed to update deal path.");
        }
        setNotice(form.postTourDecision === "reject" ? "Property rejected after tour." : "Deal path updated.");
        setEditingDealPathId(null);
        await loadProgress("refresh");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update deal path.");
      } finally {
        setDealPathSavingId(null);
      }
    },
    [dealPathForms, loadProgress]
  );

  const startReject = useCallback((row: DealFlowRow) => {
    setRejectState({
      propertyId: row.propertyId,
      address: row.displayAddress || row.canonicalAddress || row.propertyId,
      reasonCode: "",
      note: "",
    });
  }, []);

  const submitReject = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!rejectState) return;
      if (!rejectState.reasonCode) {
        setError("Choose a rejection reason before rejecting this property.");
        return;
      }
      setRejectSavingId(rejectState.propertyId);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(`${API_BASE}/api/ui-v2/properties/${encodeURIComponent(rejectState.propertyId)}/reject`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "rejected",
            rejection: {
              reasonCode: rejectState.reasonCode,
              note: rejectState.note.trim() || null,
            },
            actorName: "progress_table",
            source: "progress_table",
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
        if (!response.ok) throw new Error(data.error || data.details || "Failed to reject property.");
        setSelectedDealIds((current) => {
          const next = new Set(current);
          next.delete(rejectState.propertyId);
          return next;
        });
        setRejectState(null);
        setNotice("Property rejected.");
        await loadProgress("refresh");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reject property.");
      } finally {
        setRejectSavingId(null);
      }
    },
    [loadProgress, rejectState]
  );

  const refreshSelectedOmAnalysis = useCallback(async () => {
    if (selectedSavedDeals.length === 0) return;
    if (selectedSavedDealsWithOm.length === 0) {
      setError("Select at least one saved deal with an uploaded OM before refreshing OM analysis.");
      return;
    }
    const skipped = selectedSavedDeals.length - selectedSavedDealsWithOm.length;
    let completed = 0;
    const failures: Array<{ address: string; message: string }> = [];
    setBulkWorkflowBusy(OM_ANALYSIS_BULK_ID);
    setNotice(
      `Updating OM analysis for ${selectedSavedDealsWithOm.length} deal${selectedSavedDealsWithOm.length === 1 ? "" : "s"}${
        skipped > 0 ? `; ${skipped} selected without OM skipped` : ""
      }...`
    );
    setError(null);
    try {
      for (let index = 0; index < selectedSavedDealsWithOm.length; index++) {
        const row = selectedSavedDealsWithOm[index]!;
        const address = row.displayAddress ?? row.canonicalAddress ?? row.propertyId;
        setNotice(`Updating OM analysis ${index + 1} of ${selectedSavedDealsWithOm.length}: ${address}`);
        try {
          await refreshPropertyOmAnalysis(row.propertyId);
          completed++;
        } catch (err) {
          failures.push({
            address,
            message: err instanceof Error ? err.message : "Failed to refresh OM analysis.",
          });
        }
      }
      await loadProgress("refresh");
      const skippedMessage = skipped > 0 ? ` ${skipped} selected without OM skipped.` : "";
      setNotice(
        failures.length === 0
          ? `OM analysis updated for ${completed} deal${completed === 1 ? "" : "s"}.${skippedMessage}`
          : `OM analysis updated for ${completed} of ${selectedSavedDealsWithOm.length} eligible deals.${skippedMessage}`
      );
      if (failures.length > 0) {
        setError(
          `${failures.length} OM analysis refresh${failures.length === 1 ? "" : "es"} failed. First issue: ${
            failures[0]!.address
          } - ${failures[0]!.message}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh selected OM analysis.");
    } finally {
      setBulkWorkflowBusy(null);
    }
  }, [loadProgress, selectedSavedDeals, selectedSavedDealsWithOm]);

  const rerunSelectedDossiers = useCallback(async () => {
    if (selectedSavedDeals.length === 0) return;
    if (selectedSavedDealsWithOm.length === 0) {
      setError("Select at least one saved deal with an uploaded OM before rerunning dossiers.");
      return;
    }
    const skipped = selectedSavedDeals.length - selectedSavedDealsWithOm.length;
    let completed = 0;
    const failures: Array<{ address: string; message: string }> = [];
    setBulkWorkflowBusy(DOSSIER_BULK_ID);
    setNotice(
      `Rerunning dossiers for ${selectedSavedDealsWithOm.length} deal${selectedSavedDealsWithOm.length === 1 ? "" : "s"}${
        skipped > 0 ? `; ${skipped} selected without OM skipped` : ""
      }...`
    );
    setError(null);
    try {
      for (let index = 0; index < selectedSavedDealsWithOm.length; index++) {
        const row = selectedSavedDealsWithOm[index]!;
        const address = row.displayAddress ?? row.canonicalAddress ?? row.propertyId;
        setNotice(`Rerunning dossiers ${index + 1} of ${selectedSavedDealsWithOm.length}: ${address}`);
        try {
          await rerunPropertyDossier(row.propertyId);
          completed++;
        } catch (err) {
          failures.push({
            address,
            message: err instanceof Error ? err.message : "Failed to rerun dossier.",
          });
        }
      }
      await loadProgress("refresh");
      const skippedMessage = skipped > 0 ? ` ${skipped} selected without OM skipped.` : "";
      setNotice(
        failures.length === 0
          ? `Dossiers rerun for ${completed} deal${completed === 1 ? "" : "s"}.${skippedMessage}`
          : `Dossiers rerun for ${completed} of ${selectedSavedDealsWithOm.length} eligible deals.${skippedMessage}`
      );
      if (failures.length > 0) {
        setError(
          `${failures.length} dossier rerun${failures.length === 1 ? "" : "s"} failed. First issue: ${
            failures[0]!.address
          } - ${failures[0]!.message}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rerun selected dossiers.");
    } finally {
      setBulkWorkflowBusy(null);
    }
  }, [loadProgress, selectedSavedDeals, selectedSavedDealsWithOm]);

  const savedStatusSections = useMemo(
    () =>
      filteredSections.map((section) => {
        const group = SAVED_STATUS_GROUPS.find((candidate) => candidate.id === section.id);
        return {
          id: section.id,
          label: section.label || group?.label || labelFromKey(section.id),
          description: group?.description,
          rows: (section.rows ?? []) as DealFlowRow[],
          targetStatus: group?.targetStatus,
          moveLabel: group?.moveLabel,
        };
      }),
    [filteredSections]
  );
  const savedStageCounts = useMemo(
    () => new Map(filteredSections.map((section) => [section.id, section.count ?? section.rows?.length ?? 0])),
    [filteredSections]
  );

  const visibleRowCount = useMemo(
    () => filteredSections.reduce((sum, section) => sum + (section.rows?.length ?? 0), 0),
    [filteredSections]
  );

  const totalCount = flowRows.length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Deal movement</p>
          <h1 className={styles.title}>Progress</h1>
          <p className={styles.subtitle}>
            Track OM requests, underwriting, tours, LOIs, negotiation, diligence, and close without leaving the progress board.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/saved" className={styles.secondaryLink}>Saved Deals</Link>
          <Link href="/pipeline" className={styles.primaryLink}>Pipeline</Link>
        </div>
      </header>

      {query ? (
        <div className={styles.filterNotice}>
          <span>Filtered by global search</span>
          <strong>{searchParams.get("q")}</strong>
          <span>{visibleRowCount} visible loaded row{visibleRowCount === 1 ? "" : "s"}</span>
        </div>
      ) : null}

      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <section className={styles.metrics} aria-label="Deal progress summary">
        {savedStatusSections.map((section) => (
          <article className={styles.metric} key={section.id}>
            <span>{section.label}</span>
            <strong>{savedStageCounts.get(section.id) ?? section.rows.length}</strong>
          </article>
        ))}
      </section>

      <section className={styles.savedFlowPanel} aria-label="Deal path by status">
        <div className={styles.savedFlowHeader}>
          <div>
            <h2>Deal Path by Status</h2>
            <p>
              {filteredFlowRows.length} loaded propert{filteredFlowRows.length === 1 ? "y" : "ies"} · Updated {formatDate(summary?.updatedAt)}
            </p>
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void loadProgress("refresh")}
            disabled={loading || refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className={styles.bulkToolbar} aria-label="Bulk stage controls">
          <label className={styles.bulkCheck}>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              aria-checked={allVisibleSelected ? "true" : someVisibleSelected ? "mixed" : "false"}
              disabled={filteredFlowRows.length === 0 || bulkControlsBusy}
              onChange={toggleVisibleSavedDeals}
            />
            <span>{allVisibleSelected ? "Unselect visible" : "Select visible"}</span>
          </label>
          <strong>{selectedSavedDeals.length} selected</strong>
          <div className={styles.bulkControls}>
            <select
              className={styles.bulkStageSelect}
              aria-label="Stage for selected deals"
              value={bulkTargetStatus}
              disabled={bulkControlsBusy}
              onChange={(event) => setBulkTargetStatus(event.target.value as UiV2PipelineStatus)}
            >
              {MOVE_STAGE_OPTIONS.map((option) => (
                <option key={option.targetStatus} value={option.targetStatus}>
                  {option.moveLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.bulkMoveButton}
              disabled={selectedSavedDeals.length === 0 || bulkControlsBusy}
              onClick={() => void moveSavedDeals(selectedSavedDeals, bulkTargetStatus, { clearSelection: true })}
            >
              {bulkMoveBusy ? "Moving..." : "Move selected"}
            </button>
            <button
              type="button"
              className={styles.bulkWorkflowButton}
              title={
                selectedSavedDealsWithOm.length === 0
                  ? "Select at least one saved deal with an uploaded OM."
                  : "Refresh and promote OM extraction for selected saved deals with uploaded OMs."
              }
              disabled={selectedSavedDealsWithOm.length === 0 || bulkControlsBusy}
              onClick={() => void refreshSelectedOmAnalysis()}
            >
              {bulkWorkflowBusy === OM_ANALYSIS_BULK_ID ? "Updating OM..." : "Update OM analysis"}
            </button>
            <button
              type="button"
              className={styles.bulkWorkflowButton}
              title={
                selectedSavedDealsWithOm.length === 0
                  ? "Select at least one saved deal with an uploaded OM."
                  : "Regenerate deal dossier PDFs and Excel workbooks for selected saved deals with uploaded OMs."
              }
              disabled={selectedSavedDealsWithOm.length === 0 || bulkControlsBusy}
              onClick={() => void rerunSelectedDossiers()}
            >
              {bulkWorkflowBusy === DOSSIER_BULK_ID ? "Rerunning..." : "Rerun dossiers"}
            </button>
            <button
              type="button"
              className={styles.bulkClearButton}
              disabled={selectedSavedDeals.length === 0 || bulkControlsBusy}
              onClick={() => setSelectedDealIds(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
        <div className={styles.flowSections}>
          {savedStatusSections.map((section) => (
            <SavedDealMiniSection
              key={section.id}
              section={section}
              loading={loading}
              enableMoves
              movingPropertyId={stageMoveBusy}
              selectedDealIds={selectedDealIds}
              bulkMoving={bulkControlsBusy}
              dragOver={dragOverSectionId === section.id}
              onToggleSelected={toggleSavedDealSelected}
              onDragStartDeal={setDraggedDeal}
              onDragEndDeal={() => {
                setDraggedDeal(null);
                setDragOverSectionId(null);
              }}
              onDragOverSection={(event) => {
                if (!section.targetStatus || draggedDeal == null) return;
                event.preventDefault();
                setDragOverSectionId(section.id);
              }}
              onDropOnSection={() => dropSavedDeal(section)}
              editingPropertyId={editingDealPathId}
              onStartDealPathEdit={startDealPathEdit}
              onCancelDealPathEdit={() => setEditingDealPathId(null)}
              onStartReject={startReject}
            />
          ))}
        </div>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      {rejectionReasons.length > 0 ? (
        <section className={styles.reasonStrip} aria-label="Rejection reason counts">
          <strong className={styles.reasonStripLabel}>Rejected properties:</strong>
          {rejectionReasons.slice(0, 8).map((reason) => (
            <span key={reason.reasonCode || "unknown"}>
              {labelFromKey(reason.reasonCode)} <strong>{reason.count ?? 0}</strong>
            </span>
          ))}
        </section>
      ) : null}

      {editingDealPathRow ? (
        <DealPathModal
          row={editingDealPathRow}
          form={dealPathForms[editingDealPathRow.propertyId] ?? dealPathFormFromState(editingDealPathRow.dealPath)}
          saving={dealPathSavingId === editingDealPathRow.propertyId}
          onUpdate={updateDealPathField}
          onCancel={() => setEditingDealPathId(null)}
          onSave={saveDealPathForRow}
        />
      ) : null}

      {rejectState ? (
        <RejectDealModal
          state={rejectState}
          saving={rejectSavingId === rejectState.propertyId}
          onChange={setRejectState}
          onCancel={() => setRejectState(null)}
          onSubmit={submitReject}
        />
      ) : null}

    </div>
  );
}

function DealPathModal({
  row,
  form,
  saving,
  onUpdate,
  onCancel,
  onSave,
}: {
  row: DealFlowRow;
  form: DealPathFormState;
  saving: boolean;
  onUpdate: <K extends keyof DealPathFormState>(propertyId: string, field: K, value: DealPathFormState[K]) => void;
  onCancel?: () => void;
  onSave: (row: DealFlowRow, event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onCancel}>
      <form
        className={styles.dealPathModal}
        onSubmit={(event) => onSave(row, event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalKicker}>Deal path</span>
            <h2>{row.displayAddress || row.canonicalAddress || row.propertyId}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={onCancel} aria-label="Close deal path modal">
            x
          </button>
        </div>
        <div className={styles.dealPathModalGrid}>
          <label>
            <span>Tour date and time</span>
            <input
              type="datetime-local"
              value={form.tourScheduledAt}
              onChange={(event) => onUpdate(row.propertyId, "tourScheduledAt", event.target.value)}
            />
          </label>
          <label>
            <span>Post-tour decision</span>
            <select
              value={form.postTourDecision}
              onChange={(event) => onUpdate(row.propertyId, "postTourDecision", event.target.value as UiV2DealPathDecision)}
            >
              <option value="pending">Pending inputs</option>
              <option value="move_forward">Move forward with offer</option>
              <option value="need_more_info">Need more information</option>
              <option value="reject">Reject after tour</option>
            </select>
          </label>
          <label>
            <span>Target price</span>
            <input
              inputMode="numeric"
              value={form.targetPrice}
              onChange={(event) => onUpdate(row.propertyId, "targetPrice", event.target.value)}
              placeholder="Target pricing"
            />
          </label>
          <label>
            <span>Offer amount</span>
            <input
              inputMode="numeric"
              value={form.offerAmount}
              onChange={(event) => onUpdate(row.propertyId, "offerAmount", event.target.value)}
              placeholder="LOI offer"
            />
          </label>
          <label className={styles.dealPathWideField}>
            <span>Tour notes</span>
            <textarea
              value={form.tourNotes}
              onChange={(event) => onUpdate(row.propertyId, "tourNotes", event.target.value)}
              placeholder="Tour takeaways, condition, broker comments, follow-up questions"
            />
          </label>
          <label className={styles.dealPathWideField}>
            <span>Offer notes</span>
            <textarea
              value={form.offerNotes}
              onChange={(event) => onUpdate(row.propertyId, "offerNotes", event.target.value)}
              placeholder="Rationale for offer, pricing read, partner feedback"
            />
          </label>
          <label className={styles.dealPathWideField}>
            <span>LOI contingencies</span>
            <textarea
              value={form.loiContingenciesText}
              onChange={(event) => onUpdate(row.propertyId, "loiContingenciesText", event.target.value)}
              placeholder="Financing contingency, diligence period, rent roll verification"
            />
          </label>
          <label className={styles.dealPathWideField}>
            <span>LOI contingency notes</span>
            <textarea
              value={form.loiContingencyNotes}
              onChange={(event) => onUpdate(row.propertyId, "loiContingencyNotes", event.target.value)}
              placeholder="Timing, diligence needs, third-party reports, deposit terms"
            />
          </label>
          {form.postTourDecision === "reject" ? (
            <>
              <label>
                <span>Reject reason</span>
                <select
                  value={form.rejectionReasonCode}
                  onChange={(event) => onUpdate(row.propertyId, "rejectionReasonCode", event.target.value as UiV2RejectionReasonCode | "")}
                  required
                >
                  <option value="">Choose reason</option>
                  {UI_V2_REJECTION_REASON_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.dealPathWideField}>
                <span>Reject notes</span>
                <textarea
                  value={form.rejectionNotes}
                  onChange={(event) => onUpdate(row.propertyId, "rejectionNotes", event.target.value)}
                  placeholder="Why we are passing after the tour"
                />
              </label>
            </>
          ) : null}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.bulkClearButton} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.bulkMoveButton} disabled={saving}>
            {saving ? "Saving..." : form.postTourDecision === "reject" ? "Save rejection" : "Save deal path"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RejectDealModal({
  state,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  state: RejectFormState;
  saving: boolean;
  onChange: (state: RejectFormState) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onCancel}>
      <form className={styles.rejectModal} onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalKicker}>Reject property</span>
            <h2>{state.address}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={onCancel} aria-label="Close rejection modal">
            x
          </button>
        </div>
        <label>
          <span>Reason</span>
          <select
            value={state.reasonCode}
            onChange={(event) => onChange({ ...state, reasonCode: event.target.value as UiV2RejectionReasonCode | "" })}
            required
          >
            <option value="">Select reason</option>
            {UI_V2_REJECTION_REASON_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Note</span>
          <textarea
            value={state.note}
            onChange={(event) => onChange({ ...state, note: event.target.value })}
            rows={4}
            placeholder="Optional context"
          />
        </label>
        <div className={styles.modalActions}>
          <button className={styles.bulkClearButton} type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className={styles.rejectConfirmButton} type="submit" disabled={saving || !state.reasonCode}>
            {saving ? "Rejecting..." : "Reject"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<div className={styles.page}>Loading progress...</div>}>
      <ProgressPageContent />
    </Suspense>
  );
}

function cardMetricsForRow(row: DealFlowRow): Array<{ label: string; value: string }> {
  return [
    row.ltrYocPct != null ? { label: "LTR Yield", value: formatPercent(row.ltrYocPct) } : null,
    row.mtrYocPct != null ? { label: "MTR Yield", value: formatPercent(row.mtrYocPct) } : null,
    row.pricePerSqft != null ? { label: "$/SF", value: formatCurrency(row.pricePerSqft) } : null,
    row.sqft != null ? { label: "SF", value: formatCompactNumber(row.sqft) } : null,
    row.price != null ? { label: "Ask", value: formatCurrency(row.price) } : null,
    row.units != null ? { label: "Units", value: formatCompactNumber(row.units) } : null,
  ].filter((metric): metric is { label: string; value: string } => metric != null);
}

function SavedDealMiniSection({
  section,
  loading,
  compact = false,
  enableMoves = false,
  movingPropertyId = null,
  selectedDealIds,
  bulkMoving = false,
  dragOver = false,
  onToggleSelected,
  onDragStartDeal,
  onDragEndDeal,
  onDragOverSection,
  onDropOnSection,
  editingPropertyId = null,
  onStartDealPathEdit,
  onCancelDealPathEdit,
  onStartReject,
}: {
  section: SavedDealSection;
  loading: boolean;
  compact?: boolean;
  enableMoves?: boolean;
  movingPropertyId?: string | null;
  selectedDealIds?: Set<string>;
  bulkMoving?: boolean;
  dragOver?: boolean;
  onToggleSelected?: (propertyId: string, selected: boolean) => void;
  onDragStartDeal?: (row: DealFlowRow) => void;
  onDragEndDeal?: () => void;
  onDragOverSection?: (event: DragEvent<HTMLElement>) => void;
  onDropOnSection?: () => void;
  editingPropertyId?: string | null;
  onStartDealPathEdit?: (row: DealFlowRow) => void;
  onCancelDealPathEdit?: () => void;
  onStartReject?: (row: DealFlowRow) => void;
}) {
  const visibleRows = compact ? section.rows.slice(0, 5) : section.rows;
  return (
    <section
      className={`${styles.miniSection} ${dragOver ? styles.miniSectionDropTarget : ""}`}
      onDragOver={enableMoves ? onDragOverSection : undefined}
      onDrop={
        enableMoves
          ? (event) => {
              event.preventDefault();
              onDropOnSection?.();
            }
          : undefined
      }
    >
      <div className={styles.miniSectionHeader}>
        <div>
          <h3>{section.label}</h3>
          {section.description ? <p>{section.description}</p> : null}
        </div>
        <span>{section.rows.length}</span>
      </div>
      {loading ? (
        <div className={styles.emptyState}>Loading deal path...</div>
      ) : visibleRows.length === 0 ? (
        <div className={styles.emptyState}>No properties in this stage.</div>
      ) : (
        <div className={styles.miniRows}>
          {visibleRows.map((row) => {
            const selected = selectedDealIds?.has(row.propertyId) ?? false;
            const busy = bulkMoving || movingPropertyId === row.propertyId;
            const editing = editingPropertyId === row.propertyId;
            const tourNeedsInputs = needsTourInputs(row);
            const metrics = cardMetricsForRow(row);
            const statusLabel =
              section.id === "tour_requested"
                ? "Tour Requested"
                : section.id === "tour_scheduled"
                  ? "Tour Scheduled"
                  : labelFromKey(rowStatus(row));
            return (
              <article
                key={`${section.id}-${row.propertyId}`}
                className={`${styles.miniRow} ${selected ? styles.miniRowSelected : ""} ${busy ? styles.miniRowBusy : ""} ${
                  tourNeedsInputs ? styles.miniRowNeedsInput : ""
                }`}
                draggable={enableMoves && !compact && !busy}
                aria-selected={selected}
                onDragStart={
                  enableMoves
                    ? (event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", row.propertyId);
                        onDragStartDeal?.(row);
                      }
                    : undefined
                }
                onDragEnd={enableMoves ? onDragEndDeal : undefined}
              >
                <div className={styles.miniRowMain}>
                  {enableMoves ? (
                    <input
                      type="checkbox"
                      className={styles.miniSelect}
                      aria-label={`Select ${row.displayAddress || row.canonicalAddress || "property"}`}
                      checked={selected}
                      disabled={busy}
                      onChange={(event) => onToggleSelected?.(row.propertyId, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : null}
                  <Link href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`} className={styles.miniRowLink}>
                    <strong>{row.displayAddress || row.canonicalAddress || row.propertyId}</strong>
                    <span>{row.source ? labelFromKey(row.source) : "No source"}</span>
                  </Link>
                  <div className={styles.miniMeta}>
                    <span className={statusClass(rowStatus(row))}>{statusLabel}</span>
                    <small className={scoreClass(row.dealScore)}>
                      {row.dealScore == null ? "—" : Math.round(row.dealScore)}
                    </small>
                  </div>
                </div>
                {tourNeedsInputs ? <div className={styles.tourInputNotice}>Tour completed. Add notes, decision, and offer inputs.</div> : null}
                {metrics.length > 0 ? (
                  <div className={styles.cardMetrics} aria-label="Property metrics">
                    {metrics.map((metric) => (
                      <span key={metric.label}>
                        <small>{metric.label}</small>
                        <strong>{metric.value}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className={styles.miniRowDetails}>
                  <span>Tour: {formatDateTime(row.dealPath?.tourScheduledAt)}</span>
                  <span>Target: {formatCurrency(row.dealPath?.targetPrice)}</span>
                  <span>Offer: {formatCurrency(row.dealPath?.offerAmount)}</span>
                </div>
                <div className={styles.workflowBadges}>
                  <span className={row.hasOm ? styles.workflowBadgeReady : styles.workflowBadgeMuted}>OM</span>
                  <span className={row.hasComps ? styles.workflowBadgeReady : styles.workflowBadgeMuted}>Comps</span>
                  <span className={row.hasDossier ? styles.workflowBadgeReady : styles.workflowBadgeMuted}>Dossier</span>
                  {(row.openActionItemCount ?? 0) > 0 ? <span className={styles.workflowBadgeAction}>{row.openActionItemCount} item{row.openActionItemCount === 1 ? "" : "s"}</span> : null}
                </div>
                {!compact ? (
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={`${styles.cardActionButton} ${editing ? styles.cardActionActive : ""}`}
                      disabled={busy}
                      title={row.dealPath?.tourScheduledAt ? "Edit tour details" : "Schedule tour"}
                      onClick={() => (editing ? onCancelDealPathEdit?.() : onStartDealPathEdit?.(row))}
                    >
                      Tour
                    </button>
                    <button
                      type="button"
                      className={styles.cardActionButton}
                      disabled={busy}
                      title="Track LOI inputs"
                      onClick={() => onStartDealPathEdit?.(row)}
                    >
                      LOI
                    </button>
                    <button
                      type="button"
                      className={styles.cardRejectButton}
                      disabled={busy}
                      onClick={() => onStartReject?.(row)}
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
          {compact && section.rows.length > visibleRows.length ? (
            <div className={styles.moreRows}>+{section.rows.length - visibleRows.length} more</div>
          ) : null}
        </div>
      )}
    </section>
  );
}
