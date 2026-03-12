"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  deriveListingActivitySummary,
  describeListingActivity,
  formatListingEventLabel,
  type ListingActivitySummary,
} from "@re-sourcing/contracts";
import { PropertyDetailCollapsible } from "./PropertyDetailCollapsible";
import { CanonicalPropertyDetail, type CanonicalProperty } from "./CanonicalPropertyDetail";
import { AREA_OPTIONS, cityToArea, cityFromCanonicalAddress } from "./areas";
import { getSourcingUpdateMeta } from "./sourcingUpdate";
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

function workflowStatusStyle(status: WorkflowBoardRun["status"] | WorkflowBoardStep["status"]) {
  switch (status) {
    case "running":
      return { color: "#1d4ed8", backgroundColor: "#dbeafe", borderColor: "#93c5fd" };
    case "completed":
      return { color: "#166534", backgroundColor: "#dcfce7", borderColor: "#86efac" };
    case "failed":
      return { color: "#b91c1c", backgroundColor: "#fee2e2", borderColor: "#fca5a5" };
    case "partial":
      return { color: "#9a3412", backgroundColor: "#ffedd5", borderColor: "#fdba74" };
    default:
      return { color: "#475569", backgroundColor: "#f8fafc", borderColor: "#cbd5e1" };
  }
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

function PropertyDataContent() {
  const [activeTab, setActiveTab] = useState<TabId>("canonical");
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
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
  const [canonicalProperties, setCanonicalProperties] = useState<CanonicalProperty[]>([]);
  const [loadingCanonical, setLoadingCanonical] = useState(false);
  const [sendingToCanonical, setSendingToCanonical] = useState(false);
  const [rerunningEnrichment, setRerunningEnrichment] = useState(false);
  const [runningRentalFlow, setRunningRentalFlow] = useState(false);
  const [expandedCanonicalId, setExpandedCanonicalId] = useState<string | null>(null);
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
  }, [canonicalProperties, normalizedSearch, areaFilter, minPrice, maxPrice, listedAfter, listedBefore, sortBy, sortDir]);

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

  const dupConfStyle = (score: number | null | undefined) => {
    if (score == null) return {};
    const intensity = score / 100;
    return {
      color: intensity >= 0.8 ? "#b91c1c" : intensity <= 0.2 ? "#15803d" : "#854d0e",
      fontWeight: score >= 80 ? 600 : 400,
    };
  };

  const dossierCellMeta = (prop: CanonicalProperty) => {
    const localJob = localDossierJobs[prop.id];
    const persisted = getPropertyDossierGeneration((prop.details ?? null) as Record<string, unknown> | null);

    if (localJob?.status === "running") {
      return {
        label: `Generating ${localJob.progressPct}%`,
        detail: localJob.stageLabel,
        style: { color: "#1d4ed8", backgroundColor: "#dbeafe", borderColor: "#93c5fd" },
      };
    }
    if (localJob?.status === "failed") {
      return {
        label: "Failed",
        detail: localJob.notice ?? persisted?.lastError ?? "Generation failed",
        style: { color: "#b91c1c", backgroundColor: "#fee2e2", borderColor: "#fca5a5" },
      };
    }
    if (localJob?.status === "completed") {
      return {
        label: "Complete",
        detail: "PDF + Excel saved",
        style: { color: "#166534", backgroundColor: "#dcfce7", borderColor: "#86efac" },
      };
    }
    if (persisted?.status === "running") {
      return {
        label: "Generating",
        detail: persisted.stageLabel ?? "In progress",
        style: { color: "#1d4ed8", backgroundColor: "#dbeafe", borderColor: "#93c5fd" },
      };
    }
    if (persisted?.status === "failed") {
      return {
        label: "Failed",
        detail: persisted.lastError ?? "Last run failed",
        style: { color: "#b91c1c", backgroundColor: "#fee2e2", borderColor: "#fca5a5" },
      };
    }
    if (persisted?.status === "completed" || prop.dealScore != null) {
      return {
        label: "Complete",
        detail: persisted?.completedAt ? formatListedDate(persisted.completedAt) : "Ready",
        style: { color: "#166534", backgroundColor: "#dcfce7", borderColor: "#86efac" },
      };
    }
    return {
      label: "Not started",
      detail: "Uses profile + property defaults",
      style: { color: "#475569", backgroundColor: "#f8fafc", borderColor: "#cbd5e1" },
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
      { label: "New", count: newCount, tone: "#475569", bg: "#f8fafc", border: "#cbd5e1" },
      { label: "Inquiry out", count: inquiryOut, tone: "#9a3412", bg: "#ffedd5", border: "#fdba74" },
      { label: "OM received", count: omReceived, tone: "#854d0e", bg: "#fef3c7", border: "#fcd34d" },
      { label: "Underwriting ready", count: underwritingReady, tone: "#166534", bg: "#dcfce7", border: "#86efac" },
      { label: "Dossier running", count: dossierRunningCount, tone: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" },
      { label: "Dossier ready", count: dossierReadyCount, tone: "#166534", bg: "#dcfce7", border: "#86efac" },
      { label: "Refreshing", count: refreshingPropertyIds.size, tone: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" },
      { label: "Workflow issues", count: failedWorkflowPropertyIds.size, tone: "#b91c1c", bg: "#fee2e2", border: "#fca5a5" },
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
        style: workflowStatusStyle("running"),
      };
    }
    if (hasAuthoritativeOm || prop.dealScore != null) {
      return {
        label: "Ready",
        detail: prop.dealScore != null ? `Score ${prop.dealScore}` : "OM parsed",
        style: workflowStatusStyle("completed"),
      };
    }
    if (prop.omStatus === "OM received") {
      return {
        label: "OM received",
        detail: "Awaiting authoritative OM",
        style: workflowStatusStyle("partial"),
      };
    }
    if (prop.omStatus === "OM pending") {
      return {
        label: "Waiting on OM",
        detail: "Inquiry sent",
        style: workflowStatusStyle("pending"),
      };
    }
    return {
      label: "Not started",
      detail: "Needs OM",
      style: workflowStatusStyle("pending"),
    };
  };

  const omCellMeta = (prop: CanonicalProperty) => {
    if (prop.omStatus === "OM received") {
      return {
        label: "OM received",
        detail: "Document on file",
        style: workflowStatusStyle("completed"),
      };
    }
    if (prop.omStatus === "OM pending") {
      return {
        label: "Pending",
        detail: "Waiting on broker",
        style: workflowStatusStyle("partial"),
      };
    }
    return {
      label: "Not received",
      detail: "No OM yet",
      style: workflowStatusStyle("pending"),
    };
  };

  const activeRunCellMeta = (prop: CanonicalProperty) => {
    const run = workflowByPropertyId.get(prop.id);
    if (!run) {
      return {
        label: "Idle",
        detail: "No active job",
        style: workflowStatusStyle("pending"),
      };
    }
    const activeStep = run.steps.find((step) => step.status === "running" || step.status === "partial" || step.status === "failed");
    return {
      label: run.displayName,
      detail: activeStep?.label ?? workflowStatusLabel(run.status),
      style: workflowStatusStyle(run.status),
    };
  };

  const workflowColumns = workflowBoard.columns.length > 0 ? workflowBoard.columns : DEFAULT_WORKFLOW_COLUMNS;

  const workflowStepForColumn = (run: WorkflowBoardRun, columnKey: string) =>
    run.steps.find((step) => step.key === columnKey) ?? null;

  const formatDateTime = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const handleClearRawListings = () => {
    if (!confirm("Clear all raw listings and their snapshots? This cannot be undone.")) return;
    setClearing(true);
    setError(null);
    fetch(`${API_BASE}/api/test-agent/property-data?confirm=1`, { method: "DELETE" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok && data?.error) {
          const detail = data.details ? ` — ${data.details}` : "";
          throw new Error(data.error + detail);
        }
        if (data?.error) throw new Error(data.error);
        fetchListings();
        fetchPipelineStats(true);
        fetchWorkflowBoard();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to clear raw listings"))
      .finally(() => setClearing(false));
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
        setSelectedListingIds(new Set());
        fetchCanonicalProperties();
        fetchPipelineStats(true);
        fetchWorkflowBoard();
        setActiveTab("canonical");
      })
      .catch((e) => setError(e.message || "Failed to send to canonical"))
      .finally(() => setSendingToCanonical(false));
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
        fetchCanonicalProperties();
        fetchPipelineStats(true);
        fetchWorkflowBoard();
      })
      .catch((e) => setError(e.message || "Failed to re-run enrichment"))
      .finally(() => setRerunningEnrichment(false));
  };

  const handleRunRentalFlow = () => {
    if (selectedCanonicalIds.size === 0) return;
    const propertyIds = Array.from(selectedCanonicalIds);
    if (!confirm(`Run rental flow (RapidAPI + LLM) for ${propertyIds.length} selected canonical propert${propertyIds.length === 1 ? "y" : "ies"}? This fetches rental data by URL and extracts financials from listing text.`)) return;
    setRunningRentalFlow(true);
    setError(null);
    fetchWorkflowBoard();
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
        alert(`Done. ${withUnits} propert${withUnits === 1 ? "y" : "ies"} with rental units; ${withLlm} with LLM financials.`);
      })
      .catch((e) => setError(e.message || "Run rental flow failed"))
      .finally(() => setRunningRentalFlow(false));
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
    <div className="property-data-layout">
      <h1 className="page-title">Property Data</h1>
      {sentMessage && (
        <div className="card" style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#f0fdf4", borderColor: "#86efac" }}>
          {decodeURIComponent(sentMessage)}
        </div>
      )}

      <div className="property-data-search-row">
        <input
          type="search"
          placeholder="Search by address, property ID, listing ID, or area"
          className="input-text property-data-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search properties"
        />
      </div>

      <div className="property-data-tabs-row">
        <div className="property-data-filters" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Sort by</span>
            <select
              className="input-text property-data-filter-select"
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
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Direction</span>
            <select
              className="input-text property-data-filter-select"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              aria-label="Sort direction"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Area</span>
            <select
              className="input-text property-data-filter-select"
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              aria-label="Filter by area"
            >
              {AREA_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Min price</span>
            <input
              type="text"
              className="input-text"
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              aria-label="Minimum price"
              style={{ width: "5rem" }}
            />
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Max price</span>
            <input
              type="text"
              className="input-text"
              placeholder="Max"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              aria-label="Maximum price"
              style={{ width: "5rem" }}
            />
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Listed after</span>
            <input
              type="date"
              className="input-text"
              value={listedAfter}
              onChange={(e) => setListedAfter(e.target.value)}
              aria-label="Listed after date"
            />
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Listed before</span>
            <input
              type="date"
              className="input-text"
              value={listedBefore}
              onChange={(e) => setListedBefore(e.target.value)}
              aria-label="Listed before date"
            />
          </label>
        </div>
      </div>

      <div className="property-data-content property-data-content--no-sidebar">
        {activeTab === "raw" && loading && (
          <div
            className="card"
            role="status"
            aria-live="polite"
            style={{
              marginBottom: "1rem",
              padding: "0.75rem 1rem",
              background: "#fef9c3",
              borderColor: "#facc15",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              Loading raw listings — broker &amp; price history may still be populating.
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              {formatElapsed(enrichmentTimerSeconds)}
            </span>
          </div>
        )}
        <div className="property-data-table-wrap">
          {error && (
            <div className="card error" style={{ margin: "1rem" }}>
              {error}
            </div>
          )}
          {dossierNotice && (
            <div
              style={{
                margin: "1rem",
                padding: "0.85rem 1rem",
                borderRadius: "10px",
                border: dossierNotice.type === "success" ? "1px solid #86efac" : "1px solid #fca5a5",
                background: dossierNotice.type === "success" ? "#f0fdf4" : "#fef2f2",
                color: dossierNotice.type === "success" ? "#166534" : "#b91c1c",
                fontSize: "0.9rem",
              }}
            >
              {dossierNotice.message}
            </div>
          )}
          {loading && activeTab === "raw" && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#525252" }}>
              Loading raw listings…
            </div>
          )}
          {activeTab === "canonical" && (
            <>
              {loadingCanonical ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#525252" }}>
                  Loading canonical properties…
                </div>
              ) : (
                <table className="property-data-table">
                  <thead>
                    <tr>
                      <th className="property-data-table-expand-col" aria-label="Expand row" />
                      <th className="property-data-table-checkbox-col" aria-label="Select property">
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
                      <th style={{ width: "2rem" }} aria-label="Save deal" title="Save / Unsave deal" />
                      <th>Canonical address</th>
                      <th>Area</th>
                      <th>Price</th>
                      <th>Last activity</th>
                      <th>Listed date</th>
                      <th>Saved search</th>
                      <th>OM</th>
                      <th>Underwriting</th>
                      <th>Active run</th>
                      <th>Dossier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSortedCanonical.length === 0 ? (
                      <tr>
                        <td colSpan={13} style={{ padding: "2rem", color: "#737373", textAlign: "center" }}>
                          {canonicalProperties.length === 0
                            ? "No canonical properties yet. Send raw listings to canonical properties from the raw listings tab."
                            : "No properties match the current filters."}
                        </td>
                      </tr>
                    ) : (
                      filteredSortedCanonical.map((prop) => {
                        const area = prop.primaryListing?.city != null ? cityToArea(prop.primaryListing.city) : cityFromCanonicalAddress(prop.canonicalAddress);
                        const omMeta = omCellMeta(prop);
                        const underwritingMeta = underwritingCellMeta(prop);
                        const activeRunMeta = activeRunCellMeta(prop);
                        const dossierMeta = dossierCellMeta(prop);
                        const sourcingUpdateMeta = getSourcingUpdateMeta(prop.details ?? null);
                        return (
                          <React.Fragment key={prop.id}>
                            <tr
                              className="property-data-row--clickable"
                              onClick={() => setExpandedCanonicalId((id) => (id === prop.id ? null : prop.id))}
                            >
                              <td className="property-data-table-expand-col">
                                <button
                                  type="button"
                                  className="property-data-row-expand-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedCanonicalId((id) => (id === prop.id ? null : prop.id));
                                  }}
                                  aria-expanded={expandedCanonicalId === prop.id}
                                >
                                  <span className={`property-data-row-expand-chevron ${expandedCanonicalId === prop.id ? "property-data-row-expand-chevron--open" : ""}`}>▼</span>
                                </button>
                              </td>
                              <td className="property-data-table-checkbox-col" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedCanonicalIds.has(prop.id)}
                                  onChange={() => toggleCanonicalSelection(prop.id)}
                                  aria-label={`Select ${prop.canonicalAddress}`}
                                />
                              </td>
                              <td style={{ textAlign: "center", verticalAlign: "middle" }}>
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
                                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.25rem", lineHeight: 1 }}
                                  aria-label={savedPropertyIds.has(prop.id) ? "Unsave deal" : "Save deal"}
                                >
                                  {savedPropertyIds.has(prop.id) ? "★" : "☆"}
                                </button>
                              </td>
                              <td>{prop.canonicalAddress}</td>
                              <td>{area}</td>
                              <td>{prop.primaryListing?.price != null ? formatPrice(prop.primaryListing.price) : "—"}</td>
                              <td title={describeListingActivity(prop.primaryListing?.lastActivity ?? null) ?? undefined}>
                                {formatActivitySummary(prop.primaryListing?.lastActivity ?? null, prop.primaryListing?.listedAt ?? null)}
                              </td>
                              <td>{formatListedDate(prop.primaryListing?.listedAt ?? null)}</td>
                              <td>
                                <div
                                  style={{
                                    display: "inline-flex",
                                    flexDirection: "column",
                                    gap: "0.15rem",
                                    padding: "0.35rem 0.55rem",
                                    borderRadius: "999px",
                                    border: "1px solid",
                                    whiteSpace: "nowrap",
                                    ...sourcingUpdateMeta.style,
                                  }}
                                >
                                  <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{sourcingUpdateMeta.label}</span>
                                  <span style={{ fontSize: "0.7rem", opacity: 0.85 }}>{sourcingUpdateMeta.detail}</span>
                                </div>
                              </td>
                              <td>
                                <div
                                  style={{
                                    display: "inline-flex",
                                    flexDirection: "column",
                                    gap: "0.15rem",
                                    padding: "0.35rem 0.55rem",
                                    borderRadius: "999px",
                                    border: "1px solid",
                                    whiteSpace: "nowrap",
                                    ...omMeta.style,
                                  }}
                                >
                                  <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{omMeta.label}</span>
                                  <span style={{ fontSize: "0.7rem", opacity: 0.85 }}>{omMeta.detail}</span>
                                </div>
                              </td>
                              <td>
                                <div
                                  style={{
                                    display: "inline-flex",
                                    flexDirection: "column",
                                    gap: "0.15rem",
                                    padding: "0.35rem 0.55rem",
                                    borderRadius: "999px",
                                    border: "1px solid",
                                    whiteSpace: "nowrap",
                                    ...underwritingMeta.style,
                                  }}
                                >
                                  <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{underwritingMeta.label}</span>
                                  <span style={{ fontSize: "0.7rem", opacity: 0.85 }}>{underwritingMeta.detail}</span>
                                </div>
                              </td>
                              <td>
                                <div
                                  style={{
                                    display: "inline-flex",
                                    flexDirection: "column",
                                    gap: "0.15rem",
                                    padding: "0.35rem 0.55rem",
                                    borderRadius: "999px",
                                    border: "1px solid",
                                    whiteSpace: "nowrap",
                                    maxWidth: "12rem",
                                    ...activeRunMeta.style,
                                  }}
                                >
                                  <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{activeRunMeta.label}</span>
                                  <span style={{ fontSize: "0.7rem", opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis" }}>{activeRunMeta.detail}</span>
                                </div>
                              </td>
                              <td>
                                <div
                                  style={{
                                    display: "inline-flex",
                                    flexDirection: "column",
                                    gap: "0.15rem",
                                    padding: "0.35rem 0.55rem",
                                    borderRadius: "999px",
                                    border: "1px solid",
                                    whiteSpace: "nowrap",
                                    ...dossierMeta.style,
                                  }}
                                >
                                  <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{dossierMeta.label}</span>
                                  <span style={{ fontSize: "0.7rem", opacity: 0.85 }}>{dossierMeta.detail}</span>
                                </div>
                              </td>
                            </tr>
                            {expandedCanonicalId === prop.id && (
                              <tr className="property-data-detail-row">
                                <td colSpan={13} className="property-data-detail-cell" style={{ padding: "1rem 1rem 1rem 2.5rem", backgroundColor: "#fafafa" }}>
                                  <CanonicalPropertyDetail
                                    property={prop}
                                    isSaved={savedPropertyIds.has(prop.id)}
                                    dossierJob={localDossierJobs[prop.id]}
                                    onDossierJobChange={handleDossierJobChange}
                                    onDossierNotice={handleDossierNotice}
                                    onRefreshPropertyData={() => fetchCanonicalProperties(true)}
                                    onWorkflowActivity={fetchWorkflowBoard}
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
            <table className="property-data-table">
              <thead>
                <tr>
                  <th className="property-data-table-expand-col" aria-label="Expand row" />
                  <th className="property-data-table-checkbox-col" aria-label="Select for canonical">
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
                  <th>Price</th>
                  <th>Last activity</th>
                  <th>Listed date</th>
                  <th>Days on market</th>
                  <th>Dup. Conf.</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredSortedListings.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: "2rem", color: "#737373", textAlign: "center" }}>
                      {listings.length === 0
                        ? "No raw listings yet. Run a flow from StreetEasy Agent, then use \"Send to property data\" for a completed run."
                        : "No listings match the current filters."}
                    </td>
                  </tr>
                ) : (
                  filteredSortedListings.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`property-data-row--clickable ${selectedId === row.id ? "property-data-row--selected" : ""}`}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td className="property-data-table-expand-col">
                          <button
                            type="button"
                            className="property-data-row-expand-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRowId((id) => (id === row.id ? null : row.id));
                            }}
                            aria-expanded={expandedRowId === row.id}
                            aria-label={expandedRowId === row.id ? "Collapse row" : "Expand row"}
                          >
                            <span className={`property-data-row-expand-chevron ${expandedRowId === row.id ? "property-data-row-expand-chevron--open" : ""}`}>
                              ▼
                            </span>
                          </button>
                        </td>
                        <td className="property-data-table-checkbox-col" onClick={(e) => e.stopPropagation()}>
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
                        <td>{formatPrice(row.price)}</td>
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
                        <td>{daysOnMarket(row.listedAt) != null ? `${daysOnMarket(row.listedAt)} days` : "—"}</td>
                        <td style={dupConfStyle(row.duplicateScore)} title="Duplicate likelihood (100 = likely duplicate)">
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
                        <tr key={`${row.id}-detail`} className="property-data-detail-row">
                          <td colSpan={11} className="property-data-detail-cell" style={{ paddingLeft: "2.5rem", backgroundColor: "#fafafa" }}>
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

      <div className="property-data-bottom-bar">
        <span className="property-data-bottom-label">
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
        <div className="property-data-bottom-actions">
          {activeTab === "raw" && total > 0 && (
            <>
              {someSelected ? (
                <button type="button" className="btn-secondary" onClick={clearListingSelection} title="Clear selection">
                  Clear selection
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={selectAllListings} title="Select all listings">
                  Select all
                </button>
              )}
            </>
          )}
          {activeTab === "canonical" && canonicalProperties.length > 0 && (
            <>
              {someCanonicalSelected ? (
                <button type="button" className="btn-secondary" onClick={clearCanonicalSelection} title="Clear property selection">
                  Clear selection
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={selectAllCanonical} title="Select all visible canonical properties">
                  Select all
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={handleSendToCanonical}
            disabled={Boolean(activeTab !== "raw" || total === 0 || sendingToCanonical)}
            title={someSelected ? "Send selected to canonical and run enrichment" : "Create canonical properties from all raw listings and link them"}
          >
            {sendingToCanonical ? "Sending…" : someSelected ? `Add ${selectedListingIds.size} to canonical` : "Add to canonical properties"}
          </button>
          {activeTab === "canonical" && canonicalProperties.length > 0 && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRerunEnrichment}
                disabled={Boolean(rerunningEnrichment || selectedCanonicalIds.size === 0)}
                title="Re-run enrichment for selected canonical properties (BBL assumed already set). Refreshes data from NYC Open Data."
              >
                {rerunningEnrichment ? "Re-running…" : someCanonicalSelected ? `Re-run enrichment (${selectedCanonicalIds.size})` : "Re-run enrichment"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRunRentalFlow}
                disabled={Boolean(runningRentalFlow || selectedCanonicalIds.size === 0)}
                title="Re-run rental flow only for selected canonical properties (RapidAPI + LLM on listing). Runs automatically when adding to canonical properties."
              >
                {runningRentalFlow ? "Running…" : someCanonicalSelected ? `Re-run rental flow (${selectedCanonicalIds.size})` : "Re-run rental flow"}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={openReviewDup}
            disabled={Boolean(activeTab !== "raw" || total === 0)}
            title="Review potential duplicate listings (score ≥ 80)"
          >
            Review duplicates
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClearRawListings}
            disabled={Boolean(clearing || total === 0)}
            title="Remove all raw listings and their snapshots. Cannot be undone."
          >
            {clearing ? "Clearing…" : "Clear raw listings"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClearCanonicalProperties}
            disabled={Boolean(clearingCanonical || canonicalProperties.length === 0)}
            title="Remove all canonical properties and their matches/enrichment data. Cannot be undone."
          >
            {clearingCanonical ? "Clearing…" : "Clear canonical properties"}
          </button>
        </div>
      </div>

      {reviewDupOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="review-dup-title" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ maxWidth: "560px", width: "90%", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <h2 id="review-dup-title" style={{ margin: 0, marginBottom: "0.75rem", fontSize: "1.1rem" }}>Review potential duplicates</h2>
            <p style={{ fontSize: "0.875rem", color: "#525252", marginBottom: "1rem" }}>
              Listings with duplicate score ≥ 80. Delete duplicates to keep one record per property.
            </p>
            {loadingDup ? (
              <p style={{ color: "#737373" }}>Loading…</p>
            ) : duplicateCandidates.length === 0 ? (
              <p style={{ color: "#737373" }}>No potential duplicates found.</p>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table className="property-data-table" style={{ fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Score</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateCandidates.map((row) => (
                      <tr key={row.id}>
                        <td>{fullAddress(row)}</td>
                        <td style={dupConfStyle(row.duplicateScore)}>{row.duplicateScore ?? "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={Boolean(deletingId === row.id)}
                            onClick={() => handleDeleteListing(row.id)}
                          >
                            {deletingId === row.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e5e5" }}>
              <button type="button" className="btn-primary" onClick={() => setReviewDupOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="property-data-run-log-section">
        {(sendingToCanonical || rerunningEnrichment || runningRentalFlow || lastEnrichmentResult) && (
          <div
            className="card"
            role="status"
            aria-live="polite"
            style={{
              marginBottom: "1rem",
              padding: "1rem",
              maxWidth: "720px",
              background: sendingToCanonical || rerunningEnrichment || runningRentalFlow ? "#fef9c3" : "#f0fdf4",
              borderColor: sendingToCanonical || rerunningEnrichment || runningRentalFlow ? "#facc15" : "#86efac",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1rem", fontWeight: 600 }}>
              Enrichment run
            </h3>
            {sendingToCanonical || rerunningEnrichment || runningRentalFlow ? (
              <p style={{ margin: 0, color: "#854d0e" }}>
                {sendingToCanonical
                  ? "Enrichment in progress… Creating canonical properties, running all modules (Phase 1, Permits, Zoning, CO, HPD, etc.), and rental flow (RapidAPI + LLM) per property. This may take a few minutes."
                  : runningRentalFlow
                    ? "Re-running rental flow… Fetching rental data (RapidAPI) and extracting financials from listing text (LLM). This may take a few minutes."
                    : "Re-running enrichment… Refreshing NYC Open Data and OM financials (when OM/Brochure uploaded). Use Re-run rental flow for RapidAPI + LLM."}
              </p>
            ) : lastEnrichmentResult ? (
              <>
                <p style={{ margin: "0 0 0.75rem 0" }}>
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
                <table className="property-data-table" style={{ fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th style={{ textAlign: "right" }}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(lastEnrichmentResult.byModule)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, count]) => (
                        <tr key={key}>
                          <td>{ENRICHMENT_MODULE_LABELS[key] ?? key}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        )}

        {canonicalProperties.length > 0 && (
          <div
            className="workflow-stage-summary"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
              gap: "0.55rem",
              maxWidth: "1200px",
              marginBottom: "1rem",
            }}
          >
            {stageSummary.map((item) => (
              <div
                key={item.label}
                className="card workflow-stage-card"
                style={{
                  padding: "0.7rem 0.8rem",
                  borderColor: item.border,
                  background: item.bg,
                  color: item.tone,
                }}
              >
                <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {item.label}
                </div>
                <div style={{ marginTop: "0.2rem", fontSize: "1.35rem", fontWeight: 700, lineHeight: 1.1 }}>
                  {item.count}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          className="property-detail-section-header"
          onClick={() => setPipelineStatsOpen((o) => !o)}
          aria-expanded={pipelineStatsOpen}
          style={{ width: "100%", maxWidth: "520px", minHeight: "44px" }}
        >
          <span className="property-detail-section-title">Coverage by module</span>
          <span className={`property-detail-section-chevron ${pipelineStatsOpen ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
        </button>
        {pipelineStatsOpen && (
          <div className="property-data-run-log-table-wrap">
            {pipelineStats == null ? (
              <p style={{ color: "#737373", fontSize: "0.875rem" }}>Loading pipeline stats…</p>
            ) : (
              <table className="property-data-table" style={{ maxWidth: "720px", fontSize: "0.875rem" }}>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th style={{ textAlign: "right" }}>Count</th>
                    <th style={{ textAlign: "right" }}>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Raw listings</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pipelineStats.rawListings}</td>
                    <td style={{ textAlign: "right", color: "#737373" }}>—</td>
                  </tr>
                  <tr>
                    <td>Canonical properties</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pipelineStats.canonicalProperties}</td>
                    <td style={{ textAlign: "right", color: "#737373" }}>—</td>
                  </tr>
                  {pipelineStats.enrichment.map((row) => {
                    const remaining = Math.max(0, pipelineStats.canonicalProperties - row.completed);
                    const remainingInfo = pipelineStats.remainingByModule?.[row.key];
                    const remainingIds = remainingInfo?.propertyIds ?? [];
                    return (
                      <React.Fragment key={row.key}>
                        <tr>
                          <td>{row.label}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.completed}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: remaining > 0 ? "#854d0e" : "#737373" }}>
                            {remaining > 0 ? `${remaining} left` : "—"}
                          </td>
                        </tr>
                        {remaining > 0 && remainingIds.length > 0 && (
                          <tr>
                            <td colSpan={3} style={{ paddingTop: 0, paddingLeft: "1.5rem", fontSize: "0.8125rem", color: "#737373", verticalAlign: "top" }}>
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
          className="property-detail-section-header"
          onClick={() => setWorkflowBoardOpen((o) => !o)}
          aria-expanded={workflowBoardOpen}
          style={{ width: "100%", maxWidth: "1200px", marginTop: "1rem" }}
        >
          <span className="property-detail-section-title">Workflow runs</span>
          <span className={`property-detail-section-chevron ${workflowBoardOpen ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
        </button>
        {workflowBoardOpen && (
          <div className="property-data-run-log-table-wrap">
            {workflowBoard.runs.length === 0 ? (
              <p style={{ color: "#737373", fontSize: "0.875rem" }}>No workflow runs recorded yet.</p>
            ) : (
              <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                <table className="property-data-table" style={{ minWidth: `${420 + workflowColumns.length * 145}px`, fontSize: "0.84rem" }}>
                  <thead>
                    <tr>
                      <th>Triggered</th>
                      <th>Run</th>
                      <th>Scope</th>
                      {workflowColumns.map((column) => (
                        <th key={column.key}>{column.shortLabel}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {workflowBoard.runs.map((run) => (
                      <tr key={run.id}>
                        <td style={{ minWidth: "9rem", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600 }}>{formatDateTime(run.startedAt)}</div>
                          <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: "0.25rem" }}>
                            {run.finishedAt ? `Updated ${formatDateTime(run.finishedAt)}` : "Live"}
                          </div>
                        </td>
                        <td style={{ minWidth: "13rem", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600 }}>{run.displayName}</div>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem",
                              marginTop: "0.35rem",
                              padding: "0.2rem 0.45rem",
                              borderRadius: "999px",
                              border: "1px solid",
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              ...workflowStatusStyle(run.status),
                            }}
                          >
                            <span>{workflowStatusLabel(run.status)}</span>
                            <span>#{run.runNumber}</span>
                          </div>
                        </td>
                        <td style={{ minWidth: "10rem", verticalAlign: "top" }}>
                          {run.scopeLabel ?? (run.totalItems > 0 ? `${run.totalItems} item${run.totalItems === 1 ? "" : "s"}` : "—")}
                        </td>
                        {workflowColumns.map((column) => {
                          const step = workflowStepForColumn(run, column.key);
                          if (!step) {
                            return (
                              <td key={`${run.id}-${column.key}`} style={{ color: "#94a3b8", textAlign: "center" }}>
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
                            <td key={`${run.id}-${column.key}`} style={{ minWidth: "9rem", verticalAlign: "top" }}>
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "0.2rem 0.45rem",
                                  borderRadius: "999px",
                                  border: "1px solid",
                                  fontSize: "0.7rem",
                                  fontWeight: 700,
                                  ...workflowStatusStyle(step.status),
                                }}
                              >
                                {workflowStatusLabel(step.status)}
                              </div>
                              <div style={{ marginTop: "0.35rem", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                                {progressText}
                                {step.failedItems > 0 ? ` · ${step.failedItems} failed` : ""}
                              </div>
                              {note ? (
                                <div
                                  title={note}
                                  style={{
                                    marginTop: "0.25rem",
                                    fontSize: "0.7rem",
                                    color: step.lastError ? "#b91c1c" : "#64748b",
                                    lineHeight: 1.35,
                                    maxWidth: "9rem",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
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
    <Suspense fallback={<div className="property-data-layout"><h1 className="page-title">Property Data</h1><p style={{ padding: "2rem", color: "#737373" }}>Loading…</p></div>}>
      <PropertyDataContent />
    </Suspense>
  );
}
