"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailPlus, Star, X } from "lucide-react";
import { BrokerContactDialog, ConfirmDialog, FileDropzone, StageChip, type BrokerSearchCandidate } from "@/components/ui";
import { useProcessBanner } from "@/components/ProcessBanner";
import { runBulkPropertyAction } from "@/lib/bulkPropertyActions";
import {
  UI_V2_PIPELINE_STATUS_OPTIONS,
  UI_V2_REJECTION_REASON_OPTIONS,
  type UiV2ActionSurface,
  type UiV2BrokerBlock,
  type UiV2CrmContactPayload,
  type UiV2DealPathDecision,
  type UiV2DealPathState,
  type UiV2ImageAsset,
  type UiV2MarketType,
  type UiV2OutreachComposerPayload,
  type UiV2OutreachDraftPayload,
  type UiV2OutreachSendNowPayload,
  type UiV2OutreachTemplatePayload,
  type UiV2PipelineListPayload,
  type UiV2PipelineRow,
  type UiV2PipelineSortField,
  type UiV2PropertyDocumentItem,
  type UiV2PipelineStatus,
  type UiV2PropertyDetailPayload,
  type UiV2RejectionReasonCode,
  type UiV2DetailItem,
  type UiV2EnrichmentDetailPayload,
  type UiV2EnrichmentState,
  type UiV2EnrichmentModuleDetail,
  type UiV2ListingFactsPayload,
  type UiV2OmAnalysisPayload,
  type UiV2RentalFlowPayload,
  type UiV2StatusChipTone,
  type BulkInquiryPreviewBatch,
} from "@re-sourcing/contracts";
import {
  plannedBrokerCompReviewEndpoint,
  plannedBrokerCompUploadEndpoint,
  readBrokerCompSurface,
  type BrokerCompUiSurface,
} from "../property-data/brokerComps";
import styles from "./PipelinePage.module.css";
import { API_BASE, apiFetch } from "@/lib/api";
import { EMPTY_VALUE, formatPercent } from "@/lib/format";

const PIPELINE_PATH = "/pipeline";

const SORT_OPTIONS: Array<{ value: UiV2PipelineSortField; label: string }> = [
  { value: "updatedAt", label: "Updated" },
  { value: "lastActivityAt", label: "Activity" },
  { value: "dealScore", label: "Score" },
  { value: "askingPrice", label: "Ask" },
  { value: "buildingSqft", label: "SF" },
  { value: "pricePerSqft", label: "$/SF" },
  { value: "units", label: "Units" },
  { value: "mtrYocPct", label: "YoC MTR" },
  { value: "ltrYocPct", label: "YoC LTR" },
  { value: "canonicalAddress", label: "Address" },
  { value: "source", label: "Source" },
  { value: "marketType", label: "Type" },
  { value: "status", label: "Status" },
  { value: "omStatus", label: "OM" },
  { value: "listedAt", label: "Date Listed" },
  { value: "createdAt", label: "Date Added" },
];

const SOURCE_LABELS: Record<string, string> = {
  streeteasy: "StreetEasy",
  nyc_api: "StreetEasy",
  rapidapi: "RapidAPI",
  loopnet: "LoopNet",
  manual: "Manual",
  other: "Other",
};

const MARKET_TYPE_OPTIONS: Array<{ value: UiV2MarketType; label: string }> = [
  { value: "on_market", label: "On Market" },
  { value: "off_market", label: "Off Market" },
  { value: "unknown", label: "Unknown" },
];

const COMMON_PIPELINE_TAGS = [
  "high_priority",
  "free_market",
  "below_replacement",
  "mtr_candidate",
  "broker_relationship",
  "tax_advantage",
  "distressed_seller",
  "needs_om",
  "needs_rent_roll",
  "needs_city_data",
  "rent_stab_risk",
  "follow_up",
  "partner_review",
  "toured",
  "tour_scheduled",
  "tour_inputs_needed",
  "offer_candidate",
  "duplicate",
] as const;

const SHEET_TABS = ["Overview", "Enrichment", "OM / Docs", "Market / Comps", "Underwriting", "Activity"] as const;

const LISTING_PULL_TOGGLE_KEY = "sourcing-os.pipeline.include-listing-pull";

type SheetTab = (typeof SHEET_TABS)[number];
type SortDirection = "asc" | "desc";

function tabFromParam(value: string | null): SheetTab | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "overview") return "Overview";
  if (normalized === "dealpath" || normalized === "tour" || normalized === "tours") return "Activity";
  if (normalized === "enrichment") return "Enrichment";
  if (normalized === "om" || normalized === "omdocs" || normalized === "docs") return "OM / Docs";
  if (normalized === "market" || normalized === "marketcomps" || normalized === "comps") return "Market / Comps";
  if (normalized === "underwriting") return "Underwriting";
  if (normalized === "activity") return "Activity";
  return null;
}

type PipelineRow = UiV2PipelineRow & {
  documents?: UiV2PropertyDocumentItem[];
  gallery?: UiV2ImageAsset[];
  overview?: { gallery?: UiV2ImageAsset[]; listingUrl?: string | null };
};

type FlexiblePropertyDetail = UiV2PropertyDetailPayload & {
  gallery?: UiV2ImageAsset[];
  overview: UiV2PropertyDetailPayload["overview"] & { gallery?: UiV2ImageAsset[] };
};

type OutreachPreviewBatch = BulkInquiryPreviewBatch;

type OutreachPreviewSkipped = {
  propertyId: string;
  canonicalAddress: string;
  reasonCode: string;
  reason: string;
};

type RowActionMenuState = {
  propertyId: string;
  top: number;
  right: number;
};

type RowDownloadAction = {
  key: "om" | "comps" | "dossier" | "excel";
  label: string;
  url: string | null;
  fileName?: string | null;
  title: string;
};

type TrackerTone = "complete" | "pending" | "warning" | "failed" | "neutral";

interface PipelineTrackerItem {
  key: "comps" | "om" | "uw";
  label: string;
  tone: TrackerTone;
  title: string;
}

const EMPTY_ENRICHMENT_STATE: UiV2EnrichmentState = {
  status: "not_started",
  completedKeys: [],
  pendingKeys: [],
  failedKeys: [],
  lastRefreshedAt: null,
  errorMessage: null,
};

type PipelineHeaderMenuId =
  | "address"
  | "stage"
  | "source"
  | "propertyType"
  | "marketType"
  | "askingPrice"
  | "listedAt"
  | "createdAt"
  | "updatedAt"
  | "buildingSqft"
  | "pricePerSqft"
  | "units"
  | "ltrYocPct"
  | "mtrYocPct"
  | "dealScore"
  | "status"
  | "om"
  | "enrichment"
  | "flow"
  | "tags"
  | "actions";

const COLUMN_SORT_FIELDS: Partial<Record<PipelineHeaderMenuId, UiV2PipelineSortField>> = {
  address: "canonicalAddress",
  source: "source",
  propertyType: "propertyType",
  marketType: "marketType",
  askingPrice: "askingPrice",
  listedAt: "listedAt",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  buildingSqft: "buildingSqft",
  pricePerSqft: "pricePerSqft",
  units: "units",
  ltrYocPct: "ltrYocPct",
  mtrYocPct: "mtrYocPct",
  dealScore: "dealScore",
  status: "status",
  om: "omStatus",
  flow: "lastActivityAt",
};

const COMP_DOCUMENT_CATEGORIES = new Set([
  "Broker Comp Package",
  "Sale Comp Package",
  "Rent Comp Package",
  "Expense Comp Package",
  "Market Analysis",
]);

interface PipelineResponse {
  pipeline: UiV2PipelineListPayload;
}

interface PropertyResponse {
  property: FlexiblePropertyDetail | null;
}

interface MergePropertyResponse extends PropertyResponse {
  merged?: {
    sourcePropertyId: string;
    targetPropertyId: string;
    reassignedRows?: Record<string, number>;
  };
}

interface BrokerResponse {
  broker: UiV2BrokerBlock | null;
}

interface ComposerResponse {
  composer: UiV2OutreachComposerPayload;
}

interface OutreachDraftResponse {
  draft: UiV2OutreachDraftPayload;
}

interface OutreachTemplatesResponse {
  templates: UiV2OutreachTemplatePayload[];
}

interface OutreachTemplateResponse {
  template: UiV2OutreachTemplatePayload;
}

interface DossierGenerateResponse {
  ok?: boolean;
  propertyId?: string;
  dealScore?: number | null;
  omRefresh?: { status?: "promoted" | "skipped" | "failed"; error?: string } | null;
  workbookAudit?: { status?: "pass" | "warnings" | "failed" } | null;
  error?: string;
  details?: string;
}

interface OmRefreshResponse {
  ok?: boolean;
  documentsProcessed?: number;
  documentsSkippedNoFile?: number;
  status?: "needs_review" | "promoted" | "failed" | null;
  reviewRequired?: boolean;
  underwritingRefreshed?: boolean;
  error?: string;
  details?: string;
}

interface ListingRefreshResponse {
  ok?: boolean;
  streetEasyRefresh?: {
    attempted?: number;
    success?: number;
    failed?: number;
    skipped?: number;
    priceChanged?: number;
    unavailable?: number;
    errors?: string[];
  };
  error?: string;
  details?: string;
}

interface BrokerCompPackagesResponse {
  propertyId?: string;
  packages?: unknown[];
  packageDetails?: unknown[];
  package?: unknown;
  extractedItems?: unknown[];
  pages?: unknown[];
  promotedItems?: unknown[];
  document?: unknown;
}

interface BrokerFormState {
  name: string;
  email: string;
  phone: string;
  firm: string;
  notes: string;
}

interface SourceFactsFormState {
  askingPrice: string;
  units: string;
  buildingSqft: string;
  bedrooms: string;
  bathrooms: string;
  neighborhood: string;
  borough: string;
  listingStatus: string;
  propertyType: string;
  yearBuilt: string;
}

interface DealPathFormState {
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
}

interface RejectState {
  propertyId: string;
  propertyIds?: string[];
  address: string;
  surface: UiV2ActionSurface;
  reasonCode: UiV2RejectionReasonCode | "";
  note: string;
}

interface MergePromptState {
  row: PipelineRow;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
}

interface ComposerState {
  propertyId: string;
  toAddress: string;
  contactId: string | null;
  subject: string;
  body: string;
  followUpAt: string;
  warnings: string[];
  submitting: boolean;
  sendingNow: boolean;
  templateId: string;
  templateName: string;
  savingTemplate: boolean;
  deletingTemplate: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type YieldFlag = { severity: "warn" | "danger"; label: string; title: string };

/** Data-sanity flag for the MTR yield cell: server callouts first, then client guards. */
function mtrYieldFlag(row: PipelineRow, ltr: number | null, mtr: number | null): YieldFlag | null {
  const code = row.underwriting?.mtrCalloutCode;
  if (code === "mtr_below_ltr") {
    return {
      severity: "danger",
      label: "Below LTR",
      title: row.underwriting?.mtrCalloutLabel ?? "MTR yield is below LTR — the mid-term numbers don't make sense.",
    };
  }
  if (code === "mtr_spread_outlier") {
    return {
      severity: "danger",
      label: "Check rents",
      title:
        row.underwriting?.mtrCalloutLabel ??
        "MTR spread is implausibly high — rents may have been extracted twice; verify the rent roll.",
    };
  }
  if (code) {
    return {
      severity: "warn",
      label: "Weak bump",
      title: row.underwriting?.mtrCalloutLabel ?? "MTR uplift over LTR is unusually small.",
    };
  }
  if (mtr != null && mtr < 0) {
    return { severity: "danger", label: "Negative", title: "Negative MTR yield — check NOI inputs." };
  }
  if (ltr != null && mtr != null && mtr < ltr) {
    return { severity: "danger", label: "Below LTR", title: "MTR yield is below LTR — the mid-term numbers don't make sense." };
  }
  return null;
}

function ltrYieldFlag(row: PipelineRow, ltr: number | null): YieldFlag | null {
  if (ltr != null && ltr < 0) {
    return { severity: "danger", label: "Negative", title: "Negative LTR yield — check NOI inputs." };
  }
  const brokerCode = row.underwriting?.brokerCapCalloutCode;
  if (brokerCode) {
    return {
      severity: "warn",
      label: brokerCode === "broker_cap_above_reconstructed" ? "Broker high" : "Broker low",
      title:
        row.underwriting?.brokerCapCalloutLabel ??
        "Broker cap rate differs from the yield reconstructed from actuals.",
    };
  }
  return null;
}

function flagCellClass(flag: YieldFlag | null): string | false {
  if (!flag) return false;
  return flag.severity === "danger" ? "cell-flag-danger" : "cell-flag-warn";
}

function pipelineRowHasOm(row: Pick<PipelineRow, "documentStatus"> | null | undefined): boolean {
  return row?.documentStatus?.hasOm === true;
}

function propertyDetailHasOm(property: FlexiblePropertyDetail | null | undefined): boolean {
  return property?.documentStatus?.hasOm === true;
}

function formatCurrency(value: number | null | undefined, compact = true): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function askActivityDisplay(row: UiV2PipelineRow): { label: string; title: string; tone: "cut" | "raise" | "neutral" } | null {
  const activity = row.listingActivity;
  if (!activity) return null;
  if (
    activity.latestPriceChangeDate &&
    activity.latestPriceChangeAmount != null &&
    Math.abs(activity.latestPriceChangeAmount) >= 1
  ) {
    const isCut = activity.latestPriceChangeAmount < 0;
    const amount = Math.abs(activity.latestPriceChangeAmount);
    const pct = activity.latestPriceChangePercent != null ? ` (${Math.abs(activity.latestPriceChangePercent).toFixed(1)}%)` : "";
    const eventDate = formatDate(activity.latestPriceChangeDate);
    return {
      label: `${isCut ? "Cut" : "Raised"} ${formatCurrency(amount, false)}${pct} · ${eventDate}`,
      title: `${isCut ? "Price cut" : "Price increase"} on ${eventDate}`,
      tone: isCut ? "cut" : "raise",
    };
  }
  if (
    activity.currentDiscountFromOriginalAskAmount != null &&
    activity.currentDiscountFromOriginalAskAmount >= 1 &&
    activity.currentDiscountFromOriginalAskPct != null
  ) {
    const discountDate = activity.latestPriceDecreaseDate ?? activity.latestPriceChangeDate ?? activity.lastActivityDate;
    const dateSuffix = discountDate ? ` · ${formatDate(discountDate)}` : "";
    return {
      label: `${activity.currentDiscountFromOriginalAskPct.toFixed(1)}% below original${dateSuffix}`,
      title: `${formatCurrency(activity.currentDiscountFromOriginalAskAmount, false)} below original ask${discountDate ? ` as of ${formatDate(discountDate)}` : ""}`,
      tone: "cut",
    };
  }
  return null;
}

function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function dateTimeLocalToIso(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function firstName(value: string | null | undefined): string {
  return value?.trim().split(/\s+/)[0] ?? "";
}

function renderTemplateText(
  value: string,
  context: { address?: string | null; brokerName?: string | null; firm?: string | null }
): string {
  const replacements: Record<string, string> = {
    address: context.address || "the property",
    broker_name: context.brokerName || "",
    broker_first_name: firstName(context.brokerName) || "there",
    firm: context.firm || "",
  };
  return value.replace(/\{\{\s*(address|broker_name|broker_first_name|firm)\s*\}\}/gi, (_match, key: string) => {
    return replacements[key.toLowerCase()] ?? "";
  });
}

function titleize(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bOm\b/g, "OM")
    .replace(/\bNoi\b/g, "NOI")
    .replace(/\bPsf\b/g, "PSF")
    .replace(/\bSf\b/g, "SF")
    .replace(/\bBbl\b/g, "BBL")
    .replace(/\bNy\b/g, "NY");
}

const AREA_LABELS: Record<string, string> = {
  noho: "NoHo",
  soho: "SoHo",
  nomad: "NoMad",
  fidi: "FiDi",
  tribeca: "TriBeCa",
  dumbo: "DUMBO",
};

function areaLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) return null;
  return AREA_LABELS[normalized] ?? titleize(normalized);
}

function locationLabels(row: PipelineRow): string[] {
  return [areaLabel(row.neighborhood), areaLabel(row.borough)].filter((value): value is string => Boolean(value));
}

function sourceLabel(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const normalized = value.toLowerCase();
  return SOURCE_LABELS[normalized] ?? "Other";
}

function rowIsSaved(row: UiV2PipelineRow): boolean {
  return Boolean(row.savedDeal) || row.statusChip.status === "saved" || row.tags.some((tag) => normalizeTag(tag) === "saved");
}

/** True when the listing refresh flagged this property as in contract, delisted, sold, or otherwise unavailable. */
function rowListingUnavailable(row: UiV2PipelineRow): boolean {
  return row.tags.some((tag) => normalizeTag(tag) === "listing_unavailable");
}

/** Tags ordered for display: the unavailable flag always surfaces first so it is never truncated. */
function orderedRowTags(row: UiV2PipelineRow): string[] {
  return [...row.tags].sort((left, right) => {
    const leftUnavailable = normalizeTag(left) === "listing_unavailable" ? 0 : 1;
    const rightUnavailable = normalizeTag(right) === "listing_unavailable" ? 0 : 1;
    return leftUnavailable - rightUnavailable;
  });
}

function marketTypeLabel(value: string | null | undefined): string {
  return MARKET_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Unknown";
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "_");
}

function tagLabel(tag: string): string {
  return titleize(normalizeTag(tag).replace(/_/g, " "));
}

function tagToneClass(tag: string): string {
  const normalized = normalizeTag(tag);
  if (["high_priority", "free_market", "below_replacement", "tax_advantage"].includes(normalized)) {
    return styles.tagOpportunity;
  }
  if (["mtr_candidate", "broker_relationship", "toured", "partner_review"].includes(normalized)) {
    return styles.tagRelationship;
  }
  if (["tour_scheduled", "tour_inputs_needed", "offer_candidate", "post_tour_info_needed"].includes(normalized)) {
    return styles.tagRelationship;
  }
  if (["needs_om", "needs_rent_roll", "needs_city_data", "follow_up"].includes(normalized)) {
    return styles.tagAction;
  }
  if (["distressed_seller", "rent_stab_risk", "duplicate", "rejected", "listing_unavailable"].includes(normalized)) {
    return styles.tagRisk;
  }
  if (["on_market", "off_market", "saved"].includes(normalized)) {
    return styles.tagMarket;
  }
  return styles.tagNeutral;
}

function statusToneClass(tone: UiV2StatusChipTone | undefined): string {
  switch (tone) {
    case "success":
      return styles.toneSuccess;
    case "warning":
      return styles.toneWarning;
    case "danger":
      return styles.toneDanger;
    case "info":
      return styles.toneInfo;
    case "neutral":
    default:
      return styles.toneNeutral;
  }
}

function statusLabel(status: string): string {
  return UI_V2_PIPELINE_STATUS_OPTIONS.find((option) => option.status === status)?.label ?? titleize(status);
}

function dealPathToneClass(dealPath: UiV2DealPathState | null | undefined): string {
  switch (dealPath?.status) {
    case "tour_scheduled":
      return styles.toneInfo;
    case "tour_completed_awaiting_inputs":
    case "need_more_info":
      return styles.toneWarning;
    case "offer_candidate":
      return styles.toneSuccess;
    case "rejected_after_tour":
    case "canceled":
      return styles.toneDanger;
    case "not_scheduled":
    default:
      return styles.toneNeutral;
  }
}

function calculateYieldOnCost(row: Pick<UiV2PipelineRow, "underwriting" | "askingPrice">, basis: "ltr" | "mtr"): number | null {
  if (basis === "ltr" && row.underwriting?.ltrYocPct != null) return row.underwriting.ltrYocPct;
  if (basis === "mtr" && row.underwriting?.mtrYocPct != null) return row.underwriting.mtrYocPct;
  if (basis === "mtr" && row.underwriting?.yocPct != null) return row.underwriting.yocPct;
  const price = row.underwriting?.askingPrice ?? row.askingPrice ?? null;
  if (price == null || price <= 0) return null;
  const noi = basis === "ltr" ? row.underwriting?.currentNoi : row.underwriting?.adjustedNoi;
  if (noi == null) return null;
  return (noi / price) * 100;
}

function flowLabel(row: UiV2PipelineRow): string {
  const count = row.openActionItemCount ?? 0;
  if (count > 0) return `${count} open`;
  return row.lastActivityAt ? "Current" : "Clear";
}

function omLabel(row: UiV2PipelineRow): string {
  if (!row.documentStatus?.hasOm) return "Missing";
  return titleize(row.documentStatus.omStatus ?? "available");
}

function newBadgeTitle(row: UiV2PipelineRow): string {
  const at = row.newness?.occurredAt ? formatDate(row.newness.occurredAt) : formatDate(row.createdAt);
  const suffix = at !== EMPTY_VALUE ? ` (${at})` : "";
  if (row.newness?.reason === "saved_search_run") return `New from latest saved search run${suffix}`;
  if (row.newness?.reason === "saved_search_upload") return `New from saved search upload${suffix}`;
  if (row.newness?.reason === "manual_import") return `New manual/imported property${suffix}`;
  return `New property${suffix}`;
}

function scoreExplanation(row: Pick<UiV2PipelineRow, "underwriting"> | null | undefined): string | undefined {
  const flags = [
    ...(row?.underwriting?.capReasons ?? []),
    ...(row?.underwriting?.riskFlags ?? []),
  ];
  if (flags.length === 0) return undefined;
  return `Why this score:\n- ${flags.slice(0, 6).join("\n- ")}${flags.length > 6 ? `\n(+${flags.length - 6} more)` : ""}`;
}

function scoreTone(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return styles.scoreMissing;
  if (score >= 75) return styles.scoreStrong;
  if (score >= 50) return styles.scorePositive;
  if (score >= 25) return styles.scoreWeak;
  return styles.scorePoor;
}

function scoreLabel(score: number | null | undefined): string {
  return score == null || !Number.isFinite(score) ? EMPTY_VALUE : `${Math.round(score)} / 100`;
}

function documentUrl(document: UiV2PropertyDocumentItem): string {
  const fileUrl = document.fileUrl || document.sourceUrl || "#";
  if (fileUrl === "#" || fileUrl.startsWith("http")) return fileUrl;
  return `${API_BASE}${fileUrl}`;
}

function propertyDocumentFileUrl(propertyId: string, documentId: string): string {
  return `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/${encodeURIComponent(documentId)}/file`;
}

