"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckSquare,
  Eye,
  ExternalLink,
  FilePlus2,
  FileSearch,
  RefreshCw,
  Search,
  Square,
  Upload,
} from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { useProcessBanner } from "@/components/ProcessBanner";
import styles from "./page.module.css";

const CATEGORY_OPTIONS = [
  "OM",
  "Brochure",
  "Rent Roll",
  "Financial Model",
  "T12 / Operating Summary",
  "Broker Comp Package",
  "Sale Comp Package",
  "Rent Comp Package",
  "Expense Comp Package",
  "Market Analysis",
  "Other",
] as const;

type DocumentCategory = (typeof CATEGORY_OPTIONS)[number];
type PullMode = "since_last" | "system_start" | "custom";
type LookbackUnit = "days" | "weeks" | "months";

const LOOKBACK_UNIT_OPTIONS: Array<{ value: LookbackUnit; label: string }> = [
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
  { value: "months", label: "months" },
];

interface PropertyOption {
  id: string;
  canonicalAddress: string;
}

interface GmailDocumentCandidate {
  id: string;
  messageId: string;
  threadId: string | null;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  large: boolean;
  tooLarge: boolean;
  suggestedCategory: DocumentCategory;
  classificationConfidence: "high" | "medium" | "low";
  classificationReason: string;
  previewKind: "pdf" | "text" | "none";
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  bodyPreview: string | null;
  gmailUrl: string | null;
  matchedReason: string;
  matchedProperty?: PropertyOption | null;
  matchedProperties?: PropertyOption[];
}

interface NewPropertyEmailCandidate {
  id: string;
  messageId: string;
  threadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  bodyPreview: string | null;
  gmailUrl: string | null;
  matchedReason: string;
  attachments: GmailDocumentCandidate[];
}

interface PullState {
  propertyId: string | null;
  canonicalAddress: string | null;
  systemStartAt: string;
  lastPulledAt: string | null;
  largeAttachmentBytes: number;
  maxAttachmentBytes: number;
}

interface SearchResponse {
  ok: boolean;
  property: PropertyOption | null;
  mode: PullMode;
  query: string;
  baselineAt: string;
  previousLastPulledAt: string | null;
  searchRunAt: string;
  lastPulledAt: string;
  systemStartAt: string;
  largeAttachmentBytes: number;
  maxAttachmentBytes: number;
  documents: GmailDocumentCandidate[];
  /** True when the scan stopped at its server-side time budget — pull again to continue. */
  truncated?: boolean;
  newPropertyCandidates: NewPropertyEmailCandidate[];
}

interface SelectionState {
  selected: boolean;
  category: DocumentCategory;
  propertyId: string;
}

interface ImportResponse {
  ok: boolean;
  imported?: Array<{ id: string; filename: string; category: DocumentCategory }>;
  skipped?: Array<{ reason: string; documentId?: string | null }>;
  errors?: Array<{ error: string }>;
  omReview?: { runId?: string | null; error?: string } | null;
  omReviews?: Array<{ propertyId: string; canonicalAddress: string }>;
  error?: string;
  details?: string;
}

interface CreatePropertyResponse {
  ok: boolean;
  propertyId: string;
  canonicalAddress: string;
  createdProperty: boolean;
  matchStrategy: string;
  uploadedDocuments?: Array<{ id: string; fileName: string }>;
  error?: string;
  details?: string;
}

