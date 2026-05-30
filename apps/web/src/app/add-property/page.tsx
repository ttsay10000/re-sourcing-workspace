"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  SearchProfile,
  UiV2ImportJobPayload,
  UiV2ImportJobResponse,
  UiV2ImportJobStatus,
  UiV2StreetEasyPullOptions,
} from "@re-sourcing/contracts";
import styles from "./page.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

type ModeId = "manual" | "streeteasy" | "pull" | "saved-search" | "om-upload" | "om-url";
type ModeCategoryId = "quick" | "market" | "documents";
type CapabilityKey =
  | "manualEntry"
  | "streetEasyUrl"
  | "streetEasySaleId"
  | "streetEasyPull"
  | "savedSearchRun"
  | "omUpload"
  | "omUrl";
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
  label: string;
  job: UiV2ImportJobStatus;
  at: string;
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
  importBy: "url" | "saleId";
  url: string;
  saleId: string;
  savedSearchId: string;
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

interface OmUrlFormState {
  url: string;
  propertyId: string;
  fileName: string;
}

const MODE_CARDS: Array<{
  id: ModeId;
  category: ModeCategoryId;
  label: string;
  kicker: string;
  description: string;
  capabilityKey: CapabilityKey | CapabilityKey[];
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
    label: "StreetEasy import",
    kicker: "URL or sale ID",
    description: "Pull one live listing into Pipeline from a URL or sale ID.",
    capabilityKey: ["streetEasyUrl", "streetEasySaleId"],
  },
  {
    id: "pull",
    category: "market",
    label: "Full StreetEasy pull",
    kicker: "Side window",
    description: "Open the richer flow with broker, image, building, unit, and comp toggles.",
    capabilityKey: "streetEasyPull",
  },
  {
    id: "saved-search",
    category: "market",
    label: "Saved-search run",
    kicker: "Automation",
    description: "Run configured search criteria and create sourced properties automatically.",
    capabilityKey: "savedSearchRun",
  },
  {
    id: "om-upload",
    category: "documents",
    label: "OM PDF upload",
    kicker: "Handoff",
    description: "Send offering memoranda into the current PDF analysis workflow.",
    capabilityKey: "omUpload",
  },
  {
    id: "om-url",
    category: "documents",
    label: "OM URL",
    kicker: "PDF link",
    description: "Analyze a directly downloadable OM PDF URL and create or update the deal workspace.",
    capabilityKey: "omUrl",
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
    id: "market",
    title: "Market sourcing",
    description: "Run StreetEasy flows or saved searches with more automation.",
  },
  {
    id: "documents",
    title: "Document intake",
    description: "Route OM files and future document sources into analysis.",
  },
];

