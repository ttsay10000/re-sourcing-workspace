"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  BrokerContact,
  RecipientResolution,
  UiV2BrokerBlock,
  UiV2CrmContactPayload,
  UiV2CrmListPayload,
  UiV2CrmRelatedProperty,
  UiV2OutreachComposerPayload,
  UiV2OutreachDraftPayload,
  UiV2OutreachFollowUpActionPayload,
  UiV2OutreachSendNowPayload,
  UiV2OutreachTemplatePayload,
  UiV2PropertyDetailPayload,
} from "@re-sourcing/contracts";
import styles from "./CrmPage.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const CRM_LIMIT = 100;
const PROPERTY_LABEL_PREFETCH_LIMIT = 200;

type NoticeType = "success" | "error" | "info";

interface Notice {
  type: NoticeType;
  message: string;
}

interface CrmResponse {
  crm: UiV2CrmListPayload;
}

interface BrokerCandidate {
  email?: string | null;
  name?: string | null;
  firm?: string | null;
  phone?: string | null;
  contactId?: string | null;
  source?: string | null;
}

interface PropertyBrokerPayload {
  broker: UiV2BrokerBlock | null;
  candidates: BrokerCandidate[];
  resolution: RecipientResolution | null;
  contact: BrokerContact | null;
  listingAgents: BrokerCandidate[];
  manualOverride: Record<string, unknown> | null;
  openActionItemCount: number;
  lastActivityAt: string | null;
}

interface PropertyBrokerResponse extends PropertyBrokerPayload {}

interface PropertyDetailResponse {
  property: UiV2PropertyDetailPayload | null;
  error?: string;
}

interface OutreachComposerResponse {
  composer: UiV2OutreachComposerPayload;
}

interface OutreachDraftResponse {
  draft: UiV2OutreachDraftPayload;
}

interface FollowUpResponse {
  followUp: UiV2OutreachFollowUpActionPayload;
}

interface OutreachTemplatesResponse {
  templates: UiV2OutreachTemplatePayload[];
}

interface OutreachTemplateResponse {
  template: UiV2OutreachTemplatePayload;
}

type PanelState =
  | { type: "contact"; contactPayload: UiV2CrmContactPayload; notice?: Notice }
  | {
      type: "property";
      propertyId: string;
      contactPayload?: UiV2CrmContactPayload;
      notice?: Notice;
      openComposer?: boolean;
      openFollowUp?: boolean;
    };

interface BrokerFormState {
  name: string;
  firm: string;
  email: string;
  phone: string;
  notes: string;
}

interface DraftFormState {
  toAddress: string;
  subject: string;
  body: string;
  followUpAt: string;
  templateId: string;
  templateName: string;
}

interface FollowUpFormState {
  followUpAt: string;
  note: string;
}

