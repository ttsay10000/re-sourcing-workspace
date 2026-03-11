"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { BOROUGH_TABS, isIncludedByParent, type AreaNode } from "./areas";

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

interface RunCriteria {
  areas: string;
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
}

interface RunRow {
  id: string;
  startedAt: string;
  criteria: RunCriteria;
  step1Status: string;
  step1Count: number;
  step1Error: string | null;
  step2Status: string;
  step2Count: number;
  step2Total: number;
  step2Error: string | null;
  propertiesCount: number;
  errorsCount: number;
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

interface SavedSearchRun {
  id: string;
  profileId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  triggerSource?: string;
  metadata?: Record<string, unknown>;
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

interface BuilderFormState {
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

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  return body;
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
    sourceToggles: { streeteasy: true, manual: false },
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
  if (run.step1Status === "running") return "GET Active Sales...";
  if (run.step1Status === "completed") return `GET Active Sales completed (${run.step1Count} properties)`;
  if (run.step1Status === "failed") return `GET Active Sales failed${run.step1Error ? `: ${run.step1Error}` : ""}`;
  return "GET Active Sales pending";
}

function step2Label(run: RunRow): string {
  if (run.step2Status === "running") return `GET Sale Details in progress (${run.step2Count}/${run.step2Total})`;
  if (run.step2Status === "completed") return `GET Sale Details completed (${run.step2Count} properties)`;
  if (run.step2Status === "failed") return `GET Sale Details failed${run.step2Error ? `: ${run.step2Error}` : ""}`;
  return "GET Sale Details pending";
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
  const [deletingSavedSearchId, setDeletingSavedSearchId] = useState<string | null>(null);
  const [sendingRunId, setSendingRunId] = useState<string | null>(null);
  const [sendTimerSeconds, setSendTimerSeconds] = useState(0);
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

  useEffect(() => {
    void fetchRuns();
    void fetchSavedSearches();
  }, [fetchRuns, fetchSavedSearches]);

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

  const resetBuilder = useCallback(() => {
    setEditingSavedSearchId(null);
    setForm(DEFAULT_FORM_STATE);
    setNotice("Search builder reset.");
  }, []);

  const loadSavedSearchIntoForm = useCallback((savedSearch: SavedSearch) => {
    setEditingSavedSearchId(savedSearch.id);
    setForm({
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
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "0.5rem",
                fontSize: "0.85rem",
                cursor: includedByParent ? "default" : "pointer",
                paddingLeft: `${depth * 1.25}rem`,
                opacity: includedByParent ? 0.6 : 1,
                color: includedByParent ? "#525252" : undefined,
              }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={Boolean(includedByParent)}
                onChange={() => {
                  if (!includedByParent) toggleArea(node.value);
                }}
              />
              <span style={{ fontWeight: isBold ? 700 : 400 }}>{node.label}</span>
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
      setNotice("Manual StreetEasy Agent run started.");
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setStartingManualRun(false);
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

  const handleRunSavedSearchNow = async (savedSearchId: string) => {
    setError(null);
    setNotice(null);
    setRunningSavedSearchId(savedSearchId);
    try {
      const res = await fetch(`${API_BASE}/api/saved-searches/${savedSearchId}/run-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to start saved search run");
      setExpandedSavedSearchId(savedSearchId);
      setNotice("Saved search run started. Open Property Data for the live workflow tracker while it ingests, enriches, and evaluates outreach.");
      window.setTimeout(() => {
        void fetchSavedSearches();
        void fetchSavedSearchRuns(savedSearchId);
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start saved search run");
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
      window.location.href = `/property-data?sent=${encodeURIComponent(message)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to property data");
      setSendingRunId(null);
    }
  };

  return (
    <div className="runs-page">
      <h1 className="page-title">StreetEasy Agent</h1>

      {sendingRunId ? (
        <div
          className="card"
          role="status"
          aria-live="polite"
          style={{
            marginBottom: "1.5rem",
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
            Sending to property data - enriching brokers and price history...
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {formatElapsed(sendTimerSeconds)}
          </span>
        </div>
      ) : null}

      {notice ? (
        <div className="card" style={{ marginBottom: "1rem", background: "#ecfdf5", borderColor: "#34d399" }}>
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem", fontWeight: 600 }}>
          How it works
        </h2>
        <p style={{ marginBottom: "0.75rem", lineHeight: 1.5 }}>
          StreetEasy Agent now does two jobs from one surface: one-off manual pulls and persistent automated saved searches.
        </p>
        <ol style={{ marginBottom: "0.75rem", paddingLeft: "1.5rem", lineHeight: 1.6 }}>
          <li>
            <strong>Run once:</strong> uses the existing two-step StreetEasy flow, keeps the run in memory, and still requires{" "}
            <strong>Send to property data</strong> after review.
          </li>
          <li>
            <strong>Save search:</strong> stores the same search definition with cadence and sourcing rules. Scheduled or
            manual saved-search runs automatically ingest listings, create canonical properties, and sync sourcing workflow state.
          </li>
        </ol>
        <p style={{ marginBottom: "0.5rem", lineHeight: 1.5 }}>
          Use the builder below for both paths. The manual run log remains separate from saved-search automation history because the
          saved-search pipeline persists real ingestion runs in Postgres.
        </p>
        <p style={{ fontSize: "0.875rem", color: "#525252", marginTop: "0.75rem" }}>
          Ensure <code>RAPIDAPI_KEY</code> is set in the API server environment. Scheduled searches also depend on the saved-search cron endpoint.
        </p>
      </div>

      <form onSubmit={handleManualRunSubmit} className="card" style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>Search builder</h2>
            <p style={{ color: "#525252", fontSize: "0.85rem", lineHeight: 1.5, maxWidth: "46rem" }}>
              Build the StreetEasy query once, then either run it immediately or save it as automation.
            </p>
          </div>
          {editingSavedSearchId ? (
            <div
              style={{
                padding: "0.35rem 0.6rem",
                borderRadius: 999,
                background: "#e0f2fe",
                color: "#075985",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              Editing saved search
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem 1rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Saved search name
            </label>
            <input
              type="text"
              value={form.searchName}
              onChange={(event) => updateForm("searchName", event.target.value)}
              className="input-text"
              placeholder="West Village multifamily"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Schedule cadence
            </label>
            <select
              value={form.scheduleCadence}
              onChange={(event) => updateForm("scheduleCadence", event.target.value as SearchCadence)}
              className="input-text"
              style={{ width: "100%" }}
            >
              <option value="manual">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Timezone
            </label>
            <input
              type="text"
              value={form.timezone}
              onChange={(event) => updateForm("timezone", event.target.value)}
              className="input-text"
              placeholder="America/New_York"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "0.75rem 1rem",
              marginBottom: "1rem",
            }}
          >
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 600 }}>
                Run time
              </label>
              <input
                type="time"
                value={form.runTimeLocal}
                onChange={(event) => updateForm("runTimeLocal", event.target.value)}
                className="input-text"
                style={{ width: "100%" }}
              />
            </div>
            {form.scheduleCadence === "weekly" ? (
              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 600 }}>
                  Weekly run day
                </label>
                <select
                  value={form.weeklyRunDay}
                  onChange={(event) => updateForm("weeklyRunDay", event.target.value)}
                  className="input-text"
                  style={{ width: "100%" }}
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
                <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 600 }}>
                  Monthly run day
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.monthlyRunDay}
                  onChange={(event) => updateForm("monthlyRunDay", event.target.value)}
                  className="input-text"
                  style={{ width: "100%" }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          style={{
            marginBottom: "1rem",
            padding: "0.85rem 1rem",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#fafafa",
          }}
        >
          <div style={{ marginBottom: "0.75rem" }}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>Outreach automation rules</h3>
            <p style={{ color: "#525252", fontSize: "0.8rem", lineHeight: 1.5 }}>
              These rules are applied after saved-search ingestion when the sourcing workflow decides whether the property is ready for automated outreach.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "0.75rem 1rem",
            }}
          >
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Minimum units
              </label>
              <input
                type="number"
                min={1}
                value={form.outreachMinUnits}
                onChange={(event) => updateForm("outreachMinUnits", event.target.value)}
                className="input-text"
                placeholder="-"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Minimum recipient confidence (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={form.minimumRecipientConfidence}
                onChange={(event) => updateForm("minimumRecipientConfidence", event.target.value)}
                className="input-text"
                placeholder="-"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={form.requireResolvedRecipient}
                  onChange={(event) => updateForm("requireResolvedRecipient", event.target.checked)}
                />
                Require resolved recipient
              </label>
            </div>
          </div>
          <p style={{ marginTop: "0.65rem", color: "#525252", fontSize: "0.75rem" }}>
            Search max price and property types are also copied into the saved-search outreach rules.
          </p>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
            Areas (required) - select one or more boroughs for the same search
          </label>
          <div
            style={{
              display: "flex",
              gap: "0.25rem",
              marginBottom: "0.5rem",
              flexWrap: "wrap",
              borderBottom: "1px solid #e5e5e5",
              paddingBottom: "0.5rem",
            }}
          >
            {BOROUGH_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAreaBoroughTab(tab.id)}
                style={{
                  padding: "0.35rem 0.6rem",
                  fontSize: "0.8rem",
                  fontWeight: areaBoroughTab === tab.id ? 600 : 400,
                  border: "1px solid #e5e5e5",
                  borderRadius: 4,
                  background: areaBoroughTab === tab.id ? "#e5e5e5" : "#fafafa",
                  color: areaBoroughTab === tab.id ? "#171717" : "#525252",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            className="runs-areas-list"
            style={{
              maxHeight: "14rem",
              overflowY: "auto",
              padding: "0.75rem 1rem",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              background: "#f5f5f5",
            }}
          >
            {BOROUGH_TABS.find((tab) => tab.id === areaBoroughTab)?.tree.map((node) => renderAreaNodes([node], 0))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#525252", marginTop: "0.35rem" }}>
            Selected: {form.selectedAreas.length > 0 ? form.selectedAreas.join(", ") : `${DEFAULT_AREAS[0]}, ${DEFAULT_AREAS[1]} (default)`}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "0.75rem 1rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Min price
            </label>
            <input
              type="number"
              value={form.minPrice}
              onChange={(event) => updateForm("minPrice", event.target.value)}
              className="input-text"
              placeholder="-"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max price
            </label>
            <input
              type="number"
              value={form.maxPrice}
              onChange={(event) => updateForm("maxPrice", event.target.value)}
              className="input-text"
              placeholder="-"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Min beds
            </label>
            <select
              value={form.minBeds}
              onChange={(event) => updateForm("minBeds", event.target.value)}
              className="input-text"
              style={{ width: "100%" }}
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
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max beds
            </label>
            <select
              value={form.maxBeds}
              onChange={(event) => updateForm("maxBeds", event.target.value)}
              className="input-text"
              style={{ width: "100%" }}
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
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Min baths
            </label>
            <select
              value={form.minBaths}
              onChange={(event) => updateForm("minBaths", event.target.value)}
              className="input-text"
              style={{ width: "100%" }}
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
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max HOA/mo
            </label>
            <input
              type="number"
              min={0}
              value={form.maxHoa}
              onChange={(event) => updateForm("maxHoa", event.target.value)}
              className="input-text"
              placeholder="-"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max tax/mo
            </label>
            <input
              type="number"
              min={0}
              value={form.maxTax}
              onChange={(event) => updateForm("maxTax", event.target.value)}
              className="input-text"
              placeholder="-"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Limit (properties)
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={form.limit}
              onChange={(event) => updateForm("limit", event.target.value)}
              className="input-text"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
            Amenities (e.g. washer_dryer,doorman)
          </label>
          <input
            type="text"
            value={form.amenities}
            onChange={(event) => updateForm("amenities", event.target.value)}
            className="input-text"
            placeholder="-"
            style={{ width: "100%", maxWidth: "24rem" }}
          />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.85rem", fontWeight: 600 }}>
            Property types
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              padding: "0.5rem",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              background: "#f5f5f5",
            }}
          >
            {TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={form.selectedTypes.includes(option.value)}
                  onChange={() => toggleType(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#525252", marginTop: "0.35rem" }}>
            Condo, Co-op, House, Multi-family. Leave all unchecked for all types.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="submit" disabled={startingManualRun} className="btn-primary">
            {startingManualRun ? "Starting run..." : "Run once"}
          </button>
          <button
            type="button"
            disabled={savingSearch}
            className="btn-secondary"
            onClick={() => {
              void handleSaveSearch();
            }}
          >
            {savingSearch ? "Saving..." : editingSavedSearchId ? "Update saved search" : "Create saved search"}
          </button>
          <button type="button" className="btn-secondary" onClick={resetBuilder}>
            {editingSavedSearchId ? "Stop editing" : "Reset builder"}
          </button>
        </div>
      </form>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "0.85rem",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Automated saved searches</h2>
            <p style={{ color: "#525252", fontSize: "0.85rem", lineHeight: 1.5 }}>
              Saved-search runs automatically ingest into Property Data and sourcing workflow. Use manual runs below when you want a review gate first.
            </p>
          </div>
        </div>

        {savedSearchesLoading ? (
          <p>Loading saved searches...</p>
        ) : savedSearches.length === 0 ? (
          <p style={{ color: "#525252" }}>No saved searches yet. Use the builder above and click Create saved search.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.85rem" }}>
            {savedSearches.map((savedSearch) => {
              const isExpanded = expandedSavedSearchId === savedSearch.id;
              return (
                <article
                  key={savedSearch.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "1rem",
                    background: isExpanded ? "#fcfcfc" : "#fff",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "1rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: "1 1 28rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                        <h3 style={{ fontSize: "1rem", margin: 0 }}>{savedSearch.name}</h3>
                        <span
                          style={{
                            padding: "0.2rem 0.55rem",
                            borderRadius: 999,
                            background: savedSearch.enabled ? "#dcfce7" : "#e5e7eb",
                            color: savedSearch.enabled ? "#166534" : "#4b5563",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          {savedSearch.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <span
                          style={{
                            padding: "0.2rem 0.55rem",
                            borderRadius: 999,
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          {formatSchedule(savedSearch)}
                        </span>
                      </div>
                      <p style={{ margin: "0 0 0.35rem 0", color: "#262626", fontSize: "0.85rem", lineHeight: 1.5 }}>
                        {formatSearchFilters(savedSearch)}
                      </p>
                      <p style={{ margin: 0, color: "#525252", fontSize: "0.8rem", lineHeight: 1.5 }}>
                        Next run: {formatDateTime(savedSearch.nextRunAt)} | Last run: {formatDateTime(savedSearch.lastRunAt)} | Last success:{" "}
                        {formatDateTime(savedSearch.lastSuccessAt)}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          loadSavedSearchIntoForm(savedSearch);
                          setNotice(`Loaded "${savedSearch.name}" into the builder.`);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={runningSavedSearchId === savedSearch.id}
                        onClick={() => {
                          void handleRunSavedSearchNow(savedSearch.id);
                        }}
                      >
                        {runningSavedSearchId === savedSearch.id ? "Starting..." : "Run now"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          void handleToggleSavedSearchRuns(savedSearch.id);
                        }}
                      >
                        {isExpanded ? "Hide runs" : "View runs"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={deletingSavedSearchId === savedSearch.id}
                        onClick={() => {
                          void handleDeleteSavedSearch(savedSearch.id);
                        }}
                      >
                        {deletingSavedSearchId === savedSearch.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid #e5e7eb" }}>
                      <h4 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Saved-search run history</h4>
                      {savedSearchRunsLoading ? (
                        <p>Loading runs...</p>
                      ) : expandedSavedSearchRuns.length === 0 ? (
                        <p style={{ color: "#525252" }}>No runs yet.</p>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #e5e7eb" }}>Started</th>
                                <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #e5e7eb" }}>Status</th>
                                <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #e5e7eb" }}>Trigger</th>
                                <th style={{ textAlign: "right", padding: "0.45rem", borderBottom: "1px solid #e5e7eb" }}>Seen</th>
                                <th style={{ textAlign: "right", padding: "0.45rem", borderBottom: "1px solid #e5e7eb" }}>New</th>
                                <th style={{ textAlign: "right", padding: "0.45rem", borderBottom: "1px solid #e5e7eb" }}>Updated</th>
                                <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #e5e7eb" }}>Errors</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedSavedSearchRuns.slice(0, 10).map((run) => (
                                <tr key={run.id}>
                                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #f3f4f6" }}>
                                    <div>{formatDateTime(run.startedAt)}</div>
                                    <div style={{ fontSize: "0.75rem", color: "#525252" }}>
                                      {run.finishedAt ? `Finished ${formatDateTime(run.finishedAt)}` : "Still running"}
                                    </div>
                                  </td>
                                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #f3f4f6" }}>{run.status}</td>
                                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #f3f4f6" }}>{run.triggerSource ?? "-"}</td>
                                  <td style={{ textAlign: "right", padding: "0.45rem", borderBottom: "1px solid #f3f4f6" }}>
                                    {run.summary?.listingsSeen ?? 0}
                                  </td>
                                  <td style={{ textAlign: "right", padding: "0.45rem", borderBottom: "1px solid #f3f4f6" }}>
                                    {run.summary?.listingsNew ?? 0}
                                  </td>
                                  <td style={{ textAlign: "right", padding: "0.45rem", borderBottom: "1px solid #f3f4f6" }}>
                                    {run.summary?.listingsUpdated ?? 0}
                                  </td>
                                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #f3f4f6" }}>
                                    {run.summary?.errors?.length ? run.summary.errors[0] : "-"}
                                  </td>
                                </tr>
                              ))}
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
      </div>

      <div className="card" style={{ maxWidth: "none" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Manual StreetEasy Agent log</h2>
        {runsLoading ? (
          <div>Loading runs...</div>
        ) : runs.length === 0 ? (
          <p style={{ color: "#525252" }}>No manual runs yet. Use the builder above and click Run once.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                    Started (timer)
                  </th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                    Step 1
                  </th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                    Step 2
                  </th>
                  <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                    Properties
                  </th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      <div>{formatDateTime(run.startedAt)}</div>
                      <div style={{ fontSize: "0.75rem", color: "#525252" }}>
                        Elapsed: {formatRelativeElapsed(run.startedAt)}
                      </div>
                    </td>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>{step1Label(run)}</td>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>{step2Label(run)}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      {run.propertiesCount}
                      {run.errorsCount > 0 ? (
                        <span className="error" style={{ marginLeft: "0.35rem" }}>
                          ({run.errorsCount} errors)
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      <Link href={`/runs/${run.id}`} style={{ marginRight: "0.75rem" }}>
                        View properties
                      </Link>
                      {run.step2Status === "completed" && run.propertiesCount > 0 ? (
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                          disabled={sendingRunId === run.id}
                          onClick={() => {
                            void handleSendToPropertyData(run.id);
                          }}
                        >
                          {sendingRunId === run.id ? "Sending..." : "Send to property data"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
