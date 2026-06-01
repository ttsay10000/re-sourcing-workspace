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
import {
  UI_V2_PIPELINE_STATUS_OPTIONS,
  UI_V2_REJECTION_REASON_OPTIONS,
  type UiV2ActionSurface,
  type UiV2BrokerBlock,
  type UiV2CrmContactPayload,
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
} from "@re-sourcing/contracts";
import styles from "./PipelinePage.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const PIPELINE_PATH = "/pipeline";

const SORT_OPTIONS: Array<{ value: UiV2PipelineSortField; label: string }> = [
  { value: "updatedAt", label: "Updated" },
  { value: "lastActivityAt", label: "Activity" },
  { value: "dealScore", label: "Score" },
  { value: "askingPrice", label: "Ask" },
  { value: "units", label: "Units" },
  { value: "capRate", label: "Cap" },
  { value: "canonicalAddress", label: "Address" },
  { value: "source", label: "Source" },
  { value: "marketType", label: "Type" },
  { value: "status", label: "Status" },
  { value: "omStatus", label: "OM" },
  { value: "createdAt", label: "Created" },
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
  "duplicate",
] as const;

const SHEET_TABS = ["Overview", "Enrichment", "OM / Docs", "Underwriting", "Activity"] as const;

type SheetTab = (typeof SHEET_TABS)[number];
type SortDirection = "asc" | "desc";

function tabFromParam(value: string | null): SheetTab | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "overview") return "Overview";
  if (normalized === "enrichment") return "Enrichment";
  if (normalized === "om" || normalized === "omdocs" || normalized === "docs") return "OM / Docs";
  if (normalized === "underwriting") return "Underwriting";
  if (normalized === "activity") return "Activity";
  return null;
}

type PipelineRow = UiV2PipelineRow & {
  gallery?: UiV2ImageAsset[];
  overview?: { gallery?: UiV2ImageAsset[] };
};