interface RelatedPropertyItem {
  propertyId: string;
  label: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.details === "string"
          ? data.details
          : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

function compactPropertyId(propertyId: string): string {
  if (propertyId.length <= 10) return propertyId;
  return `${propertyId.slice(0, 6)}...${propertyId.slice(-4)}`;
}

function shortPropertyAddress(value: string | null | undefined): string | null {
  const firstLine = value?.split(",")[0]?.trim();
  if (!firstLine) return null;
  return firstLine
    .replace(/\bWest (?=\d)/gi, "W ")
    .replace(/\bEast (?=\d)/gi, "E ")
    .replace(/\bNorth (?=\d)/gi, "N ")
    .replace(/\bSouth (?=\d)/gi, "S ")
    .replace(/\bStreet\b/gi, "St")
    .replace(/\bAvenue\b/gi, "Ave")
    .replace(/\bBoulevard\b/gi, "Blvd")
    .replace(/\bPlace\b/gi, "Pl")
    .replace(/\bRoad\b/gi, "Rd")
    .replace(/\s+/g, " ");
}

function propertyLabelFromRelated(property: UiV2CrmRelatedProperty | undefined, fallbackId: string): string {
  return shortPropertyAddress(property?.displayAddress) ?? shortPropertyAddress(property?.canonicalAddress) ?? compactPropertyId(fallbackId);
}

function displayBrokerName(contact: BrokerContact | null | undefined, fallback = "Unnamed broker"): string {
  return contact?.displayName?.trim() || contact?.normalizedEmail || contact?.sourceKey || fallback;
}

function displayBrokerFirm(contact: BrokerContact | null | undefined): string | null {
  const metadata = readRecord(contact?.sourceMetadata);
  return (
    contact?.firm?.trim()
    || (typeof metadata.firm === "string" ? metadata.firm.trim() : "")
    || (typeof metadata.brokerageName === "string" ? metadata.brokerageName.trim() : "")
    || (typeof metadata.brokerage === "string" ? metadata.brokerage.trim() : "")
    || null
  );
}

function displayBrokerBlockName(broker: UiV2BrokerBlock | null | undefined): string {
  return broker?.name?.trim() || broker?.email || "Property broker";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeActivity(value: string | null | undefined): string {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  return formatDate(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readBool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true || record[key] === "true";
}

function contactNeedsEmail(contact: BrokerContact): boolean {
  const sourceMetadata = readRecord(contact.sourceMetadata);
  const activitySummary = readRecord(contact.activitySummary);
  return (
    !contact.normalizedEmail ||
    readBool(sourceMetadata, "needsEmail") ||
    readBool(activitySummary, "needsEmail") ||
    readBool(activitySummary, "missingEmail")
  );
}

function contactFlags(contact: BrokerContact): Array<{ label: string; tone: "warning" | "danger" | "neutral" | "success" }> {
  const flags: Array<{ label: string; tone: "warning" | "danger" | "neutral" | "success" }> = [];
  if (contactNeedsEmail(contact)) flags.push({ label: "Needs email", tone: "danger" });
  if (contact.manualReviewOnly) flags.push({ label: "Manual review", tone: "warning" });
  if (contact.doNotContactUntil) flags.push({ label: `DNC until ${formatDate(contact.doNotContactUntil)}`, tone: "warning" });
  if (contact.manualOverwrittenAt) flags.push({ label: "Manual overwrite", tone: "success" });
  if (flags.length === 0) flags.push({ label: "Clear", tone: "neutral" });
  return flags;
}

function contactActivityAt(payload: UiV2CrmContactPayload): string | null {
  return payload.lastActivityAt ?? payload.contact.lastReplyAt ?? payload.contact.lastOutreachAt ?? payload.contact.updatedAt ?? null;
}

function contactLastActivityLabel(payload: UiV2CrmContactPayload): string {
  const activityAt = contactActivityAt(payload);
  if (!activityAt) return "No activity";
  if (payload.contact.lastReplyAt === activityAt) return `Reply ${relativeActivity(activityAt)}`;
  if (payload.contact.lastOutreachAt === activityAt) return `Outreach ${relativeActivity(activityAt)}`;
  return relativeActivity(activityAt);
}

function brokerToForm(broker: UiV2BrokerBlock | null): BrokerFormState {
  return {
    name: broker?.name ?? "",
    firm: broker?.firm ?? "",
    email: broker?.email ?? "",
    phone: broker?.phone ?? "",
    notes: broker?.notes ?? "",
  };
}

function defaultFollowUpLocal(): string {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  date.setHours(9, 0, 0, 0);
  return toDateTimeLocal(date);
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

function emptyDraftForm(): DraftFormState {
  return {
    toAddress: "",
    subject: "",
    body: "",
    followUpAt: "",
    templateId: "",
    templateName: "",
  };
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

function uniquePropertyIds(contacts: UiV2CrmContactPayload[]): string[] {
  const seen = new Set<string>();
  for (const payload of contacts) {
    for (const property of payload.relatedProperties ?? []) {
      if (property.propertyId) seen.add(property.propertyId);
    }
    for (const propertyId of payload.relatedPropertyIds ?? []) {
      if (propertyId) seen.add(propertyId);
    }
  }
  return [...seen];
}

function firstRelatedProperty(payload: UiV2CrmContactPayload): string | null {
  const propertyFromPayload = payload.relatedProperties?.find((property) => Boolean(property.propertyId))?.propertyId;
  if (propertyFromPayload) return propertyFromPayload;
  return payload.relatedPropertyIds?.find(Boolean) ?? null;
}

function relatedPropertyItems(
  payload: UiV2CrmContactPayload,
  propertyLabels: Record<string, string>
): RelatedPropertyItem[] {
  const byId = new Map<string, RelatedPropertyItem>();
  for (const property of payload.relatedProperties ?? []) {
    if (!property.propertyId) continue;
    byId.set(property.propertyId, {
      propertyId: property.propertyId,
      canonicalAddress: property.canonicalAddress,
      displayAddress: property.displayAddress,
      label: propertyLabelFromRelated(property, property.propertyId),
    });
  }
  for (const propertyId of payload.relatedPropertyIds ?? []) {
    if (!propertyId || byId.has(propertyId)) continue;
    byId.set(propertyId, {
      propertyId,
      label: shortPropertyAddress(propertyLabels[propertyId]) ?? propertyLabels[propertyId] ?? compactPropertyId(propertyId),
    });
  }
  return [...byId.values()];
}

function normalizeCrmContactPayload(value: unknown): UiV2CrmContactPayload | null {
  const record = readRecord(value);
  const contactRecord = readRecord(record.contact ?? value);
  const id = String(contactRecord.id ?? record.id ?? "");
  if (!id) return null;
  const now = new Date().toISOString();
  const relatedProperties = Array.isArray(record.relatedProperties)
    ? record.relatedProperties
        .map((property) => {
          const propertyRecord = readRecord(property);
          const propertyId = String(propertyRecord.propertyId ?? propertyRecord.id ?? "");
          if (!propertyId) return null;
          const label = typeof propertyRecord.label === "string" ? propertyRecord.label : null;
          return {
            propertyId,
            canonicalAddress: typeof propertyRecord.canonicalAddress === "string" ? propertyRecord.canonicalAddress : label,
            displayAddress: typeof propertyRecord.displayAddress === "string" ? propertyRecord.displayAddress : label,
          };
        })
        .filter(Boolean) as UiV2CrmRelatedProperty[]
    : [];
  const contact: BrokerContact = {
    id,
    normalizedEmail: typeof contactRecord.normalizedEmail === "string"
      ? contactRecord.normalizedEmail
      : typeof contactRecord.email === "string"
        ? contactRecord.email.toLowerCase()
        : null,
    sourceKey: typeof contactRecord.sourceKey === "string" ? contactRecord.sourceKey : null,
    displayName: typeof contactRecord.displayName === "string"
      ? contactRecord.displayName
      : typeof contactRecord.name === "string"
        ? contactRecord.name
        : null,
    firm: typeof contactRecord.firm === "string" ? contactRecord.firm : null,
    phone: typeof contactRecord.phone === "string" ? contactRecord.phone : null,
    source: typeof contactRecord.source === "string" ? contactRecord.source : typeof record.source === "string" ? record.source : null,
    sourceMetadata: readRecord(contactRecord.sourceMetadata),
    preferredThreadId: typeof contactRecord.preferredThreadId === "string" ? contactRecord.preferredThreadId : null,
    lastOutreachAt: typeof contactRecord.lastOutreachAt === "string" ? contactRecord.lastOutreachAt : null,
    lastReplyAt: typeof contactRecord.lastReplyAt === "string" ? contactRecord.lastReplyAt : null,
    doNotContactUntil: typeof contactRecord.doNotContactUntil === "string" ? contactRecord.doNotContactUntil : null,
    manualReviewOnly: contactRecord.manualReviewOnly === true,
    notes: typeof contactRecord.notes === "string" ? contactRecord.notes : null,
    activitySummary: readRecord(contactRecord.activitySummary),
    manualOverwrittenAt: typeof contactRecord.manualOverwrittenAt === "string" ? contactRecord.manualOverwrittenAt : null,
    manualOverwrittenBy: typeof contactRecord.manualOverwrittenBy === "string" ? contactRecord.manualOverwrittenBy : null,
    createdAt: typeof contactRecord.createdAt === "string" ? contactRecord.createdAt : now,
    updatedAt: typeof contactRecord.updatedAt === "string" ? contactRecord.updatedAt : now,
  };
  return {
    contact,
    relatedPropertyIds: Array.isArray(record.relatedPropertyIds) ? record.relatedPropertyIds.map(String) : relatedProperties.map((property) => property.propertyId),
    relatedProperties,
    openActionItemCount: Number(record.openActionItemCount ?? record.openActionCount ?? 0),
    lastActivityAt: typeof record.lastActivityAt === "string" ? record.lastActivityAt : null,
  };
}

function normalizeCrmListPayload(payload: unknown): UiV2CrmListPayload {
  const root = readRecord(payload);
  const crm = readRecord(root.crm ?? payload);
  const contacts = Array.isArray(crm.contacts)
    ? crm.contacts.map(normalizeCrmContactPayload).filter(Boolean) as UiV2CrmContactPayload[]
    : [];
  const summary = readRecord(crm.summary);
  return {
    contacts,
    total: Number(crm.total ?? summary.contacts ?? contacts.length),
    limit: Number(crm.limit ?? CRM_LIMIT),
    offset: Number(crm.offset ?? 0),
  };
}

function normalizePropertyBrokerPayload(
  payload: unknown,
  detail: UiV2PropertyDetailPayload | null
): PropertyBrokerPayload {
  const record = readRecord(payload);
  const propertyRecord = readRecord(record.property);
  const brokerRecord = readRecord(record.broker ?? propertyRecord.broker ?? detail?.broker);
  const broker = Object.keys(brokerRecord).length > 0
    ? {
        contactId: typeof brokerRecord.contactId === "string" ? brokerRecord.contactId : null,
        name: typeof brokerRecord.name === "string" ? brokerRecord.name : null,
        email: typeof brokerRecord.email === "string" ? brokerRecord.email : null,
        phone: typeof brokerRecord.phone === "string" ? brokerRecord.phone : null,
        firm: typeof brokerRecord.firm === "string" ? brokerRecord.firm : null,
        source: typeof brokerRecord.source === "string" ? brokerRecord.source : null,
        overwrittenAt: typeof brokerRecord.overwrittenAt === "string" ? brokerRecord.overwrittenAt : null,
        overwrittenBy: typeof brokerRecord.overwrittenBy === "string" ? brokerRecord.overwrittenBy : null,
        notes: typeof brokerRecord.notes === "string" ? brokerRecord.notes : null,
      }
    : null;
  return {
    broker,
    candidates: Array.isArray(record.candidates) ? record.candidates as BrokerCandidate[] : [],
    resolution: record.resolution ? readRecord(record.resolution) as unknown as RecipientResolution : null,
    contact: record.contact ? readRecord(record.contact) as unknown as BrokerContact : null,
    listingAgents: Array.isArray(record.listingAgents) ? record.listingAgents as BrokerCandidate[] : [],
    manualOverride: Object.keys(readRecord(record.manualOverride)).length > 0 ? readRecord(record.manualOverride) : null,
    openActionItemCount: Number(record.openActionItemCount ?? readRecord(propertyRecord.flow).openActionItemCount ?? 0),
    lastActivityAt: typeof record.lastActivityAt === "string" ? record.lastActivityAt : null,
  };
}

function normalizeComposerPayload(
  payload: unknown,
  fallbackBroker?: UiV2BrokerBlock | null
): UiV2OutreachComposerPayload {
  const root = readRecord(payload);
  const composer = readRecord(root.composer ?? payload);
  const broker = readRecord(composer.broker ?? fallbackBroker);
  const normalizedBroker = Object.keys(broker).length > 0
    ? {
        contactId: typeof broker.contactId === "string" ? broker.contactId : null,
        name: typeof broker.name === "string" ? broker.name : null,
        email: typeof broker.email === "string" ? broker.email : null,
        phone: typeof broker.phone === "string" ? broker.phone : null,
        firm: typeof broker.firm === "string" ? broker.firm : null,
        source: typeof broker.source === "string" ? broker.source : null,
        notes: typeof broker.notes === "string" ? broker.notes : null,
      }
    : null;
  return {
    propertyId: typeof composer.propertyId === "string" ? composer.propertyId : "",
    broker: normalizedBroker,
    suggestedRecipients: Array.isArray(composer.suggestedRecipients) ? composer.suggestedRecipients as UiV2CrmContactPayload[] : [],
    subject: typeof composer.subject === "string" ? composer.subject : "",
    body: typeof composer.body === "string" ? composer.body : "",
    followUpAt: typeof composer.followUpAt === "string" ? composer.followUpAt : null,
    warnings: Array.isArray(composer.warnings) ? composer.warnings.map(String) : [],
  };
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function CrmPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";

  const [searchText, setSearchText] = useState(query);
  const [contacts, setContacts] = useState<UiV2CrmContactPayload[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [propertyLabels, setPropertyLabels] = useState<Record<string, string>>({});
  const [propertyDetail, setPropertyDetail] = useState<UiV2PropertyDetailPayload | null>(null);
  const [propertyBroker, setPropertyBroker] = useState<PropertyBrokerPayload | null>(null);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [brokerForm, setBrokerForm] = useState<BrokerFormState>(brokerToForm(null));
  const [savingBroker, setSavingBroker] = useState(false);
  const [composer, setComposer] = useState<UiV2OutreachComposerPayload | null>(null);
  const [draftForm, setDraftForm] = useState<DraftFormState>(emptyDraftForm());
  const [loadingComposer, setLoadingComposer] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [templates, setTemplates] = useState<UiV2OutreachTemplatePayload[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [followUpForm, setFollowUpForm] = useState<FollowUpFormState>({
    followUpAt: defaultFollowUpLocal(),
    note: "",
  });
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  useEffect(() => {
    setSearchText(query);
  }, [query]);

  const loadCrm = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ limit: String(CRM_LIMIT), offset: "0" });
      if (query.trim()) params.set("q", query.trim());
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<CrmResponse>(`/api/ui-v2/crm?${params.toString()}`, { signal });
        const crm = normalizeCrmListPayload(data);
        setContacts(crm.contacts);
        setTotal(Number(crm.total ?? 0));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load CRM contacts.");
        setContacts([]);
        setTotal(0);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [query]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadCrm(controller.signal);
    return () => controller.abort();
  }, [loadCrm]);

  useEffect(() => {
    const labelsFromPayload: Record<string, string> = {};
    for (const payload of contacts) {
      for (const property of payload.relatedProperties ?? []) {
        if (!property.propertyId) continue;
        labelsFromPayload[property.propertyId] = propertyLabelFromRelated(property, property.propertyId);
      }
    }
    if (Object.keys(labelsFromPayload).length > 0) {
      setPropertyLabels((prev) => ({ ...prev, ...labelsFromPayload }));
    }
  }, [contacts]);

  const visiblePropertyIds = useMemo(
    () => uniquePropertyIds(contacts).slice(0, PROPERTY_LABEL_PREFETCH_LIMIT),
    [contacts]
  );

  useEffect(() => {
    const missing = visiblePropertyIds.filter((propertyId) => propertyLabels[propertyId] == null);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(
      missing.map(async (propertyId) => {
        const data = await apiFetch<PropertyDetailResponse>(`/api/ui-v2/properties/${encodeURIComponent(propertyId)}`);
        return {
          propertyId,
          label:
            shortPropertyAddress(data.property?.overview.displayAddress) ??
            shortPropertyAddress(data.property?.overview.canonicalAddress) ??
            compactPropertyId(propertyId),
        };
      })
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const result of results) {
        if (result.status === "fulfilled") next[result.value.propertyId] = result.value.label;
      }
      if (Object.keys(next).length > 0) {
        setPropertyLabels((prev) => ({ ...prev, ...next }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [propertyLabels, visiblePropertyIds]);

  const stats = useMemo(() => {
    const needsEmail = contacts.filter((payload) => contactNeedsEmail(payload.contact)).length;
    const manualReview = contacts.filter((payload) => payload.contact.manualReviewOnly).length;
    const openActions = contacts.reduce((sum, payload) => sum + Number(payload.openActionItemCount ?? 0), 0);
    const relatedProperties = uniquePropertyIds(contacts).length;
    return { needsEmail, manualReview, openActions, relatedProperties };
  }, [contacts]);

  const updateQuery = useCallback(
    (value: string) => {
      setSearchText(value);
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set("q", value);
      else params.delete("q");
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const setPanelNotice = useCallback((notice: Notice) => {
    setPanel((current) => (current ? { ...current, notice } : current));
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const data = await apiFetch<OutreachTemplatesResponse>("/api/ui-v2/outreach-templates");
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved outreach drafts.");
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const openContactPanel = useCallback((contactPayload: UiV2CrmContactPayload, notice?: Notice) => {
    setComposer(null);
    setPropertyDetail(null);
    setPropertyBroker(null);
    setPanel({ type: "contact", contactPayload, notice });
  }, []);

  const openPropertyPanel = useCallback(
    (propertyId: string, contactPayload?: UiV2CrmContactPayload, notice?: Notice, options?: { composer?: boolean; followUp?: boolean }) => {
      setComposer(null);
      setDraftForm(emptyDraftForm());
      setPropertyDetail(null);
      setPropertyBroker(null);
      setPropertyError(null);
      setPanel({
        type: "property",
        propertyId,
        contactPayload,
        notice,
        openComposer: options?.composer,
        openFollowUp: options?.followUp,
      });
    },
    []
  );

  const activePropertyId = panel?.type === "property" ? panel.propertyId : null;
  const activePropertyLabel = activePropertyId
    ? propertyDetail?.overview.displayAddress ??
      propertyDetail?.overview.canonicalAddress ??
      propertyLabels[activePropertyId] ??
      compactPropertyId(activePropertyId)
    : "";

  useEffect(() => {
    if (!activePropertyId) return;
    const controller = new AbortController();
    setPropertyLoading(true);
    setPropertyError(null);
    setPropertyDetail(null);
    setPropertyBroker(null);
    setBrokerForm(brokerToForm(null));

    Promise.all([
      apiFetch<PropertyDetailResponse>(`/api/ui-v2/properties/${encodeURIComponent(activePropertyId)}`, {
        signal: controller.signal,
      }),
      apiFetch<PropertyBrokerResponse>(`/api/ui-v2/properties/${encodeURIComponent(activePropertyId)}/broker`, {
        signal: controller.signal,
      }),
    ])
      .then(([detailResponse, brokerResponse]) => {
        if (controller.signal.aborted) return;
        setPropertyDetail(detailResponse.property);
        const normalizedBroker = normalizePropertyBrokerPayload(brokerResponse, detailResponse.property);
        setPropertyBroker(normalizedBroker);
        setBrokerForm(brokerToForm(normalizedBroker.broker));
        const label =
          shortPropertyAddress(detailResponse.property?.overview.displayAddress) ??
          shortPropertyAddress(detailResponse.property?.overview.canonicalAddress) ??
          compactPropertyId(activePropertyId);
        setPropertyLabels((prev) => ({ ...prev, [activePropertyId]: label }));
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPropertyError(err instanceof Error ? err.message : "Failed to load property broker.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPropertyLoading(false);
      });

    return () => controller.abort();
  }, [activePropertyId]);

  const loadComposer = useCallback(
    async (propertyId: string) => {
      setLoadingComposer(true);
      setComposer(null);
      try {
        const data = await apiFetch<OutreachComposerResponse>(
          `/api/ui-v2/properties/${encodeURIComponent(propertyId)}/outreach-composer`
        );
        const composerPayload = normalizeComposerPayload(data, propertyBroker?.broker);
        const toAddress = composerPayload.broker?.email ?? "";
        if (!toAddress) {
          setPanelNotice({
            type: "info",
            message: "Add a broker email before drafting outreach for this property.",
          });
          return;
        }
        setComposer(composerPayload);
        setDraftForm({
          toAddress,
          subject: composerPayload.subject,
          body: composerPayload.body,
          followUpAt: composerPayload.followUpAt ? toDateTimeLocal(new Date(composerPayload.followUpAt)) : "",
          templateId: "",
          templateName: "",
        });
      } catch (err) {
        setPanelNotice({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to load outreach composer.",
        });
      } finally {
        setLoadingComposer(false);
      }
    },
    [propertyBroker?.broker, setPanelNotice]
  );

  useEffect(() => {
    if (panel?.type === "property" && panel.openComposer && propertyBroker) {
      if (!propertyBroker.broker?.email) {
        setPanel((current) =>
          current?.type === "property"
            ? {
                ...current,
                openComposer: false,
                notice: { type: "info", message: "Add a broker email before drafting outreach for this property." },
              }
            : current
        );
        return;
      }
      setPanel((current) => (current?.type === "property" ? { ...current, openComposer: false } : current));
      void loadComposer(panel.propertyId);
    }
  }, [loadComposer, panel, propertyBroker, setPanelNotice]);

  useEffect(() => {
    if (panel?.type === "property" && panel.openFollowUp) {
      setFollowUpForm((prev) => ({ ...prev, followUpAt: prev.followUpAt || defaultFollowUpLocal() }));
      setPanel((current) => (current?.type === "property" ? { ...current, openFollowUp: false } : current));
    }
  }, [panel]);

  const handleSaveBroker = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activePropertyId) return;
      setSavingBroker(true);
      try {
        const data = await apiFetch<PropertyBrokerResponse>(
          `/api/ui-v2/properties/${encodeURIComponent(activePropertyId)}/broker`,
          {
            method: "PUT",
            body: JSON.stringify({
              name: brokerForm.name.trim() || null,
              firm: brokerForm.firm.trim() || null,
              email: brokerForm.email.trim() || null,
              phone: brokerForm.phone.trim() || null,
              notes: brokerForm.notes.trim() || null,
              actorName: "crm",
            }),
          }
        );
        setPropertyBroker(data);
        setBrokerForm(brokerToForm(data.broker));
        setPanelNotice({
          type: "success",
          message: "Broker overwrite saved for this property. Outreach will now use the edited broker details.",
        });
        await loadCrm();
      } catch (err) {
        setPanelNotice({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to save broker overwrite.",
        });
      } finally {
        setSavingBroker(false);
      }
    },
    [activePropertyId, brokerForm, loadCrm, setPanelNotice]
  );

  const templateContext = useMemo(
    () => ({
      address:
        activePropertyLabel ||
        propertyDetail?.overview.displayAddress ||
        propertyDetail?.overview.canonicalAddress ||
        null,
      brokerName: propertyBroker?.broker?.name ?? brokerForm.name,
      firm: propertyBroker?.broker?.firm ?? brokerForm.firm,
    }),
    [activePropertyLabel, brokerForm.firm, brokerForm.name, propertyBroker, propertyDetail]
  );

  const applyTemplate = useCallback(
    (templateId: string) => {
      const template = templates.find((item) => item.id === templateId);
      if (!template) {
        setDraftForm((prev) => ({ ...prev, templateId: "", templateName: "" }));
        return;
      }
      setDraftForm((prev) => ({
        ...prev,
        templateId: template.id,
        templateName: template.name,
        subject: renderTemplateText(template.subject, templateContext),
        body: renderTemplateText(template.body, templateContext),
      }));
    },
    [templateContext, templates]
  );

  const handleSaveTemplate = useCallback(async () => {
    const name = draftForm.templateName.trim();
    if (!name) {
      setPanelNotice({ type: "info", message: "Name this reusable draft before saving it globally." });
      return;
    }
    setSavingTemplate(true);
    try {
      const data = await apiFetch<OutreachTemplateResponse>("/api/ui-v2/outreach-templates", {
        method: "POST",
        body: JSON.stringify({
          id: draftForm.templateId || null,
          name,
          subject: draftForm.subject.trim(),
          body: draftForm.body.trim(),
          actorName: "crm",
        }),
      });
      setTemplates((current) => {
        const others = current.filter((template) => template.id !== data.template.id);
        return [...others, data.template].sort((left, right) => left.name.localeCompare(right.name));
      });
      setDraftForm((prev) => ({
        ...prev,
        templateId: data.template.id,
        templateName: data.template.name,
      }));
      setPanelNotice({ type: "success", message: "Reusable broker email draft saved globally." });
    } catch (err) {
      setPanelNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save reusable draft.",
      });
    } finally {
      setSavingTemplate(false);
    }
  }, [draftForm.body, draftForm.subject, draftForm.templateId, draftForm.templateName, setPanelNotice]);

  const handleDeleteTemplate = useCallback(async () => {
    const templateId = draftForm.templateId;
    if (!templateId) return;
    const templateName = draftForm.templateName || templates.find((template) => template.id === templateId)?.name || "this draft";
    if (!window.confirm(`Remove "${templateName}" from global broker drafts?`)) return;
    setDeletingTemplate(true);
    try {
      await apiFetch<{ ok: boolean }>(`/api/ui-v2/outreach-templates/${encodeURIComponent(templateId)}`, {
        method: "DELETE",
      });
      setTemplates((current) => current.filter((template) => template.id !== templateId));
      setDraftForm((prev) => ({ ...prev, templateId: "", templateName: "" }));
      setPanelNotice({ type: "success", message: "Reusable draft removed." });
    } catch (err) {
      setPanelNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to remove reusable draft.",
      });
    } finally {
      setDeletingTemplate(false);
    }
  }, [draftForm.templateId, draftForm.templateName, setPanelNotice, templates]);

  const handleSaveDraft = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activePropertyId) return;
      setSavingDraft(true);
      try {
        const data = await apiFetch<OutreachDraftResponse>("/api/ui-v2/outreach-drafts", {
          method: "POST",
          body: JSON.stringify({
            propertyId: activePropertyId,
            contactId: propertyBroker?.broker?.contactId ?? propertyBroker?.contact?.id ?? null,
            toAddress: draftForm.toAddress.trim(),
            subject: draftForm.subject.trim(),
            body: draftForm.body.trim(),
            followUpAt: dateTimeLocalToIso(draftForm.followUpAt),
            templateId: draftForm.templateId || null,
            templateName: draftForm.templateName.trim() || null,
          }),
        });
        setPanelNotice({
          type: "success",
          message: `Draft ${data.draft.id} saved to the review-required queue. No email was sent.`,
        });
        await loadCrm();
      } catch (err) {
        setPanelNotice({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to save outreach draft.",
        });
      } finally {
        setSavingDraft(false);
      }
    },
    [activePropertyId, draftForm, loadCrm, propertyBroker, setPanelNotice]
  );

  const handleSendDraftNow = useCallback(async () => {
    if (!activePropertyId) return;
    const toAddress = draftForm.toAddress.trim();
    if (!toAddress || !draftForm.subject.trim() || !draftForm.body.trim()) {
      setPanelNotice({ type: "info", message: "Add a recipient, subject, and body before sending." });
      return;
    }
    if (!window.confirm(`Send this broker email now to ${toAddress}?`)) return;
    const send = (force = false) =>
      apiFetch<UiV2OutreachSendNowPayload>("/api/ui-v2/outreach-send-now", {
        method: "POST",
        body: JSON.stringify({
          propertyId: activePropertyId,
          contactId: propertyBroker?.broker?.contactId ?? propertyBroker?.contact?.id ?? null,
          toAddress,
          subject: draftForm.subject.trim(),
          body: draftForm.body.trim(),
          followUpAt: dateTimeLocalToIso(draftForm.followUpAt),
          templateId: draftForm.templateId || null,
          templateName: draftForm.templateName.trim() || null,
          force,
        }),
      });

    setSendingDraft(true);
    try {
      let data: UiV2OutreachSendNowPayload;
      try {
        data = await send(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send broker email.";
        if (!message.includes("Use force") || !window.confirm(`${message} Send anyway?`)) throw err;
        data = await send(true);
      }
      setPanelNotice({
        type: "success",
        message: `Email sent and logged at ${formatDateTime(data.sentAt)}.`,
      });
      await loadCrm();
    } catch (err) {
      setPanelNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to send broker email.",
      });
    } finally {
      setSendingDraft(false);
    }
  }, [activePropertyId, draftForm, loadCrm, propertyBroker, setPanelNotice]);

  const handleScheduleFollowUp = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activePropertyId) return;
      setSavingFollowUp(true);
      try {
        const data = await apiFetch<FollowUpResponse>("/api/ui-v2/outreach-follow-ups", {
          method: "POST",
          body: JSON.stringify({
            propertyId: activePropertyId,
            contactId: propertyBroker?.broker?.contactId ?? propertyBroker?.contact?.id ?? null,
            action: "schedule",
            followUpAt: dateTimeLocalToIso(followUpForm.followUpAt),
            note: followUpForm.note.trim() || null,
          }),
        });
        setPanelNotice({
          type: "success",
          message: `Follow-up ${data.followUp.status === "scheduled" ? "scheduled" : "updated"} for this broker.`,
        });
        await loadCrm();
      } catch (err) {
        setPanelNotice({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to schedule follow-up.",
        });
      } finally {
        setSavingFollowUp(false);
      }
    },
    [activePropertyId, followUpForm, loadCrm, propertyBroker, setPanelNotice]
  );

  const handleComposeFromContact = useCallback(
    (payload: UiV2CrmContactPayload) => {
      const propertyId = firstRelatedProperty(payload);
      if (!propertyId) {
        openContactPanel(payload, {
          type: "info",
          message: "This CRM contact does not have a related property yet.",
        });
        return;
      }
      if (contactNeedsEmail(payload.contact)) {
        openPropertyPanel(propertyId, payload, {
          type: "info",
          message: "This broker needs an email before outreach. Add one below to create a property-specific overwrite.",
        });
        return;
      }
      openPropertyPanel(propertyId, payload, undefined, { composer: true });
    },
    [openContactPanel, openPropertyPanel]
  );

  const handleFollowUpFromContact = useCallback(
    (payload: UiV2CrmContactPayload) => {
      const propertyId = firstRelatedProperty(payload);
      if (!propertyId) {
        openContactPanel(payload, {
          type: "info",
          message: "This CRM contact does not have a related property for follow-up scheduling.",
        });
        return;
      }
      openPropertyPanel(propertyId, payload, undefined, { followUp: true });
    },
    [openContactPanel, openPropertyPanel]
  );

  const closePanel = useCallback(() => {
    setPanel(null);
    setComposer(null);
    setPropertyDetail(null);
    setPropertyBroker(null);
    setPropertyError(null);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Broker CRM</p>
          <h1 className={styles.title}>Contacts</h1>
        </div>
        <div className={styles.searchWrap}>
          <label className={styles.searchLabel} htmlFor="crm-search">
            Search
          </label>
          <input
            id="crm-search"
            className={styles.searchInput}
            value={searchText}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Broker, firm, email, phone, notes"
            autoComplete="off"
          />
        </div>
      </header>

      <section className={styles.metrics} aria-label="CRM summary">
        <div className={styles.metric}>
          <span className={styles.metricValue}>{total}</span>
          <span className={styles.metricLabel}>Contacts</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{stats.needsEmail}</span>
          <span className={styles.metricLabel}>Need email</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{stats.openActions}</span>
          <span className={styles.metricLabel}>Open actions</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{stats.relatedProperties}</span>
          <span className={styles.metricLabel}>Properties</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{stats.manualReview}</span>
          <span className={styles.metricLabel}>Manual review</span>
        </div>
      </section>

      {error ? <div className={classNames(styles.notice, styles.noticeError)}>{error}</div> : null}

      <section className={styles.tableShell}>
        <div className={styles.tableHeader}>
          <div>
            <strong>{loading ? "Loading CRM contacts" : `${contacts.length} shown`}</strong>
            <span>{query.trim() ? `Filtered by "${query.trim()}"` : "Sorted by recent activity"}</span>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadCrm()} disabled={loading}>
            Refresh
          </button>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Broker</th>
                <th>Contact</th>
                <th>Related properties</th>
                <th>Last activity</th>
                <th>Open actions</th>
                <th>Flags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>
                    Loading contacts...
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>
                    No broker contacts match this search.
                  </td>
                </tr>
              ) : (
                contacts.map((payload) => {
                  const { contact } = payload;
                  const flags = contactFlags(contact);
                  const related = relatedPropertyItems(payload, propertyLabels);
                  const contactItems = [contact.normalizedEmail, contact.phone].filter((value): value is string => Boolean(value));
                  const firmLabel = displayBrokerFirm(contact);
                  return (
                    <tr key={contact.id}>
                      <td className={styles.brokerCell}>
                        <button
                          className={styles.linkButton}
                          type="button"
                          title={displayBrokerName(contact)}
                          onClick={() => openContactPanel(payload)}
                        >
                          {displayBrokerName(contact)}
                        </button>
                        <div className={styles.subtleLine}>{firmLabel || contact.source || "Broker contact"}</div>
                      </td>
                      <td>
                        <div className={styles.contactLine}>
                          {contactItems.length > 0 ? (
                            contactItems.map((item) => <span key={item}>{item}</span>)
                          ) : (
                            <span className={styles.missingText}>Email needed</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className={styles.propertyChips}>
                          {related.slice(0, 3).map((propertyId) => (
                            <button
                              key={propertyId.propertyId}
                              className={styles.propertyChip}
                              type="button"
                              title={propertyId.canonicalAddress ?? propertyId.propertyId}
                              onClick={() => openPropertyPanel(propertyId.propertyId, payload)}
                            >
                              {propertyId.label}
                            </button>
                          ))}
                          {related.length > 3 ? <span className={styles.moreChip}>+{related.length - 3}</span> : null}
                          {related.length === 0 ? <span className={styles.subtleLine}>No properties</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className={styles.activityLine}>
                          <span className={styles.cellStrong}>{contactLastActivityLabel(payload)}</span>
                          {contactActivityAt(payload) ? <span>{formatDateTime(contactActivityAt(payload))}</span> : null}
                        </div>
                      </td>
                      <td>
                        <span className={payload.openActionItemCount ? styles.actionCountHot : styles.actionCount}>
                          {payload.openActionItemCount ?? 0}
                        </span>
                      </td>
                      <td>
                        <div className={styles.flagWrap}>
                          {flags.map((flag) => (
                            <span key={flag.label} className={classNames(styles.flag, styles[`flag_${flag.tone}`])}>
                              {flag.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button className={styles.tableButton} type="button" onClick={() => handleComposeFromContact(payload)}>
                            Email
                          </button>
                          <button className={styles.tableButton} type="button" onClick={() => handleFollowUpFromContact(payload)}>
                            Follow-up
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {panel ? (
        <div className={styles.overlay} role="presentation" onMouseDown={closePanel}>
          <aside className={styles.panel} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button className={styles.closeButton} type="button" onClick={closePanel} aria-label="Close panel">
              x
            </button>

            {panel.type === "contact" ? (
              <ContactPanel
                payload={panel.contactPayload}
                notice={panel.notice}
                propertyLabels={propertyLabels}
                onOpenProperty={(propertyId) => openPropertyPanel(propertyId, panel.contactPayload)}
                onCompose={() => handleComposeFromContact(panel.contactPayload)}
                onFollowUp={() => handleFollowUpFromContact(panel.contactPayload)}
              />
            ) : (
              <PropertyPanel
                propertyId={panel.propertyId}
                propertyLabel={activePropertyLabel}
                notice={panel.notice}
                propertyDetail={propertyDetail}
                propertyBroker={propertyBroker}
                propertyLoading={propertyLoading}
                propertyError={propertyError}
                brokerForm={brokerForm}
                setBrokerForm={setBrokerForm}
                savingBroker={savingBroker}
                onSaveBroker={handleSaveBroker}
                composer={composer}
                draftForm={draftForm}
                setDraftForm={setDraftForm}
                loadingComposer={loadingComposer}
                savingDraft={savingDraft}
                sendingDraft={sendingDraft}
                templates={templates}
                loadingTemplates={loadingTemplates}
                savingTemplate={savingTemplate}
                deletingTemplate={deletingTemplate}
                onLoadComposer={() => void loadComposer(panel.propertyId)}
                onSaveDraft={handleSaveDraft}
                onSendDraftNow={handleSendDraftNow}
                onApplyTemplate={applyTemplate}
                onSaveTemplate={() => void handleSaveTemplate()}
                onDeleteTemplate={() => void handleDeleteTemplate()}
                followUpForm={followUpForm}
                setFollowUpForm={setFollowUpForm}
                savingFollowUp={savingFollowUp}
                onScheduleFollowUp={handleScheduleFollowUp}
              />
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function ContactPanel({
  payload,
  notice,
  propertyLabels,
  onOpenProperty,
  onCompose,
  onFollowUp,
}: {
  payload: UiV2CrmContactPayload;
  notice?: Notice;
  propertyLabels: Record<string, string>;
  onOpenProperty: (propertyId: string) => void;
  onCompose: () => void;
  onFollowUp: () => void;
}) {
  const { contact } = payload;
  const flags = contactFlags(contact);
  const related = relatedPropertyItems(payload, propertyLabels);

  return (
    <div className={styles.panelBody}>
      <p className={styles.eyebrow}>Contact</p>
      <h2 className={styles.panelTitle}>{displayBrokerName(contact)}</h2>
      <p className={styles.panelMeta}>{contact.firm || "No firm"} | {contact.source || "crm"}</p>
      {notice ? <div className={classNames(styles.notice, styles[`notice_${notice.type}`])}>{notice.message}</div> : null}

      <div className={styles.panelActions}>
        <button className={styles.primaryButton} type="button" onClick={onCompose}>
          Email
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onFollowUp}>
          Follow-up
        </button>
      </div>

      <section className={styles.panelSection}>
        <h3>Contact details</h3>
        <dl className={styles.detailGrid}>
          <div>
            <dt>Email</dt>
            <dd className={contact.normalizedEmail ? undefined : styles.missingText}>
              {contact.normalizedEmail || "Needs email"}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{contact.phone || "-"}</dd>
          </div>
          <div>
            <dt>Last outreach</dt>
            <dd>{formatDateTime(contact.lastOutreachAt)}</dd>
          </div>
          <div>
            <dt>Last reply</dt>
            <dd>{formatDateTime(contact.lastReplyAt)}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.panelSection}>
        <h3>Flags</h3>
        <div className={styles.flagWrap}>
          {flags.map((flag) => (
            <span key={flag.label} className={classNames(styles.flag, styles[`flag_${flag.tone}`])}>
              {flag.label}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.panelSection}>
        <h3>Related properties</h3>
        <div className={styles.panelList}>
          {related.map((property) => (
            <button
              key={property.propertyId}
              className={styles.panelListItem}
              type="button"
              onClick={() => onOpenProperty(property.propertyId)}
            >
              <span>{property.label}</span>
              <small>{property.canonicalAddress ?? property.propertyId}</small>
            </button>
          ))}
          {related.length === 0 ? <p className={styles.emptyNote}>No linked properties.</p> : null}
        </div>
      </section>

      {contact.notes ? (
        <section className={styles.panelSection}>
          <h3>Notes</h3>
          <p className={styles.notes}>{contact.notes}</p>
        </section>
      ) : null}
    </div>
  );
}

function PropertyPanel({
  propertyId,
  propertyLabel,
  notice,
  propertyDetail,
  propertyBroker,
  propertyLoading,
  propertyError,
  brokerForm,
  setBrokerForm,
  savingBroker,
  onSaveBroker,
  composer,
  draftForm,
  setDraftForm,
  loadingComposer,
  savingDraft,
  sendingDraft,
  templates,
  loadingTemplates,
  savingTemplate,
  deletingTemplate,
  onLoadComposer,
  onSaveDraft,
  onSendDraftNow,
  onApplyTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  followUpForm,
  setFollowUpForm,
  savingFollowUp,
  onScheduleFollowUp,
}: {
  propertyId: string;
  propertyLabel: string;
  notice?: Notice;
  propertyDetail: UiV2PropertyDetailPayload | null;
  propertyBroker: PropertyBrokerPayload | null;
  propertyLoading: boolean;
  propertyError: string | null;
  brokerForm: BrokerFormState;
  setBrokerForm: (value: BrokerFormState | ((prev: BrokerFormState) => BrokerFormState)) => void;
  savingBroker: boolean;
  onSaveBroker: (event: FormEvent<HTMLFormElement>) => void;
  composer: UiV2OutreachComposerPayload | null;
  draftForm: DraftFormState;
  setDraftForm: (value: DraftFormState | ((prev: DraftFormState) => DraftFormState)) => void;
  loadingComposer: boolean;
  savingDraft: boolean;
  sendingDraft: boolean;
  templates: UiV2OutreachTemplatePayload[];
  loadingTemplates: boolean;
  savingTemplate: boolean;
  deletingTemplate: boolean;
  onLoadComposer: () => void;
  onSaveDraft: (event: FormEvent<HTMLFormElement>) => void;
  onSendDraftNow: () => void;
  onApplyTemplate: (templateId: string) => void;
  onSaveTemplate: () => void;
  onDeleteTemplate: () => void;
  followUpForm: FollowUpFormState;
  setFollowUpForm: (value: FollowUpFormState | ((prev: FollowUpFormState) => FollowUpFormState)) => void;
  savingFollowUp: boolean;
  onScheduleFollowUp: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const broker = propertyBroker?.broker ?? null;
  const missingEmail = !broker?.email;

  return (
    <div className={styles.panelBody}>
      <p className={styles.eyebrow}>Property broker</p>
      <h2 className={styles.panelTitle}>{propertyLabel || compactPropertyId(propertyId)}</h2>
      <p className={styles.panelMeta}>{propertyDetail?.overview.canonicalAddress ?? propertyId}</p>

      {notice ? <div className={classNames(styles.notice, styles[`notice_${notice.type}`])}>{notice.message}</div> : null}
      {propertyError ? <div className={classNames(styles.notice, styles.noticeError)}>{propertyError}</div> : null}
      {propertyLoading ? <div className={styles.loadingBlock}>Loading property broker...</div> : null}

      {!propertyLoading ? (
        <>
          <section className={styles.panelSection}>
            <h3>Current broker</h3>
            <div className={styles.brokerSummary}>
              <div>
                <strong>{displayBrokerBlockName(broker)}</strong>
                <span>{broker?.firm || "No firm"}</span>
              </div>
              <div className={styles.flagWrap}>
                <span className={classNames(styles.flag, missingEmail ? styles.flag_danger : styles.flag_success)}>
                  {missingEmail ? "Needs email" : "Email ready"}
                </span>
                {broker?.source ? <span className={classNames(styles.flag, styles.flag_neutral)}>{broker.source}</span> : null}
              </div>
            </div>
          </section>

          <section className={styles.panelSection}>
            <h3>Edit property-specific broker</h3>
            <div className={classNames(styles.notice, styles.notice_info)}>
              Saving creates a manual overwrite for this property and replaces sourced or LLM broker details used by outreach.
            </div>
            <form className={styles.formGrid} onSubmit={onSaveBroker}>
              <label>
                <span>Name</span>
                <input
                  value={brokerForm.name}
                  onChange={(event) => setBrokerForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label>
                <span>Firm</span>
                <input
                  value={brokerForm.firm}
                  onChange={(event) => setBrokerForm((prev) => ({ ...prev, firm: event.target.value }))}
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  value={brokerForm.email}
                  onChange={(event) => setBrokerForm((prev) => ({ ...prev, email: event.target.value }))}
                />
              </label>
              <label>
                <span>Phone</span>
                <input
                  value={brokerForm.phone}
                  onChange={(event) => setBrokerForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
              </label>
              <label className={styles.fullField}>
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={brokerForm.notes}
                  onChange={(event) => setBrokerForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>
              <div className={styles.formActions}>
                <button className={styles.primaryButton} type="submit" disabled={savingBroker}>
                  {savingBroker ? "Saving..." : "Save overwrite"}
                </button>
              </div>
            </form>
          </section>

          <section className={styles.panelSection}>
            <div className={styles.sectionHeaderRow}>
              <h3>Outreach draft</h3>
              <button className={styles.secondaryButton} type="button" onClick={onLoadComposer} disabled={loadingComposer || missingEmail}>
                {loadingComposer ? "Loading..." : "Load composer"}
              </button>
            </div>
            {missingEmail ? <p className={styles.emptyNote}>Add an email above before composing outreach.</p> : null}
            {composer?.warnings?.length ? (
              <div className={classNames(styles.notice, styles.notice_info)}>{composer.warnings.join(" ")}</div>
            ) : null}
            {composer ? (
              <form className={styles.stackForm} onSubmit={onSaveDraft}>
                <div className={styles.templateToolbar}>
                  <label>
                    <span>Saved draft</span>
                    <select
                      value={draftForm.templateId}
                      onChange={(event) => onApplyTemplate(event.target.value)}
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
                      value={draftForm.templateName}
                      onChange={(event) => setDraftForm((prev) => ({ ...prev, templateName: event.target.value }))}
                      placeholder="Name reusable draft"
                    />
                  </label>
                  <button className={styles.secondaryButton} type="button" onClick={onSaveTemplate} disabled={savingTemplate}>
                    {savingTemplate ? "Saving..." : "Save reusable"}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={onDeleteTemplate}
                    disabled={!draftForm.templateId || deletingTemplate}
                  >
                    {deletingTemplate ? "Removing..." : "Remove"}
                  </button>
                </div>
                <label>
                  <span>To</span>
                  <input
                    value={draftForm.toAddress}
                    onChange={(event) => setDraftForm((prev) => ({ ...prev, toAddress: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Subject</span>
                  <input
                    value={draftForm.subject}
                    onChange={(event) => setDraftForm((prev) => ({ ...prev, subject: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Body</span>
                  <textarea
                    rows={9}
                    value={draftForm.body}
                    onChange={(event) => setDraftForm((prev) => ({ ...prev, body: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Follow-up</span>
                  <input
                    type="datetime-local"
                    value={draftForm.followUpAt}
                    onChange={(event) => setDraftForm((prev) => ({ ...prev, followUpAt: event.target.value }))}
                  />
                </label>
                <div className={styles.formActions}>
                  <button className={styles.primaryButton} type="button" onClick={onSendDraftNow} disabled={sendingDraft}>
                    {sendingDraft ? "Sending..." : "Send now"}
                  </button>
                  <button className={styles.secondaryButton} type="submit" disabled={savingDraft}>
                    {savingDraft ? "Saving..." : "Save draft for review"}
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          <section className={styles.panelSection}>
            <h3>Follow-up</h3>
            <form className={styles.stackForm} onSubmit={onScheduleFollowUp}>
              <label>
                <span>Due</span>
                <input
                  type="datetime-local"
                  value={followUpForm.followUpAt}
                  onChange={(event) => setFollowUpForm((prev) => ({ ...prev, followUpAt: event.target.value }))}
                />
              </label>
              <label>
                <span>Note</span>
                <textarea
                  rows={3}
                  value={followUpForm.note}
                  onChange={(event) => setFollowUpForm((prev) => ({ ...prev, note: event.target.value }))}
                />
              </label>
              <button className={styles.secondaryButton} type="submit" disabled={savingFollowUp}>
                {savingFollowUp ? "Scheduling..." : "Schedule follow-up"}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}

export default function CrmPage() {
  return (
    <Suspense fallback={<div className={styles.page}>Loading CRM...</div>}>
      <CrmPageContent />
    </Suspense>
  );
}
