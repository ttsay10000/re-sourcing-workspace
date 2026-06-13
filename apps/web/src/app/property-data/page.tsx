"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CopyCheck, History, ListChecks, Mail, PlusCircle, Zap } from "lucide-react";
import { Button, EmptyState, PageHeader, SkeletonRows, StatCard, type StatCardTone } from "@/components/ui";
import { labelFromKey } from "@/lib/format";
import {
  deriveListingActivitySummary,
  describeListingActivity,
  formatListingEventLabel,
  type ListingActivitySummary,
} from "@re-sourcing/contracts";
import { useProcessBanner } from "@/components/ProcessBanner";
import { PropertyDetailCollapsible } from "./PropertyDetailCollapsible";
import { CanonicalPropertyDetail, type CanonicalProperty } from "./CanonicalPropertyDetail";
import { AREA_OPTIONS, cityToArea, cityFromCanonicalAddress } from "./areas";
import { getSourcingUpdate, getSourcingUpdateMeta } from "./sourcingUpdate";
import styles from "./propertyData.module.css";
import {
  estimateGenerationProgress,
  generationStageLabel,
  getPropertyDossierGeneration,
  type LocalDossierJobState,
} from "./dossierState";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type TabId = "raw" | "canonical";

/** Labels for enrichment module keys (from API byModule). */
const ENRICHMENT_MODULE_LABELS: Record<string, string> = {
  permits: "Permits",
  zoning_ztl: "Zoning",
  certificate_of_occupancy: "Certificate of Occupancy",
  hpd_registration: "HPD Registration",
  hpd_violations: "HPD Violations",
  dob_complaints: "DOB Complaints",
  housing_litigations: "Housing Litigations",
};

interface WorkflowBoardColumn {
  key: string;
  label: string;
  shortLabel: string;
}

interface WorkflowBoardStep {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "partial";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
  lastMessage: string | null;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  metadata?: Record<string, unknown> | null;
}

interface WorkflowBoardRun {
  id: string;
  runNumber: number;
  runType: string;
  displayName: string;
  scopeLabel: string | null;
  triggerSource: string;
  totalItems: number;
  status: "pending" | "running" | "completed" | "failed" | "partial";
  startedAt: string;
  finishedAt: string | null;
  metadata?: Record<string, unknown> | null;
  steps: WorkflowBoardStep[];
}

interface WorkflowBoardPayload {
  columns: WorkflowBoardColumn[];
  runs: WorkflowBoardRun[];
}

interface WorkflowDisplayColumn {
  key: string;
  label: string;
  shortLabel: string;
  stepKeys: string[];
}

const DEFAULT_WORKFLOW_COLUMNS: WorkflowBoardColumn[] = [
  { key: "raw_ingest", label: "Raw Ingest", shortLabel: "Raw" },
  { key: "canonical", label: "Canonical", shortLabel: "Canonical" },
  { key: "permits", label: "Permits", shortLabel: "Permits" },
  { key: "hpd_registration", label: "HPD Registration", shortLabel: "HPD Reg" },
  { key: "certificate_of_occupancy", label: "Certificate of Occupancy", shortLabel: "CO" },
  { key: "zoning_ztl", label: "Zoning", shortLabel: "Zoning" },
  { key: "dob_complaints", label: "DOB Complaints", shortLabel: "DOB" },
  { key: "hpd_violations", label: "HPD Violations", shortLabel: "HPD Viol." },
  { key: "housing_litigations", label: "Housing Litigations", shortLabel: "Litig." },
  { key: "rental_flow", label: "Rental Flow", shortLabel: "Rental" },
  { key: "om_financials", label: "OM Financials", shortLabel: "OM" },
  { key: "inquiry", label: "Inquiry", shortLabel: "Inquiry" },
  { key: "inbox", label: "Inbox", shortLabel: "Inbox" },
  { key: "dossier", label: "Dossier", shortLabel: "Dossier" },
];

const WORKFLOW_DISPLAY_COLUMNS: WorkflowDisplayColumn[] = [
  { key: "raw_ingest", label: "Raw ingest", shortLabel: "Ingest", stepKeys: ["raw_ingest"] },
  { key: "canonical", label: "Canonical", shortLabel: "Canonical", stepKeys: ["canonical"] },
  {
    key: "enrichment",
    label: "Enrichment",
    shortLabel: "Enrich",
    stepKeys: [
      "permits",
      "hpd_registration",
      "certificate_of_occupancy",
      "zoning_ztl",
      "dob_complaints",
      "hpd_violations",
      "housing_litigations",
      "rental_flow",
    ],
  },
  { key: "om_financials", label: "OM", shortLabel: "OM", stepKeys: ["om_financials"] },
  { key: "inquiry", label: "Inquiry", shortLabel: "Inquiry", stepKeys: ["inquiry", "inbox"] },
  { key: "dossier", label: "Dossier", shortLabel: "Dossier", stepKeys: ["dossier"] },
];

interface PipelineEnrichmentRow {
  key: string;
  label: string;
  completed: number;
}

interface PipelineStats {
  rawListings: number;
  canonicalProperties: number;
  enrichment: PipelineEnrichmentRow[];
  /** When requested with includeRemaining=1: property IDs not yet completed per module. */
  remainingByModule?: Record<string, { count: number; propertyIds: string[] }>;
}

/** Result of last enrichment run (from POST from-listings or run-enrichment: permitEnrichment + omFinancialsRefresh). rentalFlow only from from-listings. */
interface LastEnrichmentResult {
  ran: true;
  success: number;
  failed: number;
  byModule: Record<string, number>;
  /** OM/Brochure financials: docs re-processed by senior-analyst LLM (run-enrichment; also on OM upload). */
  omFinancialsProcessed?: number;
  /** OM/Brochure docs skipped because file was not on disk (e.g. ephemeral storage). */
  omFinancialsSkippedNoFile?: number;
  /** Rental flow (RapidAPI + LLM on listing) runs automatically; summary when present. */
  rentalFlow?: { ran: boolean; success: number; failed: number };
}

type BulkInquiryRecipientSource =
  | "manual_override"
  | "primary_broker"
  | "secondary_broker"
  | "listing_candidate"
  | "missing";

interface BulkInquirySendResultRow {
  propertyId: string;
  canonicalAddress: string;
  status: "sent" | "skipped" | "failed";
  toAddress: string | null;
  recipientSource: BulkInquiryRecipientSource;
  messageId?: string | null;
  sentAt?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
}

interface BulkInquirySendResponse {
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  results: BulkInquirySendResultRow[];
}

interface ManualAddResponse {
  ok: boolean;
  propertyId: string;
  listingId: string;
  canonicalAddress: string;
  createdProperty: boolean;
  createdListing: boolean;
  saleDetailsFetch?: {
    method?: "id" | "url";
    saleId?: string | null;
    warning?: string | null;
  } | null;
  omImport?: {
    requested?: boolean;
    imported?: boolean;
    omUrl?: string | null;
    resolvedOmUrl?: string | null;
    fileName?: string | null;
    authoritativeOmBuilt?: boolean;
    warning?: string | null;
  } | null;
  enrichment?: {
    attempted?: boolean;
    ok?: boolean;
    bbl?: string | null;
    bin?: string | null;
    warning?: string | null;
  } | null;
}

interface DossierNotice {
  type: "success" | "error";
  message: string;
}

