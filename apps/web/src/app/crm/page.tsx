"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  BrokerContact,
  RecipientResolution,
  UiV2BrokerBlock,
  UiV2CrmBrokerResponsePayload,
  UiV2CrmBrokerResponseStatus,
  UiV2CrmContactPayload,
  UiV2CrmListPayload,
  UiV2CrmPropertyRowPayload,
  UiV2CrmRelatedProperty,
  UiV2OutreachComposerPayload,
  UiV2OutreachDraftListItem,
  UiV2OutreachDraftListPayload,
  UiV2OutreachDraftPayload,
  UiV2OutreachFollowUpActionPayload,
  UiV2OutreachSendNowPayload,
  UiV2OutreachTemplatePayload,
  UiV2PropertyDetailPayload,
} from "@re-sourcing/contracts";
import styles from "./CrmPage.module.css";
import { ConfirmDialog } from "@/components/ui";
import { API_BASE, apiFetch } from "@/lib/api";
import { labelFromKey } from "@/lib/format";

const CRM_LIMIT = 100;
const PROPERTY_LABEL_PREFETCH_LIMIT = 200;
const BROKER_RESPONSE_OPTIONS: Array<{ value: UiV2CrmBrokerResponseStatus; label: string }> = [
  { value: "none", label: "No response" },
  { value: "waiting", label: "Waiting" },
  { value: "responded", label: "Responded" },
  { value: "unresponsive", label: "Unresponsive" },
  { value: "inefficient", label: "Inefficient" },
  { value: "wrong_contact", label: "Wrong contact" },
];

type NoticeType = "success" | "error" | "info";
type CrmViewMode = "properties" | "contacts" | "drafts";
type CrmSortField = "address" | "broker" | "email" | "flags" | "lastActivity" | "open" | "response";
type SortDirection = "asc" | "desc";

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
  | { type: "merge"; contactPayload: UiV2CrmContactPayload; notice?: Notice }
  | {
      type: "property";
      propertyId: string;
      contactPayload?: UiV2CrmContactPayload;
      notice?: Notice;
      openComposer?: boolean;
      openFollowUp?: boolean;
      /** When set, the composer opens with this saved draft instead of the template text. */
      draftPrefill?: DraftFormState;
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

interface BrokerResponseDraft {
  status: UiV2CrmBrokerResponseStatus | string;
  note: string;
}

interface MergeResponse {
  merge: {
    contact: BrokerContact;
    mergedCount: number;
    affectedPropertyCount: number;
  };
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
  return cleanDisplayText(contact?.displayName) || cleanDisplayText(contact?.normalizedEmail) || cleanDisplayText(contact?.sourceKey) || fallback;
}

function displayBrokerFirm(contact: BrokerContact | null | undefined): string | null {
  const metadata = readRecord(contact?.sourceMetadata);
  return (
    cleanDisplayText(contact?.firm)
    || (typeof metadata.firm === "string" ? cleanDisplayText(metadata.firm) : null)
    || (typeof metadata.brokerageName === "string" ? cleanDisplayText(metadata.brokerageName) : null)
    || (typeof metadata.brokerage === "string" ? cleanDisplayText(metadata.brokerage) : null)
    || null
  );
}

function displayBrokerBlockName(broker: UiV2BrokerBlock | null | undefined): string {
  return cleanDisplayText(broker?.name) || cleanDisplayText(broker?.email) || "Property broker";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
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

function cleanDisplayText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "-" || trimmed.toLowerCase() === "n/a" || trimmed.toLowerCase() === "none") return null;
  return trimmed;
}

function readBool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true || record[key] === "true";
}