/** Mirror of the API's normalizeNeighborhoodName: "Hell's Kitchen" → "hellskitchen". */
function normalizeAreaName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Force attachment disposition on our own file endpoint so Download buttons save instead of opening a tab. */
function asDownloadUrl(url: string | null): string | null {
  if (!url) return null;
  if (!url.includes("/documents/") || !url.includes("/file")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

function normalizedSearchText(values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function documentSearchText(document: UiV2PropertyDocumentItem): string {
  return normalizedSearchText([
    document.fileName,
    document.fileType,
    document.source,
    document.sourceType,
    typeof document.category === "string" ? document.category : null,
  ]);
}

function isOmDocument(document: UiV2PropertyDocumentItem): boolean {
  const category = typeof document.category === "string" ? document.category : "";
  const searchText = documentSearchText(document);
  return (
    category === "OM" ||
    category === "Brochure" ||
    /\b(om|offering memorandum|offering memo|brochure)\b/.test(searchText)
  );
}

function isCompDocument(document: UiV2PropertyDocumentItem): boolean {
  const category = typeof document.category === "string" ? document.category : "";
  const searchText = documentSearchText(document);
  return COMP_DOCUMENT_CATEGORIES.has(category) || /\b(comp|comps|market analysis|sellout|pricing)\b/.test(searchText);
}

function isGeneratedDossierDocument(document: UiV2PropertyDocumentItem): boolean {
  const searchText = documentSearchText(document);
  return document.source === "generated_dossier" || (document.sourceType === "generated" && /\bdossier\b/.test(searchText));
}

function isGeneratedExcelDocument(document: UiV2PropertyDocumentItem): boolean {
  const searchText = documentSearchText(document);
  return (
    document.source === "generated_excel" ||
    (document.sourceType === "generated" && /\b(excel|workbook|xlsx|model)\b/.test(searchText))
  );
}

function firstMatchingDocument(
  documents: UiV2PropertyDocumentItem[] | null | undefined,
  predicate: (document: UiV2PropertyDocumentItem) => boolean
): UiV2PropertyDocumentItem | null {
  return documents?.find(predicate) ?? null;
}

function resolvedDocumentUrl(document: UiV2PropertyDocumentItem | null): string | null {
  if (!document) return null;
  const url = documentUrl(document);
  return url === "#" ? null : url;
}

function brokerCompSourceDocumentId(row: PipelineRow): string | null {
  const packages = row.brokerComps?.packages;
  if (!Array.isArray(packages)) return null;
  for (const packagePayload of packages) {
    if (!isRecord(packagePayload)) continue;
    const pkg = isRecord(packagePayload.package) ? packagePayload.package : null;
    const sourceDocumentId = typeof pkg?.sourceDocumentId === "string" ? pkg.sourceDocumentId.trim() : "";
    if (sourceDocumentId) return sourceDocumentId;
  }
  return null;
}

function rowHasCompEvidence(row: PipelineRow): boolean {
  const categories = row.documentStatus?.categories ?? [];
  if (categories.some((category) => COMP_DOCUMENT_CATEGORIES.has(String(category)))) return true;
  if (row.documents?.some(isCompDocument)) return true;
  const brokerComps = row.brokerComps;
  if (!brokerComps) return false;
  if (Array.isArray(brokerComps.packages) && brokerComps.packages.length > 0) return true;
  if (Array.isArray(brokerComps.items) && brokerComps.items.length > 0) return true;
  if (Array.isArray(brokerComps.pricingOpinions) && brokerComps.pricingOpinions.length > 0) return true;
  return typeof brokerComps.summary === "string" && brokerComps.summary.trim().length > 0;
}

function rowDossierDocumentId(row: PipelineRow): string | null {
  return row.underwriting?.summary?.dossierDocumentId ?? firstMatchingDocument(row.documents, isGeneratedDossierDocument)?.id ?? null;
}

function rowExcelDocumentId(row: PipelineRow): string | null {
  return row.underwriting?.summary?.excelDocumentId ?? firstMatchingDocument(row.documents, isGeneratedExcelDocument)?.id ?? null;
}

function rowDownloadActions(row: PipelineRow): RowDownloadAction[] {
  const omDocument = firstMatchingDocument(row.documents, isOmDocument);
  const compDocument = firstMatchingDocument(row.documents, isCompDocument);
  const dossierDocument = firstMatchingDocument(row.documents, isGeneratedDossierDocument);
  const excelDocument = firstMatchingDocument(row.documents, isGeneratedExcelDocument);
  const dossierDocumentId = rowDossierDocumentId(row);
  const excelDocumentId = rowExcelDocumentId(row);
  const compSourceDocumentId = brokerCompSourceDocumentId(row);

  const omDocumentId = row.documentStatus?.omDocumentId ?? null;
  const omUrl = asDownloadUrl(
    resolvedDocumentUrl(omDocument) ?? (omDocumentId ? propertyDocumentFileUrl(row.propertyId, omDocumentId) : null)
  );
  const compsUrl = asDownloadUrl(
    resolvedDocumentUrl(compDocument) ?? (compSourceDocumentId ? propertyDocumentFileUrl(row.propertyId, compSourceDocumentId) : null)
  );
  const dossierUrl = asDownloadUrl(
    resolvedDocumentUrl(dossierDocument) ?? (dossierDocumentId ? propertyDocumentFileUrl(row.propertyId, dossierDocumentId) : null)
  );
  const excelUrl = asDownloadUrl(
    resolvedDocumentUrl(excelDocument) ?? (excelDocumentId ? propertyDocumentFileUrl(row.propertyId, excelDocumentId) : null)
  );

  return [
    {
      key: "om",
      label: "Download OM",
      url: omUrl,
      fileName: omDocument?.fileName ?? null,
      title: omUrl
        ? "Download the latest available OM or brochure."
        : row.documentStatus?.hasOm
          ? "OM data exists, but no document file is stored for this property (e.g. numbers promoted from notes or email text)."
          : "No OM document is available for this property.",
    },
    {
      key: "comps",
      label: "Download comps",
      url: compsUrl,
      fileName: compDocument?.fileName ?? null,
      title: compsUrl
        ? "Download the latest available broker comp package."
        : rowHasCompEvidence(row)
          ? "Comp data is present, but this row does not include a source document URL."
          : "No broker comp package is available for this property.",
    },
    {
      key: "dossier",
      label: "Download dossier PDF",
      url: dossierUrl,
      fileName: dossierDocument?.fileName ?? null,
      title: dossierUrl
        ? "Download the generated deal dossier PDF."
        : row.underwriting?.generationStatus === "completed"
          ? "Dossier generation is complete, but no PDF document ID is present on this row."
          : "No generated deal dossier PDF is available for this property.",
    },
    {
      key: "excel",
      label: "Download Excel",
      url: excelUrl,
      fileName: excelDocument?.fileName ?? null,
      title: excelUrl
        ? "Download the generated deal dossier Excel workbook."
        : row.underwriting?.generationStatus === "completed"
          ? "Dossier generation is complete, but no Excel document ID is present on this row."
          : "No generated Excel workbook is available for this property.",
    },
  ];
}

function trackerToneClass(tone: TrackerTone): string {
  switch (tone) {
    case "complete":
      return styles.trackerChipComplete;
    case "warning":
      return styles.trackerChipWarning;
    case "failed":
      return styles.trackerChipFailed;
    case "neutral":
      return styles.trackerChipNeutral;
    case "pending":
    default:
      return styles.trackerChipPending;
  }
}

function rowTrackerItems(row: PipelineRow): PipelineTrackerItem[] {
  const compStatus = typeof row.brokerComps?.status === "string" ? row.brokerComps.status : null;
  const hasCompEvidence = rowHasCompEvidence(row);
  const omStatus = row.documentStatus?.omStatus ?? "missing";
  const omFlagCount = row.documentStatus?.omValidationFlagCount ?? 0;
  const omFlagWorst = row.documentStatus?.omValidationWorstSeverity ?? null;
  const omFlagMessages = row.documentStatus?.omValidationMessages ?? [];
  const generationStatus = row.underwriting?.generationStatus ?? null;
  const hasDossierDocument = Boolean(rowDossierDocumentId(row) || rowExcelDocumentId(row));
  const hasUnderwriting = Boolean(row.underwriting?.dealScore != null || row.underwriting?.summary);

  return [
    {
      key: "comps",
      label: "Comps",
      tone: compStatus === "failed" ? "failed" : hasCompEvidence ? "complete" : "pending",
      title: hasCompEvidence ? "Broker comps or comp package available." : "No broker comp package available yet.",
    },
    {
      key: "om",
      label: omFlagCount > 0 ? `OM ⚠${omFlagCount}` : "OM",
      tone: row.documentStatus?.hasOm
        ? omFlagCount > 0
          ? omFlagWorst === "error"
            ? "failed"
            : "warning"
          : "complete"
        : omStatus === "requested"
          ? "warning"
          : "pending",
      title: row.documentStatus?.hasOm
        ? omFlagCount > 0
          ? `OM ${titleize(omStatus)} — ${omFlagCount} validation flag${omFlagCount === 1 ? "" : "s"}: ${omFlagMessages.join(" · ")}`
          : `OM ${titleize(omStatus)}.`
        : omStatus === "requested"
          ? "OM requested from broker."
          : "OM missing.",
    },
    {
      key: "uw",
      label: "UW/Dossier",
      tone:
        generationStatus === "failed"
          ? "failed"
          : generationStatus === "running"
            ? "warning"
            : generationStatus === "completed" || hasDossierDocument
              ? "complete"
              : hasUnderwriting
                ? "neutral"
                : "pending",
      title:
        generationStatus === "completed" || hasDossierDocument
          ? "Underwriting and dossier complete."
          : generationStatus === "running"
            ? "Dossier generation is running."
            : generationStatus === "failed"
              ? "Dossier generation failed."
              : hasUnderwriting
                ? "Underwriting inputs are present; dossier is not complete yet."
                : "Underwriting and dossier are not started.",
    },
  ];
}

function displayDetailValue(item: UiV2DetailItem): string {
  if (item.value == null || item.value === "") return EMPTY_VALUE;
  if (typeof item.value === "boolean") return item.value ? "Yes" : "No";
  if (typeof item.value === "number") return String(item.value);
  const raw = String(item.value).trim();
  if (!raw) return EMPTY_VALUE;
  const label = item.label.toLowerCase();
  if (
    (label.includes("date") || label.includes("refreshed") || label.includes("updated") || label.includes("listed")) &&
    Number.isFinite(Date.parse(raw))
  ) {
    return formatDate(raw);
  }
  if (label.includes("source")) return sourceLabel(raw);
  if (
    label.includes("neighborhood") ||
    label.includes("borough") ||
    label.includes("status") ||
    label.includes("property type") ||
    label === "type" ||
    label.includes("market") ||
    label.includes("class") ||
    label.includes("use")
  ) {
    return titleize(raw);
  }
  if (/^[a-z][a-z0-9 _/-]*$/.test(raw) && !/[/.@]/.test(raw)) return titleize(raw);
  return raw;
}

function extractGallery(property: FlexiblePropertyDetail | null, row?: PipelineRow | null): UiV2ImageAsset[] {
  const galleries = [
    property?.gallery,
    property?.overview.gallery,
    row?.gallery,
    row?.overview?.gallery,
  ];
  for (const gallery of galleries) {
    if (Array.isArray(gallery) && gallery.length > 0) return gallery.filter((image) => Boolean(image.url));
  }
  const thumbnailUrl = row?.thumbnailUrl;
  return thumbnailUrl
    ? [
        {
          id: `${row.propertyId}-thumbnail`,
          url: thumbnailUrl,
          thumbnailUrl,
          altText: row.displayAddress ?? row.canonicalAddress,
        },
      ]
    : [];
}

function normalizeDocument(document: Partial<UiV2PropertyDocumentItem> & Record<string, unknown>): UiV2PropertyDocumentItem {
  const fallbackUrl = typeof document.url === "string" ? document.url : undefined;
  return {
    id: String(document.id ?? document.fileName ?? document.title ?? fallbackUrl ?? "document"),
    fileName: String(document.fileName ?? document.title ?? "Document"),
    fileType: typeof document.fileType === "string" ? document.fileType : null,
    source: typeof document.source === "string" ? document.source : null,
    sourceType: document.sourceType === "inquiry" || document.sourceType === "generated" ? document.sourceType : "uploaded",
    category: typeof document.category === "string" ? document.category : null,
    sourceUrl: typeof document.sourceUrl === "string" ? document.sourceUrl : fallbackUrl ?? null,
    fileUrl: typeof document.fileUrl === "string" ? document.fileUrl : fallbackUrl ?? "#",
    createdAt: typeof document.createdAt === "string" ? document.createdAt : typeof document.uploadedAt === "string" ? document.uploadedAt : null,
  };
}

function normalizeEnrichmentModule(module: Partial<UiV2EnrichmentModuleDetail> & Record<string, unknown>): UiV2EnrichmentModuleDetail {
  return {
    key: String(module.key ?? module.label ?? "module"),
    label: String(module.label ?? module.key ?? "Module"),
    status: module.status as UiV2EnrichmentModuleDetail["status"],
    summaryItems: Array.isArray(module.summaryItems)
      ? module.summaryItems
      : Array.isArray(module.summary)
        ? (module.summary as UiV2DetailItem[])
        : [],
    detailItems: Array.isArray(module.detailItems)
      ? module.detailItems
      : Array.isArray(module.detail)
        ? (module.detail as UiV2DetailItem[])
        : [],
  };
}

function normalizePropertyDetail(property: FlexiblePropertyDetail | null | undefined): FlexiblePropertyDetail | null {
  if (!property) return null;
  const documentStatus = property.documentStatus ?? { hasOm: false, omStatus: "missing" as const };
  const documentStatusRecord = documentStatus as unknown as Record<string, unknown>;
  const rawEnrichmentDetails = property.enrichmentDetails;
  const modules = Array.isArray(rawEnrichmentDetails?.modules) ? rawEnrichmentDetails.modules : [];
  return {
    ...property,
    gallery: Array.isArray(property.gallery) ? property.gallery : [],
    tags: Array.isArray(property.tags) ? property.tags : [],
    documentStatus: {
      hasOm: Boolean(documentStatus.hasOm),
      omStatus: documentStatus.omStatus ?? "missing",
      latestOmRunId: documentStatus.latestOmRunId ?? null,
      documentCount: documentStatus.documentCount ?? (Array.isArray(property.documents) ? property.documents.length : 0),
      categories: Array.isArray(documentStatus.categories) ? documentStatus.categories : [],
      lastUpdatedAt: documentStatus.lastUpdatedAt ?? (documentStatusRecord.updatedAt as string | null | undefined) ?? null,
      omValidationFlagCount: documentStatus.omValidationFlagCount ?? null,
      omValidationWorstSeverity: documentStatus.omValidationWorstSeverity ?? null,
      omValidationMessages: Array.isArray(documentStatus.omValidationMessages) ? documentStatus.omValidationMessages : [],
    },
    documents: Array.isArray(property.documents)
      ? property.documents.map((document) => normalizeDocument(document as Partial<UiV2PropertyDocumentItem> & Record<string, unknown>))
      : [],
    enrichmentState: {
      ...EMPTY_ENRICHMENT_STATE,
      ...(property.enrichmentState ?? {}),
      status: property.enrichmentState?.status ?? ((rawEnrichmentDetails as Record<string, unknown> | null | undefined)?.status as UiV2EnrichmentState["status"] | undefined) ?? "not_started",
      lastRefreshedAt: property.enrichmentState?.lastRefreshedAt ?? ((rawEnrichmentDetails as Record<string, unknown> | null | undefined)?.lastRefreshedAt as string | null | undefined) ?? null,
      errorMessage: property.enrichmentState?.errorMessage ?? ((rawEnrichmentDetails as Record<string, unknown> | null | undefined)?.error as string | null | undefined) ?? null,
    },
    enrichmentDetails: rawEnrichmentDetails
      ? {
          ...rawEnrichmentDetails,
          modules: modules.map((module) => normalizeEnrichmentModule(module as Partial<UiV2EnrichmentModuleDetail> & Record<string, unknown>)),
          sourceItems: Array.isArray(rawEnrichmentDetails.sourceItems) ? rawEnrichmentDetails.sourceItems : [],
          rentalItems: Array.isArray(rawEnrichmentDetails.rentalItems) ? rawEnrichmentDetails.rentalItems : [],
          listingFacts: rawEnrichmentDetails.listingFacts ?? null,
          rentalFlow: rawEnrichmentDetails.rentalFlow ?? null,
          omAnalysis: rawEnrichmentDetails.omAnalysis ?? null,
          sourcingUpdate: rawEnrichmentDetails.sourcingUpdate ?? property.sourcingUpdate ?? null,
        }
      : { modules: [] },
    activityTimeline: Array.isArray(property.activityTimeline) ? property.activityTimeline : [],
    actionItems: Array.isArray(property.actionItems) ? property.actionItems : [],
  };
}

function brokerFormFromBlock(broker: UiV2BrokerBlock | null | undefined): BrokerFormState {
  return {
    name: broker?.name ?? "",
    email: broker?.email ?? "",
    phone: broker?.phone ?? "",
    firm: broker?.firm ?? "",
    notes: broker?.notes ?? "",
  };
}

function formValue(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

function sourceFactsFormFromProperty(
  property: FlexiblePropertyDetail | null | undefined,
  row?: PipelineRow | null
): SourceFactsFormState {
  const listingFacts = property?.enrichmentDetails?.listingFacts ?? null;
  return {
    askingPrice: formValue(property?.overview.askingPrice ?? row?.askingPrice),
    units: formValue(property?.overview.units ?? row?.units),
    buildingSqft: formValue(property?.overview.buildingSqft ?? row?.buildingSqft),
    bedrooms: formValue(listingFacts?.bedrooms ?? property?.overview.beds),
    bathrooms: formValue(listingFacts?.bathrooms ?? property?.overview.baths),
    neighborhood: formValue(property?.overview.neighborhood ?? row?.neighborhood),
    borough: formValue(property?.overview.borough ?? row?.borough),
    listingStatus: formValue(listingFacts?.status),
    propertyType: formValue(listingFacts?.propertyType),
    yearBuilt: formValue(property?.overview.yearBuilt ?? listingFacts?.builtIn),
  };
}

function sourceFactsPayload(form: SourceFactsFormState): SourceFactsFormState {
  return {
    askingPrice: form.askingPrice.trim(),
    units: form.units.trim(),
    buildingSqft: form.buildingSqft.trim(),
    bedrooms: form.bedrooms.trim(),
    bathrooms: form.bathrooms.trim(),
    neighborhood: form.neighborhood.trim(),
    borough: form.borough.trim(),
    listingStatus: form.listingStatus.trim(),
    propertyType: form.propertyType.trim(),
    yearBuilt: form.yearBuilt.trim(),
  };
}

function datetimeLocalFromIso(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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

function rowFromProperty(row: PipelineRow, property: FlexiblePropertyDetail): PipelineRow {
  const gallery = extractGallery(property, row);
  const latestActivity = property.activityTimeline[0]?.createdAt ?? row.lastActivityAt ?? null;
  return {
    ...row,
    canonicalAddress: property.overview.canonicalAddress,
    displayAddress: property.overview.displayAddress,
    source: property.overview.source,
    statusChip: property.statusChip,
    tags: property.tags,
    askingPrice: property.overview.askingPrice,
    units: property.overview.units,
    buildingSqft: property.overview.buildingSqft,
    pricePerSqft: property.overview.pricePerSqft,
    marketType: property.overview.marketType ?? row.marketType,
    neighborhood: property.overview.neighborhood,
    borough: property.overview.borough,
    thumbnailUrl: gallery[0]?.thumbnailUrl ?? gallery[0]?.url ?? row.thumbnailUrl,
    broker: property.broker,
    documentStatus: property.documentStatus,
    documents: property.documents,
    enrichmentState: property.enrichmentState,
    underwriting: property.underwriting,
    openActionItemCount: property.actionItems.filter((item) => item.status === "open").length,
    savedDeal: property.savedDeal ?? row.savedDeal ?? null,
    dealPath: property.dealPath ?? row.dealPath ?? null,
    lastActivityAt: latestActivity,
    updatedAt: new Date().toISOString(),
    gallery,
  };
}

function buildPipelineQueryString(queryString: string): string {
  const incoming = new URLSearchParams(queryString);
  const outgoing = new URLSearchParams();
  for (const key of [
    "q",
    "status",
    "source",
    "neighborhood",
    "marketType",
    "type",
    "tag",
    "mtr",
    "enrichmentStatus",
    "hasOpenActions",
    "sort",
    "sortBy",
    "sortDirection",
    "direction",
    "hasOm",
    "hasBrokerContact",
    "minDealScore",
    "maxDealScore",
    "minAskingPrice",
    "maxAskingPrice",
    "minLtrYoc",
    "includeRejected",
  ]) {
    const value = incoming.get(key);
    if (value) outgoing.set(key, value);
  }
  outgoing.set("limit", "100");
  return outgoing.toString();
}

function uniqueSorted(values: Array<string | null | undefined>, current?: string): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (value && value.trim()) set.add(value.trim());
  }
  if (current) set.add(current);
  return [...set].sort((left, right) => left.localeCompare(right));
}

export default function PipelineClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const requestedPropertyId =
    searchParams.get("propertyId") ?? searchParams.get("property_id") ?? searchParams.get("expand");
  const requestedTab = tabFromParam(searchParams.get("tab"));

  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Opt-in RapidAPI listing-details stage for the composite "Refresh listings"
  // action; sticky across sessions because it spends API credits.
  const [includeListingPull, setIncludeListingPull] = useState(false);
  useEffect(() => {
    try {
      setIncludeListingPull(window.localStorage.getItem(LISTING_PULL_TOGGLE_KEY) === "1");
    } catch {
      // localStorage unavailable: default stays off
    }
  }, []);
  const setIncludeListingPullPersisted = useCallback((next: boolean) => {
    setIncludeListingPull(next);
    try {
      window.localStorage.setItem(LISTING_PULL_TOGGLE_KEY, next ? "1" : "0");
    } catch {
      // non-fatal
    }
  }, []);
  const processBanner = useProcessBanner();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<FlexiblePropertyDetail | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab>("Overview");
  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") ?? "");
  const [brokerEditOpen, setBrokerEditOpen] = useState(false);
  const [brokerForm, setBrokerForm] = useState<BrokerFormState>(brokerFormFromBlock(null));
  const [sourceFactsEditOpen, setSourceFactsEditOpen] = useState(false);
  const [sourceFactsForm, setSourceFactsForm] = useState<SourceFactsFormState>(sourceFactsFormFromProperty(null));
  const [dealPathForm, setDealPathForm] = useState<DealPathFormState>(dealPathFormFromState(null));
  const [newTag, setNewTag] = useState("");
  const [rejectState, setRejectState] = useState<RejectState | null>(null);
  /** Merge pending confirmation — drives the ConfirmDialog popup. */
  const [mergePrompt, setMergePrompt] = useState<MergePromptState | null>(null);
  const rejectOpen = rejectState != null;
  // The reject popup behaves like a real modal: background scroll locks and
  // Escape dismisses, so the user lands in the dialog instead of the page.
  useEffect(() => {
    if (!rejectOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRejectState(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [rejectOpen]);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [templates, setTemplates] = useState<UiV2OutreachTemplatePayload[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [sheetFullscreen, setSheetFullscreen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [outreachPreview, setOutreachPreview] = useState<{
    loading: boolean;
    sending: boolean;
    batches: OutreachPreviewBatch[];
    skipped: OutreachPreviewSkipped[];
  } | null>(null);
  const [linkListingDraft, setLinkListingDraft] = useState<{ url: string; saving: boolean } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<PipelineHeaderMenuId | null>(null);
  const [rowMenu, setRowMenu] = useState<RowActionMenuState | null>(null);
  const [brokerPrompt, setBrokerPrompt] = useState<{
    propertyId: string;
    address: string;
    name: string;
    email: string;
    saving: boolean;
    searching?: boolean;
    searchMessage?: string | null;
    candidates?: BrokerSearchCandidate[] | null;
  } | null>(null);
  const [keyboardRowId, setKeyboardRowId] = useState<string | null>(null);
  const [brokerCompPayloads, setBrokerCompPayloads] = useState<Record<string, unknown>>({});
  const [brokerCompLoading, setBrokerCompLoading] = useState<Record<string, boolean>>({});
  const [brokerCompUploading, setBrokerCompUploading] = useState<Record<string, boolean>>({});
  const [brokerCompOpinionSaving, setBrokerCompOpinionSaving] = useState<Record<string, boolean>>({});
  const [brokerCompError, setBrokerCompError] = useState<Record<string, string | null>>({});
  const [documentUploadFiles, setDocumentUploadFiles] = useState<File[]>([]);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentUploadError, setDocumentUploadError] = useState<string | null>(null);
  const lastAutoOpenedPropertyId = useRef<string | null>(null);

  const selectedRow = useMemo(
    () => rows.find((row) => row.propertyId === selectedId) ?? null,
    [rows, selectedId]
  );
  const rowMenuRow = useMemo(
    () => (rowMenu ? rows.find((row) => row.propertyId === rowMenu.propertyId) ?? null : null),
    [rows, rowMenu]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIdSet.has(row.propertyId));
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIdSet.has(row.propertyId)),
    [rows, selectedIdSet]
  );
  const selectedRowsWithOm = useMemo(
    () => selectedRows.filter(pipelineRowHasOm),
    [selectedRows]
  );
  const selectedRejectableRows = useMemo(
    () =>
      selectedRows.filter((row) => {
        const status = String(row.statusChip.status);
        return status !== "rejected" && status !== "archived" && status !== "deal_closed";
      }),
    [selectedRows]
  );

  useEffect(() => {
    setDealPathForm(dealPathFormFromState(selectedProperty?.dealPath ?? selectedRow?.dealPath ?? null));
  }, [selectedId, selectedProperty?.dealPath, selectedRow?.dealPath]);

  const filterValues = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      status: searchParams.get("status") ?? "",
      source: searchParams.get("source") ?? "",
      propertyType: searchParams.get("propertyType") ?? "",
      neighborhood: searchParams.get("neighborhood") ?? "",
      marketType: searchParams.get("marketType") ?? searchParams.get("type") ?? "",
      tag: searchParams.get("tag") ?? "",
      mtr: searchParams.get("mtr") ?? "",
      enrichmentStatus: searchParams.get("enrichmentStatus") ?? "",
      hasOpenActions: searchParams.get("hasOpenActions") ?? "",
      hasOm: searchParams.get("hasOm") ?? "",
      hasBrokerContact: searchParams.get("hasBrokerContact") ?? "",
      minDealScore: searchParams.get("minDealScore") ?? "",
      maxDealScore: searchParams.get("maxDealScore") ?? "",
      minAskingPrice: searchParams.get("minAskingPrice") ?? "",
      maxAskingPrice: searchParams.get("maxAskingPrice") ?? "",
      minLtrYoc: searchParams.get("minLtrYoc") ?? "",
      sort: (searchParams.get("sort") ?? searchParams.get("sortBy") ?? "updatedAt") as UiV2PipelineSortField,
      sortDirection: (searchParams.get("sortDirection") ?? searchParams.get("direction") ?? "desc") as SortDirection,
      includeRejected: searchParams.get("includeRejected") === "true",
    }),
    [searchParams]
  );

  const sourceOptions = useMemo(
    () => uniqueSorted(["streeteasy", "loopnet", "manual", "other", filterValues.source]),
    [rows, filterValues.source]
  );
  const propertyTypeOptions = useMemo(
    () => uniqueSorted(rows.map((row) => row.propertyType), filterValues.propertyType),
    [rows, filterValues.propertyType]
  );
  const neighborhoodOptions = useMemo(
    () => uniqueSorted(rows.map((row) => row.neighborhood), filterValues.neighborhood),
    [rows, filterValues.neighborhood]
  );
  const tagOptions = useMemo(
    () => uniqueSorted([...COMMON_PIPELINE_TAGS, ...rows.flatMap((row) => row.tags)], filterValues.tag),
    [rows, filterValues.tag]
  );

  useEffect(() => {
    setSearchDraft(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    const visibleIds = new Set(rows.map((row) => row.propertyId));
    setSelectedIds((current) => current.filter((propertyId) => visibleIds.has(propertyId)));
  }, [rows]);

  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [rowMenu]);

  useEffect(() => {
    let ignore = false;
    async function loadPipeline() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch<PipelineResponse>(
          `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
        );
        if (ignore) return;
        setRows(response.pipeline.rows as PipelineRow[]);
        setTotal(response.pipeline.total);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Failed to load pipeline.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadPipeline();
    return () => {
      ignore = true;
    };
  }, [queryString]);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const response = await apiFetch<OutreachTemplatesResponse>(`${API_BASE}/api/ui-v2/outreach-templates`);
      setTemplates(response.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved outreach drafts.");
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const replaceQueryParams = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of Object.entries(patch)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      if ("sort" in patch) params.delete("sortBy");
      if ("sortDirection" in patch) params.delete("direction");
      if ("marketType" in patch) params.delete("type");
      const next = params.toString();
      router.replace(next ? `${PIPELINE_PATH}?${next}` : PIPELINE_PATH, { scroll: false });
    },
    [queryString, router]
  );

  const updateQueryParam = useCallback(
    (key: string, value: string) => {
      replaceQueryParams({ [key]: value });
    },
    [replaceQueryParams]
  );

  const applyProperty = useCallback((property: FlexiblePropertyDetail | null) => {
    if (!property) return;
    const nextStatus = property.statusChip?.status;
    const shouldHideTerminalRow =
      !filterValues.includeRejected && (nextStatus === "rejected" || nextStatus === "archived");
    setSelectedProperty((current) =>
      current?.overview.propertyId === property.overview.propertyId ? property : current
    );
    setRows((currentRows) => {
      const nextRows = currentRows.map((row) =>
        row.propertyId === property.overview.propertyId ? rowFromProperty(row, property) : row
      );
      if (shouldHideTerminalRow) {
        return nextRows.filter((row) => row.propertyId !== property.overview.propertyId);
      }
      return nextRows;
    });
    if (shouldHideTerminalRow) {
      setTotal((currentTotal) => Math.max(0, currentTotal - 1));
    }
  }, [filterValues.includeRejected]);

  const loadPropertyDetail = useCallback(
    async (propertyId: string): Promise<FlexiblePropertyDetail | null> => {
      setSelectedId(propertyId);
      setDetailLoading(true);
      setError(null);
      try {
        const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${propertyId}`);
        const property = normalizePropertyDetail(response.property);
        setSelectedProperty(property);
        setBrokerForm(brokerFormFromBlock(property?.broker));
        setSourceFactsForm(sourceFactsFormFromProperty(property));
        if (property) applyProperty(property);
        return property;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load property.");
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    [applyProperty]
  );

  const reloadPipelineRows = useCallback(async (): Promise<void> => {
    const response = await apiFetch<PipelineResponse>(
      `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
    );
    setRows(response.pipeline.rows as PipelineRow[]);
    setTotal(response.pipeline.total);
  }, [queryString]);

  const loadBrokerComps = useCallback(async (propertyId: string): Promise<void> => {
    setBrokerCompLoading((current) => ({ ...current, [propertyId]: true }));
    setBrokerCompError((current) => ({ ...current, [propertyId]: null }));
    try {
      const response = await apiFetch<BrokerCompPackagesResponse>(
        `${API_BASE}${plannedBrokerCompReviewEndpoint(propertyId)}?limit=20&refresh=${Date.now()}`,
        { cache: "no-store" }
      );
      setBrokerCompPayloads((current) => ({ ...current, [propertyId]: response }));
    } catch (err) {
      setBrokerCompError((current) => ({
        ...current,
        [propertyId]: err instanceof Error ? err.message : "Failed to load broker comps.",
      }));
    } finally {
      setBrokerCompLoading((current) => ({ ...current, [propertyId]: false }));
    }
  }, []);

  const uploadBrokerCompPackage = useCallback(
    async (propertyId: string, file: File): Promise<void> => {
      setBrokerCompUploading((current) => ({ ...current, [propertyId]: true }));
      setBrokerCompError((current) => ({ ...current, [propertyId]: null }));
      const banner = processBanner.start("Comp package upload", {
        message: `Reading ${file.name} with the comp extractor…`,
      });
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("category", "Broker Comp Package");
        const response = await fetch(`${API_BASE}${plannedBrokerCompUploadEndpoint(propertyId)}`, {
          method: "POST",
          body: form,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : `Upload failed with ${response.status}`;
          throw new Error(message);
        }
        setBrokerCompPayloads((current) => ({ ...current, [propertyId]: payload }));
        await loadBrokerComps(propertyId);
        setNotice(`Broker comp package uploaded: ${file.name}`);
        banner.succeed(`Broker comp package extracted: ${file.name}`);
        if (selectedId === propertyId) await loadPropertyDetail(propertyId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to upload broker comp package.";
        banner.fail(message);
        setBrokerCompError((current) => ({
          ...current,
          [propertyId]: message,
        }));
      } finally {
        setBrokerCompUploading((current) => ({ ...current, [propertyId]: false }));
      }
    },
    [loadBrokerComps, loadPropertyDetail, processBanner, selectedId]
  );

  const uploadPropertyDocuments = useCallback(
    async (propertyId: string, files: File[]): Promise<void> => {
      if (files.length === 0 || documentUploading) return;
      setDocumentUploading(true);
      setDocumentUploadError(null);
      setNotice(null);
      const banner = processBanner.start("Document upload", {
        message: `Uploading ${files.length} file${files.length === 1 ? "" : "s"} — OMs are read and routed by address (AI extraction)…`,
      });
      try {
        const form = new FormData();
        for (const file of files) form.append("files", file);
        form.append("category", "auto");
        form.append("source", "Pipeline document upload");
        form.append("splitByAddress", "true");
        const response = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/upload-batch`, {
          method: "POST",
          body: form,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : `Upload failed with ${response.status}`;
          throw new Error(message);
        }
        const classified = Array.isArray(payload?.classifiedDocuments) ? payload.classifiedDocuments : [];
        const omStatus = typeof payload?.omRefresh?.status === "string" ? titleize(payload.omRefresh.status) : null;
        const addressAware = isRecord(payload?.addressAwareOmImport) ? payload.addressAwareOmImport : null;
        const importedCount = typeof addressAware?.imported === "number" ? addressAware.imported : 0;
        const failedCount = typeof addressAware?.failed === "number" ? addressAware.failed : 0;
        const createdCount = typeof addressAware?.createdProperties === "number" ? addressAware.createdProperties : 0;
        const enrichmentCount = typeof addressAware?.enrichmentComplete === "number" ? addressAware.enrichmentComplete : 0;
        const dossierCount = typeof addressAware?.dossierGenerated === "number" ? addressAware.dossierGenerated : 0;
        setDocumentUploadFiles([]);
        const uploadSummary = addressAware
          ? `${files.length} document${files.length === 1 ? "" : "s"} uploaded; ${importedCount} OM PDF${importedCount === 1 ? "" : "s"} routed by address${createdCount ? `, ${createdCount} new propert${createdCount === 1 ? "y" : "ies"}` : ""}${enrichmentCount ? `, ${enrichmentCount} enriched` : ""}${dossierCount ? `, ${dossierCount} dossier${dossierCount === 1 ? "" : "s"} generated` : ""}${failedCount ? `, ${failedCount} need review` : ""}.`
          : `${files.length} document${files.length === 1 ? "" : "s"} uploaded${classified.length ? ` and classified` : ""}${omStatus ? `; OM extraction ${omStatus}` : ""}.`;
        setNotice(uploadSummary);
        banner.succeed(uploadSummary);
        await loadPropertyDetail(propertyId);
        const pipelineResponse = await apiFetch<PipelineResponse>(
          `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
        );
        setRows(pipelineResponse.pipeline.rows as PipelineRow[]);
        setTotal(pipelineResponse.pipeline.total);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to upload documents.";
        banner.fail(message);
        setDocumentUploadError(message);
      } finally {
        setDocumentUploading(false);
      }
    },
    [documentUploading, loadPropertyDetail, processBanner, queryString]
  );

  const reviewBrokerCompItem = useCallback(
    async (propertyId: string, packageId: string, itemId: string, reviewStatus: "approved" | "rejected"): Promise<void> => {
      setBrokerCompError((current) => ({ ...current, [propertyId]: null }));
      try {
        const response = await apiFetch<BrokerCompPackagesResponse>(
          `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/broker-comp-packages/${encodeURIComponent(packageId)}/items/${encodeURIComponent(itemId)}/review`,
          {
            method: "PATCH",
            body: JSON.stringify({ reviewStatus }),
          }
        );
        setBrokerCompPayloads((current) => ({ ...current, [propertyId]: response }));
        await loadBrokerComps(propertyId);
      } catch (err) {
        setBrokerCompError((current) => ({
          ...current,
          [propertyId]: err instanceof Error ? err.message : "Failed to update broker comp review.",
        }));
      }
    },
    [loadBrokerComps]
  );

  const addBrokerCompPricingOpinion = useCallback(
    async (propertyId: string, input: { amount: number; note: string; listedPrice?: number | null }): Promise<void> => {
      setBrokerCompOpinionSaving((current) => ({ ...current, [propertyId]: true }));
      setBrokerCompError((current) => ({ ...current, [propertyId]: null }));
      try {
        const response = await apiFetch<BrokerCompPackagesResponse>(
          `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/broker-comp-pricing-opinions`,
          {
            method: "POST",
            body: JSON.stringify({
              amount: input.amount,
              note: input.note,
              listedPrice: input.listedPrice ?? null,
              source: "User",
            }),
          }
        );
        setBrokerCompPayloads((current) => ({ ...current, [propertyId]: response }));
        await loadBrokerComps(propertyId);
        setNotice("Whisper price saved as a market signal.");
      } catch (err) {
        setBrokerCompError((current) => ({
          ...current,
          [propertyId]: err instanceof Error ? err.message : "Failed to save whisper price.",
        }));
      } finally {
        setBrokerCompOpinionSaving((current) => ({ ...current, [propertyId]: false }));
      }
    },
    [loadBrokerComps]
  );

  const promoteBrokerCompPackage = useCallback(
    async (propertyId: string, packageId: string): Promise<void> => {
      setBrokerCompError((current) => ({ ...current, [propertyId]: null }));
      try {
        await apiFetch<unknown>(
          `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/broker-comp-packages/${encodeURIComponent(packageId)}/promote`,
          {
            method: "POST",
            body: JSON.stringify({}),
          }
        );
        await loadBrokerComps(propertyId);
        setNotice("Approved broker comp items promoted for analysis.");
      } catch (err) {
        setBrokerCompError((current) => ({
          ...current,
          [propertyId]: err instanceof Error ? err.message : "Failed to promote broker comp package.",
        }));
      }
    },
    [loadBrokerComps]
  );

  useEffect(() => {
    if (!requestedPropertyId) {
      lastAutoOpenedPropertyId.current = null;
      return;
    }
    setSheetTab(requestedTab ?? "Overview");
    if (lastAutoOpenedPropertyId.current === requestedPropertyId) return;
    lastAutoOpenedPropertyId.current = requestedPropertyId;
    void loadPropertyDetail(requestedPropertyId);
  }, [loadPropertyDetail, requestedPropertyId, requestedTab]);

  useEffect(() => {
    if (!selectedId || sheetTab !== "Market / Comps") return;
    void loadBrokerComps(selectedId);
  }, [loadBrokerComps, selectedId, sheetTab]);

  useEffect(() => {
    setGalleryIndex(0);
    setGalleryExpanded(false);
    setDocumentUploadFiles([]);
    setDocumentUploadError(null);
  }, [selectedId]);

  const openProperty = useCallback(
    async (row: PipelineRow) => {
      setSheetTab("Overview");
      setSheetFullscreen(false);
      setBrokerEditOpen(false);
      setSourceFactsEditOpen(false);
      setNotice(null);
      const params = new URLSearchParams(queryString);
      params.set("propertyId", row.propertyId);
      params.delete("property_id");
      params.delete("expand");
      params.delete("tab");
      const next = params.toString();
      router.replace(next ? `${PIPELINE_PATH}?${next}` : PIPELINE_PATH);
      await loadPropertyDetail(row.propertyId);
    },
    [loadPropertyDetail, queryString, router]
  );

  const closeSheet = useCallback(() => {
    setSelectedId(null);
    setSelectedProperty(null);
    setBrokerEditOpen(false);
    setSourceFactsEditOpen(false);
    setSheetFullscreen(false);
    setGalleryExpanded(false);
    setNewTag("");
    const params = new URLSearchParams(queryString);
    params.delete("propertyId");
    params.delete("property_id");
    params.delete("expand");
    params.delete("tab");
    const next = params.toString();
    router.replace(next ? `${PIPELINE_PATH}?${next}` : PIPELINE_PATH);
  }, [queryString, router]);

  const refreshSelected = useCallback(async () => {
    if (selectedId) await loadPropertyDetail(selectedId);
  }, [loadPropertyDetail, selectedId]);

  function toggleSelected(propertyId: string) {
    setSelectedIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId]
    );
  }

  function toggleAllVisible() {
    setSelectedIds(allVisibleSelected ? [] : rows.map((row) => row.propertyId));
  }

  async function updateMarketType(row: PipelineRow, marketType: UiV2MarketType) {
    const nextTags = [
      ...row.tags.filter((tag) => {
        const normalized = normalizeTag(tag);
        return normalized !== "on_market" && normalized !== "off_market" && normalized !== "market_unknown";
      }),
      ...(marketType === "unknown" ? [] : [marketType]),
    ];
    setBusyAction(`${row.propertyId}:market-type`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${row.propertyId}/tags`, {
        method: "PUT",
        body: JSON.stringify({ tags: nextTags, source: "pipeline_table" }),
      });
      applyProperty(response.property);
      setNotice(`Type set to ${marketTypeLabel(marketType)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update property type.");
    } finally {
      setBusyAction(null);
    }
  }

  /**
   * "Refresh listings" composite: enrichment → rental flow → OM analysis →
   * dossier generation for the selection, each stage as its own dismissible
   * banner. The RapidAPI listing-details pull (GET DETAILS via the stored
   * source link) is opt-in through the toggle so refreshes don't spend
   * listing credits by default. Stage failures are collected, not fatal.
   */
  async function refreshSelectedListings() {
    if (selectedIds.length === 0) return;
    const propertyIds = [...selectedIds];
    const omRows = selectedRowsWithOm;
    const omSkipped = propertyIds.length - omRows.length;
    const addressById = new Map(
      rows.map((row) => [row.propertyId, row.displayAddress ?? row.canonicalAddress ?? row.propertyId])
    );
    const stageFailures: string[] = [];
    setBusyAction("bulk:listings");
    setNotice(null);
    setError(null);

    if (includeListingPull) {
      const listingBanner = processBanner.start("Listing details (RapidAPI)", {
        message: `Pulling latest details for ${propertyIds.length} listing${propertyIds.length === 1 ? "" : "s"} via stored source links…`,
      });
      try {
        const payload = await apiFetch<ListingRefreshResponse>(`${API_BASE}/api/properties/refresh-listings`, {
          method: "POST",
          body: JSON.stringify({ propertyIds }),
        });
        const summary = payload.streetEasyRefresh ?? {};
        const success = Number(summary.success ?? 0);
        const attempted = Number(summary.attempted ?? 0);
        const priceChanged = Number(summary.priceChanged ?? 0);
        const unavailable = Number(summary.unavailable ?? 0);
        listingBanner.succeed(
          `Listing details refreshed: ${success}/${attempted || propertyIds.length}${
            priceChanged > 0 ? `; ${priceChanged} ask change${priceChanged === 1 ? "" : "s"}` : ""
          }${unavailable > 0 ? `; ${unavailable} unavailable flagged` : ""}.`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Listing details refresh failed.";
        listingBanner.fail(message);
        stageFailures.push(`listing details (${message})`);
      }
    }

    const enrichmentBanner = processBanner.start("Enrichment refresh", {
      message: `Running enrichment for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}…`,
    });
    try {
      const enrichmentResponse = await fetch(`${API_BASE}/api/properties/run-enrichment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // The listing pull is its own opt-in stage above; never double-pull here.
        body: JSON.stringify({ propertyIds, refreshStreetEasy: false }),
      });
      const enrichmentPayload = await enrichmentResponse.json().catch(() => ({}));
      if (!enrichmentResponse.ok) {
        throw new Error(enrichmentPayload.error || enrichmentPayload.details || "Enrichment refresh failed.");
      }
      enrichmentBanner.succeed(`Enrichment refreshed for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Enrichment refresh failed.";
      enrichmentBanner.fail(message);
      stageFailures.push(`enrichment (${message})`);
    }

    const rentalBanner = processBanner.start("Rental flow", {
      message: `Refreshing rental comps + MTR inputs for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}…`,
    });
    try {
      const rentalResponse = await fetch(`${API_BASE}/api/properties/run-rental-flow`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds, refreshStreetEasy: false, runEnrichment: false }),
      });
      const rentalPayload = await rentalResponse.json().catch(() => ({}));
      if (!rentalResponse.ok) {
        throw new Error(rentalPayload.error || rentalPayload.details || "Rental flow failed.");
      }
      rentalBanner.succeed(`Rental flow refreshed for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rental flow failed.";
      rentalBanner.fail(message);
      stageFailures.push(`rental flow (${message})`);
    }

    let omCompleted = 0;
    let omFailed = 0;
    if (omRows.length > 0) {
      const omBanner = processBanner.start("OM analysis refresh", {
        message: `Updating OM analysis for ${omRows.length} propert${omRows.length === 1 ? "y" : "ies"}…`,
      });
      for (let index = 0; index < omRows.length; index++) {
        const propertyId = omRows[index]!.propertyId;
        omBanner.update(
          `Updating OM analysis ${index + 1} of ${omRows.length}: ${addressById.get(propertyId) ?? "selected property"}`,
          Math.round((index / omRows.length) * 100)
        );
        try {
          await apiFetch<OmRefreshResponse>(`${API_BASE}/api/properties/${propertyId}/refresh-om-financials`, {
            method: "POST",
            body: JSON.stringify({ autoPromote: true }),
          });
          omCompleted++;
        } catch {
          omFailed++;
        }
      }
      if (omFailed > 0) {
        omBanner.fail(`OM analysis updated for ${omCompleted} of ${omRows.length}; ${omFailed} failed.`);
        stageFailures.push(`OM analysis (${omFailed} failed)`);
      } else {
        omBanner.succeed(`OM analysis updated for ${omCompleted} propert${omCompleted === 1 ? "y" : "ies"}.`);
      }
    }

    let dossierCompleted = 0;
    let dossierFailed = 0;
    if (omRows.length > 0) {
      const dossierBanner = processBanner.start("Dossier generation", {
        message: `Rerunning dossiers for ${omRows.length} propert${omRows.length === 1 ? "y" : "ies"}…`,
      });
      for (let index = 0; index < omRows.length; index++) {
        const propertyId = omRows[index]!.propertyId;
        dossierBanner.update(
          `Generating dossier ${index + 1} of ${omRows.length}: ${addressById.get(propertyId) ?? "selected property"}`,
          Math.round((index / omRows.length) * 100)
        );
        try {
          const response = await fetch(`${API_BASE}/api/dossier/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // OM analysis already refreshed in the previous stage.
            body: JSON.stringify({ propertyId, refreshOm: false }),
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as DossierGenerateResponse;
            throw new Error(payload.details || payload.error || `Request failed with ${response.status}`);
          }
          dossierCompleted++;
        } catch {
          dossierFailed++;
        }
      }
      if (dossierFailed > 0) {
        dossierBanner.fail(`Dossiers generated for ${dossierCompleted} of ${omRows.length}; ${dossierFailed} failed.`);
        stageFailures.push(`dossiers (${dossierFailed} failed)`);
      } else {
        dossierBanner.succeed(`Dossiers + Excel regenerated for ${dossierCompleted} propert${dossierCompleted === 1 ? "y" : "ies"}.`);
      }
    }

    try {
      await reloadPipelineRows();
      if (selectedId) await loadPropertyDetail(selectedId).catch(() => null);
    } catch {
      // Stage banners already carry per-stage outcomes.
    }

    const summaryParts = [
      `Full refresh finished for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
      omSkipped > 0 ? `${omSkipped} without OM skipped OM/dossier stages` : null,
      includeListingPull ? "listing details included" : "listing details pull off",
    ].filter(Boolean);
    if (stageFailures.length > 0) {
      setError(`Some refresh stages had issues: ${stageFailures.join("; ")}.`);
    }
    setNotice(`${summaryParts.join("; ")}.`);
    setBusyAction(null);
  }

  async function refreshSelectedEnrichment() {
    if (selectedIds.length === 0) return;
    setBusyAction("bulk:refresh");
    setNotice(null);
    setError(null);
    const banner = processBanner.start("Enrichment refresh", {
      message: `Running enrichment + rental flow for ${selectedIds.length} propert${selectedIds.length === 1 ? "y" : "ies"}…`,
    });
    try {
      const propertyIds = [...selectedIds];
      const enrichmentResponse = await fetch(`${API_BASE}/api/properties/run-enrichment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      const enrichmentPayload = await enrichmentResponse.json().catch(() => ({}));
      if (!enrichmentResponse.ok) {
        throw new Error(enrichmentPayload.error || enrichmentPayload.details || "Failed to refresh enrichment.");
      }
      const rentalResponse = await fetch(`${API_BASE}/api/properties/run-rental-flow`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // StreetEasy + enrichment already ran in run-enrichment above; only the rental flow remains.
        body: JSON.stringify({ propertyIds, refreshStreetEasy: false, runEnrichment: false }),
      });
      const rentalPayload = await rentalResponse.json().catch(() => ({}));
      if (!rentalResponse.ok) {
        throw new Error(rentalPayload.error || rentalPayload.details || "Enrichment refreshed, but rental flow failed.");
      }
      const priceChanged = Number(enrichmentPayload?.streetEasyRefresh?.priceChanged ?? 0);
      const enrichmentSummary = `Refresh completed for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}${
        priceChanged > 0 ? `; ${priceChanged} ask change${priceChanged === 1 ? "" : "s"} found` : ""
      }.`;
      setNotice(enrichmentSummary);
      banner.succeed(enrichmentSummary);
      const response = await apiFetch<PipelineResponse>(
        `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
      );
      setRows(response.pipeline.rows as PipelineRow[]);
      setTotal(response.pipeline.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh selected properties.";
      banner.fail(message);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshOmAnalysisForProperty(propertyId: string) {
    const row = rows.find((candidate) => candidate.propertyId === propertyId) ?? null;
    const detailHasOm = selectedId === propertyId && propertyDetailHasOm(selectedProperty);
    if (!pipelineRowHasOm(row) && !detailHasOm) {
      setError("Upload an OM before refreshing OM analysis.");
      return;
    }
    setBusyAction(`${propertyId}:om-analysis`);
    setNotice(null);
    setError(null);
    const banner = processBanner.start("OM analysis refresh", {
      message: row?.displayAddress ?? row?.canonicalAddress ?? "Re-running OM extraction…",
    });
    try {
      const payload = await apiFetch<OmRefreshResponse>(`${API_BASE}/api/properties/${propertyId}/refresh-om-financials`, {
        method: "POST",
        body: JSON.stringify({ autoPromote: true }),
      });
      await reloadPipelineRows();
      if (selectedId === propertyId) await loadPropertyDetail(propertyId).catch(() => null);
      const processed = Number(payload.documentsProcessed ?? 0);
      const omRefreshSummary = `OM analysis ${payload.status === "promoted" ? "updated" : "refreshed"}${
        processed > 0 ? ` from ${processed} document${processed === 1 ? "" : "s"}` : ""
      }${payload.underwritingRefreshed ? "; yield numbers recalculated" : ""}.`;
      setNotice(omRefreshSummary);
      banner.succeed(omRefreshSummary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh OM analysis.";
      banner.fail(message);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function rerunDossierForProperty(propertyId: string) {
    const row = rows.find((candidate) => candidate.propertyId === propertyId) ?? null;
    const detailHasOm = selectedId === propertyId && propertyDetailHasOm(selectedProperty);
    if (!pipelineRowHasOm(row) && !detailHasOm) {
      setError("Upload an OM before rerunning the deal dossier.");
      return;
    }
    setBusyAction(`${propertyId}:dossier`);
    setNotice(null);
    setError(null);
    const banner = processBanner.start("Dossier rerun", {
      message: row?.displayAddress ?? row?.canonicalAddress ?? "Re-running OM analysis + dossier…",
    });
    try {
      const payload = await apiFetch<DossierGenerateResponse>(`${API_BASE}/api/dossier/generate`, {
        method: "POST",
        body: JSON.stringify({ propertyId, refreshOm: true }),
      });
      await reloadPipelineRows();
      if (selectedId === propertyId) await loadPropertyDetail(propertyId).catch(() => null);
      const score = typeof payload.dealScore === "number" && Number.isFinite(payload.dealScore)
        ? ` Score ${Math.round(payload.dealScore)}/100.`
        : "";
      const omNote =
        payload.omRefresh?.status === "promoted"
          ? " OM analysis re-ran first."
          : payload.omRefresh?.status === "failed"
            ? " OM analysis re-run failed; existing OM analysis was used."
            : "";
      const auditStatus = payload.workbookAudit?.status;
      const auditNote =
        auditStatus === "pass"
          ? " Workbook audit: pass."
          : auditStatus === "warnings"
            ? " Workbook audit: warnings — check assumptions."
            : auditStatus === "failed"
              ? " Workbook audit FAILED — the Excel may not tie to the model."
              : "";
      const dossierSummary = `Deal dossier rerun completed.${score}${omNote}${auditNote}`;
      setNotice(dossierSummary);
      banner.succeed(dossierSummary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rerun deal dossier.";
      banner.fail(message);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshSelectedOmAnalysis() {
    if (selectedIds.length === 0) return;
    const rowsToRefresh = selectedRowsWithOm;
    if (rowsToRefresh.length === 0) {
      setError("Select at least one property with an uploaded OM before refreshing OM analysis.");
      return;
    }
    const skipped = selectedIds.length - rowsToRefresh.length;
    const addressById = new Map(
      rows.map((row) => [row.propertyId, row.displayAddress ?? row.canonicalAddress ?? row.propertyId])
    );
    let yieldsRefreshed = 0;
    setBusyAction("bulk:om-analysis");
    setError(null);
    const banner = processBanner.start("OM analysis refresh", {
      message: `Updating ${rowsToRefresh.length} propert${rowsToRefresh.length === 1 ? "y" : "ies"}…`,
    });
    try {
      const summary = await runBulkPropertyAction({
        rows: rowsToRefresh.map((row) => ({
          propertyId: row.propertyId,
          address: addressById.get(row.propertyId) ?? row.propertyId,
        })),
        skippedCount: skipped,
        noun: "property",
        progressVerb: "Updating OM analysis",
        successVerb: "OM analysis updated",
        failureNoun: "OM analysis refresh",
        banner,
        onProgress: setNotice,
        runOne: async ({ propertyId }) => {
          const payload = await apiFetch<OmRefreshResponse>(
            `${API_BASE}/api/properties/${propertyId}/refresh-om-financials`,
            {
              method: "POST",
              body: JSON.stringify({ autoPromote: true }),
            }
          );
          if (payload.underwritingRefreshed) yieldsRefreshed++;
        },
        extraSummary: () =>
          yieldsRefreshed > 0
            ? ` Yield numbers recalculated for ${yieldsRefreshed} propert${yieldsRefreshed === 1 ? "y" : "ies"}.`
            : "",
      });

      await reloadPipelineRows();
      if (selectedId) await loadPropertyDetail(selectedId).catch(() => null);
      if (summary.errorMessage) setError(summary.errorMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh selected OM analysis.";
      banner.fail(message);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function rerunSelectedDossiers() {
    if (selectedIds.length === 0) return;
    const rowsToRerun = selectedRowsWithOm;
    if (rowsToRerun.length === 0) {
      setError("Select at least one property with an uploaded OM before rerunning dossiers.");
      return;
    }
    const skipped = selectedIds.length - rowsToRerun.length;
    const addressById = new Map(
      rows.map((row) => [row.propertyId, row.displayAddress ?? row.canonicalAddress ?? row.propertyId])
    );
    let omRefreshFailures = 0;
    let auditIssues = 0;
    setBusyAction("bulk:dossier");
    setError(null);
    const banner = processBanner.start("Dossier rerun", {
      message: `Re-running OM analysis + dossiers for ${rowsToRerun.length} propert${rowsToRerun.length === 1 ? "y" : "ies"}…`,
    });
    try {
      const summary = await runBulkPropertyAction({
        rows: rowsToRerun.map((row) => ({
          propertyId: row.propertyId,
          address: addressById.get(row.propertyId) ?? row.propertyId,
        })),
        skippedCount: skipped,
        noun: "property",
        progressVerb: "Rerunning OM analysis + dossier",
        successVerb: "Dossiers and Excel regenerated",
        failureNoun: "dossier rerun",
        banner,
        onProgress: setNotice,
        runOne: async ({ propertyId }) => {
          const response = await fetch(`${API_BASE}/api/dossier/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propertyId, refreshOm: true }),
          });
          const payload = (await response.json().catch(() => ({}))) as DossierGenerateResponse;
          if (!response.ok) {
            throw new Error(payload.details || payload.error || `Request failed with ${response.status}`);
          }
          if (payload.omRefresh?.status === "failed") omRefreshFailures++;
          if (payload.workbookAudit?.status && payload.workbookAudit.status !== "pass") auditIssues++;
        },
        extraSummary: () => {
          const omRefreshMessage =
            omRefreshFailures > 0
              ? ` OM analysis re-run failed for ${omRefreshFailures} propert${omRefreshFailures === 1 ? "y" : "ies"} (existing OM analysis used).`
              : "";
          const auditMessage =
            auditIssues > 0 ? ` Workbook audit raised issues on ${auditIssues} propert${auditIssues === 1 ? "y" : "ies"}.` : "";
          return `${omRefreshMessage}${auditMessage}`;
        },
      });

      await reloadPipelineRows();
      if (selectedId) await loadPropertyDetail(selectedId).catch(() => null);
      if (summary.errorMessage) setError(summary.errorMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rerun dossier generation.";
      banner.fail(message);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function openGroupedEmailPreview() {
    const propertyIds = selectedRows.map((row) => row.propertyId);
    if (propertyIds.length === 0) return;
    setBusyAction("bulk:email-preview");
    setOutreachPreview({ loading: true, sending: false, batches: [], skipped: [] });
    try {
      const response = await fetch(`${API_BASE}/api/properties/preview-bulk-inquiry-emails`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.details || "Failed to preview broker emails.");
      }
      setOutreachPreview({
        loading: false,
        sending: false,
        batches: Array.isArray(payload.batches) ? (payload.batches as OutreachPreviewBatch[]) : [],
        skipped: Array.isArray(payload.skipped) ? (payload.skipped as OutreachPreviewSkipped[]) : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to preview broker emails.";
      setOutreachPreview(null);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function sendGroupedEmails() {
    if (!outreachPreview || outreachPreview.sending || outreachPreview.batches.length === 0) return;
    setOutreachPreview({ ...outreachPreview, sending: true });
    const banner = processBanner.start("Broker emails", {
      message: `Sending ${outreachPreview.batches.length} grouped email${outreachPreview.batches.length === 1 ? "" : "s"}…`,
    });
    try {
      const response = await fetch(`${API_BASE}/api/properties/send-bulk-inquiry-emails`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "grouped",
          batches: outreachPreview.batches.map((batch) => ({
            toAddress: batch.toAddress,
            propertyIds: batch.propertyIds,
            subject: batch.subject,
            body: batch.body,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.details || "Failed to send broker emails.");
      }
      const failedCount = Number(payload.failed ?? 0);
      const summary = `Broker emails: ${payload.sent ?? 0} sent${failedCount ? `, ${failedCount} failed` : ""}${
        payload.skippedProperties ? `, ${payload.skippedProperties} propert${payload.skippedProperties === 1 ? "y" : "ies"} skipped by guards` : ""
      }.`;
      type GroupedSendResult = { toAddress?: string; status?: string; error?: string | null };
      const results: GroupedSendResult[] = Array.isArray(payload.results) ? payload.results : [];
      if (failedCount > 0) {
        // Keep the modal open with ONLY the failed drafts (edits preserved) so
        // the user can retry without rewriting them.
        const failedAddresses = new Set(
          results.filter((result) => result.status === "failed").map((result) => result.toAddress)
        );
        const firstError = results.find((result) => result.status === "failed")?.error;
        banner.fail(summary);
        setError(
          `${summary}${firstError ? ` First failure: ${firstError}` : ""} The failed draft${failedCount === 1 ? " is" : "s are"} still open below — fix and resend.`
        );
        setOutreachPreview((current) =>
          current
            ? {
                ...current,
                sending: false,
                batches: current.batches.filter((batch) => failedAddresses.has(batch.toAddress)),
              }
            : current
        );
      } else {
        banner.succeed(summary);
        setNotice(summary);
        setOutreachPreview(null);
      }
      const refreshed = await apiFetch<PipelineResponse>(
        `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
      );
      setRows(refreshed.pipeline.rows as PipelineRow[]);
      setTotal(refreshed.pipeline.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send broker emails.";
      banner.fail(message);
      setOutreachPreview((current) => (current ? { ...current, sending: false } : current));
      setError(message);
    }
  }

  // Table keyboard triage: j/k row focus, enter opens the sheet, e emails.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (selectedId || rejectState || composer || brokerPrompt) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (rows.length === 0) return;

      const currentIndex = rows.findIndex((row) => row.propertyId === keyboardRowId);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = rows[Math.min(currentIndex + 1, rows.length - 1)] ?? rows[0];
        setKeyboardRowId(next.propertyId);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = currentIndex <= 0 ? rows[0] : rows[currentIndex - 1];
        setKeyboardRowId(next.propertyId);
        return;
      }
      const focused = currentIndex >= 0 ? rows[currentIndex] : null;
      if (!focused) return;
      if (event.key === "Enter") {
        event.preventDefault();
        openProperty(focused);
        return;
      }
      if (event.key === "e") {
        event.preventDefault();
        if (focused.broker?.email) void emailBroker(focused.propertyId, "pipeline_table");
        else openBrokerPrompt(focused);
        return;
      }
      if (event.key === "Escape") setKeyboardRowId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable function declarations in this component
  }, [rows, keyboardRowId, selectedId, rejectState, composer, brokerPrompt]);

  // $/SF sanity: flag values more than 3σ from the visible rows' average.
  const psfStats = useMemo(() => {
    const values = rows
      .map((row) => row.pricePerSqft)
      .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
    if (values.length < 8) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const sd = Math.sqrt(variance);
    return sd > 0 ? { mean, sd } : null;
  }, [rows]);

  // Neighborhood $/SF context (deals + ingested research comps) keyed by every
  // known alias, so listing/StreetEasy area labels match the market layer's
  // polygons. Non-fatal: without it the flags fall back to defaults below.
  const [neighborhoodPsf, setNeighborhoodPsf] = useState<{
    byAlias: Map<string, { name: string; medianPsf: number; count: number; dealCount: number; compCount: number }>;
    defaultHighPsf: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await apiFetch<{
          neighborhoods?: Array<{
            name: string;
            aliases?: string[];
            medianPsf: number;
            count: number;
            dealCount?: number;
            compCount?: number;
          }>;
          defaultHighPsf?: number;
        }>(`${API_BASE}/api/comps/neighborhood-psf`);
        if (cancelled) return;
        const byAlias = new Map<string, { name: string; medianPsf: number; count: number; dealCount: number; compCount: number }>();
        for (const entry of payload.neighborhoods ?? []) {
          const value = {
            name: entry.name,
            medianPsf: entry.medianPsf,
            count: entry.count,
            dealCount: entry.dealCount ?? 0,
            compCount: entry.compCount ?? 0,
          };
          for (const alias of [entry.name, ...(entry.aliases ?? [])]) {
            const key = normalizeAreaName(alias);
            if (key && !byAlias.has(key)) byAlias.set(key, value);
          }
        }
        setNeighborhoodPsf({ byAlias, defaultHighPsf: payload.defaultHighPsf ?? 2000 });
      } catch {
        // Highlighting falls back to the default threshold + 3σ rule.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * $/SF highlight precedence: (1) the deal's neighborhood median when we have
   * enough observations (±25%), (2) the $2,000/SF default high-end threshold
   * when the neighborhood is unknown or thin, (3) the 3σ outlier rule against
   * visible rows as the catch-all.
   */
  const psfFlagFor = useCallback(
    (row: PipelineRow): YieldFlag | null => {
      const psf = row.pricePerSqft;
      if (psf == null || !Number.isFinite(psf) || psf <= 0) return null;

      const areaEntry = (() => {
        if (!neighborhoodPsf) return null;
        for (const candidate of [row.neighborhood, row.borough]) {
          if (typeof candidate !== "string" || !candidate.trim()) continue;
          const match = neighborhoodPsf.byAlias.get(normalizeAreaName(candidate));
          if (match) return match;
        }
        return null;
      })();

      if (areaEntry && areaEntry.count >= 3 && areaEntry.medianPsf > 0) {
        const ratio = psf / areaEntry.medianPsf;
        if (ratio >= 1.25 || ratio <= 0.75) {
          const pct = Math.abs(Math.round((ratio - 1) * 100));
          return {
            severity: "warn",
            label: ratio > 1 ? "High" : "Low",
            title: `$/SF is ${pct}% ${ratio > 1 ? "above" : "below"} the ${areaEntry.name} median (${formatCurrency(
              areaEntry.medianPsf,
              false
            )}/SF across ${areaEntry.count} deal${areaEntry.count === 1 ? "" : "s"} + research comps).`,
          };
        }
        return null;
      }

      const defaultHigh = neighborhoodPsf?.defaultHighPsf ?? 2000;
      if (psf >= defaultHigh) {
        return {
          severity: "warn",
          label: "High",
          title: `$/SF is at/above the ${formatCurrency(defaultHigh, false)}/SF default high-end threshold — no neighborhood comp context yet for this area.`,
        };
      }

      if (!psfStats) return null;
      const z = (psf - psfStats.mean) / psfStats.sd;
      if (Math.abs(z) < 3) return null;
      return {
        severity: "warn",
        label: z > 0 ? "High" : "Low",
        title: `$/SF is ${Math.abs(z).toFixed(1)}σ ${z > 0 ? "above" : "below"} the visible average (${formatCurrency(psfStats.mean, false)}).`,
      };
    },
    [psfStats, neighborhoodPsf]
  );

  function openBrokerPrompt(row: PipelineRow, event?: MouseEvent<HTMLButtonElement>) {
    event?.stopPropagation();
    setBrokerPrompt({
      propertyId: row.propertyId,
      address: row.displayAddress ?? row.canonicalAddress,
      name: row.broker?.name ?? "",
      email: row.broker?.email ?? "",
      saving: false,
    });
  }

  async function submitBrokerPrompt() {
    if (!brokerPrompt || brokerPrompt.saving) return;
    setBrokerPrompt({ ...brokerPrompt, saving: true });
    try {
      await apiFetch(`${API_BASE}/api/ui-v2/properties/${encodeURIComponent(brokerPrompt.propertyId)}/broker`, {
        method: "PUT",
        body: JSON.stringify({
          email: brokerPrompt.email.trim(),
          name: brokerPrompt.name.trim() || null,
          actorName: "pipeline_table",
        }),
      });
      const savedEmail = brokerPrompt.email.trim();
      const savedName = brokerPrompt.name.trim();
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.propertyId === brokerPrompt.propertyId
            ? {
                ...row,
                broker: {
                  ...(row.broker ?? {}),
                  email: savedEmail || row.broker?.email || null,
                  name: savedName || row.broker?.name || null,
                },
              }
            : row
        ) as PipelineRow[]
      );
      setBrokerPrompt(null);
      setNotice(`Broker contact saved for ${brokerPrompt.address}.`);
      if (selectedId === brokerPrompt.propertyId) await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the broker contact.");
      setBrokerPrompt((current) => (current ? { ...current, saving: false } : current));
    }
  }

  function brokerCandidatesFromEntries(entries: unknown): BrokerSearchCandidate[] {
    const candidates: BrokerSearchCandidate[] = [];
    if (!Array.isArray(entries)) return candidates;
    for (const raw of entries) {
      const entry = raw as {
        name?: string | null;
        firm?: string | null;
        email?: string | null;
        phone?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        sourceUrl?: string | null;
        verificationTier?: string | null;
        rejectedCandidate?: {
          email?: string | null;
          phone?: string | null;
          firm?: string | null;
          confidence?: number | null;
          evidence?: string | null;
          sourceUrl?: string | null;
        } | null;
      };
      if (entry?.email) {
        candidates.push({
          name: entry.name ?? null,
          email: entry.email,
          phone: entry.phone ?? null,
          firm: entry.firm ?? null,
          confidence: entry.confidence ?? null,
          evidence: entry.evidence ?? null,
          sourceUrl: entry.sourceUrl ?? null,
          tier: entry.verificationTier === "needs_review" ? "needs_review" : "verified",
        });
      }
      const retained = entry?.rejectedCandidate;
      if (retained && (retained.email || retained.phone)) {
        candidates.push({
          name: entry.name ?? null,
          email: retained.email ?? null,
          phone: retained.phone ?? null,
          firm: retained.firm ?? null,
          confidence: retained.confidence ?? null,
          evidence: retained.evidence ?? null,
          sourceUrl: retained.sourceUrl ?? null,
          tier: entry.verificationTier === "rejected" ? "rejected" : "needs_review",
        });
      }
    }
    return candidates;
  }

  async function searchBrokerContact() {
    if (!brokerPrompt || brokerPrompt.searching) return;
    const propertyId = brokerPrompt.propertyId;
    setBrokerPrompt((current) =>
      current ? { ...current, searching: true, searchMessage: "Searching the web for this listing's brokers…", candidates: null } : current
    );
    try {
      const response = await fetch(
        `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/refresh-broker-enrichment`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true, deep: true }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.details || "Broker search failed.");
      }
      const candidates = brokerCandidatesFromEntries(payload.entries);
      const verified = candidates.find((candidate) => candidate.tier === "verified" && candidate.email);
      if (verified?.email) {
        setRows((currentRows) =>
          currentRows.map((row) =>
            row.propertyId === propertyId
              ? {
                  ...row,
                  broker: {
                    ...(row.broker ?? {}),
                    email: verified.email,
                    name: verified.name ?? row.broker?.name ?? null,
                  },
                }
              : row
          ) as PipelineRow[]
        );
      }
      const message =
        payload.status === "no_listing"
          ? "No linked listing — add the broker manually or link a StreetEasy listing first."
          : payload.status === "no_agent_names"
            ? "The listing has no agent names to search for."
            : candidates.length === 0
              ? "No contacts found. Try again later or add the broker manually."
              : verified
                ? "Verified contact found and saved to the property. You can still pick a different candidate below."
                : "No verified contact, but review the candidates below — Use fills the form, Save confirms it.";
      setBrokerPrompt((current) =>
        current && current.propertyId === propertyId
          ? {
              ...current,
              searching: false,
              searchMessage: message,
              candidates,
              email: current.email || verified?.email || "",
              name: current.name || verified?.name || "",
            }
          : current
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Broker search failed.";
      setBrokerPrompt((current) =>
        current && current.propertyId === propertyId
          ? { ...current, searching: false, searchMessage: message }
          : current
      );
    }
  }

  async function refreshSelectedBrokerContacts() {
    if (selectedIds.length === 0) return;
    setBusyAction("bulk:broker");
    setNotice(null);
    setError(null);
    const banner = processBanner.start("Broker contact refresh", {
      message: `Searching broker contacts for ${selectedIds.length} propert${selectedIds.length === 1 ? "y" : "ies"}…`,
    });
    try {
      const propertyIds = [...selectedIds];
      const response = await fetch(`${API_BASE}/api/properties/refresh-broker-enrichment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.details || "Failed to refresh broker contacts.");
      }
      const counts = payload.counts ?? {};
      const summary = `Broker contacts: ${counts.updated ?? 0} updated, ${counts.unchanged ?? 0} unchanged, ${counts.skipped ?? 0} skipped${
        counts.failed ? `, ${counts.failed} failed` : ""
      }.`;
      setNotice(summary);
      banner.succeed(summary);
      const refreshed = await apiFetch<PipelineResponse>(
        `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
      );
      setRows(refreshed.pipeline.rows as PipelineRow[]);
      setTotal(refreshed.pipeline.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh broker contacts.";
      banner.fail(message);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  function openBulkRejectModal() {
    if (selectedRejectableRows.length === 0) {
      setError("Select at least one active property to reject.");
      return;
    }
    setError(null);
    setRejectState({
      propertyId: selectedRejectableRows[0]!.propertyId,
      propertyIds: selectedRejectableRows.map((row) => row.propertyId),
      address:
        selectedRejectableRows.length === 1
          ? selectedRejectableRows[0]!.displayAddress ?? selectedRejectableRows[0]!.canonicalAddress
          : `${selectedRejectableRows.length} selected properties`,
      surface: "pipeline_table",
      reasonCode: "",
      note: "",
    });
  }

  async function updateStatus(propertyId: string, status: UiV2PipelineStatus, surface: UiV2ActionSurface) {
    const row = rows.find((item) => item.propertyId === propertyId);
    if (status === "rejected") {
      setRejectState({
        propertyId,
        address: row?.displayAddress ?? row?.canonicalAddress ?? selectedProperty?.overview.canonicalAddress ?? "Property",
        surface,
        reasonCode: "",
        note: "",
      });
      return;
    }

    setBusyAction(`${propertyId}:status`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${propertyId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, source: surface }),
      });
      applyProperty(response.property);
      setNotice(`Status moved to ${statusLabel(status)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveDeal(propertyId: string, surface: UiV2ActionSurface) {
    setBusyAction(`${propertyId}:save`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${propertyId}/save`, {
        method: "POST",
        body: JSON.stringify({ source: surface }),
      });
      applyProperty(response.property);
      setNotice("Deal saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save deal.");
    } finally {
      setBusyAction(null);
    }
  }

  async function restoreDeal(propertyId: string, surface: UiV2ActionSurface) {
    setBusyAction(`${propertyId}:restore`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${propertyId}/restore`, {
        method: "POST",
        body: JSON.stringify({ source: surface }),
      });
      applyProperty(response.property);
      setNotice("Property restored.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore property.");
    } finally {
      setBusyAction(null);
    }
  }

  function requestMergeIntoSelectedTarget(row: PipelineRow) {
    const targetIds = selectedIds.filter((id) => id !== row.propertyId);
    if (targetIds.length !== 1) {
      setError("Select exactly one source row as the merge target, then use More on the duplicate row.");
      return;
    }
    const targetId = targetIds[0]!;
    const targetRow = rows.find((candidate) => candidate.propertyId === targetId);
    setMergePrompt({
      row,
      targetId,
      sourceLabel: row.displayAddress ?? row.canonicalAddress,
      targetLabel: targetRow?.displayAddress ?? targetRow?.canonicalAddress ?? "the selected source row",
    });
  }

  async function performMerge({ row, targetId, sourceLabel, targetLabel }: MergePromptState) {
    setBusyAction(`${row.propertyId}:merge`);
    setNotice(null);
    setError(null);
    try {
      const response = await apiFetch<MergePropertyResponse>(
        `${API_BASE}/api/ui-v2/properties/${encodeURIComponent(row.propertyId)}/merge-into`,
        {
          method: "POST",
          body: JSON.stringify({ targetPropertyId: targetId, actorName: "pipeline_table" }),
        }
      );
      const property = normalizePropertyDetail(response.property);
      if (property) {
        setSelectedId(property.overview.propertyId);
        setSelectedProperty(property);
        applyProperty(property);
      }
      await reloadPipelineRows();
      setSelectedIds((current) => current.filter((id) => id !== row.propertyId));
      setNotice(`Merged ${sourceLabel} into ${targetLabel}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge properties.");
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectState?.reasonCode) return;
    const { propertyId, surface, reasonCode, note } = rejectState;
    const propertyIds = rejectState.propertyIds?.length ? rejectState.propertyIds : [propertyId];
    const isBulkReject = propertyIds.length > 1;
    // Resolve labels before the bulk path replaces `rows` with the reloaded list.
    const rejectedLabels = propertyIds.map((id) => {
      const row = rows.find((candidate) => candidate.propertyId === id);
      return row?.displayAddress ?? row?.canonicalAddress ?? id;
    });
    setBusyAction(isBulkReject ? "bulk:reject" : `${propertyId}:reject`);
    setNotice(null);
    setError(null);
    try {
      const failures: Array<{ propertyId: string; message: string }> = [];
      for (const id of propertyIds) {
        try {
          const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${encodeURIComponent(id)}/reject`, {
            method: "POST",
            body: JSON.stringify({
              status: "rejected",
              rejection: { reasonCode, note: note.trim() || null },
              source: surface,
            }),
          });
          if (!isBulkReject) applyProperty(response.property);
        } catch (err) {
          failures.push({ propertyId: id, message: err instanceof Error ? err.message : "Failed to reject property." });
        }
      }

      if (isBulkReject) {
        const response = await apiFetch<PipelineResponse>(
          `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
        );
        setRows(response.pipeline.rows as PipelineRow[]);
        setTotal(response.pipeline.total);
        const rejectedSet = new Set(propertyIds);
        setSelectedIds((current) => current.filter((id) => !rejectedSet.has(id)));
        if (!filterValues.includeRejected && selectedId && rejectedSet.has(selectedId)) {
          setSelectedId(null);
          setSelectedProperty(null);
        } else if (selectedId) {
          await loadPropertyDetail(selectedId).catch(() => null);
        }
      }

      setRejectState(null);
      const failedSet = new Set(failures.map((failure) => failure.propertyId));
      const completedLabels = propertyIds
        .map((id, index) => ({ id, label: rejectedLabels[index]! }))
        .filter(({ id }) => !failedSet.has(id))
        .map(({ label }) => label);
      setNotice(
        isBulkReject
          ? completedLabels.length === 0
            ? "No properties were rejected."
            : `Rejected ${completedLabels.slice(0, 3).join(", ")}${
                completedLabels.length > 3 ? ` and ${completedLabels.length - 3} more` : ""
              }.`
          : "Property rejected."
      );
      if (failures.length > 0) {
        setError(
          `${failures.length} rejection${failures.length === 1 ? "" : "s"} failed. First issue: ${failures[0]!.message}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject property.");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveBroker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setBusyAction(`${selectedId}:broker`);
    setNotice(null);
    try {
      const response = await apiFetch<BrokerResponse>(`${API_BASE}/api/ui-v2/properties/${selectedId}/broker`, {
        method: "PUT",
        body: JSON.stringify({
          ...brokerForm,
          actorName: "ui-v2",
          source: "property_sheet",
          overwriteTarget: "both",
        }),
      });
      setSelectedProperty((current) => (current ? { ...current, broker: response.broker } : current));
      setRows((currentRows) =>
        currentRows.map((row) => (row.propertyId === selectedId ? { ...row, broker: response.broker } : row))
      );
      setBrokerEditOpen(false);
      setNotice("Broker updated.");
      await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update broker.");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveSourceFacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setBusyAction(`${selectedId}:source-facts`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${selectedId}/source-facts`, {
        method: "PATCH",
        body: JSON.stringify({
          facts: sourceFactsPayload(sourceFactsForm),
          actorName: "ui-v2",
          source: "property_sheet",
        }),
      });
      const property = normalizePropertyDetail(response.property);
      setSelectedProperty(property);
      setSourceFactsForm(sourceFactsFormFromProperty(property));
      applyProperty(property);
      setSourceFactsEditOpen(false);
      setNotice("Property data updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update property data.");
    } finally {
      setBusyAction(null);
    }
  }

  function updateSourceFactsField(field: keyof SourceFactsFormState, value: string) {
    setSourceFactsForm((current) => ({ ...current, [field]: value }));
  }

  function updateDealPathField<K extends keyof DealPathFormState>(field: K, value: DealPathFormState[K]) {
    setDealPathForm((current) => ({ ...current, [field]: value }));
  }

  async function saveDealPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    if (dealPathForm.postTourDecision === "reject" && !dealPathForm.rejectionReasonCode) {
      setError("Choose a rejection reason before rejecting after a tour.");
      return;
    }
    setBusyAction(`${selectedId}:deal-path`);
    setNotice(null);
    setError(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${selectedId}/deal-path`, {
        method: "PATCH",
        body: JSON.stringify({
          dealPath: dealPathPayload(dealPathForm),
          actorName: "ui-v2",
          source: "property_sheet",
        }),
      });
      const property = normalizePropertyDetail(response.property);
      if (property) {
        setSelectedProperty(property);
        setDealPathForm(dealPathFormFromState(property.dealPath));
        applyProperty(property);
      }
      setNotice(
        dealPathForm.postTourDecision === "reject"
          ? "Property rejected after tour."
          : "Deal path updated."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update deal path.");
    } finally {
      setBusyAction(null);
    }
  }

  async function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const tag = newTag.trim();
    if (!tag) return;
    setBusyAction(`${selectedId}:tag-add`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${selectedId}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag, source: "property_sheet" }),
      });
      applyProperty(response.property);
      setNewTag("");
      setNotice("Tag added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add tag.");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeTag(tag: string) {
    if (!selectedId) return;
    setBusyAction(`${selectedId}:tag-remove:${tag}`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(
        `${API_BASE}/api/ui-v2/properties/${selectedId}/tags/${encodeURIComponent(tag)}`,
        { method: "DELETE" }
      );
      applyProperty(response.property);
      setNotice("Tag removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove tag.");
    } finally {
      setBusyAction(null);
    }
  }

  async function openComposer(propertyId: string) {
    setBusyAction(`${propertyId}:composer`);
    setNotice(null);
    setError(null);
    try {
      const response = await apiFetch<ComposerResponse>(
        `${API_BASE}/api/ui-v2/properties/${propertyId}/outreach-composer`
      );
      const composerPayload = response.composer as UiV2OutreachComposerPayload & {
        to?: string | null;
        draftId?: string | null;
        templateId?: string | null;
      };
      const suggestedRecipients = Array.isArray(composerPayload.suggestedRecipients) ? composerPayload.suggestedRecipients : [];
      const suggested = suggestedRecipients[0] as UiV2CrmContactPayload | undefined;
      const broker = composerPayload.broker ?? selectedProperty?.broker ?? selectedRow?.broker ?? null;
      setComposer({
        propertyId,
        toAddress: broker?.email ?? composerPayload.to ?? suggested?.contact.normalizedEmail ?? "",
        contactId: suggested?.contact.id ?? broker?.contactId ?? null,
        subject: composerPayload.subject ?? "",
        body: composerPayload.body ?? "",
        followUpAt: composerPayload.followUpAt ? toDateTimeLocal(new Date(composerPayload.followUpAt)) : "",
        warnings: Array.isArray(composerPayload.warnings) ? composerPayload.warnings : [],
        submitting: false,
        sendingNow: false,
        templateId: composerPayload.templateId ?? "",
        templateName: "",
        savingTemplate: false,
        deletingTemplate: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open composer.");
    } finally {
      setBusyAction(null);
    }
  }

  async function emailBroker(propertyId: string, surface: UiV2ActionSurface, event?: MouseEvent<HTMLButtonElement>) {
    event?.stopPropagation();
    const row = rows.find((item) => item.propertyId === propertyId) ?? null;
    const property =
      selectedProperty?.overview.propertyId === propertyId ? selectedProperty : await loadPropertyDetail(propertyId);
    const broker = property?.broker ?? row?.broker ?? null;
    if (!broker?.email) {
      setSheetTab("Overview");
      setBrokerEditOpen(true);
      setBrokerForm(brokerFormFromBlock(broker));
      setNotice(null);
      setError("Broker email is required before outreach. Add it in the Broker section, then click Email again.");
      return;
    }
    if (surface === "pipeline_table") setSheetTab("Overview");
    await openComposer(propertyId);
  }

  function templateContextForProperty(propertyId: string) {
    const row = rows.find((item) => item.propertyId === propertyId) ?? null;
    const property = selectedProperty?.overview.propertyId === propertyId ? selectedProperty : null;
    const broker = property?.broker ?? row?.broker ?? null;
    return {
      address: property?.overview.displayAddress ?? property?.overview.canonicalAddress ?? row?.displayAddress ?? row?.canonicalAddress,
      brokerName: broker?.name,
      firm: broker?.firm,
    };
  }

  function applyComposerTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    setComposer((current) => {
      if (!current) return current;
      if (!template) return { ...current, templateId: "", templateName: "" };
      const context = templateContextForProperty(current.propertyId);
      return {
        ...current,
        templateId: template.id,
        templateName: template.name,
        subject: renderTemplateText(template.subject, context),
        body: renderTemplateText(template.body, context),
      };
    });
  }

  async function saveComposerTemplate() {
    if (!composer) return;
    const name = composer.templateName.trim();
    if (!name) {
      setNotice("Name this reusable draft before saving it globally.");
      return;
    }
    setComposer({ ...composer, savingTemplate: true });
    setNotice(null);
    try {
      const response = await apiFetch<OutreachTemplateResponse>(`${API_BASE}/api/ui-v2/outreach-templates`, {
        method: "POST",
        body: JSON.stringify({
          id: composer.templateId || null,
          name,
          subject: composer.subject.trim(),
          body: composer.body.trim(),
          actorName: "pipeline",
        }),
      });
      setTemplates((current) => {
        const others = current.filter((template) => template.id !== response.template.id);
        return [...others, response.template].sort((left, right) => left.name.localeCompare(right.name));
      });
      setComposer((current) =>
        current
          ? {
              ...current,
              templateId: response.template.id,
              templateName: response.template.name,
              savingTemplate: false,
            }
          : current
      );
      setNotice("Reusable broker email draft saved globally.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save reusable draft.");
      setComposer((current) => (current ? { ...current, savingTemplate: false } : current));
    }
  }

  async function deleteComposerTemplate() {
    if (!composer?.templateId) return;
    const templateName = composer.templateName || templates.find((template) => template.id === composer.templateId)?.name || "this draft";
    if (!window.confirm(`Remove "${templateName}" from global broker drafts?`)) return;
    setComposer({ ...composer, deletingTemplate: true });
    setNotice(null);
    try {
      await apiFetch<{ ok: boolean }>(`${API_BASE}/api/ui-v2/outreach-templates/${encodeURIComponent(composer.templateId)}`, {
        method: "DELETE",
      });
      setTemplates((current) => current.filter((template) => template.id !== composer.templateId));
      setComposer((current) =>
        current
          ? {
              ...current,
              templateId: "",
              templateName: "",
              deletingTemplate: false,
            }
          : current
      );
      setNotice("Reusable draft removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove reusable draft.");
      setComposer((current) => (current ? { ...current, deletingTemplate: false } : current));
    }
  }

  async function sendComposerNow() {
    if (!composer) return;
    const toAddress = composer.toAddress.trim();
    if (!toAddress || !composer.subject.trim() || !composer.body.trim()) {
      setNotice("Add a recipient, subject, and body before sending.");
      return;
    }
    if (!window.confirm(`Send this broker email now to ${toAddress}?`)) return;
    const activeComposer = composer;
    const send = (force = false) =>
      apiFetch<UiV2OutreachSendNowPayload>(`${API_BASE}/api/ui-v2/outreach-send-now`, {
        method: "POST",
        body: JSON.stringify({
          propertyId: activeComposer.propertyId,
          contactId: activeComposer.contactId,
          toAddress,
          subject: activeComposer.subject.trim(),
          body: activeComposer.body.trim(),
          followUpAt: dateTimeLocalToIso(activeComposer.followUpAt),
          templateId: activeComposer.templateId || null,
          templateName: activeComposer.templateName.trim() || null,
          force,
        }),
      });

    setComposer({ ...composer, sendingNow: true });
    setNotice(null);
    try {
      try {
        await send(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send broker email.";
        if (!message.includes("Use force") || !window.confirm(`${message} Send anyway?`)) throw err;
        await send(true);
      }
      setComposer(null);
      setNotice("Broker email sent and logged.");
      if (selectedId === activeComposer.propertyId) await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send broker email.");
      setComposer((current) => (current ? { ...current, sendingNow: false } : current));
    }
  }

  async function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composer) return;
    setComposer({ ...composer, submitting: true });
    setNotice(null);
    try {
      await apiFetch<OutreachDraftResponse>(`${API_BASE}/api/ui-v2/outreach-drafts`, {
        method: "POST",
        body: JSON.stringify({
          propertyId: composer.propertyId,
          contactId: composer.contactId,
          toAddress: composer.toAddress,
          subject: composer.subject,
          body: composer.body,
          followUpAt: dateTimeLocalToIso(composer.followUpAt),
          templateId: composer.templateId || null,
          templateName: composer.templateName.trim() || null,
        }),
      });
      setComposer(null);
      setNotice("Outreach draft queued for review.");
      if (selectedId === composer.propertyId) await refreshSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue outreach draft.");
      setComposer((current) => (current ? { ...current, submitting: false } : current));
    }
  }

  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateQueryParam("q", searchDraft.trim());
  }

  function onFilterChange(key: string) {
    return (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => updateQueryParam(key, event.target.value);
  }

  function clearFilters() {
    setSearchDraft("");
    setHeaderMenu(null);
    router.replace(PIPELINE_PATH);
  }

  function stopRowClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function toggleRowActionMenu(row: PipelineRow, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setHeaderMenu(null);
    setRowMenu((current) =>
      current?.propertyId === row.propertyId
        ? null
        : {
            propertyId: row.propertyId,
            top: Math.round(rect.bottom + 6),
            right: Math.max(8, Math.round(window.innerWidth - rect.right)),
          }
    );
  }

  function closeRowActionMenu() {
    setRowMenu(null);
  }

  function renderDownloadMenuItem(action: RowDownloadAction) {
    if (action.url) {
      return (
        <a
          key={action.key}
          href={action.url}
          download={action.fileName || true}
          className={styles.linkButton}
          title={action.title}
          onClick={closeRowActionMenu}
        >
          {action.label}
        </a>
      );
    }
    return (
      <button
        key={action.key}
        className={cx(styles.linkButton, styles.unavailableLinkButton)}
        type="button"
        disabled
        title={action.title}
      >
        {action.label}
      </button>
    );
  }

  function renderRowActionPopover(row: PipelineRow) {
    const status = String(row.statusChip.status) as UiV2PipelineStatus;
    const isTerminal = status === "rejected" || status === "archived" || status === "deal_closed";
    const mergeTargetIds = selectedIds.filter((id) => id !== row.propertyId);
    const canMergeIntoSelectedTarget = mergeTargetIds.length === 1;
    return (
      <div
        className={styles.rowActionPopover}
        style={{ top: rowMenu?.top ?? 0, right: rowMenu?.right ?? 8 }}
        onClick={stopRowClick}
      >
        <div className={styles.rowActionMenuSection}>
          <span className={styles.rowActionMenuLabel}>Downloads</span>
          {rowDownloadActions(row).map(renderDownloadMenuItem)}
        </div>
        <div className={styles.rowActionMenuSection}>
          <span className={styles.rowActionMenuLabel}>Row actions</span>
          <button
            className={styles.linkButton}
            type="button"
            onClick={() => {
              closeRowActionMenu();
              void openProperty(row);
            }}
          >
            Open
          </button>
          <button
            className={styles.linkButton}
            type="button"
            disabled={!canMergeIntoSelectedTarget || busyAction === `${row.propertyId}:merge`}
            title={
              canMergeIntoSelectedTarget
                ? "Merge this duplicate row into the selected source row."
                : "Select exactly one other row as the source target first."
            }
            onClick={() => {
              closeRowActionMenu();
              requestMergeIntoSelectedTarget(row);
            }}
          >
            {busyAction === `${row.propertyId}:merge` ? "Merging..." : "Merge into selected row"}
          </button>
          {isTerminal ? (
            <button
              className={styles.linkButton}
              type="button"
              disabled={busyAction === `${row.propertyId}:restore`}
              onClick={() => {
                closeRowActionMenu();
                void restoreDeal(row.propertyId, "pipeline_table");
              }}
            >
              Restore
            </button>
          ) : (
            <>
              <button
                className={styles.linkButton}
                type="button"
                disabled={rowIsSaved(row) || busyAction === `${row.propertyId}:save`}
                onClick={() => {
                  closeRowActionMenu();
                  void saveDeal(row.propertyId, "pipeline_table");
                }}
              >
                Save
              </button>
              <button
                className={styles.dangerLinkButton}
                type="button"
                disabled={busyAction === `${row.propertyId}:reject`}
                onClick={() => {
                  closeRowActionMenu();
                  setRejectState({
                    propertyId: row.propertyId,
                    address: row.displayAddress ?? row.canonicalAddress,
                    surface: "pipeline_table",
                    reasonCode: "",
                    note: "",
                  });
                }}
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  function applyColumnSort(sort: UiV2PipelineSortField, direction: SortDirection) {
    replaceQueryParams({ sort, sortDirection: direction });
    setHeaderMenu(null);
  }

  function toggleHeaderMenu(column: PipelineHeaderMenuId, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setHeaderMenu((current) => (current === column ? null : column));
  }

  function isHeaderActive(column: PipelineHeaderMenuId): boolean {
    if (COLUMN_SORT_FIELDS[column] === filterValues.sort) return true;
    switch (column) {
      case "address":
        return Boolean(filterValues.q);
      case "source":
        return Boolean(filterValues.source);
      case "propertyType":
        return Boolean(filterValues.propertyType);
      case "marketType":
        return Boolean(filterValues.marketType);
      case "askingPrice":
        return Boolean(filterValues.minAskingPrice || filterValues.maxAskingPrice);
      case "dealScore":
        return Boolean(filterValues.minDealScore || filterValues.maxDealScore);
      case "ltrYocPct":
        return Boolean(filterValues.minLtrYoc);
      case "status":
        return Boolean(filterValues.status);
      case "om":
        return Boolean(filterValues.hasOm);
      case "enrichment":
        return Boolean(filterValues.enrichmentStatus);
      case "flow":
        return Boolean(filterValues.hasOpenActions);
      case "tags":
        return Boolean(filterValues.tag);
      case "actions":
        return Boolean(filterValues.hasBrokerContact);
      default:
        return false;
    }
  }

  function columnMenuClass(column: PipelineHeaderMenuId): string {
    return cx(
      styles.columnMenu,
      ["dealScore", "status", "om", "enrichment", "flow", "tags", "actions"].includes(column) && styles.columnMenuRight
    );
  }

  function renderSortControls(column: PipelineHeaderMenuId) {
    const sort = COLUMN_SORT_FIELDS[column];
    if (!sort) return null;
    const ascLabel = ["address", "source", "propertyType", "marketType", "status", "om"].includes(column) ? "A to Z" : "Low to high";
    const descLabel = ["address", "source", "propertyType", "marketType", "status", "om"].includes(column) ? "Z to A" : "High to low";
    return (
      <div className={styles.columnMenuGroup}>
        <span>Sort</span>
        <div className={styles.columnMenuActions}>
          <button type="button" onClick={() => applyColumnSort(sort, "asc")}>
            {ascLabel}
          </button>
          <button type="button" onClick={() => applyColumnSort(sort, "desc")}>
            {descLabel}
          </button>
        </div>
      </div>
    );
  }

  function renderColumnMenu(column: PipelineHeaderMenuId) {
    return (
      <div className={columnMenuClass(column)} onClick={stopRowClick}>
        <div className={styles.columnMenuTitle}>
          <strong>Table controls</strong>
          <button type="button" onClick={() => setHeaderMenu(null)}>
            Close
          </button>
        </div>
        {renderSortControls(column)}
        {column === "address" ? (
          <label>
            <span>Filter address / broker</span>
            <input
              value={searchDraft}
              onChange={(event) => {
                setSearchDraft(event.target.value);
                updateQueryParam("q", event.target.value.trim());
              }}
              placeholder="Search this table"
            />
          </label>
        ) : null}
        {column === "source" ? (
          <label>
            <span>Filter source</span>
            <select value={filterValues.source} onChange={onFilterChange("source")}>
              <option value="">All sources</option>
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {sourceLabel(source)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {column === "propertyType" ? (
          <label>
            <span>Filter property type</span>
            <select value={filterValues.propertyType} onChange={onFilterChange("propertyType")}>
              <option value="">All property types</option>
              {propertyTypeOptions.map((propertyType) => (
                <option key={propertyType} value={propertyType}>
                  {titleize(propertyType)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {column === "marketType" ? (
          <label>
            <span>Filter market</span>
            <select value={filterValues.marketType} onChange={onFilterChange("marketType")}>
              <option value="">All markets</option>
              {MARKET_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {column === "status" ? (
          <label>
            <span>Filter status</span>
            <select value={filterValues.status} onChange={onFilterChange("status")}>
              <option value="">All active</option>
              {UI_V2_PIPELINE_STATUS_OPTIONS.map((option) => (
                <option key={option.status} value={option.status}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {column === "askingPrice" ? (
          <div className={styles.columnMenuGrid}>
            <label>
              <span>Min ask</span>
              <input
                type="number"
                inputMode="numeric"
                value={filterValues.minAskingPrice}
                onChange={(event) => updateQueryParam("minAskingPrice", event.target.value)}
                placeholder="0"
              />
            </label>
            <label>
              <span>Max ask</span>
              <input
                type="number"
                inputMode="numeric"
                value={filterValues.maxAskingPrice}
                onChange={(event) => updateQueryParam("maxAskingPrice", event.target.value)}
                placeholder="Any"
              />
            </label>
          </div>
        ) : null}
        {column === "dealScore" ? (
          <div className={styles.columnMenuGrid}>
            <label>
              <span>Min score</span>
              <input
                type="number"
                min="0"
                max="100"
                value={filterValues.minDealScore}
                onChange={(event) => updateQueryParam("minDealScore", event.target.value)}
                placeholder="0"
              />
            </label>
            <label>
              <span>Max score</span>
              <input
                type="number"
                min="0"
                max="100"
                value={filterValues.maxDealScore}
                onChange={(event) => updateQueryParam("maxDealScore", event.target.value)}
                placeholder="100"
              />
            </label>
          </div>
        ) : null}
        {column === "ltrYocPct" ? (
          <div className={styles.columnMenuGrid}>
            <label>
              <span>Min YoC LTR %</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={filterValues.minLtrYoc}
                onChange={(event) => updateQueryParam("minLtrYoc", event.target.value)}
                placeholder="e.g. 5.5"
              />
            </label>
          </div>
        ) : null}
        {column === "om" ? (
          <label>
            <span>Filter OM</span>
            <select value={filterValues.hasOm} onChange={onFilterChange("hasOm")}>
              <option value="">All OM states</option>
              <option value="true">Available</option>
              <option value="false">Missing</option>
            </select>
          </label>
        ) : null}
        {column === "enrichment" ? (
          <label>
            <span>Filter enrichment</span>
            <select value={filterValues.enrichmentStatus} onChange={onFilterChange("enrichmentStatus")}>
              <option value="">All enrichment states</option>
              <option value="complete">Complete</option>
              <option value="running">Running</option>
              <option value="failed">Failed</option>
              <option value="missing">Missing</option>
            </select>
          </label>
        ) : null}
        {column === "flow" ? (
          <label>
            <span>Filter flow</span>
            <select value={filterValues.hasOpenActions} onChange={onFilterChange("hasOpenActions")}>
              <option value="">All flow states</option>
              <option value="true">Open actions</option>
              <option value="false">Clear</option>
            </select>
          </label>
        ) : null}
        {column === "tags" ? (
          <label>
            <span>Filter tag</span>
            <input list="pipeline-tags" value={filterValues.tag} onChange={onFilterChange("tag")} placeholder="Any tag" />
          </label>
        ) : null}
        {column === "actions" ? (
          <label>
            <span>Broker contact</span>
            <select value={filterValues.hasBrokerContact} onChange={onFilterChange("hasBrokerContact")}>
              <option value="">All rows</option>
              <option value="true">Has broker email</option>
              <option value="false">Needs broker email</option>
            </select>
          </label>
        ) : null}
        <button className={styles.columnMenuClear} type="button" onClick={() => setHeaderMenu(null)}>
          Done
        </button>
      </div>
    );
  }

  function renderHeader(column: PipelineHeaderMenuId, label: string) {
    const active = isHeaderActive(column);
    const sort = COLUMN_SORT_FIELDS[column];
    const isSorted = sort === filterValues.sort;
    return (
      <div className={cx(styles.headerCellWrap, headerMenu === column && styles.headerCellWrapOpen)}>
        <button
          className={cx(styles.headerControl, active && styles.headerControlActive)}
          type="button"
          onClick={(event) => toggleHeaderMenu(column, event)}
        >
          <span className={styles.headerLabel}>{label}</span>
          {isSorted ? (
            <span
              className={cx(
                styles.headerState,
                styles.headerStateSorted,
                filterValues.sortDirection === "asc" ? styles.headerStateAsc : styles.headerStateDesc
              )}
              title={`Sorted ${filterValues.sortDirection === "asc" ? "ascending" : "descending"}`}
              aria-hidden="true"
            />
          ) : null}
          {active && !isSorted ? <span className={cx(styles.headerState, styles.headerStateFiltered)} title="Filtered" aria-hidden="true" /> : null}
        </button>
        {headerMenu === column ? renderColumnMenu(column) : null}
      </div>
    );
  }

  const sheetGallery = extractGallery(selectedProperty, selectedRow);
  const activeGalleryIndex = sheetGallery.length > 0 ? Math.min(galleryIndex, sheetGallery.length - 1) : 0;
  const activeGalleryImage = sheetGallery[activeGalleryIndex] ?? null;
  const hiddenGalleryCount = Math.max(0, sheetGallery.length - 6);
  const galleryThumbs = galleryExpanded ? sheetGallery : sheetGallery.slice(0, 6);
  const rawListingUrl = selectedProperty?.overview.listingUrl ?? selectedRow?.overview?.listingUrl ?? null;
  const listingUrl = rawListingUrl && /^https?:\/\//i.test(rawListingUrl) ? rawListingUrl : null;
  const sheetBroker = selectedProperty?.broker ?? selectedRow?.broker ?? null;
  const sheetStatus = selectedProperty?.statusChip ?? selectedRow?.statusChip ?? null;
  const sheetTags = selectedProperty?.tags ?? selectedRow?.tags ?? [];
  const sheetHasOm = propertyDetailHasOm(selectedProperty) || pipelineRowHasOm(selectedRow);
  const selectedDealPath = selectedProperty?.dealPath ?? selectedRow?.dealPath ?? null;
  const sheetMarketType = selectedProperty?.overview.marketType ?? selectedRow?.marketType ?? "unknown";
  const sheetDocuments = selectedProperty?.documents ?? [];
  const sheetEnrichmentModules = selectedProperty?.enrichmentDetails?.modules ?? [];
  const terminalStatus =
    selectedRow?.statusChip.status === "rejected" ||
    selectedRow?.statusChip.status === "archived" ||
    selectedRow?.statusChip.status === "deal_closed";
  const sheetUnderwriting = selectedProperty?.underwriting ?? selectedRow?.underwriting ?? null;
  const liveBrokerCompPayload = selectedId ? brokerCompPayloads[selectedId] : null;
  const sheetBrokerComps = readBrokerCompSurface(liveBrokerCompPayload, selectedProperty?.brokerComps, selectedRow?.brokerComps);
  const sheetBrokerCompLoading = selectedId ? brokerCompLoading[selectedId] === true : false;
  const sheetBrokerCompUploading = selectedId ? brokerCompUploading[selectedId] === true : false;
  const sheetBrokerCompOpinionSaving = selectedId ? brokerCompOpinionSaving[selectedId] === true : false;
  const sheetBrokerCompError = selectedId ? brokerCompError[selectedId] ?? null : null;
  const sheetListedPrice = selectedProperty?.overview.askingPrice ?? selectedRow?.askingPrice ?? null;
  const sheetListedPpsf = selectedProperty?.overview.pricePerSqft ?? selectedRow?.pricePerSqft ?? null;
  const selectedRowLtrYoc = selectedRow ? calculateYieldOnCost(selectedRow, "ltr") : null;
  const selectedRowMtrYoc = selectedRow ? calculateYieldOnCost(selectedRow, "mtr") : null;
  const sheetLtrYoc = sheetUnderwriting?.ltrYocPct ?? selectedRowLtrYoc;
  const sheetMtrYoc = sheetUnderwriting?.mtrYocPct ?? sheetUnderwriting?.yocPct ?? selectedRowMtrYoc;
  const sheetMarketCapRate = sheetUnderwriting?.marketCapRatePct ?? null;
  const sheetYoCSpread =
    sheetUnderwriting?.yocSpreadPct ?? (sheetMtrYoc != null && sheetMarketCapRate != null ? sheetMtrYoc - sheetMarketCapRate : null);
  const sheetMtrCalloutCode =
    sheetUnderwriting?.mtrCalloutCode ?? selectedRow?.underwriting?.mtrCalloutCode ?? null;
  const sheetMtrCalloutLabel =
    sheetUnderwriting?.mtrCalloutLabel ?? selectedRow?.underwriting?.mtrCalloutLabel ?? null;
  const sheetBrokerCapPct =
    sheetUnderwriting?.brokerCapRatePct ?? selectedRow?.underwriting?.brokerCapRatePct ?? null;
  const sheetBrokerCapCalloutCode =
    sheetUnderwriting?.brokerCapCalloutCode ?? selectedRow?.underwriting?.brokerCapCalloutCode ?? null;
  const sheetBrokerCapCalloutLabel =
    sheetUnderwriting?.brokerCapCalloutLabel ?? selectedRow?.underwriting?.brokerCapCalloutLabel ?? null;
  const sheetCurrentNoi = sheetUnderwriting?.currentNoi ?? null;
  const sheetAdjustedNoi = sheetUnderwriting?.adjustedNoi ?? null;
  const sheetNoiUpliftPct =
    sheetCurrentNoi != null && sheetAdjustedNoi != null && sheetCurrentNoi !== 0
      ? ((sheetAdjustedNoi - sheetCurrentNoi) / Math.abs(sheetCurrentNoi)) * 100
      : null;

  return (
    <main
      className={styles.page}
      onClick={() => {
        setHeaderMenu(null);
        closeRowActionMenu();
      }}
    >
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Pipeline</h1>
          <div className={styles.subtle}>{loading ? "Refreshing..." : `${total} matching properties`}</div>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => updateQueryParam("includeRejected", filterValues.includeRejected ? "" : "true")}
        >
          {filterValues.includeRejected ? "Hide rejected" : "Include rejected"}
        </button>
      </div>

      <form className={styles.filters} onSubmit={onSearchSubmit}>
        <label className={styles.searchBox}>
          <span>Search</span>
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Address, broker, source, tag"
          />
        </label>
        <label>
          <span>Status</span>
          <select value={filterValues.status} onChange={onFilterChange("status")}>
            <option value="">All active</option>
            {UI_V2_PIPELINE_STATUS_OPTIONS.map((option) => (
              <option key={option.status} value={option.status}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Source</span>
          <select value={filterValues.source} onChange={onFilterChange("source")}>
            <option value="">All sources</option>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Property type</span>
          <select value={filterValues.propertyType} onChange={onFilterChange("propertyType")}>
            <option value="">All property types</option>
            {propertyTypeOptions.map((propertyType) => (
              <option key={propertyType} value={propertyType}>
                {titleize(propertyType)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Market</span>
          <select value={filterValues.marketType} onChange={onFilterChange("marketType")}>
            <option value="">All markets</option>
            {MARKET_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Neighborhood</span>
          <select value={filterValues.neighborhood} onChange={onFilterChange("neighborhood")}>
            <option value="">All areas</option>
            {neighborhoodOptions.map((neighborhood) => (
              <option key={neighborhood} value={neighborhood}>
                {neighborhood}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Tag</span>
          <input list="pipeline-tags" value={filterValues.tag} onChange={onFilterChange("tag")} placeholder="Any tag" />
          <datalist id="pipeline-tags">
            {tagOptions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Sort</span>
          <select value={filterValues.sort} onChange={onFilterChange("sort")}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Order</span>
          <select value={filterValues.sortDirection} onChange={onFilterChange("sortDirection")}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </label>
        <div className={styles.filterButtons}>
          <button className={styles.primaryButton} type="submit">
            Search
          </button>
          <button className={styles.ghostButton} type="button" onClick={clearFilters}>
            Reset
          </button>
        </div>
      </form>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.bulkToolbar}>
        <div>
          <strong>{selectedIds.length}</strong>
          <span>selected</span>
        </div>
        <div className={styles.bulkActions}>
          <button className={styles.ghostButton} type="button" onClick={toggleAllVisible}>
            {allVisibleSelected ? "Clear selection" : "Select visible"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            title="Full refresh for the selection: enrichment, rental flow, OM analysis, and dossier generation — each stage tracked in its own banner. The RapidAPI listing-details pull only runs when the toggle next to this button is on."
            disabled={selectedIds.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={refreshSelectedListings}
          >
            {busyAction === "bulk:listings" ? "Refreshing..." : "Full refresh"}
          </button>
          <label
            className={styles.bulkToggle}
            title="When on, Refresh listings also sends each property's stored source link through the RapidAPI GET DETAILS endpoint (1 credit per listing) to capture ask changes and unavailable flags."
          >
            <input
              type="checkbox"
              checked={includeListingPull}
              onChange={(event) => setIncludeListingPullPersisted(event.target.checked)}
              disabled={busyAction?.startsWith("bulk:") ?? false}
            />
            <span>+ listing pull</span>
          </label>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={selectedIds.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={refreshSelectedEnrichment}
          >
            {busyAction === "bulk:refresh" ? "Refreshing..." : "Refresh latest + rental"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            title="Re-run ONLY the broker contact lookup (directory + web search) for the selection. Skips properties that already have a sendable email."
            disabled={selectedIds.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={refreshSelectedBrokerContacts}
          >
            {busyAction === "bulk:broker" ? "Finding brokers..." : "Refresh broker contacts"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            title={
              selectedRowsWithOm.length === 0
                ? "Select at least one property with an uploaded OM."
                : "Refresh and promote OM extraction for selected properties, then recalculate yield numbers from the latest user inputs and underwriting."
            }
            disabled={selectedRowsWithOm.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={refreshSelectedOmAnalysis}
          >
            {busyAction === "bulk:om-analysis" ? "Updating OM..." : "Update OM analysis"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            title={
              selectedRowsWithOm.length === 0
                ? "Select at least one property with an uploaded OM."
                : "Re-run OM analysis, then regenerate and replace the deal dossier PDFs and Excel workbooks using saved assumptions. Each workbook is audited against the model after rendering."
            }
            disabled={selectedRowsWithOm.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={rerunSelectedDossiers}
          >
            {busyAction === "bulk:dossier" ? "Rerunning dossiers..." : "Rerun dossiers"}
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            title="Preview one email per broker covering all of their selected properties, edit the drafts, then send. Guard checks (prior sends, OM received, Gmail history) run before anything goes out."
            disabled={selectedIds.length === 0 || busyAction?.startsWith("bulk:") || busyAction?.includes(":composer")}
            onClick={openGroupedEmailPreview}
          >
            {busyAction === "bulk:email-preview" ? "Preparing drafts..." : "Email brokers"}
          </button>
          <button
            className={styles.dangerButton}
            type="button"
            disabled={selectedRejectableRows.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={openBulkRejectModal}
          >
            Reject selected
          </button>
        </div>
      </div>

      <section className={styles.tableShell} aria-busy={loading}>
        <table className={styles.pipelineTable}>
          <colgroup>
            <col className={styles.colSelect} />
            <col className={styles.colStar} />
            <col className={styles.colAddress} />
            <col className={styles.colStage} />
            <col className={styles.colSource} />
            <col className={styles.colPropertyType} />
            <col className={styles.colType} />
            <col className={styles.colDate} />
            <col className={styles.colDate} />
            <col className={styles.colDate} />
            <col className={styles.colAsk} />
            <col className={styles.colPsf} />
            <col className={styles.colYoc} />
            <col className={styles.colYoc} />
            <col className={styles.colUnit} />
            <col className={styles.colSqft} />
            <col className={styles.colScore} />
            <col className={styles.colStatus} />
            <col className={styles.colOm} />
            <col className={styles.colEnrich} />
            <col className={styles.colFlow} />
            <col className={styles.colTags} />
            <col className={styles.colAction} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.selectColumn}>
                <input
                  type="checkbox"
                  aria-label="Select visible properties"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                />
              </th>
              <th className={styles.starColumn} aria-label="Saved deal" />
              <th>{renderHeader("address", "Address")}</th>
              <th>{renderHeader("stage", "Stage")}</th>
              <th>{renderHeader("source", "Source")}</th>
              <th>{renderHeader("propertyType", "Property Type")}</th>
              <th>{renderHeader("marketType", "Market")}</th>
              <th>{renderHeader("listedAt", "Date Listed")}</th>
              <th>{renderHeader("createdAt", "Date Added")}</th>
              <th>{renderHeader("updatedAt", "Updated")}</th>
              <th>{renderHeader("askingPrice", "Ask")}</th>
              <th>{renderHeader("pricePerSqft", "$/SF")}</th>
              <th>{renderHeader("ltrYocPct", "YoC LTR")}</th>
              <th>{renderHeader("mtrYocPct", "YoC MTR")}</th>
              <th>{renderHeader("units", "Units")}</th>
              <th>{renderHeader("buildingSqft", "SF")}</th>
              <th>{renderHeader("dealScore", "Score")}</th>
              <th>{renderHeader("status", "Status")}</th>
              <th>{renderHeader("om", "Tracker")}</th>
              <th>{renderHeader("enrichment", "Enrich")}</th>
              <th>{renderHeader("flow", "Flow")}</th>
              <th>{renderHeader("tags", "Tags")}</th>
              <th>{renderHeader("actions", "Action")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = String(row.statusChip.status) as UiV2PipelineStatus;
              const isSelected = row.propertyId === selectedId;
              const isTerminal = status === "rejected" || status === "archived" || status === "deal_closed";
              const isChecked = selectedIdSet.has(row.propertyId);
              const score = row.underwriting?.dealScore ?? null;
              const rowLtrYoc = calculateYieldOnCost(row, "ltr");
              const rowMtrYoc = calculateYieldOnCost(row, "mtr");
              const rowIsNew = row.newness?.isNew === true;
              const rowLocationLabels = locationLabels(row);
              const askActivity = askActivityDisplay(row);
              const isSaved = rowIsSaved(row);
              const trackerItems = rowTrackerItems(row);
              const isUnavailable = rowListingUnavailable(row);
              const displayTags = orderedRowTags(row);
              const psfFlag = psfFlagFor(row);
              const ltrFlag = ltrYieldFlag(row, rowLtrYoc);
              const mtrFlag = mtrYieldFlag(row, rowLtrYoc, rowMtrYoc);
              return (
                <tr
                  key={row.propertyId}
                  ref={keyboardRowId === row.propertyId ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                  className={cx(isSelected && styles.selectedRow, isUnavailable && styles.unavailableRow, keyboardRowId === row.propertyId && styles.keyboardRow) || undefined}
                  title={
                    isUnavailable
                      ? "Listing refresh flagged this property as unavailable (in contract, delisted, or sold) — review and remove if needed."
                      : undefined
                  }
                  onClick={() => openProperty(row)}
                >
                  <td className={styles.selectColumn} onClick={stopRowClick}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.displayAddress ?? row.canonicalAddress}`}
                      checked={isChecked}
                      onChange={() => toggleSelected(row.propertyId)}
                    />
                  </td>
                  <td className={styles.starColumn} onClick={stopRowClick}>
                    <button
                      className={`${styles.saveStarButton} ${isSaved ? styles.saveStarButtonActive : ""}`}
                      type="button"
                      aria-label={isSaved ? `${row.displayAddress ?? row.canonicalAddress} is saved` : `Save ${row.displayAddress ?? row.canonicalAddress}`}
                      title={isSaved ? "Saved deal" : "Save deal"}
                      disabled={isSaved || isTerminal || busyAction === `${row.propertyId}:save`}
                      onClick={() => saveDeal(row.propertyId, "pipeline_table")}
                    >
                      <Star size={15} fill={isSaved ? "currentColor" : "none"} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                  </td>
                  <td className={styles.addressCell}>
                    <div className={styles.addressWrap}>
                      {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" className={styles.thumb} /> : <div className={styles.thumbBlank} />}
                      <div>
                        <strong>{row.displayAddress ?? row.canonicalAddress}</strong>
                        {rowLocationLabels.length ? (
                          <div className={styles.locationTags}>
                            {rowLocationLabels.map((label) => (
                              <small key={label}>{label}</small>
                            ))}
                          </div>
                        ) : (
                          <span>No location tagged</span>
                        )}
                        {!row.broker?.email && !isTerminal ? (
                          <button
                            type="button"
                            className={styles.brokerMissingChip}
                            title="No broker email on file — click to add it without leaving the table."
                            onClick={(event) => openBrokerPrompt(row, event)}
                          >
                            <MailPlus size={11} strokeWidth={2.2} aria-hidden="true" />
                            <span>No broker email</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className={styles.stageCell}>
                    <StageChip status={status} />
                  </td>
                  <td>{sourceLabel(String(row.source ?? ""))}</td>
                  <td className={styles.propertyTypeCell}>{titleize(row.propertyType)}</td>
                  <td onClick={stopRowClick}>
                    <select
                      className={styles.typeSelect}
                      value={row.marketType ?? "unknown"}
                      disabled={busyAction === `${row.propertyId}:market-type`}
                      onChange={(event) => updateMarketType(row, event.target.value as UiV2MarketType)}
                    >
                      {MARKET_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={styles.dateCell}>{formatDate(row.listedAt)}</td>
                  <td className={styles.dateCell}>
                    <strong>{formatDate(row.createdAt)}</strong>
                    {rowIsNew ? <span className={styles.newBadge} title={newBadgeTitle(row)}>New</span> : null}
                  </td>
                  <td className={styles.dateCell}>{formatDate(row.updatedAt)}</td>
                  <td className={cx(styles.numericCell, styles.askCell)}>
                    <strong>{formatCurrency(row.askingPrice)}</strong>
                    {askActivity ? (
                      <span
                        className={`${styles.askActivity} ${askActivity.tone === "cut" ? styles.askActivityCut : askActivity.tone === "raise" ? styles.askActivityRaise : ""}`}
                        title={askActivity.title}
                      >
                        {askActivity.label}
                      </span>
                    ) : null}
                  </td>
                  <td className={cx(styles.numericCell, flagCellClass(psfFlag))} title={psfFlag?.title}>
                    {formatCurrency(row.pricePerSqft, false)}
                  </td>
                  <td className={cx(styles.numericCell, styles.yocCell, flagCellClass(ltrFlag))} title={ltrFlag?.title}>
                    <strong>{formatPercent(rowLtrYoc)}</strong>
                    {ltrFlag ? (
                      <span className={cx(styles.yocFlag, ltrFlag.severity === "danger" ? styles.yocFlagDanger : styles.yocFlagWarn)}>
                        {ltrFlag.label}
                      </span>
                    ) : null}
                  </td>
                  <td className={cx(styles.numericCell, styles.yocCell, flagCellClass(mtrFlag))} title={mtrFlag?.title}>
                    <strong>{formatPercent(rowMtrYoc)}</strong>
                    {mtrFlag ? (
                      <span className={cx(styles.yocFlag, mtrFlag.severity === "danger" ? styles.yocFlagDanger : styles.yocFlagWarn)}>
                        {mtrFlag.label}
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.numericCell}>{formatNumber(row.units)}</td>
                  <td className={styles.numericCell}>{formatNumber(row.buildingSqft)}</td>
                  <td className={styles.scoreCell}>
                    <span className={`${styles.scoreBadge} ${scoreTone(score)}`} title={scoreExplanation(row)}>
                      {scoreLabel(score)}
                    </span>
                  </td>
                  <td onClick={stopRowClick}>
                    <select
                      className={`${styles.statusSelect} ${statusToneClass(row.statusChip.tone)}`}
                      value={status}
                      disabled={!row.statusChip.editable || busyAction === `${row.propertyId}:status`}
                      onChange={(event) => updateStatus(row.propertyId, event.target.value as UiV2PipelineStatus, "pipeline_table")}
                    >
                      {UI_V2_PIPELINE_STATUS_OPTIONS.map((option) => (
                        <option key={option.status} value={option.status}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={styles.trackerCell}>
                    <div className={styles.trackerGroup} aria-label={`Tracker for ${row.displayAddress ?? row.canonicalAddress}`}>
                      {trackerItems.map((item) => (
                        <span
                          key={item.key}
                          className={cx(styles.trackerChip, trackerToneClass(item.tone))}
                          title={item.title}
                        >
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.tinyChip} ${statusToneClass(row.enrichmentState?.status === "complete" ? "success" : row.enrichmentState?.status === "failed" ? "danger" : "neutral")}`}>
                      {titleize(row.enrichmentState?.status)}
                    </span>
                  </td>
                  <td>{flowLabel(row)}</td>
                  <td className={styles.tagsCell}>
                    {displayTags.slice(0, 3).map((tag) => (
                      <span className={cx(styles.tagChip, tagToneClass(tag))} key={tag}>
                        {tagLabel(tag)}
                      </span>
                    ))}
                    {displayTags.length > 3 ? <span className={styles.tagMore}>+{displayTags.length - 3}</span> : null}
                  </td>
                  <td onClick={stopRowClick}>
                    <div className={styles.actionGroup}>
                      <button
                        className={styles.linkButton}
                        type="button"
                        disabled={busyAction === `${row.propertyId}:composer`}
                        onClick={(event) => emailBroker(row.propertyId, "pipeline_table", event)}
                      >
                        Email
                      </button>
                      <div className={styles.rowActionMenu}>
                        <button
                          className={cx(styles.rowActionMenuButton, rowMenu?.propertyId === row.propertyId && styles.rowActionMenuButtonOpen)}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={rowMenu?.propertyId === row.propertyId}
                          onClick={(event) => toggleRowActionMenu(row, event)}
                        >
                          More
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? <div className={styles.emptyState}>No properties match the current filters.</div> : null}
        {loading ? <div className={styles.tableOverlay}>Loading pipeline...</div> : null}
      </section>

      {rowMenu && rowMenuRow ? renderRowActionPopover(rowMenuRow) : null}

      {selectedId ? (
        <div className={styles.sheetOverlay} onClick={closeSheet}>
          <aside className={cx(styles.propertySheet, sheetFullscreen && styles.propertySheetFullscreen)} onClick={(event) => event.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <div>
                <span className={styles.kicker}>{sourceLabel(String(selectedProperty?.overview.source ?? selectedRow?.source ?? "Pipeline"))}</span>
                <h2>{selectedProperty?.overview.displayAddress ?? selectedRow?.displayAddress ?? selectedRow?.canonicalAddress ?? "Property"}</h2>
                <p>{[selectedProperty?.overview.neighborhood ?? selectedRow?.neighborhood, selectedProperty?.overview.borough ?? selectedRow?.borough, marketTypeLabel(sheetMarketType)].filter(Boolean).map(titleize).join(" · ")}</p>
                {listingUrl ? (
                  <a className={styles.sourceLinkButton} href={listingUrl} target="_blank" rel="noreferrer">
                    Open source listing
                  </a>
                ) : linkListingDraft ? (
                  <form
                    className={styles.linkListingForm}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!selectedId || !linkListingDraft.url.trim() || linkListingDraft.saving) return;
                      setLinkListingDraft({ ...linkListingDraft, saving: true });
                      try {
                        const response = await fetch(
                          `${API_BASE}/api/properties/${encodeURIComponent(selectedId)}/link-streeteasy`,
                          {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ streetEasyUrl: linkListingDraft.url.trim() }),
                          }
                        );
                        const payload = await response.json().catch(() => ({}));
                        if (!response.ok) {
                          throw new Error(payload.error || payload.details || "Failed to link the listing.");
                        }
                        setLinkListingDraft(null);
                        setNotice(
                          `StreetEasy listing linked${payload.brokerEmailFound ? " — broker email found" : ""}. Refreshes and broker lookups are now available for this property.`
                        );
                        await loadPropertyDetail(selectedId).catch(() => null);
                        await reloadPipelineRows();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to link the listing.");
                        setLinkListingDraft((current) => (current ? { ...current, saving: false } : current));
                      }
                    }}
                  >
                    <input
                      type="url"
                      value={linkListingDraft.url}
                      placeholder="https://streeteasy.com/sale/…"
                      autoFocus
                      disabled={linkListingDraft.saving}
                      onChange={(event) =>
                        setLinkListingDraft((current) => (current ? { ...current, url: event.target.value } : current))
                      }
                    />
                    <button className={styles.secondaryButton} type="submit" disabled={linkListingDraft.saving}>
                      {linkListingDraft.saving ? "Linking…" : "Link"}
                    </button>
                    <button
                      className={styles.ghostButton}
                      type="button"
                      disabled={linkListingDraft.saving}
                      onClick={() => setLinkListingDraft(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    className={styles.sourceLinkButton}
                    type="button"
                    title="Attach a StreetEasy listing so this property (e.g. created from an OM upload) can use listing refreshes and broker lookups."
                    onClick={() => setLinkListingDraft({ url: "", saving: false })}
                  >
                    Link StreetEasy listing
                  </button>
                )}
              </div>
              <div className={styles.sheetWindowActions}>
                <button
                  className={styles.sheetUtilityButton}
                  type="button"
                  onClick={() => setSheetFullscreen((fullscreen) => !fullscreen)}
                  aria-pressed={sheetFullscreen}
                >
                  {sheetFullscreen ? "Compact" : "Full screen"}
                </button>
                <button className={styles.closeButton} type="button" onClick={closeSheet} aria-label="Close property sheet">
                  <X size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>

            <dl className={styles.sheetScreeningBar} aria-label="Screening yield summary">
              <div className={sheetMtrYoc != null ? styles.screeningMetricPrimary : undefined}>
                <dt>YoC MTR</dt>
                <dd className={sheetMtrYoc == null ? styles.screeningPending : undefined}>{formatPercent(sheetMtrYoc)}</dd>
                <small>{sheetMtrYoc == null && !sheetHasOm ? "Awaiting OM" : "Adjusted NOI"}</small>
              </div>
              <div>
                <dt>YoC LTR</dt>
                <dd
                  className={
                    cx(
                      sheetLtrYoc == null && styles.screeningPending,
                      sheetBrokerCapCalloutCode != null && styles.yocFlagWarn
                    ) || undefined
                  }
                >
                  {formatPercent(sheetLtrYoc)}
                </dd>
                <small title={sheetBrokerCapCalloutLabel ?? undefined}>
                  {sheetBrokerCapCalloutCode != null && sheetBrokerCapPct != null
                    ? `Broker cap ${formatPercent(sheetBrokerCapPct)} — pro forma?`
                    : sheetCurrentNoi != null
                      ? `${formatCurrency(sheetCurrentNoi, false)} current NOI`
                      : "Current NOI"}
                </small>
              </div>
              <div title={sheetListedPrice != null ? formatCurrency(sheetListedPrice, false) : undefined}>
                <dt>Ask</dt>
                <dd>{formatCurrency(sheetListedPrice)}</dd>
                <small>{formatCurrency(sheetListedPpsf, false)} / SF</small>
              </div>
              <div>
                <dt>MTR NOI</dt>
                <dd className={sheetAdjustedNoi == null ? styles.screeningPending : undefined}>{formatCurrency(sheetAdjustedNoi, false)}</dd>
                <small>{sheetAdjustedNoi == null && !sheetHasOm ? "Awaiting OM" : "Adjusted NOI"}</small>
              </div>
              <div>
                <dt>Market cap</dt>
                <dd className={sheetMarketCapRate == null ? styles.screeningPending : undefined}>{formatPercent(sheetMarketCapRate)}</dd>
                <small>{sheetMarketCapRate == null ? "Broker data pending" : "From broker comps"}</small>
              </div>
              <div
                className={
                  sheetMtrCalloutCode === "mtr_below_ltr" || sheetMtrCalloutCode === "mtr_spread_outlier"
                    ? styles.screeningAccentDanger
                    : sheetMtrCalloutCode === "mtr_weak_uplift"
                      ? styles.screeningAccentWarn
                      : undefined
                }
              >
                <dt>MTR spread</dt>
                <dd className={sheetYoCSpread == null ? styles.screeningPending : undefined}>{formatPercent(sheetYoCSpread)}</dd>
                <small title={sheetMtrCalloutLabel ?? undefined}>
                  {sheetMtrCalloutCode === "mtr_below_ltr"
                    ? "Below LTR — source as LTR"
                    : sheetMtrCalloutCode === "mtr_weak_uplift"
                      ? "Weak MTR bump"
                      : sheetMtrCalloutCode === "mtr_spread_outlier"
                        ? "Implausible spread — verify rents"
                        : sheetYoCSpread == null && !sheetHasOm
                          ? "Awaiting OM"
                          : "YoC MTR less YoC LTR"}
                </small>
              </div>
            </dl>

            <div className={styles.propertyGallery}>
              {activeGalleryImage ? (
                <>
                  <button
                    className={styles.galleryHero}
                    type="button"
                    onClick={() => setGalleryIndex((activeGalleryIndex + 1) % sheetGallery.length)}
                    aria-label="Show next property photo"
                  >
                    <img src={activeGalleryImage.url} alt={activeGalleryImage.altText ?? ""} />
                    <span className={styles.galleryCount}>
                      {activeGalleryIndex + 1} / {sheetGallery.length}
                    </span>
                  </button>
                  <div className={styles.galleryRailPanel}>
                    {hiddenGalleryCount > 0 ? (
                      <div className={styles.galleryRailHeader}>
                        <span>{galleryExpanded ? `${sheetGallery.length} photos` : `Showing 6 of ${sheetGallery.length}`}</span>
                        <button
                          type="button"
                          onClick={() => setGalleryExpanded((expanded) => !expanded)}
                          aria-expanded={galleryExpanded}
                        >
                          {galleryExpanded ? "Collapse" : "Show all"}
                        </button>
                      </div>
                    ) : null}
                    <div className={cx(styles.galleryRail, galleryExpanded && styles.galleryRailExpanded)} aria-label="Property photos">
                      {galleryThumbs.map((image, index) => {
                        const actualIndex = index;
                        const isMoreTile = !galleryExpanded && hiddenGalleryCount > 0 && index === 5;
                        return (
                          <button
                            key={image.id ?? image.url}
                            className={cx(styles.galleryThumbButton, actualIndex === activeGalleryIndex && styles.galleryThumbButtonActive)}
                            type="button"
                            onClick={() => {
                              if (isMoreTile) {
                                setGalleryExpanded(true);
                                setGalleryIndex(Math.min(6, sheetGallery.length - 1));
                                return;
                              }
                              setGalleryIndex(actualIndex);
                            }}
                            aria-label={isMoreTile ? `Show ${hiddenGalleryCount} more property photos` : `Show property photo ${actualIndex + 1}`}
                          >
                            <img src={image.thumbnailUrl ?? image.url} alt="" />
                            {isMoreTile ? (
                              <span className={styles.galleryMore}>+{hiddenGalleryCount}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className={styles.galleryEmpty}>
                  <strong>No property photos yet</strong>
                  <span>Listing, OM, and broker media will appear here once linked.</span>
                </div>
              )}
            </div>

            <div className={styles.sheetActions}>
              <div className={styles.sheetActionsGroup}>
                {sheetStatus ? (
                  <select
                    className={`${styles.statusSelect} ${statusToneClass(sheetStatus.tone)}`}
                    value={String(sheetStatus.status)}
                    disabled={!sheetStatus.editable}
                    onChange={(event) => updateStatus(selectedId, event.target.value as UiV2PipelineStatus, "property_sheet")}
                  >
                    {UI_V2_PIPELINE_STATUS_OPTIONS.map((option) => (
                      <option key={option.status} value={option.status}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {selectedRow ? (
                  <select
                    className={styles.typeSelect}
                    value={sheetMarketType}
                    onChange={(event) => updateMarketType(selectedRow, event.target.value as UiV2MarketType)}
                    aria-label="Property type"
                  >
                    {MARKET_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className={styles.sheetActionsGroup}>
                <button className={styles.primaryButton} type="button" onClick={(event) => emailBroker(selectedId, "property_sheet", event)}>
                  Email broker
                </button>
                {sheetHasOm ? (
                  <>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      title="Re-run OM extraction from the latest documents and recalculate yield numbers with the current user inputs."
                      disabled={busyAction === `${selectedId}:om-analysis` || busyAction?.startsWith("bulk:")}
                      onClick={() => refreshOmAnalysisForProperty(selectedId)}
                    >
                      {busyAction === `${selectedId}:om-analysis` ? "Updating OM..." : "Update OM analysis"}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      title="Re-run OM analysis, then regenerate and replace the dossier PDF and Excel workbook."
                      disabled={busyAction === `${selectedId}:dossier` || busyAction?.startsWith("bulk:")}
                      onClick={() => rerunDossierForProperty(selectedId)}
                    >
                      {busyAction === `${selectedId}:dossier` ? "Rerunning..." : "Rerun dossier"}
                    </button>
                  </>
                ) : null}
                {terminalStatus ? (
                  <button className={styles.secondaryButton} type="button" onClick={() => restoreDeal(selectedId, "property_sheet")}>
                    Restore
                  </button>
                ) : (
                  <>
                    <button className={styles.secondaryButton} type="button" onClick={() => saveDeal(selectedId, "property_sheet")}>
                      Save deal
                    </button>
                    <button
                      className={styles.dangerButton}
                      type="button"
                      onClick={() =>
                        setRejectState({
                          propertyId: selectedId,
                          address: selectedProperty?.overview.displayAddress ?? selectedProperty?.overview.canonicalAddress ?? "Property",
                          surface: "property_sheet",
                          reasonCode: "",
                          note: "",
                        })
                      }
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>

            <nav className={styles.tabs}>
              {SHEET_TABS.map((tab) => (
                <button
                  key={tab}
                  className={sheetTab === tab ? styles.activeTab : undefined}
                  type="button"
                  onClick={() => setSheetTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </nav>

            <div className={styles.sheetBody}>
              {detailLoading && !selectedProperty ? <div className={styles.loadingState}>Loading property...</div> : null}

	              {sheetTab === "Overview" ? (
	                <div className={styles.overviewStack}>
	                  <section className={styles.overviewSection}>
	                    <div className={styles.sectionHeading}>
	                      <h3>Deal Snapshot</h3>
	                      <div className={styles.documentActions}>
	                        <button
	                          className={styles.iconLink}
	                          type="button"
	                          onClick={() => setSourceFactsEditOpen((open) => !open)}
	                        >
	                          {sourceFactsEditOpen ? "Close edit" : "Edit data"}
	                        </button>
	                        <Link
	                          className={styles.iconLink}
	                          href={`/deal-analysis?property_id=${encodeURIComponent(selectedId)}`}
	                        >
	                          Open OM Workspace
	                        </Link>
	                      </div>
	                    </div>
	                    <dl className={styles.metricGrid}>
                      <div>
                        <dt>Units</dt>
                        <dd>{formatNumber(selectedProperty?.overview.units ?? selectedRow?.units)}</dd>
                      </div>
                      <div>
                        <dt>Sqft</dt>
                        <dd>{formatNumber(selectedProperty?.overview.buildingSqft ?? selectedRow?.buildingSqft)}</dd>
                      </div>
                      <div>
                        <dt>Type</dt>
                        <dd>{marketTypeLabel(sheetMarketType)}</dd>
                      </div>
                      <div>
                        <dt>Score</dt>
                        <dd>
                          <span
                            className={`${styles.scoreBadge} ${scoreTone(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}`}
                            title={scoreExplanation(selectedProperty ?? selectedRow)}
                          >
	                            {scoreLabel(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}
	                          </span>
	                        </dd>
	                      </div>
	                    </dl>
	                    {sourceFactsEditOpen ? (
	                      <form className={styles.sourceFactsForm} onSubmit={saveSourceFacts}>
	                        <label>
	                          Asking price
	                          <input
	                            inputMode="numeric"
	                            value={sourceFactsForm.askingPrice}
	                            onChange={(event) => updateSourceFactsField("askingPrice", event.target.value)}
	                            placeholder="14000000"
	                          />
	                        </label>
	                        <label>
	                          Units
	                          <input
	                            inputMode="numeric"
	                            value={sourceFactsForm.units}
	                            onChange={(event) => updateSourceFactsField("units", event.target.value)}
	                            placeholder="6"
	                          />
	                        </label>
	                        <label>
	                          Building SF
	                          <input
	                            inputMode="numeric"
	                            value={sourceFactsForm.buildingSqft}
	                            onChange={(event) => updateSourceFactsField("buildingSqft", event.target.value)}
	                            placeholder="7178"
	                          />
	                        </label>
	                        <label>
	                          Beds
	                          <input
	                            inputMode="decimal"
	                            value={sourceFactsForm.bedrooms}
	                            onChange={(event) => updateSourceFactsField("bedrooms", event.target.value)}
	                          />
	                        </label>
	                        <label>
	                          Baths
	                          <input
	                            inputMode="decimal"
	                            value={sourceFactsForm.bathrooms}
	                            onChange={(event) => updateSourceFactsField("bathrooms", event.target.value)}
	                          />
	                        </label>
	                        <label>
	                          Year built
	                          <input
	                            inputMode="numeric"
	                            value={sourceFactsForm.yearBuilt}
	                            onChange={(event) => updateSourceFactsField("yearBuilt", event.target.value)}
	                          />
	                        </label>
	                        <label>
	                          Neighborhood
	                          <input
	                            value={sourceFactsForm.neighborhood}
	                            onChange={(event) => updateSourceFactsField("neighborhood", event.target.value)}
	                            placeholder="NoHo"
	                          />
	                        </label>
	                        <label>
	                          Borough
	                          <input
	                            value={sourceFactsForm.borough}
	                            onChange={(event) => updateSourceFactsField("borough", event.target.value)}
	                            placeholder="Manhattan"
	                          />
	                        </label>
	                        <label>
	                          Listing status
	                          <input
	                            value={sourceFactsForm.listingStatus}
	                            onChange={(event) => updateSourceFactsField("listingStatus", event.target.value)}
	                            placeholder="Open"
	                          />
	                        </label>
	                        <label>
	                          Property type
	                          <input
	                            value={sourceFactsForm.propertyType}
	                            onChange={(event) => updateSourceFactsField("propertyType", event.target.value)}
	                            placeholder="Multi Family"
	                          />
	                        </label>
	                        <div className={styles.sourceFactsFormActions}>
	                          <button
	                            className={styles.secondaryButton}
	                            type="button"
	                            onClick={() => {
	                              setSourceFactsForm(sourceFactsFormFromProperty(selectedProperty, selectedRow));
	                              setSourceFactsEditOpen(false);
	                            }}
	                          >
	                            Cancel
	                          </button>
	                          <button className={styles.primaryButton} type="submit" disabled={busyAction === `${selectedId}:source-facts`}>
	                            {busyAction === `${selectedId}:source-facts` ? "Saving..." : "Save property data"}
	                          </button>
	                        </div>
	                      </form>
	                    ) : null}
	                    <OmAnalysisPanel analysis={selectedProperty?.enrichmentDetails?.omAnalysis} />
	                    {selectedProperty?.overview.description ? <p className={styles.description}>{selectedProperty.overview.description}</p> : null}
	                  </section>

	                  {!sheetHasOm ? (
	                    <section className={styles.omPendingCallout}>
	                      <div>
	                        <strong>No OM on file yet</strong>
	                        <p>Mid-term yields, NOI, and spread populate once an offering memorandum is ingested.</p>
	                      </div>
	                      <div className={styles.omPendingActions}>
	                        <button
	                          className={styles.primaryButton}
	                          type="button"
	                          onClick={(event) => emailBroker(selectedId, "property_sheet", event)}
	                        >
	                          Request from broker
	                        </button>
	                        <button className={styles.secondaryButton} type="button" onClick={() => setSheetTab("OM / Docs")}>
	                          Upload documents
	                        </button>
	                      </div>
	                    </section>
	                  ) : null}

                  <section className={styles.overviewSection}>
                    <div className={styles.sectionHeading}>
                      <h3>Broker</h3>
                      <button className={styles.iconButton} type="button" onClick={() => setBrokerEditOpen((open) => !open)}>
                        {brokerEditOpen ? "Done" : "Edit"}
                      </button>
                    </div>
                    {brokerEditOpen ? (
                      <form className={styles.brokerForm} onSubmit={saveBroker}>
                        <input value={brokerForm.name} onChange={(event) => setBrokerForm({ ...brokerForm, name: event.target.value })} placeholder="Name" />
                        <input value={brokerForm.email} onChange={(event) => setBrokerForm({ ...brokerForm, email: event.target.value })} placeholder="Email" />
                        <input value={brokerForm.phone} onChange={(event) => setBrokerForm({ ...brokerForm, phone: event.target.value })} placeholder="Phone" />
                        <input value={brokerForm.firm} onChange={(event) => setBrokerForm({ ...brokerForm, firm: event.target.value })} placeholder="Firm" />
                        <textarea value={brokerForm.notes} onChange={(event) => setBrokerForm({ ...brokerForm, notes: event.target.value })} placeholder="Notes" rows={3} />
                        <button className={styles.primaryButton} type="submit" disabled={busyAction === `${selectedId}:broker`}>
                          Save broker
                        </button>
                      </form>
                    ) : (
                      <dl className={styles.inlineDetailList}>
                        <div><dt>Name</dt><dd>{sheetBroker?.name ?? EMPTY_VALUE}</dd></div>
                        <div>
                          <dt>Email</dt>
                          <dd>
                            {sheetBroker?.email ?? (
                              selectedRow ? (
                                <button type="button" className={styles.brokerMissingChip} onClick={(event) => openBrokerPrompt(selectedRow, event)}>
                                  <MailPlus size={11} strokeWidth={2.2} aria-hidden="true" />
                                  <span>Add email</span>
                                </button>
                              ) : (
                                EMPTY_VALUE
                              )
                            )}
                          </dd>
                        </div>
                        <div><dt>Phone</dt><dd>{sheetBroker?.phone ?? EMPTY_VALUE}</dd></div>
                        <div><dt>Firm</dt><dd>{sheetBroker?.firm ?? EMPTY_VALUE}</dd></div>
                      </dl>
                    )}
                  </section>

                  <section className={styles.overviewSection}>
                    <div className={styles.sectionHeading}>
                      <h3>Property Data</h3>
                      {selectedProperty?.overview.listingUrl ? (
                        <a className={styles.iconLink} href={selectedProperty.overview.listingUrl} target="_blank" rel="noreferrer">
                          Open Source
                        </a>
                      ) : null}
                    </div>
                    <PropertyDataPanel details={selectedProperty?.enrichmentDetails ?? null} modules={sheetEnrichmentModules} />
                  </section>

                  <section className={styles.overviewSection}>
                    <h3>Tags</h3>
                    <div className={styles.sheetTags}>
                      {sheetTags.map((tag) => (
                        <button
                          key={tag}
                          className={cx(styles.removableTag, tagToneClass(tag))}
                          type="button"
                          onClick={() => removeTag(tag)}
                          disabled={busyAction === `${selectedId}:tag-remove:${tag}`}
                        >
                          <span>{tagLabel(tag)}</span>
                          <X className={styles.tagRemoveIcon} size={12} strokeWidth={2.3} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                    <form className={styles.addTagForm} onSubmit={addTag}>
                      <input list="pipeline-tags" value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Add tag" />
                      <button className={styles.secondaryButton} type="submit" disabled={!newTag.trim()}>
                        Add
                      </button>
                    </form>
                    <div className={styles.tagSuggestions}>
                      {COMMON_PIPELINE_TAGS.filter((tag) => !sheetTags.map(normalizeTag).includes(tag)).slice(0, 8).map((tag) => (
                        <button
                          key={tag}
                          className={cx(styles.tagSuggestion, tagToneClass(tag))}
                          type="button"
                          onClick={() => setNewTag(tag)}
                        >
                          {tagLabel(tag)}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : null}

              {sheetTab === "Enrichment" ? (
                <section className={styles.sheetPanel}>
                  <h3>Enrichment summary</h3>
                  <EnrichmentReport
                    modules={sheetEnrichmentModules}
                    state={selectedProperty?.enrichmentState ?? selectedRow?.enrichmentState ?? null}
                  />
                </section>
              ) : null}

              {sheetTab === "OM / Docs" ? (
                <section className={styles.sheetPanel}>
                  <h3>OM / Docs</h3>
                  <dl className={styles.metricGrid}>
                    <div>
                      <dt>OM</dt>
                      <dd>{selectedProperty?.documentStatus.hasOm ?? selectedRow?.documentStatus?.hasOm ? "Available" : "Missing"}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{titleize(selectedProperty?.documentStatus.omStatus ?? selectedRow?.documentStatus?.omStatus)}</dd>
                    </div>
                    <div>
                      <dt>Documents</dt>
                      <dd>{formatNumber(selectedProperty?.documentStatus.documentCount ?? selectedRow?.documentStatus?.documentCount)}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatDate(selectedProperty?.documentStatus.lastUpdatedAt ?? selectedRow?.documentStatus?.lastUpdatedAt)}</dd>
                    </div>
                  </dl>
                  <div className={styles.sheetTags}>
                    {(selectedProperty?.documentStatus.categories ?? selectedRow?.documentStatus?.categories ?? []).map((category) => (
                      <span className={cx(styles.tagChip, tagToneClass(category))} key={category}>
                        {category}
                      </span>
                    ))}
                  </div>
                  <form
                    className={styles.documentUploadPanel}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (selectedId) void uploadPropertyDocuments(selectedId, documentUploadFiles);
                    }}
                  >
                    <FileDropzone
                      files={documentUploadFiles}
                      onChange={setDocumentUploadFiles}
                      accept=".pdf,.txt,.csv,.xls,.xlsx"
                      disabled={documentUploading}
                      label="Drag & drop OMs / related docs"
                    />
                    <button className={styles.secondaryButton} type="submit" disabled={documentUploadFiles.length === 0 || documentUploading}>
                      {documentUploading ? "Reading..." : `Upload${documentUploadFiles.length ? ` ${documentUploadFiles.length}` : ""}`}
                    </button>
                    {documentUploadError ? <p className={styles.dataNote}>{documentUploadError}</p> : null}
                  </form>
                  <div className={styles.documentList}>
                    {sheetDocuments.length > 0 ? (
                      sheetDocuments.map((document) => (
                        <article key={`${document.sourceType}:${document.id}`} className={styles.documentRow}>
                          <div>
                            <strong>{document.fileName}</strong>
                            <span>
                              {[sourceLabel(document.source ?? document.sourceType), document.category, formatDate(document.createdAt)]
                                .filter(Boolean)
                                .join(" / ")}
                            </span>
                          </div>
                          <div className={styles.documentActions}>
                            <a href={documentUrl(document)} target="_blank" rel="noreferrer" className={styles.iconLink}>
                              Open
                            </a>
                            <a href={documentUrl(document)} download className={styles.iconLink}>
                              Download
                            </a>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className={styles.emptyState}>No documents have been uploaded or generated for this property yet.</div>
                    )}
                  </div>
                </section>
              ) : null}

              {sheetTab === "Market / Comps" ? (
                <BrokerCompsSheetPanel
                  propertyId={selectedId}
                  surface={sheetBrokerComps}
                  loading={sheetBrokerCompLoading}
                  uploading={sheetBrokerCompUploading}
                  savingOpinion={sheetBrokerCompOpinionSaving}
                  error={sheetBrokerCompError}
                  listedPrice={sheetListedPrice}
                  listedPpsf={sheetListedPpsf}
                  onRefresh={() => selectedId ? loadBrokerComps(selectedId) : undefined}
                  onUpload={(file) => selectedId ? uploadBrokerCompPackage(selectedId, file) : undefined}
                  onAddPricingOpinion={(input) => selectedId ? addBrokerCompPricingOpinion(selectedId, input) : undefined}
                />
              ) : null}

              {sheetTab === "Underwriting" ? (
                <section className={styles.sheetPanel}>
	                  <div className={styles.sectionHeading}>
	                    <h3>Underwriting</h3>
	                    <div className={styles.documentActions}>
	                      <Link className={styles.iconLink} href={`/deal-analysis?property_id=${encodeURIComponent(selectedId)}`}>
	                        Edit Assumptions
	                      </Link>
	                      <Link className={styles.iconLink} href={`/dossier-assumptions?property_id=${encodeURIComponent(selectedId)}`}>
	                        Override Dossier Fields
	                      </Link>
	                    </div>
	                  </div>
	                  <dl className={styles.metricGrid}>
	                    <div>
	                      <dt>YoC LTR</dt>
	                      <dd>{formatPercent(sheetLtrYoc)}</dd>
	                    </div>
	                    <div>
	                      <dt>YoC MTR</dt>
	                      <dd>{formatPercent(sheetMtrYoc)}</dd>
	                    </div>
	                    <div>
	                      <dt>Broker cap</dt>
	                      <dd
	                        className={sheetBrokerCapCalloutCode != null ? styles.yocFlagWarn : undefined}
	                        title={sheetBrokerCapCalloutLabel ?? undefined}
	                      >
	                        {formatPercent(sheetBrokerCapPct)}
	                      </dd>
	                    </div>
	                    <div>
	                      <dt>Market cap</dt>
	                      <dd>{formatPercent(sheetMarketCapRate)}</dd>
	                    </div>
	                    <div>
	                      <dt>MTR spread</dt>
	                      <dd>{formatPercent(sheetYoCSpread)}</dd>
	                    </div>
	                    <div>
	                      <dt>NOI uplift</dt>
	                      <dd>{formatPercent(sheetNoiUpliftPct)}</dd>
	                    </div>
	                    <div>
	                      <dt>Current NOI</dt>
	                      <dd>{formatCurrency(sheetCurrentNoi, false)}</dd>
	                    </div>
	                    <div>
	                      <dt>MTR NOI</dt>
	                      <dd>{formatCurrency(sheetAdjustedNoi, false)}</dd>
	                    </div>
	                    <div>
	                      <dt>Unlevered IRR</dt>
	                      <dd>{formatPercent(selectedProperty?.underwriting?.irrPct ?? selectedRow?.underwriting?.irrPct)}</dd>
	                    </div>
	                    <div>
	                      <dt>Deal score</dt>
	                      <dd>
	                        <span className={`${styles.scoreBadge} ${scoreTone(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}`}>
	                          {scoreLabel(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}
	                        </span>
	                      </dd>
	                    </div>
	                    <div>
	                      <dt>Generation</dt>
                      <dd>{titleize(selectedProperty?.underwriting?.generationStatus ?? selectedRow?.underwriting?.generationStatus)}</dd>
                    </div>
                  </dl>
                  <div className={styles.offerBand}>
                    Offer range: {formatCurrency(selectedProperty?.underwriting?.recommendedOfferLow ?? selectedRow?.underwriting?.recommendedOfferLow, false)} -{" "}
                    {formatCurrency(selectedProperty?.underwriting?.recommendedOfferHigh ?? selectedRow?.underwriting?.recommendedOfferHigh, false)}
                  </div>
                </section>
              ) : null}

              {sheetTab === "Activity" ? (
                <section className={styles.sheetPanel}>
                  <h3>Activity</h3>
                  <div className={styles.timeline}>
                    {(selectedProperty?.activityTimeline ?? []).map((item) => (
                      <article key={item.id} className={activityClass(item)}>
                        <time>{formatDate(item.createdAt)}</time>
                        <div>
                          <strong>{item.title}</strong>
                          {item.body ? <p>{item.body}</p> : null}
                        </div>
                      </article>
                    ))}
                    {selectedProperty?.activityTimeline.length === 0 ? <div className={styles.emptyState}>No activity yet.</div> : null}
                  </div>
                  {selectedProperty?.actionItems.length ? (
                    <div className={styles.actionItems}>
                      {selectedProperty.actionItems.map((item) => (
                        <span key={item.id} className={styles.tinyChip}>
                          {titleize(item.actionType)}: {titleize(item.status)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      <BrokerContactDialog
        state={brokerPrompt}
        onClose={() => setBrokerPrompt(null)}
        onChange={(patch) => setBrokerPrompt((current) => (current ? { ...current, ...patch } : current))}
        onSubmit={() => void submitBrokerPrompt()}
        onSearch={() => void searchBrokerContact()}
      />

      {outreachPreview ? (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${styles.outreachPreviewModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.kicker}>Email brokers</span>
                <h2>
                  {outreachPreview.loading
                    ? "Preparing drafts…"
                    : `${outreachPreview.batches.length} email${outreachPreview.batches.length === 1 ? "" : "s"} ready`}
                </h2>
              </div>
              <button
                className={styles.closeButton}
                type="button"
                onClick={() => setOutreachPreview(null)}
                disabled={outreachPreview.sending}
                aria-label="Close email preview"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {outreachPreview.loading ? (
              <p className={styles.outreachPreviewHint}>Resolving recipients and running send guards…</p>
            ) : (
              <div className={styles.outreachPreviewBody}>
                {outreachPreview.batches.length === 0 ? (
                  <p className={styles.outreachPreviewHint}>
                    Nothing is sendable — every selected property was skipped (see below).
                  </p>
                ) : null}
                {outreachPreview.batches.map((batch, index) => (
                  <section key={batch.toAddress} className={styles.outreachPreviewCard}>
                    <header>
                      <strong>{batch.toAddress}</strong>
                      <small>
                        {batch.addresses.length} propert{batch.addresses.length === 1 ? "y" : "ies"}
                        {batch.contactName ? ` — ${batch.contactName}` : ""}
                      </small>
                    </header>
                    <label>
                      <span>Subject</span>
                      <input
                        type="text"
                        value={batch.subject}
                        disabled={outreachPreview.sending}
                        onChange={(event) =>
                          setOutreachPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  batches: current.batches.map((candidate, candidateIndex) =>
                                    candidateIndex === index ? { ...candidate, subject: event.target.value } : candidate
                                  ),
                                }
                              : current
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>Body</span>
                      <textarea
                        rows={Math.min(14, 8 + batch.addresses.length)}
                        value={batch.body}
                        disabled={outreachPreview.sending}
                        onChange={(event) =>
                          setOutreachPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  batches: current.batches.map((candidate, candidateIndex) =>
                                    candidateIndex === index ? { ...candidate, body: event.target.value } : candidate
                                  ),
                                }
                              : current
                          )
                        }
                      />
                    </label>
                  </section>
                ))}
                {outreachPreview.skipped.length > 0 ? (
                  <section className={styles.outreachPreviewSkipped}>
                    <header>
                      <strong>Skipped ({outreachPreview.skipped.length})</strong>
                    </header>
                    <ul>
                      {outreachPreview.skipped.map((item) => (
                        <li key={item.propertyId}>
                          <div>
                            <strong>{item.canonicalAddress}</strong>
                            <small>{item.reason}</small>
                          </div>
                          {item.reasonCode === "missing_recipient" ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              disabled={outreachPreview.sending}
                              onClick={() => {
                                const row = rows.find((candidate) => candidate.propertyId === item.propertyId);
                                if (row) openBrokerPrompt(row);
                              }}
                            >
                              Find broker email
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
            <div className={styles.modalActions}>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => setOutreachPreview(null)}
                disabled={outreachPreview.sending}
              >
                Cancel
              </button>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={outreachPreview.loading || outreachPreview.sending}
                onClick={() => void openGroupedEmailPreview()}
                title="Re-resolve recipients and guards (use after adding a missing broker email)."
              >
                Re-check
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                title={
                  outreachPreview.batches.some((batch) => !batch.subject.trim() || !batch.body.trim())
                    ? "Every draft needs a subject and a body before sending."
                    : undefined
                }
                disabled={
                  outreachPreview.loading ||
                  outreachPreview.sending ||
                  outreachPreview.batches.length === 0 ||
                  outreachPreview.batches.some((batch) => !batch.subject.trim() || !batch.body.trim())
                }
                onClick={() => void sendGroupedEmails()}
              >
                {outreachPreview.sending
                  ? "Sending…"
                  : `Send ${outreachPreview.batches.length} email${outreachPreview.batches.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejectState ? (
        <div className={styles.modalOverlay}>
          <form className={styles.modal} onSubmit={submitReject}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.kicker}>
                  {rejectState.propertyIds && rejectState.propertyIds.length > 1 ? "Reject selected" : "Reject property"}
                </span>
                <h2>{rejectState.address}</h2>
              </div>
              <button className={styles.closeButton} type="button" onClick={() => setRejectState(null)} aria-label="Close rejection modal">
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <label>
              <span>Reason</span>
              <select
                autoFocus
                value={rejectState.reasonCode}
                onChange={(event) =>
                  setRejectState({ ...rejectState, reasonCode: event.target.value as UiV2RejectionReasonCode })
                }
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
                value={rejectState.note}
                onChange={(event) => setRejectState({ ...rejectState, note: event.target.value })}
                rows={4}
                placeholder="Optional context"
              />
            </label>
            <div className={styles.modalActions}>
              <button className={styles.ghostButton} type="button" onClick={() => setRejectState(null)}>
                Cancel
              </button>
              <button
                className={styles.dangerButton}
                type="submit"
                disabled={
                  !rejectState.reasonCode ||
                  busyAction === `${rejectState.propertyId}:reject` ||
                  busyAction === "bulk:reject"
                }
              >
                {busyAction === "bulk:reject"
                  ? "Rejecting..."
                  : rejectState.propertyIds && rejectState.propertyIds.length > 1
                    ? `Reject ${rejectState.propertyIds.length}`
                    : "Reject"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={mergePrompt != null}
        onClose={() => setMergePrompt(null)}
        onConfirm={() => {
          const prompt = mergePrompt;
          setMergePrompt(null);
          if (prompt) void performMerge(prompt);
        }}
        title="Merge properties"
        description={
          mergePrompt
            ? `Merge ${mergePrompt.sourceLabel} into ${mergePrompt.targetLabel}? Uploaded OM documents, generated files, OM runs, and deal signals will move to the target row; the duplicate row will be archived.`
            : undefined
        }
        confirmLabel="Merge"
        destructive
        busy={mergePrompt != null && busyAction === `${mergePrompt.row.propertyId}:merge`}
      />

      {composer ? (
        <div className={styles.modalOverlay}>
          <form className={styles.composerModal} onSubmit={submitComposer}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.kicker}>Outreach composer</span>
                <h2>{selectedProperty?.overview.displayAddress ?? selectedRow?.displayAddress ?? "Broker outreach"}</h2>
              </div>
              <button
                className={styles.closeButton}
                type="button"
                onClick={() => setComposer(null)}
                aria-label="Close outreach composer"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {composer.warnings.length > 0 ? (
              <div className={styles.warningBox}>{composer.warnings.join(" ")}</div>
            ) : null}
            <div className={styles.templateToolbar}>
              <label>
                <span>Saved draft</span>
                <select
                  value={composer.templateId}
                  onChange={(event) => applyComposerTemplate(event.target.value)}
                  disabled={loadingTemplates}
                >
                  <option value="">{loadingTemplates ? "Loading drafts..." : "Generated copy"}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Draft name</span>
                <input
                  value={composer.templateName}
                  onChange={(event) => setComposer({ ...composer, templateName: event.target.value })}
                  placeholder="Name reusable draft"
                />
              </label>
              <button className={styles.secondaryButton} type="button" onClick={() => void saveComposerTemplate()} disabled={composer.savingTemplate}>
                {composer.savingTemplate ? "Saving..." : "Save reusable"}
              </button>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => void deleteComposerTemplate()}
                disabled={!composer.templateId || composer.deletingTemplate}
              >
                {composer.deletingTemplate ? "Removing..." : "Remove"}
              </button>
            </div>
            <label>
              <span>To</span>
              <input
                value={composer.toAddress}
                onChange={(event) => setComposer({ ...composer, toAddress: event.target.value })}
                required
              />
            </label>
            <label>
              <span>Subject</span>
              <input
                value={composer.subject}
                onChange={(event) => setComposer({ ...composer, subject: event.target.value })}
                required
              />
            </label>
            <label>
              <span>Body</span>
              <textarea
                className={styles.messageBox}
                value={composer.body}
                onChange={(event) => setComposer({ ...composer, body: event.target.value })}
                rows={12}
                required
              />
            </label>
            <label>
              <span>Follow-up</span>
              <input
                type="datetime-local"
                value={composer.followUpAt}
                onChange={(event) => setComposer({ ...composer, followUpAt: event.target.value })}
              />
            </label>
            <div className={styles.modalActions}>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => setComposer(null)}
              >
                Cancel
              </button>
              <button className={styles.secondaryButton} type="submit" disabled={composer.submitting}>
                {composer.submitting ? "Saving..." : "Save draft for review"}
              </button>
              <button className={styles.primaryButton} type="button" onClick={() => void sendComposerNow()} disabled={composer.sendingNow}>
                {composer.sendingNow ? "Sending..." : "Send now"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function KeyList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className={styles.keyList}>
      <h4>{title}</h4>
      {values.length > 0 ? (
        values.map((value) => (
          <span className={styles.tagChip} key={value}>
            {titleize(value)}
          </span>
        ))
      ) : (
        <span className={styles.subtle}>-</span>
      )}
    </div>
  );
}

function EnrichmentReport({
  modules,
  state,
}: {
  modules: UiV2EnrichmentModuleDetail[];
  state: UiV2EnrichmentState | null;
}) {
  const completed = state?.completedKeys ?? [];
  const pending = state?.pendingKeys ?? [];
  const failed = state?.failedKeys ?? [];
  const visibleModules = modules.length > 0 ? modules : [];
  const modulesWithData = visibleModules.filter((module) => moduleItems(module).some((item) => displayDetailValue(item) !== EMPTY_VALUE)).length;
  const status = titleize(state?.status ?? (visibleModules.length > 0 ? "available" : "not started"));
  const lastRefreshed = formatDate(state?.lastRefreshedAt);

  if (visibleModules.length === 0 && completed.length === 0 && pending.length === 0 && failed.length === 0) {
    return <div className={styles.emptyState}>No enrichment details are available yet.</div>;
  }

  return (
    <div className={styles.enrichmentReport}>
      <div className={styles.enrichmentLead}>
        <div>
          <strong>{status}</strong>
          <span>{lastRefreshed !== EMPTY_VALUE ? `Last refreshed ${lastRefreshed}` : "Refresh this property to pull city, rental, and sourcing data."}</span>
        </div>
        <span className={`${styles.tinyChip} ${moduleToneClass(state?.status)}`}>
          {modulesWithData} of {Math.max(visibleModules.length, modulesWithData)} modules with data
        </span>
      </div>
      {state?.errorMessage ? <p className={styles.enrichmentError}>{state.errorMessage}</p> : null}
      <div className={styles.enrichmentKeyRows}>
        <EnrichmentKeyRow label="Completed" values={completed} tone="success" />
        <EnrichmentKeyRow label="Pending" values={pending} tone="info" />
        <EnrichmentKeyRow label="Failed" values={failed} tone="warning" />
      </div>
      <ul className={styles.enrichmentSections}>
        {visibleModules.map((module) => {
          const items = moduleItems(module)
            .filter((item) => displayDetailValue(item) !== EMPTY_VALUE)
            .slice(0, 6);
          const updatedAt = moduleUpdatedAt(module);
          return (
            <li key={module.key}>
              <div className={styles.enrichmentSectionHeader}>
                <strong>{module.label}</strong>
                <span className={`${styles.tinyChip} ${moduleToneClass(module.status)}`}>{statusBadgeLabel(module.status)}</span>
              </div>
              {items.length > 0 ? (
                <ul className={styles.enrichmentBullets}>
                  {items.map((item) => (
                    <li key={`${module.key}:${item.label}`}>
                      <span>{titleize(item.label)}</span>
                      <strong>{displayDetailValue(item)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No source fields populated yet.</p>
              )}
              <small>{updatedAt ? `Updated ${updatedAt}` : `${moduleItems(module).length} fields checked`}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EnrichmentKeyRow({
  label,
  values,
  tone,
}: {
  label: string;
  values: string[];
  tone: "success" | "info" | "warning";
}) {
  const toneClass = tone === "success" ? styles.toneSuccess : tone === "info" ? styles.toneInfo : styles.toneWarning;
  return (
    <div className={styles.enrichmentKeyRow}>
      <span>{label}</span>
      <div>
        {values.length > 0 ? (
          values.map((value) => (
            <span className={`${styles.tinyChip} ${toneClass}`} key={value}>
              {titleize(value)}
            </span>
          ))
        ) : (
          <span className={styles.subtle}>None</span>
        )}
      </div>
    </div>
  );
}

type RentalUnitItem = NonNullable<NonNullable<UiV2RentalFlowPayload["rentalUnits"]>[number]>;
type RentRollItem = NonNullable<NonNullable<UiV2OmAnalysisPayload["rentRoll"]>[number]>;

const PROPERTY_DETAIL_MODULES = ["location", "tax_assessment", "owner", "zoning", "certificate_of_occupancy"] as const;
const REGULATORY_MODULES = [
  "permits",
  "hpd_registration",
  "hpd_violations",
  "dob_complaints",
  "housing_litigations",
  "affordable_housing",
] as const;

function moduleToneClass(status: string | null | undefined): string {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "missing" || normalized === "failed") return styles.toneWarning;
  if (normalized === "review" || normalized === "partial") return styles.toneInfo;
  return styles.toneSuccess;
}

function moduleItems(module: UiV2EnrichmentModuleDetail | null | undefined): UiV2DetailItem[] {
  return module ? [...(module.summaryItems ?? []), ...(module.detailItems ?? [])] : [];
}

function moduleItemValue(module: UiV2EnrichmentModuleDetail | null | undefined, labels: string[]): string | null {
  const wanted = labels.map((label) => label.toLowerCase());
  const item = moduleItems(module).find((candidate) => wanted.includes(candidate.label.toLowerCase()));
  const value = item ? displayDetailValue(item) : null;
  return value && value !== EMPTY_VALUE ? value : null;
}

function compactModuleLine(module: UiV2EnrichmentModuleDetail): string {
  const items = moduleItems(module)
    .map((item) => `${titleize(item.label)} ${displayDetailValue(item)}`)
    .filter((item) => !item.endsWith(` ${EMPTY_VALUE}`))
    .slice(0, 3);
  return items.length > 0 ? items.join(" · ") : "No source fields populated yet";
}

function moduleUpdatedAt(module: UiV2EnrichmentModuleDetail): string | null {
  return (
    moduleItemValue(module, ["Last updated", "Refreshed", "Processed", "Last refreshed", "Last evaluated", "Updated"]) ??
    null
  );
}

function factsFromListing(facts: UiV2ListingFactsPayload | null | undefined): UiV2DetailItem[] {
  if (!facts) return [];
  const bedsBaths =
    facts.bedrooms != null || facts.bathrooms != null
      ? `${formatNumber(facts.bedrooms)} bd / ${formatNumber(facts.bathrooms)} ba`
      : null;
  return [
    { label: "Listing status", value: titleize(facts.status) },
    { label: "Property type", value: titleize(facts.propertyType) },
    { label: "Beds / baths", value: bedsBaths },
    { label: "Building SF", value: formatNumber(facts.sqft) },
    { label: "$/SF", value: formatCurrency(facts.ppsqft, false) },
    { label: "Days on market", value: formatNumber(facts.daysOnMarket) },
    { label: "Listed", value: formatDate(facts.listedAt) },
    { label: "Built", value: facts.builtIn ?? null },
    { label: "Monthly HOA", value: formatCurrency(facts.monthlyHoa, false) },
    { label: "Monthly tax", value: formatCurrency(facts.monthlyTax, false) },
  ].filter((item) => item.value != null && item.value !== EMPTY_VALUE);
}

function statusBadgeLabel(status: string | null | undefined): string {
  return titleize(status ?? "available");
}

function activityClass(item: { type?: string | null; title?: string | null; metadata?: Record<string, unknown> | null }): string | undefined {
  const tone = item.metadata?.tone;
  if (tone === "danger" || /unavailable|rejected|failed/i.test(`${item.title ?? ""} ${item.type ?? ""}`)) return styles.timelineDanger;
  if (/listing|sourcing/i.test(`${item.title ?? ""} ${item.type ?? ""}`)) return styles.timelineInfo;
  return undefined;
}

function EnrichmentModuleGrid({
  modules,
  compact = false,
}: {
  modules: UiV2EnrichmentModuleDetail[];
  compact?: boolean;
}) {
  const visibleModules = compact ? modules.filter((module) => (module.summaryItems?.length ?? 0) > 0).slice(0, 10) : modules;
  if (visibleModules.length === 0) {
    return <div className={styles.emptyState}>No enrichment details are available yet.</div>;
  }
  return (
    <div className={compact ? styles.moduleGridCompact : styles.moduleGrid}>
      {visibleModules.map((module) => (
        <article key={module.key} className={styles.moduleRow}>
          <div className={styles.moduleHeader}>
            <div>
              <strong>{module.label}</strong>
              <p>{compactModuleLine(module)}</p>
            </div>
            <span className={`${styles.tinyChip} ${moduleToneClass(module.status)}`}>
              {statusBadgeLabel(module.status)}
            </span>
          </div>
          <small>{moduleUpdatedAt(module) ? `Updated ${moduleUpdatedAt(module)}` : `${moduleItems(module).length} fields pulled`}</small>
        </article>
      ))}
    </div>
  );
}

function DataModuleRow({ module }: { module: UiV2EnrichmentModuleDetail }) {
  const items = moduleItems(module).slice(0, 6);
  const refreshed = module.lastRefreshedAt ? new Date(module.lastRefreshedAt) : null;
  const refreshedValid = refreshed != null && !Number.isNaN(refreshed.getTime());
  return (
    <article className={styles.dataModuleRow}>
      <div className={styles.dataModuleHeader}>
        <strong>{module.label}</strong>
        {refreshedValid ? (
          <span
            className={styles.dataModuleStamp}
            title={`Source data last pulled ${refreshed.toLocaleString("en-US")}`}
          >
            {refreshed.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        ) : null}
        <span className={`${styles.tinyChip} ${moduleToneClass(module.status)}`}>{statusBadgeLabel(module.status)}</span>
      </div>
      <DetailItems items={items} />
    </article>
  );
}

function RentalUnitTable({ units }: { units: RentalUnitItem[] }) {
  if (units.length === 0) {
    return <div className={styles.emptyState}>No unit-level rental rows are available yet.</div>;
  }
  return (
    <div className={styles.dataTableShell}>
      <table className={styles.miniTable}>
        <thead>
          <tr>
            <th>Unit</th>
            <th>Layout</th>
            <th>Rent</th>
            <th>Status</th>
            <th>Last rented</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit, index) => {
            const photo = Array.isArray(unit.images) ? unit.images[0] : null;
            const unitLabel = unit.unit ?? `Unit ${index + 1}`;
            return (
              <tr key={`${unitLabel}:${index}`}>
                <td>
                  <div className={styles.unitCell}>
                    {photo ? <img src={photo} alt="" className={styles.unitPhoto} /> : <div className={styles.unitPhotoBlank}>{index + 1}</div>}
                    <div>
                      {unit.streeteasyUrl ? (
                        <a href={unit.streeteasyUrl} target="_blank" rel="noreferrer">
                          {unitLabel}
                        </a>
                      ) : (
                        <strong>{unitLabel}</strong>
                      )}
                      <span>{sourceLabel(unit.source ?? "rapidapi")}</span>
                    </div>
                  </div>
                </td>
                <td>
                  {[unit.beds != null ? `${formatNumber(unit.beds)} bd` : null, unit.baths != null ? `${formatNumber(unit.baths)} ba` : null, unit.sqft != null ? `${formatNumber(unit.sqft)} sf` : null]
                    .filter(Boolean)
                    .join(" · ") || EMPTY_VALUE}
                </td>
                <td>{formatCurrency(unit.rentalPrice, false)}</td>
                <td>{titleize(unit.status)}</td>
                <td>{formatDate(unit.lastRentedDate ?? unit.listedDate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RentRollTable({ rows }: { rows: RentRollItem[] }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.dataTableShell}>
      <table className={styles.miniTable}>
        <thead>
          <tr>
            <th>Unit</th>
            <th>Type</th>
            <th>Rent</th>
            <th>Beds / Baths</th>
            <th>SF</th>
            <th>Tenant/status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 80).map((row, index) => (
            <tr key={`${row.unit ?? row.tenantName ?? "row"}:${index}`}>
              <td>{row.unit ?? row.building ?? `Row ${index + 1}`}</td>
              <td>{row.unitCategory ?? row.rentType ?? EMPTY_VALUE}</td>
              <td>{formatCurrency(row.monthlyTotalRent ?? row.monthlyRent ?? row.monthlyBaseRent, false)}</td>
              <td>
                {[row.beds != null ? `${formatNumber(row.beds)} bd` : null, row.baths != null ? `${formatNumber(row.baths)} ba` : null]
                  .filter(Boolean)
                  .join(" · ") || EMPTY_VALUE}
              </td>
              <td>{row.sqft != null ? `${formatNumber(row.sqft)} sf` : EMPTY_VALUE}</td>
              <td>{[row.tenantName, typeof row.occupied === "boolean" ? (row.occupied ? "Occupied" : "Vacant") : row.occupied, row.tenantStatus].filter(Boolean).join(" · ") || EMPTY_VALUE}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RentalFlowPanel({ flow }: { flow?: UiV2RentalFlowPayload | null }) {
  if (!flow) return null;
  const units = flow.rentalUnits ?? [];
  return (
    <section className={styles.propertyDataSection}>
      <div className={styles.propertyDataHeader}>
        <div>
          <h4>Rental Flow</h4>
          <p>{flow.lastUpdatedAt ? `Updated ${formatDate(flow.lastUpdatedAt)}` : "StreetEasy rental-history probe and listing LLM extraction"}</p>
        </div>
        <span className={`${styles.tinyChip} ${units.length > 0 ? styles.toneSuccess : styles.toneWarning}`}>
          {units.length > 0 ? `${units.length} units` : "Needs data"}
        </span>
      </div>
      <dl className={styles.propertyFactGrid}>
        <div><dt>Source</dt><dd>{sourceLabel(flow.source ?? null)}</dd></div>
        <div><dt>Gross rent</dt><dd>{formatCurrency(flow.grossRent, false)}</dd></div>
        <div><dt>NOI</dt><dd>{formatCurrency(flow.noi, false)}</dd></div>
        <div><dt>Cap rate</dt><dd>{formatPercent(flow.capRate)}</dd></div>
      </dl>
      {flow.dataGaps ? <p className={styles.dataNote}>{flow.dataGaps}</p> : null}
      <RentalUnitTable units={units} />
      {flow.omRentRoll?.length ? (
        <>
          <h5 className={styles.subsectionTitle}>OM rent roll</h5>
          <RentRollTable rows={flow.omRentRoll} />
        </>
      ) : null}
    </section>
  );
}

function OmAnalysisPanel({ analysis }: { analysis?: UiV2OmAnalysisPayload | null }) {
  if (!analysis) return null;
  const takeaways = analysis.takeaways ?? [];
  const rentRoll = analysis.rentRoll ?? [];
  return (
    <section className={styles.propertyDataSection}>
      <div className={styles.propertyDataHeader}>
        <div>
          <h4>OM Analysis</h4>
          <p>{analysis.processedAt ? `Processed ${formatDate(analysis.processedAt)}` : "Promoted OM financials and rent-roll extraction"}</p>
        </div>
        <span className={`${styles.tinyChip} ${analysis.status === "failed" ? styles.toneWarning : styles.toneSuccess}`}>
          {statusBadgeLabel(analysis.status)}
        </span>
      </div>
      <dl className={styles.propertyFactGrid}>
        <div><dt>Current NOI</dt><dd>{formatCurrency(analysis.currentNoi, false)}</dd></div>
        <div><dt>Operating expenses</dt><dd>{formatCurrency(analysis.operatingExpenses, false)}</dd></div>
        <div><dt>Rent roll rows</dt><dd>{formatNumber(rentRoll.length)}</dd></div>
        <div><dt>Validation flags</dt><dd>{formatNumber(analysis.validationFlags?.length ?? null)}</dd></div>
      </dl>
      {takeaways.length > 0 ? (
        <ul className={styles.takeawayList}>
          {takeaways.slice(0, 6).map((takeaway) => (
            <li key={takeaway}>{takeaway}</li>
          ))}
        </ul>
      ) : null}
      <RentRollTable rows={rentRoll} />
    </section>
  );
}

function BrokerCompsSheetPanel({
  propertyId,
  surface,
  loading,
  uploading,
  savingOpinion,
  error,
  listedPrice,
  listedPpsf,
  onRefresh,
  onUpload,
  onAddPricingOpinion,
}: {
  propertyId: string;
  surface: BrokerCompUiSurface;
  loading: boolean;
  uploading: boolean;
  savingOpinion: boolean;
  error: string | null;
  listedPrice: number | null;
  listedPpsf: number | null;
  onRefresh: () => void | Promise<void> | undefined;
  onUpload: (file: File) => void | Promise<void> | undefined;
  onAddPricingOpinion: (input: { amount: number; note: string; listedPrice?: number | null }) => void | Promise<void> | undefined;
}) {
  const uploadEndpoint = plannedBrokerCompUploadEndpoint(propertyId);
  const reviewEndpoint = plannedBrokerCompReviewEndpoint(propertyId);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [whisperAmount, setWhisperAmount] = useState("");
  const [whisperNote, setWhisperNote] = useState("");

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || uploading) return;
    await onUpload(selectedFile);
    setSelectedFile(null);
  }

  async function submitPricingOpinion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(whisperAmount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0 || savingOpinion) return;
    await onAddPricingOpinion({ amount, note: whisperNote, listedPrice });
    setWhisperAmount("");
    setWhisperNote("");
  }

  const whisperNumeric = Number(whisperAmount.replace(/[$,\s]/g, ""));
  const whisperDiscount =
    listedPrice != null && Number.isFinite(whisperNumeric) && whisperNumeric > 0
      ? ((listedPrice - whisperNumeric) / listedPrice) * 100
      : null;

  const formatSqft = (value: number | null | undefined): string => {
    const formatted = formatNumber(value);
    return formatted === EMPTY_VALUE ? formatted : `${formatted} SF`;
  };
  const formatPpsf = (value: number | null | undefined): string => formatCurrency(value, false);
  const formatMonthlyCurrency = (value: number | null | undefined): string => {
    const formatted = formatCurrency(value, false);
    return formatted === EMPTY_VALUE ? formatted : `${formatted}/mo`;
  };
  const formatSignedMoney = (value: number | null | undefined): string => {
    if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${formatCurrency(Math.abs(value), false)}`;
  };
  const formatSignedPercent = (value: number | null | undefined): string => {
    if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
  };
  const averageNumber = (values: Array<number | null | undefined>): number | null => {
    const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
    if (clean.length === 0) return null;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
  };
  const weightedAverageNumber = (rows: Array<{ value: number | null; weight: number | null }>): number | null => {
    const totals = rows.reduce<{ value: number; weight: number }>(
      (acc, row) => {
        const value = row.value;
        if (value == null || !Number.isFinite(value)) return acc;
        const weight = row.weight != null && Number.isFinite(row.weight) && row.weight > 0 ? row.weight : 1;
        acc.value += value * weight;
        acc.weight += weight;
        return acc;
      },
      { value: 0, weight: 0 }
    );
    return totals.weight > 0 ? totals.value / totals.weight : null;
  };
  const weightedPpsf = (rows: Array<{ price: number | null; interiorSqft: number | null; ppsf: number | null }>): number | null => {
    const totals = rows.reduce(
      (acc, row) => {
        if (row.price != null && row.interiorSqft != null && row.price > 0 && row.interiorSqft > 0) {
          acc.price += row.price;
          acc.sqft += row.interiorSqft;
        }
        if (row.ppsf != null && row.ppsf > 0) {
          acc.ppsfSum += row.ppsf;
          acc.ppsfCount += 1;
        }
        return acc;
      },
      { price: 0, sqft: 0, ppsfSum: 0, ppsfCount: 0 }
    );
    if (totals.price > 0 && totals.sqft > 0) return totals.price / totals.sqft;
    return totals.ppsfCount > 0 ? totals.ppsfSum / totals.ppsfCount : null;
  };
  const compPpsfForProject = (row: { soldPpsf: number | null; askingPpsf: number | null; pricePerSqft: number | null }): number | null =>
    row.soldPpsf ?? row.askingPpsf ?? row.pricePerSqft;
  const compPpsfForBedroom = (row: { avgSoldPpsf: number | null; avgAskingPpsf: number | null }): number | null =>
    row.avgSoldPpsf ?? row.avgAskingPpsf;
  const priceRangeLabel = (low: number | null, high: number | null, fallback?: string | null): string => {
    if (fallback) return fallback;
    if (low != null && high != null) return `${formatCurrency(low, false)} - ${formatCurrency(high, false)}`;
    if (low != null) return formatCurrency(low, false);
    if (high != null) return formatCurrency(high, false);
    return EMPTY_VALUE;
  };
  const renderPpsfSpread = (subjectValue: number | null, compValue: number | null) => {
    if (subjectValue == null || compValue == null || !Number.isFinite(subjectValue) || !Number.isFinite(compValue) || compValue <= 0) return EMPTY_VALUE;
    const diff = subjectValue - compValue;
    const pct = (diff / compValue) * 100;
    return `${formatSignedMoney(diff)} (${formatSignedPercent(pct)})`;
  };

  const pricingCompRows = surface.comparables.filter((row) => row.itemType === "pricing_comp");
  const subjectPackagePpsf = weightedPpsf(surface.subjectUnitPricingRows);
  const subjectOverallPpsf = subjectPackagePpsf ?? listedPpsf;
  const packageProjectedSelloutFromRows = surface.subjectUnitPricingRows.reduce((sum, row) => sum + (row.price ?? 0), 0);
  const packageProjectedSellout =
    packageProjectedSelloutFromRows > 0
      ? packageProjectedSelloutFromRows
      : surface.pricingOpinions.find((opinion) => opinion.sourceType === "package" && opinion.amount != null)?.amount ?? null;
  const packageVsListing = packageProjectedSellout != null && listedPrice != null ? packageProjectedSellout - listedPrice : null;
  const packageVsListingPct = packageProjectedSellout != null && listedPrice != null && listedPrice > 0 ? ((packageVsListing ?? 0) / listedPrice) * 100 : null;
  const averageProjectPpsf = averageNumber(pricingCompRows.map(compPpsfForProject));

  const subjectBedroomPpsf = new Map<number, number>();
  for (const bedroom of [...new Set(surface.subjectUnitPricingRows.map((row) => row.bedrooms).filter((value): value is number => value != null))]) {
    const ppsf = weightedPpsf(surface.subjectUnitPricingRows.filter((row) => row.bedrooms === bedroom));
    if (ppsf != null) subjectBedroomPpsf.set(bedroom, ppsf);
  }

  const bedroomSummaryGroups = new Map<string, { bedrooms: number | null; label: string; rows: typeof surface.bedroomBreakdowns }>();
  for (const row of surface.bedroomBreakdowns) {
    const key = row.bedrooms != null ? String(row.bedrooms) : row.bedroomType ?? "unknown";
    const label = row.bedroomType ?? (row.bedrooms != null ? `${row.bedrooms} Bed` : "Unknown");
    const existing = bedroomSummaryGroups.get(key);
    if (existing) existing.rows.push(row);
    else bedroomSummaryGroups.set(key, { bedrooms: row.bedrooms, label, rows: [row] });
  }
  const bedroomSummaryRows = [...bedroomSummaryGroups.values()]
    .sort((left, right) => (left.bedrooms ?? 99) - (right.bedrooms ?? 99))
    .map((group) => {
      const subjectBedroomRows = group.bedrooms != null ? surface.subjectUnitPricingRows.filter((row) => row.bedrooms === group.bedrooms) : [];
      const subjectBedroomValue = group.bedrooms != null ? subjectBedroomPpsf.get(group.bedrooms) ?? subjectOverallPpsf : subjectOverallPpsf;
      const compAskPpsf = weightedAverageNumber(group.rows.map((row) => ({ value: row.avgAskingPpsf, weight: row.count })));
      const compSoldPpsf = weightedAverageNumber(group.rows.map((row) => ({ value: row.avgSoldPpsf, weight: row.count })));
      const compPpsf = compSoldPpsf ?? compAskPpsf;
      return {
        label: group.label,
        projectCount: group.rows.length,
        offered: group.rows.reduce((sum, row) => sum + (row.count ?? 0), 0) || null,
        compAvgSize: weightedAverageNumber(group.rows.map((row) => ({ value: row.avgSizeSqft, weight: row.count }))),
        dealAvgSize: subjectBedroomRows.length > 0 ? averageNumber(subjectBedroomRows.map((row) => row.interiorSqft)) : null,
        compAskPpsf,
        compSoldPpsf,
        dealPpsf: subjectBedroomValue,
        psfSpread: renderPpsfSpread(subjectBedroomValue, compPpsf),
        avgCc: weightedAverageNumber(group.rows.map((row) => ({ value: row.avgCommonChargesMonthly, weight: row.count }))),
      };
    });

  const extractionNotes = [
    surface.summary,
    surface.missingDataFlags.length > 0
      ? `${surface.missingDataFlags.length} missing-data field${surface.missingDataFlags.length === 1 ? "" : "s"} flagged by the extractor.`
      : null,
  ].filter((note): note is string => Boolean(note && note.trim()));

  return (
    <section className={styles.sheetPanel}>
      <div className={styles.sectionHeading}>
        <div>
          <h3>Market / Comps</h3>
          <span>Broker package intelligence kept separate from underwriting</span>
        </div>
        <form className={styles.documentActions} onSubmit={submitUpload}>
          <input
            aria-label="Broker comp package file"
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.txt"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <button className={styles.secondaryButton} type="submit" disabled={!selectedFile || uploading} title={`POST ${uploadEndpoint}`}>
            {uploading ? "Replacing..." : "Replace extract"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => void onRefresh()}
            title={`GET ${reviewEndpoint}`}
          >
            {loading ? "Refreshing..." : "Refresh extraction"}
          </button>
        </form>
      </div>

      {error ? <p className={styles.dataNote}>{error}</p> : null}

      <section className={styles.propertyDataSection}>
        <div className={styles.propertyDataHeader}>
          <div>
            <h4>Pricing check</h4>
            <p>Deal ask versus package projected sellout and comp $/SF</p>
          </div>
        </div>
        <dl className={styles.propertyFactGrid}>
          <div>
            <dt>Listing price</dt>
            <dd>{formatCurrency(listedPrice, false)}</dd>
          </div>
          <div>
            <dt>Package sellout</dt>
            <dd>{formatCurrency(packageProjectedSellout, false)}</dd>
          </div>
          <div>
            <dt>Package vs listing</dt>
            <dd>{formatSignedMoney(packageVsListing)}</dd>
            <small>{formatSignedPercent(packageVsListingPct)}</small>
          </div>
          <div>
            <dt>Deal $/SF</dt>
            <dd>{formatPpsf(subjectOverallPpsf)}</dd>
          </div>
          <div>
            <dt>Avg comp $/SF</dt>
            <dd>{formatPpsf(averageProjectPpsf)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(surface.updatedAt)}</dd>
          </div>
        </dl>
        <form className={styles.documentActions} onSubmit={submitPricingOpinion}>
          <input
            aria-label="Whisper price"
            inputMode="decimal"
            placeholder="Manual price signal"
            value={whisperAmount}
            onChange={(event) => setWhisperAmount(event.target.value)}
          />
          <input
            aria-label="Whisper price note"
            placeholder="Note or source"
            value={whisperNote}
            onChange={(event) => setWhisperNote(event.target.value)}
          />
          <button className={styles.secondaryButton} type="submit" disabled={savingOpinion || !Number.isFinite(whisperNumeric) || whisperNumeric <= 0}>
            {savingOpinion ? "Saving..." : "Save signal"}
          </button>
        </form>
        {whisperDiscount != null ? (
          <p className={styles.dataNote}>
            {formatCurrency(whisperNumeric, false)} is {formatPercent(whisperDiscount)} below listed price {formatCurrency(listedPrice, false)}.
          </p>
        ) : null}
        {extractionNotes.length > 0 ? <p className={styles.dataNote}>{extractionNotes.slice(0, 2).join(" ")}</p> : null}
      </section>

      {!surface.hasData ? (
        <div className={styles.emptyState}>
          {loading ? "Loading broker comp packages..." : "No broker comp package has been uploaded or extracted yet."}
        </div>
      ) : null}

      <section className={styles.propertyDataSection}>
        <div className={styles.propertyDataHeader}>
          <div>
            <h4>Building level comps</h4>
            <p>Core project facts from the current broker market analysis package</p>
          </div>
        </div>
        {pricingCompRows.length > 0 ? (
          <div className={styles.dataTableShell}>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Neighborhood</th>
                  <th>Year</th>
                  <th>Floors</th>
                  <th>Units</th>
                  <th>Sales began</th>
                  <th>% sold</th>
                  <th>Avg unit</th>
                  <th>Ask $/SF</th>
                  <th>Sold $/SF</th>
                  <th>Range</th>
                </tr>
              </thead>
              <tbody>
                {pricingCompRows.slice(0, 40).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.propertyName ?? row.address ?? "Unlabeled comp"}</strong>
                      <span>{row.address ?? ""}</span>
                    </td>
                    <td>{row.neighborhood ?? EMPTY_VALUE}</td>
                    <td>{formatNumber(row.yearCompleted)}</td>
                    <td>{formatNumber(row.floors)}</td>
                    <td>{formatNumber(row.units)}</td>
                    <td>{row.salesBegan ?? EMPTY_VALUE}</td>
                    <td>{formatPercent(row.percentSoldPct)}</td>
                    <td>{formatSqft(row.averageUnitSqft)}</td>
                    <td>{formatPpsf(row.askingPpsf ?? row.pricePerSqft)}</td>
                    <td>{formatPpsf(row.soldPpsf)}</td>
                    <td>{priceRangeLabel(row.priceRangeLow, row.priceRangeHigh, row.priceRange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>No building-level comp rows are available yet.</div>
        )}
      </section>

      <section className={styles.propertyDataSection}>
        <div className={styles.propertyDataHeader}>
          <div>
            <h4>Bedroom summary</h4>
            <p>Averages by bedroom type compared against deal/package unit pricing</p>
          </div>
        </div>
        {bedroomSummaryRows.length > 0 ? (
          <div className={styles.dataTableShell}>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Projects</th>
                  <th>Offered</th>
                  <th>Comp avg SF</th>
                  <th>Deal avg SF</th>
                  <th>Comp ask $/SF</th>
                  <th>Comp sold $/SF</th>
                  <th>Deal $/SF</th>
                  <th>$/SF delta</th>
                  <th>Avg CC</th>
                </tr>
              </thead>
              <tbody>
                {bedroomSummaryRows.map((row) => (
                  <tr key={row.label}>
                    <td><strong>{row.label}</strong></td>
                    <td>{formatNumber(row.projectCount)}</td>
                    <td>{formatNumber(row.offered)}</td>
                    <td>{formatSqft(row.compAvgSize)}</td>
                    <td>{formatSqft(row.dealAvgSize)}</td>
                    <td>{formatPpsf(row.compAskPpsf)}</td>
                    <td>{formatPpsf(row.compSoldPpsf)}</td>
                    <td>{formatPpsf(row.dealPpsf)}</td>
                    <td>{row.psfSpread}</td>
                    <td>{formatMonthlyCurrency(row.avgCc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>No bedroom summary rows are available yet.</div>
        )}
      </section>

      {surface.subjectUnitPricingRows.length > 0 ? (
        <section className={styles.propertyDataSection}>
          <div className={styles.propertyDataHeader}>
            <div>
              <h4>Subject unit pricing</h4>
              <p>Projected pricing rows extracted from the subject package</p>
            </div>
          </div>
          <div className={styles.dataTableShell}>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Bed / bath</th>
                  <th>Int SF</th>
                  <th>Ext SF</th>
                  <th>Price</th>
                  <th>$/SF</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {surface.subjectUnitPricingRows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.unitLabel ?? EMPTY_VALUE}</strong></td>
                    <td>{[row.bedrooms != null ? `${row.bedrooms} Bed` : null, row.bathrooms != null ? `${row.bathrooms} Bath` : null].filter(Boolean).join(" / ") || EMPTY_VALUE}</td>
                    <td>{formatSqft(row.interiorSqft)}</td>
                    <td>{formatSqft(row.exteriorSqft)}</td>
                    <td>{formatCurrency(row.price, false)}</td>
                    <td>{formatPpsf(row.ppsf)}</td>
                    <td>{row.notes ?? EMPTY_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className={styles.propertyDataSection}>
        <div className={styles.propertyDataHeader}>
          <div>
            <h4>Unit type comps</h4>
            <p>Per-building bedroom rows with offered count, size, $/SF, range, and average CC</p>
          </div>
        </div>
        {surface.bedroomBreakdowns.length > 0 ? (
          <div className={styles.dataTableShell}>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Bed / bath</th>
                  <th>Offered</th>
                  <th>Avg SF</th>
                  <th>Ask $/SF</th>
                  <th>Sold $/SF</th>
                  <th>Avg CC</th>
                  <th>Deal $/SF</th>
                  <th>$/SF delta</th>
                  <th>Range</th>
                </tr>
              </thead>
              <tbody>
                {[...surface.bedroomBreakdowns]
                  .sort((left, right) => (left.bedrooms ?? 99) - (right.bedrooms ?? 99) || (left.address ?? "").localeCompare(right.address ?? ""))
                  .slice(0, 60)
                  .map((row) => {
                    const dealPpsf = row.bedrooms != null ? subjectBedroomPpsf.get(row.bedrooms) ?? subjectOverallPpsf : subjectOverallPpsf;
                    const compPpsf = compPpsfForBedroom(row);
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.propertyName ?? row.address ?? "Unlabeled comp"}</strong>
                          <span>{row.address ?? ""}</span>
                        </td>
                        <td>{[row.bedroomType ?? (row.bedrooms != null ? `${row.bedrooms} Bed` : null), row.bathrooms != null ? `${row.bathrooms} Bath` : null].filter(Boolean).join(" / ") || EMPTY_VALUE}</td>
                        <td>{formatNumber(row.count)}</td>
                        <td>{formatSqft(row.avgSizeSqft)}</td>
                        <td>{formatPpsf(row.avgAskingPpsf)}</td>
                        <td>{formatPpsf(row.avgSoldPpsf)}</td>
                        <td>{formatMonthlyCurrency(row.avgCommonChargesMonthly)}</td>
                        <td>{formatPpsf(dealPpsf)}</td>
                        <td>{renderPpsfSpread(dealPpsf, compPpsf)}</td>
                        <td>{priceRangeLabel(row.priceRangeLow, row.priceRangeHigh, row.priceRange)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>No unit-type comp rows are available yet.</div>
        )}
      </section>
    </section>
  );
}

function PropertyDataPanel({ details, modules }: { details?: UiV2EnrichmentDetailPayload | null; modules: UiV2EnrichmentModuleDetail[] }) {
  const byKey = new Map(modules.map((module) => [module.key, module]));
  const propertyModules = PROPERTY_DETAIL_MODULES.flatMap((key) => {
    const module = byKey.get(key);
    return module && moduleItems(module).length > 0 ? [module] : [];
  });
  const regulatoryModules = REGULATORY_MODULES.flatMap((key) => {
    const module = byKey.get(key);
    return module && moduleItems(module).length > 0 ? [module] : [];
  });
  const listingFacts = details?.listingFacts ?? null;
  const factItems = factsFromListing(listingFacts);
  if (modules.length === 0 && factItems.length === 0 && !details?.rentalFlow) {
    return <div className={styles.emptyState}>No enrichment details are available yet.</div>;
  }
  return (
    <div className={styles.propertyDataPanel}>
      <section className={styles.propertyDataSection}>
        <div className={styles.propertyDataHeader}>
          <div>
            <h4>Property Details</h4>
            <p>Source facts plus city and tax identifiers in one place</p>
          </div>
          {listingFacts?.unitCountSource === "inferred" ? <span className={`${styles.tinyChip} ${styles.toneWarning}`}>Units estimated</span> : null}
        </div>
        {factItems.length > 0 ? <DetailItems items={factItems} /> : null}
        {propertyModules.length > 0 ? (
          <div className={styles.dataModuleList}>
            {propertyModules.map((module) => (
              <DataModuleRow key={module.key} module={module} />
            ))}
          </div>
        ) : null}
      </section>

      {regulatoryModules.length > 0 ? (
        <section className={styles.propertyDataSection}>
          <div className={styles.propertyDataHeader}>
            <div>
              <h4>Regulatory Records</h4>
              <p>Permits, HPD, DOB complaints, litigation, and affordability checks</p>
            </div>
          </div>
          <div className={styles.dataModuleList}>
            {regulatoryModules.map((module) => (
              <DataModuleRow key={module.key} module={module} />
            ))}
          </div>
        </section>
      ) : null}

      <RentalFlowPanel flow={details?.rentalFlow} />
    </div>
  );
}

function DetailItems({ items }: { items: UiV2DetailItem[] }) {
  if (items.length === 0) return <span className={styles.subtle}>{EMPTY_VALUE}</span>;
  return (
    <dl className={styles.moduleItems}>
      {items.map((item) => (
        <div key={`${item.label}:${String(item.value)}`}>
          <dt>{titleize(item.label)}</dt>
          <dd>
            {item.href ? (
              <a href={item.href} target="_blank" rel="noreferrer">
                {displayDetailValue(item)}
              </a>
            ) : (
              displayDetailValue(item)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
