"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import {
  ArrowRightLeft,
  CalendarCheck,
  ChevronRight,
  Mail,
  MailPlus,
  MoreHorizontal,
  PenLine,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  DEAL_FLOW_STAGES,
  UI_V2_REJECTION_REASON_OPTIONS,
  type DealFlowRecommendation,
  type DealFlowRecommendationsResponse,
  type DealFlowStageId,
  type UiV2DealPathDecision,
  type UiV2DealPathState,
  type UiV2RejectionReasonCode,
} from "@re-sourcing/contracts";
import { AgingChip, BrokerContactDialog, Button, Dialog, FileDropzone, PageHeader, PromptMenu, PropertyThumb, StatCard } from "@/components/ui";
import { RecommendationStepper, type StepperKind, type StepperRow } from "./RecommendationStepper";
import { API_BASE, apiFetch } from "@/lib/api";
import styles from "./progress.module.css";
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
  stage?: DealFlowStageId | string | null;
  dealState?: string | null;
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
    | "drafting_loi"
    | "loi_sent_awaiting_response"
    | "negotiation"
    | "contract_signed_diligence"
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
  targetStage?: DealFlowStageId;
  moveLabel?: string;
};

type SavedStatusGroup = {
  id: string;
  label: string;
  description: string;
  statuses: string[];
  targetStage?: DealFlowStageId;
  moveLabel?: string;
};

type MovableSavedStatusGroup = SavedStatusGroup & {
  targetStage: DealFlowStageId;
  moveLabel: string;
};

type DealPathFormState = {
  tourScheduledAt: string;
  tourCompletedAt: string;
  tourBrokerName: string;
  tourNotes: string;
  postTourDecision: UiV2DealPathDecision;
  targetPrice: string;
  offerAmount: string;
  loiRecipientEmail: string;
  offerNotes: string;
  loiContingenciesText: string;
  loiContingencyNotes: string;
  contractSignedAt: string;
  escrowPeriodDays: string;
  escrowStartDate: string;
  escrowEndDate: string;
  diligenceDeadline: string;
  contractNotes: string;
  rejectionReasonCode: UiV2RejectionReasonCode | "";
  rejectionNotes: string;
};

type DealPathPromptMode = "general" | "tour_scheduled" | "tour_completed" | "drafting_loi" | "loi_sent" | "contract_signed_diligence";

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
  drafting_loi: "LOI terms are being drafted and readied for review.",
  loi_sent_awaiting_response: "LOI has been sent and needs response tracking.",
  negotiation: "Pricing, terms, and counterparty negotiation.",
  contract_signed_diligence: "Contract signed with diligence and escrow timing underway.",
  deal_closed: "Closed deals and archived active pursuits.",
};

const SAVED_STATUS_GROUPS: SavedStatusGroup[] = DEAL_FLOW_STAGES.map((stage) => ({
  id: stage.id,
  label: stage.label,
  description: STAGE_DESCRIPTIONS[stage.id] ?? "",
  // The board's sourced/tour-scheduled columns intentionally claim no statuses
  // directly; the server assigns rows to them via deal-path state.
  statuses: stage.id === "sourced" || stage.id === "tour_scheduled" ? [] : [...stage.statuses],
  targetStage: stage.id,
  moveLabel: stage.label,
}));

const MOVE_STAGE_OPTIONS = SAVED_STATUS_GROUPS
  .filter((group): group is MovableSavedStatusGroup =>
    Boolean(group.targetStage && group.moveLabel)
  );
const DEFAULT_BULK_STAGE_ID = MOVE_STAGE_OPTIONS[0]?.id ?? "om_requested";

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatWholeCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
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

