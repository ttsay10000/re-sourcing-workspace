"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ArrowRightLeft,
  CalendarCheck,
  Flag,
  KanbanSquare,
  ListTodo,
  Mail,
  MailPlus,
  MailWarning,
  MoreHorizontal,
  PenLine,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  DEAL_FLOW_STAGES,
  UI_V2_REJECTION_REASON_OPTIONS,
  type DealFlowRecommendationsResponse,
  type UiV2DealPathDecision,
  type UiV2DealPathState,
  type UiV2PipelineStatus,
  type UiV2RejectionReasonCode,
} from "@re-sourcing/contracts";
import { AgingChip, BrokerContactDialog, Button, Dialog, PageHeader, PromptMenu, PropertyThumb, StatCard } from "@/components/ui";
import { RecommendationStepper, type StepperKind, type StepperRow } from "./RecommendationStepper";
import { API_BASE, apiFetch } from "@/lib/api";
import { runBulkPropertyAction } from "@/lib/bulkPropertyActions";
import { scoreTone } from "@/lib/format";
import { useProcessBanner } from "@/components/ProcessBanner";
import {
  buildActionSummary,
  buildEmailQueue,
  columnStats,
  computeRowFlags,
  dataCompleteness,
  followUpState,
  formatDue,
  primaryCtaForRow,
  severityRank,
  stageAgeDays,
  type ActionFlag,
  type ActionSummaryItem,
  type EmailQueueItem,
  type FlagActionKind,
  type PrimaryCta,
} from "./actionFlags";
import { DealWizardDrawer, type DealPathFormState, type DealPathPromptMode } from "./DealWizardDrawer";
import { EmailQueuePanel, NeedsActionPanel, type NeedsActionRow } from "./QueuePanels";
import { RejectedPanel } from "./RejectedPanel";
import {
  formatCurrency,
  formatCompactNumber,
  formatDate,
  formatPercent,
  formatUnitLabel,
  formatWholeCurrency,
  labelFromKey,
  streetAddressOnly,
  todayDateInput,
} from "./format";
import styles from "./progress.module.css";

const BULK_STAGE_MOVE_ID = "__bulk_stage_move__";
const OM_ANALYSIS_BULK_ID = "__bulk_om_analysis__";
const DOSSIER_BULK_ID = "__bulk_dossier__";
const SNOOZE_STORAGE_KEY = "progress.emailSnoozes";

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
  savedDeal?: { id?: string; propertyId?: string; dealStatus?: string; createdAt?: string };
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
  underwritingReviewStatus?: string | null;
  underwritingReviewRequired?: boolean;
  underwritingReviewCompleted?: boolean;
  dealPath?: UiV2DealPathState | null;
  openActionItemCount?: number | null;
  neighborhood?: string | null;
  borough?: string | null;
  firstImageUrl?: string | null;
  brokerName?: string | null;
  brokerEmail?: string | null;
  stageEnteredAt?: string | null;
  latestOutreachAt?: string | null;
  updatedAt?: string | null;
};

