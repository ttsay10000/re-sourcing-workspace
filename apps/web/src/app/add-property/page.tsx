"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type {
  SearchProfile,
  UiV2ImportJobPayload,
  UiV2ImportJobResponse,
  UiV2ImportJobStatus,
  UiV2StreetEasyPullOptions,
} from "@re-sourcing/contracts";
import { Button, EmptyState, FileDropzone, PageHeader } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { useProcessBanner } from "@/components/ProcessBanner";
import styles from "./page.module.css";

type ModeId = "manual" | "streeteasy" | "pull" | "om-upload" | "comp-upload";
type ModeCategoryId = "quick" | "market" | "documents";
type CapabilityKey =
  | "manualEntry"
  | "streetEasyUrl"
  | "streetEasyPull"
  | "savedSearchRun"
  | "omUpload";
type NoticeType = "success" | "error" | "info";

interface ImportCapability {
  enabled: boolean;
  endpoint?: string;
  legacyEndpoint?: string;
  status?: string;
  message?: string;
}

interface ImportCapabilities {
  modes: Partial<Record<CapabilityKey, ImportCapability>>;
}

interface Notice {
  type: NoticeType;
  title: string;
  message: string;
  job?: UiV2ImportJobStatus;
}

interface RecentImport {
  id: string;
  label: string;
  at: string;
  updatedAt?: string | null;
  status: "processing" | "completed" | "failed";
  message: string;
  job?: UiV2ImportJobStatus;
}

interface ManualFormState {
  canonicalAddress: string;
  listingUrl: string;
  askingPrice: string;
  units: string;
  neighborhood: string;
  marketType: "on_market" | "off_market" | "unknown";
  ownerName: string;
  brokerName: string;
  brokerFirm: string;
  brokerEmail: string;
  brokerPhone: string;
  brokerNotes: string;
  notes: string;
  tags: string;
  imageUrls: string;
}

interface StreetEasyFormState {
  urls: string;
  savedSearchId: string;
}

interface PropertyOption {
  id: string;
  canonicalAddress: string;
  neighborhood?: string | null;
  borough?: string | null;
}

interface CompImportExtraction {
  packageType?: string;
  extractionMethod?: string | null;
  itemCount?: number;
  compCount?: number | null;
  compsWithCapRate?: number | null;
  psfOnlyComps?: number | null;
  psfOnlyPackage?: boolean;
  warnings?: string[];
}

interface CompImportResult {
  matched: boolean;
  matchSource?: string | null;
  subjectAddress?: string | null;
  property?: { id: string; canonicalAddress: string } | null;
  extraction?: CompImportExtraction;
}

interface PullFormState {
  propertyId: string;
  url: string;
  saleId: string;
  savedSearchId: string;
  includeListingDetails: boolean;
  includeBrokerInfo: boolean;
  includeImages: boolean;
  includeBuildingDetails: boolean;
  includeUnitDetails: boolean;
  includeNearbyComparables: boolean;
  includeSaleHistory: boolean;
  createPropertyIfMissing: boolean;
}

const MODE_CARDS: Array<{
  id: ModeId;
  category: ModeCategoryId;
  label: string;
  kicker: string;
  description: string;
  capabilityKey: CapabilityKey | CapabilityKey[];
  placeholderDisabled?: boolean;
}> = [
  {
    id: "manual",
    category: "quick",
    label: "Manual entry",
    kicker: "Fast add",
    description: "Create from address, broker details, notes, tags, and optional images.",
    capabilityKey: "manualEntry",
  },
  {
    id: "streeteasy",
    category: "quick",
    label: "StreetEasy import by URL",
    kicker: "URL import",
    description: "Paste one or more listing URLs; each runs as its own enriched import.",
    capabilityKey: "streetEasyUrl",
  },
  {
    id: "om-upload",
    category: "documents",
    label: "OM PDF upload",
    kicker: "PDF intake",
    description: "Upload OM PDFs into the property-backed analysis workspace.",
    capabilityKey: "omUpload",
  },
  {
    id: "comp-upload",
    category: "documents",
    label: "Comp package upload",
    kicker: "Comp reader",
    description: "Upload broker comp packages; comps and cap rates extract and link to the matched property.",
    capabilityKey: "omUpload",
  },
  {
    id: "pull",
    category: "market",
    label: "StreetEasy pull",
    kicker: "Market sourcing",
    description: "Create saved searches, run saved searches, or use the advanced one-off pull.",
    capabilityKey: ["streetEasyPull", "savedSearchRun"],
  },
];

const MODE_GROUPS: Array<{
  id: ModeCategoryId;
  title: string;
  description: string;
}> = [
  {
    id: "quick",
    title: "Quick capture",
    description: "Use when you have a property or listing in hand.",
  },
  {
    id: "documents",
    title: "Document intake",
    description: "Route OM files into analysis.",
  },
  {
    id: "market",
    title: "Market sourcing",
    description: "Run StreetEasy flows or saved searches with more automation.",
  },
];

/** Max rows in the subject-property typeahead dropdown (the canonical list can hold hundreds). */
const COMP_SUGGESTION_LIMIT = 8;

const DEFAULT_ENDPOINTS: Record<CapabilityKey, string> = {
  manualEntry: "/api/ui-v2/import/manual-entry",
  streetEasyUrl: "/api/ui-v2/import/streeteasy-url",
  streetEasyPull: "/api/ui-v2/import/streeteasy-pull",
  savedSearchRun: "/api/ui-v2/import/saved-search-run",
  omUpload: "/api/ui-v2/import/om-upload",
};

const INITIAL_MANUAL_FORM: ManualFormState = {
  canonicalAddress: "",
  listingUrl: "",
  askingPrice: "",
  units: "",
  neighborhood: "",
  marketType: "off_market",
  ownerName: "",
  brokerName: "",
  brokerFirm: "",
  brokerEmail: "",
  brokerPhone: "",
  brokerNotes: "",
  notes: "",
  tags: "",
  imageUrls: "",
};

const INITIAL_STREETEASY_FORM: StreetEasyFormState = {
  urls: "",
  savedSearchId: "",
};

const INITIAL_PULL_FORM: PullFormState = {
  propertyId: "",
  url: "",
  saleId: "",
  savedSearchId: "",
  includeListingDetails: true,
  includeBrokerInfo: true,
  includeImages: true,
  includeBuildingDetails: true,
  includeUnitDetails: true,
  includeNearbyComparables: true,
  includeSaleHistory: false,
  createPropertyIfMissing: true,
};

function buildApiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