function dateInputFromIso(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function todayDateInput(): string {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateInputToPayload(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed;
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
  const rawDealPath = dealPath as (UiV2DealPathState & {
    tourBrokerName?: string | null;
    contractNotes?: string | null;
  }) | null | undefined;
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
    contractSignedAt: dateInputFromIso(dealPath?.contractSignedAt),
    escrowPeriodDays: formValue(dealPath?.escrowPeriodDays),
    escrowStartDate: dateInputFromIso(dealPath?.escrowStartDate),
    escrowEndDate: dateInputFromIso(dealPath?.escrowEndDate),
    diligenceDeadline: dateInputFromIso(dealPath?.diligenceDeadline),
    contractNotes: rawDealPath?.contractNotes ?? "",
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
  if (mode === "drafting_loi" || mode === "loi_sent") {
    return {
      ...form,
      postTourDecision: "move_forward",
      rejectionReasonCode: "",
      rejectionNotes: "",
    };
  }
  if (mode === "contract_signed_diligence") {
    return {
      ...form,
      contractSignedAt: form.contractSignedAt || todayDateInput(),
      escrowStartDate: form.escrowStartDate || todayDateInput(),
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
  const postTourDecision: UiV2DealPathDecision =
    mode === "drafting_loi" || mode === "loi_sent" || mode === "contract_signed_diligence"
      ? "move_forward"
      : form.postTourDecision;
  return {
    tourScheduledAt: dateInputToPayload(form.tourScheduledAt),
    tourCompletedAt: mode === "tour_scheduled" ? null : dateInputToPayload(form.tourCompletedAt),
    tourNotes: [tourBrokerName ? `Broker: ${tourBrokerName}` : null, tourNotes || null].filter(Boolean).join("\n") || null,
    postTourDecision,
    targetPrice: form.targetPrice.trim() || null,
    offerAmount: form.offerAmount.trim() || null,
    offerNotes: [loiRecipientEmail ? `LOI recipient: ${loiRecipientEmail}` : null, offerNotes || null].filter(Boolean).join("\n") || null,
    loiContingencies: form.loiContingenciesText
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean),
    loiContingencyNotes: form.loiContingencyNotes.trim() || null,
    contractSignedAt: dateInputToPayload(form.contractSignedAt),
    escrowPeriodDays: form.escrowPeriodDays.trim() || null,
    escrowStartDate: dateInputToPayload(form.escrowStartDate),
    escrowEndDate: dateInputToPayload(form.escrowEndDate),
    diligenceDeadline: dateInputToPayload(form.diligenceDeadline),
    contractNotes: form.contractNotes.trim() || null,
    rejectionReasonCode: postTourDecision === "reject" ? form.rejectionReasonCode : null,
    rejectionNotes: postTourDecision === "reject" ? form.rejectionNotes.trim() || null : null,
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
    contract_signed_diligence: "Contract Signed / Diligence",
    deal_closed: "Deal Closed",
    dossier_generated: "Dossier Generated",
    drafting_loi: "Drafting LOI",
    loi_sent_awaiting_response: "LOI Sent - Awaiting Response",
    loopnet: "LoopNet",
    offer_review: "Drafting LOI",
    sourced: "Sourced",
    om_received: "OM Received",
    streeteasy: "StreetEasy",
    tour_requested: "Tour Requested",
    tour_scheduled: "Tour Scheduled",
    tour_completed_awaiting_inputs: "Tour Completed",
    underwriting_awaiting_review: "Underwriting - Awaiting User Review",
    underwriting_review_completed: "Underwriting - Review Completed",
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
    case "sourced":
      return summary.savedCount ?? fallback;
    case "om_requested":
    case "outreach":
      return summary.outreachCount ?? fallback;
    case "awaiting_broker":
      return summary.awaitingBrokerCount ?? fallback;
    case "underwriting_awaiting_review":
    case "underwriting_review_completed":
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
  if (
    status === "underwriting" ||
    status === "offer_review" ||
    status === "drafting_loi" ||
    status === "loi_sent_awaiting_response" ||
    status === "negotiation" ||
    status === "awaiting_broker"
  ) {
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

function isDealFlowStageId(value: string | null | undefined): value is DealFlowStageId {
  return Boolean(value && DEAL_FLOW_STAGES.some((stage) => stage.id === value));
}

function stageForRow(row: DealFlowRow): DealFlowStageId {
  const stage = row.stage ?? null;
  if (isDealFlowStageId(stage)) return stage;
  const status = rowStatus(row);
  return DEAL_FLOW_STAGES.find((stage) => stage.statuses.includes(status))?.id ?? "sourced";
}

function moveLabelForStage(stageId: DealFlowStageId): string {
  return MOVE_STAGE_OPTIONS.find((option) => option.targetStage === stageId)?.moveLabel ?? labelFromKey(stageId);
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
      targetStage: group.targetStage,
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

async function patchDealStage(propertyId: string, nextStage: DealFlowStageId): Promise<void> {
  const response = await fetch(`${API_BASE}/api/ui-v2/properties/${propertyId}/stage`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stage: nextStage,
      state: nextStage === "deal_closed" ? "closed" : "active",
      source: "progress_table",
      actorName: "progress_table",
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
  if (!response.ok) throw new Error(data.error || data.details || "Failed to move deal stage.");
}

async function patchDealPath(propertyId: string, dealPath: Record<string, unknown>): Promise<void> {
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
  const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
  if (!response.ok) throw new Error(data.error || data.details || "Failed to update deal path.");
}

async function uploadDealDocument(propertyId: string, file: File, category: string, source: string): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  form.append("category", category);
  form.append("source", source);
  const response = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    details?: string;
    document?: { id?: string | null };
  };
  if (!response.ok) throw new Error(data.error || data.details || `Failed to upload ${category.toLowerCase()} document.`);
  return data.document?.id ?? null;
}

async function uploadLoiDocument(propertyId: string, file: File): Promise<string | null> {
  return uploadDealDocument(propertyId, file, "Other", "Deal Progress LOI upload");
}

async function uploadContractDocument(propertyId: string, file: File): Promise<string | null> {
  return uploadDealDocument(propertyId, file, "Contract", "Deal Progress contract upload");
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
  const [bulkTargetSectionId, setBulkTargetSectionId] = useState<string>(DEFAULT_BULK_STAGE_ID);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(() => new Set());
  const [draggedDeal, setDraggedDeal] = useState<DealFlowRow | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [editingDealPathId, setEditingDealPathId] = useState<string | null>(null);
  const [dealPathPromptMode, setDealPathPromptMode] = useState<DealPathPromptMode>("general");
  const [dealPathForms, setDealPathForms] = useState<Record<string, DealPathFormState>>({});
  const [loiUploadFiles, setLoiUploadFiles] = useState<Record<string, File | null>>({});
  const [contractUploadFiles, setContractUploadFiles] = useState<Record<string, File | null>>({});
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
    setContractUploadFiles({});
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

  const applyRecommendation = useCallback(
    (item: DealFlowRecommendation) => {
      if (item.id === "missing_broker_email" || item.id === "request_oms" || item.id === "om_request_stale") {
        const wanted = new Set(item.propertyIds);
        const rows = sections
          .flatMap((section) => section.rows ?? [])
          .filter((row) => wanted.has(row.propertyId));
        const seen = new Set<string>();
        const stepperRows: StepperRow[] = [];
        for (const row of rows) {
          if (seen.has(row.propertyId)) continue;
          seen.add(row.propertyId);
          stepperRows.push({
            propertyId: row.propertyId,
            address: row.displayAddress || row.canonicalAddress || row.propertyId,
            brokerName: row.brokerName ?? null,
            brokerEmail: row.brokerEmail ?? null,
          });
        }
        if (stepperRows.length > 0) {
          setStepper({ kind: item.id as StepperKind, rows: stepperRows });
          return;
        }
      }
      setBoardFocus({
        label: item.title,
        propertyIds: new Set(item.propertyIds),
        stageId: item.stageId,
      });
    },
    [sections]
  );

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
    async (rows: DealFlowRow[], nextStage: DealFlowStageId, options?: { clearSelection?: boolean }) => {
      const uniqueRows = [...new Map(rows.map((row) => [row.propertyId, row])).values()];
      const rowsToMove = uniqueRows.filter((row) => stageForRow(row) !== nextStage);
      if (rowsToMove.length === 0) return;
      setStageMoveBusy(rowsToMove.length === 1 ? rowsToMove[0].propertyId : BULK_STAGE_MOVE_ID);
      setError(null);
      try {
        const results = await Promise.all(
          rowsToMove.map(async (row) => {
            try {
              await patchDealStage(row.propertyId, nextStage);
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
          const label = moveLabelForStage(nextStage);
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
                tourScheduledAt: null,
                tourCompletedAt: null,
                postTourDecision: "pending",
              });
              await patchDealStage(row.propertyId, "tour_requested");
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

  const dropSavedDeal = useCallback(
    (section: SavedDealSection) => {
      const row = draggedDeal;
      setDraggedDeal(null);
      setDragOverSectionId(null);
      if (!row || !section.targetStage) return;
      const movingSelection = selectedDealIds.has(row.propertyId);
      const loadedRows = sections.flatMap((progressSection) => progressSection.rows ?? []);
      const rowsToMove = movingSelection ? loadedRows.filter((deal) => selectedDealIds.has(deal.propertyId)) : [row];
      if (section.id === "tour_requested") {
        void moveDealsToTourRequested(rowsToMove, { clearSelection: movingSelection });
        return;
      }
      if (section.id === "tour_scheduled") {
        if (rowsToMove.length > 1) {
          setError("Schedule tours one property at a time so each one gets its own date.");
          return;
        }
        startDealPathEdit(row, { mode: "tour_scheduled" });
        return;
      }
      if (section.id === "tour_completed_awaiting_inputs") {
        if (rowsToMove.length > 1) {
          setError("Complete tours one property at a time so each one gets its own notes and decision.");
          return;
        }
        startDealPathEdit(row, { mode: "tour_completed" });
        return;
      }
      if (section.id === "drafting_loi" || section.id === "loi_sent_awaiting_response" || section.id === "contract_signed_diligence") {
        if (rowsToMove.length > 1) {
          setError("Move one property at a time so this stage can capture the required deal details.");
          return;
        }
        const targetRow = rowsToMove[0]!;
        if (section.id === "contract_signed_diligence") startDealPathEdit(targetRow, { mode: "contract_signed_diligence" });
        else startDealPathEdit(targetRow, { mode: section.id === "drafting_loi" ? "drafting_loi" : "loi_sent" });
        return;
      }
      void moveSavedDeals(rowsToMove, section.targetStage, { clearSelection: movingSelection });
    },
    [draggedDeal, moveDealsToTourRequested, moveSavedDeals, sections, selectedDealIds, startDealPathEdit]
  );

  // Same stage-specific behavior as drag-and-drop, but reachable from the
  // card's quick-action menu (tour/LOI stages open their guided prompts).
  const moveRowToSectionId = useCallback(
    (row: DealFlowRow, sectionId: string) => {
      const group = MOVE_STAGE_OPTIONS.find((option) => option.id === sectionId);
      if (!group) return;
      if (sectionId === "tour_requested") {
        void moveDealsToTourRequested([row]);
        return;
      }
      if (sectionId === "tour_scheduled") {
        startDealPathEdit(row, { mode: "tour_scheduled" });
        return;
      }
      if (sectionId === "tour_completed_awaiting_inputs") {
        startDealPathEdit(row, { mode: "tour_completed" });
        return;
      }
      if (sectionId === "drafting_loi" || sectionId === "loi_sent_awaiting_response") {
        startDealPathEdit(row, { mode: sectionId === "drafting_loi" ? "drafting_loi" : "loi_sent" });
        return;
      }
      if (sectionId === "contract_signed_diligence") {
        startDealPathEdit(row, { mode: "contract_signed_diligence" });
        return;
      }
      void moveSavedDeals([row], group.targetStage);
    },
    [moveDealsToTourRequested, moveSavedDeals, startDealPathEdit]
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
    if (bulkTargetGroup.id === "tour_scheduled") {
      if (selectedSavedDeals.length !== 1) {
        setError("Select one property at a time when scheduling a tour so you can add the date.");
        return;
      }
      startDealPathEdit(selectedSavedDeals[0]!, { mode: "tour_scheduled" });
      return;
    }
    if (bulkTargetGroup.id === "tour_completed_awaiting_inputs") {
      if (selectedSavedDeals.length !== 1) {
        setError("Select one property at a time when completing a tour so you can add notes and a decision.");
        return;
      }
      startDealPathEdit(selectedSavedDeals[0]!, { mode: "tour_completed" });
      return;
    }
    if (bulkTargetGroup.id === "drafting_loi" || bulkTargetGroup.id === "loi_sent_awaiting_response" || bulkTargetGroup.id === "contract_signed_diligence") {
      if (selectedSavedDeals.length !== 1) {
        setError("Select one property at a time so this stage can capture the required deal details.");
        return;
      }
      startDealPathEdit(selectedSavedDeals[0]!, {
        mode:
          bulkTargetGroup.id === "contract_signed_diligence"
            ? "contract_signed_diligence"
            : bulkTargetGroup.id === "drafting_loi"
              ? "drafting_loi"
              : "loi_sent",
      });
      return;
    }
    void moveSavedDeals(selectedSavedDeals, bulkTargetGroup.targetStage, { clearSelection: true });
  }, [bulkTargetGroup, moveDealsToTourRequested, moveSavedDeals, selectedSavedDeals, startDealPathEdit]);

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
      const contractFile = contractUploadFiles[row.propertyId] ?? null;
      if (mode === "tour_scheduled" && !form.tourScheduledAt.trim()) {
        setError("Add a tour date before moving this property to Tour Scheduled.");
        return;
      }
      if (mode === "tour_completed" && !form.tourCompletedAt.trim()) {
        setError("Add the completed tour date before moving this property to Tour Completed.");
        return;
      }
      if (mode === "tour_completed" && !form.tourNotes.trim()) {
        setError("Add tour notes before moving this property to Tour Completed.");
        return;
      }
      if (
        mode === "drafting_loi" &&
        !form.targetPrice.trim() &&
        !form.offerAmount.trim() &&
        !form.offerNotes.trim() &&
        !form.loiContingenciesText.trim()
      ) {
        setError("Add target pricing, offer amount, draft notes, or contingencies before moving to Drafting LOI.");
        return;
      }
      if (
        mode === "loi_sent" &&
        !form.offerAmount.trim() &&
        !form.offerNotes.trim() &&
        !form.loiRecipientEmail.trim() &&
        loiFile == null
      ) {
        setError("Add offer notes, an offer amount, recipient context, or upload the LOI PDF before moving to LOI Sent.");
        return;
      }
      if (mode === "contract_signed_diligence") {
        const hasExistingContract = Boolean(row.dealPath?.contractDocumentId);
        const escrowPeriodDays = Number(form.escrowPeriodDays);
        if (!hasExistingContract && contractFile == null) {
          setError("Upload the signed contract before moving to Contract Signed / Diligence.");
          return;
        }
        if (!form.contractSignedAt.trim()) {
          setError("Add the contract signed date before moving to Contract Signed / Diligence.");
          return;
        }
        if (!form.escrowPeriodDays.trim() || !Number.isFinite(escrowPeriodDays) || escrowPeriodDays <= 0) {
          setError("Add the escrow period timing before moving to Contract Signed / Diligence.");
          return;
        }
        if (!form.escrowStartDate.trim()) {
          setError("Add the escrow start date before moving to Contract Signed / Diligence.");
          return;
        }
        if (!form.escrowEndDate.trim() && !form.diligenceDeadline.trim()) {
          setError("Add the escrow end date or diligence deadline before moving to Contract Signed / Diligence.");
          return;
        }
      }
      if (mode === "loi_sent" && loiFile == null && !form.loiRecipientEmail.trim()) {
        setError("Add the LOI recipient or upload the sent LOI before moving to LOI Sent.");
        return;
      }
      if (form.postTourDecision === "reject" && !form.rejectionReasonCode) {
        setError("Choose a rejection reason before rejecting after a tour.");
        return;
      }
      setDealPathSavingId(row.propertyId);
      setError(null);
      setNotice(null);
      try {
        let contractDocumentId: string | null = null;
        if (mode === "loi_sent" && loiFile) await uploadLoiDocument(row.propertyId, loiFile);
        if (mode === "contract_signed_diligence" && contractFile) {
          contractDocumentId = await uploadContractDocument(row.propertyId, contractFile);
        }
        await patchDealPath(row.propertyId, {
          ...dealPathPayload(form, mode),
          ...(contractDocumentId ? { contractDocumentId } : {}),
        });
        if (mode === "tour_scheduled") await patchDealStage(row.propertyId, "tour_scheduled");
        if (mode === "tour_completed" && form.postTourDecision !== "reject") {
          await patchDealStage(
            row.propertyId,
            form.postTourDecision === "move_forward" ? "drafting_loi" : "tour_completed_awaiting_inputs"
          );
        }
        if (mode === "drafting_loi") await patchDealStage(row.propertyId, "drafting_loi");
        if (mode === "loi_sent") await patchDealStage(row.propertyId, "loi_sent_awaiting_response");
        if (mode === "contract_signed_diligence") await patchDealStage(row.propertyId, "contract_signed_diligence");
        setNotice(form.postTourDecision === "reject" ? "Property rejected after tour." : "Deal path updated.");
        setEditingDealPathId(null);
        setDealPathPromptMode("general");
        setLoiUploadFiles((current) => {
          if (!(row.propertyId in current)) return current;
          const next = { ...current };
          delete next[row.propertyId];
          return next;
        });
        setContractUploadFiles((current) => {
          if (!(row.propertyId in current)) return current;
          const next = { ...current };
          delete next[row.propertyId];
          return next;
        });
        await loadProgress("refresh");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update deal path.");
      } finally {
        setDealPathSavingId(null);
      }
    },
    [contractUploadFiles, dealPathForms, dealPathPromptMode, loadProgress, loiUploadFiles]
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
          targetStage: group?.targetStage,
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

  const recommendationItems = recommendations.data?.items ?? [];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Deal movement"
        title="Deal Progress"
        subtitle="Move every saved deal from OM request to close — same stages as the home funnel."
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

      <section className={styles.nextActions} aria-label="What to do next">
        <div className={styles.nextActionsHeader}>
          <span className={styles.nextActionsIcon} aria-hidden="true">
            <Sparkles size={15} strokeWidth={2} />
          </span>
          <div className={styles.nextActionsCopy}>
            <h2>What to do next</h2>
            <p>
              {recommendations.loading && !recommendations.data
                ? "Reviewing the board…"
                : recommendations.data?.headline ?? "Recommendations are unavailable right now."}
            </p>
          </div>
          {recommendations.data?.source === "rules" ? (
            <span
              className={styles.nextActionsSource}
              title="Generated by the rule engine — set OPENAI_API_KEY to enable LLM phrasing and prioritization."
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
        {recommendationItems.length > 0 ? (
          <div className={styles.nextActionsItems}>
            {recommendationItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.nextActionChip} ${boardFocus?.label === item.title ? styles.nextActionChipActive : ""}`}
                title={item.detail ?? undefined}
                onClick={() => applyRecommendation(item)}
              >
                <strong>{item.title}</strong>
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
              onClick={() => scrollToColumn(section.id)}
            />
          );
        })}
      </section>

      <section className={`${styles.savedFlowPanel} ${styles.dealBoardPanel}`} aria-label="Deal path by stage">
        <div className={styles.savedFlowHeader}>
          <div>
            <h2>Deal Path by Stage</h2>
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
        <div className={styles.flowSections}>
          {savedStatusSections.map((section, sectionIndex) => (
            <SavedDealMiniSection
              key={section.id}
              leadingArrow={sectionIndex > 0}
              flash={flashColumnId === section.id}
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
                if (!section.targetStage || draggedDeal == null) return;
                event.preventDefault();
                setDragOverSectionId(section.id);
              }}
              onDropOnSection={() => dropSavedDeal(section)}
              editingPropertyId={editingDealPathId}
              onStartDealPathEdit={startDealPathEdit}
              onCancelDealPathEdit={closeDealPathEdit}
              onStartReject={startReject}
              onEmailBroker={(row, intent) => void openEmailComposer(row, intent)}
              onAddBrokerEmail={openBrokerEmailDialog}
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
          promptMode={dealPathPromptMode}
          loiFile={loiUploadFiles[editingDealPathRow.propertyId] ?? null}
          contractFile={contractUploadFiles[editingDealPathRow.propertyId] ?? null}
          saving={dealPathSavingId === editingDealPathRow.propertyId}
          onUpdate={updateDealPathField}
          onLoiFileChange={(file) =>
            setLoiUploadFiles((current) => ({
              ...current,
              [editingDealPathRow.propertyId]: file,
            }))
          }
          onContractFileChange={(file) =>
            setContractUploadFiles((current) => ({
              ...current,
              [editingDealPathRow.propertyId]: file,
            }))
          }
          onCancel={closeDealPathEdit}
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
          <div><dt>Enter</dt><dd>Open deal inputs</dd></div>
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

function DealPathModal({
  row,
  form,
  promptMode,
  loiFile,
  contractFile,
  saving,
  onUpdate,
  onLoiFileChange,
  onContractFileChange,
  onCancel,
  onSave,
}: {
  row: DealFlowRow;
  form: DealPathFormState;
  promptMode: DealPathPromptMode;
  loiFile?: File | null;
  contractFile?: File | null;
  saving: boolean;
  onUpdate: <K extends keyof DealPathFormState>(propertyId: string, field: K, value: DealPathFormState[K]) => void;
  onLoiFileChange: (file: File | null) => void;
  onContractFileChange: (file: File | null) => void;
  onCancel?: () => void;
  onSave: (row: DealFlowRow, event: FormEvent<HTMLFormElement>) => void;
}) {
  const isTourScheduledPrompt = promptMode === "tour_scheduled";
  const isTourCompletedPrompt = promptMode === "tour_completed";
  const isDraftingLoiPrompt = promptMode === "drafting_loi";
  const isLoiSentPrompt = promptMode === "loi_sent";
  const isLoiPrompt = isDraftingLoiPrompt || isLoiSentPrompt;
  const isContractPrompt = promptMode === "contract_signed_diligence";
  const showGeneralTourFields = promptMode === "general";
  const title =
    isTourScheduledPrompt ? "Schedule tour" :
    isTourCompletedPrompt ? "Complete tour" :
    isDraftingLoiPrompt ? "Drafting LOI" :
    isLoiSentPrompt ? "LOI sent" :
    isContractPrompt ? "Contract signed / diligence" :
    "Deal path";
  const submitLabel =
    saving ? "Saving..." :
    form.postTourDecision === "reject" ? "Save rejection" :
    isTourScheduledPrompt ? "Save tour date" :
    isTourCompletedPrompt ? "Save tour notes" :
    isDraftingLoiPrompt ? "Save LOI draft" :
    isLoiSentPrompt ? "Save sent LOI" :
    isContractPrompt ? "Move to diligence" :
    "Save deal path";
  return (
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onCancel}>
      <form
        className={styles.dealPathModal}
        onSubmit={(event) => onSave(row, event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalKicker}>{title}</span>
            <h2>{row.displayAddress || row.canonicalAddress || row.propertyId}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={onCancel} aria-label="Close deal path modal">
            x
          </button>
        </div>
        <div className={styles.dealPathModalGrid}>
          {isTourScheduledPrompt || showGeneralTourFields ? (
          <label>
            <span>Tour date</span>
            <input
              type="date"
              value={form.tourScheduledAt}
              required={isTourScheduledPrompt}
              onChange={(event) => onUpdate(row.propertyId, "tourScheduledAt", event.target.value)}
            />
          </label>
          ) : null}
          {showGeneralTourFields ? (
          <label>
            <span>Tour broker</span>
            <input
              value={form.tourBrokerName}
              onChange={(event) => onUpdate(row.propertyId, "tourBrokerName", event.target.value)}
              placeholder="Broker or agent name"
            />
          </label>
          ) : null}
          {isTourCompletedPrompt || showGeneralTourFields ? (
          <label>
            <span>Tour completed date</span>
            <input
              type="date"
              value={form.tourCompletedAt}
              required={isTourCompletedPrompt}
              onChange={(event) => onUpdate(row.propertyId, "tourCompletedAt", event.target.value)}
            />
          </label>
          ) : null}
          {isTourCompletedPrompt || showGeneralTourFields ? (
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
          ) : null}
          {isLoiPrompt || isTourCompletedPrompt || showGeneralTourFields ? (
          <label>
            <span>Target price</span>
            <input
              inputMode="numeric"
              value={form.targetPrice}
              onChange={(event) => onUpdate(row.propertyId, "targetPrice", event.target.value)}
              placeholder="Target pricing"
            />
          </label>
          ) : null}
          {isLoiPrompt || isTourCompletedPrompt || showGeneralTourFields ? (
          <label>
            <span>Offer amount</span>
            <input
              inputMode="numeric"
              value={form.offerAmount}
              onChange={(event) => onUpdate(row.propertyId, "offerAmount", event.target.value)}
              placeholder="LOI offer"
            />
          </label>
          ) : null}
          {isTourCompletedPrompt || showGeneralTourFields ? (
          <label className={styles.dealPathWideField}>
            <span>Tour notes</span>
            <textarea
              value={form.tourNotes}
              onChange={(event) => onUpdate(row.propertyId, "tourNotes", event.target.value)}
              placeholder="Tour takeaways, condition, broker comments, follow-up questions"
            />
          </label>
          ) : null}
          {isLoiPrompt ? (
            <>
              <label>
                <span>LOI recipient / email</span>
                <input
                  value={form.loiRecipientEmail}
                  onChange={(event) => onUpdate(row.propertyId, "loiRecipientEmail", event.target.value)}
                  placeholder="Broker, seller, or recipient email"
                />
              </label>
              {isLoiSentPrompt ? (
                <div className={styles.loiUploadField}>
                  <span>Upload sent LOI</span>
                  <FileDropzone
                    files={loiFile ? [loiFile] : []}
                    onChange={(files) => onLoiFileChange(files[0] ?? null)}
                    accept=".pdf,.doc,.docx"
                    maxFiles={1}
                  />
                </div>
              ) : null}
              <GenerateLoiButton
                propertyId={row.propertyId}
                offerAmount={form.offerAmount}
                targetPrice={form.targetPrice}
                contingenciesText={form.loiContingenciesText}
                notes={form.offerNotes}
              />
            </>
          ) : null}
          {isContractPrompt ? (
            <>
              <div className={styles.loiUploadField}>
                <span>Signed contract</span>
                <FileDropzone
                  files={contractFile ? [contractFile] : []}
                  onChange={(files) => onContractFileChange(files[0] ?? null)}
                  accept=".pdf,.doc,.docx"
                  maxFiles={1}
                />
              </div>
              <label>
                <span>Contract signed date</span>
                <input
                  type="date"
                  value={form.contractSignedAt}
                  required
                  onChange={(event) => onUpdate(row.propertyId, "contractSignedAt", event.target.value)}
                />
              </label>
              <label>
                <span>Escrow period days</span>
                <input
                  inputMode="numeric"
                  value={form.escrowPeriodDays}
                  required
                  onChange={(event) => onUpdate(row.propertyId, "escrowPeriodDays", event.target.value)}
                  placeholder="30"
                />
              </label>
              <label>
                <span>Escrow start date</span>
                <input
                  type="date"
                  value={form.escrowStartDate}
                  required
                  onChange={(event) => onUpdate(row.propertyId, "escrowStartDate", event.target.value)}
                />
              </label>
              <label>
                <span>Escrow end date</span>
                <input
                  type="date"
                  value={form.escrowEndDate}
                  onChange={(event) => onUpdate(row.propertyId, "escrowEndDate", event.target.value)}
                />
              </label>
              <label>
                <span>Diligence deadline</span>
                <input
                  type="date"
                  value={form.diligenceDeadline}
                  onChange={(event) => onUpdate(row.propertyId, "diligenceDeadline", event.target.value)}
                />
              </label>
              <label className={styles.dealPathWideField}>
                <span>Diligence notes</span>
                <textarea
                  value={form.contractNotes}
                  onChange={(event) => onUpdate(row.propertyId, "contractNotes", event.target.value)}
                  placeholder="Escrow notes, diligence requirements, deposit timing, contract caveats"
                />
              </label>
            </>
          ) : null}
          {isLoiPrompt || isTourCompletedPrompt || showGeneralTourFields ? (
          <label className={styles.dealPathWideField}>
            <span>{isLoiPrompt ? "LOI offer notes" : "Offer notes"}</span>
            <textarea
              value={form.offerNotes}
              onChange={(event) => onUpdate(row.propertyId, "offerNotes", event.target.value)}
              placeholder="Rationale for offer, pricing read, partner feedback"
            />
          </label>
          ) : null}
          {isLoiPrompt || showGeneralTourFields ? (
          <label className={styles.dealPathWideField}>
            <span>LOI contingencies</span>
            <textarea
              value={form.loiContingenciesText}
              onChange={(event) => onUpdate(row.propertyId, "loiContingenciesText", event.target.value)}
              placeholder="Financing contingency, diligence period, rent roll verification"
            />
          </label>
          ) : null}
          {isLoiPrompt || showGeneralTourFields ? (
          <label className={styles.dealPathWideField}>
            <span>LOI contingency notes</span>
            <textarea
              value={form.loiContingencyNotes}
              onChange={(event) => onUpdate(row.propertyId, "loiContingencyNotes", event.target.value)}
              placeholder="Timing, diligence needs, third-party reports, deposit terms"
            />
          </label>
          ) : null}
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
            {submitLabel}
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
    row.pricePerSqft != null ? { label: "$/SF", value: formatWholeCurrency(row.pricePerSqft) } : null,
    row.sqft != null ? { label: "SF", value: formatCompactNumber(row.sqft) } : null,
    row.price != null ? { label: "Ask", value: formatCurrency(row.price) } : null,
    row.units != null ? { label: "Units", value: formatCompactNumber(row.units) } : null,
  ].filter((metric): metric is { label: string; value: string } => metric != null);
}

type PrimaryCardAction = { label: string; run: () => void };

function primaryActionForCard(
  sectionId: string,
  row: DealFlowRow,
  handlers: {
    onStartDealPathEdit?: (row: DealFlowRow, options?: { mode?: DealPathPromptMode }) => void;
    onEmailBroker?: (row: DealFlowRow, intent: "email" | "request_om") => void;
    onAddBrokerEmail?: (row: DealFlowRow) => void;
  }
): PrimaryCardAction {
  if (sectionId === "sourced") {
    return row.brokerEmail
      ? { label: "Request OM", run: () => handlers.onEmailBroker?.(row, "request_om") }
      : { label: "Add broker email", run: () => handlers.onAddBrokerEmail?.(row) };
  }
  if (sectionId === "om_requested") {
    return row.brokerEmail
      ? { label: "Follow up", run: () => handlers.onEmailBroker?.(row, "email") }
      : { label: "Add broker email", run: () => handlers.onAddBrokerEmail?.(row) };
  }
  if (sectionId === "tour_requested") {
    return { label: "Confirm tour", run: () => handlers.onStartDealPathEdit?.(row, { mode: "tour_scheduled" }) };
  }
  if (sectionId === "tour_scheduled") {
    return { label: "Mark toured", run: () => handlers.onStartDealPathEdit?.(row, { mode: "tour_completed" }) };
  }
  if (sectionId === "tour_completed_awaiting_inputs") {
    return { label: "Add outcomes", run: () => handlers.onStartDealPathEdit?.(row, { mode: "tour_completed" }) };
  }
  if (sectionId === "drafting_loi") {
    return { label: "Draft LOI", run: () => handlers.onStartDealPathEdit?.(row, { mode: "drafting_loi" }) };
  }
  if (sectionId === "loi_sent_awaiting_response") {
    return { label: "Update LOI", run: () => handlers.onStartDealPathEdit?.(row, { mode: "loi_sent" }) };
  }
  if (sectionId === "contract_signed_diligence") {
    return { label: "Update diligence", run: () => handlers.onStartDealPathEdit?.(row, { mode: "contract_signed_diligence" }) };
  }
  return { label: "Update inputs", run: () => handlers.onStartDealPathEdit?.(row) };
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
  onEmailBroker,
  onAddBrokerEmail,
  onMoveStage,
  focusedCardId = null,
  leadingArrow = false,
  flash = false,
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
  onStartDealPathEdit?: (row: DealFlowRow, options?: { mode?: DealPathPromptMode }) => void;
  onCancelDealPathEdit?: () => void;
  onStartReject?: (row: DealFlowRow) => void;
  onEmailBroker?: (row: DealFlowRow, intent: "email" | "request_om") => void;
  onAddBrokerEmail?: (row: DealFlowRow) => void;
  onMoveStage?: (row: DealFlowRow) => void;
  focusedCardId?: string | null;
  leadingArrow?: boolean;
  flash?: boolean;
}) {
  const visibleRows = compact ? section.rows.slice(0, 5) : section.rows;
  const isEmpty = !loading && visibleRows.length === 0;
  const askTotal = section.rows.reduce((sum, row) => sum + (row.price ?? 0), 0);
  return (
    <>
    {leadingArrow ? (
      <span className={styles.flowArrow} aria-hidden="true">
        <ChevronRight size={17} strokeWidth={2.2} />
      </span>
    ) : null}
    <section
      id={`board-column-${section.id}`}
      className={`${styles.miniSection} ${dragOver ? styles.miniSectionDropTarget : ""} ${isEmpty ? styles.miniSectionEmpty : ""} ${flash ? styles.miniSectionFlash : ""}`}
      data-stage-id={section.id}
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
      <div className={styles.miniSectionHeader} title={section.description}>
        <div className={styles.miniSectionTitleBlock}>
          <small className={styles.miniSectionKicker}>Stage</small>
          <h3>{section.label}</h3>
        </div>
        <div className={styles.miniSectionStats}>
          <span aria-label={`${section.rows.length} deals`}>{section.rows.length}</span>
          {askTotal > 0 ? <small className={styles.miniSectionTotal}>{formatCurrency(askTotal)}</small> : null}
        </div>
      </div>
      {loading ? (
        <div className={styles.emptyState}>Loading deal path...</div>
      ) : visibleRows.length === 0 ? (
        <div className={styles.emptyState}>Empty</div>
      ) : (
        <div className={styles.miniRows}>
          {visibleRows.map((row) => {
            const selected = selectedDealIds?.has(row.propertyId) ?? false;
            const busy = bulkMoving || movingPropertyId === row.propertyId;
            const editing = editingPropertyId === row.propertyId;
            const tourNeedsInputs = needsTourInputs(row);
            const metrics = cardMetricsForRow(row).slice(0, 4);
            const address = row.displayAddress || row.canonicalAddress || row.propertyId;
            const locationLine = [row.neighborhood, formatUnitLabel(row.units)].filter(Boolean).join(" · ");
            const primaryAction = primaryActionForCard(section.id, row, {
              onStartDealPathEdit,
              onEmailBroker,
              onAddBrokerEmail,
            });
            const keyboardFocused = focusedCardId === row.propertyId;
            return (
              <article
                key={`${section.id}-${row.propertyId}`}
                ref={keyboardFocused ? (node) => node?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
                className={`${styles.miniRow} ${selected ? styles.miniRowSelected : ""} ${busy ? styles.miniRowBusy : ""} ${
                  tourNeedsInputs ? styles.miniRowNeedsInput : ""
                } ${keyboardFocused ? styles.miniRowFocused : ""}`}
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
                      aria-label={`Select ${address}`}
                      checked={selected}
                      disabled={busy}
                      onChange={(event) => onToggleSelected?.(row.propertyId, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : null}
                  <PropertyThumb src={row.firstImageUrl} alt={address} size="lg" className={styles.miniThumb} />
                  <button
                    type="button"
                    className={styles.miniRowLink}
                    onClick={() => onStartDealPathEdit?.(row)}
                    title="Review progress details"
                  >
                    <strong>{address}</strong>
                    <span>{locationLine || (row.source ? labelFromKey(row.source) : "No source")}</span>
                  </button>
                  <div className={styles.miniMeta}>
                    <small className={scoreClass(row.dealScore)}>
                      {row.dealScore == null ? "—" : Math.round(row.dealScore)}
                    </small>
                    <AgingChip since={row.stageEnteredAt} className={styles.agingChip} />
                    {!row.brokerEmail ? (
                      <button
                        type="button"
                        className={styles.brokerMissing}
                        title="No broker email on file — click to add"
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddBrokerEmail?.(row);
                        }}
                      >
                        <MailPlus size={12} strokeWidth={2} aria-hidden="true" />
                        <span>No email</span>
                      </button>
                    ) : null}
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
                      title={primaryAction.label}
                      onClick={() => (editing ? onCancelDealPathEdit?.() : primaryAction.run())}
                    >
                      {primaryAction.label}
                    </button>
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
                          <MoreHorizontal size={15} strokeWidth={2} aria-hidden="true" />
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
                        ...(section.id === "sourced" && row.brokerEmail
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
                          label: "Update inputs",
                          hint: "Tour dates, offers, LOI",
                          icon: PenLine,
                          onSelect: () => onStartDealPathEdit?.(row),
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
    </>
  );
}

function GenerateLoiButton({ propertyId, offerAmount, targetPrice, contingenciesText, notes }: {
  propertyId: string;
  offerAmount: string;
  targetPrice: string;
  contingenciesText: string;
  notes: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ fileName: string; downloadPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effectiveOffer = Number((offerAmount || targetPrice).replace(/[$,\s]/g, ""));
  const canGenerate = Number.isFinite(effectiveOffer) && effectiveOffer > 0;

  async function generate() {
    if (!canGenerate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/ui-v2/properties/${encodeURIComponent(propertyId)}/loi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          offerAmount: effectiveOffer,
          contingencies: contingenciesText
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean),
          notes: notes.trim() || undefined,
          actorName: "progress_board",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        fileName?: string;
        downloadPath?: string;
        error?: string;
        details?: string;
      };
      if (!response.ok || data.error || !data.downloadPath) {
        throw new Error(data.details || data.error || "Failed to generate LOI.");
      }
      setResult({ fileName: data.fileName ?? "LOI.pdf", downloadPath: data.downloadPath });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate LOI.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.loiGenerate}>
      <button
        type="button"
        className={styles.loiGenerateButton}
        onClick={generate}
        disabled={!canGenerate || busy}
        title={canGenerate ? "Generate a standard LOI PDF at this offer" : "Enter an offer amount or target price first"}
      >
        {busy ? "Generating LOI..." : "Generate LOI PDF"}
      </button>
      {result ? (
        <a href={`${API_BASE}${result.downloadPath}`} target="_blank" rel="noreferrer" className={styles.loiGenerateLink}>
          Download {result.fileName}
        </a>
      ) : null}
      {error ? <span className={styles.loiGenerateError}>{error}</span> : null}
    </div>
  );
}