const DEFAULT_ENDPOINTS: Record<CapabilityKey, string> = {
  manualEntry: "/api/ui-v2/import/manual-entry",
  streetEasyUrl: "/api/ui-v2/import/streeteasy-url",
  streetEasySaleId: "/api/ui-v2/import/streeteasy-sale-id",
  streetEasyPull: "/api/ui-v2/import/streeteasy-pull",
  savedSearchRun: "/api/ui-v2/import/saved-search-run",
  omUpload: "/api/ui-v2/import/om-upload",
  omUrl: "/api/ui-v2/import/om-url",
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
  importBy: "url",
  url: "",
  saleId: "",
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

const INITIAL_OM_URL_FORM: OmUrlFormState = {
  url: "",
  propertyId: "",
  fileName: "",
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

function getStatusClass(status: UiV2ImportJobStatus["status"]): string {
  if (status === "completed") return styles.statusGood;
  if (status === "failed") return styles.statusBad;
  if (status === "queued" || status === "running" || status === "pending") return styles.statusBusy;
  return styles.statusNeutral;
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
  const [omUrlForm, setOmUrlForm] = useState<OmUrlFormState>(INITIAL_OM_URL_FORM);
  const [pullPanelOpen, setPullPanelOpen] = useState(false);
  const [submitting, setSubmitting] = useState<ModeId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);

  const streetEasyEnabledSearches = useMemo(
    () => savedSearches.filter((search) => search.sourceToggles?.streeteasy !== false),
    [savedSearches]
  );

  const selectedSavedSearch = useMemo(() => {
    const id = activeMode === "saved-search" ? streetEasyForm.savedSearchId : pullForm.savedSearchId || streetEasyForm.savedSearchId;
    return savedSearches.find((search) => search.id === id) ?? null;
  }, [activeMode, pullForm.savedSearchId, savedSearches, streetEasyForm.savedSearchId]);

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
      const keys = Array.isArray(card.capabilityKey) ? card.capabilityKey : [card.capabilityKey];
      return keys.some((key) => isCapabilityEnabled(key));
    },
    [capabilities, capabilitiesLoading, isCapabilityEnabled]
  );

  const postImport = useCallback(
    async (mode: ModeId, endpoint: string, payload: unknown, label: string): Promise<UiV2ImportJobPayload> => {
      setSubmitting(mode);
      setNotice(null);
      try {
        const response = await fetch(buildApiUrl(endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await response.json().catch(() => ({}))) as Partial<UiV2ImportJobResponse> & {
          error?: string;
          details?: string;
        };
        const jobPayload = data.importJob;
        if (!response.ok || !jobPayload?.job) {
          const message =
            jobPayload?.job?.errorMessage ||
            data.error ||
            data.details ||
            `Import request failed with HTTP ${response.status}`;
          throw new Error(message);
        }

        setRecentImports((current) => [{ label, job: jobPayload.job, at: new Date().toISOString() }, ...current].slice(0, 6));
        setNotice({
          type: jobPayload.job.status === "failed" ? "error" : "success",
          title: jobPayload.job.label || label,
          message: getJobMessage(jobPayload.job),
          job: jobPayload.job,
        });
        return jobPayload;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import request failed";
        setNotice({ type: "error", title: `${label} failed`, message });
        throw err;
      } finally {
        setSubmitting(null);
      }
    },
    []
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

  const updateOmUrlForm = <K extends keyof OmUrlFormState>(key: K, value: OmUrlFormState[K]) => {
    setOmUrlForm((current) => ({ ...current, [key]: value }));
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
    if (streetEasyForm.importBy === "url") {
      const url = cleanString(streetEasyForm.url);
      if (!url) {
        setNotice({ type: "error", title: "StreetEasy URL required", message: "Paste a StreetEasy sale URL to import." });
        return;
      }
      await postImport(
        "streeteasy",
        endpointFor("streetEasyUrl"),
        { url, savedSearchId },
        "StreetEasy URL import"
      );
      return;
    }

    const saleId = cleanString(streetEasyForm.saleId);
    if (!saleId || !/^\d+$/.test(saleId)) {
      setNotice({ type: "error", title: "Numeric sale ID required", message: "Enter the numeric StreetEasy sale ID." });
      return;
    }
    await postImport(
      "streeteasy",
      endpointFor("streetEasySaleId"),
      { saleId, savedSearchId },
      "StreetEasy sale ID import"
    );
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

  const handleSavedSearchRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const savedSearchId = cleanString(streetEasyForm.savedSearchId);
    if (!savedSearchId) {
      setNotice({ type: "error", title: "Saved search required", message: "Choose a saved search to run now." });
      return;
    }
    await postImport(
      "saved-search",
      endpointFor("savedSearchRun"),
      { savedSearchId },
      "Saved-search run"
    );
  };

  const handleOmUrlSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = cleanString(omUrlForm.url);
    if (!url) {
      setNotice({ type: "error", title: "OM URL required", message: "Paste a directly downloadable OM PDF URL." });
      return;
    }
    await postImport(
      "om-url",
      endpointFor("omUrl"),
      {
        url,
        propertyId: cleanString(omUrlForm.propertyId),
        fileName: cleanString(omUrlForm.fileName),
      },
      "OM URL import"
    );
  };

  return (
    <div className={styles.page}>
      <section className={styles.headerBand}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>Property intake</p>
          <h1>Add property</h1>
          <p>
            Bring a property into the sourcing flow from manual details, a StreetEasy listing, a saved search,
            or an OM PDF/link.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/pipeline" className={styles.secondaryLink}>
            Pipeline
          </Link>
          <Link href="/deal-analysis" className={styles.primaryLink}>
            Upload OM PDF
          </Link>
        </div>
      </section>

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
                        onClick={() => {
                          setActiveMode(mode.id);
                          if (mode.id === "pull") setPullPanelOpen(true);
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
                  <button type="submit" className={styles.primaryButton} disabled={!isModeEnabled("manual") || submitting === "manual"}>
                    {submitting === "manual" ? "Importing..." : "Create manual property"}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => setManualForm(INITIAL_MANUAL_FORM)}>
                    Clear form
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {activeMode === "streeteasy" ? (
            <section className={styles.panel} aria-labelledby="streeteasy-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>StreetEasy import</p>
                  <h2 id="streeteasy-heading">Import by URL or sale ID</h2>
                </div>
              </div>
              <form className={styles.formStack} onSubmit={handleStreetEasySubmit}>
                <div className={styles.segmentedControl} role="tablist" aria-label="StreetEasy import type">
                  <button
                    type="button"
                    className={`${styles.segmentButton} ${streetEasyForm.importBy === "url" ? styles.segmentButtonActive : ""}`}
                    onClick={() => updateStreetEasyForm("importBy", "url")}
                  >
                    StreetEasy URL
                  </button>
                  <button
                    type="button"
                    className={`${styles.segmentButton} ${streetEasyForm.importBy === "saleId" ? styles.segmentButtonActive : ""}`}
                    onClick={() => updateStreetEasyForm("importBy", "saleId")}
                  >
                    Sale ID
                  </button>
                </div>

                {streetEasyForm.importBy === "url" ? (
                  <Field label="StreetEasy sale URL">
                    <input
                      className={styles.input}
                      value={streetEasyForm.url}
                      onChange={(event) => updateStreetEasyForm("url", event.target.value)}
                      placeholder="https://streeteasy.com/sale/..."
                      required
                    />
                  </Field>
                ) : (
                  <Field label="StreetEasy sale ID">
                    <input
                      className={styles.input}
                      value={streetEasyForm.saleId}
                      onChange={(event) => updateStreetEasyForm("saleId", event.target.value)}
                      placeholder="1234567"
                      inputMode="numeric"
                      required
                    />
                  </Field>
                )}

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
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={!isModeEnabled("streeteasy") || submitting === "streeteasy"}
                  >
                    {submitting === "streeteasy" ? "Importing..." : "Import StreetEasy listing"}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => setPullPanelOpen(true)}>
                    Open full pull panel
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {activeMode === "pull" ? (
            <section className={styles.panel} aria-labelledby="pull-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>Full StreetEasy pull</p>
                  <h2 id="pull-heading">Use the side-window importer</h2>
                </div>
              </div>
              <div className={styles.actionSplit}>
                <div>
                  <p>
                    The full pull can update an existing property ID or create one from a StreetEasy URL or sale ID.
                    Use the side window to choose exactly which follow-up data to fetch.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => setPullPanelOpen(true)}
                  disabled={!isModeEnabled("pull")}
                >
                  Open pull panel
                </button>
              </div>
            </section>
          ) : null}

          {activeMode === "saved-search" ? (
            <section className={styles.panel} aria-labelledby="saved-search-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>Saved-search run</p>
                  <h2 id="saved-search-heading">Run a saved search now</h2>
                </div>
              </div>
              <form className={styles.formStack} onSubmit={handleSavedSearchRun}>
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
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={!isModeEnabled("saved-search") || submitting === "saved-search" || streetEasyEnabledSearches.length === 0}
                  >
                    {submitting === "saved-search" ? "Starting..." : "Run saved search"}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void fetchSavedSearches()}>
                    Refresh searches
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {activeMode === "om-upload" ? (
            <section className={styles.panel} aria-labelledby="om-upload-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>OM PDF handoff</p>
                  <h2 id="om-upload-heading">Upload OM PDFs</h2>
                </div>
                <span className={styles.disabledPill}>Current upload flow</span>
              </div>
              <div className={styles.handoffPanel}>
                <p>
                  OM PDFs use the current upload flow today. That path can parse the OM and attach
                  underwriting context while the shared extractor is still being built.
                </p>
                <Link href="/deal-analysis" className={styles.primaryLink}>
                  Open OM PDF upload
                </Link>
              </div>
            </section>
          ) : null}

          {activeMode === "om-url" ? (
            <section className={styles.panel} aria-labelledby="om-url-heading">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelKicker}>OM PDF URL</p>
                  <h2 id="om-url-heading">Analyze by link</h2>
                </div>
                <span className={styles.softPill}>10 MB max</span>
              </div>
              <form className={styles.formStack} onSubmit={handleOmUrlSubmit}>
                <Field label="OM PDF URL" hint="Direct PDF/download links work best. The importer downloads the PDF, analyzes it, and saves it to the matched property.">
                  <input
                    className={styles.input}
                    value={omUrlForm.url}
                    onChange={(event) => updateOmUrlForm("url", event.target.value)}
                    placeholder="https://.../offering-memorandum.pdf"
                    required
                  />
                </Field>
                <div className={styles.twoColumn}>
                  <Field label="Existing property ID" hint="Optional. Leave blank to create or match from the OM address.">
                    <input
                      className={styles.input}
                      value={omUrlForm.propertyId}
                      onChange={(event) => updateOmUrlForm("propertyId", event.target.value)}
                      placeholder="Optional property UUID"
                    />
                  </Field>
                  <Field label="File name" hint="Optional display name for the saved document.">
                    <input
                      className={styles.input}
                      value={omUrlForm.fileName}
                      onChange={(event) => updateOmUrlForm("fileName", event.target.value)}
                      placeholder="Offering Memorandum.pdf"
                    />
                  </Field>
                </div>
                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryButton} disabled={!isModeEnabled("om-url") || submitting === "om-url"}>
                    {submitting === "om-url" ? "Analyzing OM link..." : "Analyze OM URL"}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => setOmUrlForm(INITIAL_OM_URL_FORM)}>
                    Clear link
                  </button>
                </div>
              </form>
            </section>
          ) : null}
        </main>

        <aside className={styles.resultPanel}>
          <div className={styles.resultHeader}>
            <h2>Import activity</h2>
            <span>{recentImports.length ? `${recentImports.length} recent` : "Idle"}</span>
          </div>
          {recentImports.length === 0 ? (
            <p className={styles.emptyState}>Successful imports and queued runs will appear here for quick follow-up.</p>
          ) : (
            <div className={styles.recentList}>
              {recentImports.map((item) => (
                <article key={`${item.job.id}-${item.at}`} className={styles.recentItem}>
                  <div className={styles.recentItemHeader}>
                    <strong>{item.label}</strong>
                    <span className={`${styles.statusBadge} ${getStatusClass(item.job.status)}`}>{item.job.status}</span>
                  </div>
                  <p>{item.job.label || getJobMessage(item.job)}</p>
                  <div className={styles.recentLinks}>
                    {item.job.propertyId ? (
                      <Link href={`/pipeline?propertyId=${encodeURIComponent(item.job.propertyId)}`}>Open property</Link>
                    ) : null}
                    {item.job.propertyId && item.job.jobType === "om_url" ? (
                      <Link href={`/deal-analysis?property_id=${encodeURIComponent(item.job.propertyId)}`}>Open analysis</Link>
                    ) : null}
                    <span>{new Date(item.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className={styles.supportBox}>
            <h3>Import paths</h3>
            <p>
              Manual, StreetEasy, and saved-search imports create pipeline properties. OM PDF uploads and OM URL
              imports populate the shared deal-analysis workspace.
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
                <button type="submit" className={styles.primaryButton} disabled={!isModeEnabled("pull") || submitting === "pull"}>
                  {submitting === "pull" ? "Running pull..." : "Run full pull"}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => setPullForm(INITIAL_PULL_FORM)}>
                  Reset options
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
