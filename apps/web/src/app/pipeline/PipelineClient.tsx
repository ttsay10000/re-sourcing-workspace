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
import { useRouter, useSearchParams } from "next/navigation";
import {
  UI_V2_PIPELINE_STATUS_OPTIONS,
  UI_V2_REJECTION_REASON_OPTIONS,
  type UiV2ActionSurface,
  type UiV2BrokerBlock,
  type UiV2CrmContactPayload,
  type UiV2ImageAsset,
  type UiV2OutreachComposerPayload,
  type UiV2OutreachDraftPayload,
  type UiV2PipelineListPayload,
  type UiV2PipelineRow,
  type UiV2PipelineSortField,
  type UiV2PipelineStatus,
  type UiV2PropertyDetailPayload,
  type UiV2RejectionReasonCode,
  type UiV2StatusChipTone,
} from "@re-sourcing/contracts";
import styles from "./PipelinePage.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const PIPELINE_PATH = "/pipeline";

const SORT_OPTIONS: Array<{ value: UiV2PipelineSortField; label: string }> = [
  { value: "updatedAt", label: "Updated" },
  { value: "lastActivityAt", label: "Activity" },
  { value: "dealScore", label: "Score" },
  { value: "askingPrice", label: "Ask" },
  { value: "canonicalAddress", label: "Address" },
  { value: "status", label: "Status" },
  { value: "omStatus", label: "OM" },
  { value: "createdAt", label: "Created" },
];

const SHEET_TABS = ["Overview", "Enrichment", "OM / Docs", "Underwriting", "Activity"] as const;

type SheetTab = (typeof SHEET_TABS)[number];
type SortDirection = "asc" | "desc";

type PipelineRow = UiV2PipelineRow & {
  gallery?: UiV2ImageAsset[];
  overview?: { gallery?: UiV2ImageAsset[] };
};

type FlexiblePropertyDetail = UiV2PropertyDetailPayload & {
  gallery?: UiV2ImageAsset[];
  overview: UiV2PropertyDetailPayload["overview"] & { gallery?: UiV2ImageAsset[] };
};

interface PipelineResponse {
  pipeline: UiV2PipelineListPayload;
}

interface PropertyResponse {
  property: FlexiblePropertyDetail | null;
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

interface BrokerFormState {
  name: string;
  email: string;
  phone: string;
  firm: string;
  notes: string;
}

interface RejectState {
  propertyId: string;
  address: string;
  surface: UiV2ActionSurface;
  reasonCode: UiV2RejectionReasonCode | "";
  note: string;
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function formatCurrency(value: number | null | undefined, compact = true): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function titleize(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "_");
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

function calculateCapRate(row: Pick<UiV2PipelineRow, "underwriting" | "askingPrice">): number | null {
  const noi = row.underwriting?.adjustedNoi ?? row.underwriting?.currentNoi ?? null;
  const price = row.underwriting?.askingPrice ?? row.askingPrice ?? null;
  if (noi == null || price == null || price <= 0) return null;
  return (noi / price) * 100;
}

function mtrLabel(tags: string[]): string {
  const normalized = tags.map(normalizeTag);
  if (normalized.includes("good_mtr_candidate")) return "Good";
  if (normalized.some((tag) => tag.includes("mtr"))) return "Watch";
  return "-";
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

function brokerFormFromBlock(broker: UiV2BrokerBlock | null | undefined): BrokerFormState {
  return {
    name: broker?.name ?? "",
    email: broker?.email ?? "",
    phone: broker?.phone ?? "",
    firm: broker?.firm ?? "",
    notes: broker?.notes ?? "",
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
    neighborhood: property.overview.neighborhood,
    borough: property.overview.borough,
    thumbnailUrl: gallery[0]?.thumbnailUrl ?? gallery[0]?.url ?? row.thumbnailUrl,
    broker: property.broker,
    documentStatus: property.documentStatus,
    enrichmentState: property.enrichmentState,
    underwriting: property.underwriting,
    openActionItemCount: property.actionItems.filter((item) => item.status === "open").length,
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
    "tag",
    "sort",
    "sortBy",
    "sortDirection",
    "direction",
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

  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<FlexiblePropertyDetail | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab>("Overview");
  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") ?? "");
  const [brokerEditOpen, setBrokerEditOpen] = useState(false);
  const [brokerForm, setBrokerForm] = useState<BrokerFormState>(brokerFormFromBlock(null));
  const [newTag, setNewTag] = useState("");
  const [rejectState, setRejectState] = useState<RejectState | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const lastAutoOpenedPropertyId = useRef<string | null>(null);

  const selectedRow = useMemo(
    () => rows.find((row) => row.propertyId === selectedId) ?? null,
    [rows, selectedId]
  );

  const filterValues = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      status: searchParams.get("status") ?? "",
      source: searchParams.get("source") ?? "",
      neighborhood: searchParams.get("neighborhood") ?? "",
      tag: searchParams.get("tag") ?? "",
      sort: (searchParams.get("sort") ?? searchParams.get("sortBy") ?? "updatedAt") as UiV2PipelineSortField,
      sortDirection: (searchParams.get("sortDirection") ?? searchParams.get("direction") ?? "desc") as SortDirection,
      includeRejected: searchParams.get("includeRejected") === "true",
    }),
    [searchParams]
  );