function contactNeedsEmail(contact: BrokerContact): boolean {
  const sourceMetadata = readRecord(contact.sourceMetadata);
  const activitySummary = readRecord(contact.activitySummary);
  return (
    !cleanDisplayText(contact.normalizedEmail) ||
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

function responseStatusLabel(value: string | null | undefined): string {
  const match = BROKER_RESPONSE_OPTIONS.find((option) => option.value === value);
  return match?.label ?? labelFromKey(value ?? "none");
}

function propertyFlags(row: UiV2CrmPropertyRowPayload): Array<{ label: string; tone: "warning" | "danger" | "neutral" | "success" }> {
  const flags: Array<{ label: string; tone: "warning" | "danger" | "neutral" | "success" }> = [];
  if (!row.hasEmail) flags.push({ label: "Needs email", tone: "danger" });
  if (row.resolutionStatus === "multiple_candidates") flags.push({ label: "Choose primary", tone: "warning" });
  if (row.contact?.manualReviewOnly) flags.push({ label: "Manual review", tone: "warning" });
  if (row.response?.status === "unresponsive" || row.response?.status === "wrong_contact") {
    flags.push({ label: responseStatusLabel(row.response.status), tone: "danger" });
  } else if (row.response?.status === "inefficient") {
    flags.push({ label: "Inefficient", tone: "warning" });
  } else if (row.response?.status === "responded") {
    flags.push({ label: "Responded", tone: "success" });
  }
  if (row.uiV2Status === "rejected" || row.rejectedAt) flags.push({ label: "Rejected", tone: "neutral" });
  if (flags.length === 0) flags.push({ label: "Clear", tone: "neutral" });
  return flags;
}

function propertyFlagRank(row: UiV2CrmPropertyRowPayload): number {
  if (!row.hasEmail) return 0;
  if (row.response?.status === "unresponsive" || row.response?.status === "wrong_contact") return 1;
  if (row.resolutionStatus === "multiple_candidates" || row.response?.status === "inefficient" || row.contact?.manualReviewOnly) return 2;
  if (Number(row.openActionItemCount ?? 0) > 0) return 3;
  return 4;
}

function contactFlagRank(payload: UiV2CrmContactPayload): number {
  if (contactNeedsEmail(payload.contact)) return 0;
  if (payload.contact.manualReviewOnly) return 1;
  if (Number(payload.openActionItemCount ?? 0) > 0) return 2;
  return 3;
}

function normalizedKey(value: string | null | undefined): string {
  return cleanDisplayText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
}

function relatedPropertyIds(payload: UiV2CrmContactPayload): Set<string> {
  return new Set([
    ...(payload.relatedPropertyIds ?? []),
    ...(payload.relatedProperties ?? []).map((property) => property.propertyId),
  ].filter(Boolean));
}

function likelyDuplicateContact(left: UiV2CrmContactPayload, right: UiV2CrmContactPayload): boolean {
  const leftName = normalizedKey(left.contact.displayName);
  const rightName = normalizedKey(right.contact.displayName);
  const leftFirm = normalizedKey(displayBrokerFirm(left.contact));
  const rightFirm = normalizedKey(displayBrokerFirm(right.contact));
  const leftPhone = normalizedKey(left.contact.phone);
  const rightPhone = normalizedKey(right.contact.phone);
  if (leftName && leftName === rightName) return true;
  if (leftPhone && leftPhone === rightPhone) return true;
  if (leftFirm && leftFirm === rightFirm && leftName && rightName && (leftName.includes(rightName) || rightName.includes(leftName))) {
    return true;
  }
  const rightProperties = relatedPropertyIds(right);
  for (const propertyId of relatedPropertyIds(left)) {
    if (rightProperties.has(propertyId)) return true;
  }
  return false;
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

function normalizeBrokerContact(value: unknown): BrokerContact | null {
  const record = readRecord(value);
  const id = String(record.id ?? "");
  if (!id) return null;
  const now = new Date().toISOString();
  return {
    id,
    normalizedEmail: typeof record.normalizedEmail === "string"
      ? record.normalizedEmail
      : typeof record.normalized_email === "string"
        ? record.normalized_email
        : typeof record.email === "string"
          ? record.email.toLowerCase()
          : null,
    sourceKey: typeof record.sourceKey === "string" ? record.sourceKey : typeof record.source_key === "string" ? record.source_key : null,
    displayName: typeof record.displayName === "string"
      ? record.displayName
      : typeof record.display_name === "string"
        ? record.display_name
        : typeof record.name === "string"
          ? record.name
          : null,
    firm: typeof record.firm === "string" ? record.firm : null,
    phone: typeof record.phone === "string" ? record.phone : null,
    source: typeof record.source === "string" ? record.source : null,
    sourceMetadata: readRecord(record.sourceMetadata ?? record.source_metadata),
    preferredThreadId: typeof record.preferredThreadId === "string"
      ? record.preferredThreadId
      : typeof record.preferred_thread_id === "string"
        ? record.preferred_thread_id
        : null,
    lastOutreachAt: typeof record.lastOutreachAt === "string" ? record.lastOutreachAt : typeof record.last_outreach_at === "string" ? record.last_outreach_at : null,
    lastReplyAt: typeof record.lastReplyAt === "string" ? record.lastReplyAt : typeof record.last_reply_at === "string" ? record.last_reply_at : null,
    doNotContactUntil: typeof record.doNotContactUntil === "string"
      ? record.doNotContactUntil
      : typeof record.do_not_contact_until === "string"
        ? record.do_not_contact_until
        : null,
    manualReviewOnly: record.manualReviewOnly === true || record.manual_review_only === true,
    notes: typeof record.notes === "string" ? record.notes : null,
    activitySummary: readRecord(record.activitySummary ?? record.activity_summary),
    manualOverwrittenAt: typeof record.manualOverwrittenAt === "string"
      ? record.manualOverwrittenAt
      : typeof record.manual_overwritten_at === "string"
        ? record.manual_overwritten_at
        : null,
    manualOverwrittenBy: typeof record.manualOverwrittenBy === "string"
      ? record.manualOverwrittenBy
      : typeof record.manual_overwritten_by === "string"
        ? record.manual_overwritten_by
        : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : typeof record.created_at === "string" ? record.created_at : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : typeof record.updated_at === "string" ? record.updated_at : now,
  };
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
            contactEmail: typeof propertyRecord.contactEmail === "string" ? propertyRecord.contactEmail : null,
            isPrimary: propertyRecord.isPrimary === true,
            openActionItemCount: Number(propertyRecord.openActionItemCount ?? 0),
            lastActivityAt: typeof propertyRecord.lastActivityAt === "string" ? propertyRecord.lastActivityAt : null,
            uiV2Status: typeof propertyRecord.uiV2Status === "string" ? propertyRecord.uiV2Status : null,
            brokerResponseStatus:
              typeof propertyRecord.brokerResponseStatus === "string" ? propertyRecord.brokerResponseStatus : null,
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

function normalizeBrokerBlock(value: unknown): UiV2BrokerBlock | null {
  const record = readRecord(value);
  if (Object.keys(record).length === 0) return null;
  return {
    contactId: typeof record.contactId === "string" ? record.contactId : null,
    name: typeof record.name === "string" ? record.name : null,
    email: typeof record.email === "string" ? record.email : null,
    phone: typeof record.phone === "string" ? record.phone : null,
    firm: typeof record.firm === "string" ? record.firm : null,
    source: typeof record.source === "string" ? record.source : null,
    overwrittenAt: typeof record.overwrittenAt === "string" ? record.overwrittenAt : null,
    overwrittenBy: typeof record.overwrittenBy === "string" ? record.overwrittenBy : null,
    notes: typeof record.notes === "string" ? record.notes : null,
  };
}

function normalizeBrokerResponse(value: unknown): UiV2CrmBrokerResponsePayload | null {
  const record = readRecord(value);
  if (Object.keys(record).length === 0) return null;
  return {
    status: typeof record.status === "string" ? record.status : "none",
    note: typeof record.note === "string" ? record.note : null,
    recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : null,
    recordedBy: typeof record.recordedBy === "string" ? record.recordedBy : null,
    lastActivityAt: typeof record.lastActivityAt === "string" ? record.lastActivityAt : null,
  };
}

function normalizeCrmPropertyRowPayload(value: unknown): UiV2CrmPropertyRowPayload | null {
  const record = readRecord(value);
  const propertyId = String(record.propertyId ?? record.property_id ?? "");
  if (!propertyId) return null;
  const canonicalAddress = typeof record.canonicalAddress === "string"
    ? record.canonicalAddress
    : typeof record.canonical_address === "string"
      ? record.canonical_address
      : propertyId;
  const broker = normalizeBrokerBlock(record.broker);
  return {
    propertyId,
    canonicalAddress,
    displayAddress: typeof record.displayAddress === "string" ? record.displayAddress : typeof record.display_address === "string" ? record.display_address : null,
    uiV2Status: typeof record.uiV2Status === "string" ? record.uiV2Status : null,
    rejectedAt: typeof record.rejectedAt === "string" ? record.rejectedAt : null,
    broker,
    contact: normalizeBrokerContact(record.contact),
    resolutionStatus: typeof record.resolutionStatus === "string" ? record.resolutionStatus : null,
    candidateCount: Number(record.candidateCount ?? 0),
    hasEmail: record.hasEmail === true || Boolean(cleanDisplayText(broker?.email)),
    openActionItemCount: Number(record.openActionItemCount ?? 0),
    lastActivityAt: typeof record.lastActivityAt === "string" ? record.lastActivityAt : null,
    response: normalizeBrokerResponse(record.response),
  };
}

function normalizeCrmListPayload(payload: unknown): UiV2CrmListPayload {
  const root = readRecord(payload);
  const crm = readRecord(root.crm ?? payload);
  const contacts = Array.isArray(crm.contacts)
    ? crm.contacts.map(normalizeCrmContactPayload).filter(Boolean) as UiV2CrmContactPayload[]
    : [];
  const propertyRows = Array.isArray(crm.propertyRows)
    ? crm.propertyRows.map(normalizeCrmPropertyRowPayload).filter(Boolean) as UiV2CrmPropertyRowPayload[]
    : [];
  const summary = readRecord(crm.summary);
  return {
    contacts,
    propertyRows,
    total: Number(crm.total ?? summary.contacts ?? contacts.length),
    limit: Number(crm.limit ?? CRM_LIMIT),
    offset: Number(crm.offset ?? 0),
  };
}

function normalizeOutreachDraftListItem(value: unknown): UiV2OutreachDraftListItem | null {
  const record = readRecord(value);
  const id = String(record.id ?? "");
  if (!id) return null;
  return {
    id,
    propertyId: typeof record.propertyId === "string" ? record.propertyId : "",
    contactId: typeof record.contactId === "string" ? record.contactId : null,
    toAddress: typeof record.toAddress === "string" ? record.toAddress : "",
    subject: typeof record.subject === "string" ? record.subject : "",
    body: typeof record.body === "string" ? record.body : "",
    status: record.status === "failed" ? "failed" : "draft",
    followUpAt: typeof record.followUpAt === "string" ? record.followUpAt : null,
    templateId: typeof record.templateId === "string" ? record.templateId : null,
    templateName: typeof record.templateName === "string" ? record.templateName : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    canonicalAddress: typeof record.canonicalAddress === "string" ? record.canonicalAddress : null,
    displayAddress: typeof record.displayAddress === "string" ? record.displayAddress : null,
    contactName: typeof record.contactName === "string" ? record.contactName : null,
    reviewReason: typeof record.reviewReason === "string" ? record.reviewReason : null,
  };
}

function normalizeDraftListPayload(payload: unknown): UiV2OutreachDraftListPayload {
  const root = readRecord(payload);
  const drafts = Array.isArray(root.drafts)
    ? (root.drafts.map(normalizeOutreachDraftListItem).filter(Boolean) as UiV2OutreachDraftListItem[])
    : [];
  return {
    drafts,
    total: Number(root.total ?? drafts.length),
    limit: Number(root.limit ?? CRM_LIMIT),
    offset: Number(root.offset ?? 0),
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

function SortHeader({
  label,
  field,
  activeField,
  direction,
  onSort,
}: {
  label: string;
  field: CrmSortField;
  activeField: CrmSortField;
  direction: SortDirection;
  onSort: (field: CrmSortField) => void;
}) {
  const active = activeField === field;
  return (
    <button className={styles.sortHeaderButton} type="button" onClick={() => onSort(field)}>
      <span>{label}</span>
      <span aria-hidden="true">{active ? direction : ""}</span>
    </button>
  );
}

function CrmPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";

  const [searchText, setSearchText] = useState(query);
  const [contacts, setContacts] = useState<UiV2CrmContactPayload[]>([]);
  const [propertyRows, setPropertyRows] = useState<UiV2CrmPropertyRowPayload[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Page-level success confirmation for inline table actions (saves/records/rejects). */
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [viewMode, setViewMode] = useState<CrmViewMode>("properties");
  const [sortField, setSortField] = useState<CrmSortField>("flags");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [propertyLabels, setPropertyLabels] = useState<Record<string, string>>({});
  const [propertyDetail, setPropertyDetail] = useState<UiV2PropertyDetailPayload | null>(null);
  const [propertyBroker, setPropertyBroker] = useState<PropertyBrokerPayload | null>(null);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [brokerForm, setBrokerForm] = useState<BrokerFormState>(brokerToForm(null));
  const [inlineBrokerDrafts, setInlineBrokerDrafts] = useState<Record<string, BrokerFormState>>({});
  const [savingInlineBrokerId, setSavingInlineBrokerId] = useState<string | null>(null);
  const [savingBroker, setSavingBroker] = useState(false);
  const [responseDrafts, setResponseDrafts] = useState<Record<string, BrokerResponseDraft>>({});
  const [savingResponseId, setSavingResponseId] = useState<string | null>(null);
  const [rejectingPropertyId, setRejectingPropertyId] = useState<string | null>(null);
  /** Row pending reject confirmation — drives the ConfirmDialog popup. */
  const [rejectPrompt, setRejectPrompt] = useState<UiV2CrmPropertyRowPayload | null>(null);
  const [drafts, setDrafts] = useState<UiV2OutreachDraftListItem[]>([]);
  const [draftsTotal, setDraftsTotal] = useState(0);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftActionId, setDraftActionId] = useState<string | null>(null);
  /** Draft pending send confirmation — drives the ConfirmDialog popup. */
  const [sendDraftPrompt, setSendDraftPrompt] = useState<UiV2OutreachDraftListItem | null>(null);
  /** Draft pending dismiss confirmation — drives the ConfirmDialog popup. */
  const [dismissDraftPrompt, setDismissDraftPrompt] = useState<UiV2OutreachDraftListItem | null>(null);
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
  const [mergeDuplicateIds, setMergeDuplicateIds] = useState<string[]>([]);
  const [mergeSearchText, setMergeSearchText] = useState("");
  const [savingMerge, setSavingMerge] = useState(false);

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
        setPropertyRows(crm.propertyRows ?? []);
        setTotal(Number(crm.total ?? 0));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load CRM contacts.");
        setContacts([]);
        setPropertyRows([]);
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

  const loadDrafts = useCallback(async (signal?: AbortSignal) => {
    setDraftsLoading(true);
    try {
      const data = await apiFetch<UiV2OutreachDraftListPayload>(
        `/api/ui-v2/outreach-drafts?limit=${CRM_LIMIT}&offset=0`,
        { signal }
      );
      const payload = normalizeDraftListPayload(data);
      setDrafts(payload.drafts);
      setDraftsTotal(payload.total);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load outreach drafts.");
      setDrafts([]);
      setDraftsTotal(0);
    } finally {
      if (!signal?.aborted) setDraftsLoading(false);
    }
  }, []);

  // Fetched on mount (not just on tab switch) so the queue metric is populated immediately.
  useEffect(() => {
    const controller = new AbortController();
    void loadDrafts(controller.signal);
    return () => controller.abort();
  }, [loadDrafts]);

  useEffect(() => {
    const labelsFromPayload: Record<string, string> = {};
    for (const payload of contacts) {
      for (const property of payload.relatedProperties ?? []) {
        if (!property.propertyId) continue;
        labelsFromPayload[property.propertyId] = propertyLabelFromRelated(property, property.propertyId);
      }
    }
    for (const row of propertyRows) {
      labelsFromPayload[row.propertyId] =
        shortPropertyAddress(row.displayAddress) ?? shortPropertyAddress(row.canonicalAddress) ?? compactPropertyId(row.propertyId);
    }
    if (Object.keys(labelsFromPayload).length > 0) {
      setPropertyLabels((prev) => ({ ...prev, ...labelsFromPayload }));
    }
  }, [contacts, propertyRows]);

  const visiblePropertyIds = useMemo(
    () => [...new Set([...uniquePropertyIds(contacts), ...propertyRows.map((row) => row.propertyId)])].slice(0, PROPERTY_LABEL_PREFETCH_LIMIT),
    [contacts, propertyRows]
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
    const relatedProperties = propertyRows.length || uniquePropertyIds(contacts).length;
    return { needsEmail, manualReview, openActions, relatedProperties };
  }, [contacts, propertyRows]);

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

  const requestSort = useCallback((field: CrmSortField) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return currentField;
      }
      setSortDirection(field === "lastActivity" || field === "open" ? "desc" : "asc");
      return field;
    });
  }, []);

  const sortedPropertyRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...propertyRows].sort((left, right) => {
      let result = 0;
      if (sortField === "address") {
        result = (left.displayAddress ?? left.canonicalAddress).localeCompare(right.displayAddress ?? right.canonicalAddress);
      } else if (sortField === "broker") {
        result = displayBrokerBlockName(left.broker).localeCompare(displayBrokerBlockName(right.broker));
      } else if (sortField === "email") {
        result = (left.broker?.email ?? "").localeCompare(right.broker?.email ?? "");
      } else if (sortField === "flags") {
        result = propertyFlagRank(left) - propertyFlagRank(right);
      } else if (sortField === "open") {
        result = Number(left.openActionItemCount ?? 0) - Number(right.openActionItemCount ?? 0);
      } else if (sortField === "response") {
        result = responseStatusLabel(left.response?.status).localeCompare(responseStatusLabel(right.response?.status));
      } else {
        result = new Date(left.lastActivityAt ?? 0).getTime() - new Date(right.lastActivityAt ?? 0).getTime();
      }
      return result * direction;
    });
  }, [propertyRows, sortDirection, sortField]);

  const sortedContacts = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...contacts].sort((left, right) => {
      let result = 0;
      if (sortField === "address") {
        const leftAddress = relatedPropertyItems(left, propertyLabels)[0]?.label ?? "";
        const rightAddress = relatedPropertyItems(right, propertyLabels)[0]?.label ?? "";
        result = leftAddress.localeCompare(rightAddress);
      } else if (sortField === "broker") {
        result = displayBrokerName(left.contact).localeCompare(displayBrokerName(right.contact));
      } else if (sortField === "email") {
        result = (left.contact.normalizedEmail ?? "").localeCompare(right.contact.normalizedEmail ?? "");
      } else if (sortField === "flags") {
        result = contactFlagRank(left) - contactFlagRank(right);
      } else if (sortField === "open") {
        result = Number(left.openActionItemCount ?? 0) - Number(right.openActionItemCount ?? 0);
      } else {
        result = new Date(contactActivityAt(left) ?? 0).getTime() - new Date(contactActivityAt(right) ?? 0).getTime();
      }
      return result * direction;
    });
  }, [contacts, propertyLabels, sortDirection, sortField]);

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

  const openMergePanel = useCallback((contactPayload: UiV2CrmContactPayload, notice?: Notice) => {
    setComposer(null);
    setPropertyDetail(null);
    setPropertyBroker(null);
    setMergeDuplicateIds([]);
    setMergeSearchText("");
    setPanel({ type: "merge", contactPayload, notice });
  }, []);

  const openPropertyPanel = useCallback(
    (
      propertyId: string,
      contactPayload?: UiV2CrmContactPayload,
      notice?: Notice,
      options?: { composer?: boolean; followUp?: boolean; draftPrefill?: DraftFormState }
    ) => {
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
        draftPrefill: options?.draftPrefill,
      });
    },
    []
  );

  const updateInlineBrokerDraft = useCallback((propertyId: string, patch: Partial<BrokerFormState>) => {
    setInlineBrokerDrafts((current) => {
      const row = propertyRows.find((item) => item.propertyId === propertyId);
      const base = current[propertyId] ?? brokerToForm(row?.broker ?? null);
      return { ...current, [propertyId]: { ...base, ...patch } };
    });
  }, [propertyRows]);

  const updateResponseDraft = useCallback((propertyId: string, patch: Partial<BrokerResponseDraft>) => {
    setResponseDrafts((current) => {
      const row = propertyRows.find((item) => item.propertyId === propertyId);
      const base: BrokerResponseDraft = current[propertyId] ?? {
        status: row?.response?.status ?? "none",
        note: row?.response?.note ?? "",
      };
      return { ...current, [propertyId]: { ...base, ...patch } };
    });
  }, [propertyRows]);

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
    async (propertyId: string, prefill?: DraftFormState) => {
      setLoadingComposer(true);
      setComposer(null);
      try {
        const data = await apiFetch<OutreachComposerResponse>(
          `/api/ui-v2/properties/${encodeURIComponent(propertyId)}/outreach-composer`
        );
        const composerPayload = normalizeComposerPayload(data, propertyBroker?.broker);
        const toAddress = prefill?.toAddress || (cleanDisplayText(composerPayload.broker?.email) ?? "");
        if (!toAddress) {
          setPanelNotice({
            type: "info",
            message: "Add a broker email before drafting outreach for this property.",
          });
          return;
        }
        setComposer(composerPayload);
        setDraftForm(
          prefill ?? {
            toAddress,
            subject: composerPayload.subject,
            body: composerPayload.body,
            followUpAt: composerPayload.followUpAt ? toDateTimeLocal(new Date(composerPayload.followUpAt)) : "",
            templateId: "",
            templateName: "",
          }
        );
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
      const prefill = panel.draftPrefill;
      if (!prefill?.toAddress && !cleanDisplayText(propertyBroker.broker?.email)) {
        setPanel((current) =>
          current?.type === "property"
            ? {
                ...current,
                openComposer: false,
                draftPrefill: undefined,
                notice: { type: "info", message: "Add a broker email before drafting outreach for this property." },
              }
            : current
        );
        return;
      }
      setPanel((current) =>
        current?.type === "property" ? { ...current, openComposer: false, draftPrefill: undefined } : current
      );
      void loadComposer(panel.propertyId, prefill);
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

  const handleSaveInlineBroker = useCallback(
    async (row: UiV2CrmPropertyRowPayload) => {
      const draft = inlineBrokerDrafts[row.propertyId] ?? brokerToForm(row.broker);
      setSavingInlineBrokerId(row.propertyId);
      setPageNotice(null);
      try {
        await apiFetch<PropertyBrokerResponse>(
          `/api/ui-v2/properties/${encodeURIComponent(row.propertyId)}/broker`,
          {
            method: "PUT",
            body: JSON.stringify({
              name: draft.name.trim() || row.broker?.name || null,
              firm: draft.firm.trim() || row.broker?.firm || null,
              email: draft.email.trim() || row.broker?.email || null,
              phone: draft.phone.trim() || row.broker?.phone || null,
              notes: draft.notes.trim() || row.broker?.notes || null,
              actorName: "crm",
            }),
          }
        );
        setInlineBrokerDrafts((current) => {
          const next = { ...current };
          delete next[row.propertyId];
          return next;
        });
        setPageNotice(
          `Broker saved for ${shortPropertyAddress(row.displayAddress ?? row.canonicalAddress) ?? compactPropertyId(row.propertyId)}.`
        );
        await loadCrm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save broker for property.");
      } finally {
        setSavingInlineBrokerId(null);
      }
    },
    [inlineBrokerDrafts, loadCrm]
  );

  const handleSaveBrokerResponse = useCallback(
    async (row: UiV2CrmPropertyRowPayload) => {
      const draft = responseDrafts[row.propertyId] ?? {
        status: row.response?.status ?? "none",
        note: row.response?.note ?? "",
      };
      setSavingResponseId(row.propertyId);
      setPageNotice(null);
      try {
        await apiFetch<{ response: UiV2CrmBrokerResponsePayload }>(
          `/api/ui-v2/properties/${encodeURIComponent(row.propertyId)}/broker-response`,
          {
            method: "PUT",
            body: JSON.stringify({
              status: draft.status,
              note: draft.note.trim() || null,
              actorName: "crm",
            }),
          }
        );
        setResponseDrafts((current) => {
          const next = { ...current };
          delete next[row.propertyId];
          return next;
        });
        setPageNotice(
          `${responseStatusLabel(draft.status)} response recorded for ${shortPropertyAddress(row.displayAddress ?? row.canonicalAddress) ?? compactPropertyId(row.propertyId)}.`
        );
        await loadCrm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save broker response.");
      } finally {
        setSavingResponseId(null);
      }
    },
    [loadCrm, responseDrafts]
  );

  const handleRejectPropertyFromCrm = useCallback(
    async (row: UiV2CrmPropertyRowPayload) => {
      const draft = responseDrafts[row.propertyId] ?? {
        status: row.response?.status ?? "unresponsive",
        note: row.response?.note ?? "",
      };
      const note = draft.note.trim() || `Rejected from Broker CRM after ${responseStatusLabel(draft.status).toLowerCase()} broker response.`;
      const reasonCode =
        draft.status === "unresponsive" || draft.status === "none" || draft.status === "waiting"
          ? "broker_unresponsive"
          : draft.status === "wrong_contact" || draft.status === "inefficient"
            ? "data_quality_issue"
            : "other";
      setRejectingPropertyId(row.propertyId);
      setPageNotice(null);
      try {
        await apiFetch<PropertyDetailResponse>(`/api/ui-v2/properties/${encodeURIComponent(row.propertyId)}/reject`, {
          method: "POST",
          body: JSON.stringify({
            actorName: "crm",
            rejection: {
              reasonCode,
              note,
            },
          }),
        });
        setPageNotice(
          `Rejected ${shortPropertyAddress(row.displayAddress ?? row.canonicalAddress) ?? compactPropertyId(row.propertyId)} (${labelFromKey(reasonCode)}). The row stays visible with a Rejected flag.`
        );
        await loadCrm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reject property.");
      } finally {
        setRejectingPropertyId(null);
      }
    },
    [loadCrm, responseDrafts]
  );

  const handleMergeContacts = useCallback(
    async (primaryPayload: UiV2CrmContactPayload) => {
      if (mergeDuplicateIds.length === 0) {
        setPanelNotice({ type: "info", message: "Select at least one duplicate broker contact to merge." });
        return;
      }
      if (!window.confirm(`Merge ${mergeDuplicateIds.length} duplicate contact${mergeDuplicateIds.length === 1 ? "" : "s"} into ${displayBrokerName(primaryPayload.contact)}?`)) {
        return;
      }
      setSavingMerge(true);
      try {
        const data = await apiFetch<MergeResponse>("/api/ui-v2/crm/contacts/merge", {
          method: "POST",
          body: JSON.stringify({
            primaryContactId: primaryPayload.contact.id,
            duplicateContactIds: mergeDuplicateIds,
            actorName: "crm",
          }),
        });
        setMergeDuplicateIds([]);
        setPanelNotice({
          type: "success",
          message: `Merged ${data.merge.mergedCount} duplicate contact${data.merge.mergedCount === 1 ? "" : "s"} across ${data.merge.affectedPropertyCount} properties.`,
        });
        await loadCrm();
      } catch (err) {
        setPanelNotice({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to merge broker contacts.",
        });
      } finally {
        setSavingMerge(false);
      }
    },
    [loadCrm, mergeDuplicateIds, setPanelNotice]
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

  const handleSendQueuedDraft = useCallback(
    async (draft: UiV2OutreachDraftListItem) => {
      const address =
        shortPropertyAddress(draft.displayAddress) ?? shortPropertyAddress(draft.canonicalAddress) ?? draft.toAddress;
      const send = (force = false) =>
        apiFetch<UiV2OutreachSendNowPayload>(`/api/ui-v2/outreach-drafts/${encodeURIComponent(draft.id)}/send`, {
          method: "POST",
          body: JSON.stringify({ force }),
        });
      setDraftActionId(draft.id);
      setPageNotice(null);
      try {
        let data: UiV2OutreachSendNowPayload;
        try {
          data = await send(false);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to send outreach draft.";
          if (!message.includes("Use force") || !window.confirm(`${message} Send anyway?`)) throw err;
          data = await send(true);
        }
        setPageNotice(`Email sent to ${draft.toAddress} for ${address} at ${formatDateTime(data.sentAt)}.`);
        await Promise.all([loadDrafts(), loadCrm()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send outreach draft.");
        // A send-phase failure flips the row to "Send failed"; reload so it shows.
        await loadDrafts();
      } finally {
        setDraftActionId(null);
      }
    },
    [loadCrm, loadDrafts]
  );

  const handleDismissQueuedDraft = useCallback(
    async (draft: UiV2OutreachDraftListItem) => {
      const address =
        shortPropertyAddress(draft.displayAddress) ?? shortPropertyAddress(draft.canonicalAddress) ?? draft.toAddress;
      setDraftActionId(draft.id);
      setPageNotice(null);
      try {
        await apiFetch<{ ok: boolean }>(`/api/ui-v2/outreach-drafts/${encodeURIComponent(draft.id)}/dismiss`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        setPageNotice(`Draft for ${address} dismissed. No email was sent.`);
        await loadDrafts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to dismiss outreach draft.");
      } finally {
        setDraftActionId(null);
      }
    },
    [loadDrafts]
  );

  const reviewDraftInComposer = useCallback(
    (draft: UiV2OutreachDraftListItem) => {
      if (!draft.propertyId) return;
      // Re-saving from the composer creates a new queue row; dismiss this one after.
      openPropertyPanel(draft.propertyId, undefined, undefined, {
        composer: true,
        draftPrefill: {
          toAddress: draft.toAddress,
          subject: draft.subject,
          body: draft.body,
          followUpAt: draft.followUpAt ? toDateTimeLocal(new Date(draft.followUpAt)) : "",
          templateId: draft.templateId ?? "",
          templateName: draft.templateName ?? "",
        },
      });
    },
    [openPropertyPanel]
  );

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
    setMergeDuplicateIds([]);
    setMergeSearchText("");
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Broker CRM</p>
          <h1 className={styles.title}>Property contacts</h1>
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
            placeholder="Property, broker, firm, email, phone, notes"
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
        <div className={styles.metric}>
          <span className={styles.metricValue}>{draftsTotal}</span>
          <span className={styles.metricLabel}>Drafts queued</span>
        </div>
      </section>

      {error ? <div className={classNames(styles.notice, styles.noticeError)}>{error}</div> : null}
      {pageNotice ? <div className={classNames(styles.notice, styles.notice_success)}>{pageNotice}</div> : null}

      <section className={styles.tableShell}>
        <div className={styles.tableHeader}>
          <div>
            <strong>
              {viewMode === "drafts"
                ? draftsLoading
                  ? "Loading drafts"
                  : `${drafts.length} drafts shown`
                : loading
                  ? "Loading CRM"
                  : viewMode === "properties"
                    ? `${sortedPropertyRows.length} properties shown`
                    : `${sortedContacts.length} contacts shown`}
            </strong>
            <span>
              {viewMode === "drafts"
                ? "Sorted by newest"
                : query.trim()
                  ? `Filtered by "${query.trim()}"`
                  : `Sorted by ${sortField}`}
            </span>
          </div>
          <div className={styles.tableTools}>
            <div className={styles.segmentedControl} aria-label="CRM view">
              <button
                className={viewMode === "properties" ? styles.segmentActive : undefined}
                type="button"
                onClick={() => setViewMode("properties")}
              >
                Properties
              </button>
              <button
                className={viewMode === "contacts" ? styles.segmentActive : undefined}
                type="button"
                onClick={() => setViewMode("contacts")}
              >
                Contacts
              </button>
              <button
                className={viewMode === "drafts" ? styles.segmentActive : undefined}
                type="button"
                onClick={() => {
                  setViewMode("drafts");
                  void loadDrafts();
                }}
              >
                Drafts{draftsTotal > 0 ? ` (${draftsTotal})` : ""}
              </button>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                void loadCrm();
                void loadDrafts();
              }}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className={styles.tableScroll}>
          {viewMode === "properties" ? (
            <table className={classNames(styles.table, styles.propertyTable)}>
              <thead>
                <tr>
                  <th><SortHeader label="Property" field="address" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Primary broker" field="broker" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Email" field="email" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Response" field="response" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Last activity" field="lastActivity" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th className={styles.numericCell}><SortHeader label="Open" field="open" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Flags" field="flags" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      Loading property contacts...
                    </td>
                  </tr>
                ) : sortedPropertyRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      No properties match this search.
                    </td>
                  </tr>
                ) : (
                  sortedPropertyRows.map((row) => {
                    const flags = propertyFlags(row);
                    const brokerDraft = inlineBrokerDrafts[row.propertyId] ?? brokerToForm(row.broker);
                    const responseDraft = responseDrafts[row.propertyId] ?? {
                      status: row.response?.status ?? "none",
                      note: row.response?.note ?? "",
                    };
                    const addressLabel = shortPropertyAddress(row.displayAddress) ?? shortPropertyAddress(row.canonicalAddress) ?? compactPropertyId(row.propertyId);
                    return (
                      <tr key={row.propertyId}>
                        <td className={styles.brokerCell}>
                          <button
                            className={styles.linkButton}
                            type="button"
                            title={row.canonicalAddress}
                            onClick={() => openPropertyPanel(row.propertyId)}
                          >
                            {addressLabel}
                          </button>
                          <div className={styles.subtleLine}>{row.uiV2Status ? labelFromKey(row.uiV2Status) : row.canonicalAddress}</div>
                        </td>
                        <td>
                          <div className={styles.inlineBrokerGrid}>
                            <input
                              className={styles.inlineInput}
                              value={brokerDraft.name}
                              onChange={(event) => updateInlineBrokerDraft(row.propertyId, { name: event.target.value })}
                              placeholder="Broker name"
                            />
                            <input
                              className={styles.inlineInput}
                              value={brokerDraft.firm}
                              onChange={(event) => updateInlineBrokerDraft(row.propertyId, { firm: event.target.value })}
                              placeholder="Firm"
                            />
                          </div>
                        </td>
                        <td>
                          <div className={styles.inlineSaveGroup}>
                            <input
                              className={classNames(styles.inlineInput, !cleanDisplayText(brokerDraft.email) && styles.inlineInputWarning)}
                              value={brokerDraft.email}
                              onChange={(event) => updateInlineBrokerDraft(row.propertyId, { email: event.target.value })}
                              placeholder="broker@firm.com"
                            />
                            <button
                              className={styles.tableButton}
                              type="button"
                              onClick={() => void handleSaveInlineBroker(row)}
                              disabled={savingInlineBrokerId === row.propertyId}
                            >
                              {savingInlineBrokerId === row.propertyId ? "Saving" : "Save"}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div className={styles.responseCell}>
                            <select
                              className={styles.inlineSelect}
                              value={responseDraft.status}
                              onChange={(event) => updateResponseDraft(row.propertyId, { status: event.target.value })}
                            >
                              {BROKER_RESPONSE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <input
                              className={styles.inlineInput}
                              value={responseDraft.note}
                              onChange={(event) => updateResponseDraft(row.propertyId, { note: event.target.value })}
                              placeholder="Broker response notes"
                            />
                            <button
                              className={styles.tableButton}
                              type="button"
                              onClick={() => void handleSaveBrokerResponse(row)}
                              disabled={savingResponseId === row.propertyId}
                            >
                              {savingResponseId === row.propertyId ? "Saving" : "Record"}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div className={styles.activityLine}>
                            <span className={styles.cellStrong}>{relativeActivity(row.lastActivityAt)}</span>
                            {row.lastActivityAt ? <span>{formatDateTime(row.lastActivityAt)}</span> : null}
                          </div>
                        </td>
                        <td className={styles.numericCell}>
                          <span className={row.openActionItemCount ? styles.actionCountHot : styles.actionCount}>
                            {row.openActionItemCount ?? 0}
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
                            <button className={styles.tableButton} type="button" onClick={() => openPropertyPanel(row.propertyId, undefined, undefined, { composer: true })}>
                              Email
                            </button>
                            <button className={styles.tableButton} type="button" onClick={() => openPropertyPanel(row.propertyId, undefined, undefined, { followUp: true })}>
                              Follow-up
                            </button>
                            <button
                              className={styles.tableButtonDanger}
                              type="button"
                              onClick={() => setRejectPrompt(row)}
                              disabled={rejectingPropertyId === row.propertyId || row.uiV2Status === "rejected"}
                            >
                              {rejectingPropertyId === row.propertyId ? "Rejecting" : "Reject"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : viewMode === "contacts" ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th><SortHeader label="Broker" field="broker" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Contact" field="email" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Related properties" field="address" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Last activity" field="lastActivity" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th className={styles.numericCell}><SortHeader label="Open" field="open" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  <th><SortHeader label="Flags" field="flags" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
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
                ) : sortedContacts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={styles.emptyCell}>
                      No broker contacts match this search.
                    </td>
                  </tr>
                ) : (
                  sortedContacts.map((payload) => {
                    const { contact } = payload;
                    const flags = contactFlags(contact);
                    const related = relatedPropertyItems(payload, propertyLabels);
                    const email = cleanDisplayText(contact.normalizedEmail);
                    const phone = cleanDisplayText(contact.phone);
                    const firmLabel = displayBrokerFirm(contact);
                    const brokerSubline = [firmLabel, cleanDisplayText(contact.source)]
                      .filter((value): value is string => Boolean(value))
                      .join(" · ") || "Broker contact";
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
                          <div className={styles.subtleLine}>{brokerSubline}</div>
                        </td>
                        <td>
                          <div className={styles.contactLine}>
                            {email ? <span className={styles.contactItem}>{email}</span> : null}
                            {phone ? <span className={styles.contactItem}>{phone}</span> : null}
                            {!email && !phone ? (
                              <span className={styles.missingText}>Email needed</span>
                            ) : null}
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
                        <td className={styles.numericCell}>
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
                            <button className={styles.tableButton} type="button" onClick={() => openMergePanel(payload)}>
                              Merge
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {draftsLoading ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      Loading outreach drafts...
                    </td>
                  </tr>
                ) : drafts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      No outreach drafts waiting for review. Save a draft from a property&apos;s Email composer here or
                      in the Pipeline, and it will queue here before anything is sent.
                    </td>
                  </tr>
                ) : (
                  drafts.map((draft) => {
                    const addressLabel =
                      shortPropertyAddress(draft.displayAddress) ??
                      shortPropertyAddress(draft.canonicalAddress) ??
                      (draft.propertyId ? compactPropertyId(draft.propertyId) : "Property removed");
                    const busy = draftActionId === draft.id;
                    return (
                      <tr key={draft.id}>
                        <td className={styles.brokerCell}>
                          {draft.propertyId ? (
                            <button
                              className={styles.linkButton}
                              type="button"
                              title={draft.canonicalAddress ?? undefined}
                              onClick={() => openPropertyPanel(draft.propertyId)}
                            >
                              {addressLabel}
                            </button>
                          ) : (
                            <span>{addressLabel}</span>
                          )}
                          {draft.canonicalAddress ? (
                            <div className={styles.subtleLine}>{draft.canonicalAddress}</div>
                          ) : null}
                        </td>
                        <td>
                          <div>{draft.toAddress}</div>
                          {draft.contactName ? <div className={styles.subtleLine}>{draft.contactName}</div> : null}
                        </td>
                        <td>
                          <div title={draft.body}>{draft.subject}</div>
                          {draft.templateName ? <div className={styles.subtleLine}>{draft.templateName}</div> : null}
                        </td>
                        <td>{formatDateTime(draft.createdAt)}</td>
                        <td>
                          {draft.status === "failed" ? (
                            <span
                              className={classNames(styles.flag, styles.flag_danger)}
                              title={draft.reviewReason ?? undefined}
                            >
                              Send failed
                            </span>
                          ) : (
                            <span className={classNames(styles.flag, styles.flag_warning)}>Needs review</span>
                          )}
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <button
                              className={styles.tableButton}
                              type="button"
                              disabled={busy || !draft.propertyId}
                              onClick={() => setSendDraftPrompt(draft)}
                            >
                              {busy ? "Working" : "Send"}
                            </button>
                            <button
                              className={styles.tableButton}
                              type="button"
                              disabled={busy || !draft.propertyId}
                              onClick={() => reviewDraftInComposer(draft)}
                            >
                              Review in composer
                            </button>
                            <button
                              className={styles.tableButtonDanger}
                              type="button"
                              disabled={busy}
                              onClick={() => setDismissDraftPrompt(draft)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
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
                onMerge={() => openMergePanel(panel.contactPayload)}
              />
            ) : panel.type === "merge" ? (
              <MergePanel
                primaryPayload={panel.contactPayload}
                contacts={contacts}
                notice={panel.notice}
                propertyLabels={propertyLabels}
                selectedDuplicateIds={mergeDuplicateIds}
                setSelectedDuplicateIds={setMergeDuplicateIds}
                searchText={mergeSearchText}
                setSearchText={setMergeSearchText}
                saving={savingMerge}
                onMerge={() => void handleMergeContacts(panel.contactPayload)}
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

      <ConfirmDialog
        open={rejectPrompt != null}
        onClose={() => setRejectPrompt(null)}
        onConfirm={() => {
          const row = rejectPrompt;
          setRejectPrompt(null);
          if (row) void handleRejectPropertyFromCrm(row);
        }}
        title="Reject property"
        description={
          rejectPrompt
            ? `${rejectPrompt.displayAddress ?? rejectPrompt.canonicalAddress} comes off the active pipeline; the broker response note is kept as the rejection reason.`
            : undefined
        }
        confirmLabel="Reject"
        destructive
        busy={rejectPrompt != null && rejectingPropertyId === rejectPrompt.propertyId}
      />

      <ConfirmDialog
        open={sendDraftPrompt != null}
        onClose={() => setSendDraftPrompt(null)}
        onConfirm={() => {
          const draft = sendDraftPrompt;
          setSendDraftPrompt(null);
          if (draft) void handleSendQueuedDraft(draft);
        }}
        title="Send outreach email"
        description={
          sendDraftPrompt
            ? `Sends the saved draft to ${sendDraftPrompt.toAddress} via Gmail for ${
                shortPropertyAddress(sendDraftPrompt.displayAddress) ??
                shortPropertyAddress(sendDraftPrompt.canonicalAddress) ??
                "this property"
              }. This emails the broker immediately and cannot be undone.`
            : undefined
        }
        confirmLabel="Send email"
        busy={sendDraftPrompt != null && draftActionId === sendDraftPrompt.id}
      />

      <ConfirmDialog
        open={dismissDraftPrompt != null}
        onClose={() => setDismissDraftPrompt(null)}
        onConfirm={() => {
          const draft = dismissDraftPrompt;
          setDismissDraftPrompt(null);
          if (draft) void handleDismissQueuedDraft(draft);
        }}
        title="Dismiss draft"
        description={
          dismissDraftPrompt
            ? `Removes the draft for ${
                shortPropertyAddress(dismissDraftPrompt.displayAddress) ??
                shortPropertyAddress(dismissDraftPrompt.canonicalAddress) ??
                dismissDraftPrompt.toAddress
              } from the queue without sending. The record is kept for history.`
            : undefined
        }
        confirmLabel="Dismiss"
        destructive
        busy={dismissDraftPrompt != null && draftActionId === dismissDraftPrompt.id}
      />
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
  onMerge,
}: {
  payload: UiV2CrmContactPayload;
  notice?: Notice;
  propertyLabels: Record<string, string>;
  onOpenProperty: (propertyId: string) => void;
  onCompose: () => void;
  onFollowUp: () => void;
  onMerge: () => void;
}) {
  const { contact } = payload;
  const flags = contactFlags(contact);
  const related = relatedPropertyItems(payload, propertyLabels);
  const firmLabel = displayBrokerFirm(contact);
  const sourceLabel = cleanDisplayText(contact.source);

  return (
    <div className={styles.panelBody}>
      <p className={styles.eyebrow}>Contact</p>
      <h2 className={styles.panelTitle}>{displayBrokerName(contact)}</h2>
      <p className={styles.panelMeta}>{[firmLabel, sourceLabel || "crm"].filter(Boolean).join(" · ")}</p>
      {notice ? <div className={classNames(styles.notice, styles[`notice_${notice.type}`])}>{notice.message}</div> : null}

      <div className={styles.panelActions}>
        <button className={styles.primaryButton} type="button" onClick={onCompose}>
          Email
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onFollowUp}>
          Follow-up
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onMerge}>
          Merge
        </button>
      </div>

      <section className={styles.panelSection}>
        <h3>Contact details</h3>
        <dl className={styles.detailGrid}>
          <div>
            <dt>Email</dt>
            <dd className={cleanDisplayText(contact.normalizedEmail) ? undefined : styles.missingText}>
              {cleanDisplayText(contact.normalizedEmail) || "Needs email"}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd className={cleanDisplayText(contact.phone) ? undefined : styles.mutedValue}>
              {cleanDisplayText(contact.phone) || "No phone"}
            </dd>
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

function MergePanel({
  primaryPayload,
  contacts,
  notice,
  propertyLabels,
  selectedDuplicateIds,
  setSelectedDuplicateIds,
  searchText,
  setSearchText,
  saving,
  onMerge,
}: {
  primaryPayload: UiV2CrmContactPayload;
  contacts: UiV2CrmContactPayload[];
  notice?: Notice;
  propertyLabels: Record<string, string>;
  selectedDuplicateIds: string[];
  setSelectedDuplicateIds: (value: string[] | ((prev: string[]) => string[])) => void;
  searchText: string;
  setSearchText: (value: string) => void;
  saving: boolean;
  onMerge: () => void;
}) {
  const search = searchText.trim().toLowerCase();
  const candidates = contacts
    .filter((payload) => payload.contact.id !== primaryPayload.contact.id)
    .map((payload) => ({ payload, likely: likelyDuplicateContact(primaryPayload, payload) }))
    .filter(({ payload, likely }) => {
      if (!search) return likely;
      const related = relatedPropertyItems(payload, propertyLabels).map((property) => property.label).join(" ");
      const haystack = [
        displayBrokerName(payload.contact),
        displayBrokerFirm(payload.contact),
        payload.contact.normalizedEmail,
        payload.contact.phone,
        related,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => Number(right.likely) - Number(left.likely) || displayBrokerName(left.payload.contact).localeCompare(displayBrokerName(right.payload.contact)));

  const toggle = (contactId: string) => {
    setSelectedDuplicateIds((current) =>
      current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]
    );
  };

  return (
    <div className={styles.panelBody}>
      <p className={styles.eyebrow}>Merge contacts</p>
      <h2 className={styles.panelTitle}>{displayBrokerName(primaryPayload.contact)}</h2>
      <p className={styles.panelMeta}>Keep this broker as the primary record and merge duplicate rows into it.</p>
      {notice ? <div className={classNames(styles.notice, styles[`notice_${notice.type}`])}>{notice.message}</div> : null}

      <section className={styles.panelSection}>
        <h3>Primary record</h3>
        <div className={styles.brokerSummary}>
          <div>
            <strong>{displayBrokerName(primaryPayload.contact)}</strong>
            <span>
              {[primaryPayload.contact.normalizedEmail, primaryPayload.contact.phone, displayBrokerFirm(primaryPayload.contact)]
                .filter(Boolean)
                .join(" · ") || "No contact details"}
            </span>
          </div>
          <div className={styles.flagWrap}>
            {contactFlags(primaryPayload.contact).map((flag) => (
              <span key={flag.label} className={classNames(styles.flag, styles[`flag_${flag.tone}`])}>
                {flag.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.panelSection}>
        <div className={styles.sectionHeaderRow}>
          <h3>Duplicates</h3>
          <span className={styles.countText}>{selectedDuplicateIds.length} selected</span>
        </div>
        <input
          className={styles.searchInput}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search visible contacts"
        />
        <div className={styles.mergeList}>
          {candidates.map(({ payload, likely }) => {
            const related = relatedPropertyItems(payload, propertyLabels);
            return (
              <label key={payload.contact.id} className={styles.mergeItem}>
                <input
                  type="checkbox"
                  checked={selectedDuplicateIds.includes(payload.contact.id)}
                  onChange={() => toggle(payload.contact.id)}
                />
                <span>
                  <strong>{displayBrokerName(payload.contact)}</strong>
                  <small>
                    {[payload.contact.normalizedEmail, payload.contact.phone, displayBrokerFirm(payload.contact)]
                      .filter(Boolean)
                      .join(" · ") || "No contact details"}
                  </small>
                  <small>{related.slice(0, 3).map((property) => property.label).join(", ") || "No linked properties"}</small>
                </span>
                {likely ? <em>Likely</em> : null}
              </label>
            );
          })}
          {candidates.length === 0 ? <p className={styles.emptyNote}>No likely duplicates in the current result set. Search to find another contact.</p> : null}
        </div>
      </section>

      <div className={styles.formActions}>
        <button className={styles.primaryButton} type="button" onClick={onMerge} disabled={saving || selectedDuplicateIds.length === 0}>
          {saving ? "Merging..." : "Merge selected"}
        </button>
      </div>
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
  const brokerFirm = cleanDisplayText(broker?.firm);
  const brokerEmail = cleanDisplayText(broker?.email);
  const brokerPhone = cleanDisplayText(broker?.phone);
  const missingEmail = !brokerEmail;

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
                <span>
                  {[brokerFirm, brokerEmail, brokerPhone].filter(Boolean).join(" · ") || "No firm or contact details yet"}
                </span>
              </div>
              <div className={styles.flagWrap}>
                <span className={classNames(styles.flag, missingEmail ? styles.flag_danger : styles.flag_success)}>
                  {missingEmail ? "Needs email" : "Email ready"}
                </span>
                {broker?.source ? <span className={classNames(styles.flag, styles.flag_neutral)}>{broker.source}</span> : null}
              </div>
            </div>
          </section>

          {propertyBroker?.candidates?.length ? (
            <section className={styles.panelSection}>
              <h3>Sourced contacts</h3>
              <div className={styles.candidateList}>
                {propertyBroker.candidates.map((candidate, index) => (
                  <button
                    key={`${candidate.email ?? candidate.name ?? "candidate"}-${index}`}
                    className={styles.candidateButton}
                    type="button"
                    onClick={() =>
                      setBrokerForm((prev) => ({
                        ...prev,
                        name: candidate.name ?? "",
                        firm: candidate.firm ?? "",
                        email: candidate.email ?? "",
                        phone: candidate.phone ?? "",
                      }))
                    }
                  >
                    <span>{candidate.name || candidate.email || "Unnamed broker"}</span>
                    <small>{[candidate.email, candidate.phone, candidate.firm, candidate.source].filter(Boolean).join(" · ")}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

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
