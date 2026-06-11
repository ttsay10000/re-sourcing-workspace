"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, History, Info, SlidersHorizontal } from "lucide-react";
import { Badge, type BadgeTone, Button, EmptyState, PageHeader, Panel, SkeletonRows } from "@/components/ui";
import { BOROUGH_TABS, isIncludedByParent, type AreaNode } from "./areas";
import { useProcessBanner } from "@/components/ProcessBanner";
import styles from "./runs.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const DEFAULT_AREAS = ["all-downtown", "all-midtown"] as const;
const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_RESULT_LIMIT = "100";
const BEDS_BATHS_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4] as const;
const WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
] as const;

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "condo", label: "Condo" },
  { value: "coop", label: "Co-op" },
  { value: "house", label: "House" },
  { value: "multi_family", label: "Multi-family" },
];

type SearchCadence = "manual" | "daily" | "weekly" | "monthly";
type SourceAdapterId = "streeteasy" | "loopnet";

const SOURCE_OPTIONS: { value: SourceAdapterId; label: string; savedSearch: boolean }[] = [
  { value: "streeteasy", label: "StreetEasy", savedSearch: true },
  { value: "loopnet", label: "LoopNet", savedSearch: false },
];

const DEFAULT_SOURCE_TOGGLES: Record<SourceAdapterId, boolean> = {
  streeteasy: true,
  loopnet: false,
};

interface RunCriteria {
  source?: SourceAdapterId | string | null;
  areas: string;
  location?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  maxBeds?: number | null;
  minBaths?: number | null;
  maxHoa?: number | null;
  maxTax?: number | null;
  amenities?: string | null;
  types?: string | null;
  limit?: number | null;
  offset?: number | null;
  manualUrls?: string[] | null;
  manualUrl?: string | null;
}

interface RunRow {
  id: string;
  startedAt: string;
  source?: SourceAdapterId;
  sourceLabel?: string;
  criteria: RunCriteria;
  step1Status: string;
  step1Label?: string;
  step1Count: number;
  step1Error: string | null;
  step2Status: string;
  step2Label?: string;
  step2Count: number;
  step2Total: number;
  step2Error: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  propertiesCount: number;
  errorsCount: number;
  warningsCount?: number;
}

interface SavedSearch {
  id: string;
  name: string;
  enabled: boolean;
  locationMode: "single" | "multi";
  singleLocationSlug: string | null;
  areaCodes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  minBeds: number | null;
  maxBeds: number | null;
  minBaths: number | null;
  maxBaths: number | null;
  maxHoa: number | null;
  maxTax: number | null;
  minSqft: number | null;
  maxSqft: number | null;
  requiredAmenities: string[];
  propertyTypes: string[];
  sourceToggles?: Record<string, boolean | undefined>;
  scheduleCadence: SearchCadence;
  timezone: string;
  runTimeLocal: string | null;
  weeklyRunDay: number | null;
  monthlyRunDay: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  resultLimit: number | null;
  outreachRules: {
    minUnits?: number | null;
    maxPrice?: number | null;
    propertyTypes?: string[] | null;
    requireResolvedRecipient?: boolean;
    minimumRecipientConfidence?: number | null;
  };
  updatedAt: string;
  createdAt: string;
}

type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "partial";