function cleanString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: string): number | null {
  const cleaned = value.replace(/[$,%\s,]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Best-effort neighborhood/borough subtitle from a canonical property row's details blob. */
function propertyLocationFromDetails(details: unknown): { neighborhood: string | null; borough: string | null } {
  if (details == null || typeof details !== "object" || Array.isArray(details)) {
    return { neighborhood: null, borough: null };
  }
  const container = (details as Record<string, unknown>).neighborhood;
  if (typeof container === "string" && container.trim()) {
    return { neighborhood: container.trim(), borough: null };
  }
  if (container == null || typeof container !== "object" || Array.isArray(container)) {
    return { neighborhood: null, borough: null };
  }
  const primary = (container as Record<string, unknown>).primary;
  if (primary == null || typeof primary !== "object" || Array.isArray(primary)) {
    return { neighborhood: null, borough: null };
  }
  const record = primary as Record<string, unknown>;
  return {
    neighborhood: typeof record.name === "string" && record.name.trim() ? record.name.trim() : null,
    borough: typeof record.borough === "string" && record.borough.trim() ? record.borough.trim() : null,
  };
}

function propertyOptionSubtitle(option: PropertyOption): string | null {
  const parts = [option.neighborhood, option.borough].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function titleizeSlug(value: string | null | undefined): string {
  if (!value) return "No location";
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCurrency(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not run yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function describeSavedSearch(search: SearchProfile): string {
  const location =
    search.locationMode === "multi"
      ? `${search.areaCodes.length || 0} area${search.areaCodes.length === 1 ? "" : "s"}`
      : titleizeSlug(search.singleLocationSlug);
  const priceRange = [formatCurrency(search.minPrice), formatCurrency(search.maxPrice)].filter(Boolean).join(" - ");
  const cadence = search.scheduleCadence === "manual" ? "manual" : search.scheduleCadence;
  return [location, priceRange || "any price", cadence].join(" | ");
}

function getJobMessage(job: UiV2ImportJobStatus): string {
  if (job.errorMessage) return job.errorMessage;
  if (job.status === "queued") return "The job is queued and the pipeline will pick it up shortly.";
  if (job.status === "running") return "A matching job is already running.";
  if (job.propertyId) return "Pipeline has been updated. Open the property to continue review.";
  return "The import request was accepted.";
}

function makeActivityId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getActivityStatusLabel(item: RecentImport): string {
  if (item.status === "processing") return "Processing";
  if (item.status === "failed") return "Failed";
  return "Completed";
}

function getActivityStatusClass(item: RecentImport): string {
  if (item.status === "processing") return styles.statusBusy;
  if (item.status === "failed") return styles.statusBad;
  return styles.statusGood;
}

function Field({
  label,
  children,
  hint,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
}) {
  return (
    <label className={`${styles.field} ${compact ? styles.fieldCompact : ""}`}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggleRow}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={styles.toggleInput}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      <span className={styles.toggleCopy}>
        <span className={styles.toggleLabel}>{label}</span>
        <span className={styles.toggleDescription}>{description}</span>
      </span>
    </label>
  );
}

export default function AddPropertyPage() {
  const [activeMode, setActiveMode] = useState<ModeId>("manual");
  const [capabilities, setCapabilities] = useState<ImportCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SearchProfile[]>([]);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(true);
  const [savedSearchError, setSavedSearchError] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<ManualFormState>(INITIAL_MANUAL_FORM);
  const [streetEasyForm, setStreetEasyForm] = useState<StreetEasyFormState>(INITIAL_STREETEASY_FORM);
  const [pullForm, setPullForm] = useState<PullFormState>(INITIAL_PULL_FORM);
  const [pullPanelOpen, setPullPanelOpen] = useState(false);
  const [submitting, setSubmitting] = useState<ModeId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const [compFiles, setCompFiles] = useState<File[]>([]);
  const [compPropertyId, setCompPropertyId] = useState("");
  const [compPropertyQuery, setCompPropertyQuery] = useState("");
  const [compDropdownOpen, setCompDropdownOpen] = useState(false);
  const [compActiveIndex, setCompActiveIndex] = useState(0);
  const [propertyOptions, setPropertyOptions] = useState<PropertyOption[]>([]);
  const [compResult, setCompResult] = useState<CompImportResult | null>(null);
  const [compUnmatched, setCompUnmatched] = useState<string | null>(null);
  const compPropertyInputRef = useRef<HTMLInputElement | null>(null);
  const processBanner = useProcessBanner();

  const streetEasyEnabledSearches = useMemo(
    () => savedSearches.filter((search) => search.sourceToggles?.streeteasy !== false),
    [savedSearches]
  );

  const selectedSavedSearch = useMemo(() => {
    const id = pullForm.savedSearchId || streetEasyForm.savedSearchId;
    return savedSearches.find((search) => search.id === id) ?? null;
  }, [pullForm.savedSearchId, savedSearches, streetEasyForm.savedSearchId]);

  const fetchCapabilities = useCallback(async () => {
    setCapabilitiesLoading(true);
    setCapabilitiesError(null);
    try {
      const response = await fetch(buildApiUrl("/api/ui-v2/import/capabilities"));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || data?.details || "Failed to load import capabilities");
      setCapabilities(data as ImportCapabilities);
    } catch (err) {
      setCapabilities(null);
      setCapabilitiesError(err instanceof Error ? err.message : "Failed to load import capabilities");
    } finally {
      setCapabilitiesLoading(false);
    }
  }, []);

  const fetchSavedSearches = useCallback(async () => {
    setSavedSearchesLoading(true);
    setSavedSearchError(null);
    try {
      const response = await fetch(buildApiUrl("/api/saved-searches"));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || data?.details || "Failed to load saved searches");
      setSavedSearches(Array.isArray(data.savedSearches) ? data.savedSearches : []);
    } catch (err) {
      setSavedSearches([]);
      setSavedSearchError(err instanceof Error ? err.message : "Failed to load saved searches");
    } finally {
      setSavedSearchesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCapabilities();
    void fetchSavedSearches();
  }, [fetchCapabilities, fetchSavedSearches]);

  // Canonical properties load lazily the first time the comp-upload panel opens.
  useEffect(() => {
    if (activeMode !== "comp-upload" || propertyOptions.length > 0) return;
    let cancelled = false;
    fetch(buildApiUrl("/api/properties"))
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const rows = Array.isArray(data?.properties) ? data.properties : [];
        setPropertyOptions(
          rows
            .map((row: Record<string, unknown>) => ({
              id: String(row.id ?? ""),
              canonicalAddress: String(row.canonicalAddress ?? row.canonical_address ?? ""),
              ...propertyLocationFromDetails(row.details),
            }))
            .filter((row: PropertyOption) => row.id && row.canonicalAddress)
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeMode, propertyOptions.length]);

  // Typeahead suggestions: address substring match, startsWith ranked first, capped at 8 rows.
  const compSuggestions = useMemo(() => {
    const query = compPropertyQuery.trim().toLowerCase();
    if (!query) return propertyOptions.slice(0, COMP_SUGGESTION_LIMIT);
    const startsWith: PropertyOption[] = [];
    const contains: PropertyOption[] = [];
    for (const option of propertyOptions) {
      const address = option.canonicalAddress.toLowerCase();
      if (address.startsWith(query)) startsWith.push(option);
      else if (address.includes(query)) contains.push(option);
      if (startsWith.length >= COMP_SUGGESTION_LIMIT) break;
    }
    return [...startsWith, ...contains].slice(0, COMP_SUGGESTION_LIMIT);
  }, [propertyOptions, compPropertyQuery]);

  const selectedCompProperty = useMemo(
    () => (compPropertyId ? propertyOptions.find((option) => option.id === compPropertyId) ?? null : null),
    [compPropertyId, propertyOptions]
  );

  // Row 0 is the pinned "Auto-match by subject address" option; suggestions follow.
  const compOptionRowCount = compSuggestions.length + 1;

  const selectCompAutoMatch = useCallback(() => {
    setCompPropertyId("");
    setCompPropertyQuery("");
    setCompDropdownOpen(false);
    setCompActiveIndex(0);
  }, []);

  const selectCompProperty = useCallback((option: PropertyOption) => {
    setCompPropertyId(option.id);
    setCompPropertyQuery(option.canonicalAddress);
    setCompDropdownOpen(false);
    setCompActiveIndex(0);
  }, []);

  const handleCompPropertyInput = useCallback(
    (value: string) => {
      setCompPropertyQuery(value);
      setCompDropdownOpen(true);
      setCompActiveIndex(value.trim() ? 1 : 0);
      // Editing the text releases a forced link back to auto-match.
      if (compPropertyId) setCompPropertyId("");
    },
    [compPropertyId]
  );

  const handleCompPropertyKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!compDropdownOpen) {
          setCompDropdownOpen(true);
          return;
        }
        setCompActiveIndex((index) => Math.min(index + 1, compOptionRowCount - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!compDropdownOpen) return;
        setCompActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        if (!compDropdownOpen) return;
        event.preventDefault();
        if (compActiveIndex <= 0) selectCompAutoMatch();
        else {
          const option = compSuggestions[compActiveIndex - 1];
          if (option) selectCompProperty(option);
        }
        return;
      }
      if (event.key === "Escape" && compDropdownOpen) {
        event.preventDefault();
        setCompDropdownOpen(false);
      }
    },
    [compActiveIndex, compDropdownOpen, compOptionRowCount, compSuggestions, selectCompAutoMatch, selectCompProperty]
  );

  const capabilityFor = useCallback(
    (key: CapabilityKey): ImportCapability | null => capabilities?.modes?.[key] ?? null,
    [capabilities]
  );

  const endpointFor = useCallback(
    (key: CapabilityKey): string => capabilityFor(key)?.endpoint ?? DEFAULT_ENDPOINTS[key],
    [capabilityFor]
  );

  const isCapabilityEnabled = useCallback(
    (key: CapabilityKey): boolean => capabilityFor(key)?.enabled === true,
    [capabilityFor]
  );

  const isModeEnabled = useCallback(
    (mode: ModeId): boolean => {
      if (!capabilities || capabilitiesLoading) return false;
      const card = MODE_CARDS.find((item) => item.id === mode);
      if (!card) return false;
      if (card.placeholderDisabled) return false;
      if (mode === "om-upload" || mode === "comp-upload") return true;
      const keys = Array.isArray(card.capabilityKey) ? card.capabilityKey : [card.capabilityKey];
      return keys.some((key) => isCapabilityEnabled(key));
    },
    [capabilities, capabilitiesLoading, isCapabilityEnabled]
  );

  const submitImportRequest = useCallback(
    async (endpoint: string, payload: unknown): Promise<UiV2ImportJobPayload> => {
      const response = await fetch(buildApiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<UiV2ImportJobResponse> & {
        job?: UiV2ImportJobStatus;
        error?: string;
        details?: string;
      };
      const jobPayload =
        data.importJob ??
        (data.job
          ? {
              job: data.job,
              property: null,
            }
          : undefined);
      if (!response.ok || !jobPayload?.job) {
        const message =
          jobPayload?.job?.errorMessage ||
          jobPayload?.job?.label ||
          data.error ||
          data.details ||
          `Import request failed with HTTP ${response.status}`;
        throw new Error(message);
      }
      return jobPayload;
    },
    []
  );

  const startImportActivity = useCallback((label: string, message: string): string => {
    const id = makeActivityId();
    const now = new Date().toISOString();
    const item: RecentImport = {
      id,
      label,
      at: now,
      updatedAt: null,
      status: "processing",
      message,
    };
    setRecentImports((current) => [item, ...current].slice(0, 8));
    return id;
  }, []);

  const updateImportActivity = useCallback(
    (
      id: string,
      next: {
        status: RecentImport["status"];
        message: string;
        job?: UiV2ImportJobStatus;
      }
    ) => {
      setRecentImports((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: next.status,
                message: next.message,
                job: next.job,
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
    },
    []
  );

  const postImport = useCallback(
    async (mode: ModeId, endpoint: string, payload: unknown, label: string): Promise<UiV2ImportJobPayload> => {
      setSubmitting(mode);
      setNotice(null);
      const banner = processBanner.start(label, { message: "Processing import…" });
      const activityId = startImportActivity(label, "Processing import...");
      try {
        const jobPayload = await submitImportRequest(endpoint, payload);
        const jobMessage = jobPayload.job.label || getJobMessage(jobPayload.job);
        updateImportActivity(activityId, {
          status: jobPayload.job.status === "failed" ? "failed" : "completed",
          message: jobMessage,
          job: jobPayload.job,
        });
        if (jobPayload.job.status === "failed") banner.fail(jobMessage);
        else banner.succeed(jobMessage);
        setNotice({
          type: jobPayload.job.status === "failed" ? "error" : "success",
          title: jobPayload.job.label || label,
          message: getJobMessage(jobPayload.job),
          job: jobPayload.job,
        });
        return jobPayload;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import request failed";
        banner.fail(message);
        updateImportActivity(activityId, {
          status: "failed",
          message,
        });
        setNotice({ type: "error", title: `${label} failed`, message });
        throw err;
      } finally {
        setSubmitting(null);
      }
    },
    [processBanner, startImportActivity, submitImportRequest, updateImportActivity]
  );

  const updateManualForm = <K extends keyof ManualFormState>(key: K, value: ManualFormState[K]) => {
    setManualForm((current) => ({ ...current, [key]: value }));
  };

  const updateStreetEasyForm = <K extends keyof StreetEasyFormState>(key: K, value: StreetEasyFormState[K]) => {
    setStreetEasyForm((current) => ({ ...current, [key]: value }));
  };

  const updatePullForm = <K extends keyof PullFormState>(key: K, value: PullFormState[K]) => {
    setPullForm((current) => ({ ...current, [key]: value }));
  };

  const manualBrokerHasAnyValue = Boolean(
    cleanString(manualForm.brokerName) ||
      cleanString(manualForm.brokerFirm) ||
      cleanString(manualForm.brokerPhone) ||
      cleanString(manualForm.brokerEmail)
  );
  const manualBrokerNeedsEmail = manualBrokerHasAnyValue && !cleanString(manualForm.brokerEmail);

  const handleManualSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const canonicalAddress = cleanString(manualForm.canonicalAddress);
    if (!canonicalAddress) {
      setNotice({ type: "error", title: "Address required", message: "Enter a canonical property address before importing." });
      return;
    }

    const imageUrls = splitList(manualForm.imageUrls);
    const broker = manualBrokerHasAnyValue
      ? {
          name: cleanString(manualForm.brokerName),
          firm: cleanString(manualForm.brokerFirm),
          email: cleanString(manualForm.brokerEmail),
          phone: cleanString(manualForm.brokerPhone),
          notes: cleanString(manualForm.brokerNotes) ?? (manualBrokerNeedsEmail ? "Manual broker added without an email." : null),
          source: "import_review",
          overwriteTarget: "property_sourced_broker",
          overwriteReason: manualBrokerNeedsEmail
            ? "Manual import captured broker details without an email; outreach needs an email later."
            : "Manual import broker details.",
        }
      : null;

    await postImport(
      "manual",
      endpointFor("manualEntry"),
      {
        canonicalAddress,
        listingUrl: cleanString(manualForm.listingUrl),
        askingPrice: numberOrNull(manualForm.askingPrice),
        units: numberOrNull(manualForm.units),
        neighborhood: cleanString(manualForm.neighborhood),
        marketType: manualForm.marketType,
        source: "manual",
        ownerName: cleanString(manualForm.ownerName),
        broker,
        notes: cleanString(manualForm.notes),
        images: imageUrls.map((url, index) => ({
          url,
          source: "manual",
          order: index + 1,
        })),
        tags: [...new Set([...splitList(manualForm.tags), manualForm.marketType])],
      },
      "Manual property import"
    );
  };

  const handleStreetEasySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const savedSearchId = cleanString(streetEasyForm.savedSearchId);
    const urls = [...new Set(splitList(streetEasyForm.urls))];
    if (urls.length === 0) {
      setNotice({ type: "error", title: "StreetEasy URL required", message: "Paste one or more StreetEasy sale URLs to import." });
      return;
    }

    setSubmitting("streeteasy");
    setNotice(null);
    const banner = processBanner.start("StreetEasy import", {
      message: `Importing ${urls.length} listing${urls.length === 1 ? "" : "s"}…`,
    });
    const successes: UiV2ImportJobPayload[] = [];
    const failures: Array<{ url: string; message: string }> = [];
    try {
      for (const [index, url] of urls.entries()) {
        banner.update(`Importing ${index + 1} of ${urls.length}: ${url}`, Math.round((index / urls.length) * 100));
        const activityId = startImportActivity("StreetEasy URL import", `Processing ${url}`);
        try {
          const jobPayload = await submitImportRequest(endpointFor("streetEasyUrl"), { url, savedSearchId });
          successes.push(jobPayload);
          updateImportActivity(activityId, {
            status: jobPayload.job.status === "failed" ? "failed" : "completed",
            message: jobPayload.job.label || getJobMessage(jobPayload.job),
            job: jobPayload.job,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Import request failed";
          updateImportActivity(activityId, {
            status: "failed",
            message,
          });
          failures.push({
            url,
            message,
          });
        }
      }
      if (failures.length > 0) {
        banner.fail(`${successes.length} of ${urls.length} imported; ${failures.length} failed.`);
      } else {
        banner.succeed(`${successes.length} listing${successes.length === 1 ? "" : "s"} imported.`);
      }
    } finally {
      setSubmitting(null);
    }

    if (failures.length > 0) {
      setNotice({
        type: successes.length > 0 ? "info" : "error",
        title: successes.length > 0 ? "StreetEasy imports completed with issues" : "StreetEasy imports failed",
        message: `${successes.length} of ${urls.length} listing${urls.length === 1 ? "" : "s"} imported. ${failures.length} failed${failures[0]?.message ? `: ${failures[0].message}` : "."} Per-listing status and property links are in the Import activity panel.`,
        job: successes.length === 1 ? successes[0]?.job : undefined,
      });
      return;
    }

    setNotice({
      type: "success",
      title: urls.length === 1 ? successes[0]?.job.label || "StreetEasy listing imported" : "StreetEasy listings imported",
      message:
        urls.length === 1
          ? getJobMessage(successes[0]!.job)
          : `${successes.length} StreetEasy listings imported. Enrichment and rental flow were triggered for each property — open each one from the Import activity panel.`,
      job: successes.length === 1 ? successes[0]?.job : undefined,
    });
  };

  const handlePullSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const propertyId = cleanString(pullForm.propertyId);
    const url = cleanString(pullForm.url);
    const saleId = cleanString(pullForm.saleId);
    if (!propertyId && !url && !saleId) {
      setNotice({
        type: "error",
        title: "Pull target required",
        message: "Enter a property ID, StreetEasy URL, or StreetEasy sale ID for the full pull.",
      });
      return;
    }
    if (saleId && !/^\d+$/.test(saleId)) {
      setNotice({ type: "error", title: "Numeric sale ID required", message: "StreetEasy sale IDs should contain digits only." });
      return;
    }

    const options: UiV2StreetEasyPullOptions = {
      includeListingDetails: pullForm.includeListingDetails,
      includeBrokerInfo: pullForm.includeBrokerInfo,
      includeImages: pullForm.includeImages,
      includeBuildingDetails: pullForm.includeBuildingDetails,
      includeUnitDetails: pullForm.includeUnitDetails,
      includeNearbyComparables: pullForm.includeNearbyComparables,
      includeSaleHistory: pullForm.includeSaleHistory,
      createPropertyIfMissing: pullForm.createPropertyIfMissing,
      savedSearchId: cleanString(pullForm.savedSearchId),
    };

    await postImport(
      "pull",
      endpointFor("streetEasyPull"),
      {
        propertyId,
        url,
        saleId,
        options,
      },
      "Full StreetEasy pull"
    );
  };

  const handleCompUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = compFiles[0];
    if (!file) {
      setNotice({ type: "error", title: "File required", message: "Add a broker comp package (PDF or spreadsheet) first." });
      return;
    }
    setSubmitting("comp-upload");
    setNotice(null);
    setCompResult(null);
    setCompUnmatched(null);
    const banner = processBanner.start("Comp package upload", { message: file.name });
    const activityId = startImportActivity("Comp package upload", `Extracting ${file.name}…`);
    try {
      const form = new FormData();
      form.append("file", file);
      if (compPropertyId) form.append("propertyId", compPropertyId);
      const response = await fetch(buildApiUrl("/api/import/comp-package"), { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as CompImportResult & { error?: string; details?: string; message?: string };
      if (!response.ok || data?.error) {
        throw new Error(data?.error || data?.details || `Comp import failed with HTTP ${response.status}`);
      }

      if (data.matched === false) {
        const message = data.message ?? "No canonical property matched the package's subject address.";
        setCompUnmatched(message);
        if (data.subjectAddress) {
          // Pre-fill the typeahead with the parsed subject address and open it so the user can pick.
          setCompPropertyQuery(data.subjectAddress);
          setCompDropdownOpen(true);
          setCompActiveIndex(1);
          compPropertyInputRef.current?.focus();
        }
        banner.fail("No property matched — pick the subject property and resubmit.");
        updateImportActivity(activityId, { status: "failed", message });
        setNotice({ type: "info", title: "Pick the subject property", message });
        return;
      }

      setCompResult(data);
      const extraction = data.extraction ?? {};
      const compCount = extraction.compCount ?? extraction.itemCount ?? 0;
      const extractionWarnings = Array.isArray(extraction.warnings) ? extraction.warnings.filter(Boolean) : [];
      const summaryText = `${compCount} comp${compCount === 1 ? "" : "s"} extracted · ${extraction.compsWithCapRate ?? 0} with cap rate${
        extraction.psfOnlyComps ? ` · ${extraction.psfOnlyComps} $/PSF-only` : ""
      }`;
      banner.succeed(`${data.property?.canonicalAddress ?? "Linked"} — ${summaryText}`);
      updateImportActivity(activityId, { status: "completed", message: summaryText });
      setNotice({
        type: extraction.psfOnlyPackage || extractionWarnings.length > 0 ? "info" : "success",
        title: `Comp package linked to ${data.property?.canonicalAddress ?? "property"}`,
        message: extractionWarnings.length > 0
          ? `${summaryText}. ${extractionWarnings[0]}`
          : extraction.psfOnlyPackage
            ? `${summaryText}. No cap rates were found in this package — it prices on $/PSF only, so consider requesting investment-sale comps from the broker.`
            : `${summaryText}. Review them in the property's Market/Comps tab or on the Comp Analysis page.`,
      });
      setCompFiles([]);
      setCompPropertyId("");
      setCompPropertyQuery("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Comp import failed";
      banner.fail(message);
      updateImportActivity(activityId, { status: "failed", message });
      setNotice({ type: "error", title: "Comp package upload failed", message });
    } finally {
      setSubmitting(null);
    }
  };

  const handleSavedSearchRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const savedSearchId = cleanString(streetEasyForm.savedSearchId);
    if (!savedSearchId) {
      setNotice({ type: "error", title: "Saved search required", message: "Choose a saved search to run now." });
      return;
    }
    await postImport(
      "pull",
      endpointFor("savedSearchRun"),
      { savedSearchId },
      "Saved-search run"
    );
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Intake"
        title="Add property"
        subtitle="Bring a property into the sourcing flow from manual details, StreetEasy URLs, saved-search sourcing, or OM PDF uploads."
        actions={
          <div className={styles.headerActions}>
            <Link href="/pipeline" className={styles.secondaryLink}>
              Pipeline
            </Link>
            <Link href="/deal-analysis" className={styles.primaryLink}>
              Upload OM PDF
            </Link>
          </div>
        }
      />

      <div className={styles.healthRow}>
        <div className={styles.healthItem}>
          <span className={styles.healthLabel}>Capabilities</span>
          <span className={`${styles.healthValue} ${capabilitiesError ? styles.statusBad : styles.statusGood}`}>
            {capabilitiesLoading ? "Checking" : capabilitiesError ? "Unavailable" : "Loaded"}
          </span>
        </div>
        <div className={styles.healthItem}>
          <span className={styles.healthLabel}>Saved searches</span>
          <span className={`${styles.healthValue} ${savedSearchError ? styles.statusBad : styles.statusNeutral}`}>
            {savedSearchesLoading ? "Loading" : savedSearchError ? "Unavailable" : `${savedSearches.length} loaded`}
          </span>
        </div>
        {capabilitiesError ? (
          <button type="button" className={styles.inlineButton} onClick={() => void fetchCapabilities()}>
            Retry capabilities
          </button>
        ) : null}
        {savedSearchError ? (
          <button type="button" className={styles.inlineButton} onClick={() => void fetchSavedSearches()}>
            Retry saved searches
          </button>
        ) : null}
      </div>

      <div className={styles.workspaceGrid}>
        <aside className={styles.modeRail} aria-label="Import modes">
          {MODE_GROUPS.map((group) => {
            const modes = MODE_CARDS.filter((mode) => mode.category === group.id);
            return (
              <section key={group.id} className={styles.modeGroup}>
                <div className={styles.modeGroupHeader}>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
                <div className={styles.modeGroupCards}>
                  {modes.map((mode) => {
                    const enabled = isModeEnabled(mode.id);
                    const isActive = activeMode === mode.id;
                    return (
                      <button
                        type="button"
                        key={mode.id}
                        aria-pressed={isActive}
                        aria-disabled={mode.placeholderDisabled || undefined}
                        onClick={() => {
                          if (mode.placeholderDisabled) return;
                          setActiveMode(mode.id);
                          if (mode.id !== "pull") setPullPanelOpen(false);
                        }}
                        className={`${styles.modeButton} ${isActive ? styles.modeButtonActive : ""}`}
                      >
                        <span className={styles.modeKicker}>{mode.kicker}</span>
                        <span className={styles.modeTitle}>{mode.label}</span>
                        <span className={styles.modeDescription}>{mode.description}</span>
                        <span className={`${styles.modeStatus} ${enabled ? styles.modeStatusOn : styles.modeStatusOff}`}>
                          <span className={`${styles.modeDot} ${enabled ? styles.modeDotOn : styles.modeDotOff}`} />
                          {enabled ? "Ready" : capabilitiesLoading ? "Checking" : "Unavailable"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </aside>

        <main className={styles.formSurface}>
          {notice ? (
            <div className={`${styles.notice} ${styles[`notice-${notice.type}`]}`}>
              <div>
                <strong>{notice.title}</strong>
                <p>{notice.message}</p>
              </div>
              {notice.job?.propertyId ? (
                <Link
                  href={
                    notice.job.jobType === "om_url"
                      ? `/deal-analysis?property_id=${encodeURIComponent(notice.job.propertyId)}`
                      : `/pipeline?propertyId=${encodeURIComponent(notice.job.propertyId)}`
                  }
                  className={styles.noticeLink}
                >
                  {notice.job.jobType === "om_url" ? "Open analysis" : "Open property"}
                </Link>
              ) : null}
            </div>
          ) : null}

          {activeMode === "manual" ? (
            <section className={styles.panel} aria-labelledby="manual-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>Manual property entry</p>
                  <h2 id="manual-heading">Add the property yourself</h2>
                </div>
              </div>
              <form className={styles.formStack} onSubmit={handleManualSubmit}>
                <div className={styles.twoColumn}>
                  <Field label="Canonical address">
                    <input
                      className={styles.input}
                      value={manualForm.canonicalAddress}
                      onChange={(event) => updateManualForm("canonicalAddress", event.target.value)}
                      placeholder="123 Example St, New York, NY 10001"
                      required
                    />
                  </Field>
                  <Field label="Listing URL" hint="Optional. Use this for non-StreetEasy or source context.">
                    <input
                      className={styles.input}
                      value={manualForm.listingUrl}
                      onChange={(event) => updateManualForm("listingUrl", event.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                </div>

                <div className={styles.fourColumn}>
                  <Field label="Asking price" compact>
                    <input
                      className={styles.input}
                      value={manualForm.askingPrice}
                      onChange={(event) => updateManualForm("askingPrice", event.target.value)}
                      inputMode="decimal"
                      placeholder="$2,750,000"
                    />
                  </Field>
                  <Field label="Units" compact>
                    <input
                      className={styles.input}
                      value={manualForm.units}
                      onChange={(event) => updateManualForm("units", event.target.value)}
                      inputMode="numeric"
                      placeholder="8"
                    />
                  </Field>
                  <Field label="Neighborhood" compact>
                    <input
                      className={styles.input}
                      value={manualForm.neighborhood}
                      onChange={(event) => updateManualForm("neighborhood", event.target.value)}
                      placeholder="Chelsea"
                    />
                  </Field>
                  <Field label="Type" compact>
                    <select
                      className={styles.input}
                      value={manualForm.marketType}
                      onChange={(event) => updateManualForm("marketType", event.target.value as ManualFormState["marketType"])}
                    >
                      <option value="off_market">Off market</option>
                      <option value="on_market">On market</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </Field>
                  <Field label="Owner" compact>
                    <input
                      className={styles.input}
                      value={manualForm.ownerName}
                      onChange={(event) => updateManualForm("ownerName", event.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </div>

                <div className={styles.brokerBox}>
                  <div className={styles.subsectionHeader}>
                    <h3>Broker details</h3>
                    <span className={manualBrokerNeedsEmail ? styles.warningPill : styles.softPill}>
                      {manualBrokerNeedsEmail ? "Email needed later" : "Optional"}
                    </span>
                  </div>
                  <div className={styles.twoColumn}>
                    <Field label="Broker name">
                      <input
                        className={styles.input}
                        value={manualForm.brokerName}
                        onChange={(event) => updateManualForm("brokerName", event.target.value)}
                        placeholder="Broker or team name"
                      />
                    </Field>
                    <Field label="Firm">
                      <input
                        className={styles.input}
                        value={manualForm.brokerFirm}
                        onChange={(event) => updateManualForm("brokerFirm", event.target.value)}
                        placeholder="Brokerage"
                      />
                    </Field>
                    <Field
                      label="Email"
                      hint={
                        manualBrokerNeedsEmail
                          ? "This broker can be saved without an email, but outreach will need one later."
                          : "Optional for import; required before broker outreach."
                      }
                    >
                      <input
                        className={styles.input}
                        value={manualForm.brokerEmail}
                        onChange={(event) => updateManualForm("brokerEmail", event.target.value)}
                        placeholder="broker@example.com"
                        type="email"
                      />
                    </Field>
                    <Field label="Phone">
                      <input
                        className={styles.input}
                        value={manualForm.brokerPhone}
                        onChange={(event) => updateManualForm("brokerPhone", event.target.value)}
                        placeholder="(212) 555-0199"
                      />
                    </Field>
                  </div>
                  <Field label="Broker notes">
                    <textarea
                      className={styles.textarea}
                      value={manualForm.brokerNotes}
                      onChange={(event) => updateManualForm("brokerNotes", event.target.value)}
                      placeholder="Any source notes, confidence, or follow-up context."
                      rows={3}
                    />
                  </Field>
                </div>

                <div className={styles.twoColumn}>
                  <Field label="Tags" hint="Comma or line separated.">
                    <textarea
                      className={styles.textarea}
                      value={manualForm.tags}
                      onChange={(event) => updateManualForm("tags", event.target.value)}
                      placeholder="watchlist, off-market, broker-lead"
                      rows={3}
                    />
                  </Field>
                  <Field label="Image URLs" hint="One URL per line, optional.">
                    <textarea
                      className={styles.textarea}
                      value={manualForm.imageUrls}
                      onChange={(event) => updateManualForm("imageUrls", event.target.value)}
                      placeholder="https://..."
                      rows={3}
                    />
                  </Field>
                </div>

                <Field label="Property notes">
                  <textarea
                    className={styles.textarea}
                    value={manualForm.notes}
                    onChange={(event) => updateManualForm("notes", event.target.value)}
                    placeholder="Why this property is being added, source context, or open questions."
                    rows={4}
                  />
                </Field>

                <div className={styles.formActions}>
                  <Button type="submit" variant="primary" disabled={!isModeEnabled("manual") || submitting === "manual"}>
                    {submitting === "manual" ? "Importing..." : "Create manual property"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setManualForm(INITIAL_MANUAL_FORM)}>
                    Clear form
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          {activeMode === "streeteasy" ? (
            <section className={styles.panel} aria-labelledby="streeteasy-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>StreetEasy URL import</p>
                  <h2 id="streeteasy-heading">Import one or more listing URLs</h2>
                </div>
              </div>
              <form className={styles.formStack} onSubmit={handleStreetEasySubmit}>
                <Field
                  label="StreetEasy sale URLs"
                  hint="Paste one URL per line. Each listing runs independently and triggers enrichment plus rental flow after import."
                >
                  <textarea
                    className={styles.textarea}
                    value={streetEasyForm.urls}
                    onChange={(event) => updateStreetEasyForm("urls", event.target.value)}
                    placeholder={"https://streeteasy.com/sale/...\nhttps://streeteasy.com/sale/..."}
                    rows={5}
                    required
                  />
                </Field>

                <Field label="Attach to saved search" hint="Optional. Helps source attribution when this listing came from a profile.">
                  <select
                    className={styles.input}
                    value={streetEasyForm.savedSearchId}
                    onChange={(event) => updateStreetEasyForm("savedSearchId", event.target.value)}
                    disabled={savedSearchesLoading || savedSearches.length === 0}
                  >
                    <option value="">No saved search</option>
                    {streetEasyEnabledSearches.map((search) => (
                      <option key={search.id} value={search.id}>
                        {search.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className={styles.formActions}>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!isModeEnabled("streeteasy") || submitting === "streeteasy"}
                  >
                    {submitting === "streeteasy" ? "Importing..." : "Import StreetEasy URL(s)"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setPullPanelOpen(true)}>
                    Advanced pull options
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          {activeMode === "pull" ? (
            <section className={styles.panel} aria-labelledby="pull-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>StreetEasy pull</p>
                  <h2 id="pull-heading">Run market sourcing</h2>
                </div>
              </div>
              <div className={styles.formStack}>
                <div className={styles.actionSplit}>
                  <div>
                    <h3 className={styles.actionTitle}>Create or edit a saved search</h3>
                    <p>
                      Use the Sourcing Agent builder for new StreetEasy search criteria, outreach rules,
                      saved-search scheduling, and manual run setup.
                    </p>
                  </div>
                  <Link href="/runs" className={styles.primaryLink}>
                    Build saved search
                  </Link>
                </div>

                <form className={styles.formStack} onSubmit={handleSavedSearchRun}>
                  <div className={styles.subsectionHeader}>
                    <h3>Run an existing saved search</h3>
                    <span className={styles.softPill}>{streetEasyEnabledSearches.length} available</span>
                  </div>
                  <Field label="Saved search">
                    <select
                      className={styles.input}
                      value={streetEasyForm.savedSearchId}
                      onChange={(event) => updateStreetEasyForm("savedSearchId", event.target.value)}
                      disabled={savedSearchesLoading || streetEasyEnabledSearches.length === 0}
                      required
                    >
                      <option value="">Choose a saved search</option>
                      {streetEasyEnabledSearches.map((search) => (
                        <option key={search.id} value={search.id}>
                          {search.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {selectedSavedSearch ? (
                    <div className={styles.savedSearchPreview}>
                      <div>
                        <strong>{selectedSavedSearch.name}</strong>
                        <p>{describeSavedSearch(selectedSavedSearch)}</p>
                      </div>
                      <div className={styles.savedMetaGrid}>
                        <span>Last run</span>
                        <strong>{formatDate(selectedSavedSearch.lastRunAt)}</strong>
                        <span>Last success</span>
                        <strong>{formatDate(selectedSavedSearch.lastSuccessAt)}</strong>
                      </div>
                    </div>
                  ) : null}

                  {savedSearchError ? <p className={styles.inlineError}>{savedSearchError}</p> : null}
                  {!savedSearchesLoading && streetEasyEnabledSearches.length === 0 ? (
                    <p className={styles.inlineNote}>No StreetEasy-enabled saved searches are available.</p>
                  ) : null}

                  <div className={styles.formActions}>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!isModeEnabled("pull") || submitting === "pull" || streetEasyEnabledSearches.length === 0}
                    >
                      {submitting === "pull" ? "Starting..." : "Run saved search"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void fetchSavedSearches()}>
                      Refresh searches
                    </Button>
                  </div>
                </form>

                <div className={styles.actionSplit}>
                  <div>
                    <h3 className={styles.actionTitle}>Advanced one-off pull</h3>
                    <p>
                      Update an existing property ID or create one from a StreetEasy URL or sale ID with broker,
                      image, building, unit, comp, and sale-history toggles.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setPullPanelOpen(true)}
                    disabled={!isModeEnabled("pull")}
                  >
                    Open pull panel
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {activeMode === "om-upload" ? (
            <section className={styles.panel} aria-labelledby="om-upload-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>OM PDF upload</p>
                  <h2 id="om-upload-heading">Upload OM PDFs</h2>
                </div>
                <span className={styles.softPill}>Enrichment runs</span>
              </div>
              <div className={styles.handoffPanel}>
                <p>
                  OM PDF uploads parse the document address, create or match the property workspace,
                  promote OM data, and run enrichment before the deal-analysis workspace opens.
                </p>
                <Link href="/deal-analysis" className={styles.primaryLink}>
                  Open OM PDF upload
                </Link>
              </div>
            </section>
          ) : null}

          {activeMode === "comp-upload" ? (
            <section className={styles.panel} aria-labelledby="comp-upload-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>Comp package upload</p>
                  <h2 id="comp-upload-heading">Upload broker comps</h2>
                </div>
                <span className={styles.softPill}>Cap rates extracted</span>
              </div>
              <form className={styles.formStack} onSubmit={handleCompUpload}>
                <FileDropzone
                  files={compFiles}
                  onChange={setCompFiles}
                  accept=".pdf,.xlsx,.xls,.csv"
                  maxFiles={1}
                  maxBytes={50 * 1024 * 1024}
                  disabled={submitting === "comp-upload"}
                  label="Drag & drop a broker comp package"
                  hint="PDF or spreadsheet, up to 50 MB. The comp reader extracts each comparable with cap rate, $/PSF, sale price, NOI, and units, then links the package to the matched canonical property."
                />

                {/* Plain div (not Field's <label>) so clicks on option buttons don't re-focus the input and reopen the list. */}
                <div className={styles.field}>
                  <span className={styles.fieldLabel} id="comp-property-label">
                    Subject property
                  </span>
                  <div className={styles.comboboxWrap}>
                    <input
                      ref={compPropertyInputRef}
                      className={styles.input}
                      role="combobox"
                      aria-expanded={compDropdownOpen}
                      aria-controls="comp-property-listbox"
                      aria-autocomplete="list"
                      aria-labelledby="comp-property-label"
                      aria-activedescendant={compDropdownOpen ? `comp-property-option-${compActiveIndex}` : undefined}
                      value={compPropertyQuery}
                      onChange={(event) => handleCompPropertyInput(event.target.value)}
                      onFocus={() => setCompDropdownOpen(true)}
                      onClick={() => setCompDropdownOpen(true)}
                      onBlur={() => setCompDropdownOpen(false)}
                      onKeyDown={handleCompPropertyKeyDown}
                      placeholder="Auto-match by subject address — type to pick a property"
                      disabled={submitting === "comp-upload"}
                    />
                    {compDropdownOpen ? (
                      <div
                        className={styles.comboboxList}
                        id="comp-property-listbox"
                        role="listbox"
                        aria-label="Subject property suggestions"
                        // Keep focus in the input while scrolling/clicking inside the list.
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <button
                          type="button"
                          role="option"
                          id="comp-property-option-0"
                          aria-selected={!compPropertyId}
                          className={`${styles.comboboxOption} ${styles.comboboxOptionPinned} ${
                            compActiveIndex === 0 ? styles.comboboxOptionActive : ""
                          }`}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setCompActiveIndex(0)}
                          onClick={selectCompAutoMatch}
                        >
                          <span className={styles.comboboxOptionTitle}>Auto-match by subject address</span>
                          <span className={styles.comboboxOptionSub}>
                            Link using the address extracted from the package
                          </span>
                        </button>
                        {compSuggestions.map((option, index) => {
                          const rowIndex = index + 1;
                          const subtitle = propertyOptionSubtitle(option);
                          return (
                            <button
                              type="button"
                              role="option"
                              id={`comp-property-option-${rowIndex}`}
                              aria-selected={compPropertyId === option.id}
                              key={option.id}
                              className={`${styles.comboboxOption} ${
                                compActiveIndex === rowIndex ? styles.comboboxOptionActive : ""
                              }`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setCompActiveIndex(rowIndex)}
                              onClick={() => selectCompProperty(option)}
                            >
                              <span className={styles.comboboxOptionTitle}>{option.canonicalAddress}</span>
                              {subtitle ? <span className={styles.comboboxOptionSub}>{subtitle}</span> : null}
                            </button>
                          );
                        })}
                        {compSuggestions.length === 0 ? (
                          <p className={styles.comboboxEmpty}>
                            {propertyOptions.length === 0
                              ? "Loading canonical properties…"
                              : `No canonical property matches "${compPropertyQuery.trim()}".`}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {selectedCompProperty ? (
                    <span className={styles.selectionChip}>
                      Linking to {selectedCompProperty.canonicalAddress}
                      <button
                        type="button"
                        className={styles.selectionChipClear}
                        aria-label="Clear forced property link"
                        onClick={selectCompAutoMatch}
                      >
                        ×
                      </button>
                    </span>
                  ) : (
                    <span className={styles.fieldHint}>
                      Leave on auto-match to link by the package&apos;s subject address; start typing and pick a
                      canonical property to force the link.
                    </span>
                  )}
                </div>

                {compUnmatched ? <p className={styles.inlineError}>{compUnmatched}</p> : null}

                <div className={styles.formActions}>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting === "comp-upload" || compFiles.length === 0}
                  >
                    {submitting === "comp-upload" ? "Extracting comps..." : "Upload & extract comps"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setCompFiles([]);
                      setCompResult(null);
                      setCompUnmatched(null);
                      setCompPropertyId("");
                      setCompPropertyQuery("");
                      setCompDropdownOpen(false);
                      setCompActiveIndex(0);
                    }}
                  >
                    Clear
                  </Button>
                </div>

                {compResult?.property ? (
                  <div className={styles.savedSearchPreview}>
                    <div>
                      <strong>Linked to {compResult.property.canonicalAddress}</strong>
                      <p>
                        {(compResult.extraction?.compCount ?? compResult.extraction?.itemCount ?? 0)} comps ·{" "}
                        {compResult.extraction?.compsWithCapRate ?? 0} with cap rate
                        {compResult.extraction?.psfOnlyComps
                          ? ` · ${compResult.extraction.psfOnlyComps} $/PSF-only`
                          : ""}
                      </p>
                    </div>
                    <div className={styles.savedMetaGrid}>
                      <Link href={`/pipeline?propertyId=${encodeURIComponent(compResult.property.id)}`}>
                        Open property
                      </Link>
                      <Link href="/pipeline/comp-analysis">Comp analysis →</Link>
                    </div>
                  </div>
                ) : null}
              </form>
            </section>
          ) : null}
        </main>

        <aside className={styles.resultPanel}>
          <div className={styles.resultHeader}>
            <h2>Import activity</h2>
            <span>
              {recentImports.some((item) => item.status === "processing")
                ? `${recentImports.filter((item) => item.status === "processing").length} processing`
                : recentImports.length
                  ? `${recentImports.length} recent`
                  : "Idle"}
            </span>
          </div>
          {recentImports.length === 0 ? (
            <EmptyState
              title="No imports yet"
              description="Imports will appear here as soon as they start, then update when processing completes."
            />
          ) : (
            <div className={styles.recentList}>
              {recentImports.map((item) => (
                <article key={item.id} className={styles.recentItem}>
                  <div className={styles.recentItemHeader}>
                    <span className={styles.activityTitle}>
                      {item.status === "processing" ? <span className={styles.loadingSpinner} aria-hidden="true" /> : null}
                      <strong>{item.label}</strong>
                    </span>
                    <span className={`${styles.statusBadge} ${getActivityStatusClass(item)}`}>{getActivityStatusLabel(item)}</span>
                  </div>
                  <p>{item.message}</p>
                  <div className={styles.recentLinks}>
                    {item.job?.propertyId ? (
                      <Link href={`/pipeline?propertyId=${encodeURIComponent(item.job.propertyId)}`}>Open property</Link>
                    ) : null}
                    {item.job?.propertyId && item.job.jobType === "om_url" ? (
                      <Link href={`/deal-analysis?property_id=${encodeURIComponent(item.job.propertyId)}`}>Open analysis</Link>
                    ) : null}
                    <span>{new Date(item.updatedAt ?? item.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className={styles.supportBox}>
            <h3>Import paths</h3>
            <p>
              Manual, StreetEasy URL, and saved-search imports create pipeline properties. OM PDF uploads
              create or match property-backed deal-analysis workspaces and run enrichment automatically.
            </p>
          </div>
        </aside>
      </div>

      {pullPanelOpen ? (
        <div className={styles.drawerBackdrop} role="presentation">
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="pull-drawer-heading">
            <div className={styles.drawerHeader}>
              <div>
                <p className={styles.panelKicker}>Side-window import</p>
                <h2 id="pull-drawer-heading">Full StreetEasy pull</h2>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setPullPanelOpen(false)} aria-label="Close full pull panel">
                Close
              </button>
            </div>
            <form className={styles.drawerBody} onSubmit={handlePullSubmit}>
              <div className={styles.drawerFields}>
                <Field label="Existing property ID" hint="Optional. Leave blank to create or match by StreetEasy listing.">
                  <input
                    className={styles.input}
                    value={pullForm.propertyId}
                    onChange={(event) => updatePullForm("propertyId", event.target.value)}
                    placeholder="Property UUID"
                  />
                </Field>
                <Field label="StreetEasy URL">
                  <input
                    className={styles.input}
                    value={pullForm.url}
                    onChange={(event) => updatePullForm("url", event.target.value)}
                    placeholder="https://streeteasy.com/sale/..."
                  />
                </Field>
                <Field label="StreetEasy sale ID">
                  <input
                    className={styles.input}
                    value={pullForm.saleId}
                    onChange={(event) => updatePullForm("saleId", event.target.value)}
                    placeholder="1234567"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Saved search attribution">
                  <select
                    className={styles.input}
                    value={pullForm.savedSearchId}
                    onChange={(event) => updatePullForm("savedSearchId", event.target.value)}
                    disabled={savedSearchesLoading || savedSearches.length === 0}
                  >
                    <option value="">No saved search</option>
                    {streetEasyEnabledSearches.map((search) => (
                      <option key={search.id} value={search.id}>
                        {search.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className={styles.togglePanel}>
                <h3>Pull options</h3>
                <Toggle
                  label="Listing details"
                  description="Refresh the core StreetEasy sale payload."
                  checked={pullForm.includeListingDetails}
                  onChange={(checked) => updatePullForm("includeListingDetails", checked)}
                />
                <Toggle
                  label="Broker info"
                  description="Store broker candidates and run broker enrichment when available."
                  checked={pullForm.includeBrokerInfo}
                  onChange={(checked) => updatePullForm("includeBrokerInfo", checked)}
                />
                <Toggle
                  label="Images"
                  description="Attach listing media to the property gallery."
                  checked={pullForm.includeImages}
                  onChange={(checked) => updatePullForm("includeImages", checked)}
                />
                <Toggle
                  label="Building details"
                  description="Run city/building enrichment after the StreetEasy import."
                  checked={pullForm.includeBuildingDetails}
                  onChange={(checked) => updatePullForm("includeBuildingDetails", checked)}
                />
                <Toggle
                  label="Unit details"
                  description="Run the rental/unit flow for unit-level context."
                  checked={pullForm.includeUnitDetails}
                  onChange={(checked) => updatePullForm("includeUnitDetails", checked)}
                />
                <Toggle
                  label="Nearby comps"
                  description="Include comparable-property enrichment work where available."
                  checked={pullForm.includeNearbyComparables}
                  onChange={(checked) => updatePullForm("includeNearbyComparables", checked)}
                />
                <Toggle
                  label="Sale history"
                  description="Ask the endpoint to preserve sale-history intent in the import metadata."
                  checked={pullForm.includeSaleHistory}
                  onChange={(checked) => updatePullForm("includeSaleHistory", checked)}
                />
                <Toggle
                  label="Create property if missing"
                  description="When off, the endpoint requires an existing property ID."
                  checked={pullForm.createPropertyIfMissing}
                  onChange={(checked) => updatePullForm("createPropertyIfMissing", checked)}
                />
              </div>

              <div className={styles.drawerActions}>
                <Button type="submit" variant="primary" disabled={!isModeEnabled("pull") || submitting === "pull"}>
                  {submitting === "pull" ? "Running pull..." : "Run full pull"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPullForm(INITIAL_PULL_FORM)}>
                  Reset options
                </Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