type FlexiblePropertyDetail = UiV2PropertyDetailPayload & {
  gallery?: UiV2ImageAsset[];
  overview: UiV2PropertyDetailPayload["overview"] & { gallery?: UiV2ImageAsset[] };
};

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
  | "source"
  | "marketType"
  | "askingPrice"
  | "units"
  | "capRate"
  | "mtr"
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
  marketType: "marketType",
  askingPrice: "askingPrice",
  units: "units",
  capRate: "capRate",
  dealScore: "dealScore",
  status: "status",
  om: "omStatus",
  flow: "lastActivityAt",
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
  error?: string;
  details?: string;
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
  if (!value) return "-";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  if (!value) return "-";
  const normalized = value.toLowerCase();
  return SOURCE_LABELS[normalized] ?? "Other";
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
  if (["needs_om", "needs_rent_roll", "needs_city_data", "follow_up"].includes(normalized)) {
    return styles.tagAction;
  }
  if (["distressed_seller", "rent_stab_risk", "duplicate", "rejected"].includes(normalized)) {
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

function calculateCapRate(row: Pick<UiV2PipelineRow, "underwriting" | "askingPrice">): number | null {
  if (row.underwriting?.capRate != null) return row.underwriting.capRate;
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

function scoreTone(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return styles.scoreMissing;
  if (score >= 75) return styles.scoreStrong;
  if (score >= 50) return styles.scorePositive;
  if (score >= 25) return styles.scoreWeak;
  return styles.scorePoor;
}

function scoreLabel(score: number | null | undefined): string {
  return score == null || !Number.isFinite(score) ? "-" : `${Math.round(score)} / 100`;
}

function documentUrl(document: UiV2PropertyDocumentItem): string {
  const fileUrl = document.fileUrl || document.sourceUrl || "#";
  if (fileUrl === "#" || fileUrl.startsWith("http")) return fileUrl;
  return `${API_BASE}${fileUrl}`;
}

function displayDetailValue(item: UiV2DetailItem): string {
  if (item.value == null || item.value === "") return "-";
  if (typeof item.value === "boolean") return item.value ? "Yes" : "No";
  return String(item.value);
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
    marketType: property.overview.marketType ?? row.marketType,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<FlexiblePropertyDetail | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab>("Overview");
  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") ?? "");
  const [brokerEditOpen, setBrokerEditOpen] = useState(false);
  const [brokerForm, setBrokerForm] = useState<BrokerFormState>(brokerFormFromBlock(null));
  const [newTag, setNewTag] = useState("");
  const [rejectState, setRejectState] = useState<RejectState | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [templates, setTemplates] = useState<UiV2OutreachTemplatePayload[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [emailQueue, setEmailQueue] = useState<string[]>([]);
  const [headerMenu, setHeaderMenu] = useState<PipelineHeaderMenuId | null>(null);
  const lastAutoOpenedPropertyId = useRef<string | null>(null);

  const selectedRow = useMemo(
    () => rows.find((row) => row.propertyId === selectedId) ?? null,
    [rows, selectedId]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIdSet.has(row.propertyId));
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIdSet.has(row.propertyId)),
    [rows, selectedIdSet]
  );

  const filterValues = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      status: searchParams.get("status") ?? "",
      source: searchParams.get("source") ?? "",
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
    setGalleryIndex(0);
  }, [selectedId]);

  const openProperty = useCallback(
    async (row: PipelineRow) => {
      setSheetTab("Overview");
      setBrokerEditOpen(false);
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

  async function refreshSelectedEnrichment() {
    if (selectedIds.length === 0) return;
    setBusyAction("bulk:refresh");
    setNotice(null);
    setError(null);
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
        body: JSON.stringify({ propertyIds }),
      });
      const rentalPayload = await rentalResponse.json().catch(() => ({}));
      if (!rentalResponse.ok) {
        throw new Error(rentalPayload.error || rentalPayload.details || "Enrichment refreshed, but rental flow failed.");
      }
      setNotice(`Refresh started for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}.`);
      const response = await apiFetch<PipelineResponse>(
        `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
      );
      setRows(response.pipeline.rows as PipelineRow[]);
      setTotal(response.pipeline.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh selected properties.");
    } finally {
      setBusyAction(null);
    }
  }

  async function rerunSelectedDossiers() {
    if (selectedIds.length === 0) return;
    const propertyIds = [...selectedIds];
    const addressById = new Map(
      rows.map((row) => [row.propertyId, row.displayAddress ?? row.canonicalAddress ?? row.propertyId])
    );
    let completed = 0;
    const failures: Array<{ propertyId: string; address: string; message: string }> = [];
    setBusyAction("bulk:dossier");
    setNotice(`Rerunning dossier generation for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}...`);
    setError(null);
    try {
      for (let index = 0; index < propertyIds.length; index++) {
        const propertyId = propertyIds[index]!;
        setNotice(
          `Rerunning dossiers ${index + 1} of ${propertyIds.length}: ${
            addressById.get(propertyId) ?? "selected property"
          }`
        );
        try {
          const response = await fetch(`${API_BASE}/api/dossier/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propertyId }),
          });
          const payload = (await response.json().catch(() => ({}))) as DossierGenerateResponse;
          if (!response.ok) {
            throw new Error(payload.details || payload.error || `Request failed with ${response.status}`);
          }
          completed++;
        } catch (err) {
          failures.push({
            propertyId,
            address: addressById.get(propertyId) ?? propertyId,
            message: err instanceof Error ? err.message : "Failed to generate dossier.",
          });
        }
      }

      const response = await apiFetch<PipelineResponse>(
        `${API_BASE}/api/ui-v2/pipeline?${buildPipelineQueryString(queryString)}`
      );
      setRows(response.pipeline.rows as PipelineRow[]);
      setTotal(response.pipeline.total);
      if (selectedId) await loadPropertyDetail(selectedId).catch(() => null);

      setNotice(
        failures.length === 0
          ? `Dossier generation completed for ${completed} propert${completed === 1 ? "y" : "ies"}.`
          : `Dossier generation completed for ${completed} of ${propertyIds.length} selected properties.`
      );
      if (failures.length > 0) {
        setError(
          `${failures.length} dossier rerun${failures.length === 1 ? "" : "s"} failed. First issue: ${
            failures[0]!.address
          } - ${failures[0]!.message}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rerun dossier generation.");
    } finally {
      setBusyAction(null);
    }
  }

  async function queueSelectedEmails() {
    const propertyIds = selectedRows.map((row) => row.propertyId);
    if (propertyIds.length === 0) return;
    setEmailQueue(propertyIds.slice(1));
    await emailBroker(propertyIds[0]!, "pipeline_table");
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
      const [nextPropertyId, ...remainingQueue] = emailQueue;
      setEmailQueue(remainingQueue);
      setNotice(
        nextPropertyId
          ? `Broker email sent. Opening next queued property (${remainingQueue.length + 1} remaining).`
          : "Broker email sent and logged."
      );
      if (selectedId === activeComposer.propertyId) await refreshSelected();
      if (nextPropertyId) await emailBroker(nextPropertyId, "pipeline_table");
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
      const [nextPropertyId, ...remainingQueue] = emailQueue;
      setEmailQueue(remainingQueue);
      setNotice(
        nextPropertyId
          ? `Outreach draft queued. Opening next queued property (${remainingQueue.length + 1} remaining).`
          : "Outreach draft queued for review."
      );
      if (selectedId === composer.propertyId) await refreshSelected();
      if (nextPropertyId) await emailBroker(nextPropertyId, "pipeline_table");
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
      case "marketType":
        return Boolean(filterValues.marketType);
      case "askingPrice":
        return Boolean(filterValues.minAskingPrice || filterValues.maxAskingPrice);
      case "dealScore":
        return Boolean(filterValues.minDealScore || filterValues.maxDealScore);
      case "mtr":
        return Boolean(filterValues.mtr);
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
    const ascLabel = ["address", "source", "marketType", "status", "om"].includes(column) ? "A to Z" : "Low to high";
    const descLabel = ["address", "source", "marketType", "status", "om"].includes(column) ? "Z to A" : "High to low";
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
        {column === "marketType" ? (
          <label>
            <span>Filter type</span>
            <select value={filterValues.marketType} onChange={onFilterChange("marketType")}>
              <option value="">All types</option>
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
        {column === "mtr" ? (
          <label>
            <span>Filter MTR</span>
            <select value={filterValues.mtr} onChange={onFilterChange("mtr")}>
              <option value="">All MTR states</option>
              <option value="good">Good candidates</option>
              <option value="watch">Watchlist</option>
              <option value="none">No MTR tag</option>
            </select>
          </label>
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
          <span>{label}</span>
          {isSorted ? <small>{filterValues.sortDirection.toUpperCase()}</small> : null}
          {active && !isSorted ? <i aria-hidden="true" /> : null}
        </button>
        {headerMenu === column ? renderColumnMenu(column) : null}
      </div>
    );
  }

  const sheetGallery = extractGallery(selectedProperty, selectedRow);
  const activeGalleryIndex = sheetGallery.length > 0 ? Math.min(galleryIndex, sheetGallery.length - 1) : 0;
  const activeGalleryImage = sheetGallery[activeGalleryIndex] ?? null;
  const sheetBroker = selectedProperty?.broker ?? selectedRow?.broker ?? null;
  const sheetStatus = selectedProperty?.statusChip ?? selectedRow?.statusChip ?? null;
  const sheetTags = selectedProperty?.tags ?? selectedRow?.tags ?? [];
  const sheetMarketType = selectedProperty?.overview.marketType ?? selectedRow?.marketType ?? "unknown";
  const sheetDocuments = selectedProperty?.documents ?? [];
  const sheetEnrichmentModules = selectedProperty?.enrichmentDetails?.modules ?? [];
  const sheetListingFacts = selectedProperty?.enrichmentDetails?.listingFacts ?? null;
  const terminalStatus = selectedRow?.statusChip.status === "rejected" || selectedRow?.statusChip.status === "archived";
  const sheetUnderwriting = selectedProperty?.underwriting ?? selectedRow?.underwriting ?? null;

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
                {sourceLabel(source)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={filterValues.marketType} onChange={onFilterChange("marketType")}>
            <option value="">All types</option>
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
          {emailQueue.length > 0 ? <small>{emailQueue.length} outreach drafts still queued</small> : null}
        </div>
        <div className={styles.bulkActions}>
          <button className={styles.ghostButton} type="button" onClick={toggleAllVisible}>
            {allVisibleSelected ? "Clear selection" : "Select visible"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={selectedIds.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={refreshSelectedEnrichment}
          >
            {busyAction === "bulk:refresh" ? "Refreshing..." : "Refresh enrichment + rental"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            title="Regenerate the selected properties' deal dossier PDFs and Excel workbooks using saved assumptions."
            disabled={selectedIds.length === 0 || busyAction?.startsWith("bulk:")}
            onClick={rerunSelectedDossiers}
          >
            {busyAction === "bulk:dossier" ? "Rerunning dossiers..." : "Rerun dossiers"}
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={selectedIds.length === 0 || busyAction?.startsWith("bulk:") || busyAction?.includes(":composer")}
            onClick={queueSelectedEmails}
          >
            Queue broker emails
          </button>
        </div>
      </div>

      <section className={styles.tableShell} aria-busy={loading}>
        <table className={styles.pipelineTable}>
          <colgroup>
            <col className={styles.colSelect} />
            <col className={styles.colAddress} />
            <col className={styles.colSource} />
            <col className={styles.colType} />
            <col className={styles.colAsk} />
            <col className={styles.colUnit} />
            <col className={styles.colCap} />
            <col className={styles.colMtr} />
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
              <th>{renderHeader("address", "Address")}</th>
              <th>{renderHeader("source", "Source")}</th>
              <th>{renderHeader("marketType", "Type")}</th>
              <th>{renderHeader("askingPrice", "Ask")}</th>
              <th>{renderHeader("units", "Unit")}</th>
              <th>{renderHeader("capRate", "Cap")}</th>
              <th>{renderHeader("mtr", "MTR")}</th>
              <th>{renderHeader("dealScore", "Score")}</th>
              <th>{renderHeader("status", "Status")}</th>
              <th>{renderHeader("om", "OM")}</th>
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
              const isTerminal = status === "rejected" || status === "archived";
              const isChecked = selectedIdSet.has(row.propertyId);
              const score = row.underwriting?.dealScore ?? null;
              const rowLocationLabels = locationLabels(row);
              return (
                <tr
                  key={row.propertyId}
                  className={isSelected ? styles.selectedRow : undefined}
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
                      </div>
                    </div>
                  </td>
                  <td>{sourceLabel(String(row.source ?? ""))}</td>
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
                  <td className={styles.numericCell}>{formatCurrency(row.askingPrice)}</td>
                  <td className={styles.numericCell}>{formatNumber(row.units)}</td>
                  <td className={styles.numericCell}>{formatPercent(calculateCapRate(row))}</td>
                  <td>
                    <span className={`${styles.tinyChip} ${mtrLabel(row.tags) === "Good" ? styles.toneSuccess : styles.toneNeutral}`}>
                      {mtrLabel(row.tags)}
                    </span>
                  </td>
                  <td className={styles.scoreCell}>
                    <span className={`${styles.scoreBadge} ${scoreTone(score)}`}>
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
                      <span className={cx(styles.tagChip, tagToneClass(tag))} key={tag}>
                        {tagLabel(tag)}
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
                      <details className={styles.rowActionMenu}>
                        <summary>More</summary>
                        <div>
                          <button
                            className={styles.linkButton}
                            type="button"
                            onClick={() => openProperty(row)}
                          >
                            Open
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
                      </details>
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
                <span className={styles.kicker}>{sourceLabel(String(selectedProperty?.overview.source ?? selectedRow?.source ?? "Pipeline"))}</span>
                <h2>{selectedProperty?.overview.displayAddress ?? selectedRow?.displayAddress ?? selectedRow?.canonicalAddress ?? "Property"}</h2>
                <p>{[selectedProperty?.overview.neighborhood ?? selectedRow?.neighborhood, selectedProperty?.overview.borough ?? selectedRow?.borough, marketTypeLabel(sheetMarketType)].filter(Boolean).map(titleize).join(" · ")}</p>
              </div>
              <button className={styles.closeButton} type="button" onClick={closeSheet} aria-label="Close property sheet">
                ×
              </button>
            </div>

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
                  <div className={styles.galleryRail} aria-label="Property photos">
                    {sheetGallery.slice(0, 6).map((image, index) => (
                      <button
                        key={image.id ?? image.url}
                        className={cx(styles.galleryThumbButton, index === activeGalleryIndex && styles.galleryThumbButtonActive)}
                        type="button"
                        onClick={() => setGalleryIndex(index)}
                        aria-label={`Show property photo ${index + 1}`}
                      >
                        <img src={image.thumbnailUrl ?? image.url} alt="" />
                        {index === 5 && sheetGallery.length > 6 ? (
                          <span className={styles.galleryMore}>+{sheetGallery.length - 6}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className={styles.galleryEmpty}>No property photos yet</div>
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
                <div className={styles.overviewStack}>
                  <section className={styles.overviewSection}>
                    <div className={styles.sectionHeading}>
                      <h3>Deal Snapshot</h3>
                      <Link
                        className={styles.iconLink}
                        href={`/dossier-assumptions?property_id=${encodeURIComponent(selectedId)}`}
                      >
                        Edit Assumptions
                      </Link>
                    </div>
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
                        <dd>{formatPercent(selectedProperty?.underwriting?.capRate ?? (selectedRow ? calculateCapRate(selectedRow) : null))}</dd>
                      </div>
                      <div>
                        <dt>Type</dt>
                        <dd>{marketTypeLabel(sheetMarketType)}</dd>
                      </div>
                      <div>
                        <dt>Sqft</dt>
                        <dd>{formatNumber(selectedProperty?.overview.buildingSqft ?? selectedRow?.buildingSqft)}</dd>
                      </div>
                      <div>
                        <dt>Beds / Baths</dt>
                        <dd>
                          {formatNumber(sheetListingFacts?.bedrooms ?? selectedProperty?.overview.beds)} /{" "}
                          {formatNumber(sheetListingFacts?.bathrooms ?? selectedProperty?.overview.baths)}
                        </dd>
                      </div>
                      <div>
                        <dt>Listing status</dt>
                        <dd>{titleize(sheetListingFacts?.status)}</dd>
                      </div>
                      <div>
                        <dt>Score</dt>
                        <dd>
                          <span className={`${styles.scoreBadge} ${scoreTone(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}`}>
                            {scoreLabel(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}
                          </span>
                        </dd>
                      </div>
                    </dl>
                    {selectedProperty?.overview.description ? <p className={styles.description}>{selectedProperty.overview.description}</p> : null}
                  </section>

                  <section className={styles.highlightSection}>
                    <div className={styles.sectionHeading}>
                      <h3>Investment Highlights</h3>
                      <span>{sheetUnderwriting?.generationStatus ? titleize(sheetUnderwriting.generationStatus) : "Live inputs"}</span>
                    </div>
                    <div className={styles.highlightGrid}>
                      <div>
                        <span>Deal score</span>
                        <strong className={scoreTone(sheetUnderwriting?.dealScore)}>{scoreLabel(sheetUnderwriting?.dealScore)}</strong>
                      </div>
                      <div>
                        <span>Cap rate</span>
                        <strong>{formatPercent(sheetUnderwriting?.capRate ?? (selectedRow ? calculateCapRate(selectedRow) : null))}</strong>
                      </div>
                      <div>
                        <span>IRR</span>
                        <strong>{formatPercent(sheetUnderwriting?.irrPct ?? sheetUnderwriting?.targetIrrPct)}</strong>
                      </div>
                      <div>
                        <span>Cash on cash</span>
                        <strong>{formatPercent(sheetUnderwriting?.cocPct)}</strong>
                      </div>
                      <div>
                        <span>Current NOI</span>
                        <strong>{formatCurrency(sheetUnderwriting?.currentNoi, false)}</strong>
                      </div>
                      <div>
                        <span>Adjusted NOI</span>
                        <strong>{formatCurrency(sheetUnderwriting?.adjustedNoi, false)}</strong>
                      </div>
                    </div>
                  </section>

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
                        <div><dt>Name</dt><dd>{sheetBroker?.name ?? "-"}</dd></div>
                        <div><dt>Email</dt><dd>{sheetBroker?.email ?? "Needs email"}</dd></div>
                        <div><dt>Phone</dt><dd>{sheetBroker?.phone ?? "-"}</dd></div>
                        <div><dt>Firm</dt><dd>{sheetBroker?.firm ?? "-"}</dd></div>
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
                          {tagLabel(tag)} x
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

              {sheetTab === "Underwriting" ? (
                <section className={styles.sheetPanel}>
                  <div className={styles.sectionHeading}>
                    <h3>Underwriting</h3>
                    <div className={styles.documentActions}>
                      <Link className={styles.iconLink} href={`/dossier-assumptions?property_id=${encodeURIComponent(selectedId)}`}>
                        Edit Assumptions
                      </Link>
                      <Link className={styles.iconLink} href={`/deal-analysis?property_id=${encodeURIComponent(selectedId)}`}>
                        Deal Analysis
                      </Link>
                    </div>
                  </div>
                  <dl className={styles.metricGrid}>
                    <div>
                      <dt>Deal score</dt>
                      <dd>
                        <span className={`${styles.scoreBadge} ${scoreTone(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}`}>
                          {scoreLabel(selectedProperty?.underwriting?.dealScore ?? selectedRow?.underwriting?.dealScore)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Cap</dt>
                      <dd>{formatPercent(selectedProperty?.underwriting?.capRate ?? selectedRow?.underwriting?.capRate)}</dd>
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
              <button
                className={styles.closeButton}
                type="button"
                onClick={() => {
                  setComposer(null);
                  setEmailQueue([]);
                }}
                aria-label="Close outreach composer"
              >
                x
              </button>
            </div>
            {composer.warnings.length > 0 ? (
              <div className={styles.warningBox}>{composer.warnings.join(" ")}</div>
            ) : null}
            {emailQueue.length > 0 ? (
              <div className={styles.notice}>{emailQueue.length} more selected propert{emailQueue.length === 1 ? "y" : "ies"} will open after this draft is queued.</div>
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
                onClick={() => {
                  setComposer(null);
                  setEmailQueue([]);
                }}
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
  const modulesWithData = visibleModules.filter((module) => moduleItems(module).some((item) => displayDetailValue(item) !== "-")).length;
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
          <span>{lastRefreshed !== "-" ? `Last refreshed ${lastRefreshed}` : "Refresh this property to pull city, rental, and sourcing data."}</span>
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
            .filter((item) => displayDetailValue(item) !== "-")
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
  return value && value !== "-" ? value : null;
}

function compactModuleLine(module: UiV2EnrichmentModuleDetail): string {
  const items = moduleItems(module)
    .map((item) => `${titleize(item.label)} ${displayDetailValue(item)}`)
    .filter((item) => !item.endsWith(" -"))
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
    { label: "Sqft", value: formatNumber(facts.sqft) },
    { label: "$ / sf", value: formatCurrency(facts.ppsqft, false) },
    { label: "Days on market", value: formatNumber(facts.daysOnMarket) },
    { label: "Listed", value: formatDate(facts.listedAt) },
    { label: "Built", value: facts.builtIn ?? null },
    { label: "Monthly HOA", value: formatCurrency(facts.monthlyHoa, false) },
    { label: "Monthly tax", value: formatCurrency(facts.monthlyTax, false) },
  ].filter((item) => item.value != null && item.value !== "-");
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
  return (
    <article className={styles.dataModuleRow}>
      <div className={styles.dataModuleHeader}>
        <strong>{module.label}</strong>
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
                    .join(" · ") || "-"}
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
            <th>Size</th>
            <th>Tenant/status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 80).map((row, index) => (
            <tr key={`${row.unit ?? row.tenantName ?? "row"}:${index}`}>
              <td>{row.unit ?? row.building ?? `Row ${index + 1}`}</td>
              <td>{row.unitCategory ?? row.rentType ?? "-"}</td>
              <td>{formatCurrency(row.monthlyTotalRent ?? row.monthlyRent ?? row.monthlyBaseRent, false)}</td>
              <td>
                {[row.beds != null ? `${formatNumber(row.beds)} bd` : null, row.baths != null ? `${formatNumber(row.baths)} ba` : null, row.sqft != null ? `${formatNumber(row.sqft)} sf` : null]
                  .filter(Boolean)
                  .join(" · ") || "-"}
              </td>
              <td>{[row.tenantName, typeof row.occupied === "boolean" ? (row.occupied ? "Occupied" : "Vacant") : row.occupied, row.tenantStatus].filter(Boolean).join(" · ") || "-"}</td>
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
  if (modules.length === 0 && factItems.length === 0 && !details?.rentalFlow && !details?.omAnalysis) {
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
      <OmAnalysisPanel analysis={details?.omAnalysis} />
    </div>
  );
}

function DetailItems({ items }: { items: UiV2DetailItem[] }) {
  if (items.length === 0) return <span className={styles.subtle}>-</span>;
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