function formatBytes(value: number | null): string {
  if (value == null) return "Unknown size";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function candidatePreviewUrl(candidate: GmailDocumentCandidate): string {
  const params = new URLSearchParams({
    messageId: candidate.messageId,
    attachmentId: candidate.attachmentId,
    filename: candidate.filename,
    mimeType: candidate.mimeType,
  });
  return `${API_BASE}/api/broker-om/email-attachments/preview?${params.toString()}`;
}

function defaultSelection(documents: GmailDocumentCandidate[], fallbackPropertyId: string): Record<string, SelectionState> {
  return Object.fromEntries(
    documents.map((document) => [
      document.id,
      {
        selected: false,
        category: document.suggestedCategory,
        propertyId: fallbackPropertyId || document.matchedProperty?.id || "",
      },
    ])
  );
}

function isPdfCandidate(candidate: GmailDocumentCandidate): boolean {
  return candidate.mimeType.toLowerCase().includes("pdf") || candidate.filename.toLowerCase().endsWith(".pdf");
}

function computeSinceDate(amount: number, unit: LookbackUnit): Date {
  const since = new Date();
  if (unit === "days") since.setDate(since.getDate() - amount);
  else if (unit === "weeks") since.setDate(since.getDate() - amount * 7);
  else since.setMonth(since.getMonth() - amount);
  return since;
}

function shortAddress(value: string): string {
  return value.split(",")[0]?.trim() || value;
}

export default function BrokerOmEmailSearchPage() {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [pullState, setPullState] = useState<PullState | null>(null);
  const [mode, setMode] = useState<PullMode>("since_last");
  const [lookbackAmount, setLookbackAmount] = useState(30);
  const [lookbackUnit, setLookbackUnit] = useState<LookbackUnit>("days");
  const [query, setQuery] = useState("");
  const [includeNewPropertyCandidates, setIncludeNewPropertyCandidates] = useState(true);
  const [maxMessages, setMaxMessages] = useState(50);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [selection, setSelection] = useState<Record<string, SelectionState>>({});
  const [preview, setPreview] = useState<GmailDocumentCandidate | null>(null);
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [stateLoading, setStateLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const processBanner = useProcessBanner();
  const [creatingPropertyId, setCreatingPropertyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialPropertyId = params.get("propertyId") ?? params.get("property_id") ?? "";
    if (initialPropertyId) setPropertyId(initialPropertyId);
  }, []);

  const loadProperties = useCallback(async () => {
    setLoadingProperties(true);
    try {
      const response = await fetch(`${API_BASE}/api/properties`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || data?.details || "Failed to load properties");
      const rows = Array.isArray(data?.properties) ? data.properties : [];
      setProperties(
        rows.map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ""),
          canonicalAddress: String(row.canonicalAddress ?? row.canonical_address ?? ""),
        })).filter((row: PropertyOption) => row.id && row.canonicalAddress)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties");
    } finally {
      setLoadingProperties(false);
    }
  }, []);

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === propertyId) ?? null,
    [properties, propertyId]
  );

  const loadPullState = useCallback(async (nextPropertyId: string) => {
    setStateLoading(true);
    setError(null);
    try {
      const url = nextPropertyId
        ? `${API_BASE}/api/broker-om/properties/${encodeURIComponent(nextPropertyId)}/email-pull-state`
        : `${API_BASE}/api/broker-om/email-pull-state`;
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || data?.details || "Failed to load pull state");
      setPullState(data as PullState);
    } catch (err) {
      setPullState(null);
      setError(err instanceof Error ? err.message : "Failed to load pull state");
    } finally {
      setStateLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPullState(propertyId);
  }, [loadPullState, propertyId]);

  const allPropertiesMode = propertyId === "";
  const documents = searchResult?.documents ?? [];
  const selectedDocuments = documents.filter((document) => selection[document.id]?.selected);
  const selectedLargeCount = selectedDocuments.filter((document) => document.large).length;
  const selectedTooLargeCount = selectedDocuments.filter((document) => document.tooLarge).length;
  const selectedUnassignedCount = allPropertiesMode
    ? selectedDocuments.filter((document) => !selection[document.id]?.propertyId).length
    : 0;

  const runSearch = async () => {
    if (mode === "custom" && (!Number.isFinite(lookbackAmount) || lookbackAmount < 1)) {
      setError("Set a lookback period of at least 1 before pulling Gmail.");
      return;
    }
    setSearching(true);
    setNotice(null);
    setError(null);
    setPreview(null);
    const banner = processBanner.start("Email pull", {
      message: propertyId ? "Scanning Gmail for this property…" : "Scanning Gmail for deal documents…",
    });
    try {
      const url = propertyId
        ? `${API_BASE}/api/broker-om/properties/${encodeURIComponent(propertyId)}/email-search`
        : `${API_BASE}/api/broker-om/email-search`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          sinceDate: mode === "custom" ? computeSinceDate(lookbackAmount, lookbackUnit).toISOString() : null,
          query: query.trim() || null,
          maxMessages,
          includeNewPropertyCandidates: propertyId ? includeNewPropertyCandidates : false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || data?.details || "Failed to search Gmail");
      const result = data as SearchResponse;
      setSearchResult(result);
      setSelection(defaultSelection(result.documents, propertyId));
      setPullState({
        propertyId: result.property?.id ?? null,
        canonicalAddress: result.property?.canonicalAddress ?? null,
        systemStartAt: result.systemStartAt,
        lastPulledAt: result.lastPulledAt,
        largeAttachmentBytes: result.largeAttachmentBytes,
        maxAttachmentBytes: result.maxAttachmentBytes,
      });
      const matchedCount = result.documents.filter((document) => document.matchedProperty).length;
      const truncatedNote = result.truncated
        ? " Partial pull — the scan hit its time budget; pull again to continue."
        : "";
      const summary = propertyId
        ? `Pull complete: ${result.documents.length} property document${result.documents.length === 1 ? "" : "s"} found.${truncatedNote}`
        : `Pull complete: ${result.documents.length} deal document${result.documents.length === 1 ? "" : "s"} found, ${matchedCount} matched to existing properties.${truncatedNote}`;
      setNotice(summary);
      banner.succeed(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to search Gmail";
      banner.fail(message);
      setError(message);
    } finally {
      setSearching(false);
    }
  };

  const fallbackDocumentPropertyId = useCallback(
    (document: GmailDocumentCandidate) => propertyId || document.matchedProperty?.id || "",
    [propertyId]
  );

  const updateDocumentSelection = (document: GmailDocumentCandidate, patch: Partial<SelectionState>) => {
    setSelection((current) => ({
      ...current,
      [document.id]: {
        selected: current[document.id]?.selected ?? false,
        category: current[document.id]?.category ?? document.suggestedCategory,
        propertyId: current[document.id]?.propertyId ?? fallbackDocumentPropertyId(document),
        ...patch,
      },
    }));
  };

  const selectAllEligible = () => {
    setSelection((current) => {
      const next = { ...current };
      for (const document of documents) {
        next[document.id] = {
          selected: !document.tooLarge,
          category: current[document.id]?.category ?? document.suggestedCategory,
          propertyId: current[document.id]?.propertyId ?? fallbackDocumentPropertyId(document),
        };
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelection((current) => {
      const next = { ...current };
      for (const document of documents) {
        next[document.id] = {
          selected: false,
          category: current[document.id]?.category ?? document.suggestedCategory,
          propertyId: current[document.id]?.propertyId ?? fallbackDocumentPropertyId(document),
        };
      }
      return next;
    });
  };

  const propertyLabel = useCallback(
    (id: string) => {
      const match = properties.find((property) => property.id === id);
      return match ? shortAddress(match.canonicalAddress) : "Unassigned";
    },
    [properties]
  );

  const importSelected = async () => {
    if (selectedDocuments.length === 0) return;
    if (allPropertiesMode && selectedUnassignedCount > 0) {
      setError("Assign a property to every selected document before uploading.");
      return;
    }
    const categorySummary = selectedDocuments
      .map((document) => {
        const category = selection[document.id]?.category ?? document.suggestedCategory;
        if (propertyId) return `${document.filename} -> ${category}`;
        return `${document.filename} -> ${category} -> ${propertyLabel(selection[document.id]?.propertyId ?? "")}`;
      })
      .join("\n");
    const confirmed = window.confirm(
      propertyId
        ? `Upload ${selectedDocuments.length} Gmail document${selectedDocuments.length === 1 ? "" : "s"} to ${selectedProperty?.canonicalAddress ?? "this property"}?\n\n${categorySummary}`
        : `Upload ${selectedDocuments.length} Gmail document${selectedDocuments.length === 1 ? "" : "s"} to their assigned properties?\n\n${categorySummary}`
    );
    if (!confirmed) return;
    setImporting(true);
    setNotice(null);
    setError(null);
    const banner = processBanner.start("Importing email documents", {
      message: `Uploading ${selectedDocuments.length} document${selectedDocuments.length === 1 ? "" : "s"} from Gmail…`,
    });
    try {
      const url = propertyId
        ? `${API_BASE}/api/broker-om/properties/${encodeURIComponent(propertyId)}/import-email-documents`
        : `${API_BASE}/api/broker-om/import-email-documents`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runOmReview: true,
          documents: selectedDocuments.map((document) => ({
            messageId: document.messageId,
            attachmentId: document.attachmentId,
            filename: document.filename,
            mimeType: document.mimeType,
            category: selection[document.id]?.category ?? document.suggestedCategory,
            ...(propertyId ? {} : { propertyId: selection[document.id]?.propertyId ?? "" }),
          })),
        }),
      });
      const data = (await response.json()) as ImportResponse;
      if (!response.ok || data.error) throw new Error(data.error || data.details || "Failed to import documents");
      const importedCount = data.imported?.length ?? 0;
      const skippedCount = data.skipped?.length ?? 0;
      const errorCount = data.errors?.length ?? 0;
      const summary = `Imported ${importedCount} document${importedCount === 1 ? "" : "s"}${skippedCount ? `, skipped ${skippedCount}` : ""}${errorCount ? `, ${errorCount} failed` : ""}.`;
      setNotice(summary);
      if (errorCount > 0) banner.fail(summary);
      else banner.succeed(summary);
      clearSelection();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import selected documents";
      banner.fail(message);
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  const createPropertyFromAttachment = async (candidate: GmailDocumentCandidate) => {
    const confirmed = window.confirm(`Create or match a property from ${candidate.filename}?`);
    if (!confirmed) return;
    setCreatingPropertyId(candidate.id);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/broker-om/create-property-from-email-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: candidate.messageId,
          attachmentId: candidate.attachmentId,
          filename: candidate.filename,
          mimeType: candidate.mimeType,
        }),
      });
      const data = (await response.json()) as CreatePropertyResponse;
      if (!response.ok || data.error) throw new Error(data.error || data.details || "Failed to create property");
      setNotice(
        `${data.createdProperty ? "Created" : "Matched"} property: ${data.canonicalAddress}.`
      );
      await loadProperties();
      setSelection((current) => ({
        ...current,
        [candidate.id]: {
          selected: current[candidate.id]?.selected ?? false,
          category: current[candidate.id]?.category ?? candidate.suggestedCategory,
          propertyId: data.propertyId,
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create property from Gmail document");
    } finally {
      setCreatingPropertyId(null);
    }
  };

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Broker OM"
        title="Find OMs in Email"
        subtitle="Manually pull Gmail attachments to find OMs, rent rolls, and financial documents — then import them into the property workspace."
        actions={
          <div className={styles.headerActions}>
            <Link href="/om-review" className={styles.secondaryButton}>
              <FileSearch size={16} aria-hidden="true" />
              <span>Email review queue</span>
            </Link>
            {propertyId ? (
              <Link href={`/property-data?expand=${encodeURIComponent(propertyId)}`} className={styles.secondaryButton}>
                <ExternalLink size={16} aria-hidden="true" />
                <span>Property card</span>
              </Link>
            ) : null}
          </div>
        }
      />

      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.panel}>
        <div className={styles.controls}>
          <label className={styles.field}>
            <span className={styles.label}>Property scope</span>
            <select
              className={styles.select}
              value={propertyId}
              onChange={(event) => {
                setPropertyId(event.target.value);
                setSearchResult(null);
                setSelection({});
                setPreview(null);
              }}
              disabled={loadingProperties}
            >
              <option value="">{loadingProperties ? "Loading properties..." : "All properties (deal keywords)"}</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.canonicalAddress}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Extra Gmail terms</span>
            <input
              className={styles.input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="broker, firm, OM"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Manual pull window</span>
            <div className={styles.segmented}>
              <button
                type="button"
                className={`${styles.segment} ${mode === "since_last" ? styles.segmentActive : ""}`}
                onClick={() => setMode("since_last")}
              >
                Since last
              </button>
              <button
                type="button"
                className={`${styles.segment} ${mode === "system_start" ? styles.segmentActive : ""}`}
                onClick={() => setMode("system_start")}
              >
                Since Mar 2026
              </button>
              <button
                type="button"
                className={`${styles.segment} ${mode === "custom" ? styles.segmentActive : ""}`}
                onClick={() => setMode("custom")}
              >
                Custom
              </button>
            </div>
          </label>

          <button type="button" className={styles.button} onClick={() => void runSearch()} disabled={searching}>
            {searching ? <RefreshCw size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            <span>{searching ? "Pulling..." : "Pull Gmail"}</span>
          </button>
        </div>
        <div className={styles.toggles}>
          {mode === "custom" ? (
            <label className={styles.checkboxLine}>
              <span>Look back</span>
              <input
                className={styles.input}
                style={{ width: "4.5rem", minHeight: "2rem" }}
                type="number"
                min={1}
                value={lookbackAmount}
                onChange={(event) => setLookbackAmount(Math.max(1, Number(event.target.value) || 1))}
              />
              <select
                className={styles.select}
                style={{ width: "auto", minHeight: "2rem" }}
                value={lookbackUnit}
                onChange={(event) => setLookbackUnit(event.target.value as LookbackUnit)}
              >
                {LOOKBACK_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className={styles.mutedPill}>Since {formatDate(computeSinceDate(lookbackAmount, lookbackUnit).toISOString())}</span>
            </label>
          ) : null}
          {!allPropertiesMode ? (
            <label className={styles.checkboxLine}>
              <input
                type="checkbox"
                checked={includeNewPropertyCandidates}
                onChange={(event) => setIncludeNewPropertyCandidates(event.target.checked)}
              />
              <span>Flag separate OM/rent roll emails since March 2026</span>
            </label>
          ) : (
            <span className={styles.checkboxLine}>
              Searches your whole inbox for OM, offering memorandum, rent roll, rent/expense, T12, and pro forma attachments.
            </span>
          )}
          <label className={styles.checkboxLine}>
            <span>Messages</span>
            <input
              className={styles.input}
              style={{ width: "5rem", minHeight: "2rem" }}
              type="number"
              min={1}
              max={100}
              value={maxMessages}
              onChange={(event) => setMaxMessages(Math.max(1, Math.min(100, Number(event.target.value) || 50)))}
            />
          </label>
        </div>
        <div className={styles.metaBar}>
          <span className={styles.pill}>Last pull: {stateLoading ? "Loading..." : formatDate(pullState?.lastPulledAt)}</span>
          <span className={styles.pill}>System baseline: {formatDate(pullState?.systemStartAt ?? "2026-03-01T05:00:00.000Z")}</span>
          <span className={styles.warnPill}>
            <AlertTriangle size={14} aria-hidden="true" />
            Large: {formatBytes(pullState?.largeAttachmentBytes ?? 10 * 1024 * 1024)}
          </span>
          <span className={styles.warnPill}>Max: {formatBytes(pullState?.maxAttachmentBytes ?? 25 * 1024 * 1024)}</span>
        </div>
      </section>

      <div className={styles.contentGrid}>
        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>{allPropertiesMode ? "Deal documents (all properties)" : "Property documents"}</h2>
              <p>{searchResult ? `${documents.length} attachment${documents.length === 1 ? "" : "s"} found` : "No pull run yet"}</p>
            </div>
            <div className={styles.headerActions}>
              <button type="button" className={styles.ghostButton} onClick={selectAllEligible} disabled={documents.length === 0}>
                <CheckSquare size={15} aria-hidden="true" />
                <span>Select eligible</span>
              </button>
              <button type="button" className={styles.ghostButton} onClick={clearSelection} disabled={selectedDocuments.length === 0}>
                <Square size={15} aria-hidden="true" />
                <span>Clear</span>
              </button>
              <button
                type="button"
                className={selectedTooLargeCount || selectedUnassignedCount ? styles.dangerButton : styles.button}
                onClick={() => void importSelected()}
                disabled={importing || selectedDocuments.length === 0 || selectedTooLargeCount > 0 || selectedUnassignedCount > 0}
              >
                <Upload size={15} aria-hidden="true" />
                <span>{importing ? "Uploading..." : `Upload ${selectedDocuments.length || ""}`.trim()}</span>
              </button>
            </div>
          </div>
          {selectedLargeCount || selectedUnassignedCount ? (
            <div className={styles.metaBar}>
              {selectedLargeCount ? (
                <span className={styles.warnPill}>
                  <AlertTriangle size={14} aria-hidden="true" />
                  {selectedLargeCount} selected large file{selectedLargeCount === 1 ? "" : "s"}
                </span>
              ) : null}
              {selectedTooLargeCount ? <span className={styles.warnPill}>{selectedTooLargeCount} over max</span> : null}
              {selectedUnassignedCount ? (
                <span className={styles.warnPill}>
                  <AlertTriangle size={14} aria-hidden="true" />
                  {selectedUnassignedCount} selected without a property
                </span>
              ) : null}
            </div>
          ) : null}
          <div className={styles.rowList}>
            {documents.length === 0 ? (
              <EmptyState
                title={
                  searchResult
                    ? allPropertiesMode
                      ? "No deal-document attachments found in this window."
                      : "No property-linked documents found."
                    : "Run a manual pull to load Gmail candidates."
                }
              />
            ) : (
              documents.map((document) => {
                const selected = selection[document.id]?.selected ?? false;
                const category = selection[document.id]?.category ?? document.suggestedCategory;
                const assignedPropertyId = selection[document.id]?.propertyId ?? fallbackDocumentPropertyId(document);
                return (
                  <article key={document.id} className={styles.documentRow}>
                    <button
                      type="button"
                      className={`${styles.checkButton} ${selected ? styles.checkButtonActive : ""}`}
                      aria-label={selected ? `Deselect ${document.filename}` : `Select ${document.filename}`}
                      onClick={() => updateDocumentSelection(document, { selected: !selected })}
                      disabled={document.tooLarge}
                    >
                      {selected ? <CheckSquare size={17} aria-hidden="true" /> : <Square size={17} aria-hidden="true" />}
                    </button>
                    <div>
                      <p className={styles.fileName}>{document.filename}</p>
                      <div className={styles.fileMeta}>
                        <span className={document.large ? styles.warnPill : styles.mutedPill}>{formatBytes(document.sizeBytes)}</span>
                        <span className={styles.mutedPill}>{document.mimeType}</span>
                        <span className={styles.mutedPill}>{document.classificationConfidence}</span>
                        {allPropertiesMode ? (
                          document.matchedProperty ? (
                            <span className={styles.okPill}>{shortAddress(document.matchedProperty.canonicalAddress)}</span>
                          ) : (
                            <span className={styles.warnPill}>No property match</span>
                          )
                        ) : null}
                        {document.tooLarge ? <span className={styles.warnPill}>Over import max</span> : null}
                      </div>
                      <p className={styles.emailMeta}>
                        {document.fromAddress ?? "Unknown sender"} | {formatDate(document.receivedAt)} | {document.subject ?? "No subject"}
                      </p>
                    </div>
                    <div className={styles.rowSelects}>
                      <select
                        className={styles.select}
                        value={category}
                        onChange={(event) => updateDocumentSelection(document, { category: event.target.value as DocumentCategory })}
                      >
                        {CATEGORY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      {allPropertiesMode ? (
                        <select
                          className={styles.select}
                          value={assignedPropertyId}
                          aria-label={`Assign property for ${document.filename}`}
                          onChange={(event) => updateDocumentSelection(document, { propertyId: event.target.value })}
                        >
                          <option value="">Unassigned</option>
                          {properties.map((property) => (
                            <option key={property.id} value={property.id}>
                              {shortAddress(property.canonicalAddress)}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => setPreview(document)}>
                        <Eye size={15} aria-hidden="true" />
                        <span>Preview</span>
                      </button>
                      {document.gmailUrl ? (
                        <a href={document.gmailUrl} target="_blank" rel="noreferrer" className={styles.secondaryButton}>
                          <ExternalLink size={15} aria-hidden="true" />
                          <span>Gmail</span>
                        </a>
                      ) : null}
                      {allPropertiesMode && !assignedPropertyId ? (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void createPropertyFromAttachment(document)}
                          disabled={!isPdfCandidate(document) || document.tooLarge || creatingPropertyId === document.id}
                        >
                          <FilePlus2 size={15} aria-hidden="true" />
                          <span>{creatingPropertyId === document.id ? "Creating..." : "Create property"}</span>
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        <aside className={styles.previewPanel}>
          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Preview</h2>
                <p>{preview ? preview.filename : "Select a result"}</p>
              </div>
            </div>
            {preview == null ? (
              <div className={styles.previewFallback}><EmptyState title="No document selected." /></div>
            ) : preview.previewKind === "none" ? (
              <div className={styles.previewFallback}>
                <div>
                  <p>{preview.filename}</p>
                  <p>{formatBytes(preview.sizeBytes)} | {preview.mimeType}</p>
                  {preview.gmailUrl ? (
                    <a href={preview.gmailUrl} target="_blank" rel="noreferrer" className={styles.secondaryButton}>
                      <ExternalLink size={15} aria-hidden="true" />
                      <span>Open in Gmail</span>
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <iframe className={styles.previewFrame} src={candidatePreviewUrl(preview)} title={`Preview ${preview.filename}`} />
            )}
          </section>
        </aside>
      </div>

      {allPropertiesMode ? null : (
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Possible new properties</h2>
            <p>{searchResult ? `${searchResult.newPropertyCandidates.length} email${searchResult.newPropertyCandidates.length === 1 ? "" : "s"} flagged` : "Run a pull with keyword flagging enabled"}</p>
          </div>
        </div>
        {searchResult == null || searchResult.newPropertyCandidates.length === 0 ? (
          <EmptyState
            title={searchResult ? "No separate OM or rent roll emails were flagged." : "No flagged emails yet."}
          />
        ) : (
          <div className={styles.candidateList}>
            {searchResult.newPropertyCandidates.map((candidate) => (
              <article key={candidate.id} className={styles.candidate}>
                <div className={styles.candidateHeader}>
                  <h3>{candidate.subject ?? "No subject"}</h3>
                  <div className={styles.fileMeta}>
                    <span className={styles.warnPill}>{candidate.matchedReason}</span>
                    <span className={styles.mutedPill}>{candidate.fromAddress ?? "Unknown sender"}</span>
                    <span className={styles.mutedPill}>{formatDate(candidate.receivedAt)}</span>
                    {candidate.gmailUrl ? (
                      <a href={candidate.gmailUrl} target="_blank" rel="noreferrer" className={styles.ghostButton}>
                        <ExternalLink size={14} aria-hidden="true" />
                        <span>Gmail</span>
                      </a>
                    ) : null}
                  </div>
                </div>
                {candidate.attachments.map((attachment) => (
                  <div key={attachment.id} className={styles.candidateAttachment}>
                    <div>
                      <p className={styles.fileName}>{attachment.filename}</p>
                      <div className={styles.fileMeta}>
                        <span className={attachment.large ? styles.warnPill : styles.mutedPill}>{formatBytes(attachment.sizeBytes)}</span>
                        <span className={styles.mutedPill}>{attachment.suggestedCategory}</span>
                        {attachment.tooLarge ? <span className={styles.warnPill}>Over import max</span> : null}
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => setPreview(attachment)}>
                        <Eye size={15} aria-hidden="true" />
                        <span>Preview</span>
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => void createPropertyFromAttachment(attachment)}
                        disabled={!isPdfCandidate(attachment) || attachment.tooLarge || creatingPropertyId === attachment.id}
                      >
                        <FilePlus2 size={15} aria-hidden="true" />
                        <span>{creatingPropertyId === attachment.id ? "Creating..." : "Create property"}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </section>
      )}
    </main>
  );
}