type ProgressSection = {
  id:
    | "sourced"
    | "om_requested"
    | "underwriting_awaiting_review"
    | "underwriting_review_completed"
    | "tour_requested"
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

type RejectFormState = {
  propertyId: string;
  address: string;
  reasonCode: UiV2RejectionReasonCode | "";
  note: string;
};

type ComposerDialogState = {
  propertyId: string;
  address: string;
  /** "request_om" also moves the deal to OM Requested after queueing the email. */
  intent: "email" | "request_om";
  toAddress: string;
  subject: string;
  body: string;
  loading: boolean;
  submitting: boolean;
};

type BrokerEmailDialogState = {
  propertyId: string;
  address: string;
  name: string;
  email: string;
  saving: boolean;
};

type MoveStageDialogState = {
  propertyId: string;
  address: string;
  targetSectionId: string;
};

type RecommendationsState = {
  data: DealFlowRecommendationsResponse | null;
  loading: boolean;
};

type BoardFocus = {
  label: string;
  propertyIds: Set<string>;
  stageId: string | null;
};

type BoardMode = "board" | "needs_action" | "email_queue";

// Columns come from the shared deal-flow constant so this board, the home
// funnel, and stage chips elsewhere always show the same steps.
const SECTION_ORDER: ProgressSection[] = DEAL_FLOW_STAGES.map((stage) => ({
  id: stage.id,
  label: stage.label,
  count: 0,
  rows: [],
}));

// Stage membership/labels/targets come from the shared constant; only the
// board-specific helper copy lives here.
const STAGE_DESCRIPTIONS: Record<string, string> = {
  sourced: "Sourced properties where the OM request has not started.",
  om_requested: "OMs and related materials requested from brokers.",
  underwriting_awaiting_review: "OM uploaded or underwriting generated; user review is still required.",
  underwriting_review_completed: "User-reviewed underwriting and completed workups.",
  tour_requested: "Tour requested and waiting for a confirmed time.",
  tour_scheduled: "Tour date is confirmed; waiting on visit.",
  tour_completed_awaiting_inputs: "Tour date has passed; notes and post-tour decision needed.",
  offer_review: "Offer has been sent or is ready to track.",
  negotiation: "Pricing, terms, and counterparty negotiation.",
  contract_signed: "Contract signed with diligence underway.",
  deal_closed: "Closed deals and archived active pursuits.",
};

const SAVED_STATUS_GROUPS: SavedStatusGroup[] = DEAL_FLOW_STAGES.map((stage) => ({
  id: stage.id,
  label: stage.label,
  description: STAGE_DESCRIPTIONS[stage.id] ?? "",
  // The board's sourced/tour-scheduled columns intentionally claim no statuses
  // directly; the server assigns rows to them via deal-path state.
  statuses: stage.id === "sourced" || stage.id === "tour_scheduled" ? [] : [...stage.statuses],
  targetStatus: stage.targetStatus as UiV2PipelineStatus,
  moveLabel: stage.label,
}));

const MOVE_STAGE_OPTIONS = SAVED_STATUS_GROUPS
  .filter((group): group is MovableSavedStatusGroup =>
    Boolean(group.targetStatus && group.moveLabel)
  )
  .filter((group) => group.targetStatus !== "rejected");
const DEFAULT_BULK_STAGE_ID = MOVE_STAGE_OPTIONS[0]?.id ?? "om_requested";

function dateInputFromIso(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dateInputToPayload(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed;
}

/**
 * Price fields accept human input ("$4.5M", "950K", "4,500,000"). The API's
 * parser nulls anything it can't read, so unparseable input must be caught
 * client-side instead of silently dropping the value.
 */
function parsePriceInput(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^\$?([0-9][0-9.,]*)([kKmM])?$/.exec(trimmed.replace(/\s+/g, ""));
  if (!match) return "invalid";
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return "invalid";
  const multiplier = match[2] ? (match[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  return base * multiplier;
}

function priceInputToPayload(value: string): number | string | null {
  const parsed = parsePriceInput(value);
  // "invalid" falls through as the raw string so non-drawer callers keep
  // their current behavior (the API nulls what it cannot parse).
  return parsed === "invalid" ? value.trim() || null : parsed;
}

function formValue(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

function extractTourBrokerName(notes: string | null | undefined): string {
  if (!notes) return "";
  const match = /^Broker:\s*(.+)$/im.exec(notes);
  return match?.[1]?.trim() ?? "";
}

function stripTourBrokerLine(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes
    .split(/\r?\n/)
    .filter((line) => !/^Broker:\s*/i.test(line.trim()))
    .join("\n")
    .trim();
}

function extractLoiRecipientEmail(notes: string | null | undefined): string {
  if (!notes) return "";
  const match = /^LOI recipient:\s*(.+)$/im.exec(notes);
  return match?.[1]?.trim() ?? "";
}

function stripLoiRecipientLine(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes
    .split(/\r?\n/)
    .filter((line) => !/^LOI recipient:\s*/i.test(line.trim()))
    .join("\n")
    .trim();
}

function dealPathFormFromState(dealPath: UiV2DealPathState | null | undefined): DealPathFormState {
  const rawDealPath = dealPath as (UiV2DealPathState & { tourBrokerName?: string | null }) | null | undefined;
  return {
    tourScheduledAt: dateInputFromIso(dealPath?.tourScheduledAt),
    tourCompletedAt: dateInputFromIso(dealPath?.tourCompletedAt),
    tourBrokerName: rawDealPath?.tourBrokerName ?? extractTourBrokerName(dealPath?.tourNotes),
    tourNotes: stripTourBrokerLine(dealPath?.tourNotes),
    postTourDecision: dealPath?.postTourDecision ?? "pending",
    targetPrice: formValue(dealPath?.targetPrice),
    offerAmount: formValue(dealPath?.offerAmount),
    loiRecipientEmail: extractLoiRecipientEmail(dealPath?.offerNotes),
    offerNotes: stripLoiRecipientLine(dealPath?.offerNotes),
    loiContingenciesText: (dealPath?.loiContingencies ?? []).join("\n"),
    loiContingencyNotes: dealPath?.loiContingencyNotes ?? "",
    rejectionReasonCode: dealPath?.rejectionReasonCode ?? "",
    rejectionNotes: dealPath?.rejectionNotes ?? "",
  };
}

function dealPathFormForPrompt(dealPath: UiV2DealPathState | null | undefined, mode: DealPathPromptMode): DealPathFormState {
  const form = dealPathFormFromState(dealPath);
  if (mode === "tour_scheduled") {
    return {
      ...form,
      tourCompletedAt: "",
      postTourDecision: "pending",
      rejectionReasonCode: "",
      rejectionNotes: "",
    };
  }
  if (mode === "tour_completed") {
    return {
      ...form,
      tourCompletedAt: form.tourCompletedAt || todayDateInput(),
      postTourDecision: "pending",
      rejectionReasonCode: "",
      rejectionNotes: "",
    };
  }
  if (mode === "loi_offered") {
    return {
      ...form,
      postTourDecision: "move_forward",
      rejectionReasonCode: "",
      rejectionNotes: "",
    };
  }
  return form;
}

function dealPathPayload(form: DealPathFormState, mode: DealPathPromptMode = "general"): Record<string, unknown> {
  const tourBrokerName = form.tourBrokerName.trim();
  const tourNotes = form.tourNotes.trim();
  const loiRecipientEmail = form.loiRecipientEmail.trim();
  const offerNotes = form.offerNotes.trim();
  const postTourDecision: UiV2DealPathDecision = mode === "loi_offered" ? "move_forward" : form.postTourDecision;
  return {
    // Tour prompts pin the deal-path stage even when the date is missing: the
    // move still happens and the flag engine chases the gap (move-anyway).
    ...(mode === "tour_scheduled" ? { status: "tour_scheduled" } : {}),
    ...(mode === "tour_completed" && postTourDecision !== "reject" ? { status: "tour_completed_awaiting_inputs" } : {}),
    tourScheduledAt: dateInputToPayload(form.tourScheduledAt),
    tourCompletedAt: mode === "tour_scheduled" ? null : dateInputToPayload(form.tourCompletedAt),
    tourNotes: [tourBrokerName ? `Broker: ${tourBrokerName}` : null, tourNotes || null].filter(Boolean).join("\n") || null,
    postTourDecision,
    targetPrice: priceInputToPayload(form.targetPrice),
    offerAmount: priceInputToPayload(form.offerAmount),
    offerNotes: [loiRecipientEmail ? `LOI recipient: ${loiRecipientEmail}` : null, offerNotes || null].filter(Boolean).join("\n") || null,
    loiContingencies: form.loiContingenciesText
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean),
    loiContingencyNotes: form.loiContingencyNotes.trim() || null,
    rejectionReasonCode: postTourDecision === "reject" ? form.rejectionReasonCode : null,
    rejectionNotes: postTourDecision === "reject" ? form.rejectionNotes.trim() || null : null,
  };
}

function hasScheduledTour(row: ProgressRow): boolean {
  // A deal belongs in Tour Scheduled with a confirmed date OR when it was
  // explicitly moved there without one (deal-path status marker) — the
  // missing date is flagged for review instead of blocking the move.
  return Boolean(row.dealPath?.tourScheduledAt) || row.dealPath?.status === "tour_scheduled";
}

/**
 * True when the board auto-moved this deal to Tour Completed – Awaiting Inputs
 * because its scheduled tour date passed (no outcome recorded yet). Surfaced
 * on the card and in the drawer so the move is never silent.
 */
function isAutoMovedTourPassed(
  row: { dealPath?: UiV2DealPathState | null },
  sectionId: string | undefined
): boolean {
  const dealPath = row.dealPath;
  if (sectionId !== "tour_completed_awaiting_inputs" || !dealPath?.tourScheduledAt) return false;
  if (dealPath.tourCompletedAt != null) return false;
  if (dealPath.postTourDecision != null && dealPath.postTourDecision !== "pending") return false;
  const scheduledMs = Date.parse(dealPath.tourScheduledAt);
  return Number.isFinite(scheduledMs) && scheduledMs <= Date.now();
}

function sectionCount(summary: Summary | null, sectionId: string, fallback: number): number {
  if (!summary) return fallback;
  switch (sectionId) {
    case "sourced":
      return summary.savedCount ?? fallback;
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
  const known = SECTION_ORDER.map((base) => {
    const incoming = byId.get(base.id);
    const incomingRows = Array.isArray(incoming?.rows) ? incoming.rows : [];
    const rows = base.id === "tour_scheduled" ? incomingRows.filter(hasScheduledTour) : incomingRows;
    const count =
      base.id === "tour_scheduled"
        ? rows.length
        : sectionCount(data.summary ?? null, base.id, incoming?.count ?? rows.length);
    return {
      ...base,
      ...incoming,
      // Prefer the shared deal-flow label so columns match the home funnel.
      label: base.label || incoming?.label,
      count,
      rows,
    };
  });
  const extras = (data.sections ?? []).filter((section) => !SECTION_ORDER.some((base) => base.id === section.id));
  return [...known, ...extras];
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

/** Shared 70/50 banding from lib/format, mapped onto this page's pill classes. */
function scoreClass(score: number | null | undefined): string {
  const toneClass = {
    strong: styles.scoreStrong,
    watch: styles.scoreWatch,
    weak: styles.scoreWeak,
    empty: styles.scoreEmpty,
  }[scoreTone(score)];
  return `${styles.scorePill} ${toneClass}`;
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

async function patchDealPath(propertyId: string, dealPath: Record<string, unknown>): Promise<UiV2DealPathState | null> {
  const response = await fetch(`${API_BASE}/api/ui-v2/properties/${propertyId}/deal-path`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dealPath,
      actorName: "progress_table",
      source: "progress_table",
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    property?: { dealPath?: UiV2DealPathState | null } | null;
    error?: string;
    details?: string;
  };
  if (!response.ok) throw new Error(data.error || data.details || "Failed to update deal path.");
  return data.property?.dealPath ?? null;
}

async function uploadLoiDocument(propertyId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  form.append("category", "Other");
  form.append("source", "Deal Progress LOI upload");
  const response = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
  if (!response.ok) throw new Error(data.error || data.details || "Failed to upload LOI document.");
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

/**
 * Move-anyway plans for the deal-path stages: which deal-path fields pin the
 * stage, which pipeline status lands the move, which guided drawer collects
 * the details, and what counts as "missing" (flagged instead of blocking).
 */
const DEAL_PATH_STAGE_MOVES = {
  tour_scheduled: {
    dealPath: { status: "tour_scheduled", tourCompletedAt: null, postTourDecision: "pending" },
    status: "tour_scheduled" as UiV2PipelineStatus,
    label: "Tour Scheduled",
    drawerMode: "tour_scheduled" as DealPathPromptMode,
    missing: (row: DealFlowRow) => !row.dealPath?.tourScheduledAt,
    missingLabel: "tour dates",
  },
  tour_completed_awaiting_inputs: {
    dealPath: { status: "tour_completed_awaiting_inputs", postTourDecision: "pending" },
    status: "tour_completed_awaiting_inputs" as UiV2PipelineStatus,
    label: "Tour Completed · Awaiting Inputs",
    drawerMode: "tour_completed" as DealPathPromptMode,
    missing: (row: DealFlowRow) => !row.dealPath?.tourCompletedAt || !row.dealPath?.tourNotes?.trim(),
    missingLabel: "tour outcomes",
  },
  offer_review: {
    dealPath: { postTourDecision: "move_forward" },
    status: "offer_review" as UiV2PipelineStatus,
    label: "LOI Offered",
    drawerMode: "loi_offered" as DealPathPromptMode,
    missing: (row: DealFlowRow) => row.dealPath?.offerAmount == null && !row.dealPath?.offerNotes?.trim(),
    missingLabel: "LOI terms",
  },
} as const;

type DealPathStageMoveId = keyof typeof DEAL_PATH_STAGE_MOVES;

function isDealPathStageMoveId(sectionId: string): sectionId is DealPathStageMoveId {
  return sectionId in DEAL_PATH_STAGE_MOVES;
}

function ProgressPageContent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sections, setSections] = useState<ProgressSection[]>(SECTION_ORDER);
  const [rejectionReasons, setRejectionReasons] = useState<Array<{ reasonCode?: string; count?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageMoveBusy, setStageMoveBusy] = useState<string | null>(null);
  const [bulkWorkflowBusy, setBulkWorkflowBusy] = useState<typeof OM_ANALYSIS_BULK_ID | typeof DOSSIER_BULK_ID | null>(null);
  const processBanner = useProcessBanner();
  const [bulkTargetSectionId, setBulkTargetSectionId] = useState<string>(DEFAULT_BULK_STAGE_ID);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(() => new Set());
  const [draggedDeal, setDraggedDeal] = useState<DealFlowRow | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [editingDealPathId, setEditingDealPathId] = useState<string | null>(null);
  const [dealPathPromptMode, setDealPathPromptMode] = useState<DealPathPromptMode>("general");
  const [dealPathForms, setDealPathForms] = useState<Record<string, DealPathFormState>>({});
  const [loiUploadFiles, setLoiUploadFiles] = useState<Record<string, File | null>>({});
  const [dealPathSavingId, setDealPathSavingId] = useState<string | null>(null);
  const [rejectState, setRejectState] = useState<RejectFormState | null>(null);
  const [rejectSavingId, setRejectSavingId] = useState<string | null>(null);
  const [composerState, setComposerState] = useState<ComposerDialogState | null>(null);
  const [brokerEmailState, setBrokerEmailState] = useState<BrokerEmailDialogState | null>(null);
  const [moveStageState, setMoveStageState] = useState<MoveStageDialogState | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationsState>({ data: null, loading: true });
  const [boardFocus, setBoardFocus] = useState<BoardFocus | null>(null);
  const [stepper, setStepper] = useState<{ kind: StepperKind; rows: StepperRow[] } | null>(null);
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [flashColumnId, setFlashColumnId] = useState<string | null>(null);
  const [boardMode, setBoardMode] = useState<BoardMode>("board");
  const [snoozes, setSnoozes] = useState<Record<string, string>>({});
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [queueSelectedIds, setQueueSelectedIds] = useState<Set<string>>(() => new Set());
  const boardScrollerRef = useRef<HTMLDivElement | null>(null);

  const scrollToColumn = useCallback((sectionId: string) => {
    document.getElementById(`board-column-${sectionId}`)?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
    setFlashColumnId(sectionId);
    window.setTimeout(() => setFlashColumnId((current) => (current === sectionId ? null : current)), 1700);
  }, []);

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
      setRejectionReasons(Array.isArray(progressData.rejectionReasons) ? progressData.rejectionReasons : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deal progress");
      setSummary(null);
      setSections(SECTION_ORDER);
      setRejectionReasons([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  // Email snoozes persist locally so dismissed nags stay dismissed per browser.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SNOOZE_STORAGE_KEY);
      if (raw) setSnoozes(JSON.parse(raw) as Record<string, string>);
    } catch {
      // Ignore unreadable storage; snoozes just reset.
    }
  }, []);

  const setSnooze = useCallback((propertyId: string, days: number | null) => {
    setSnoozes((current) => {
      const next = { ...current };
      if (days == null) delete next[propertyId];
      else next[propertyId] = new Date(Date.now() + days * 86_400_000).toISOString();
      try {
        window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage may be unavailable (private mode); keep in-memory state.
      }
      return next;
    });
  }, []);

  const snoozedSet = useMemo(() => {
    const now = Date.now();
    return new Set(
      Object.entries(snoozes)
        .filter(([, until]) => new Date(until).getTime() > now)
        .map(([propertyId]) => propertyId)
    );
  }, [snoozes]);

  const startDealPathEdit = useCallback((row: DealFlowRow, options?: { mode?: DealPathPromptMode }) => {
    const mode = options?.mode ?? "general";
    setEditingDealPathId(row.propertyId);
    setDealPathPromptMode(mode);
    setDealPathForms((current) => ({
      ...current,
      [row.propertyId]: mode === "general" ? current[row.propertyId] ?? dealPathFormForPrompt(row.dealPath, mode) : dealPathFormForPrompt(row.dealPath, mode),
    }));
  }, []);

  const closeDealPathEdit = useCallback(() => {
    setEditingDealPathId(null);
    setDealPathPromptMode("general");
    setLoiUploadFiles({});
  }, []);

  const loadRecommendations = useCallback(async (force = false) => {
    setRecommendations((current) => ({ ...current, loading: true }));
    try {
      const data = await apiFetch<DealFlowRecommendationsResponse>(
        `/api/ui-v2/deal-progress/recommendations${force ? "?refresh=1" : ""}`
      );
      setRecommendations({ data, loading: false });
    } catch {
      // The panel is advisory; the board stays fully usable without it.
      setRecommendations((current) => ({ data: current.data, loading: false }));
    }
  }, []);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  const openEmailComposer = useCallback(async (row: DealFlowRow, intent: ComposerDialogState["intent"]) => {
    const address = row.displayAddress || row.canonicalAddress || row.propertyId;
    setComposerState({
      propertyId: row.propertyId,
      address,
      intent,
      toAddress: row.brokerEmail ?? "",
      subject: "",
      body: "",
      loading: true,
      submitting: false,
    });
    try {
      const response = await apiFetch<{ composer?: { to?: string | null; subject?: string | null; body?: string | null; broker?: { email?: string | null } | null } }>(
        `/api/ui-v2/properties/${encodeURIComponent(row.propertyId)}/outreach-composer`
      );
      const composer = response.composer ?? {};
      setComposerState((current) =>
        current && current.propertyId === row.propertyId
          ? {
              ...current,
              toAddress: current.toAddress || composer.broker?.email || composer.to || "",
              subject: composer.subject ?? "",
              body: composer.body ?? "",
              loading: false,
            }
          : current
      );
    } catch (err) {
      setComposerState((current) =>
        current && current.propertyId === row.propertyId ? { ...current, loading: false } : current
      );
      setError(err instanceof Error ? err.message : "Failed to load the email draft.");
    }
  }, []);

  const submitComposer = useCallback(async () => {
    if (!composerState || composerState.submitting) return;
    setComposerState({ ...composerState, submitting: true });
    setError(null);
    try {
      await apiFetch(`/api/ui-v2/outreach-drafts`, {
        method: "POST",
        body: JSON.stringify({
          propertyId: composerState.propertyId,
          toAddress: composerState.toAddress,
          subject: composerState.subject,
          body: composerState.body,
        }),
      });
      setComposerState(null);
      setNotice(
        composerState.intent === "request_om"
          ? `OM request queued for ${composerState.address}.`
          : `Broker email queued for ${composerState.address}.`
      );
      await loadProgress("refresh");
      void loadRecommendations(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue the email.");
      setComposerState((current) => (current ? { ...current, submitting: false } : current));
    }
  }, [composerState, loadProgress, loadRecommendations]);

  const openBrokerEmailDialog = useCallback((row: DealFlowRow) => {
    setBrokerEmailState({
      propertyId: row.propertyId,
      address: row.displayAddress || row.canonicalAddress || row.propertyId,
      name: row.brokerName ?? "",
      email: row.brokerEmail ?? "",
      saving: false,
    });
  }, []);

  const submitBrokerEmail = useCallback(async () => {
    if (!brokerEmailState || brokerEmailState.saving) return;
    setBrokerEmailState({ ...brokerEmailState, saving: true });
    setError(null);
    try {
      await apiFetch(`/api/ui-v2/properties/${encodeURIComponent(brokerEmailState.propertyId)}/broker`, {
        method: "PUT",
        body: JSON.stringify({
          email: brokerEmailState.email.trim(),
          name: brokerEmailState.name.trim() || null,
          actorName: "progress_board",
        }),
      });
      setBrokerEmailState(null);
      setNotice(`Broker contact saved for ${brokerEmailState.address}.`);
      await loadProgress("refresh");
      void loadRecommendations(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the broker email.");
      setBrokerEmailState((current) => (current ? { ...current, saving: false } : current));
    }
  }, [brokerEmailState, loadProgress, loadRecommendations]);

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

  const moveDealsToTourRequested = useCallback(
    async (rows: DealFlowRow[], options?: { clearSelection?: boolean }) => {
      const uniqueRows = [...new Map(rows.map((row) => [row.propertyId, row])).values()];
      if (uniqueRows.length === 0) return;
      setStageMoveBusy(uniqueRows.length === 1 ? uniqueRows[0].propertyId : BULK_STAGE_MOVE_ID);
      setError(null);
      try {
        const results = await Promise.all(
          uniqueRows.map(async (row) => {
            try {
              const form = dealPathFormFromState(row.dealPath);
              await patchDealPath(row.propertyId, {
                ...dealPathPayload({
                  ...form,
                  tourScheduledAt: "",
                  tourCompletedAt: "",
                  postTourDecision: "pending",
                  rejectionReasonCode: "",
                  rejectionNotes: "",
                }),
                // Clear any explicit tour-stage pin: Tour Requested means the
                // date is being re-requested, not merely missing.
                status: "not_scheduled",
                tourScheduledAt: null,
                tourCompletedAt: null,
                postTourDecision: "pending",
              });
              await patchSavedDealStatus(row.propertyId, "tour_scheduled");
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
          setError(`${failures.length} of ${uniqueRows.length} selected deal${uniqueRows.length === 1 ? "" : "s"} could not move to Tour Requested.`);
        }
      } finally {
        setStageMoveBusy(null);
      }
    },
    [loadProgress]
  );

  /**
   * Move-anyway for the deal-path stages (Tour Scheduled / Tour Completed /
   * LOI Offered): the card always lands where it was dropped, and any missing
   * required info (tour date, outcome, LOI terms) is raised as a flag in
   * Needs Action and the action bar instead of blocking the move. For a
   * single property the guided drawer opens right after so the details can
   * land immediately — closing it keeps the move.
   */
  const moveDealsToDealPathStage = useCallback(
    async (rows: DealFlowRow[], sectionId: DealPathStageMoveId, options?: { clearSelection?: boolean }) => {
      const uniqueRows = [...new Map(rows.map((row) => [row.propertyId, row])).values()];
      if (uniqueRows.length === 0) return;
      const plan = DEAL_PATH_STAGE_MOVES[sectionId];
      setStageMoveBusy(uniqueRows.length === 1 ? uniqueRows[0].propertyId : BULK_STAGE_MOVE_ID);
      setError(null);
      try {
        const results = await Promise.all(
          uniqueRows.map(async (row) => {
            try {
              await patchDealPath(row.propertyId, plan.dealPath);
              await patchSavedDealStatus(row.propertyId, plan.status);
              return { row, ok: true as const };
            } catch (err) {
              return {
                row,
                ok: false as const,
                message: err instanceof Error ? err.message : "Failed to move deal stage.",
              };
            }
          })
        );
        const moved = results.filter((result) => result.ok).map((result) => result.row);
        if (moved.length > 0) {
          if (options?.clearSelection) {
            setSelectedDealIds((current) => {
              const next = new Set(current);
              moved.forEach((row) => next.delete(row.propertyId));
              return next;
            });
          }
          const flaggedCount = moved.filter(plan.missing).length;
          const movedLabel =
            moved.length === 1
              ? streetAddressOnly(moved[0].displayAddress || moved[0].canonicalAddress || moved[0].propertyId)
              : `${moved.length} deals`;
          setNotice(
            flaggedCount > 0
              ? `Moved ${movedLabel} to ${plan.label} — missing ${plan.missingLabel} flagged for review in Needs Action.`
              : `Moved ${movedLabel} to ${plan.label}.`
          );
          await loadProgress("refresh");
        }
        const failures = results.filter((result) => !result.ok);
        if (failures.length > 0) {
          setError(
            `${failures.length} of ${uniqueRows.length} deal${uniqueRows.length === 1 ? "" : "s"} could not move to ${plan.label}.`
          );
        }
        // Single-property move: open the guided prompt so the details can land
        // right away. Closing it keeps the move; the flag keeps chasing.
        if (moved.length === 1 && uniqueRows.length === 1) {
          startDealPathEdit(moved[0], { mode: plan.drawerMode });
        }
      } finally {
        setStageMoveBusy(null);
      }
    },
    [loadProgress, startDealPathEdit]
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
      if (section.id === "tour_requested") {
        void moveDealsToTourRequested(rowsToMove, { clearSelection: movingSelection });
        return;
      }
      if (isDealPathStageMoveId(section.id)) {
        void moveDealsToDealPathStage(rowsToMove, section.id, { clearSelection: movingSelection });
        return;
      }
      void moveSavedDeals(rowsToMove, section.targetStatus, { clearSelection: movingSelection });
    },
    [draggedDeal, moveDealsToDealPathStage, moveDealsToTourRequested, moveSavedDeals, sections, selectedDealIds]
  );

  // Same stage-specific behavior as drag-and-drop, but reachable from the
  // card's quick-action menu (tour/LOI stages move first, then open their
  // guided prompt for the details).
  const moveRowToSectionId = useCallback(
    (row: DealFlowRow, sectionId: string) => {
      const group = MOVE_STAGE_OPTIONS.find((option) => option.id === sectionId);
      if (!group) return;
      if (sectionId === "tour_requested") {
        void moveDealsToTourRequested([row]);
        return;
      }
      if (isDealPathStageMoveId(sectionId)) {
        void moveDealsToDealPathStage([row], sectionId);
        return;
      }
      void moveSavedDeals([row], group.targetStatus);
    },
    [moveDealsToDealPathStage, moveDealsToTourRequested, moveSavedDeals]
  );

  const submitMoveStage = useCallback(() => {
    if (!moveStageState) return;
    const row = sections.flatMap((section) => section.rows ?? []).find((candidate) => candidate.propertyId === moveStageState.propertyId);
    setMoveStageState(null);
    if (row) moveRowToSectionId(row, moveStageState.targetSectionId);
  }, [moveRowToSectionId, moveStageState, sections]);

  const filteredSections = useMemo(() => {
    if (!query && !boardFocus) return sections;
    return sections.map((section) => ({
      ...section,
      rows: (section.rows ?? [])
        .filter((row) => !query || searchableText(row).includes(query))
        .filter((row) => !boardFocus || boardFocus.propertyIds.has(row.propertyId)),
    }));
  }, [boardFocus, query, sections]);

  const flowRows = useMemo(() => sections.flatMap((section) => section.rows ?? []), [sections]);
  const navigableRows = useMemo(
    () =>
      filteredSections.flatMap((section, sectionIndex) =>
        (section.rows ?? []).map((row, rowIndex) => ({ row: row as DealFlowRow, sectionIndex, rowIndex, sectionId: section.id }))
      ),
    [filteredSections]
  );

  /* ── Workflow intelligence (deterministic; see actionFlags.ts) ── */

  // Full flag set per property, ignoring snoozes (the Email Queue needs both).
  const flagsByProperty = useMemo(() => {
    const map = new Map<string, ActionFlag[]>();
    for (const section of sections) {
      for (const row of section.rows ?? []) {
        if (!map.has(row.propertyId)) map.set(row.propertyId, computeRowFlags(section.id, row));
      }
    }
    return map;
  }, [sections]);

  // What cards, CTAs, and summary counts use: snoozed properties drop email nags.
  const effectiveFlagsByProperty = useMemo(() => {
    if (snoozedSet.size === 0) return flagsByProperty;
    const map = new Map<string, ActionFlag[]>();
    for (const [propertyId, flags] of flagsByProperty) {
      map.set(propertyId, snoozedSet.has(propertyId) ? flags.filter((item) => !item.email) : flags);
    }
    return map;
  }, [flagsByProperty, snoozedSet]);

  const sectionIdByProperty = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections) {
      for (const row of section.rows ?? []) {
        if (!map.has(row.propertyId)) map.set(row.propertyId, section.id);
      }
    }
    return map;
  }, [sections]);

  const summaryItems = useMemo(
    () => buildActionSummary(sections as Array<{ id: string; rows?: DealFlowRow[] }>, effectiveFlagsByProperty),
    [sections, effectiveFlagsByProperty]
  );

  const emailQueueItems = useMemo(
    () => buildEmailQueue(filteredSections as Array<{ id: string; rows?: DealFlowRow[] }>, flagsByProperty, snoozedSet),
    [filteredSections, flagsByProperty, snoozedSet]
  );
  const emailQueueDueCount = useMemo(() => emailQueueItems.filter((item) => !item.snoozed).length, [emailQueueItems]);
  const visibleEmailQueueItems = useMemo(
    () => (showSnoozed ? emailQueueItems : emailQueueItems.filter((item) => !item.snoozed)),
    [emailQueueItems, showSnoozed]
  );

  const needsActionRows = useMemo<NeedsActionRow[]>(() => {
    const rows: NeedsActionRow[] = [];
    for (const section of filteredSections) {
      for (const row of section.rows ?? []) {
        const flags = effectiveFlagsByProperty.get(row.propertyId) ?? [];
        if (flags.length === 0) continue;
        rows.push({
          propertyId: row.propertyId,
          address: row.displayAddress || row.canonicalAddress || row.propertyId,
          stageId: section.id,
          flag: flags[0],
          flagCount: flags.length,
          ageDays: stageAgeDays(row),
        });
      }
    }
    return rows.sort(
      (left, right) =>
        severityRank(left.flag.severity) - severityRank(right.flag.severity) ||
        (left.flag.dueInDays ?? 99) - (right.flag.dueInDays ?? 99) ||
        (right.ageDays ?? 0) - (left.ageDays ?? 0)
    );
  }, [filteredSections, effectiveFlagsByProperty]);

  const rowById = useMemo(() => {
    const map = new Map<string, DealFlowRow>();
    for (const row of flowRows) {
      if (!map.has(row.propertyId)) map.set(row.propertyId, row as DealFlowRow);
    }
    return map;
  }, [flowRows]);

  /** Central router for flag CTAs: every flag click lands in the right workflow. */
  const runBoardAction = useCallback(
    (row: DealFlowRow, actionKind: FlagActionKind) => {
      switch (actionKind) {
        case "compose_email":
          if (row.brokerEmail) void openEmailComposer(row, "email");
          else openBrokerEmailDialog(row);
          return;
        case "request_om":
          if (row.brokerEmail) void openEmailComposer(row, "request_om");
          else openBrokerEmailDialog(row);
          return;
        case "add_broker_email":
          openBrokerEmailDialog(row);
          return;
        case "schedule_tour":
          startDealPathEdit(row, { mode: "tour_scheduled" });
          return;
        case "complete_tour":
          startDealPathEdit(row, { mode: "tour_completed" });
          return;
        case "update_loi":
          startDealPathEdit(row, { mode: "loi_offered" });
          return;
        case "reject":
          setRejectState({
            propertyId: row.propertyId,
            address: row.displayAddress || row.canonicalAddress || row.propertyId,
            reasonCode: "",
            note: "",
          });
          return;
        case "move_stage":
          setMoveStageState({
            propertyId: row.propertyId,
            address: row.displayAddress || row.canonicalAddress || row.propertyId,
            targetSectionId: (() => {
              const sectionId = sectionIdByProperty.get(row.propertyId);
              return !sectionId || sectionId === "sourced" ? "om_requested" : sectionId;
            })(),
          });
          return;
        case "review_underwriting":
        case "open_inputs":
        default:
          startDealPathEdit(row);
      }
    },
    [openBrokerEmailDialog, openEmailComposer, sectionIdByProperty, startDealPathEdit]
  );

  const openStepperFor = useCallback(
    (kind: StepperKind, propertyIds: string[]) => {
      const seen = new Set<string>();
      const stepperRows: StepperRow[] = [];
      for (const propertyId of propertyIds) {
        if (seen.has(propertyId)) continue;
        seen.add(propertyId);
        const row = rowById.get(propertyId);
        if (!row) continue;
        stepperRows.push({
          propertyId: row.propertyId,
          address: row.displayAddress || row.canonicalAddress || row.propertyId,
          brokerName: row.brokerName ?? null,
          brokerEmail: row.brokerEmail ?? null,
        });
      }
      if (stepperRows.length > 0) setStepper({ kind, rows: stepperRows });
    },
    [rowById]
  );

  const applySummaryAction = useCallback(
    (item: ActionSummaryItem) => {
      switch (item.action) {
        case "email_queue":
          setBoardMode("email_queue");
          return;
        case "needs_action":
          setBoardMode("needs_action");
          return;
        case "broker_stepper":
          openStepperFor("missing_broker_email", item.propertyIds);
          return;
        case "followup_stepper":
          openStepperFor("om_request_stale", item.propertyIds);
          return;
        case "focus":
        default:
          setBoardMode("board");
          setBoardFocus({ label: item.label, propertyIds: new Set(item.propertyIds), stageId: item.stageId });
          if (item.stageId) scrollToColumn(item.stageId);
      }
    },
    [openStepperFor, scrollToColumn]
  );

  // Drag near the board's left/right edge to auto-scroll the kanban (§2B).
  const handleBoardDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!draggedDeal) return;
      const node = boardScrollerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const edge = 90;
      if (event.clientX < rect.left + edge) node.scrollLeft -= 24;
      else if (event.clientX > rect.right - edge) node.scrollLeft += 24;
    },
    [draggedDeal]
  );

  // Keyboard triage: j/k through cards, h/l across columns, enter/e/m act on
  // the focused card, ? shows the cheat sheet. Suppressed while typing or
  // while any prompt is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (composerState || brokerEmailState || moveStageState || rejectState || stepper || editingDealPathId) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (shortcutsOpen) {
        if (event.key === "Escape") setShortcutsOpen(false);
        return;
      }
      if (navigableRows.length === 0) return;

      const currentIndex = navigableRows.findIndex((entry) => entry.row.propertyId === focusedCardId);

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = navigableRows[Math.min(currentIndex + 1, navigableRows.length - 1)] ?? navigableRows[0];
        setFocusedCardId(next.row.propertyId);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = currentIndex <= 0 ? navigableRows[0] : navigableRows[currentIndex - 1];
        setFocusedCardId(next.row.propertyId);
        return;
      }
      if (event.key === "h" || event.key === "l") {
        event.preventDefault();
        const current = currentIndex >= 0 ? navigableRows[currentIndex] : navigableRows[0];
        const sectionIndexes = [...new Set(navigableRows.map((entry) => entry.sectionIndex))].sort((a, b) => a - b);
        const position = sectionIndexes.indexOf(current.sectionIndex);
        const targetSection = sectionIndexes[position + (event.key === "l" ? 1 : -1)];
        if (targetSection == null) return;
        const candidates = navigableRows.filter((entry) => entry.sectionIndex === targetSection);
        const next = candidates[Math.min(current.rowIndex, candidates.length - 1)];
        if (next) setFocusedCardId(next.row.propertyId);
        return;
      }

      const focused = currentIndex >= 0 ? navigableRows[currentIndex] : null;
      if (!focused) {
        if (event.key === "Escape") setFocusedCardId(null);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        startDealPathEdit(focused.row);
        return;
      }
      if (event.key === "e") {
        event.preventDefault();
        if (focused.row.brokerEmail) void openEmailComposer(focused.row, "email");
        else openBrokerEmailDialog(focused.row);
        return;
      }
      if (event.key === "m") {
        event.preventDefault();
        setMoveStageState({
          propertyId: focused.row.propertyId,
          address: focused.row.displayAddress || focused.row.canonicalAddress || focused.row.propertyId,
          targetSectionId: focused.sectionId === "sourced" ? "om_requested" : focused.sectionId,
        });
        return;
      }
      if (event.key === "Escape") {
        setFocusedCardId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    brokerEmailState,
    composerState,
    editingDealPathId,
    focusedCardId,
    moveStageState,
    navigableRows,
    openBrokerEmailDialog,
    openEmailComposer,
    rejectState,
    shortcutsOpen,
    startDealPathEdit,
    stepper,
  ]);
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
  const bulkTargetGroup = MOVE_STAGE_OPTIONS.find((option) => option.id === bulkTargetSectionId) ?? MOVE_STAGE_OPTIONS[0] ?? null;

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

  const moveSelectedToBulkTarget = useCallback(() => {
    if (!bulkTargetGroup) return;
    if (bulkTargetGroup.id === "tour_requested") {
      void moveDealsToTourRequested(selectedSavedDeals, { clearSelection: true });
      return;
    }
    if (isDealPathStageMoveId(bulkTargetGroup.id)) {
      void moveDealsToDealPathStage(selectedSavedDeals, bulkTargetGroup.id, { clearSelection: true });
      return;
    }
    void moveSavedDeals(selectedSavedDeals, bulkTargetGroup.targetStatus, { clearSelection: true });
  }, [bulkTargetGroup, moveDealsToDealPathStage, moveDealsToTourRequested, moveSavedDeals, selectedSavedDeals]);

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
      const mode = dealPathPromptMode;
      const loiFile = loiUploadFiles[row.propertyId] ?? null;
      // Missing stage info no longer blocks the save: the move still lands and
      // the gap stays flagged in Needs Action / the action bar until filled.
      const missingInfoLabel =
        mode === "tour_scheduled" && !form.tourScheduledAt.trim()
          ? "tour date"
          : mode === "tour_completed" && !form.tourCompletedAt.trim()
            ? "completed tour date"
            : mode === "tour_completed" && !form.tourNotes.trim()
              ? "tour notes"
              : mode === "loi_offered" &&
                  !form.offerAmount.trim() &&
                  !form.offerNotes.trim() &&
                  !form.loiRecipientEmail.trim() &&
                  loiFile == null
                ? "LOI terms"
                : null;
      if (form.postTourDecision === "reject" && !form.rejectionReasonCode) {
        setError("Choose a rejection reason before rejecting after a tour.");
        return;
      }
      if (parsePriceInput(form.targetPrice) === "invalid" || parsePriceInput(form.offerAmount) === "invalid") {
        setError("Enter prices as plain numbers — e.g. 4500000, $4.5M, or 950K.");
        return;
      }
      setDealPathSavingId(row.propertyId);
      setError(null);
      setNotice(null);
      try {
        if (mode === "loi_offered" && loiFile) await uploadLoiDocument(row.propertyId, loiFile);
        const savedDealPath = await patchDealPath(row.propertyId, dealPathPayload(form, mode));
        // The server derives the landing stage (e.g. a past tour date goes
        // straight to Tour Completed) — name it so the move is never silent.
        const destinationSectionId =
          form.postTourDecision === "reject"
            ? null
            : savedDealPath?.status === "tour_scheduled"
              ? "tour_scheduled"
              : savedDealPath?.status === "tour_completed_awaiting_inputs" || savedDealPath?.status === "need_more_info"
                ? "tour_completed_awaiting_inputs"
                : savedDealPath?.status === "offer_candidate"
                  ? "offer_review"
                  : null;
        const destinationLabel = destinationSectionId
          ? DEAL_FLOW_STAGES.find((stage) => stage.id === destinationSectionId)?.label ?? null
          : null;
        setNotice(
          form.postTourDecision === "reject"
            ? "Property rejected after tour."
            : destinationLabel
              ? missingInfoLabel
                ? `Saved — moved to ${destinationLabel}. Missing ${missingInfoLabel} flagged for review in Needs Action.`
                : `Saved — moved to ${destinationLabel}.`
              : missingInfoLabel
                ? `Deal path updated — missing ${missingInfoLabel} flagged for review in Needs Action.`
                : "Deal path updated."
        );
        setEditingDealPathId(null);
        setDealPathPromptMode("general");
        setLoiUploadFiles((current) => {
          if (!(row.propertyId in current)) return current;
          const next = { ...current };
          delete next[row.propertyId];
          return next;
        });
        await loadProgress("refresh");
        if (destinationSectionId) scrollToColumn(destinationSectionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update deal path.");
      } finally {
        setDealPathSavingId(null);
      }
    },
    [dealPathForms, dealPathPromptMode, loadProgress, loiUploadFiles, scrollToColumn]
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
    setBulkWorkflowBusy(OM_ANALYSIS_BULK_ID);
    setError(null);
    const banner = processBanner.start("OM analysis refresh", {
      message: `Re-reading OMs for ${selectedSavedDealsWithOm.length} deal${selectedSavedDealsWithOm.length === 1 ? "" : "s"} (AI extraction)…`,
      estimateKind: "om-analysis-refresh",
      estimateItems: selectedSavedDealsWithOm.length,
    });
    try {
      const summary = await runBulkPropertyAction({
        rows: selectedSavedDealsWithOm.map((row) => ({
          propertyId: row.propertyId,
          address: row.displayAddress ?? row.canonicalAddress ?? row.propertyId,
        })),
        skippedCount: skipped,
        noun: "deal",
        progressVerb: "Updating OM analysis",
        successVerb: "OM analysis updated",
        failureNoun: "OM analysis refresh",
        banner,
        onProgress: setNotice,
        runOne: async ({ propertyId }) => {
          await refreshPropertyOmAnalysis(propertyId);
        },
      });
      await loadProgress("refresh");
      if (summary.errorMessage) setError(summary.errorMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh selected OM analysis.";
      banner.fail(message);
      setError(message);
    } finally {
      setBulkWorkflowBusy(null);
    }
  }, [loadProgress, processBanner, selectedSavedDeals, selectedSavedDealsWithOm]);

  const rerunSelectedDossiers = useCallback(async () => {
    if (selectedSavedDeals.length === 0) return;
    if (selectedSavedDealsWithOm.length === 0) {
      setError("Select at least one saved deal with an uploaded OM before rerunning dossiers.");
      return;
    }
    const skipped = selectedSavedDeals.length - selectedSavedDealsWithOm.length;
    setBulkWorkflowBusy(DOSSIER_BULK_ID);
    setError(null);
    const banner = processBanner.start("Dossier rerun", {
      message: `Re-running OM analysis + dossiers for ${selectedSavedDealsWithOm.length} deal${selectedSavedDealsWithOm.length === 1 ? "" : "s"}…`,
      estimateKind: "dossier-rerun",
      estimateItems: selectedSavedDealsWithOm.length,
    });
    try {
      const summary = await runBulkPropertyAction({
        rows: selectedSavedDealsWithOm.map((row) => ({
          propertyId: row.propertyId,
          address: row.displayAddress ?? row.canonicalAddress ?? row.propertyId,
        })),
        skippedCount: skipped,
        noun: "deal",
        progressVerb: "Rerunning dossiers",
        successVerb: "Dossiers rerun",
        failureNoun: "dossier rerun",
        banner,
        onProgress: setNotice,
        runOne: async ({ propertyId }) => {
          await rerunPropertyDossier(propertyId);
        },
      });
      await loadProgress("refresh");
      if (summary.errorMessage) setError(summary.errorMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rerun selected dossiers.";
      banner.fail(message);
      setError(message);
    } finally {
      setBulkWorkflowBusy(null);
    }
  }, [loadProgress, processBanner, selectedSavedDeals, selectedSavedDealsWithOm]);

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

  /* ── Email Queue handlers ── */

  const toggleQueueSelected = useCallback((propertyId: string, selected: boolean) => {
    setQueueSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(propertyId);
      else next.delete(propertyId);
      return next;
    });
  }, []);

  // The panel passes the currently visible (filtered) selectable items so
  // "Select all" always matches what the user is looking at.
  const toggleQueueSelectAll = useCallback((visibleSelectable: EmailQueueItem[]) => {
    setQueueSelectedIds((current) => {
      const selectable = visibleSelectable.map((item) => item.propertyId);
      const allSelected = selectable.length > 0 && selectable.every((propertyId) => current.has(propertyId));
      return allSelected ? new Set<string>() : new Set(selectable);
    });
  }, []);

  const handleQueueDraft = useCallback(
    (item: EmailQueueItem) => {
      const row = rowById.get(item.propertyId);
      if (!row) return;
      runBoardAction(row, item.flag.actionKind);
    },
    [rowById, runBoardAction]
  );

  const handleQueueOpen = useCallback(
    (propertyId: string) => {
      const row = rowById.get(propertyId);
      if (row) startDealPathEdit(row);
    },
    [rowById, startDealPathEdit]
  );

  const handleQueueBatchDraft = useCallback(
    (items: EmailQueueItem[]) => {
      openStepperFor("om_request_stale", items.map((item) => item.propertyId));
    },
    [openStepperFor]
  );

  const handleQueueBatchBroker = useCallback(
    (items: EmailQueueItem[]) => {
      openStepperFor("missing_broker_email", items.map((item) => item.propertyId));
    },
    [openStepperFor]
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Deal movement"
        title="Deal Progress"
        subtitle="The acquisitions command center — every deal shows its stage, owner action, and due date."
        meta={
          <>
            <div>{totalCount} deals on the board</div>
            <div>Updated {formatDate(summary?.updatedAt)}</div>
          </>
        }
        actions={
          <>
            <Link href="/saved" className={styles.secondaryLink}>Saved Deals</Link>
            <Link href="/pipeline" className={styles.primaryLink}>Pipeline</Link>
          </>
        }
      />

      {/* Today's Deal Actions: deterministic counts; the LLM only writes the headline. */}
      <section className={styles.nextActions} aria-label="Today's deal actions">
        <div className={styles.nextActionsHeader}>
          <span className={styles.nextActionsIcon} aria-hidden="true">
            <Sparkles size={15} strokeWidth={2} />
          </span>
          <div className={styles.nextActionsCopy}>
            <h2>Today&rsquo;s Deal Actions</h2>
            <p>
              {recommendations.loading && !recommendations.data
                ? "Reviewing the board…"
                : recommendations.data?.headline ??
                  (summaryItems.length > 0
                    ? `${summaryItems.reduce((sum, item) => sum + item.count, 0)} actions across the pipeline need attention.`
                    : "All caught up — no pending actions on the board.")}
            </p>
          </div>
          {recommendations.data?.source === "rules" ? (
            <span
              className={styles.nextActionsSource}
              title="Headline generated by the rule engine — set OPENAI_API_KEY to enable LLM phrasing."
            >
              rule-based
            </span>
          ) : null}
          <button
            type="button"
            className={styles.nextActionsRefresh}
            onClick={() => void loadRecommendations(true)}
            disabled={recommendations.loading}
          >
            {recommendations.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {summaryItems.length > 0 ? (
          <div className={styles.nextActionsItems}>
            {summaryItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.nextActionChip} ${styles[`chipSeverity_${item.severity}`]} ${
                  boardFocus?.label === item.label ? styles.nextActionChipActive : ""
                }`}
                title={
                  item.action === "email_queue"
                    ? "Open the Email Queue"
                    : item.action === "broker_stepper"
                      ? "Step through and add the missing broker emails"
                      : item.action === "followup_stepper"
                        ? "Step through drafts and queue them"
                        : "Focus the board on these deals"
                }
                onClick={() => applySummaryAction(item)}
              >
                <strong>{item.label}</strong>
                <span>{item.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {boardFocus ? (
        <div className={styles.filterNotice}>
          <span>Focused on</span>
          <strong>{boardFocus.label}</strong>
          <button type="button" className={styles.focusClear} onClick={() => setBoardFocus(null)}>
            Clear focus
          </button>
        </div>
      ) : null}

      {query ? (
        <div className={styles.filterNotice}>
          <span>Filtered by global search</span>
          <strong>{searchParams.get("q")}</strong>
          <span>{visibleRowCount} visible loaded row{visibleRowCount === 1 ? "" : "s"}</span>
        </div>
      ) : null}

      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <section className={styles.metrics} aria-label="Deal progress summary">
        {savedStatusSections.map((section) => {
          const stage = DEAL_FLOW_STAGES.find((candidate) => candidate.id === section.id);
          const count = savedStageCounts.get(section.id) ?? section.rows.length;
          return (
            <StatCard
              key={section.id}
              label={stage?.shortLabel ?? section.label}
              value={count}
              tone={section.id === "tour_completed_awaiting_inputs" && count > 0 ? "warning" : "neutral"}
              title={`${section.label} — jump to column`}
              className={styles.metricCard}
              onClick={() => {
                setBoardMode("board");
                scrollToColumn(section.id);
              }}
            />
          );
        })}
      </section>

      <section className={styles.savedFlowPanel} aria-label="Deal path by status">
        <div className={styles.savedFlowHeader}>
          <div className={styles.boardTabs} role="tablist" aria-label="Board views">
            <button
              type="button"
              role="tab"
              aria-selected={boardMode === "board"}
              className={`${styles.boardTab} ${boardMode === "board" ? styles.boardTabActive : ""}`}
              onClick={() => setBoardMode("board")}
            >
              <KanbanSquare size={14} strokeWidth={2} aria-hidden="true" />
              Board
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={boardMode === "needs_action"}
              className={`${styles.boardTab} ${boardMode === "needs_action" ? styles.boardTabActive : ""}`}
              onClick={() => setBoardMode("needs_action")}
            >
              <ListTodo size={14} strokeWidth={2} aria-hidden="true" />
              Needs Action
              {needsActionRows.length > 0 ? <span className={styles.boardTabCount}>{needsActionRows.length}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={boardMode === "email_queue"}
              className={`${styles.boardTab} ${boardMode === "email_queue" ? styles.boardTabActive : ""}`}
              onClick={() => setBoardMode("email_queue")}
            >
              <MailWarning size={14} strokeWidth={2} aria-hidden="true" />
              Email Queue
              {emailQueueDueCount > 0 ? <span className={styles.boardTabCount}>{emailQueueDueCount}</span> : null}
            </button>
          </div>
          <div className={styles.savedFlowHeaderRight}>
            <p>
              {filteredFlowRows.length} loaded propert{filteredFlowRows.length === 1 ? "y" : "ies"} · Updated {formatDate(summary?.updatedAt)}
            </p>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void loadProgress("refresh")}
              disabled={loading || refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {boardMode === "board" ? (
          <>
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
                  value={bulkTargetSectionId}
                  disabled={bulkControlsBusy}
                  onChange={(event) => setBulkTargetSectionId(event.target.value)}
                >
                  {MOVE_STAGE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.moveLabel}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.bulkMoveButton}
                  disabled={selectedSavedDeals.length === 0 || bulkControlsBusy || bulkTargetGroup == null}
                  onClick={moveSelectedToBulkTarget}
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
            <div
              ref={boardScrollerRef}
              className={`${styles.boardScroller} ${draggedDeal ? styles.boardScrollerDragging : ""}`}
              onDragOver={handleBoardDragOver}
            >
              {savedStatusSections.map((section) => (
                <StatusColumn
                  key={section.id}
                  flash={flashColumnId === section.id}
                  section={section}
                  loading={loading}
                  movingPropertyId={stageMoveBusy}
                  selectedDealIds={selectedDealIds}
                  bulkMoving={bulkControlsBusy}
                  dragOver={dragOverSectionId === section.id}
                  flagsByProperty={effectiveFlagsByProperty}
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
                  onOpenDrawer={startDealPathEdit}
                  onRunAction={runBoardAction}
                  onEmailBroker={(row, intent) => void openEmailComposer(row, intent)}
                  onAddBrokerEmail={openBrokerEmailDialog}
                  onStartReject={startReject}
                  onMoveStage={(row) =>
                    setMoveStageState({
                      propertyId: row.propertyId,
                      address: row.displayAddress || row.canonicalAddress || row.propertyId,
                      targetSectionId: section.id === "sourced" ? "om_requested" : section.id,
                    })
                  }
                  focusedCardId={focusedCardId}
                />
              ))}
            </div>
          </>
        ) : boardMode === "needs_action" ? (
          <NeedsActionPanel
            rows={needsActionRows}
            onOpen={(row) => handleQueueOpen(row.propertyId)}
            onAction={(row) => {
              const dealRow = rowById.get(row.propertyId);
              if (dealRow) runBoardAction(dealRow, row.flag.actionKind);
            }}
          />
        ) : (
          <EmailQueuePanel
            items={visibleEmailQueueItems}
            snoozedCount={emailQueueItems.length - emailQueueDueCount}
            showSnoozed={showSnoozed}
            selectedIds={queueSelectedIds}
            busy={bulkControlsBusy}
            onToggleShowSnoozed={() => setShowSnoozed((current) => !current)}
            onToggleSelected={toggleQueueSelected}
            onToggleAll={toggleQueueSelectAll}
            onDraft={handleQueueDraft}
            onAddBroker={(item) => {
              const row = rowById.get(item.propertyId);
              if (row) openBrokerEmailDialog(row);
            }}
            onSnooze={(item) => setSnooze(item.propertyId, 7)}
            onUnsnooze={(propertyId) => setSnooze(propertyId, null)}
            onOpen={(item) => handleQueueOpen(item.propertyId)}
            onBatchDraft={handleQueueBatchDraft}
            onBatchBroker={handleQueueBatchBroker}
          />
        )}
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      <RejectedPanel
        reasons={rejectionReasons}
        onRestored={(address) => {
          setNotice(`${address} restored to the board.`);
          void loadProgress("refresh");
        }}
      />

      {editingDealPathRow ? (
        <DealWizardDrawer
          row={editingDealPathRow}
          sectionId={sectionIdByProperty.get(editingDealPathRow.propertyId) ?? "sourced"}
          form={dealPathForms[editingDealPathRow.propertyId] ?? dealPathFormFromState(editingDealPathRow.dealPath)}
          promptMode={dealPathPromptMode}
          flags={effectiveFlagsByProperty.get(editingDealPathRow.propertyId) ?? []}
          loiFile={loiUploadFiles[editingDealPathRow.propertyId] ?? null}
          saving={dealPathSavingId === editingDealPathRow.propertyId}
          autoMovedTourPassed={isAutoMovedTourPassed(
            editingDealPathRow,
            sectionIdByProperty.get(editingDealPathRow.propertyId)
          )}
          onUpdate={updateDealPathField}
          onLoiFileChange={(file) =>
            setLoiUploadFiles((current) => ({
              ...current,
              [editingDealPathRow.propertyId]: file,
            }))
          }
          onCancel={closeDealPathEdit}
          onSave={(event) => void saveDealPathForRow(editingDealPathRow, event)}
          onFlagAction={(flag) => runBoardAction(editingDealPathRow, flag.actionKind)}
          onEmailBroker={() => void openEmailComposer(editingDealPathRow, "email")}
          onAddBrokerEmail={() => openBrokerEmailDialog(editingDealPathRow)}
          onStartReject={() => startReject(editingDealPathRow)}
          onMoveStage={() =>
            setMoveStageState({
              propertyId: editingDealPathRow.propertyId,
              address: editingDealPathRow.displayAddress || editingDealPathRow.canonicalAddress || editingDealPathRow.propertyId,
              targetSectionId: (() => {
                const sectionId = sectionIdByProperty.get(editingDealPathRow.propertyId);
                return !sectionId || sectionId === "sourced" ? "om_requested" : sectionId;
              })(),
            })
          }
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

      <Dialog
        open={composerState != null}
        onClose={() => setComposerState(null)}
        title={composerState?.intent === "request_om" ? "Request the OM" : "Email broker"}
        description={composerState ? composerState.address : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setComposerState(null)} disabled={composerState?.submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitComposer()}
              disabled={
                composerState == null ||
                composerState.loading ||
                composerState.submitting ||
                !composerState.toAddress.trim() ||
                !composerState.subject.trim() ||
                !composerState.body.trim()
              }
            >
              {composerState?.submitting ? "Queueing…" : "Queue email"}
            </Button>
          </>
        }
      >
        {composerState ? (
          composerState.loading ? (
            <p className={styles.dialogHint}>Preparing a draft…</p>
          ) : (
            <div className={styles.dialogForm}>
              {!composerState.toAddress ? (
                <p className={styles.dialogWarning}>
                  No broker email on file — add one below or save it from the card menu first.
                </p>
              ) : null}
              <label className={styles.dialogField}>
                <span>To</span>
                <input
                  type="email"
                  value={composerState.toAddress}
                  onChange={(event) => setComposerState((current) => (current ? { ...current, toAddress: event.target.value } : current))}
                  placeholder="broker@firm.com"
                />
              </label>
              <label className={styles.dialogField}>
                <span>Subject</span>
                <input
                  type="text"
                  value={composerState.subject}
                  onChange={(event) => setComposerState((current) => (current ? { ...current, subject: event.target.value } : current))}
                />
              </label>
              <label className={styles.dialogField}>
                <span>Message</span>
                <textarea
                  rows={9}
                  value={composerState.body}
                  onChange={(event) => setComposerState((current) => (current ? { ...current, body: event.target.value } : current))}
                />
              </label>
              <p className={styles.dialogHint}>
                Queued emails go to the outreach review queue before sending{composerState.intent === "request_om" ? " and the deal moves to OM Requested" : ""}.
              </p>
            </div>
          )
        ) : null}
      </Dialog>

      <BrokerContactDialog
        state={brokerEmailState}
        onClose={() => setBrokerEmailState(null)}
        onChange={(patch) => setBrokerEmailState((current) => (current ? { ...current, ...patch } : current))}
        onSubmit={() => void submitBrokerEmail()}
      />

      {stepper ? (
        <RecommendationStepper
          kind={stepper.kind}
          rows={stepper.rows}
          onClose={(didWork) => {
            setStepper(null);
            if (didWork) {
              setQueueSelectedIds(new Set());
              void loadProgress("refresh");
              void loadRecommendations(true);
            }
          }}
        />
      ) : null}

      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        size="sm"
      >
        <dl className={styles.shortcutList}>
          <div><dt>j / k</dt><dd>Next / previous card</dd></div>
          <div><dt>h / l</dt><dd>Previous / next column</dd></div>
          <div><dt>Enter</dt><dd>Open deal workspace</dd></div>
          <div><dt>e</dt><dd>Email broker (or add email)</dd></div>
          <div><dt>m</dt><dd>Move to stage…</dd></div>
          <div><dt>Esc</dt><dd>Clear focus / close</dd></div>
          <div><dt>?</dt><dd>Toggle this help</dd></div>
        </dl>
      </Dialog>

      <Dialog
        open={moveStageState != null}
        onClose={() => setMoveStageState(null)}
        title="Move deal to stage"
        description={moveStageState?.address}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setMoveStageState(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={submitMoveStage} disabled={moveStageState == null}>
              Move deal
            </Button>
          </>
        }
      >
        {moveStageState ? (
          <div className={styles.dialogForm}>
            <label className={styles.dialogField}>
              <span>Stage</span>
              <select
                value={moveStageState.targetSectionId}
                onChange={(event) =>
                  setMoveStageState((current) => (current ? { ...current, targetSectionId: event.target.value } : current))
                }
              >
                {MOVE_STAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.moveLabel}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.dialogHint}>
              Tour and LOI stages open their guided prompt so dates, notes, and offers land with the move.
            </p>
          </div>
        ) : null}
      </Dialog>
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
      <form
        className={styles.rejectModal}
        role="dialog"
        aria-modal="true"
        aria-label={`Reject ${state.address}`}
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
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

type CardMetric = { label: string; value: string; tone?: "danger" };

function cardMetricsForRow(row: DealFlowRow): CardMetric[] {
  return [
    row.ltrYocPct != null
      ? { label: "LTR Yield", value: formatPercent(row.ltrYocPct), ...(row.ltrYocPct <= 0 ? { tone: "danger" as const } : {}) }
      : null,
    row.mtrYocPct != null
      ? { label: "MTR Yield", value: formatPercent(row.mtrYocPct), ...(row.mtrYocPct <= 0 ? { tone: "danger" as const } : {}) }
      : null,
    row.pricePerSqft != null ? { label: "$/SF", value: formatWholeCurrency(row.pricePerSqft) } : null,
    row.sqft != null ? { label: "SF", value: formatCompactNumber(row.sqft) } : null,
    row.price != null ? { label: "Ask", value: formatCurrency(row.price) } : null,
    row.units != null ? { label: "Units", value: formatCompactNumber(row.units) } : null,
  ].filter((metric): metric is CardMetric => metric != null);
}

function StatusColumn({
  section,
  loading,
  movingPropertyId = null,
  selectedDealIds,
  bulkMoving = false,
  dragOver = false,
  flagsByProperty,
  onToggleSelected,
  onDragStartDeal,
  onDragEndDeal,
  onDragOverSection,
  onDropOnSection,
  onOpenDrawer,
  onRunAction,
  onEmailBroker,
  onAddBrokerEmail,
  onStartReject,
  onMoveStage,
  focusedCardId = null,
  flash = false,
}: {
  section: SavedDealSection;
  loading: boolean;
  movingPropertyId?: string | null;
  selectedDealIds?: Set<string>;
  bulkMoving?: boolean;
  dragOver?: boolean;
  flagsByProperty: ReadonlyMap<string, ActionFlag[]>;
  onToggleSelected?: (propertyId: string, selected: boolean) => void;
  onDragStartDeal?: (row: DealFlowRow) => void;
  onDragEndDeal?: () => void;
  onDragOverSection?: (event: DragEvent<HTMLElement>) => void;
  onDropOnSection?: () => void;
  onOpenDrawer?: (row: DealFlowRow, options?: { mode?: DealPathPromptMode }) => void;
  onRunAction?: (row: DealFlowRow, actionKind: FlagActionKind) => void;
  onEmailBroker?: (row: DealFlowRow, intent: "email" | "request_om") => void;
  onAddBrokerEmail?: (row: DealFlowRow) => void;
  onStartReject?: (row: DealFlowRow) => void;
  onMoveStage?: (row: DealFlowRow) => void;
  focusedCardId?: string | null;
  flash?: boolean;
}) {
  const isEmpty = !loading && section.rows.length === 0;
  const stats = columnStats(section.rows, flagsByProperty);
  const statsLine = [
    stats.askTotal > 0 ? formatCurrency(stats.askTotal) : null,
    stats.actionCount > 0 ? `${stats.actionCount} action${stats.actionCount === 1 ? "" : "s"}` : null,
    stats.staleCount > 0 ? `${stats.staleCount} stale` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      id={`board-column-${section.id}`}
      className={`${styles.statusColumn} ${dragOver ? styles.statusColumnDropTarget : ""} ${
        isEmpty ? styles.statusColumnEmpty : ""
      } ${flash ? styles.statusColumnFlash : ""}`}
      onDragOver={onDragOverSection}
      onDrop={(event) => {
        event.preventDefault();
        onDropOnSection?.();
      }}
    >
      <div className={styles.columnHeader} title={section.description}>
        <div className={styles.columnTitleRow}>
          <h3>{section.label}</h3>
          <span className={styles.columnCount}>{section.rows.length}</span>
        </div>
        {statsLine ? <p className={styles.columnStats}>{statsLine}</p> : null}
      </div>
      <div className={styles.columnBody}>
        {loading ? (
          <div className={styles.emptyState}>Loading deal path...</div>
        ) : section.rows.length === 0 ? (
          <div className={styles.emptyState}>Empty</div>
        ) : (
          section.rows.map((row) => (
            <PropertyMiniCard
              key={`${section.id}-${row.propertyId}`}
              row={row}
              sectionId={section.id}
              flags={flagsByProperty.get(row.propertyId) ?? []}
              selected={selectedDealIds?.has(row.propertyId) ?? false}
              busy={bulkMoving || movingPropertyId === row.propertyId}
              keyboardFocused={focusedCardId === row.propertyId}
              onToggleSelected={onToggleSelected}
              onDragStartDeal={onDragStartDeal}
              onDragEndDeal={onDragEndDeal}
              onOpenDrawer={onOpenDrawer}
              onRunAction={onRunAction}
              onEmailBroker={onEmailBroker}
              onAddBrokerEmail={onAddBrokerEmail}
              onStartReject={onStartReject}
              onMoveStage={onMoveStage}
            />
          ))
        )}
      </div>
    </section>
  );
}

function PropertyMiniCard({
  row,
  sectionId,
  flags,
  selected,
  busy,
  keyboardFocused,
  onToggleSelected,
  onDragStartDeal,
  onDragEndDeal,
  onOpenDrawer,
  onRunAction,
  onEmailBroker,
  onAddBrokerEmail,
  onStartReject,
  onMoveStage,
}: {
  row: DealFlowRow;
  sectionId: string;
  flags: ActionFlag[];
  selected: boolean;
  busy: boolean;
  keyboardFocused: boolean;
  onToggleSelected?: (propertyId: string, selected: boolean) => void;
  onDragStartDeal?: (row: DealFlowRow) => void;
  onDragEndDeal?: () => void;
  onOpenDrawer?: (row: DealFlowRow, options?: { mode?: DealPathPromptMode }) => void;
  onRunAction?: (row: DealFlowRow, actionKind: FlagActionKind) => void;
  onEmailBroker?: (row: DealFlowRow, intent: "email" | "request_om") => void;
  onAddBrokerEmail?: (row: DealFlowRow) => void;
  onStartReject?: (row: DealFlowRow) => void;
  onMoveStage?: (row: DealFlowRow) => void;
}) {
  const address = row.displayAddress || row.canonicalAddress || row.propertyId;
  const metrics = cardMetricsForRow(row).slice(0, 4);
  const topFlag = flags[0] ?? null;
  const cta: PrimaryCta = primaryCtaForRow(sectionId, row, flags);
  const completeness = dataCompleteness(sectionId, row);
  const cadence = sectionId === "om_requested" ? followUpState(row) : null;
  const locationLine = [row.neighborhood ? labelFromKey(row.neighborhood) : null, formatUnitLabel(row.units)]
    .filter(Boolean)
    .join(" · ");
  const dueLabel = topFlag ? formatDue(topFlag.dueInDays) : null;
  const FlagIcon = topFlag?.email ? MailWarning : Flag;

  // Clicking anywhere non-interactive on the card opens the in-page drawer.
  const handleCardClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label")) return;
    onOpenDrawer?.(row);
  };

  return (
    <article
      className={`${styles.propertyCard} ${selected ? styles.propertyCardSelected : ""} ${busy ? styles.propertyCardBusy : ""} ${
        keyboardFocused ? styles.propertyCardFocused : ""
      }`}
      ref={keyboardFocused ? (node) => node?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
      draggable={!busy}
      aria-selected={selected}
      onClick={handleCardClick}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.propertyId);
        onDragStartDeal?.(row);
      }}
      onDragEnd={onDragEndDeal}
    >
      <div className={styles.cardTopRow}>
        <input
          type="checkbox"
          className={styles.miniSelect}
          aria-label={`Select ${address}`}
          checked={selected}
          disabled={busy}
          onChange={(event) => onToggleSelected?.(row.propertyId, event.target.checked)}
          onClick={(event) => event.stopPropagation()}
        />
        <PropertyThumb src={row.firstImageUrl} alt={address} size="sm" className={styles.cardThumb} />
        <button
          type="button"
          className={styles.cardTitleBlock}
          onClick={() => onOpenDrawer?.(row)}
          title={address}
        >
          <strong className={styles.cardTitle}>{streetAddressOnly(address)}</strong>
          <span className={styles.cardMeta}>{locationLine || (row.source ? labelFromKey(row.source) : "No source")}</span>
        </button>
        {topFlag ? (
          <button
            type="button"
            className={`${styles.cardFlag} ${styles[`severity_${topFlag.severity}`]}`}
            title={`${topFlag.label} — ${topFlag.reason}${dueLabel ? ` (${dueLabel})` : ""}`}
            aria-label={`${topFlag.label}: ${topFlag.recommendedAction}`}
            onClick={(event) => {
              event.stopPropagation();
              onRunAction?.(row, topFlag.actionKind);
            }}
          >
            <FlagIcon size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
        <PromptMenu
          align="end"
          heading={address}
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              className={styles.cardMenuButton}
              disabled={busy}
              title="More actions"
            >
              <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          items={[
            row.brokerEmail
              ? {
                  label: "Email broker",
                  hint: row.brokerEmail,
                  icon: Mail,
                  onSelect: () => onEmailBroker?.(row, "email"),
                }
              : {
                  label: "Add broker email",
                  icon: MailPlus,
                  onSelect: () => onAddBrokerEmail?.(row),
                },
            ...(sectionId === "sourced" && row.brokerEmail
              ? [
                  {
                    label: "Request OM",
                    hint: "Queues the email and moves to OM Requested",
                    icon: CalendarCheck,
                    onSelect: () => onEmailBroker?.(row, "request_om"),
                  },
                ]
              : []),
            {
              label: "Move to stage…",
              icon: ArrowRightLeft,
              onSelect: () => onMoveStage?.(row),
            },
            {
              label: "Open workspace",
              hint: "Tour dates, offers, LOI",
              icon: PenLine,
              onSelect: () => onOpenDrawer?.(row),
            },
            {
              label: "Reject deal",
              icon: XCircle,
              tone: "danger" as const,
              onSelect: () => onStartReject?.(row),
            },
          ]}
        />
      </div>

      {metrics.length > 0 ? (
        <div className={styles.cardMetrics} aria-label="Property metrics">
          {metrics.map((metric) => (
            <span key={metric.label} className={metric.tone === "danger" ? styles.metricDanger : undefined}>
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.cardChips}>
        <span className={row.hasOm ? styles.workflowBadgeReady : styles.workflowBadgeMuted}>OM</span>
        <span className={row.hasComps ? styles.workflowBadgeReady : styles.workflowBadgeMuted}>Comps</span>
        <span className={row.hasDossier ? styles.workflowBadgeReady : styles.workflowBadgeMuted}>Dossier</span>
        <span
          className={styles.completenessChip}
          title={completeness.topMissing ? `Missing: ${completeness.topMissing}` : "All tracked data present"}
        >
          Data {completeness.done}/{completeness.total}
        </span>
        <small className={scoreClass(row.dealScore)}>{row.dealScore == null ? "—" : Math.round(row.dealScore)}</small>
        <AgingChip since={row.stageEnteredAt} className={styles.agingChip} />
        {isAutoMovedTourPassed(row, sectionId) ? (
          <span
            className={styles.tourPassedChip}
            title="Scheduled tour date has passed; the board moved this deal here automatically. Log the outcome."
          >
            Tour date passed — log outcome
          </span>
        ) : null}
        {topFlag ? (
          <span
            className={`${styles.flagChip} ${styles[`chipSeverity_${topFlag.severity}`]}`}
            title={topFlag.reason}
          >
            {topFlag.label}
            {dueLabel ? ` · ${dueLabel}` : ""}
          </span>
        ) : null}
      </div>

      {cadence ? (
        <div className={styles.cardTouchLine}>
          Last touch {cadence.lastTouchDays == null ? "never" : cadence.lastTouchDays === 0 ? "today" : `${cadence.lastTouchDays}d ago`}
          {" · "}
          {cadence.nextStepLabel.toLowerCase()} {formatDue(cadence.dueInDays ?? undefined) ?? "scheduled"}
        </div>
      ) : null}

      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.cardActionButton}
          disabled={busy}
          title={topFlag ? topFlag.reason : cta.label}
          onClick={() => onRunAction?.(row, cta.actionKind)}
        >
          {cta.label}
        </button>
        <button
          type="button"
          className={styles.cardMoveButton}
          disabled={busy}
          title="Move to stage…"
          onClick={() => onMoveStage?.(row)}
        >
          <ArrowRightLeft size={11} strokeWidth={2} aria-hidden="true" />
          Move
        </button>
      </div>
    </article>
  );
}