  const sourceOptions = useMemo(
    () => uniqueSorted(rows.map((row) => (row.source ? String(row.source) : null)), filterValues.source),
    [rows, filterValues.source]
  );
  const neighborhoodOptions = useMemo(
    () => uniqueSorted(rows.map((row) => row.neighborhood), filterValues.neighborhood),
    [rows, filterValues.neighborhood]
  );
  const tagOptions = useMemo(
    () => uniqueSorted(rows.flatMap((row) => row.tags), filterValues.tag),
    [rows, filterValues.tag]
  );

  useEffect(() => {
    setSearchDraft(searchParams.get("q") ?? "");
  }, [searchParams]);

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

  const updateQueryParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(queryString);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      if (key === "sort") params.delete("sortBy");
      if (key === "sortDirection") params.delete("direction");
      const next = params.toString();
      router.replace(next ? `${PIPELINE_PATH}?${next}` : PIPELINE_PATH);
    },
    [queryString, router]
  );

  const applyProperty = useCallback((property: FlexiblePropertyDetail | null) => {
    if (!property) return;
    setSelectedProperty((current) =>
      current?.overview.propertyId === property.overview.propertyId ? property : current
    );
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.propertyId === property.overview.propertyId ? rowFromProperty(row, property) : row
      )
    );
  }, []);

  const loadPropertyDetail = useCallback(
    async (propertyId: string): Promise<FlexiblePropertyDetail | null> => {
      setSelectedId(propertyId);
      setDetailLoading(true);
      setError(null);
      try {
        const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${propertyId}`);
        setSelectedProperty(response.property);
        setBrokerForm(brokerFormFromBlock(response.property?.broker));
        if (response.property) applyProperty(response.property);
        return response.property;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load property.");
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    [applyProperty]
  );

  useEffect(() => {
    if (!requestedPropertyId) {
      lastAutoOpenedPropertyId.current = null;
      return;
    }
    if (lastAutoOpenedPropertyId.current === requestedPropertyId) return;
    lastAutoOpenedPropertyId.current = requestedPropertyId;
    void loadPropertyDetail(requestedPropertyId);
  }, [loadPropertyDetail, requestedPropertyId]);

  const openProperty = useCallback(
    async (row: PipelineRow) => {
      setSheetTab("Overview");
      setBrokerEditOpen(false);
      setNotice(null);
      const params = new URLSearchParams(queryString);
      params.set("propertyId", row.propertyId);
      params.delete("property_id");
      params.delete("expand");
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
    setNewTag("");
    const params = new URLSearchParams(queryString);
    params.delete("propertyId");
    params.delete("property_id");
    params.delete("expand");
    const next = params.toString();
    router.replace(next ? `${PIPELINE_PATH}?${next}` : PIPELINE_PATH);
  }, [queryString, router]);

  const refreshSelected = useCallback(async () => {
    if (selectedId) await loadPropertyDetail(selectedId);
  }, [loadPropertyDetail, selectedId]);

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

  async function submitReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectState?.reasonCode) return;
    const { propertyId, surface, reasonCode, note } = rejectState;
    setBusyAction(`${propertyId}:reject`);
    setNotice(null);
    try {
      const response = await apiFetch<PropertyResponse>(`${API_BASE}/api/ui-v2/properties/${propertyId}/reject`, {
        method: "POST",
        body: JSON.stringify({
          status: "rejected",
          rejection: { reasonCode, note: note.trim() || null },
          source: surface,
        }),
      });
      applyProperty(response.property);
      setRejectState(null);
      setNotice("Property rejected.");
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
    try {
      const response = await apiFetch<ComposerResponse>(
        `${API_BASE}/api/ui-v2/properties/${propertyId}/outreach-composer`
      );
      const suggested = response.composer.suggestedRecipients[0] as UiV2CrmContactPayload | undefined;
      setComposer({
        propertyId,
        toAddress: response.composer.broker?.email ?? "",
        contactId: suggested?.contact.id ?? response.composer.broker?.contactId ?? null,
        subject: response.composer.subject,
        body: response.composer.body,
        followUpAt: response.composer.followUpAt ?? "",
        warnings: response.composer.warnings ?? [],
        submitting: false,
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
      setNotice("Add a broker email before creating outreach.");
      return;
    }
    if (surface === "pipeline_table") setSheetTab("Overview");
    await openComposer(propertyId);
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
          followUpAt: composer.followUpAt || null,
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
    router.replace(PIPELINE_PATH);
  }

  function stopRowClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  const sheetGallery = extractGallery(selectedProperty, selectedRow);
  const sheetBroker = selectedProperty?.broker ?? selectedRow?.broker ?? null;
  const sheetStatus = selectedProperty?.statusChip ?? selectedRow?.statusChip ?? null;
  const sheetTags = selectedProperty?.tags ?? selectedRow?.tags ?? [];
  const terminalStatus = selectedRow?.statusChip.status === "rejected" || selectedRow?.statusChip.status === "archived";

  return (
    <main className={styles.page}>
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
                {titleize(source)}
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

      <section className={styles.tableShell} aria-busy={loading}>
        <table className={styles.pipelineTable}>
          <thead>
            <tr>
              <th>Address</th>
              <th>Source</th>
              <th>Ask</th>
              <th>Unit</th>
              <th>Cap</th>
              <th>MTR</th>
              <th>Score</th>
              <th>Status</th>
              <th>OM</th>
              <th>Enrich</th>
              <th>Flow</th>
              <th>Tags</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = String(row.statusChip.status) as UiV2PipelineStatus;
              const isSelected = row.propertyId === selectedId;
              const isTerminal = status === "rejected" || status === "archived";
              return (
                <tr
                  key={row.propertyId}
                  className={isSelected ? styles.selectedRow : undefined}
                  onClick={() => openProperty(row)}
                >
                  <td className={styles.addressCell}>
                    <div className={styles.addressWrap}>
                      {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" className={styles.thumb} /> : <div className={styles.thumbBlank} />}
                      <div>
                        <strong>{row.displayAddress ?? row.canonicalAddress}</strong>
                        <span>{[row.neighborhood, row.borough].filter(Boolean).join(" / ") || "-"}</span>
                      </div>
                    </div>
                  </td>
                  <td>{titleize(String(row.source ?? ""))}</td>
                  <td className={styles.numericCell}>{formatCurrency(row.askingPrice)}</td>
                  <td className={styles.numericCell}>{formatNumber(row.units)}</td>
                  <td className={styles.numericCell}>{formatPercent(calculateCapRate(row))}</td>
                  <td>
                    <span className={`${styles.tinyChip} ${mtrLabel(row.tags) === "Good" ? styles.toneSuccess : styles.toneNeutral}`}>
                      {mtrLabel(row.tags)}
                    </span>
                  </td>
                  <td className={styles.scoreCell}>{row.underwriting?.dealScore != null ? Math.round(row.underwriting.dealScore) : "-"}</td>
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
                  <td>
                    <span className={`${styles.tinyChip} ${row.documentStatus?.hasOm ? styles.toneSuccess : styles.toneWarning}`}>
                      {omLabel(row)}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.tinyChip} ${statusToneClass(row.enrichmentState?.status === "complete" ? "success" : row.enrichmentState?.status === "failed" ? "danger" : "neutral")}`}>
                      {titleize(row.enrichmentState?.status)}
                    </span>
                  </td>
                  <td>{flowLabel(row)}</td>
                  <td className={styles.tagsCell}>
                    {row.tags.slice(0, 3).map((tag) => (
                      <span className={styles.tagChip} key={tag}>
                        {tag}
                      </span>
                    ))}
                    {row.tags.length > 3 ? <span className={styles.tagMore}>+{row.tags.length - 3}</span> : null}
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
                      {isTerminal ? (
                        <button
                          className={styles.linkButton}
                          type="button"
                          disabled={busyAction === `${row.propertyId}:restore`}
                          onClick={() => restoreDeal(row.propertyId, "pipeline_table")}
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          <button
                            className={styles.linkButton}
                            type="button"
                            disabled={status === "saved" || busyAction === `${row.propertyId}:save`}
                            onClick={() => saveDeal(row.propertyId, "pipeline_table")}
                          >
                            Save
                          </button>
                          <button
                            className={styles.dangerLinkButton}
                            type="button"
                            disabled={busyAction === `${row.propertyId}:reject`}
                            onClick={() =>
                              setRejectState({
                                propertyId: row.propertyId,
                                address: row.displayAddress ?? row.canonicalAddress,
                                surface: "pipeline_table",
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? <div className={styles.emptyState}>No properties match the current filters.</div> : null}
        {loading ? <div className={styles.tableOverlay}>Loading pipeline...</div> : null}
      </section>

      {selectedId ? (
        <div className={styles.sheetOverlay} onClick={closeSheet}>
          <aside className={styles.propertySheet} onClick={(event) => event.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <div>
                <span className={styles.kicker}>{selectedProperty?.overview.source ?? selectedRow?.source ?? "Pipeline"}</span>
                <h2>{selectedProperty?.overview.displayAddress ?? selectedRow?.displayAddress ?? selectedRow?.canonicalAddress ?? "Property"}</h2>
                <p>{[selectedProperty?.overview.neighborhood ?? selectedRow?.neighborhood, selectedProperty?.overview.borough ?? selectedRow?.borough].filter(Boolean).join(" / ")}</p>
              </div>
              <button className={styles.closeButton} type="button" onClick={closeSheet} aria-label="Close property sheet">
                x
              </button>
            </div>

            <div className={styles.galleryStrip}>
              {sheetGallery.length > 0 ? (
                sheetGallery.slice(0, 5).map((image) => (
                  <img key={image.id ?? image.url} src={image.thumbnailUrl ?? image.url} alt={image.altText ?? ""} />
                ))
              ) : (
                <div className={styles.galleryEmpty}>No image</div>
              )}
            </div>

            <div className={styles.sheetActions}>
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
              <button className={styles.primaryButton} type="button" onClick={(event) => emailBroker(selectedId, "property_sheet", event)}>
                Email broker
              </button>
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
                <div className={styles.sheetGrid}>
                  <section className={styles.sheetPanel}>
                    <h3>Deal Snapshot</h3>
                    <dl className={styles.metricGrid}>
                      <div>
                        <dt>Ask</dt>
                        <dd>{formatCurrency(selectedProperty?.overview.askingPrice ?? selectedRow?.askingPrice, false)}</dd>
                      </div>
                      <div>
                        <dt>Units</dt>
                        <dd>{formatNumber(selectedProperty?.overview.units ?? selectedRow?.units)}</dd>
                      </div>
                      <div>
                        <dt>Cap</dt>
                        <dd>{formatPercent(selectedRow ? calculateCapRate(selectedRow) : null)}</dd>
                      </div>
                      <div>
                        <dt>MTR</dt>
                        <dd>{mtrLabel(sheetTags)}</dd>
                      </div>
                      <div>
                        <dt>Sqft</dt>
                        <dd>{formatNumber(selectedProperty?.overview.buildingSqft ?? selectedRow?.buildingSqft)}</dd>
                      </div>
                      <div>
                        <dt>Score</dt>
                        <dd>{selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore ?? "-"}</dd>
                      </div>
                    </dl>
                    {selectedProperty?.overview.description ? <p className={styles.description}>{selectedProperty.overview.description}</p> : null}
                  </section>

                  <section className={styles.sheetPanel}>
                    <div className={styles.panelHeader}>
                      <h3>Broker</h3>
                      <button className={styles.linkButton} type="button" onClick={() => setBrokerEditOpen((open) => !open)}>
                        {brokerEditOpen ? "Cancel" : "Edit"}
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
                      <dl className={styles.detailList}>
                        <div>
                          <dt>Name</dt>
                          <dd>{sheetBroker?.name ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>Email</dt>
                          <dd>{sheetBroker?.email ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>Phone</dt>
                          <dd>{sheetBroker?.phone ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>Firm</dt>
                          <dd>{sheetBroker?.firm ?? "-"}</dd>
                        </div>
                      </dl>
                    )}
                  </section>

                  <section className={styles.sheetPanel}>
                    <h3>Tags</h3>
                    <div className={styles.sheetTags}>
                      {sheetTags.map((tag) => (
                        <button
                          key={tag}
                          className={styles.removableTag}
                          type="button"
                          onClick={() => removeTag(tag)}
                          disabled={busyAction === `${selectedId}:tag-remove:${tag}`}
                        >
                          {tag} x
                        </button>
                      ))}
                    </div>
                    <form className={styles.addTagForm} onSubmit={addTag}>
                      <input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Add tag" />
                      <button className={styles.secondaryButton} type="submit" disabled={!newTag.trim()}>
                        Add
                      </button>
                    </form>
                  </section>
                </div>
              ) : null}

              {sheetTab === "Enrichment" ? (
                <section className={styles.sheetPanel}>
                  <h3>Enrichment</h3>
                  <dl className={styles.detailList}>
                    <div>
                      <dt>Status</dt>
                      <dd>{titleize(selectedProperty?.enrichmentState.status ?? selectedRow?.enrichmentState?.status)}</dd>
                    </div>
                    <div>
                      <dt>Last refreshed</dt>
                      <dd>{formatDate(selectedProperty?.enrichmentState.lastRefreshedAt ?? selectedRow?.enrichmentState?.lastRefreshedAt)}</dd>
                    </div>
                    <div>
                      <dt>Error</dt>
                      <dd>{selectedProperty?.enrichmentState.errorMessage ?? selectedRow?.enrichmentState?.errorMessage ?? "-"}</dd>
                    </div>
                  </dl>
                  <div className={styles.keyColumns}>
                    <KeyList title="Completed" values={selectedProperty?.enrichmentState.completedKeys ?? selectedRow?.enrichmentState?.completedKeys ?? []} />
                    <KeyList title="Pending" values={selectedProperty?.enrichmentState.pendingKeys ?? selectedRow?.enrichmentState?.pendingKeys ?? []} />
                    <KeyList title="Failed" values={selectedProperty?.enrichmentState.failedKeys ?? selectedRow?.enrichmentState?.failedKeys ?? []} />
                  </div>
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
                      <span className={styles.tagChip} key={category}>
                        {category}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {sheetTab === "Underwriting" ? (
                <section className={styles.sheetPanel}>
                  <h3>Underwriting</h3>
                  <dl className={styles.metricGrid}>
                    <div>
                      <dt>Deal score</dt>
                      <dd>{selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>IRR</dt>
                      <dd>{formatPercent(selectedProperty?.underwriting?.irrPct ?? selectedRow?.underwriting?.irrPct)}</dd>
                    </div>
                    <div>
                      <dt>CoC</dt>
                      <dd>{formatPercent(selectedProperty?.underwriting?.cocPct ?? selectedRow?.underwriting?.cocPct)}</dd>
                    </div>
                    <div>
                      <dt>Current NOI</dt>
                      <dd>{formatCurrency(selectedProperty?.underwriting?.currentNoi ?? selectedRow?.underwriting?.currentNoi, false)}</dd>
                    </div>
                    <div>
                      <dt>Adjusted NOI</dt>
                      <dd>{formatCurrency(selectedProperty?.underwriting?.adjustedNoi ?? selectedRow?.underwriting?.adjustedNoi, false)}</dd>
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
                      <article key={item.id}>
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

      {rejectState ? (
        <div className={styles.modalOverlay}>
          <form className={styles.modal} onSubmit={submitReject}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.kicker}>Reject property</span>
                <h2>{rejectState.address}</h2>
              </div>
              <button className={styles.closeButton} type="button" onClick={() => setRejectState(null)} aria-label="Close rejection modal">
                x
              </button>
            </div>
            <label>
              <span>Reason</span>
              <select
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
              <button className={styles.dangerButton} type="submit" disabled={!rejectState.reasonCode || busyAction === `${rejectState.propertyId}:reject`}>
                Reject
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {composer ? (
        <div className={styles.modalOverlay}>
          <form className={styles.composerModal} onSubmit={submitComposer}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.kicker}>Outreach composer</span>
                <h2>{selectedProperty?.overview.displayAddress ?? selectedRow?.displayAddress ?? "Broker outreach"}</h2>
              </div>
              <button className={styles.closeButton} type="button" onClick={() => setComposer(null)} aria-label="Close outreach composer">
                x
              </button>
            </div>
            {composer.warnings.length > 0 ? (
              <div className={styles.warningBox}>{composer.warnings.join(" ")}</div>
            ) : null}
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
              <button className={styles.ghostButton} type="button" onClick={() => setComposer(null)}>
                Cancel
              </button>
              <button className={styles.primaryButton} type="submit" disabled={composer.submitting}>
                Send for review
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