interface SavedSearchWorkflowStep {
  key: string;
  label: string;
  status: WorkflowStatus;
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

interface SavedSearchWorkflowRun {
  id: string;
  runNumber: number;
  runType: string;
  displayName: string;
  scopeLabel: string | null;
  triggerSource: string;
  totalItems: number;
  status: WorkflowStatus;
  startedAt: string;
  finishedAt: string | null;
  metadata?: Record<string, unknown> | null;
  steps: SavedSearchWorkflowStep[];
}

interface SavedSearchRun {
  id: string;
  profileId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  triggerSource?: string;
  metadata?: Record<string, unknown>;
  workflowRunId?: string | null;
  workflowRun?: SavedSearchWorkflowRun | null;
  summary: {
    listingsSeen?: number;
    listingsNew?: number;
    listingsUpdated?: number;
    jobsCompleted?: number;
    jobsFailed?: number;
    errors?: string[];
  } | null;
  createdAt: string;
}

interface LoopNetBrowserCaptureConfig {
  endpointPath: string;
  token: string;
}

interface BuilderFormState {
  manualRunSource: SourceAdapterId;
  manualUrls: string;
  sourceLocation: string;
  sourceToggles: Record<SourceAdapterId, boolean>;
  searchName: string;
  savedSearchEnabled: boolean;
  selectedAreas: string[];
  minPrice: string;
  maxPrice: string;
  minBeds: string;
  maxBeds: string;
  minBaths: string;
  maxHoa: string;
  maxTax: string;
  amenities: string;
  selectedTypes: string[];
  limit: string;
  scheduleCadence: SearchCadence;
  timezone: string;
  runTimeLocal: string;
  weeklyRunDay: string;
  monthlyRunDay: string;
  outreachMinUnits: string;
  requireResolvedRecipient: boolean;
  minimumRecipientConfidence: string;
}

const DEFAULT_FORM_STATE: BuilderFormState = {
  manualRunSource: "streeteasy",
  manualUrls: "",
  sourceLocation: "New York, NY",
  sourceToggles: DEFAULT_SOURCE_TOGGLES,
  searchName: "",
  savedSearchEnabled: true,
  selectedAreas: [],
  minPrice: "",
  maxPrice: "",
  minBeds: "",
  maxBeds: "",
  minBaths: "",
  maxHoa: "",
  maxTax: "",
  amenities: "",
  selectedTypes: [],
  limit: DEFAULT_RESULT_LIMIT,
  scheduleCadence: "manual",
  timezone: DEFAULT_TIMEZONE,
  runTimeLocal: "08:00",
  weeklyRunDay: "1",
  monthlyRunDay: "1",
  outreachMinUnits: "",
  requireResolvedRecipient: true,
  minimumRecipientConfidence: "",
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

function formatRelativeElapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const sec = Math.floor((now - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function durationBetween(startedAt: string | null | undefined, finishedAt: string | null | undefined): number | null {
  const start = timestampMs(startedAt);
  if (start == null) return null;
  const finish = timestampMs(finishedAt) ?? Date.now();
  return finish - start;
}

function workflowStatusLabel(status: WorkflowStatus | SavedSearchRun["status"]): string {
  switch (status) {
    case "running":
      return "In progress";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "partial":
      return "Partial";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

function workflowStatusTone(status: WorkflowStatus | SavedSearchRun["status"]): BadgeTone {
  switch (status) {
    case "running":
      return "info";
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "danger";
    case "partial":
      return "warning";
    default:
      return "neutral";
  }
}

function currentWorkflowStep(workflowRun: SavedSearchWorkflowRun | null | undefined): SavedSearchWorkflowStep | null {
  if (!workflowRun?.steps?.length) return null;
  return (
    workflowRun.steps.find((step) => step.status === "running") ??
    workflowRun.steps.find((step) => step.status === "pending") ??
    workflowRun.steps.find((step) => step.status === "failed" || step.status === "partial") ??
    workflowRun.steps[workflowRun.steps.length - 1] ??
    null
  );
}

function workflowProgressLabel(step: SavedSearchWorkflowStep): string {
  const processed = step.completedItems + step.failedItems + step.skippedItems;
  if (step.totalItems > 0) return `${step.completedItems}/${step.totalItems}`;
  if (processed > 0) return `${processed}`;
  return "—";
}

function sourceMetadataForWorkflow(workflowRun: SavedSearchWorkflowRun | null | undefined): Record<string, unknown> | null {
  const sourceMetadata = workflowRun?.metadata?.sourceMetadata;
  return sourceMetadata && typeof sourceMetadata === "object" && !Array.isArray(sourceMetadata)
    ? sourceMetadata as Record<string, unknown>
    : null;
}

function summarizeSourceRequest(workflowRun: SavedSearchWorkflowRun | null | undefined): string | null {
  const metadata = sourceMetadataForWorkflow(workflowRun);
  const requestParams = metadata?.requestParams;
  if (!requestParams || typeof requestParams !== "object" || Array.isArray(requestParams)) return null;
  const params = requestParams as Record<string, unknown>;
  const parts = [
    typeof params.areas === "string" ? `areas=${params.areas}` : null,
    params.minPrice != null ? `minPrice=${params.minPrice}` : null,
    params.maxPrice != null ? `maxPrice=${params.maxPrice}` : null,
    typeof params.types === "string" ? `types=${params.types}` : null,
    params.limit != null ? `limit=${params.limit}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : null;
}

function summarizeSourcePages(workflowRun: SavedSearchWorkflowRun | null | undefined): string | null {
  const metadata = sourceMetadataForWorkflow(workflowRun);
  const pages = metadata?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  return pages
    .map((page) => {
      if (!page || typeof page !== "object") return null;
      const row = page as Record<string, unknown>;
      return `offset ${row.offset ?? 0}: ${row.returned ?? 0} returned, ${row.uniqueNew ?? 0} new`;
    })
    .filter(Boolean)
    .join(" | ");
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCsvList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sourceLabel(source: string | null | undefined): string {
  return SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? "StreetEasy";
}

function normalizeSourceToggles(value: Record<string, boolean | undefined> | null | undefined): Record<SourceAdapterId, boolean> {
  return {
    streeteasy: value?.streeteasy !== false,
    loopnet: value?.loopnet === true,
  };
}

function toTimeInputValue(value: string | null | undefined): string {
  if (!value) return "08:00";
  const [hours = "08", minutes = "00"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function formatSchedule(search: SavedSearch): string {
  if (search.scheduleCadence === "manual") return "Manual only";
  const time = toTimeInputValue(search.runTimeLocal);
  if (search.scheduleCadence === "daily") return `Daily at ${time} (${search.timezone})`;
  if (search.scheduleCadence === "weekly") {
    const weekday = WEEKDAY_OPTIONS.find((option) => Number(option.value) === search.weeklyRunDay)?.label ?? "Monday";
    return `Weekly on ${weekday} at ${time} (${search.timezone})`;
  }
  return `Monthly on day ${search.monthlyRunDay ?? 1} at ${time} (${search.timezone})`;
}

function formatSearchAreas(search: SavedSearch): string {
  if (search.locationMode === "single" && search.singleLocationSlug) return search.singleLocationSlug;
  if (search.areaCodes.length > 0) return search.areaCodes.join(", ");
  return DEFAULT_AREAS.join(", ");
}

function formatSearchFilters(search: SavedSearch): string {
  const filters: string[] = [`Areas: ${formatSearchAreas(search)}`];
  const toggles = normalizeSourceToggles(search.sourceToggles);
  const enabledSources = SOURCE_OPTIONS.filter((option) => toggles[option.value]).map((option) => option.label);
  if (enabledSources.length > 0) filters.push(`Sources: ${enabledSources.join(", ")}`);
  if (search.minPrice != null || search.maxPrice != null) {
    filters.push(`Price: ${search.minPrice != null ? `$${search.minPrice.toLocaleString()}` : "any"}-${search.maxPrice != null ? `$${search.maxPrice.toLocaleString()}` : "any"}`);
  }
  if (search.minBeds != null || search.maxBeds != null) {
    filters.push(`Beds: ${search.minBeds ?? "any"}-${search.maxBeds ?? "any"}`);
  }
  if (search.minBaths != null) filters.push(`Min baths: ${search.minBaths}`);
  if (search.maxHoa != null) filters.push(`Max HOA: $${search.maxHoa.toLocaleString()}`);
  if (search.maxTax != null) filters.push(`Max tax: $${search.maxTax.toLocaleString()}`);
  if (search.propertyTypes.length > 0) filters.push(`Types: ${search.propertyTypes.join(", ")}`);
  if (search.requiredAmenities.length > 0) filters.push(`Amenities: ${search.requiredAmenities.join(", ")}`);
  if (search.resultLimit != null) filters.push(`Limit: ${search.resultLimit}`);
  return filters.join(" | ");
}

function buildManualRunBody(form: BuilderFormState): RunCriteria {
  const areas = form.selectedAreas.length > 0 ? form.selectedAreas.join(",") : DEFAULT_AREAS.join(",");
  const body: RunCriteria = {
    source: form.manualRunSource,
    areas,
    limit: parseOptionalNumber(form.limit) ?? Number(DEFAULT_RESULT_LIMIT),
  };
  const minPrice = parseOptionalNumber(form.minPrice);
  const maxPrice = parseOptionalNumber(form.maxPrice);
  const minBeds = parseOptionalNumber(form.minBeds);
  const maxBeds = parseOptionalNumber(form.maxBeds);
  const minBaths = parseOptionalNumber(form.minBaths);
  const maxHoa = parseOptionalNumber(form.maxHoa);
  const maxTax = parseOptionalNumber(form.maxTax);
  if (minPrice != null) body.minPrice = minPrice;
  if (maxPrice != null) body.maxPrice = maxPrice;
  if (minBeds != null) body.minBeds = minBeds;
  if (maxBeds != null) body.maxBeds = maxBeds;
  if (minBaths != null) body.minBaths = minBaths;
  if (maxHoa != null) body.maxHoa = maxHoa;
  if (maxTax != null) body.maxTax = maxTax;
  if (form.amenities.trim()) body.amenities = form.amenities.trim();
  if (form.selectedTypes.length > 0) body.types = form.selectedTypes.join(",");
  if (form.manualRunSource !== "streeteasy") {
    body.location = form.sourceLocation.trim() || "New York, NY";
    body.manualUrls = parseCsvList(form.manualUrls);
  }
  return body;
}

function buildLoopNetBookmarklet(endpoint: string, token: string): string {
  const script = `(()=>{const endpoint=${JSON.stringify(endpoint)};const token=${JSON.stringify(token)};try{if(!/loopnet\\.com$/i.test(location.hostname)&&!/\\.loopnet\\.com$/i.test(location.hostname)){alert("Open a LoopNet listing page first.");return;}const metas={};document.querySelectorAll("meta[name],meta[property]").forEach((m)=>{const k=m.getAttribute("property")||m.getAttribute("name");const v=m.getAttribute("content");if(k&&v)metas[k]=v;});const payload={source:"loopnet",captureMode:"bookmarklet",url:location.href,html:document.documentElement.outerHTML,metadata:{documentTitle:document.title,visibleText:(document.body&&document.body.innerText||"").slice(0,60000),images:Array.from(document.images).slice(0,100).map((img)=>img.currentSrc||img.src).filter(Boolean),links:Array.from(document.links).slice(0,200).map((a)=>({href:a.href,text:(a.innerText||a.textContent||"").trim().slice(0,250)})),meta:metas,userAgent:navigator.userAgent}};fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-LoopNet-Capture-Token":token},body:JSON.stringify(payload)}).then(async(r)=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||data.details||"Capture failed");alert("LoopNet captured into Sourcing Agent run "+data.runId);}).catch((e)=>{console.error("[LoopNet capture]",e);alert("LoopNet capture failed: "+(e&&e.message?e.message:e));});}catch(e){console.error("[LoopNet capture]",e);alert("LoopNet capture failed: "+(e&&e.message?e.message:e));}})();`;
  return `javascript:${script}`;
}

function buildSavedSearchPayload(form: BuilderFormState) {
  const selectedAreas = form.selectedAreas.length > 0 ? form.selectedAreas : [...DEFAULT_AREAS];
  const minPrice = parseOptionalNumber(form.minPrice);
  const maxPrice = parseOptionalNumber(form.maxPrice);
  const minBeds = parseOptionalNumber(form.minBeds);
  const maxBeds = parseOptionalNumber(form.maxBeds);
  const minBaths = parseOptionalNumber(form.minBaths);
  const maxHoa = parseOptionalNumber(form.maxHoa);
  const maxTax = parseOptionalNumber(form.maxTax);
  const limit = parseOptionalNumber(form.limit);
  const minUnits = parseOptionalNumber(form.outreachMinUnits);
  const minimumRecipientConfidence = parseOptionalNumber(form.minimumRecipientConfidence);
  const outreachRules: Record<string, unknown> = {
    requireResolvedRecipient: form.requireResolvedRecipient,
  };
  if (minUnits != null) outreachRules.minUnits = minUnits;
  if (minimumRecipientConfidence != null) outreachRules.minimumRecipientConfidence = minimumRecipientConfidence;
  if (maxPrice != null) outreachRules.maxPrice = maxPrice;
  if (form.selectedTypes.length > 0) outreachRules.propertyTypes = form.selectedTypes;

  return {
    name: form.searchName.trim() || "Saved search",
    enabled: form.savedSearchEnabled,
    locationMode: selectedAreas.length === 1 ? "single" : "multi",
    singleLocationSlug: selectedAreas.length === 1 ? selectedAreas[0] : null,
    areaCodes: selectedAreas.length === 1 ? [] : selectedAreas,
    minPrice,
    maxPrice,
    minBeds,
    maxBeds,
    minBaths,
    maxHoa,
    maxTax,
    requiredAmenities: parseCsvList(form.amenities),
    propertyTypes: form.selectedTypes,
    sourceToggles: { ...form.sourceToggles, manual: false },
    scheduleCadence: form.scheduleCadence,
    timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
    runTimeLocal: form.scheduleCadence === "manual" ? null : form.runTimeLocal || "08:00",
    weeklyRunDay: form.scheduleCadence === "weekly" ? Number(form.weeklyRunDay || "1") : null,
    monthlyRunDay: form.scheduleCadence === "monthly" ? Number(form.monthlyRunDay || "1") : null,
    resultLimit: limit,
    outreachRules,
  };
}

function step1Label(run: RunRow): string {
  const label = run.step1Label || "GET Active Sales";
  if (run.step1Status === "running") return `${label}...`;
  if (run.step1Status === "completed") return `${label} completed (${run.step1Count} URL${run.step1Count === 1 ? "" : "s"})`;
  if (run.step1Status === "failed") return `${label} failed${run.step1Error ? `: ${run.step1Error}` : ""}`;
  return `${label} pending`;
}

function step2Label(run: RunRow): string {
  const label = run.step2Label || "GET Sale Details";
  if (run.step2Status === "running") return `${label} in progress (${run.step2Count}/${run.step2Total})`;
  if (run.step2Status === "completed") return `${label} completed (${run.step2Count} properties)`;
  if (run.step2Status === "failed") return `${label} failed${run.step2Error ? `: ${run.step2Error}` : ""}`;
  return `${label} pending`;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(true);
  const [expandedSavedSearchId, setExpandedSavedSearchId] = useState<string | null>(null);
  const [expandedSavedSearchRuns, setExpandedSavedSearchRuns] = useState<SavedSearchRun[]>([]);
  const [savedSearchRunsLoading, setSavedSearchRunsLoading] = useState(false);
  const [editingSavedSearchId, setEditingSavedSearchId] = useState<string | null>(null);
  const [form, setForm] = useState<BuilderFormState>(DEFAULT_FORM_STATE);
  const [areaBoroughTab, setAreaBoroughTab] = useState<string>(BOROUGH_TABS[0]?.id ?? "MANHATTAN");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [startingManualRun, setStartingManualRun] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [runningSavedSearchId, setRunningSavedSearchId] = useState<string | null>(null);
  const processBanner = useProcessBanner();
  const [deletingSavedSearchId, setDeletingSavedSearchId] = useState<string | null>(null);
  const [sendingRunId, setSendingRunId] = useState<string | null>(null);
  const [sendTimerSeconds, setSendTimerSeconds] = useState(0);
  const [loopNetOperatorSessionId, setLoopNetOperatorSessionId] = useState<string | null>(null);
  const [loopNetOperatorBusy, setLoopNetOperatorBusy] = useState(false);
  const [loopNetCapturedHtml, setLoopNetCapturedHtml] = useState("");
  const [loopNetCaptureConfig, setLoopNetCaptureConfig] = useState<LoopNetBrowserCaptureConfig | null>(null);
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/test-agent/runs`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load runs");
      setRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const fetchSavedSearches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load saved searches");
      setSavedSearches(data.savedSearches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved searches");
    } finally {
      setSavedSearchesLoading(false);
    }
  }, []);

  const fetchSavedSearchRuns = useCallback(async (savedSearchId: string) => {
    setSavedSearchRunsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches/${savedSearchId}/runs`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load saved search runs");
      setExpandedSavedSearchRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved search runs");
      setExpandedSavedSearchRuns([]);
    } finally {
      setSavedSearchRunsLoading(false);
    }
  }, []);

  const fetchLoopNetCaptureConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/test-agent/loopnet/browser-capture-config`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load LoopNet capture config");
      setLoopNetCaptureConfig({
        endpointPath: data.endpointPath,
        token: data.token,
      });
    } catch (err) {
      console.warn("[loopnet capture config]", err);
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
    void fetchSavedSearches();
    void fetchLoopNetCaptureConfig();
  }, [fetchRuns, fetchSavedSearches, fetchLoopNetCaptureConfig]);

  useEffect(() => {
    if (sendingRunId) {
      setSendTimerSeconds(0);
      sendTimerRef.current = setInterval(() => setSendTimerSeconds((seconds) => seconds + 1), 1000);
    } else {
      if (sendTimerRef.current) {
        clearInterval(sendTimerRef.current);
        sendTimerRef.current = null;
      }
      setSendTimerSeconds(0);
    }
    return () => {
      if (sendTimerRef.current) {
        clearInterval(sendTimerRef.current);
        sendTimerRef.current = null;
      }
    };
  }, [sendingRunId]);

  const hasRunningManualRun = runs.some(
    (run) => run.step1Status === "running" || run.step1Status === "pending" || run.step2Status === "running"
  );

  useEffect(() => {
    if (!hasRunningManualRun) return;
    const timer = setInterval(() => {
      void fetchRuns();
    }, 2000);
    return () => clearInterval(timer);
  }, [hasRunningManualRun, fetchRuns]);

  const expandedSavedSearchHasRunningRun = expandedSavedSearchRuns.some((run) => run.status === "running");

  useEffect(() => {
    if (!expandedSavedSearchId || !expandedSavedSearchHasRunningRun) return;
    const timer = setInterval(() => {
      void fetchSavedSearchRuns(expandedSavedSearchId);
      void fetchSavedSearches();
    }, 3000);
    return () => clearInterval(timer);
  }, [expandedSavedSearchHasRunningRun, expandedSavedSearchId, fetchSavedSearchRuns, fetchSavedSearches]);

  const updateForm = useCallback((key: keyof BuilderFormState, value: BuilderFormState[keyof BuilderFormState]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const toggleArea = useCallback((value: string) => {
    setForm((current) => ({
      ...current,
      selectedAreas: current.selectedAreas.includes(value)
        ? current.selectedAreas.filter((area) => area !== value)
        : [...current.selectedAreas, value],
    }));
  }, []);

  const toggleType = useCallback((value: string) => {
    setForm((current) => ({
      ...current,
      selectedTypes: current.selectedTypes.includes(value)
        ? current.selectedTypes.filter((type) => type !== value)
        : [...current.selectedTypes, value],
    }));
  }, []);

  const toggleSource = useCallback((source: SourceAdapterId) => {
    setForm((current) => ({
      ...current,
      sourceToggles: {
        ...current.sourceToggles,
        [source]: !current.sourceToggles[source],
      },
    }));
  }, []);

  const resetBuilder = useCallback(() => {
    setEditingSavedSearchId(null);
    setForm(DEFAULT_FORM_STATE);
    setNotice("Search builder reset.");
  }, []);

  const loadSavedSearchIntoForm = useCallback((savedSearch: SavedSearch) => {
    setEditingSavedSearchId(savedSearch.id);
    setForm({
      manualRunSource: "streeteasy",
      manualUrls: "",
      sourceLocation: "New York, NY",
      sourceToggles: normalizeSourceToggles(savedSearch.sourceToggles),
      searchName: savedSearch.name,
      savedSearchEnabled: savedSearch.enabled,
      selectedAreas:
        savedSearch.locationMode === "single"
          ? (savedSearch.singleLocationSlug ? [savedSearch.singleLocationSlug] : [])
          : savedSearch.areaCodes,
      minPrice: savedSearch.minPrice != null ? String(savedSearch.minPrice) : "",
      maxPrice: savedSearch.maxPrice != null ? String(savedSearch.maxPrice) : "",
      minBeds: savedSearch.minBeds != null ? String(savedSearch.minBeds) : "",
      maxBeds: savedSearch.maxBeds != null ? String(savedSearch.maxBeds) : "",
      minBaths: savedSearch.minBaths != null ? String(savedSearch.minBaths) : "",
      maxHoa: savedSearch.maxHoa != null ? String(savedSearch.maxHoa) : "",
      maxTax: savedSearch.maxTax != null ? String(savedSearch.maxTax) : "",
      amenities: savedSearch.requiredAmenities.join(","),
      selectedTypes: savedSearch.propertyTypes,
      limit: savedSearch.resultLimit != null ? String(savedSearch.resultLimit) : DEFAULT_RESULT_LIMIT,
      scheduleCadence: savedSearch.scheduleCadence,
      timezone: savedSearch.timezone || DEFAULT_TIMEZONE,
      runTimeLocal: toTimeInputValue(savedSearch.runTimeLocal),
      weeklyRunDay: String(savedSearch.weeklyRunDay ?? 1),
      monthlyRunDay: String(savedSearch.monthlyRunDay ?? 1),
      outreachMinUnits:
        savedSearch.outreachRules?.minUnits != null ? String(savedSearch.outreachRules.minUnits) : "",
      requireResolvedRecipient: savedSearch.outreachRules?.requireResolvedRecipient !== false,
      minimumRecipientConfidence:
        savedSearch.outreachRules?.minimumRecipientConfidence != null
          ? String(savedSearch.outreachRules.minimumRecipientConfidence)
          : "",
    });
  }, []);

  const renderAreaNodes = useCallback(
    (nodes: AreaNode[], depth: number): ReactNode =>
      nodes.map((node) => {
        const includedByParent = isIncludedByParent(node.value, form.selectedAreas);
        const isChecked = form.selectedAreas.includes(node.value) || includedByParent;
        const isBold = /^all\s/i.test(node.label);
        return (
          <div key={node.value}>
            <label
              className={includedByParent ? `${styles.areaOption} ${styles.areaOptionInherited}` : styles.areaOption}
              /* Indentation depends on recursion depth in the area tree — genuinely dynamic. */
              style={{ paddingLeft: `${depth * 1.25}rem` }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={Boolean(includedByParent)}
                onChange={() => {
                  if (!includedByParent) toggleArea(node.value);
                }}
              />
              <span className={isBold ? styles.areaOptionNameBold : undefined}>{node.label}</span>
            </label>
            {node.children?.length ? renderAreaNodes(node.children, depth + 1) : null}
          </div>
        );
      }),
    [form.selectedAreas, toggleArea]
  );

  const handleManualRunSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setStartingManualRun(true);
    try {
      const res = await fetch(`${API_BASE}/api/test-agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildManualRunBody(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to start run");
      setNotice(`Manual ${sourceLabel(form.manualRunSource)} run started.`);
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setStartingManualRun(false);
    }
  };

  const getPrimaryLoopNetUrl = useCallback((): string | null => {
    const firstUrl = parseCsvList(form.manualUrls)[0] ?? null;
    return firstUrl?.trim() || null;
  }, [form.manualUrls]);

  const loopNetBookmarklet = loopNetCaptureConfig
    ? buildLoopNetBookmarklet(`${API_BASE}${loopNetCaptureConfig.endpointPath}`, loopNetCaptureConfig.token)
    : "";

  const handleCopyLoopNetBookmarklet = async () => {
    setBookmarkletCopied(false);
    if (!loopNetBookmarklet) {
      setError("LoopNet browser capture config is not ready yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(loopNetBookmarklet);
      setBookmarkletCopied(true);
      setNotice("LoopNet bookmarklet copied.");
    } catch {
      setError("Could not copy the bookmarklet automatically. Select the text and copy it manually.");
    }
  };

  const handleStartLoopNetOperator = async () => {
    setError(null);
    setNotice(null);
    const url = getPrimaryLoopNetUrl();
    if (!url) {
      setError("Paste a LoopNet listing URL first.");
      return;
    }
    setLoopNetOperatorBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/test-agent/loopnet/operator/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to start LoopNet browser capture");
      setLoopNetOperatorSessionId(data.session?.id ?? null);
      setNotice("LoopNet browser opened. Load the listing manually, then click Capture loaded page.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start LoopNet browser capture");
    } finally {
      setLoopNetOperatorBusy(false);
    }
  };

  const handleCaptureLoopNetOperator = async () => {
    setError(null);
    setNotice(null);
    if (!loopNetOperatorSessionId) {
      setError("Start a LoopNet browser capture first.");
      return;
    }
    setLoopNetOperatorBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/test-agent/loopnet/operator/${loopNetOperatorSessionId}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ close: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to capture LoopNet page");
      setLoopNetOperatorSessionId(null);
      setNotice(`LoopNet page captured into manual run ${data.runId}.`);
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture LoopNet page");
    } finally {
      setLoopNetOperatorBusy(false);
    }
  };

  const handleCaptureLoopNetHtml = async () => {
    setError(null);
    setNotice(null);
    const url = getPrimaryLoopNetUrl();
    if (!url) {
      setError("Paste a LoopNet listing URL first.");
      return;
    }
    if (!loopNetCapturedHtml.trim()) {
      setError("Paste saved LoopNet HTML first.");
      return;
    }
    setLoopNetOperatorBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/test-agent/loopnet/html-capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html: loopNetCapturedHtml }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to capture LoopNet HTML");
      setLoopNetCapturedHtml("");
      setNotice(`LoopNet saved HTML captured into manual run ${data.runId}.`);
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture LoopNet HTML");
    } finally {
      setLoopNetOperatorBusy(false);
    }
  };

  const handleSaveSearch = async () => {
    setError(null);
    setNotice(null);
    setSavingSearch(true);
    try {
      const isEditing = Boolean(editingSavedSearchId);
      const res = await fetch(
        isEditing
          ? `${API_BASE}/api/saved-searches/${editingSavedSearchId}`
          : `${API_BASE}/api/saved-searches`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildSavedSearchPayload(form)),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to save saved search");
      const savedSearch = data.savedSearch as SavedSearch;
      loadSavedSearchIntoForm(savedSearch);
      await fetchSavedSearches();
      if (expandedSavedSearchId === savedSearch.id) {
        await fetchSavedSearchRuns(savedSearch.id);
      }
      setNotice(isEditing ? "Saved search updated." : "Saved search created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save saved search");
    } finally {
      setSavingSearch(false);
    }
  };

  /** Latest run's workflowRunId so the global banner can poll a run to completion (survives reloads). */
  const findLatestWorkflowRunId = async (savedSearchId: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches/${savedSearchId}/runs`);
      const data = await res.json().catch(() => ({}));
      const runs = Array.isArray(data?.runs) ? data.runs : [];
      const withWorkflow = runs.find(
        (run: Record<string, unknown>) => typeof run.workflowRunId === "string" && run.workflowRunId
      );
      return withWorkflow ? String(withWorkflow.workflowRunId) : null;
    } catch {
      return null;
    }
  };

  const handleRunSavedSearchNow = async (savedSearchId: string) => {
    setError(null);
    setNotice(null);
    setRunningSavedSearchId(savedSearchId);
    const searchName = savedSearches.find((savedSearch) => savedSearch.id === savedSearchId)?.name ?? "Saved search";
    const banner = processBanner.start(`Saved-search run: ${searchName}`, {
      message: "Starting StreetEasy search…",
    });
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches/${savedSearchId}/run-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.status === 409 || data?.code === "already_running") {
        setExpandedSavedSearchId(savedSearchId);
        setNotice("Saved search is already running. Open Property Data for the live workflow tracker while it continues ingesting and enrichment catches up.");
        banner.update("Already running — attaching to the live run…");
        const existingWorkflowRunId = await findLatestWorkflowRunId(savedSearchId);
        if (existingWorkflowRunId) banner.attachWorkflowRun(existingWorkflowRunId);
        else banner.succeed("Already running — see Property Data for the live workflow tracker.");
        window.setTimeout(() => {
          void fetchSavedSearches();
          void fetchSavedSearchRuns(savedSearchId);
        }, 400);
        return;
      }
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to start saved search run");
      setExpandedSavedSearchId(savedSearchId);
      setNotice("Saved search run started. Open Property Data for the live workflow tracker while it ingests, enriches, and evaluates outreach.");
      banner.update("Run started — ingesting listings, then enrichment…");
      window.setTimeout(() => {
        void fetchSavedSearches();
        void fetchSavedSearchRuns(savedSearchId);
      }, 1200);
      // Attach the server workflow run so progress streams into the banner.
      window.setTimeout(() => {
        void findLatestWorkflowRunId(savedSearchId).then((workflowRunId) => {
          if (workflowRunId) banner.attachWorkflowRun(workflowRunId);
          else banner.succeed("Run started — see Property Data for the live workflow tracker.");
        });
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start saved search run";
      banner.fail(message);
      setError(message);
    } finally {
      setRunningSavedSearchId(null);
    }
  };

  const handleDeleteSavedSearch = async (savedSearchId: string) => {
    const target = savedSearches.find((savedSearch) => savedSearch.id === savedSearchId);
    const label = target?.name || "this saved search";
    if (!window.confirm(`Delete ${label}?`)) return;
    setError(null);
    setNotice(null);
    setDeletingSavedSearchId(savedSearchId);
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches/${savedSearchId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to delete saved search");
      if (editingSavedSearchId === savedSearchId) {
        setEditingSavedSearchId(null);
        setForm(DEFAULT_FORM_STATE);
      }
      if (expandedSavedSearchId === savedSearchId) {
        setExpandedSavedSearchId(null);
        setExpandedSavedSearchRuns([]);
      }
      await fetchSavedSearches();
      setNotice("Saved search deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete saved search");
    } finally {
      setDeletingSavedSearchId(null);
    }
  };

  const handleToggleSavedSearchRuns = async (savedSearchId: string) => {
    setError(null);
    if (expandedSavedSearchId === savedSearchId) {
      setExpandedSavedSearchId(null);
      setExpandedSavedSearchRuns([]);
      return;
    }
    setExpandedSavedSearchId(savedSearchId);
    await fetchSavedSearchRuns(savedSearchId);
  };

  const handleSendToPropertyData = async (runId: string) => {
    setSendingRunId(runId);
    setError(null);
    setNotice(null);
    const banner = processBanner.start("Send to property data", {
      message: "Creating canonical properties and running enrichment + rental flow — this can take several minutes…",
    });
    try {
      const res = await fetch(`${API_BASE}/api/test-agent/runs/${runId}/send-to-property-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.details ? ` - ${data.details}` : "";
        throw new Error((data?.error || "Failed to send to property data") + detail);
      }
      setSendingRunId(null);
      const runNumber = data?.runNumber != null ? ` Run #${data.runNumber} logged.` : "";
      const message =
        (data?.created ?? 0) > 0 || (data?.updated ?? 0) > 0
          ? `${data?.created ?? 0} created, ${data?.updated ?? 0} updated.${runNumber}`
          : runNumber || "Sent.";
      banner.succeed(`Sent to property data: ${message}`);
      window.location.href = `/property-data?sent=${encodeURIComponent(message)}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send to property data";
      banner.fail(message);
      setError(message);
      setSendingRunId(null);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Sourcing Agent" />

      {sendingRunId ? (
        <div className={styles.sendingBanner} role="status" aria-live="polite">
          <span className={styles.sendingBannerText}>
            Sending to property data - enriching brokers and price history...
          </span>
          <span className={styles.sendingBannerTimer}>
            {formatElapsed(sendTimerSeconds)}
          </span>
        </div>
      ) : null}

      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {error ? <div className={styles.error}>{error}</div> : null}

      <Panel padding="lg">
        <h2 className={styles.sectionTitle}>
          <Info size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
          How it works
        </h2>
        <p className={styles.howCopy}>
          Sourcing Agent now does two jobs from one surface: one-off manual pulls and persistent automated saved searches.
        </p>
        <ol className={styles.howList}>
          <li>
            <strong>Run once:</strong> uses the selected source flow, keeps the run in memory, and still requires{" "}
            <strong>Send to property data</strong> after review.
          </li>
          <li>
            <strong>Save search:</strong> stores the same search definition with cadence and sourcing rules. Scheduled or
            manual saved-search runs automatically ingest listings, create canonical properties, and sync sourcing workflow state.
          </li>
        </ol>
        <p className={styles.howCopy}>
          Use the builder below for both paths. The manual run log remains separate from saved-search automation history because the
          saved-search pipeline persists real ingestion runs in Postgres.
        </p>
        <p className={styles.footnote}>
          Ensure <code>RAPIDAPI_KEY</code> is set in the API server environment. Scheduled searches also depend on the saved-search cron endpoint.
        </p>
      </Panel>

      <form onSubmit={handleManualRunSubmit} className={styles.builderCard}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>
              <SlidersHorizontal size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
              Search builder
            </h2>
            <p className={styles.sectionSub}>
              Build the StreetEasy query once, then either run it immediately or save it as automation.
            </p>
          </div>
          {editingSavedSearchId ? <Badge tone="info">Editing saved search</Badge> : null}
        </div>

        <div className={styles.formGrid}>
          <div>
            <label className={styles.fieldLabel}>
              Saved search name
            </label>
            <input
              type="text"
              value={form.searchName}
              onChange={(event) => updateForm("searchName", event.target.value)}
              className={styles.input}
              placeholder="West Village multifamily"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Schedule cadence
            </label>
            <select
              value={form.scheduleCadence}
              onChange={(event) => updateForm("scheduleCadence", event.target.value as SearchCadence)}
              className={styles.input}
            >
              <option value="manual">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Run source
            </label>
            <select
              value={form.manualRunSource}
              onChange={(event) => updateForm("manualRunSource", event.target.value as SourceAdapterId)}
              className={styles.input}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Timezone
            </label>
            <input
              type="text"
              value={form.timezone}
              onChange={(event) => updateForm("timezone", event.target.value)}
              className={styles.input}
              placeholder="America/New_York"
            />
          </div>
          <div className={styles.checkboxField}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={form.savedSearchEnabled}
                onChange={(event) => updateForm("savedSearchEnabled", event.target.checked)}
              />
              Saved search enabled
            </label>
          </div>
        </div>

        {form.scheduleCadence !== "manual" ? (
          <div className={styles.scheduleGrid}>
            <div>
              <label className={styles.fieldLabel}>
                Run time
              </label>
              <input
                type="time"
                value={form.runTimeLocal}
                onChange={(event) => updateForm("runTimeLocal", event.target.value)}
                className={styles.input}
              />
            </div>
            {form.scheduleCadence === "weekly" ? (
              <div>
                <label className={styles.fieldLabel}>
                  Weekly run day
                </label>
                <select
                  value={form.weeklyRunDay}
                  onChange={(event) => updateForm("weeklyRunDay", event.target.value)}
                  className={styles.input}
                >
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {form.scheduleCadence === "monthly" ? (
              <div>
                <label className={styles.fieldLabel}>
                  Monthly run day
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.monthlyRunDay}
                  onChange={(event) => updateForm("monthlyRunDay", event.target.value)}
                  className={styles.input}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {form.manualRunSource !== "streeteasy" ? (
          <div className={styles.loopnetGrid}>
            {form.manualRunSource === "loopnet" ? (
              <div>
                <label className={styles.fieldLabel}>
                  LoopNet location
                </label>
                <input
                  type="text"
                  value={form.sourceLocation}
                  onChange={(event) => updateForm("sourceLocation", event.target.value)}
                  className={styles.input}
                  placeholder="New York, NY"
                />
              </div>
            ) : null}
            <div className={styles.spanFull}>
              <label className={styles.fieldLabel}>
                Manual listing URLs
              </label>
              <textarea
                value={form.manualUrls}
                onChange={(event) => updateForm("manualUrls", event.target.value)}
                className={styles.textarea}
                rows={3}
                placeholder="Paste one URL per line or comma-separated"
              />
            </div>
            {form.manualRunSource === "loopnet" ? (
              <div className={styles.captureStack}>
                <div className={styles.captureCard}>
                  <div>
                    <h3 className={styles.subPanelTitle}>LoopNet browser capture</h3>
                    <p className={styles.subPanelHint}>
                      Preferred: Chrome extension or bookmarklet from your normal browser session. Fallbacks: pasted HTML, then local Playwright browser capture.
                    </p>
                  </div>
                  <div className={styles.buttonRow}>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!loopNetBookmarklet}
                      onClick={handleCopyLoopNetBookmarklet}
                    >
                      Copy bookmarklet
                    </Button>
                    <span className={bookmarkletCopied ? `${styles.copyHint} ${styles.copyHintDone}` : styles.copyHint}>
                      {bookmarkletCopied ? "Copied" : "Drag or paste into a browser bookmark, then click it on a LoopNet listing."}
                    </span>
                  </div>
                  <div>
                    <label className={styles.fieldLabel}>
                      Extension capture token
                    </label>
                    <input
                      value={loopNetCaptureConfig?.token ?? ""}
                      readOnly
                      className={`${styles.input} ${styles.monoField}`}
                      placeholder="Token loads after capture config is available"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </div>
                  <textarea
                    value={loopNetBookmarklet}
                    readOnly
                    className={`${styles.textarea} ${styles.monoField}`}
                    rows={2}
                    placeholder="Bookmarklet loads after capture config is available"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </div>
                <div className={styles.buttonRow}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loopNetOperatorBusy}
                    onClick={handleStartLoopNetOperator}
                  >
                    Open browser capture
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={loopNetOperatorBusy || !loopNetOperatorSessionId}
                    onClick={handleCaptureLoopNetOperator}
                  >
                    Capture loaded page
                  </Button>
                </div>
                <div>
                  <label className={styles.fieldLabel}>
                    Saved page HTML
                  </label>
                  <textarea
                    value={loopNetCapturedHtml}
                    onChange={(event) => setLoopNetCapturedHtml(event.target.value)}
                    className={styles.textarea}
                    rows={3}
                    placeholder="Optional: paste saved LoopNet HTML for the first URL above"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loopNetOperatorBusy || !loopNetCapturedHtml.trim()}
                    onClick={handleCaptureLoopNetHtml}
                    className={styles.captureHtmlAction}
                  >
                    Capture pasted HTML
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={styles.subPanel}>
          <h3 className={styles.subPanelTitle}>Saved-search sources</h3>
          <div className={styles.sourceToggleRow}>
            {SOURCE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={option.savedSearch ? styles.sourceToggle : `${styles.sourceToggle} ${styles.sourceToggleDisabled}`}
              >
                <input
                  type="checkbox"
                  checked={form.sourceToggles[option.value]}
                  disabled={!option.savedSearch}
                  onChange={() => toggleSource(option.value)}
                />
                {option.label}
                {!option.savedSearch ? " (manual only)" : ""}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.subPanel}>
          <div className={styles.subPanelHead}>
            <h3 className={styles.subPanelTitle}>Outreach automation rules</h3>
            <p className={styles.subPanelHint}>
              These rules are applied after saved-search ingestion when the sourcing workflow decides whether the property is ready for automated outreach.
            </p>
          </div>
          <div className={styles.outreachGrid}>
            <div>
              <label className={styles.fieldLabel}>
                Minimum units
              </label>
              <input
                type="number"
                min={1}
                value={form.outreachMinUnits}
                onChange={(event) => updateForm("outreachMinUnits", event.target.value)}
                className={styles.input}
                placeholder="-"
              />
            </div>
            <div>
              <label className={styles.fieldLabel}>
                Minimum recipient confidence (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={form.minimumRecipientConfidence}
                onChange={(event) => updateForm("minimumRecipientConfidence", event.target.value)}
                className={styles.input}
                placeholder="-"
              />
            </div>
            <div className={styles.checkboxField}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.requireResolvedRecipient}
                  onChange={(event) => updateForm("requireResolvedRecipient", event.target.checked)}
                />
                Require resolved recipient
              </label>
            </div>
          </div>
          <p className={styles.footnote}>
            Search max price and property types are also copied into the saved-search outreach rules.
          </p>
        </div>

        <div className={styles.fieldBlock}>
          <label className={styles.groupLabel}>
            Areas (required) - select one or more boroughs for the same search
          </label>
          <div className={styles.areaTabs}>
            {BOROUGH_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAreaBoroughTab(tab.id)}
                className={areaBoroughTab === tab.id ? `${styles.areaTab} ${styles.areaTabActive}` : styles.areaTab}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className={styles.areaList}>
            {BOROUGH_TABS.find((tab) => tab.id === areaBoroughTab)?.tree.map((node) => renderAreaNodes([node], 0))}
          </div>
          <p className={styles.footnote}>
            Selected: {form.selectedAreas.length > 0 ? form.selectedAreas.join(", ") : `${DEFAULT_AREAS[0]}, ${DEFAULT_AREAS[1]} (default)`}
          </p>
        </div>

        <div className={styles.filtersGrid}>
          <div>
            <label className={styles.fieldLabel}>
              Min price
            </label>
            <input
              type="number"
              value={form.minPrice}
              onChange={(event) => updateForm("minPrice", event.target.value)}
              className={styles.input}
              placeholder="-"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Max price
            </label>
            <input
              type="number"
              value={form.maxPrice}
              onChange={(event) => updateForm("maxPrice", event.target.value)}
              className={styles.input}
              placeholder="-"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Min beds
            </label>
            <select
              value={form.minBeds}
              onChange={(event) => updateForm("minBeds", event.target.value)}
              className={styles.input}
            >
              <option value="">-</option>
              {BEDS_BATHS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Max beds
            </label>
            <select
              value={form.maxBeds}
              onChange={(event) => updateForm("maxBeds", event.target.value)}
              className={styles.input}
            >
              <option value="">-</option>
              {BEDS_BATHS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Min baths
            </label>
            <select
              value={form.minBaths}
              onChange={(event) => updateForm("minBaths", event.target.value)}
              className={styles.input}
            >
              <option value="">-</option>
              {BEDS_BATHS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Max HOA/mo
            </label>
            <input
              type="number"
              min={0}
              value={form.maxHoa}
              onChange={(event) => updateForm("maxHoa", event.target.value)}
              className={styles.input}
              placeholder="-"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Max tax/mo
            </label>
            <input
              type="number"
              min={0}
              value={form.maxTax}
              onChange={(event) => updateForm("maxTax", event.target.value)}
              className={styles.input}
              placeholder="-"
            />
          </div>
          <div>
            <label className={styles.fieldLabel}>
              Limit (properties)
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={form.limit}
              onChange={(event) => updateForm("limit", event.target.value)}
              className={styles.input}
            />
          </div>
        </div>

        <div className={styles.fieldBlock}>
          <label className={styles.fieldLabel}>
            Amenities (e.g. washer_dryer,doorman)
          </label>
          <input
            type="text"
            value={form.amenities}
            onChange={(event) => updateForm("amenities", event.target.value)}
            className={`${styles.input} ${styles.inputNarrow}`}
            placeholder="-"
          />
        </div>

        <div className={styles.fieldBlock}>
          <label className={styles.groupLabel}>
            Property types
          </label>
          <div className={styles.typeOptionsBox}>
            {TYPE_OPTIONS.map((option) => (
              <label key={option.value} className={styles.typeOption}>
                <input
                  type="checkbox"
                  checked={form.selectedTypes.includes(option.value)}
                  onChange={() => toggleType(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className={styles.footnote}>
            Condo, Co-op, House, Multi-family. Leave all unchecked for all types.
          </p>
        </div>

        <div className={styles.buttonRow}>
          <Button type="submit" disabled={startingManualRun} variant="primary">
            {startingManualRun ? "Starting run..." : "Run once"}
          </Button>
          <Button
            type="button"
            disabled={savingSearch}
            variant="secondary"
            onClick={() => {
              void handleSaveSearch();
            }}
          >
            {savingSearch ? "Saving..." : editingSavedSearchId ? "Update saved search" : "Create saved search"}
          </Button>
          <Button type="button" variant="secondary" onClick={resetBuilder}>
            {editingSavedSearchId ? "Stop editing" : "Reset builder"}
          </Button>
        </div>
      </form>

      <Panel padding="lg">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>
              <CalendarClock size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
              Automated saved searches
            </h2>
            <p className={styles.sectionSub}>
              Saved-search runs automatically ingest into Property Data and sourcing workflow. Use manual runs below when you want a review gate first.
            </p>
          </div>
        </div>

        {savedSearchesLoading ? (
          <SkeletonRows count={3} />
        ) : savedSearches.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={16} strokeWidth={2} aria-hidden="true" />}
            title="No saved searches yet."
            description="Use the builder above and click Create saved search."
          />
        ) : (
          <div className={styles.savedSearchList}>
            {savedSearches.map((savedSearch) => {
              const isExpanded = expandedSavedSearchId === savedSearch.id;
              return (
                <article
                  key={savedSearch.id}
                  className={isExpanded ? `${styles.savedSearchCard} ${styles.savedSearchCardExpanded}` : styles.savedSearchCard}
                >
                  <div className={styles.savedSearchTop}>
                    <div className={styles.savedSearchInfo}>
                      <div className={styles.savedSearchTitleRow}>
                        <h3 className={styles.savedSearchName}>{savedSearch.name}</h3>
                        <Badge tone={savedSearch.enabled ? "success" : "neutral"}>
                          {savedSearch.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        <Badge tone="info">{formatSchedule(savedSearch)}</Badge>
                      </div>
                      <p className={styles.savedSearchFilters}>
                        {formatSearchFilters(savedSearch)}
                      </p>
                      <p className={styles.savedSearchMeta}>
                        Next run: {formatDateTime(savedSearch.nextRunAt)} | Last run: {formatDateTime(savedSearch.lastRunAt)} | Last success:{" "}
                        {formatDateTime(savedSearch.lastSuccessAt)}
                      </p>
                    </div>
                    <div className={styles.savedSearchActions}>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          loadSavedSearchIntoForm(savedSearch);
                          setNotice(`Loaded "${savedSearch.name}" into the builder.`);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={runningSavedSearchId === savedSearch.id}
                        onClick={() => {
                          void handleRunSavedSearchNow(savedSearch.id);
                        }}
                      >
                        {runningSavedSearchId === savedSearch.id ? "Starting..." : "Run now"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          void handleToggleSavedSearchRuns(savedSearch.id);
                        }}
                      >
                        {isExpanded ? "Hide runs" : "View runs"}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={deletingSavedSearchId === savedSearch.id}
                        onClick={() => {
                          void handleDeleteSavedSearch(savedSearch.id);
                        }}
                      >
                        {deletingSavedSearchId === savedSearch.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className={styles.runHistory}>
                      <h4 className={styles.runHistoryTitle}>Saved-search run history</h4>
                      {savedSearchRunsLoading ? (
                        <SkeletonRows count={3} />
                      ) : expandedSavedSearchRuns.length === 0 ? (
                        <p className={styles.emptyNote}>No runs yet.</p>
                      ) : (
                        <div className={styles.tableScroll}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>Started</th>
                                <th>Status</th>
                                <th>Current stage</th>
                                <th>Elapsed</th>
                                <th>Trigger</th>
                                <th className={styles.cellNum}>Seen</th>
                                <th className={styles.cellNum}>New</th>
                                <th className={styles.cellNum}>Updated</th>
                                <th>Errors</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedSavedSearchRuns.slice(0, 10).map((run) => {
                                const workflowRun = run.workflowRun ?? null;
                                const activeStep = currentWorkflowStep(workflowRun);
                                const stageLabel = activeStep?.label ?? (workflowRun ? workflowStatusLabel(workflowRun.status) : "Run summary only");
                                const runDuration = formatDurationMs(durationBetween(workflowRun?.startedAt ?? run.startedAt, workflowRun?.finishedAt ?? run.finishedAt));
                                const stageDuration = activeStep ? formatDurationMs(durationBetween(activeStep.startedAt, activeStep.finishedAt)) : "—";
                                const runStatusTone = workflowStatusTone(workflowRun?.status ?? run.status);
                                const errorText = run.summary?.errors?.length ? run.summary.errors[0] : null;
                                const sourceRequest = summarizeSourceRequest(workflowRun);
                                const sourcePages = summarizeSourcePages(workflowRun);
                                return (
                                  <Fragment key={run.id}>
                                    <tr className={workflowRun ? styles.rowJoined : undefined}>
                                      <td>
                                        <div>{formatDateTime(run.startedAt)}</div>
                                        <div className={styles.cellSub}>
                                          {run.finishedAt ? `Finished ${formatDateTime(run.finishedAt)}` : "Still running"}
                                        </div>
                                      </td>
                                      <td>
                                        <Badge tone={runStatusTone}>
                                          {workflowStatusLabel(workflowRun?.status ?? run.status)}
                                        </Badge>
                                        {workflowRun ? (
                                          <div className={styles.workflowTag}>Workflow #{workflowRun.runNumber}</div>
                                        ) : null}
                                      </td>
                                      <td className={styles.stageCell}>
                                        <div className={styles.stageName}>{stageLabel}</div>
                                        {activeStep ? (
                                          <div className={styles.stageProgress}>
                                            {workflowProgressLabel(activeStep)}
                                            {activeStep.failedItems > 0 ? ` · ${activeStep.failedItems} failed` : ""}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td>
                                        <div className={styles.elapsedMain}>{runDuration}</div>
                                        {activeStep ? <div className={styles.cellSub}>Stage {stageDuration}</div> : null}
                                      </td>
                                      <td>
                                        {run.triggerSource ?? "—"}
                                      </td>
                                      <td className={styles.cellNum}>
                                        {run.summary?.listingsSeen ?? 0}
                                      </td>
                                      <td className={styles.cellNum}>
                                        {run.summary?.listingsNew ?? 0}
                                      </td>
                                      <td className={styles.cellNum}>
                                        {run.summary?.listingsUpdated ?? 0}
                                      </td>
                                      <td className={styles.errorCell}>
                                        <span title={errorText ?? undefined} className={errorText ? styles.errorText : styles.mutedText}>
                                          {errorText ?? "—"}
                                        </span>
                                      </td>
                                    </tr>
                                    {workflowRun ? (
                                      <tr>
                                        <td colSpan={9} className={styles.workflowCell}>
                                          {sourceRequest || sourcePages ? (
                                            <div className={styles.sourceMetaBox}>
                                              {sourceRequest ? <div><strong>RapidAPI request:</strong> {sourceRequest}</div> : null}
                                              {sourcePages ? <div><strong>Pages:</strong> {sourcePages}</div> : null}
                                            </div>
                                          ) : null}
                                          <div className={styles.stepGrid}>
                                            {workflowRun.steps.length === 0 ? (
                                              <div className={styles.stepEmpty}>No stage records yet.</div>
                                            ) : (
                                              workflowRun.steps.map((step) => {
                                                const note = step.lastError ?? step.lastMessage ?? null;
                                                return (
                                                  <div key={`${workflowRun.id}-${step.key}`} className={styles.stepCard}>
                                                    <div className={styles.stepCardHead}>
                                                      <strong className={styles.stepName}>{step.label}</strong>
                                                      <Badge tone={workflowStatusTone(step.status)} className={styles.stepBadge}>
                                                        {workflowStatusLabel(step.status)}
                                                      </Badge>
                                                    </div>
                                                    <div className={styles.stepProgress}>
                                                      {workflowProgressLabel(step)} · {formatDurationMs(durationBetween(step.startedAt, step.finishedAt))}
                                                    </div>
                                                    {note ? (
                                                      <div
                                                        title={note}
                                                        className={step.lastError ? `${styles.stepNote} ${styles.stepNoteError}` : styles.stepNote}
                                                      >
                                                        {note}
                                                      </div>
                                                    ) : null}
                                                  </div>
                                                );
                                              })
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ) : null}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel padding="lg">
        <h2 className={styles.sectionTitle}>
          <History size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
          Manual sourcing run log
        </h2>
        {runsLoading ? (
          <SkeletonRows count={4} />
        ) : runs.length === 0 ? (
          <EmptyState
            icon={<History size={16} strokeWidth={2} aria-hidden="true" />}
            title="No manual runs yet."
            description="Use the builder above and click Run once."
          />
        ) : (
          <div className={`${styles.tableScroll} ${styles.logScroll}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    Started (timer)
                  </th>
                  <th>
                    Source
                  </th>
                  <th>
                    Step 1
                  </th>
                  <th>
                    Step 2
                  </th>
                  <th className={styles.cellNum}>
                    Properties
                  </th>
                  <th>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <div>{formatDateTime(run.startedAt)}</div>
                      <div className={styles.cellSub}>
                        Elapsed: {formatRelativeElapsed(run.startedAt)}
                      </div>
                    </td>
                    <td>
                      {run.sourceLabel ?? sourceLabel(run.source)}
                      {run.warningsCount ? (
                        <div className={styles.warnNote}>
                          {run.warningsCount} note{run.warningsCount === 1 ? "" : "s"}
                        </div>
                      ) : null}
                    </td>
                    <td>{step1Label(run)}</td>
                    <td>{step2Label(run)}</td>
                    <td className={styles.cellNum}>
                      {run.propertiesCount}
                      {run.errorsCount > 0 ? (
                        <span className={styles.errorInline}>
                          ({run.errorsCount} errors)
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {typeof run.sourceMetadata?.searchUrl === "string" ? (
                        <a
                          href={run.sourceMetadata.searchUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`${styles.link} ${styles.tableAction}`}
                        >
                          Open search
                        </a>
                      ) : null}
                      <Link href={`/runs/${run.id}`} className={`${styles.link} ${styles.tableAction}`}>
                        View properties
                      </Link>
                      {run.step2Status === "completed" && run.propertiesCount > 0 ? (
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={sendingRunId === run.id}
                          onClick={() => {
                            void handleSendToPropertyData(run.id);
                          }}
                        >
                          {sendingRunId === run.id ? "Sending..." : "Send to property data"}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