interface AgentEnrichmentEntry {
  name: string;
  firm?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface PriceHistoryEntry {
  date: string;
  price: string | number;
  event: string;
}

interface ListingRow {
  id: string;
  externalId: string;
  source: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft?: number | null;
  description?: string | null;
  listedAt?: string | null;
  url?: string;
  imageUrls?: string[] | null;
  agentNames?: string[] | null;
  agentEnrichment?: AgentEnrichmentEntry[] | null;
  priceHistory?: PriceHistoryEntry[] | null;
  rentalPriceHistory?: PriceHistoryEntry[] | null;
  extra?: Record<string, unknown> | null;
  uploadedAt?: string | null;
  uploadedRunId?: string | null;
  duplicateScore?: number | null;
  lastActivity?: ListingActivitySummary | null;
}

function formatListedDate(listedAt: string | null | undefined): string {
  if (!listedAt) return "—";
  const d = new Date(listedAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function listingActivityTimestamp(activity: ListingActivitySummary | null | undefined): number {
  if (!activity?.sortDate) return 0;
  const d = new Date(activity.sortDate);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function formatActivitySummary(
  activity: ListingActivitySummary | null | undefined,
  listedAt?: string | null
): string {
  if (!activity?.lastActivityDate) {
    return listedAt ? `${formatListedDate(listedAt)} · Listed` : "—";
  }
  return `${formatListedDate(activity.lastActivityDate)} · ${formatListingEventLabel(activity.lastActivityEvent)}`;
}

function formatPriceReductionSummary(activity: ListingActivitySummary | null | undefined): string | null {
  if (!activity) return null;
  const totalReduction = activity.currentDiscountFromOriginalAskAmount;
  if (totalReduction == null || !Number.isFinite(totalReduction) || totalReduction <= 0) return null;

  const cutCount = activity.totalPriceDrops;
  const countLabel = cutCount > 0 ? `${cutCount} price cut${cutCount === 1 ? "" : "s"}` : "Price reduced";
  const amountLabel = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(totalReduction);
  const pctLabel =
    activity.currentDiscountFromOriginalAskPct != null && activity.currentDiscountFromOriginalAskPct > 0
      ? ` (${activity.currentDiscountFromOriginalAskPct.toFixed(1)}%)`
      : "";

  return `${countLabel} · Down ${amountLabel}${pctLabel} since listed`;
}

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: styles.statusChipNeutral,
  info: styles.statusChipInfo,
  success: styles.statusChipSuccess,
  warning: styles.statusChipWarning,
  danger: styles.statusChipDanger,
};

function workflowStatusTone(status: WorkflowBoardRun["status"] | WorkflowBoardStep["status"]): StatusTone {
  switch (status) {
    case "running":
      return "info";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "partial":
      return "warning";
    default:
      return "neutral";
  }
}

function sourcingUpdateTone(details: Record<string, unknown> | null | undefined): StatusTone {
  const update = getSourcingUpdate(details);
  if (!update?.status) return "neutral";
  if (update.status === "new") return "info";
  if (update.status === "updated") return "warning";
  return "neutral";
}

function workflowStatusLabel(status: WorkflowBoardRun["status"] | WorkflowBoardStep["status"]) {
  switch (status) {
    case "running":
      return "In progress";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "partial":
      return "Partial";
    default:
      return "Pending";
  }
}

function summarizeWorkflowGroupStatus(steps: WorkflowBoardStep[]): WorkflowBoardStep["status"] {
  if (steps.some((step) => step.status === "running")) return "running";
  const hasProgress = steps.some(
    (step) =>
      step.status === "completed" ||
      step.status === "partial" ||
      step.completedItems > 0 ||
      step.failedItems > 0 ||
      step.skippedItems > 0
  );
  if (steps.some((step) => step.status === "failed")) {
    return hasProgress ? "partial" : "failed";
  }
  if (steps.some((step) => step.status === "partial")) return "partial";
  if (steps.every((step) => step.status === "completed")) return "completed";
  if (hasProgress) return "partial";
  return "pending";
}

function summarizeWorkflowSteps(run: WorkflowBoardRun, column: WorkflowDisplayColumn): WorkflowBoardStep | null {
  const matchedSteps = run.steps.filter((step) => column.stepKeys.includes(step.key));
  if (matchedSteps.length === 0) return null;
  if (matchedSteps.length === 1) return matchedSteps[0];

  const startedAt = matchedSteps.find((step) => step.startedAt)?.startedAt ?? null;
  const finishedAt = [...matchedSteps].reverse().find((step) => step.finishedAt)?.finishedAt ?? null;
  const lastError = [...matchedSteps].reverse().find((step) => step.lastError)?.lastError ?? null;
  const lastMessage = [...matchedSteps].reverse().find((step) => step.lastMessage)?.lastMessage ?? null;

  return {
    key: column.key,
    label: column.label,
    status: summarizeWorkflowGroupStatus(matchedSteps),
    totalItems: matchedSteps.reduce((sum, step) => sum + step.totalItems, 0),
    completedItems: matchedSteps.reduce((sum, step) => sum + step.completedItems, 0),
    failedItems: matchedSteps.reduce((sum, step) => sum + step.failedItems, 0),
    skippedItems: matchedSteps.reduce((sum, step) => sum + step.skippedItems, 0),
    lastMessage,
    lastError,
    startedAt,
    finishedAt,
    metadata: null,
  };
}

function joinCompact(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join(" · ");
}

function formatBulkInquiryRecipientSource(source: BulkInquiryRecipientSource): string {
  switch (source) {
    case "manual_override":
      return "Manual email";
    case "primary_broker":
      return "Primary broker";
    case "secondary_broker":
      return "Secondary broker";
    case "listing_candidate":
      return "Listing fallback";
    default:
      return "No email";
  }
}

function StatusChip({
  label,
  detail,
  tone,
  className = "",
}: {
  label: string;
  detail?: string | null;
  tone: StatusTone;
  className?: string;
}) {
  const classes = [styles.statusChip, STATUS_TONE_CLASS[tone], className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <span className={styles.statusChipLabel}>{label}</span>
      {detail ? <span className={styles.statusChipDetail}>{detail}</span> : null}
    </div>
  );
}

const PROPERTY_STATUS_OPTIONS = [
  "new_sourced",
  "needs_om",
  "om_requested",
  "follow_up_needed",
  "om_received",
  "underwriting",
  "saved_watchlist",
  "loi_sent",
  "negotiation",
  "contract_signed",
  "diligence_escrow",
  "closed",
  "rejected_removed",
];

const DEFAULT_PROPERTY_TAGS = [
  "property_toured",
  "high_priority",
  "follow_up",
  "broker_relationship",
  "off_market",
  "distressed_seller",
  "below_replacement_cost",
  "tax_class_advantage",
  "free_market_focus",
  "rent_stabilized_risk",
  "needs_city_data",
  "needs_rent_roll",
  "needs_om",
  "good_mtr_candidate",
  "rejected",
  "duplicate",
  "partner_review_needed",
];

function getPropertyTags(prop: CanonicalProperty): string[] {
  const details = prop.details as Record<string, unknown> | null | undefined;
  const pipeline = details && typeof details.pipeline === "object" && details.pipeline != null
    ? details.pipeline as Record<string, unknown>
    : null;
  const fromProp = Array.isArray(prop.propertyTags) ? prop.propertyTags : [];
  const fromDetails = Array.isArray(pipeline?.tags) ? pipeline.tags : [];
  return [...new Set([...fromProp, ...fromDetails].filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0))];
}

function getPropertyMissingFields(prop: CanonicalProperty): string[] {
  const details = prop.details as Record<string, unknown> | null | undefined;
  const pipeline = details && typeof details.pipeline === "object" && details.pipeline != null
    ? details.pipeline as Record<string, unknown>
    : null;
  const fromProp = Array.isArray(prop.missingFields) ? prop.missingFields : [];
  const fromDetails = Array.isArray(pipeline?.missingFields) ? pipeline.missingFields : [];
  return [...new Set([...fromProp, ...fromDetails].filter((field): field is string => typeof field === "string" && field.trim().length > 0))];
}

function getPropertyPipelineStatus(prop: CanonicalProperty): string {
  const details = prop.details as Record<string, unknown> | null | undefined;
  const pipeline = details && typeof details.pipeline === "object" && details.pipeline != null
    ? details.pipeline as Record<string, unknown>
    : null;
  if (typeof prop.pipelineStatus === "string" && prop.pipelineStatus.trim()) return prop.pipelineStatus.trim();
  if (typeof pipeline?.status === "string" && pipeline.status.trim()) return pipeline.status.trim();
  return "new_sourced";
}

function isRejectedProperty(prop: CanonicalProperty): boolean {
  const tags = getPropertyTags(prop);
  return getPropertyPipelineStatus(prop) === "rejected_removed" || tags.includes("rejected") || Boolean(prop.rejectedAt);
}

function PropertyDataContent() {
  const processBanner = useProcessBanner();
  const [activeTab, setActiveTab] = useState<TabId>("canonical");
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [clearingCanonical, setClearingCanonical] = useState(false);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);
  const [pipelineStatsOpen, setPipelineStatsOpen] = useState(false);
  const [workflowBoard, setWorkflowBoard] = useState<WorkflowBoardPayload>({
    columns: DEFAULT_WORKFLOW_COLUMNS,
    runs: [],
  });
  const [workflowBoardOpen, setWorkflowBoardOpen] = useState(true);
  const [reviewDupOpen, setReviewDupOpen] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<ListingRow[]>([]);
  const [loadingDup, setLoadingDup] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualAddModalOpen, setManualAddModalOpen] = useState(false);
  const [manualAddDraft, setManualAddDraft] = useState({ streetEasyInput: "", omUrl: "" });
  const [manualAddSubmitting, setManualAddSubmitting] = useState(false);
  const [manualAddError, setManualAddError] = useState<string | null>(null);
  const [manualAddNotice, setManualAddNotice] = useState<DossierNotice | null>(null);
  const [canonicalProperties, setCanonicalProperties] = useState<CanonicalProperty[]>([]);
  const [loadingCanonical, setLoadingCanonical] = useState(false);
  const [sendingToCanonical, setSendingToCanonical] = useState(false);
  const [rerunningEnrichment, setRerunningEnrichment] = useState(false);
  const [runningRentalFlow, setRunningRentalFlow] = useState(false);
  const [deletingCanonical, setDeletingCanonical] = useState(false);
  const [bulkInquirySending, setBulkInquirySending] = useState(false);
  const [bulkInquiryResult, setBulkInquiryResult] = useState<BulkInquirySendResponse | null>(null);
  const [expandedCanonicalId, setExpandedCanonicalId] = useState<string | null>(null);
  const [inquiryComposerRequest, setInquiryComposerRequest] = useState<{ propertyId: string; nonce: number } | null>(null);
  const [savedPropertyIds, setSavedPropertyIds] = useState<Set<string>>(new Set());
  const [savedDealsLoading, setSavedDealsLoading] = useState<Set<string>>(new Set());
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [selectedCanonicalIds, setSelectedCanonicalIds] = useState<Set<string>>(new Set());
  const [enrichmentTimerSeconds, setEnrichmentTimerSeconds] = useState(0);
  const enrichmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectAllRawCheckboxRef = useRef<HTMLInputElement | null>(null);
  const selectAllCanonicalCheckboxRef = useRef<HTMLInputElement | null>(null);
  const hadActiveWorkflowRunsRef = useRef(false);
  const [lastEnrichmentResult, setLastEnrichmentResult] = useState<LastEnrichmentResult | null>(null);
  const [localDossierJobs, setLocalDossierJobs] = useState<Record<string, LocalDossierJobState>>({});
  const [dossierNotice, setDossierNotice] = useState<DossierNotice | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter/sort state (shared concept for raw and canonical)
  const [sortBy, setSortBy] = useState<"price" | "listedAt" | "lastActivity" | "area">("lastActivity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [includeRejected, setIncludeRejected] = useState(false);
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [listedAfter, setListedAfter] = useState<string>("");
  const [listedBefore, setListedBefore] = useState<string>("");

  const fetchListings = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/listings`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data.error || data.details || `HTTP ${r.status}`) as string);
        if (data.error) throw new Error(data.error);
        setListings(data.listings ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e.message === "Failed to fetch" ? `Cannot reach API at ${API_BASE}. Check CORS and NEXT_PUBLIC_API_URL.` : (e.message || "Failed to load listings")))
      .finally(() => setLoading(false));
  }, []);

  const fetchWorkflowBoard = useCallback(() => {
    fetch(`${API_BASE}/api/properties/workflow-board`)
      .then((r) => r.json())
      .then((data) =>
        setWorkflowBoard({
          columns: Array.isArray(data.columns) && data.columns.length > 0 ? data.columns : DEFAULT_WORKFLOW_COLUMNS,
          runs: Array.isArray(data.runs) ? data.runs : [],
        })
      )
      .catch(() => setWorkflowBoard({ columns: DEFAULT_WORKFLOW_COLUMNS, runs: [] }));
  }, []);

  const fetchPipelineStats = useCallback((includeRemaining = false) => {
    const url = `${API_BASE}/api/properties/pipeline-stats${includeRemaining ? "?includeRemaining=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPipelineStats({
          rawListings: data.rawListings ?? 0,
          canonicalProperties: data.canonicalProperties ?? 0,
          enrichment: data.enrichment ?? [],
          remainingByModule: data.remainingByModule ?? undefined,
        });
      })
      .catch(() => setPipelineStats(null));
  }, []);

  const fetchCanonicalProperties = useCallback((quiet = false) => {
    if (!quiet) setLoadingCanonical(true);
    fetch(`${API_BASE}/api/properties?includeListingSummary=1`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        const genericApiError = typeof data.error === "string" ? data.error.trim() : "";
        const apiDetails = typeof data.details === "string" ? data.details.trim() : "";
        const preferredMessage =
          apiDetails && /^failed to load properties\.?$/i.test(genericApiError)
            ? apiDetails
            : (genericApiError || apiDetails || `HTTP ${r.status}`);
        if (!r.ok) throw new Error(preferredMessage);
        if (data.error) throw new Error(preferredMessage);
        setCanonicalProperties(data.properties ?? []);
      })
      .catch((e) => {
        if (quiet) return;
        setError(e.message === "Failed to fetch" ? `Cannot reach API at ${API_BASE}. Check CORS and NEXT_PUBLIC_API_URL.` : (e.message || "Failed to load canonical properties"));
      })
      .finally(() => {
        if (!quiet) setLoadingCanonical(false);
      });
  }, []);

  useEffect(() => {
    if (activeTab === "raw") fetchListings();
  }, [activeTab, fetchListings]);

  useEffect(() => {
    if (activeTab === "canonical") fetchCanonicalProperties();
  }, [activeTab, fetchCanonicalProperties]);

  useEffect(() => {
    if (!dossierNotice) return;
    const timeoutId = window.setTimeout(() => setDossierNotice(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [dossierNotice]);

  useEffect(() => {
    if (!manualAddNotice) return;
    const timeoutId = window.setTimeout(() => setManualAddNotice(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [manualAddNotice]);

  const anyRunningDossierJobs = Object.values(localDossierJobs).some((job) => job.status === "running");

  useEffect(() => {
    if (!anyRunningDossierJobs) return;
    const intervalId = window.setInterval(() => {
      setLocalDossierJobs((prev) => {
        let changed = false;
        const next: Record<string, LocalDossierJobState> = {};
        for (const [propertyId, job] of Object.entries(prev)) {
          if (job.status !== "running") {
            next[propertyId] = job;
            continue;
          }
          const progressPct = estimateGenerationProgress(Date.now() - job.startedAt);
          if (progressPct !== job.progressPct) changed = true;
          next[propertyId] = { ...job, progressPct, stageLabel: generationStageLabel(progressPct) };
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => window.clearInterval(intervalId);
  }, [anyRunningDossierJobs]);

  useEffect(() => {
    if (canonicalProperties.length === 0) return;
    const ids = canonicalProperties.map((p) => p.id).join(",");
    fetch(`${API_BASE}/api/profile/saved-deals/check?propertyIds=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((data) => {
        const hasSaved = data && typeof data.saved === "object";
        if (hasSaved)
          setSavedPropertyIds(new Set(Object.keys(data.saved).filter((id) => Boolean(data.saved[id]))));
      })
      .catch(() => {});
  }, [canonicalProperties]);

  useEffect(() => {
    setSelectedCanonicalIds((prev) => {
      if (prev.size === 0) return prev;
      const available = new Set(canonicalProperties.map((property) => property.id));
      const next = new Set(Array.from(prev).filter((id) => available.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [canonicalProperties]);

  // Timer for LLM enrichment / loading: track elapsed time while raw listings are loading so user knows data may still be populating
  useEffect(() => {
    if (activeTab !== "raw") return;
    if (loading) {
      setEnrichmentTimerSeconds(0);
      enrichmentTimerRef.current = setInterval(() => {
        setEnrichmentTimerSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (enrichmentTimerRef.current) {
        clearInterval(enrichmentTimerRef.current);
        enrichmentTimerRef.current = null;
      }
      setEnrichmentTimerSeconds(0);
    }
    return () => {
      if (enrichmentTimerRef.current) {
        clearInterval(enrichmentTimerRef.current);
        enrichmentTimerRef.current = null;
      }
    };
  }, [activeTab, loading]);

  useEffect(() => {
    fetchPipelineStats(true);
  }, [fetchPipelineStats]);

  // While re-run enrichment is in progress, poll pipeline stats so counts and remaining update live
  useEffect(() => {
    if (!rerunningEnrichment) return;
    fetchPipelineStats(true);
    const interval = setInterval(() => fetchPipelineStats(true), 2500);
    return () => clearInterval(interval);
  }, [rerunningEnrichment, fetchPipelineStats]);

  const hasActiveWorkflowRuns = workflowBoard.runs.some((run) => run.status === "running" || run.status === "pending");

  useEffect(() => {
    fetchWorkflowBoard();
  }, [fetchWorkflowBoard]);

  useEffect(() => {
    const intervalMs =
      hasActiveWorkflowRuns || sendingToCanonical || rerunningEnrichment || runningRentalFlow || anyRunningDossierJobs
        ? 2500
        : 15000;
    const intervalId = window.setInterval(fetchWorkflowBoard, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [
    anyRunningDossierJobs,
    fetchWorkflowBoard,
    hasActiveWorkflowRuns,
    rerunningEnrichment,
    runningRentalFlow,
    sendingToCanonical,
  ]);

  useEffect(() => {
    if (activeTab !== "canonical") return;
    if (!(hasActiveWorkflowRuns || sendingToCanonical || rerunningEnrichment || runningRentalFlow || anyRunningDossierJobs)) return;
    fetchCanonicalProperties(true);
    fetchPipelineStats(true);
    const intervalId = window.setInterval(() => {
      fetchCanonicalProperties(true);
      fetchPipelineStats(true);
    }, 2500);
    return () => window.clearInterval(intervalId);
  }, [
    activeTab,
    anyRunningDossierJobs,
    fetchCanonicalProperties,
    fetchPipelineStats,
    hasActiveWorkflowRuns,
    rerunningEnrichment,
    runningRentalFlow,
    sendingToCanonical,
  ]);

  useEffect(() => {
    if (activeTab !== "canonical") {
      hadActiveWorkflowRunsRef.current = hasActiveWorkflowRuns;
      return;
    }
    if (hadActiveWorkflowRunsRef.current && !hasActiveWorkflowRuns) {
      fetchCanonicalProperties(true);
      fetchPipelineStats(true);
    }
    hadActiveWorkflowRunsRef.current = hasActiveWorkflowRuns;
  }, [activeTab, fetchCanonicalProperties, fetchPipelineStats, hasActiveWorkflowRuns]);

  const selectedListing = selectedId ? listings.find((l) => l.id === selectedId) ?? null : null;

  const parseNum = (s: string): number | null => {
    const n = parseFloat(s.replace(/[$,]/g, "").trim());
    return s.trim() === "" || Number.isNaN(n) ? null : n;
  };
  const parseDate = (s: string): number | null => {
    if (!s.trim()) return null;
    const t = new Date(s.trim()).getTime();
    return Number.isNaN(t) ? null : t;
  };
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const availablePropertyTags = useMemo(() => {
    const tags = new Set(DEFAULT_PROPERTY_TAGS);
    canonicalProperties.forEach((property) => getPropertyTags(property).forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort((a, b) => labelFromKey(a).localeCompare(labelFromKey(b)));
  }, [canonicalProperties]);

  const filteredSortedListings = useMemo(() => {
    let out = listings.filter((row) => {
      if (normalizedSearch) {
        const haystack = [
          row.externalId,
          row.address,
          row.city,
          row.state,
          row.zip,
          row.source,
          cityToArea(row.city),
        ]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (areaFilter) {
        const area = cityToArea(row.city);
        if (area !== areaFilter) return false;
      }
      const price = row.price;
      if (minPrice != null && parseNum(minPrice) != null && price < parseNum(minPrice)!) return false;
      if (maxPrice != null && parseNum(maxPrice) != null && price > parseNum(maxPrice)!) return false;
      const listedTs = row.listedAt ? new Date(row.listedAt).getTime() : null;
      if (listedAfter && parseDate(listedAfter) != null && (listedTs == null || listedTs < parseDate(listedAfter)!)) return false;
      if (listedBefore && parseDate(listedBefore) != null && (listedTs == null || listedTs > parseDate(listedBefore)!)) return false;
      return true;
    });
    const mult = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (sortBy === "price") {
        const pa = a.price ?? 0;
        const pb = b.price ?? 0;
        return mult * (pa - pb);
      }
      if (sortBy === "lastActivity") {
        const ta = listingActivityTimestamp(a.lastActivity ?? deriveListingActivitySummary({
          listedAt: a.listedAt ?? null,
          currentPrice: a.price ?? null,
          priceHistory: a.priceHistory ?? null,
        }));
        const tb = listingActivityTimestamp(b.lastActivity ?? deriveListingActivitySummary({
          listedAt: b.listedAt ?? null,
          currentPrice: b.price ?? null,
          priceHistory: b.priceHistory ?? null,
        }));
        return mult * (ta - tb);
      }
      if (sortBy === "listedAt") {
        const ta = a.listedAt ? new Date(a.listedAt).getTime() : 0;
        const tb = b.listedAt ? new Date(b.listedAt).getTime() : 0;
        return mult * (ta - tb);
      }
      const areaA = cityToArea(a.city);
      const areaB = cityToArea(b.city);
      return mult * areaA.localeCompare(areaB);
    });
    return out;
  }, [listings, normalizedSearch, areaFilter, minPrice, maxPrice, listedAfter, listedBefore, sortBy, sortDir]);

  const filteredSortedCanonical = useMemo(() => {
    let out = canonicalProperties.filter((prop) => {
      const propertyStatus = getPropertyPipelineStatus(prop);
      const propertyTags = getPropertyTags(prop);
      if (!includeRejected && isRejectedProperty(prop)) return false;
      if (statusFilter && propertyStatus !== statusFilter) return false;
      if (tagFilter && !propertyTags.includes(tagFilter)) return false;
      const area = prop.primaryListing?.city != null
        ? cityToArea(prop.primaryListing.city)
        : cityFromCanonicalAddress(prop.canonicalAddress);
      if (normalizedSearch) {
        const haystack = [
          prop.id,
          prop.canonicalAddress,
          prop.primaryListing?.city ?? null,
          area,
        ]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (areaFilter && area !== areaFilter) return false;
      const price = prop.primaryListing?.price ?? null;
      if (price != null) {
        if (parseNum(minPrice) != null && price < parseNum(minPrice)!) return false;
        if (parseNum(maxPrice) != null && price > parseNum(maxPrice)!) return false;
      } else if (minPrice.trim() || maxPrice.trim()) return false;
      const listedAt = prop.primaryListing?.listedAt ?? null;
      const listedTs = listedAt ? new Date(listedAt).getTime() : null;
      if (listedAfter && parseDate(listedAfter) != null && (listedTs == null || listedTs < parseDate(listedAfter)!)) return false;
      if (listedBefore && parseDate(listedBefore) != null && (listedTs == null || listedTs > parseDate(listedBefore)!)) return false;
      return true;
    });
    const mult = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (sortBy === "price") {
        const pa = a.primaryListing?.price ?? 0;
        const pb = b.primaryListing?.price ?? 0;
        return mult * (pa - pb);
      }
      if (sortBy === "lastActivity") {
        const ta = listingActivityTimestamp(a.primaryListing?.lastActivity ?? null);
        const tb = listingActivityTimestamp(b.primaryListing?.lastActivity ?? null);
        return mult * (ta - tb);
      }
      if (sortBy === "listedAt") {
        const ta = a.primaryListing?.listedAt ? new Date(a.primaryListing.listedAt).getTime() : 0;
        const tb = b.primaryListing?.listedAt ? new Date(b.primaryListing.listedAt).getTime() : 0;
        return mult * (ta - tb);
      }
      const areaA = a.primaryListing?.city != null ? cityToArea(a.primaryListing.city) : cityFromCanonicalAddress(a.canonicalAddress);
      const areaB = b.primaryListing?.city != null ? cityToArea(b.primaryListing.city) : cityFromCanonicalAddress(b.canonicalAddress);
      return mult * areaA.localeCompare(areaB);
    });
    return out;
  }, [canonicalProperties, normalizedSearch, areaFilter, minPrice, maxPrice, listedAfter, listedBefore, sortBy, sortDir, statusFilter, tagFilter, includeRejected]);

  const formatPrice = (n: number) =>
    n != null && !Number.isNaN(n)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
      : "—";

  const daysOnMarket = (listedAt: string | null | undefined) => {
    if (!listedAt) return null;
    const d = new Date(listedAt);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - d.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  const fullAddress = (row: ListingRow) =>
    [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ") || "—";

  const dupConfClass = (score: number | null | undefined) => {
    if (score == null) return undefined;
    const intensity = score / 100;
    return intensity >= 0.8 ? styles.dupHigh : intensity <= 0.2 ? styles.dupLow : styles.dupMid;
  };

  const dossierCellMeta = (prop: CanonicalProperty) => {
    const localJob = localDossierJobs[prop.id];
    const persisted = getPropertyDossierGeneration((prop.details ?? null) as Record<string, unknown> | null);

    if (localJob?.status === "running") {
      return {
        label: `Generating ${localJob.progressPct}%`,
        detail: localJob.stageLabel,
        tone: "info" as StatusTone,
      };
    }
    if (localJob?.status === "failed") {
      return {
        label: "Failed",
        detail: localJob.notice ?? persisted?.lastError ?? "Generation failed",
        tone: "danger" as StatusTone,
      };
    }
    if (localJob?.status === "completed") {
      return {
        label: "Complete",
        detail: "PDF + Excel saved",
        tone: "success" as StatusTone,
      };
    }
    if (persisted?.status === "running") {
      return {
        label: "Generating",
        detail: persisted.stageLabel ?? "In progress",
        tone: "info" as StatusTone,
      };
    }
    if (persisted?.status === "failed") {
      return {
        label: "Failed",
        detail: persisted.lastError ?? "Last run failed",
        tone: "danger" as StatusTone,
      };
    }
    if (persisted?.status === "completed" || prop.dealScore != null) {
      return {
        label: "Complete",
        detail: persisted?.completedAt ? formatListedDate(persisted.completedAt) : "Ready",
        tone: "success" as StatusTone,
      };
    }
    return {
      label: "Not started",
      detail: "Uses profile + property defaults",
      tone: "neutral" as StatusTone,
    };
  };

  const handleDossierJobChange = (propertyId: string, job: LocalDossierJobState | null) => {
    setLocalDossierJobs((prev) => {
      if (!job) {
        if (!(propertyId in prev)) return prev;
        const next = { ...prev };
        delete next[propertyId];
        return next;
      }
      return { ...prev, [propertyId]: job };
    });
  };

  const handleDossierNotice = (
    propertyId: string,
    notice: { type: "success" | "error"; message: string }
  ) => {
    setDossierNotice(notice);
    fetchCanonicalProperties(true);
    if (notice.type !== "success") return;
    setLocalDossierJobs((prev) => {
      const job = prev[propertyId];
      if (!job) return prev;
      return {
        ...prev,
        [propertyId]: {
          ...job,
          status: "completed",
          progressPct: 100,
          stageLabel: "Dossier ready",
          notice: notice.message,
        },
      };
    });
  };

  const propertyIdsFromWorkflowRun = (run: WorkflowBoardRun): string[] => {
    const rawIds = run.metadata?.propertyIds;
    return Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
  };

  const workflowByPropertyId = useMemo(() => {
    const map = new Map<string, WorkflowBoardRun>();
    for (const run of workflowBoard.runs) {
      if (run.status === "completed") continue;
      for (const propertyId of propertyIdsFromWorkflowRun(run)) {
        if (!map.has(propertyId)) map.set(propertyId, run);
      }
    }
    return map;
  }, [workflowBoard.runs]);

  const refreshingPropertyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of workflowBoard.runs) {
      if (run.status !== "running" && run.status !== "pending") continue;
      if (!["add_to_canonical", "rerun_enrichment", "refresh_om_financials", "rerun_rental_flow", "saved_search_ingestion"].includes(run.runType)) continue;
      for (const propertyId of propertyIdsFromWorkflowRun(run)) ids.add(propertyId);
    }
    return ids;
  }, [workflowBoard.runs]);

  const failedWorkflowPropertyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of workflowBoard.runs) {
      if (run.status !== "failed" && run.status !== "partial") continue;
      for (const propertyId of propertyIdsFromWorkflowRun(run)) ids.add(propertyId);
    }
    return ids;
  }, [workflowBoard.runs]);

  const stageSummary = useMemo(() => {
    let newCount = 0;
    let inquiryOut = 0;
    let omReceived = 0;
    let underwritingReady = 0;
    let dossierRunningCount = 0;
    let dossierReadyCount = 0;
    for (const prop of canonicalProperties) {
      const details = (prop.details ?? null) as Record<string, unknown> | null;
      const hasAuthoritativeOm = Boolean(
        details?.omData &&
        typeof details.omData === "object" &&
        (details.omData as Record<string, unknown>).authoritative &&
        typeof (details.omData as Record<string, unknown>).authoritative === "object"
      );
      const persistedDossier = getPropertyDossierGeneration(details);
      const localJob = localDossierJobs[prop.id];
      const dossierRunning = localJob?.status === "running" || persistedDossier?.status === "running";
      const dossierReady = localJob?.status === "completed" || persistedDossier?.status === "completed";
      if (prop.omStatus === "Not received") newCount++;
      if (prop.omStatus === "OM pending") inquiryOut++;
      if (prop.omStatus === "OM received" && !hasAuthoritativeOm) omReceived++;
      if (hasAuthoritativeOm || prop.dealScore != null) underwritingReady++;
      if (dossierRunning) dossierRunningCount++;
      if (dossierReady) dossierReadyCount++;
    }
    return [
      { label: "New", count: newCount, tone: "neutral" as StatCardTone },
      { label: "Inquiry out", count: inquiryOut, tone: "warning" as StatCardTone },
      { label: "OM received", count: omReceived, tone: "warning" as StatCardTone },
      { label: "Underwriting ready", count: underwritingReady, tone: "success" as StatCardTone },
      { label: "Dossier running", count: dossierRunningCount, tone: "info" as StatCardTone },
      { label: "Dossier ready", count: dossierReadyCount, tone: "success" as StatCardTone },
      { label: "Refreshing", count: refreshingPropertyIds.size, tone: "info" as StatCardTone },
      { label: "Workflow issues", count: failedWorkflowPropertyIds.size, tone: "danger" as StatCardTone },
    ];
  }, [canonicalProperties, failedWorkflowPropertyIds, localDossierJobs, refreshingPropertyIds]);

  const underwritingCellMeta = (prop: CanonicalProperty) => {
    const details = (prop.details ?? null) as Record<string, unknown> | null;
    const hasAuthoritativeOm = Boolean(
      details?.omData &&
      typeof details.omData === "object" &&
      (details.omData as Record<string, unknown>).authoritative &&
      typeof (details.omData as Record<string, unknown>).authoritative === "object"
    );
    if (refreshingPropertyIds.has(prop.id)) {
      return {
        label: "Refreshing",
        detail: "Updating inputs",
        tone: workflowStatusTone("running"),
      };
    }
    if (hasAuthoritativeOm || prop.dealScore != null) {
      return {
        label: "Ready",
        detail: prop.dealScore != null ? `Score ${prop.dealScore}` : "OM parsed",
        tone: workflowStatusTone("completed"),
      };
    }
    if (prop.omStatus === "OM received") {
      return {
        label: "OM received",
        detail: "Awaiting authoritative OM",
        tone: workflowStatusTone("partial"),
      };
    }
    if (prop.omStatus === "OM pending") {
      return {
        label: "Waiting on OM",
        detail: "Inquiry sent",
        tone: workflowStatusTone("pending"),
      };
    }
    return {
      label: "Not started",
      detail: "Needs OM",
      tone: workflowStatusTone("pending"),
    };
  };

  const omCellMeta = (prop: CanonicalProperty) => {
    if (prop.omStatus === "OM received") {
      return {
        label: "OM received",
        detail: "Document on file",
        tone: workflowStatusTone("completed"),
      };
    }
    if (prop.omStatus === "OM pending") {
      return {
        label: "Pending",
        detail: "Waiting on broker",
        tone: workflowStatusTone("partial"),
      };
    }
    return {
      label: "Not received",
      detail: "No OM yet",
      tone: workflowStatusTone("pending"),
    };
  };

  const activeRunCellMeta = (prop: CanonicalProperty) => {
    const run = workflowByPropertyId.get(prop.id);
    if (!run) {
      return {
        label: "Idle",
        detail: "No active job",
        tone: workflowStatusTone("pending"),
      };
    }
    const activeStep = run.steps.find((step) => step.status === "running" || step.status === "partial" || step.status === "failed");
    return {
      label: run.displayName,
      detail: activeStep?.label ?? workflowStatusLabel(run.status),
      tone: workflowStatusTone(run.status),
    };
  };

  const workflowDisplayColumns = useMemo(() => {
    const visibleColumns = WORKFLOW_DISPLAY_COLUMNS.filter((column) =>
      workflowBoard.runs.some((run) => run.steps.some((step) => column.stepKeys.includes(step.key)))
    );
    return visibleColumns.length > 0
      ? visibleColumns
      : WORKFLOW_DISPLAY_COLUMNS.filter((column) =>
          ["canonical", "om_financials", "inquiry", "dossier"].includes(column.key)
        );
  }, [workflowBoard.runs]);

  const formatDateTime = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const handleClearCanonicalProperties = () => {
    if (!confirm("Clear all canonical properties and their matches/enrichment data? This cannot be undone.")) return;
    setClearingCanonical(true);
    setError(null);
    fetch(`${API_BASE}/api/properties?confirm=1`, { method: "DELETE" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok && data?.error) {
          const detail = data.details ? ` — ${data.details}` : "";
          throw new Error(data.error + detail);
        }
        if (data?.error) throw new Error(data.error);
        fetchCanonicalProperties();
        fetchPipelineStats(true);
        fetchWorkflowBoard();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to clear canonical properties"))
      .finally(() => setClearingCanonical(false));
  };

  const handleDeleteSelectedCanonicalProperties = () => {
    if (selectedCanonicalIds.size === 0 || deletingCanonical) return;
    const propertyIds = Array.from(selectedCanonicalIds);
    const selectedProperties = canonicalProperties.filter((property) => selectedCanonicalIds.has(property.id));
    const propertyLabel =
      selectedProperties.length === 1
        ? selectedProperties[0]?.canonicalAddress ?? "this property"
        : `${selectedProperties.length} selected canonical properties`;
    const confirmed = confirm(
      `Delete ${propertyLabel}? This removes the canonical record, OM workspace links, generated documents, enrichment data, saved-deal links, and match records. Raw listings will remain. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingCanonical(true);
    setError(null);
    Promise.all(
      propertyIds.map((propertyId) =>
        fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}?confirm=1`, { method: "DELETE" })
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok || data?.error) {
              const detail = typeof data?.details === "string" ? ` — ${data.details}` : "";
              throw new Error((typeof data?.error === "string" ? data.error : `Delete failed (${r.status})`) + detail);
            }
            return data;
          })
      )
    )
      .then(() => {
        const deletedIds = new Set(propertyIds);
        setCanonicalProperties((prev) => prev.filter((property) => !deletedIds.has(property.id)));
        setSelectedCanonicalIds(new Set());
        setSavedPropertyIds((prev) => {
          const next = new Set(prev);
          deletedIds.forEach((id) => next.delete(id));
          return next;
        });
        setLocalDossierJobs((prev) => {
          const next = { ...prev };
          deletedIds.forEach((id) => delete next[id]);
          return next;
        });
        setExpandedCanonicalId((current) => (current && deletedIds.has(current) ? null : current));
        fetchPipelineStats(true);
        fetchWorkflowBoard();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to delete canonical property"))
      .finally(() => setDeletingCanonical(false));
  };

  const refreshPropertyPipelineUi = () => {
    fetchCanonicalProperties(true);
    fetchPipelineStats(true);
    fetchWorkflowBoard();
  };

  const handleAddPropertyTag = async (propertyId: string, tag: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error((data?.details || data?.error || "Failed to add tag") as string);
      refreshPropertyPipelineUi();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add property tag");
    }
  };

  const handleRejectSelectedCanonicalProperties = () => {
    if (selectedCanonicalIds.size === 0 || deletingCanonical) return;
    const propertyIds = Array.from(selectedCanonicalIds);
    const reason = prompt("Optional rejection reason (examples: too expensive, wrong location, regulatory risk):") ?? "";
    const confirmed = confirm(`Reject/remove ${propertyIds.length} selected propert${propertyIds.length === 1 ? "y" : "ies"} from the active pipeline? History and documents will be preserved.`);
    if (!confirmed) return;

    setDeletingCanonical(true);
    setError(null);
    Promise.all(
      propertyIds.map((propertyId) =>
        fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }).then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok || data?.error) throw new Error((data?.details || data?.error || "Reject failed") as string);
          return data;
        })
      )
    )
      .then(() => {
        setSelectedCanonicalIds(new Set());
        setExpandedCanonicalId((current) => (current && propertyIds.includes(current) ? null : current));
        refreshPropertyPipelineUi();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to reject selected properties"))
      .finally(() => setDeletingCanonical(false));
  };

  const searchParams = useSearchParams();
  const sentMessage = searchParams.get("sent");

  const openReviewDup = () => {
    setReviewDupOpen(true);
    setLoadingDup(true);
    setDuplicateCandidates([]);
    fetch(`${API_BASE}/api/listings/duplicate-candidates?threshold=80`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDuplicateCandidates(data.listings ?? []);
      })
      .catch(() => setDuplicateCandidates([]))
      .finally(() => setLoadingDup(false));
  };

  const handleDeleteListing = (id: string) => {
    if (!confirm("Remove this raw listing? Snapshots will be deleted. This cannot be undone.")) return;
    setDeletingId(id);
    fetch(`${API_BASE}/api/listings/${id}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDuplicateCandidates((prev) => prev.filter((l) => l.id !== id));
        fetchListings();
      })
      .catch((e) => setError(e.message || "Failed to delete"))
      .finally(() => setDeletingId(null));
  };

  const handleSendToCanonical = () => {
    const toSend = selectedListingIds.size > 0 ? selectedListingIds.size : total;
    if (toSend === 0) return;
    const message =
      selectedListingIds.size > 0
        ? `Create canonical properties from ${selectedListingIds.size} selected listing(s) and run enrichment?`
        : `Create canonical properties from all ${total} raw listing(s) and link them?`;
    if (!confirm(message)) return;
    setSendingToCanonical(true);
    setError(null);
    setLastEnrichmentResult(null);
    setPipelineStatsOpen(true);
    fetchWorkflowBoard();
    const banner = processBanner.start("Send to canonical", {
      message: `Creating canonical properties from ${toSend} listing${toSend === 1 ? "" : "s"} and running enrichment…`,
      estimateKind: "send-to-canonical",
      estimateItems: toSend,
    });
    const body =
      selectedListingIds.size > 0
        ? { listingIds: Array.from(selectedListingIds) }
        : undefined;
    fetch(`${API_BASE}/api/properties/from-listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (data.permitEnrichment?.ran && data.permitEnrichment.byModule) {
          setLastEnrichmentResult({
            ran: true,
            success: data.permitEnrichment.success ?? 0,
            failed: data.permitEnrichment.failed ?? 0,
            byModule: data.permitEnrichment.byModule ?? {},
            rentalFlow: data.rentalFlow,
          });
        } else if (data.rentalFlow?.ran) {
          setLastEnrichmentResult({
            ran: true,
            success: 0,
            failed: 0,
            byModule: {},
            rentalFlow: data.rentalFlow,
          });
        }
        banner.succeed(
          `Canonical properties created from ${toSend} listing${toSend === 1 ? "" : "s"} — enrichment finished.`
        );
        setSelectedListingIds(new Set());
        fetchCanonicalProperties();
        fetchPipelineStats(true);
        fetchWorkflowBoard();
        setActiveTab("canonical");
      })
      .catch((e) => {
        const message = e instanceof Error && e.message ? e.message : "Failed to send to canonical";
        banner.fail(message);
        setError(message);
      })
      .finally(() => setSendingToCanonical(false));
  };

  const handleManualAddProperty = async () => {
    const streetEasyInputs = manualAddDraft.streetEasyInput
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const omUrl = manualAddDraft.omUrl.trim();
    if (streetEasyInputs.length === 0) {
      setManualAddError("At least one StreetEasy URL or sale ID is required.");
      return;
    }
    if (streetEasyInputs.length > 1 && omUrl) {
      setManualAddError("OM URL can only be used when adding one StreetEasy listing at a time.");
      return;
    }

    setManualAddSubmitting(true);
    setManualAddError(null);
    setError(null);
    const banner = processBanner.start("Manual property add", {
      message: `Importing ${streetEasyInputs.length} StreetEasy listing${streetEasyInputs.length === 1 ? "" : "s"}…`,
      estimateKind: "manual-property-add",
      estimateItems: streetEasyInputs.length,
    });
    try {
      const results: ManualAddResponse[] = [];
      const failures: string[] = [];
      for (const [inputIndex, streetEasyInput] of streetEasyInputs.entries()) {
        banner.update(
          `Importing ${inputIndex + 1} of ${streetEasyInputs.length}: ${streetEasyInput}`,
          Math.round((inputIndex / streetEasyInputs.length) * 100)
        );
        const isSaleId = /^\d+$/.test(streetEasyInput);
        const res = await fetch(`${API_BASE}/api/properties/manual-add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            streetEasyUrl: isSaleId ? null : streetEasyInput,
            streetEasySaleId: isSaleId ? streetEasyInput : null,
            omUrl: omUrl || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : `Request failed (${res.status})`;
        if (!res.ok || data?.error) {
          failures.push(`${streetEasyInput}: ${message}`);
          continue;
        }
        results.push(data as ManualAddResponse);
      }

      if (results.length === 0) {
        throw new Error(failures[0] ?? "Failed to add StreetEasy listings.");
      }

      const payload = results[results.length - 1]!;
      const singleOmWarning = results.length === 1 ? payload.omImport?.warning?.trim() || "" : "";
      const omMessage =
        results.length === 1 && payload.omImport?.imported && payload.omImport?.fileName
          ? ` OM saved as ${payload.omImport.fileName}.`
          : results.length === 1 && payload.omImport?.requested && singleOmWarning
            ? ` StreetEasy import succeeded, but OM import needs attention: ${singleOmWarning}`
            : "";
      const enrichmentWarning = results.length === 1 ? payload.enrichment?.warning?.trim() || "" : "";
      const enrichmentMessage =
        results.length === 1 && payload.enrichment?.attempted
          ? payload.enrichment.ok
            ? ` Enrichment ran${payload.enrichment.bbl ? ` (BBL ${payload.enrichment.bbl})` : ""}.`
            : ` Enrichment needs attention: ${enrichmentWarning || "one or more modules failed."}`
          : "";
      const idFetchCount = results.filter((result) => result.saleDetailsFetch?.method === "id").length;
      const fallbackWarnings = results
        .map((result) => result.saleDetailsFetch?.warning?.trim())
        .filter((warning): warning is string => Boolean(warning));
      const batchMessage =
        results.length === 1
          ? `Added ${payload.canonicalAddress}.`
          : `Added ${results.length} StreetEasy listings${idFetchCount > 0 ? ` (${idFetchCount} via sale ID lookup)` : ""}.`;
      const failureMessage =
        failures.length > 0
          ? ` ${failures.length} failed: ${failures.slice(0, 2).join(" | ")}${failures.length > 2 ? " ..." : ""}`
          : "";
      const warningMessage =
        fallbackWarnings.length > 0
          ? ` ${fallbackWarnings.length} used URL fallback after ID lookup failed.`
          : "";
      const noticeMessage = `${batchMessage}${omMessage}${enrichmentMessage}${warningMessage}${failureMessage}`.trim();
      setManualAddNotice({
        type:
          failures.length > 0 ||
          (payload.omImport?.requested && !payload.omImport?.imported && singleOmWarning) ||
          (payload.enrichment?.attempted && !payload.enrichment?.ok)
            ? "error"
            : "success",
        message: noticeMessage,
      });
      if (failures.length > 0) {
        banner.fail(noticeMessage);
      } else {
        banner.succeed(noticeMessage);
      }
      setManualAddDraft({ streetEasyInput: "", omUrl: "" });
      setManualAddModalOpen(false);
      setActiveTab("canonical");
      setExpandedCanonicalId(payload.propertyId);
      fetchListings();
      fetchCanonicalProperties();
      fetchPipelineStats(true);
      fetchWorkflowBoard();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add property.";
      banner.fail(message);
      setManualAddError(message);
    } finally {
      setManualAddSubmitting(false);
    }
  };

  const toggleListingSelection = (id: string) => {
    setSelectedListingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCanonicalSelection = (id: string) => {
    setSelectedCanonicalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllListings = () => {
    setSelectedListingIds(new Set(filteredSortedListings.map((r) => r.id)));
  };

  const clearListingSelection = () => {
    setSelectedListingIds(new Set());
  };

  const selectAllCanonical = () => {
    setSelectedCanonicalIds(new Set(filteredSortedCanonical.map((property) => property.id)));
  };

  const clearCanonicalSelection = () => {
    setSelectedCanonicalIds(new Set());
  };

  const handleRerunEnrichment = () => {
    if (selectedCanonicalIds.size === 0) return;
    const propertyIds = Array.from(selectedCanonicalIds);
    if (!confirm(`Re-run enrichment for ${propertyIds.length} selected canonical propert${propertyIds.length === 1 ? "y" : "ies"}? This will refresh data from NYC Open Data (BBL is assumed already set).`)) return;
    setRerunningEnrichment(true);
    setError(null);
    setLastEnrichmentResult(null);
    setPipelineStatsOpen(true);
    fetchWorkflowBoard();
    const banner = processBanner.start("Enrichment refresh", {
      message: `Refreshing NYC Open Data for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}…`,
      estimateKind: "enrichment-refresh",
      estimateItems: propertyIds.length,
    });
    fetch(`${API_BASE}/api/properties/run-enrichment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds }),
    })
      .then(async (r) => {
        const text = await r.text();
        let data: {
          error?: string;
          permitEnrichment?: { ran?: boolean; success?: number; failed?: number; byModule?: Record<string, number> };
          omFinancialsRefresh?: { documentsProcessed?: number; documentsSkippedNoFile?: number };
        };
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          if (text.trimStart().startsWith("<")) {
            throw new Error(`Server returned an HTML error page (${r.status}). Check that the API is running and the API URL is correct.`);
          }
          throw new Error(`Server returned invalid JSON (${r.status}). Check API logs.`);
        }
        if (!r.ok && data?.error) throw new Error(data.error);
        if (!r.ok) throw new Error(r.statusText || `Request failed (${r.status})`);
        return data;
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (data.permitEnrichment?.ran && data.permitEnrichment.byModule) {
          setLastEnrichmentResult({
            ran: true,
            success: data.permitEnrichment.success ?? 0,
            failed: data.permitEnrichment.failed ?? 0,
            byModule: data.permitEnrichment.byModule ?? {},
            omFinancialsProcessed: data.omFinancialsRefresh?.documentsProcessed,
            omFinancialsSkippedNoFile: data.omFinancialsRefresh?.documentsSkippedNoFile,
          });
        }
        const success = data.permitEnrichment?.success ?? 0;
        const failed = data.permitEnrichment?.failed ?? 0;
        if (failed > 0) {
          banner.fail(`Enrichment refreshed — ${success} succeeded, ${failed} failed.`);
        } else {
          banner.succeed(
            data.permitEnrichment?.ran
              ? `Enrichment refreshed for ${success} propert${success === 1 ? "y" : "ies"}.`
              : "Enrichment refresh completed."
          );
        }
        fetchCanonicalProperties();
        fetchPipelineStats(true);
        fetchWorkflowBoard();
      })
      .catch((e) => {
        const message = e instanceof Error && e.message ? e.message : "Failed to re-run enrichment";
        banner.fail(message);
        setError(message);
      })
      .finally(() => setRerunningEnrichment(false));
  };

  const handleRunRentalFlow = () => {
    if (selectedCanonicalIds.size === 0) return;
    const propertyIds = Array.from(selectedCanonicalIds);
    if (!confirm(`Run rental flow (RapidAPI + LLM) for ${propertyIds.length} selected canonical propert${propertyIds.length === 1 ? "y" : "ies"}? This fetches rental data by URL and extracts financials from listing text.`)) return;
    setRunningRentalFlow(true);
    setError(null);
    fetchWorkflowBoard();
    const banner = processBanner.start("Rental flow refresh", {
      message: `Fetching rental data + LLM financials for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}…`,
      estimateKind: "rental-flow-refresh",
      estimateItems: propertyIds.length,
    });
    fetch(`${API_BASE}/api/properties/run-rental-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        fetchCanonicalProperties();
        fetchWorkflowBoard();
        const withUnits = (data.results ?? []).filter((r: { rentalUnitsCount?: number }) => (r.rentalUnitsCount ?? 0) > 0).length;
        const withLlm = (data.results ?? []).filter((r: { hasLlmFinancials?: boolean }) => r.hasLlmFinancials).length;
        banner.succeed(
          `${withUnits} propert${withUnits === 1 ? "y" : "ies"} with rental units; ${withLlm} with LLM financials.`
        );
      })
      .catch((e) => {
        const message = e instanceof Error && e.message ? e.message : "Run rental flow failed";
        banner.fail(message);
        setError(message);
      })
      .finally(() => setRunningRentalFlow(false));
  };

  const handleSendBulkInquiryEmails = () => {
    if (selectedCanonicalIds.size === 0 || bulkInquirySending) return;
    const propertyIds = Array.from(selectedCanonicalIds);
    const confirmed = confirm(
      `Send inquiry emails for ${propertyIds.length} selected canonical propert${propertyIds.length === 1 ? "y" : "ies"}? `
      + "This uses a manually saved email first, then the first available broker email from listing order, and skips properties blocked by OM/inquiry guardrails."
    );
    if (!confirmed) return;
    setBulkInquirySending(true);
    setBulkInquiryResult(null);
    setError(null);
    fetchWorkflowBoard();
    fetch(`${API_BASE}/api/properties/send-bulk-inquiry-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        const message =
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : `Request failed (${r.status})`;
        if (!r.ok || data?.error) throw new Error(message);
        return data as BulkInquirySendResponse;
      })
      .then((data) => {
        setBulkInquiryResult(data);
        fetchCanonicalProperties(true);
        fetchWorkflowBoard();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to send inquiry emails"))
      .finally(() => setBulkInquirySending(false));
  };

  const allSelected = filteredSortedListings.length > 0 && filteredSortedListings.every((l) => selectedListingIds.has(l.id));
  const someSelected = selectedListingIds.size > 0;
  const allCanonicalSelected =
    filteredSortedCanonical.length > 0 &&
    filteredSortedCanonical.every((property) => selectedCanonicalIds.has(property.id));
  const someCanonicalSelected = selectedCanonicalIds.size > 0;

  useEffect(() => {
    const el = selectAllRawCheckboxRef.current;
    if (el) el.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  useEffect(() => {
    const el = selectAllCanonicalCheckboxRef.current;
    if (el) el.indeterminate = someCanonicalSelected && !allCanonicalSelected;
  }, [someCanonicalSelected, allCanonicalSelected]);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Property pipeline"
        title="Property Data"
        subtitle={
          <>
            {canonicalProperties.length} canonical propert{canonicalProperties.length === 1 ? "y" : "ies"} · {total} raw listing{total === 1 ? "" : "s"}
          </>
        }
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setManualAddError(null);
                setManualAddModalOpen(true);
              }}
            >
              Add missed property
            </Button>
            <Link href="/runs" className={styles.linkButton}>
              Saved searches
            </Link>
          </>
        }
      />
      {sentMessage && (
        <div className={cx(styles.notice, styles.noticeSuccess)}>
          {decodeURIComponent(sentMessage)}
        </div>
      )}
      {manualAddNotice && (
        <div
          className={cx(
            styles.notice,
            manualAddNotice.type === "success" ? styles.noticeSuccess : styles.noticeWarning
          )}
        >
          {manualAddNotice.message}
        </div>
      )}
      {bulkInquiryResult && (
        <div
          className={cx(
            styles.resultCard,
            bulkInquiryResult.failed > 0
              ? styles.resultCardDanger
              : bulkInquiryResult.skipped > 0
                ? styles.resultCardWarning
                : styles.resultCardSuccess
          )}
        >
          <div className={styles.resultHead}>
            <div>
              <div className={styles.resultTitle}>
                <Mail size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
                Bulk broker email run
              </div>
              <div className={styles.resultMeta}>
                {bulkInquiryResult.sent} sent, {bulkInquiryResult.skipped} skipped, {bulkInquiryResult.failed} failed
              </div>
            </div>
            <Button variant="secondary" onClick={() => setBulkInquiryResult(null)}>
              Dismiss
            </Button>
          </div>
          {bulkInquiryResult.results.length > 0 && (
            <div className={styles.resultTableScroll}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Status</th>
                    <th>Recipient</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkInquiryResult.results.map((row) => (
                    <tr key={`${row.propertyId}-${row.status}-${row.toAddress ?? "no-email"}`}>
                      <td>{row.canonicalAddress}</td>
                      <td>
                        <StatusChip
                          label={row.status === "sent" ? "Sent" : row.status === "skipped" ? "Skipped" : "Failed"}
                          tone={workflowStatusTone(
                            row.status === "sent" ? "completed" : row.status === "skipped" ? "partial" : "failed"
                          )}
                          className={styles.statusChipCompact}
                        />
                      </td>
                      <td>
                        <div>{row.toAddress || "—"}</div>
                        <div className={styles.cellSub}>
                          {formatBulkInquiryRecipientSource(row.recipientSource)}
                        </div>
                      </td>
                      <td className={row.status === "failed" ? styles.noteDanger : styles.noteMuted}>
                        {row.status === "sent"
                          ? `Sent ${row.sentAt ? formatDateTime(row.sentAt) : "just now"}`
                          : row.reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className={styles.searchRow}>
        <input
          type="search"
          placeholder="Search by address, property ID, listing ID, or area"
          className={styles.searchInput}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search properties"
        />
      </div>

      <div className={styles.tabsRow}>
        <div className={styles.tabs} aria-label="Property data sections">
          <button
            type="button"
            className={cx(styles.tab, activeTab === "canonical" && styles.tabActive)}
            onClick={() => setActiveTab("canonical")}
          >
            Canonical properties
          </button>
          <button
            type="button"
            className={cx(styles.tab, activeTab === "raw" && styles.tabActive)}
            onClick={() => setActiveTab("raw")}
          >
            Raw listings
          </button>
          <Link
            href="/om-review"
            className={cx(styles.tab, styles.tabLink)}
            title="Review ambiguous OM, rent roll, T12, or broker-email documents before promotion"
          >
            Document review queue
          </Link>
        </div>
        <div className={styles.filters}>
          <label className={styles.filterLabel}>
            <span className={styles.filterName}>Sort by</span>
            <select
              className={styles.filterSelect}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "price" | "listedAt" | "lastActivity" | "area")}
              aria-label="Sort by"
            >
              <option value="price">Price</option>
              <option value="lastActivity">Last activity</option>
              <option value="listedAt">Listed date</option>
              <option value="area">Area</option>
            </select>
          </label>
          <label className={styles.filterLabel}>
            <span className={styles.filterName}>Direction</span>
            <select
              className={styles.filterSelect}
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              aria-label="Sort direction"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <label className={styles.filterLabel}>
            <span className={styles.filterName}>Area</span>
            <select
              className={styles.filterSelect}
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              aria-label="Filter by area"
            >
              {AREA_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          {activeTab === "canonical" && (
            <>
              <label className={styles.filterLabel}>
                <span className={styles.filterName}>Stage</span>
                <select
                  className={styles.filterSelect}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by property stage"
                >
                  <option value="">All stages</option>
                  {PROPERTY_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{labelFromKey(status)}</option>
                  ))}
                </select>
              </label>
              <label className={styles.filterLabel}>
                <span className={styles.filterName}>Tag</span>
                <select
                  className={styles.filterSelect}
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  aria-label="Filter by property tag"
                >
                  <option value="">All tags</option>
                  {availablePropertyTags.map((tag) => (
                    <option key={tag} value={tag}>{labelFromKey(tag)}</option>
                  ))}
                </select>
              </label>
              <label className={cx(styles.filterLabel, styles.filterCheckbox)}>
                <input
                  type="checkbox"
                  checked={includeRejected}
                  onChange={(e) => setIncludeRejected(e.target.checked)}
                />
                <span>Include rejected</span>
              </label>
            </>
          )}
          <label className={styles.filterLabel}>
            <span className={styles.filterName}>Min price</span>
            <input
              type="text"
              className={styles.priceInput}
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              aria-label="Minimum price"
            />
          </label>
          <label className={styles.filterLabel}>
            <span className={styles.filterName}>Max price</span>
            <input
              type="text"
              className={styles.priceInput}
              placeholder="Max"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              aria-label="Maximum price"
            />
          </label>
          <label className={styles.filterLabel}>
            <span className={styles.filterName}>Listed after</span>
            <input
              type="date"
              className={styles.dateInput}
              value={listedAfter}
              onChange={(e) => setListedAfter(e.target.value)}
              aria-label="Listed after date"
            />
          </label>
          <label className={styles.filterLabel}>
            <span className={styles.filterName}>Listed before</span>
            <input
              type="date"
              className={styles.dateInput}
              value={listedBefore}
              onChange={(e) => setListedBefore(e.target.value)}
              aria-label="Listed before date"
            />
          </label>
        </div>
      </div>

      <div className={styles.content}>
        {activeTab === "raw" && loading && (
          <div
            className={styles.loadingBanner}
            role="status"
            aria-live="polite"
          >
            <span className={styles.bannerText}>
              Loading raw listings — broker &amp; price history may still be populating.
            </span>
            <span className={styles.bannerTimer}>
              {formatElapsed(enrichmentTimerSeconds)}
            </span>
          </div>
        )}
        <div className={styles.tableWrap}>
          {error && (
            <div className={styles.errorBanner}>
              {error}
            </div>
          )}
          {dossierNotice && (
            <div
              className={cx(
                styles.notice,
                styles.noticeInset,
                dossierNotice.type === "success" ? styles.noticeSuccess : styles.noticeDanger
              )}
            >
              {dossierNotice.message}
            </div>
          )}
          {loading && activeTab === "raw" && (
            <div className={styles.loadingPad}>
              <SkeletonRows count={6} />
            </div>
          )}
          {activeTab === "canonical" && (
            <>
              {loadingCanonical ? (
                <div className={styles.loadingPad}>
                  <SkeletonRows count={6} />
                </div>
              ) : (
                <table className={cx(styles.dataTable, styles.tableRows)}>
                  <thead>
                    <tr>
                      <th className={styles.expandCol} aria-label="Expand row" />
                      <th className={styles.checkboxCol} aria-label="Select property">
                        {filteredSortedCanonical.length > 0 && (
                          <input
                            type="checkbox"
                            ref={selectAllCanonicalCheckboxRef}
                            checked={allCanonicalSelected}
                            onChange={() => (allCanonicalSelected ? clearCanonicalSelection() : selectAllCanonical())}
                            aria-label={allCanonicalSelected ? "Clear property selection" : "Select all visible properties"}
                            title={allCanonicalSelected ? "Clear property selection" : "Select all visible properties"}
                          />
                        )}
                      </th>
                      <th className={styles.saveCol} aria-label="Save deal" title="Save / Unsave deal" />
                      <th>Property</th>
                      <th>Activity</th>
                      <th>Latest status</th>
                      <th>OM</th>
                      <th>Active run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSortedCanonical.length === 0 ? (
                      <tr>
                        <td colSpan={8} className={styles.emptyCell}>
                          <EmptyState
                            title={canonicalProperties.length === 0
                              ? "No canonical properties yet. Send raw listings to canonical properties from the raw listings tab."
                              : "No properties match the current filters."}
                          />
                        </td>
                      </tr>
                    ) : (
                      filteredSortedCanonical.map((prop) => {
                        const omMeta = omCellMeta(prop);
                        const activeRunMeta = activeRunCellMeta(prop);
                        const sourcingUpdateMeta = getSourcingUpdateMeta(prop.details ?? null);
                        const pipelineStatus = getPropertyPipelineStatus(prop);
                        const propertyTags = getPropertyTags(prop);
                        const missingFields = getPropertyMissingFields(prop);
                        const hasTouredTag = propertyTags.includes("property_toured");
                        const listingBrokerEmail =
                          prop.listingAgentEnrichment?.find((entry) => typeof entry.email === "string" && entry.email.trim().length > 0)?.email?.trim()
                          ?? null;
                        const quickInquiryEmail = prop.recipientContactEmail?.trim() || listingBrokerEmail;
                        const canOpenInquiryComposer = Boolean(
                          quickInquiryEmail &&
                          !prop.lastInquirySentAt &&
                          prop.omStatus === "Not received"
                        );
                        const priceReductionSummary = formatPriceReductionSummary(prop.primaryListing?.lastActivity ?? null);
                        const propertyMeta = joinCompact([
                          prop.primaryListing?.price != null ? formatPrice(prop.primaryListing.price) : null,
                          prop.primaryListing?.listedAt ? `Listed ${formatListedDate(prop.primaryListing.listedAt)}` : null,
                        ]);
                        const activityLabel = formatActivitySummary(
                          prop.primaryListing?.lastActivity ?? null,
                          prop.primaryListing?.listedAt ?? null
                        );
                        return (
                          <React.Fragment key={prop.id}>
                            <tr
                              className={styles.rowClickable}
                              onClick={() => setExpandedCanonicalId((id) => (id === prop.id ? null : prop.id))}
                            >
                              <td className={styles.expandCol}>
                                <button
                                  type="button"
                                  className={styles.expandBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedCanonicalId((id) => (id === prop.id ? null : prop.id));
                                  }}
                                  aria-expanded={expandedCanonicalId === prop.id}
                                >
                                  <span className={cx(styles.chevron, expandedCanonicalId === prop.id && styles.chevronOpen)}>▼</span>
                                </button>
                              </td>
                              <td className={styles.checkboxCol} onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedCanonicalIds.has(prop.id)}
                                  onChange={() => toggleCanonicalSelection(prop.id)}
                                  aria-label={`Select ${prop.canonicalAddress}`}
                                />
                              </td>
                              <td className={styles.saveCell}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (savedDealsLoading.has(prop.id)) return;
                                    const isSaved = savedPropertyIds.has(prop.id);
                                    setSavedDealsLoading((prev) => new Set(prev).add(prop.id));
                                    const url = `${API_BASE}/api/profile/saved-deals`;
                                    (isSaved
                                      ? fetch(`${url}/${encodeURIComponent(prop.id)}`, { method: "DELETE" })
                                      : fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: prop.id }) })
                                    )
                                      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
                                      .then(({ ok }) => {
                                        if (!ok) return;
                                        setSavedPropertyIds((prev) => {
                                          const next = new Set(prev);
                                          if (isSaved) next.delete(prop.id);
                                          else next.add(prop.id);
                                          return next;
                                        });
                                      })
                                      .catch(() => {})
                                      .finally(() => setSavedDealsLoading((prev) => { const n = new Set(prev); n.delete(prop.id); return n; }));
                                  }}
                                  title={savedPropertyIds.has(prop.id) ? "Unsave deal" : "Save deal"}
                                  className={styles.starButton}
                                  aria-label={savedPropertyIds.has(prop.id) ? "Unsave deal" : "Save deal"}
                                >
                                  {savedPropertyIds.has(prop.id) ? "★" : "☆"}
                                </button>
                              </td>
                              <td className={styles.cellPrimary}>
                                <div className={styles.cellTitle}>{prop.canonicalAddress}</div>
                                <div className={styles.cellMeta}>{propertyMeta || "No listing summary yet"}</div>
                                {priceReductionSummary ? (
                                  <div className={cx(styles.cellMeta, styles.priceCut)}>
                                    {priceReductionSummary}
                                  </div>
                                ) : null}
                                <div className={styles.chipRow} aria-label="Pipeline status, tags, and missing information">
                                  <span className={`property-mini-chip property-mini-chip--stage ${pipelineStatus === "rejected_removed" ? "property-mini-chip--danger" : ""}`}>
                                    {labelFromKey(pipelineStatus)}
                                  </span>
                                  {propertyTags.slice(0, 3).map((tag) => (
                                    <span key={tag} className="property-mini-chip property-mini-chip--tag">{labelFromKey(tag)}</span>
                                  ))}
                                  {propertyTags.length > 3 ? (
                                    <span className="property-mini-chip property-mini-chip--muted">+{propertyTags.length - 3} tags</span>
                                  ) : null}
                                  {missingFields.slice(0, 3).map((field) => (
                                    <span key={field} className="property-mini-chip property-mini-chip--missing">{labelFromKey(field)}</span>
                                  ))}
                                  {missingFields.length > 3 ? (
                                    <span className="property-mini-chip property-mini-chip--missing">+{missingFields.length - 3} missing</span>
                                  ) : null}
                                </div>
                                <div className={styles.pillRow}>
                                  <Link
                                    href={`/deal-analysis?property_id=${encodeURIComponent(prop.id)}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className={styles.pillLink}
                                  >
                                    OM workspace
                                  </Link>
                                  {!hasTouredTag ? (
                                    <button
                                      type="button"
                                      className={styles.pillBrand}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleAddPropertyTag(prop.id, "property_toured");
                                      }}
                                      title="Mark this property as toured"
                                    >
                                      Mark toured
                                    </button>
                                  ) : null}
                                  {canOpenInquiryComposer ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedCanonicalId(prop.id);
                                        setInquiryComposerRequest({ propertyId: prop.id, nonce: Date.now() });
                                      }}
                                      className={styles.pillNeutral}
                                      title={`Open inquiry draft for ${quickInquiryEmail}`}
                                    >
                                      Request info / OM
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <div
                                  className={styles.cellTitle}
                                  title={describeListingActivity(prop.primaryListing?.lastActivity ?? null) ?? undefined}
                                >
                                  {activityLabel}
                                </div>
                              </td>
                              <td>
                                <StatusChip
                                  label={sourcingUpdateMeta.label}
                                  detail={sourcingUpdateMeta.detail}
                                  tone={sourcingUpdateTone(prop.details ?? null)}
                                />
                              </td>
                              <td>
                                <StatusChip label={omMeta.label} detail={omMeta.detail} tone={omMeta.tone} />
                              </td>
                              <td>
                                <StatusChip
                                  label={activeRunMeta.label}
                                  detail={activeRunMeta.detail}
                                  tone={activeRunMeta.tone}
                                />
                              </td>
                            </tr>
                            {expandedCanonicalId === prop.id && (
                              <tr className={styles.detailRow}>
                                <td colSpan={8} className={styles.detailCell}>
                                  <CanonicalPropertyDetail
                                    property={prop}
                                    isSaved={savedPropertyIds.has(prop.id)}
                                    dossierJob={localDossierJobs[prop.id]}
                                    onDossierJobChange={handleDossierJobChange}
                                    onDossierNotice={handleDossierNotice}
                                    onRefreshPropertyData={() => fetchCanonicalProperties(true)}
                                    onWorkflowActivity={fetchWorkflowBoard}
                                    autoOpenInquiryComposerNonce={inquiryComposerRequest?.propertyId === prop.id ? inquiryComposerRequest.nonce : null}
                                    onSavedChange={(propertyId, saved) => {
                                      if (saved) setSavedPropertyIds((prev) => new Set(prev).add(propertyId));
                                      else setSavedPropertyIds((prev) => {
                                        const next = new Set(prev);
                                        next.delete(propertyId);
                                        return next;
                                      });
                                    }}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </>
          )}
          {activeTab === "raw" && !loading && (
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th className={styles.expandCol} aria-label="Expand row" />
                  <th className={styles.checkboxCol} aria-label="Select for canonical">
                    {filteredSortedListings.length > 0 && (
                      <input
                        type="checkbox"
                        ref={selectAllRawCheckboxRef}
                        checked={allSelected}
                        onChange={() => (allSelected ? clearListingSelection() : selectAllListings())}
                        aria-label={allSelected ? "Clear selection" : "Select all"}
                        title={allSelected ? "Clear selection" : "Select all"}
                      />
                    )}
                  </th>
                  <th>Listing ID</th>
                  <th>Source</th>
                  <th>Raw Address</th>
                  <th className={styles.cellNum}>Price</th>
                  <th>Last activity</th>
                  <th>Listed date</th>
                  <th className={styles.cellNum}>Days on market</th>
                  <th className={styles.cellNum}>Dup. Conf.</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredSortedListings.length === 0 ? (
                  <tr>
                    <td colSpan={11} className={styles.emptyCell}>
                      <EmptyState
                        title={listings.length === 0
                          ? "No raw listings yet. Run a flow from Sourcing Agent, then use \"Send to property data\" for a completed run."
                          : "No listings match the current filters."}
                      />
                    </td>
                  </tr>
                ) : (
                  filteredSortedListings.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr
                        className={cx(styles.rowClickable, selectedId === row.id && styles.rowSelected)}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td className={styles.expandCol}>
                          <button
                            type="button"
                            className={styles.expandBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRowId((id) => (id === row.id ? null : row.id));
                            }}
                            aria-expanded={expandedRowId === row.id}
                            aria-label={expandedRowId === row.id ? "Collapse row" : "Expand row"}
                          >
                            <span className={cx(styles.chevron, expandedRowId === row.id && styles.chevronOpen)}>
                              ▼
                            </span>
                          </button>
                        </td>
                        <td className={styles.checkboxCol} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedListingIds.has(row.id)}
                            onChange={() => toggleListingSelection(row.id)}
                            aria-label={`Select ${fullAddress(row)} for canonical`}
                          />
                        </td>
                        <td>{row.externalId}</td>
                        <td>{row.source === "streeteasy" ? "Streeteasy" : row.source}</td>
                        <td>{fullAddress(row)}</td>
                        <td className={styles.cellNum}>{formatPrice(row.price)}</td>
                        <td title={describeListingActivity(row.lastActivity ?? deriveListingActivitySummary({
                          listedAt: row.listedAt ?? null,
                          currentPrice: row.price ?? null,
                          priceHistory: row.priceHistory ?? null,
                        })) ?? undefined}>
                          {formatActivitySummary(row.lastActivity ?? deriveListingActivitySummary({
                            listedAt: row.listedAt ?? null,
                            currentPrice: row.price ?? null,
                            priceHistory: row.priceHistory ?? null,
                          }), row.listedAt ?? null)}
                        </td>
                        <td>{formatListedDate(row.listedAt)}</td>
                        <td className={styles.cellNum}>{daysOnMarket(row.listedAt) != null ? `${daysOnMarket(row.listedAt)} days` : "—"}</td>
                        <td className={cx(styles.cellNum, dupConfClass(row.duplicateScore))} title="Duplicate likelihood (100 = likely duplicate)">
                          {row.duplicateScore != null ? row.duplicateScore : "—"}
                        </td>
                        <td>
                          {row.url && row.url !== "#" ? (
                            <a href={row.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              view source
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                      {expandedRowId === row.id && (
                        <tr key={`${row.id}-detail`} className={styles.detailRow}>
                          <td colSpan={11} className={styles.detailCell}>
                            <PropertyDetailCollapsible listing={row} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {((activeTab === "canonical" && expandedCanonicalId) || (activeTab === "raw" && selectedId)) ? null : (
      <div className={styles.bottomBar}>
        <span className={styles.bottomLabel}>
          {activeTab === "raw"
            ? total > 0
              ? someSelected
                ? `${selectedListingIds.size} of ${filteredSortedListings.length} selected`
                : filteredSortedListings.length < total
                  ? `${filteredSortedListings.length} of ${total} raw listing(s)`
                  : `${total} raw listing(s)`
              : "No raw listings"
            : canonicalProperties.length > 0
              ? someCanonicalSelected
                ? `${selectedCanonicalIds.size} of ${filteredSortedCanonical.length} canonical selected`
                : filteredSortedCanonical.length < canonicalProperties.length
                  ? `${filteredSortedCanonical.length} of ${canonicalProperties.length} canonical propert${canonicalProperties.length === 1 ? "y" : "ies"}`
                  : `${canonicalProperties.length} canonical propert${canonicalProperties.length === 1 ? "y" : "ies"}`
              : "No canonical properties"}
        </span>
        <div className={styles.bottomActions}>
          {activeTab === "raw" && total > 0 && (
            <>
              {someSelected ? (
                <Button variant="secondary" onClick={clearListingSelection} title="Clear selection">
                  Clear selection
                </Button>
              ) : (
                <Button variant="secondary" onClick={selectAllListings} title="Select all listings">
                  Select all
                </Button>
              )}
            </>
          )}
          {activeTab === "canonical" && canonicalProperties.length > 0 && (
            <>
              {someCanonicalSelected ? (
                <Button variant="secondary" onClick={clearCanonicalSelection} title="Clear property selection">
                  Clear selection
                </Button>
              ) : (
                <Button variant="secondary" onClick={selectAllCanonical} title="Select all visible canonical properties">
                  Select all
                </Button>
              )}
            </>
          )}
          {activeTab === "raw" ? (
            <Button
              variant="primary"
              onClick={handleSendToCanonical}
              disabled={Boolean(total === 0 || sendingToCanonical)}
              title={someSelected ? "Send selected to canonical and run enrichment" : "Create canonical properties from all raw listings and link them"}
            >
              {sendingToCanonical ? "Sending…" : someSelected ? `Add ${selectedListingIds.size} to canonical` : "Add to canonical properties"}
            </Button>
          ) : null}
          {activeTab === "canonical" && canonicalProperties.length > 0 && (
            <>
              <Button
                variant="secondary"
                onClick={handleSendBulkInquiryEmails}
                disabled={Boolean(bulkInquirySending || selectedCanonicalIds.size === 0)}
                title="Send inquiry emails for selected canonical properties using manual override first, then broker emails in listing order."
              >
                {bulkInquirySending ? "Sending inquiries…" : someCanonicalSelected ? `Email brokers (${selectedCanonicalIds.size})` : "Email brokers"}
              </Button>
              <Button
                variant="secondary"
                onClick={handleRerunEnrichment}
                disabled={Boolean(rerunningEnrichment || selectedCanonicalIds.size === 0)}
                title="Re-run enrichment for selected canonical properties (BBL assumed already set). Refreshes data from NYC Open Data."
              >
                {rerunningEnrichment ? "Re-running…" : someCanonicalSelected ? `Re-run enrichment (${selectedCanonicalIds.size})` : "Re-run enrichment"}
              </Button>
              <Button
                variant="secondary"
                onClick={handleRunRentalFlow}
                disabled={Boolean(runningRentalFlow || selectedCanonicalIds.size === 0)}
                title="Re-run rental flow only for selected canonical properties (RapidAPI + LLM on listing). Runs automatically when adding to canonical properties."
              >
                {runningRentalFlow ? "Running…" : someCanonicalSelected ? `Re-run rental flow (${selectedCanonicalIds.size})` : "Re-run rental flow"}
              </Button>
              {someCanonicalSelected ? (
                <Button
                  variant="destructive"
                  onClick={handleRejectSelectedCanonicalProperties}
                  disabled={Boolean(deletingCanonical)}
                  title="Soft remove selected properties from the active pipeline while preserving their history."
                >
                  {deletingCanonical ? "Updating…" : `Reject/remove (${selectedCanonicalIds.size})`}
                </Button>
              ) : null}
              {someCanonicalSelected ? (
                <Button
                  variant="destructive"
                  className={styles.dangerSolid}
                  onClick={handleDeleteSelectedCanonicalProperties}
                  disabled={Boolean(deletingCanonical)}
                  title="Delete selected canonical property records. Raw listings remain."
                >
                  {deletingCanonical ? "Deleting…" : `Delete selected (${selectedCanonicalIds.size})`}
                </Button>
              ) : null}
            </>
          )}
          {activeTab === "raw" ? (
            <Button
              variant="secondary"
              onClick={openReviewDup}
              disabled={Boolean(total === 0)}
              title="Review potential duplicate listings (score ≥ 80)"
            >
              Review duplicates
            </Button>
          ) : null}
          {activeTab === "canonical" && !someCanonicalSelected ? (
            <Button
              variant="destructive"
              onClick={handleClearCanonicalProperties}
              disabled={Boolean(clearingCanonical || canonicalProperties.length === 0)}
              title="Remove all canonical properties and their matches/enrichment data. Cannot be undone."
            >
              {clearingCanonical ? "Clearing…" : "Clear all canonical"}
            </Button>
          ) : null}
        </div>
      </div>
      )}

      {reviewDupOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="review-dup-title" className={styles.modalOverlay}>
          <div className={cx(styles.modalCard, styles.modalCardScroll)}>
            <h2 id="review-dup-title" className={styles.modalTitle}>
              <CopyCheck size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
              Review potential duplicates
            </h2>
            <p className={styles.modalIntro}>
              Listings with duplicate score ≥ 80. Delete duplicates to keep one record per property.
            </p>
            {loadingDup ? (
              <SkeletonRows count={3} />
            ) : duplicateCandidates.length === 0 ? (
              <EmptyState title="No potential duplicates found." />
            ) : (
              <div className={styles.modalScrollBody}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th className={styles.cellNum}>Score</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateCandidates.map((row) => (
                      <tr key={row.id}>
                        <td>{fullAddress(row)}</td>
                        <td className={cx(styles.cellNum, dupConfClass(row.duplicateScore))}>{row.duplicateScore ?? "—"}</td>
                        <td>
                          <Button
                            variant="secondary"
                            disabled={Boolean(deletingId === row.id)}
                            onClick={() => handleDeleteListing(row.id)}
                          >
                            {deletingId === row.id ? "Deleting…" : "Delete"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={styles.modalFooter}>
              <Button variant="primary" onClick={() => setReviewDupOpen(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {manualAddModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-add-title"
          className={cx(styles.modalOverlay, styles.modalOverlayHigh)}
        >
          <div className={cx(styles.modalCard, styles.modalCardForm)}>
            <h2 id="manual-add-title" className={styles.modalTitle}>
              <PlusCircle size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
              Add missed StreetEasy listings
            </h2>
            <p className={styles.modalIntro}>
              Paste StreetEasy sale URLs or numeric sale IDs that were missed by saved search. Numeric IDs and /sale/ URLs use RapidAPI sale-details-by-ID; other StreetEasy URLs fall back to the URL lookup.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleManualAddProperty();
              }}
            >
              <label className={styles.fieldLabel}>
                <span className={styles.fieldName}>
                  StreetEasy URLs or sale IDs
                </span>
                <textarea
                  required
                  autoFocus
                  className={styles.textarea}
                  placeholder={"https://streeteasy.com/sale/1733085\n1733085"}
                  value={manualAddDraft.streetEasyInput}
                  onChange={(e) => setManualAddDraft((prev) => ({ ...prev, streetEasyInput: e.target.value }))}
                  rows={5}
                />
              </label>
              <label className={cx(styles.fieldLabel, styles.fieldLabelTight)}>
                <span className={styles.fieldName}>
                  OM URL
                </span>
                <input
                  type="url"
                  className={styles.input}
                  placeholder="https://.../offering-memo.pdf"
                  value={manualAddDraft.omUrl}
                  onChange={(e) => setManualAddDraft((prev) => ({ ...prev, omUrl: e.target.value }))}
                />
              </label>
              <p className={styles.formHint}>
                The OM link works best when it points directly to a PDF or downloadable file, and can only be included with one StreetEasy listing at a time.
              </p>
              {manualAddError && (
                <p className={styles.formError}>
                  {manualAddError}
                </p>
              )}
              <div className={styles.modalActions}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (manualAddSubmitting) return;
                    setManualAddModalOpen(false);
                    setManualAddError(null);
                  }}
                  disabled={manualAddSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={Boolean(manualAddSubmitting || !manualAddDraft.streetEasyInput.trim())}
                >
                  {manualAddSubmitting ? "Adding…" : "Run ingestion"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={styles.runLogSection}>
        {(sendingToCanonical || rerunningEnrichment || runningRentalFlow || lastEnrichmentResult) && (
          <div
            className={cx(
              styles.enrichmentCard,
              sendingToCanonical || rerunningEnrichment || runningRentalFlow
                ? styles.enrichmentCardActive
                : styles.enrichmentCardDone
            )}
            role="status"
            aria-live="polite"
          >
            <h3 className={styles.enrichmentTitle}>
              <Zap size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
              Enrichment run
            </h3>
            {sendingToCanonical || rerunningEnrichment || runningRentalFlow ? (
              <p className={styles.enrichmentCopy}>
                {sendingToCanonical
                  ? "Enrichment in progress… Creating canonical properties, running all modules (Phase 1, Permits, Zoning, CO, HPD, etc.), and rental flow (RapidAPI + LLM) per property. This may take a few minutes."
                  : runningRentalFlow
                    ? "Re-running rental flow… Fetching rental data (RapidAPI) and extracting financials from listing text (LLM). This may take a few minutes."
                    : "Re-running enrichment… Refreshing NYC Open Data and OM financials (when OM/Brochure uploaded). Use Re-run rental flow for RapidAPI + LLM."}
              </p>
            ) : lastEnrichmentResult ? (
              <>
                <p className={styles.enrichmentSummary}>
                  Last enrichment: <strong>{lastEnrichmentResult.success} succeeded</strong>
                  {lastEnrichmentResult.failed > 0 && (
                    <>, <strong>{lastEnrichmentResult.failed} failed</strong></>
                  )}.
                  {(lastEnrichmentResult.omFinancialsProcessed != null || lastEnrichmentResult.omFinancialsSkippedNoFile != null) && (
                    <> OM financials: <strong>{lastEnrichmentResult.omFinancialsProcessed ?? 0} doc(s) processed</strong>
                      {(lastEnrichmentResult.omFinancialsSkippedNoFile ?? 0) > 0 && (
                        <>; <strong>{lastEnrichmentResult.omFinancialsSkippedNoFile} skipped</strong> (file not on disk — use persistent storage on Render)</>
                      )}
                    </>
                  )}
                  {lastEnrichmentResult.rentalFlow?.ran && (
                    <> Rental flow: <strong>{lastEnrichmentResult.rentalFlow.success} succeeded</strong>
                      {lastEnrichmentResult.rentalFlow.failed > 0 && (
                        <>, <strong>{lastEnrichmentResult.rentalFlow.failed} failed</strong></>
                      )}.
                    </>
                  )}
                </p>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th className={styles.cellNum}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(lastEnrichmentResult.byModule)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, count]) => (
                        <tr key={key}>
                          <td>{ENRICHMENT_MODULE_LABELS[key] ?? key}</td>
                          <td className={styles.cellNum}>{count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        )}

        {canonicalProperties.length > 0 && (
          <div className={styles.stageSummary}>
            {stageSummary.map((item) => (
              <StatCard key={item.label} label={item.label} value={item.count} tone={item.tone} />
            ))}
          </div>
        )}

        <button
          type="button"
          className={cx("property-detail-section-header", styles.sectionToggle)}
          onClick={() => setPipelineStatsOpen((o) => !o)}
          aria-expanded={pipelineStatsOpen}
        >
          <span className={cx("property-detail-section-title", styles.toggleTitle)}>
            <ListChecks size={15} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
            Coverage by module
          </span>
          <span className={`property-detail-section-chevron ${pipelineStatsOpen ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
        </button>
        {pipelineStatsOpen && (
          <div className={styles.runLogTableWrap}>
            {pipelineStats == null ? (
              <SkeletonRows count={3} />
            ) : (
              <table className={cx(styles.dataTable, styles.tableStats)}>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th className={styles.cellNum}>Count</th>
                    <th className={styles.cellNum}>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Raw listings</td>
                    <td className={styles.cellNum}>{pipelineStats.rawListings}</td>
                    <td className={cx(styles.cellNum, styles.mutedCell)}>—</td>
                  </tr>
                  <tr>
                    <td>Canonical properties</td>
                    <td className={styles.cellNum}>{pipelineStats.canonicalProperties}</td>
                    <td className={cx(styles.cellNum, styles.mutedCell)}>—</td>
                  </tr>
                  {pipelineStats.enrichment.map((row) => {
                    const remaining = Math.max(0, pipelineStats.canonicalProperties - row.completed);
                    const remainingInfo = pipelineStats.remainingByModule?.[row.key];
                    const remainingIds = remainingInfo?.propertyIds ?? [];
                    return (
                      <React.Fragment key={row.key}>
                        <tr>
                          <td>{row.label}</td>
                          <td className={styles.cellNum}>{row.completed}</td>
                          <td className={cx(styles.cellNum, remaining > 0 ? styles.warnCell : styles.mutedCell)}>
                            {remaining > 0 ? `${remaining} left` : "—"}
                          </td>
                        </tr>
                        {remaining > 0 && remainingIds.length > 0 && (
                          <tr>
                            <td colSpan={3} className={styles.statsRemainderCell}>
                              Not yet completed:{" "}
                              {remainingIds
                                .map((id) => canonicalProperties.find((p) => p.id === id)?.canonicalAddress ?? id)
                                .join(", ")}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        <button
          type="button"
          className={cx("property-detail-section-header", styles.workflowToggle)}
          onClick={() => setWorkflowBoardOpen((o) => !o)}
          aria-expanded={workflowBoardOpen}
        >
          <span className={cx("property-detail-section-title", styles.toggleTitle)}>
            <History size={15} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
            Workflow runs
          </span>
          <span className={`property-detail-section-chevron ${workflowBoardOpen ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
        </button>
        {workflowBoardOpen && (
          <div className={styles.runLogTableWrap}>
            {workflowBoard.runs.length === 0 ? (
              <EmptyState title="No workflow runs recorded yet." />
            ) : (
              <div className={styles.workflowScroll}>
                <table
                  className={cx(styles.dataTable, styles.tableRows)}
                  /* Width scales with the number of visible workflow columns — genuinely dynamic. */
                  style={{ minWidth: `${320 + workflowDisplayColumns.length * 130}px` }}
                >
                  <thead>
                    <tr>
                      <th>Run</th>
                      {workflowDisplayColumns.map((column) => (
                        <th key={column.key}>{column.shortLabel}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {workflowBoard.runs.map((run) => (
                      <tr key={run.id}>
                        <td className={styles.workflowRunCell}>
                          <div className={styles.workflowRunTitle}>{run.displayName}</div>
                          <div className={styles.workflowRunMeta}>
                            {formatDateTime(run.startedAt)}
                            {run.finishedAt ? ` · Updated ${formatDateTime(run.finishedAt)}` : " · Live"}
                          </div>
                          <div className={styles.workflowRunScope}>
                            {run.scopeLabel ?? (run.totalItems > 0 ? `${run.totalItems} item${run.totalItems === 1 ? "" : "s"}` : "No scoped items")}
                          </div>
                          <StatusChip
                            label={`${workflowStatusLabel(run.status)} #${run.runNumber}`}
                            tone={workflowStatusTone(run.status)}
                            className={cx(styles.statusChipCompact, styles.statusChipRun)}
                          />
                        </td>
                        {workflowDisplayColumns.map((column) => {
                          const step = summarizeWorkflowSteps(run, column);
                          if (!step) {
                            return (
                              <td key={`${run.id}-${column.key}`} className={styles.cellEmptyDash}>
                                —
                              </td>
                            );
                          }
                          const note = step.lastError ?? step.lastMessage ?? null;
                          const processed = step.completedItems + step.failedItems + step.skippedItems;
                          const progressText =
                            step.totalItems > 0
                              ? `${step.completedItems}/${step.totalItems}`
                              : processed > 0
                                ? `${processed}`
                                : "0";
                          return (
                            <td key={`${run.id}-${column.key}`} className={styles.workflowStageCell}>
                              <StatusChip
                                label={workflowStatusLabel(step.status)}
                                tone={workflowStatusTone(step.status)}
                                className={styles.statusChipCompact}
                              />
                              <div className={styles.workflowStageCount}>
                                {progressText}
                                {step.failedItems > 0 ? ` · ${step.failedItems} failed` : ""}
                              </div>
                              {note ? (
                                <div
                                  title={note}
                                  className={cx(styles.workflowStageNote, step.lastError ? styles.workflowStageNoteError : undefined)}
                                >
                                  {note}
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PropertyDataPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <PageHeader title="Property Data" />
          <SkeletonRows count={4} />
        </div>
      }
    >
      <PropertyDataContent />
    </Suspense>
  );
}
