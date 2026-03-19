"use client";

import React, { useEffect, useState } from "react";
import {
  deriveListingActivitySummary,
  describeListingActivity,
  type ListingActivitySummary,
  type PropertyManualSourceLinks,
  type RecipientContactCandidate,
  type RecipientResolution,
} from "@re-sourcing/contracts";
import {
  estimateGenerationProgress,
  getPropertyDossierAssumptions,
  getPropertyDossierGeneration,
  type LocalDossierJobState,
} from "./dossierState";
import { buildInquiryDraft } from "./inquiryDraft";
import { formatSourcingUpdateChange, getSourcingUpdate, getSourcingUpdateMeta } from "./sourcingUpdate";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/** OM status shown in canonical properties table. */
export type OmStatus = "OM received" | "OM pending" | "Not received";

export interface CanonicalProperty {
  id: string;
  canonicalAddress: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Present when listed with ?includeListingSummary=1 for filter/sort. */
  primaryListing?: {
    price: number | null;
    listedAt: string | null;
    city: string | null;
    lastActivity?: ListingActivitySummary | null;
  } | null;
  listingAgentEnrichment?: { name: string; firm?: string | null; email?: string | null; phone?: string | null }[] | null;
  /** OM status: from inquiry/uploaded docs and inquiry sends. */
  omStatus?: OmStatus | null;
  recipientContactName?: string | null;
  recipientContactEmail?: string | null;
  lastInquirySentAt?: string | null;
  /** Deal score 0–100 from latest deal_signals (when listed with includeListingSummary). */
  dealScore?: number | null;
}

/** Listing row shape returned by GET /api/properties/:id/listing */
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
  agentEnrichment?: { name: string; firm?: string | null; email?: string | null; phone?: string | null }[] | null;
  priceHistory?: { date: string; price: string | number; event: string }[] | null;
  rentalPriceHistory?: { date: string; price: string | number; event: string }[] | null;
  duplicateScore?: number | null;
  extra?: Record<string, unknown> | null;
  lastActivity?: ListingActivitySummary | null;
}

/** Unified row for violations/complaints/permits table */
interface UnifiedEnrichmentRow {
  date: string;
  category: string;
  info: string;
}

interface DossierSettingsDraft {
  renovationCosts: number | null;
  furnishingSetupCosts: number | null;
}

interface DossierAssumptionsResponse {
  defaults?: {
    renovationCosts?: number | null;
    furnishingSetupCosts?: number | null;
  } | null;
  formulaDefaults?: {
    renovationCosts?: number | null;
    furnishingSetupCosts?: number | null;
  } | null;
  mixSummary?: {
    eligibleResidentialUnits?: number | null;
    commercialUnits?: number | null;
    rentStabilizedUnits?: number | null;
  } | null;
}

interface RecipientResolutionResponse {
  recipientResolution?: RecipientResolution | null;
  error?: string;
  details?: string;
}

interface InquiryGuardHistoryRow {
  propertyId: string;
  canonicalAddress: string;
  sentAt: string;
}

interface InquiryGuardBrokerTeamRow extends InquiryGuardHistoryRow {
  sharedBrokers: string[];
}

interface InquiryGuardState {
  toAddress: string | null;
  lastInquirySentAt: string | null;
  hasOmDocument: boolean;
  sameRecipientSamePropertyAt: string | null;
  sameRecipientOtherProperties: InquiryGuardHistoryRow[];
  sameBrokerTeamOtherProperties: InquiryGuardBrokerTeamRow[];
}

interface BrokerEmailOption {
  email: string;
  name: string | null;
  firm: string | null;
}

function normalizePropertyManualSourceLinks(value: unknown): PropertyManualSourceLinks | null {
  if (!value || typeof value !== "object") return null;
  const links = value as Record<string, unknown>;
  const normalized: PropertyManualSourceLinks = {
    streetEasyUrl: typeof links.streetEasyUrl === "string" ? links.streetEasyUrl : null,
    omUrl: typeof links.omUrl === "string" ? links.omUrl : null,
    addedAt: typeof links.addedAt === "string" ? links.addedAt : null,
    omImportedAt: typeof links.omImportedAt === "string" ? links.omImportedAt : null,
    omDocumentId: typeof links.omDocumentId === "string" ? links.omDocumentId : null,
    omFileName: typeof links.omFileName === "string" ? links.omFileName : null,
  };
  if (
    !normalized.streetEasyUrl &&
    !normalized.omUrl &&
    !normalized.addedAt &&
    !normalized.omImportedAt &&
    !normalized.omDocumentId &&
    !normalized.omFileName
  ) {
    return null;
  }
  return normalized;
}

function normalizeInquiryGuardHistoryRows(value: unknown): InquiryGuardHistoryRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (
      typeof row.propertyId !== "string"
      || typeof row.canonicalAddress !== "string"
      || typeof row.sentAt !== "string"
    ) {
      return [];
    }
    return [{
      propertyId: row.propertyId,
      canonicalAddress: row.canonicalAddress,
      sentAt: row.sentAt,
    }];
  });
}

function normalizeInquiryGuardBrokerTeamRows(value: unknown): InquiryGuardBrokerTeamRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (
      typeof row.propertyId !== "string"
      || typeof row.canonicalAddress !== "string"
      || typeof row.sentAt !== "string"
    ) {
      return [];
    }
    return [{
      propertyId: row.propertyId,
      canonicalAddress: row.canonicalAddress,
      sentAt: row.sentAt,
      sharedBrokers: Array.isArray(row.sharedBrokers)
        ? row.sharedBrokers.filter((broker): broker is string => typeof broker === "string" && broker.trim().length > 0)
        : [],
    }];
  });
}

function normalizeInquiryGuardState(value: unknown): InquiryGuardState | null {
  if (!value || typeof value !== "object") return null;
  const guard = value as Record<string, unknown>;
  return {
    toAddress: typeof guard.toAddress === "string" ? guard.toAddress : null,
    lastInquirySentAt: typeof guard.lastInquirySentAt === "string" ? guard.lastInquirySentAt : null,
    hasOmDocument: Boolean(guard.hasOmDocument),
    sameRecipientSamePropertyAt: typeof guard.sameRecipientSamePropertyAt === "string" ? guard.sameRecipientSamePropertyAt : null,
    sameRecipientOtherProperties: normalizeInquiryGuardHistoryRows(guard.sameRecipientOtherProperties),
    sameBrokerTeamOtherProperties: normalizeInquiryGuardBrokerTeamRows(guard.sameBrokerTeamOtherProperties),
  };
}

function normalizeEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function brokerOptionFromCandidate(candidate: RecipientContactCandidate): BrokerEmailOption | null {
  const email = candidate.email?.trim();
  if (!email) return null;
  return {
    email,
    name: candidate.name?.trim() || null,
    firm: candidate.firm?.trim() || null,
  };
}

function findBrokerEmailOption(
  options: BrokerEmailOption[],
  email: string | null | undefined
): BrokerEmailOption | null {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedEmail) return null;
  return options.find((option) => normalizeEmailAddress(option.email) === normalizedEmail) ?? null;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Format price for history rows: no decimals when whole dollars. */
function formatPriceCompact(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[$,]/g, ""));
  if (Number.isNaN(n)) return "—";
  const opts = n % 1 === 0 ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...opts }).format(n);
}

/** Format YYYY-MM-DD or ISO date for display. */
function formatPriceHistoryDate(dateStr: string | null | undefined): string {
  if (!dateStr || typeof dateStr !== "string") return "—";
  const d = new Date(dateStr.trim().split("T")[0] + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Format NYC regulatory summary object as human-readable text (tax class, HPD, permits, complaints, violations, risk). */
function formatNycRegulatorySummary(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  if (obj.taxClass != null) parts.push(`Tax class: ${String(obj.taxClass)}`);
  if (obj.hpdRegistered != null) parts.push(`HPD registered: ${obj.hpdRegistered ? "Yes" : "No"}`);
  if (obj.recentPermits != null) parts.push(`Recent permits: ${Number(obj.recentPermits)}`);
  const openComplaints = obj.openComplaints ?? obj["open Complaints"];
  if (openComplaints != null) parts.push(`Open complaints: ${Number(openComplaints)}`);
  const openViolations = obj.openViolations ?? obj["open Violations"];
  if (openViolations != null) parts.push(`Open violations: ${Number(openViolations)}`);
  const risk = obj.regulatoryRiskSummary ?? obj["regulatory RiskSummary"];
  if (risk != null && String(risk).trim()) parts.push(`Risk: ${String(risk).trim()}`);
  return parts.length > 0 ? parts.join(". ") : JSON.stringify(obj);
}

/** Human-readable event label for price history. */
function formatPriceEventLabel(event: string | null | undefined): string {
  if (!event || typeof event !== "string") return "—";
  const lower = event.trim().toLowerCase().replace(/_/g, " ");
  if (!lower) return "—";
  return lower.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Title-case property type for display (e.g. "multi family" → "Multi Family"). */
function formatPropertyType(value: string | null | undefined | unknown): string {
  if (value == null || typeof value !== "string") return "—";
  const normalized = value.trim().replace(/_/g, " ").toLowerCase();
  if (!normalized) return "—";
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatListedDate(listedAt: string | null | undefined): string {
  if (!listedAt) return "—";
  const d = new Date(listedAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function normalizeUnitKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/\b(unit|apt|apartment|suite|ste)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isAggregateOmUnitLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value
    .toLowerCase()
    .replace(/[$#]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [
    "total",
    "unit total",
    "total income",
    "income total",
    "rent roll total",
    "total rent roll",
    "summary",
    "subtotal",
  ].includes(normalized);
}

function isPlaceholderOmRentRollRow(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (isAggregateOmUnitLabel(row.unit)) return false;
  const unitLabel =
    typeof row.unit === "string"
      ? row.unit
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
      : "";
  const note = [row.notes, row.note]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ");
  const hasStructuredDetails = [
    row.monthlyRent,
    row.annualRent,
    row.monthlyBaseRent,
    row.annualBaseRent,
    row.monthlyTotalRent,
    row.annualTotalRent,
    row.beds,
    row.baths,
    row.sqft,
    row.tenantName,
    row.leaseStartDate,
    row.leaseEndDate,
    row.lastRentedDate,
    row.dateVacant,
  ].some((entry) => entry != null && entry !== "");
  const genericUnit = /^unit \d+[a-z]?$/.test(unitLabel);
  return !hasStructuredDetails && (
    /placeholder|match stated unit count|does not provide a unit-level rent roll|rent tbd/i.test(note) ||
    genericUnit
  );
}

function findMatchingOmRentRollRow(
  unit: Record<string, unknown> | null | undefined,
  rentRoll: Array<Record<string, unknown>>
): Record<string, unknown> | null {
  const directKey = normalizeUnitKey(unit?.unit);
  if (!directKey) return null;
  const directMatch = rentRoll.find((row) => normalizeUnitKey(row.unit) === directKey);
  if (directMatch) return directMatch;

  const directDigits = directKey.replace(/[a-z]/g, "");
  if (!directDigits) return null;
  return (
    rentRoll.find((row) => {
      const rowKey = normalizeUnitKey(row.unit);
      return rowKey.replace(/[a-z]/g, "") === directDigits;
    }) ?? null
  );
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valuesClose(a: number | null, b: number | null, tolerance = 0.12): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return (high - low) / high <= tolerance;
}

function isSpecialOmUnitLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /(duplex|triplex|garden|parlor|penthouse|floor[- ]?through)/i.test(value);
}

function documentLooksLikeOm(doc: { fileName?: string | null; source?: string | null; sourceType?: string | null }): boolean {
  const haystack = [doc.fileName, doc.source].filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return false;
  return /(offering|memorandum|\bom\b|brochure|rent[\s_-]?roll)/i.test(haystack);
}

/** Normalize date strings to YYYY-MM-DD (strip time/timezone). */
function formatDateOnly(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  const datePart = trimmed.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  return d.toISOString().slice(0, 10);
}

function daysOnMarket(listedAt: string | null | undefined): number | null {
  if (!listedAt) return null;
  const d = new Date(listedAt);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function fullAddress(row: ListingRow): string {
  return [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ") || "—";
}

/** Normalize for DOS lookup: trim and collapse runs of whitespace so trailing spaces/weird syntax don't break matching. */
function normalizeBusinessNameForSearch(name: string | null | undefined): string {
  if (!name || typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ").trim();
}

/** True if the name looks like a corporation, LLC, limited partnership, or similar business entity. */
function isBusinessEntityName(name: string | null | undefined): boolean {
  const s = normalizeBusinessNameForSearch(name);
  if (!s) return false;
  const businessPattern = /\b(LLC|L\.?L\.?C\.?|Inc\.?|Incorporated|Corp\.?|Corporation|L\.?P\.?|Limited\s+Partnership|Ltd\.?|Co\.?|Company|P\.?C\.?|PLLC|P\.?L\.?L\.?C\.?)\s*$/i;
  return businessPattern.test(s);
}

/** NY DOS entity result from API (when owner is a business entity). */
interface NyDosEntityResult {
  filingDate: string | null;
  dosProcessName: string | null;
  dosProcessAddress: string | null;
  ceoName: string | null;
  ceoAddress: string | null;
  registeredAgentName: string | null;
  registeredAgentAddress: string | null;
}

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
  count,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div id={`canonical-section-${id}`} className="property-detail-section" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="property-detail-section-header"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`canonical-detail-${id}`}
      >
        <span className="property-detail-section-title-wrap">
          <span className="property-detail-section-title">{title}</span>
          {count != null && <span className="property-detail-section-count">{count}</span>}
        </span>
        <span className="property-detail-section-status">{open ? "Open" : "Closed"}</span>
        <span className={`property-detail-section-chevron ${open ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
      </button>
      {open && (
        <div id={`canonical-detail-${id}`} className="property-detail-section-body" role="region">
          {children}
        </div>
      )}
    </div>
  );
}

export function CanonicalPropertyDetail({
  property,
  isSaved,
  onSavedChange,
  dossierJob,
  onDossierJobChange,
  onDossierNotice,
  onRefreshPropertyData,
  onWorkflowActivity,
  autoOpenInquiryComposerNonce,
}: {
  property: CanonicalProperty;
  isSaved?: boolean;
  onSavedChange?: (propertyId: string, saved: boolean) => void;
  dossierJob?: LocalDossierJobState;
  onDossierJobChange?: (propertyId: string, job: LocalDossierJobState | null) => void;
  onDossierNotice?: (propertyId: string, notice: { type: "success" | "error"; message: string }) => void;
  onRefreshPropertyData?: () => void;
  onWorkflowActivity?: () => void;
  autoOpenInquiryComposerNonce?: number | null;
}) {
  const [primaryListing, setPrimaryListing] = useState<ListingRow | null | "loading">("loading");
  /** Fresh details from GET /api/properties/:id so enriched data (CO, zoning, HPD) is current after re-run. */
  const [detailsFromApi, setDetailsFromApi] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    dealDossier: true,
    photosFloorplans: true,
    detailsBrokerAmenitiesPriceHistory: true,
    owner: true,
    valuations: true,
    rentalOm: true,
    violationsComplaintsPermits: true,
  });
  const [unifiedRows, setUnifiedRows] = useState<UnifiedEnrichmentRow[]>([]);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedFetched, setUnifiedFetched] = useState(false);
  const [ownerFromPermits, setOwnerFromPermits] = useState<{ owner_name?: string; owner_business_name?: string } | null>(null);
  type UnifiedDoc = { id: string; fileName: string; fileType?: string | null; source: string; sourceType: "inquiry" | "uploaded" | "generated"; createdAt: string };
  const [unifiedDocuments, setUnifiedDocuments] = useState<UnifiedDoc[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [inquiryEmailModalOpen, setInquiryEmailModalOpen] = useState(false);
  const [inquiryDraft, setInquiryDraft] = useState<{ to: string; subject: string; body: string }>({ to: "", subject: "", body: "" });
  const [inquirySending, setInquirySending] = useState(false);
  const [inquirySendError, setInquirySendError] = useState<string | null>(null);
  const [inquirySendSuccess, setInquirySendSuccess] = useState<string | null>(null);
  const [inquiryGuardLoading, setInquiryGuardLoading] = useState(false);
  const [inquiryGuard, setInquiryGuard] = useState<InquiryGuardState | null>(null);
  const [lastInquirySentAt, setLastInquirySentAt] = useState<string | null>(property.lastInquirySentAt ?? null);
  const [recipientResolution, setRecipientResolution] = useState<RecipientResolution | null>(null);
  const [recipientResolutionLoading, setRecipientResolutionLoading] = useState(false);
  const [recipientOverrideDraft, setRecipientOverrideDraft] = useState("");
  const [recipientOverrideSaving, setRecipientOverrideSaving] = useState(false);
  const [recipientOverrideError, setRecipientOverrideError] = useState<string | null>(null);
  const [recipientOverrideNotice, setRecipientOverrideNotice] = useState<string | null>(null);
  const [manualInquiryModalOpen, setManualInquiryModalOpen] = useState(false);
  const [manualInquiryDraft, setManualInquiryDraft] = useState<{ to: string; sentAt: string }>({
    to: "",
    sentAt: new Date().toISOString().slice(0, 10),
  });
  const [manualInquirySaving, setManualInquirySaving] = useState(false);
  const [manualInquiryError, setManualInquiryError] = useState<string | null>(null);
  const [rentRollComparison, setRentRollComparison] = useState<{ comparable: boolean; totalUnitsRapid: number; totalUnitsOm: number; totalBedsRapid: number; totalBedsOm: number } | null>(null);
  const [dealScore, setDealScore] = useState<number | null>(null);
  const [calculatedDealScore, setCalculatedDealScore] = useState<number | null>(null);
  const [dealSignals, setDealSignals] = useState<Record<string, unknown> | null>(null);
  const [scoreOverride, setScoreOverride] = useState<{
    id: string;
    score: number;
    reason: string;
    createdAt: string;
    createdBy?: string | null;
  } | null>(null);
  const [scoreOverrideDraft, setScoreOverrideDraft] = useState<{ score: string; reason: string }>({
    score: "",
    reason: "",
  });
  const [scoreOverrideSaving, setScoreOverrideSaving] = useState(false);
  const [scoreOverrideError, setScoreOverrideError] = useState<string | null>(null);
  const [dossierDraft, setDossierDraft] = useState<DossierSettingsDraft>({
    renovationCosts: 0,
    furnishingSetupCosts: null,
  });
  const [savedDossierDraft, setSavedDossierDraft] = useState<DossierSettingsDraft>({
    renovationCosts: 0,
    furnishingSetupCosts: null,
  });
  const [formulaDossierDefaults, setFormulaDossierDefaults] = useState<DossierSettingsDraft>({
    renovationCosts: 0,
    furnishingSetupCosts: null,
  });
  const [dossierMixSummary, setDossierMixSummary] = useState<
    DossierAssumptionsResponse["mixSummary"]
  >(null);
  const [dossierSettingsLoading, setDossierSettingsLoading] = useState(true);
  const [dossierSettingsSaving, setDossierSettingsSaving] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [dossierGenerating, setDossierGenerating] = useState(false);
  const [authoritativeOmRefreshing, setAuthoritativeOmRefreshing] = useState(false);
  const hasAutoSavedRef = React.useRef(false);
  const lastAutoOpenInquiryNonceRef = React.useRef<number | null>(null);
  const [sendAnotherConfirm, setSendAnotherConfirm] = useState(false);
  const [dosEntityLoading, setDosEntityLoading] = useState(false);
  const [dosEntity, setDosEntity] = useState<NyDosEntityResult | "n/a" | null>(null);
  const [dosEntityQueryName, setDosEntityQueryName] = useState<string | null>(null);

  // Treat a document as OM-style only when the filename/source actually looks like OM, brochure, or rent roll content.
  const hasOmDocument = Boolean(
    unifiedDocuments?.some((d) => d.source === "OM" || d.source === "Brochure" || documentLooksLikeOm(d))
  );

  const applyPropertySnapshot = (data: Record<string, unknown> | null | undefined) => {
    if (data?.details != null) setDetailsFromApi(data.details as Record<string, unknown>);
    else setDetailsFromApi(null);
    setLastInquirySentAt((data?.lastInquirySentAt as string | null | undefined) ?? null);
    setRentRollComparison(
      (data?.rentRollComparison as {
        comparable: boolean;
        totalUnitsRapid: number;
        totalUnitsOm: number;
        totalBedsRapid: number;
        totalBedsOm: number;
      } | null | undefined) ?? null
    );
    setDealScore((data?.dealScore as number | null | undefined) ?? null);
    setCalculatedDealScore((data?.calculatedDealScore as number | null | undefined) ?? null);
    setDealSignals((data?.dealSignals as Record<string, unknown> | null | undefined) ?? null);
    setScoreOverride(
      (data?.scoreOverride as {
        id: string;
        score: number;
        reason: string;
        createdAt: string;
        createdBy?: string | null;
      } | null | undefined) ?? null
    );
  };

  const resetPropertySnapshot = () => {
    setDetailsFromApi(null);
    setRentRollComparison(null);
    setDealScore(null);
    setCalculatedDealScore(null);
    setDealSignals(null);
    setScoreOverride(null);
  };

  const refreshPropertySnapshot = async () => {
    const res = await fetch(`${API_BASE}/api/properties/${property.id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error((data?.error || data?.details || "Failed to refresh property") as string);
    applyPropertySnapshot(data as Record<string, unknown>);
  };

  const refreshRecipientResolution = async (options?: { keepDraft?: boolean }) => {
    setRecipientResolutionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/recipient-resolution`);
      const data: RecipientResolutionResponse = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error((data?.error || data?.details || "Failed to load broker recipient") as string);
      }
      const nextResolution = data.recipientResolution ?? null;
      setRecipientResolution(nextResolution);
      if (!options?.keepDraft) {
        setRecipientOverrideDraft((current) => {
          if (current.trim()) return current;
          return nextResolution?.status === "manual_override" ? nextResolution.contactEmail?.trim() || "" : "";
        });
      }
      return nextResolution;
    } finally {
      setRecipientResolutionLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setPrimaryListing("loading");
    fetch(`${API_BASE}/api/properties/${property.id}/listing`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setPrimaryListing(data.listing ?? null);
      })
      .catch(() => { if (!cancelled) setPrimaryListing(null); });
    return () => { cancelled = true; };
  }, [property.id]);

  // Refetch full property when expanded so enrichment (CO, zoning, HPD) shows latest after re-run
  useEffect(() => {
    hasAutoSavedRef.current = false;
    let cancelled = false;
    setDetailsFromApi(undefined);
    fetch(`${API_BASE}/api/properties/${property.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && !data?.error) {
          applyPropertySnapshot(data as Record<string, unknown>);
        } else if (!cancelled) {
          resetPropertySnapshot();
        }
      })
      .catch(() => {
        if (!cancelled) resetPropertySnapshot();
      });
    return () => { cancelled = true; };
  }, [property.id]);

  useEffect(() => {
    setLastInquirySentAt(property.lastInquirySentAt ?? null);
  }, [property.id, property.lastInquirySentAt]);

  useEffect(() => {
    let cancelled = false;
    setRecipientOverrideError(null);
    setRecipientOverrideNotice(null);
    setRecipientOverrideDraft("");
    refreshRecipientResolution()
      .catch((err) => {
        if (!cancelled) {
          setRecipientResolution(null);
          setRecipientOverrideError(err instanceof Error ? err.message : "Failed to load broker recipient");
          setRecipientOverrideDraft("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [property.id]);

  useEffect(() => {
    let cancelled = false;
    setDossierSettingsLoading(true);
    setDossierError(null);
    fetch(`${API_BASE}/api/dossier-assumptions?property_id=${encodeURIComponent(property.id)}`)
      .then((r) => r.json())
      .then((data: DossierAssumptionsResponse & { error?: string }) => {
        if (cancelled || data?.error) return;
        const nextDraft: DossierSettingsDraft = {
          renovationCosts: data.defaults?.renovationCosts ?? 0,
          furnishingSetupCosts: data.defaults?.furnishingSetupCosts ?? null,
        };
        setDossierDraft(nextDraft);
        setSavedDossierDraft(nextDraft);
        setFormulaDossierDefaults({
          renovationCosts: data.formulaDefaults?.renovationCosts ?? 0,
          furnishingSetupCosts: data.formulaDefaults?.furnishingSetupCosts ?? null,
        });
        setDossierMixSummary(data.mixSummary ?? null);
      })
      .catch(() => {
        if (!cancelled) setDossierError("Failed to load dossier defaults");
      })
      .finally(() => {
        if (!cancelled) setDossierSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [property.id]);

  useEffect(() => {
    if (openSections.violationsComplaintsPermits && !unifiedFetched && !unifiedLoading) {
      fetchUnifiedTable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when section is open and not yet fetched
  }, [openSections.violationsComplaintsPermits, unifiedFetched, unifiedLoading]);

  // Load documents when detail opens (for Downloads and for OM-based auto-compute of deal score)
  useEffect(() => {
    let cancelled = false;
    setUnifiedDocuments(null);
    fetch(`${API_BASE}/api/properties/${property.id}/documents`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.documents) setUnifiedDocuments(data.documents);
      })
      .catch(() => { if (!cancelled) setUnifiedDocuments([]); });
    return () => { cancelled = true; };
  }, [property.id]);

  useEffect(() => {
    if (!inquiryEmailModalOpen && !manualInquiryModalOpen) {
      setInquiryGuard(null);
      setInquiryGuardLoading(false);
      return;
    }
    const rawTo = inquiryEmailModalOpen ? inquiryDraft.to : manualInquiryDraft.to;
    const to = rawTo.trim();
    let cancelled = false;
    setInquiryGuardLoading(true);
    const query = to ? `?to=${encodeURIComponent(to)}` : "";
    fetch(`${API_BASE}/api/properties/${property.id}/inquiry-guard${query}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || data?.error) return;
        setInquiryGuard(normalizeInquiryGuardState(data));
        if (data.lastInquirySentAt != null) setLastInquirySentAt(data.lastInquirySentAt);
      })
      .catch(() => {
        if (!cancelled) setInquiryGuard(null);
      })
      .finally(() => {
        if (!cancelled) setInquiryGuardLoading(false);
      });
    return () => { cancelled = true; };
  }, [property.id, inquiryEmailModalOpen, manualInquiryModalOpen, inquiryDraft.to, manualInquiryDraft.to]);

  const saveScoreOverride = async () => {
    setScoreOverrideError(null);
    const score = Number(scoreOverrideDraft.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setScoreOverrideError("Override score must be between 0 and 100.");
      return;
    }
    if (!scoreOverrideDraft.reason.trim()) {
      setScoreOverrideError("Override reason is required.");
      return;
    }
    setScoreOverrideSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/score-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: Math.round(score),
          reason: scoreOverrideDraft.reason.trim(),
          createdBy: "web",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error((data?.error || data?.details || "Failed to save score override") as string);
      await refreshPropertySnapshot();
    } catch (err) {
      setScoreOverrideError(err instanceof Error ? err.message : "Failed to save score override");
    } finally {
      setScoreOverrideSaving(false);
    }
  };

  const clearScoreOverride = async () => {
    setScoreOverrideError(null);
    setScoreOverrideSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/score-override`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error((data?.error || data?.details || "Failed to clear score override") as string);
      await refreshPropertySnapshot();
    } catch (err) {
      setScoreOverrideError(err instanceof Error ? err.message : "Failed to clear score override");
    } finally {
      setScoreOverrideSaving(false);
    }
  };

  const saveRecipientOverride = async () => {
    const email = recipientOverrideDraft.trim().toLowerCase();
    if (!email) {
      setRecipientOverrideError("Broker email is required.");
      return;
    }
    const matchedOption = findBrokerEmailOption(brokerEmailOptions, email);
    setRecipientOverrideSaving(true);
    setRecipientOverrideError(null);
    setRecipientOverrideNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/recipient-resolution/manual`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: matchedOption?.name ?? null,
          firm: matchedOption?.firm ?? null,
        }),
      });
      const data: RecipientResolutionResponse = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error((data?.error || data?.details || "Failed to save broker recipient") as string);
      }
      const nextResolution = data.recipientResolution ?? null;
      const nextEmail = nextResolution?.contactEmail?.trim() || email;
      setRecipientResolution(nextResolution);
      setRecipientOverrideDraft(nextEmail);
      setInquiryDraft((prev) => ({ ...prev, to: nextEmail }));
      setManualInquiryDraft((prev) => ({ ...prev, to: nextEmail }));
      setRecipientOverrideNotice("Preferred broker email saved. Inquiry actions will use it first.");
      onRefreshPropertyData?.();
      onWorkflowActivity?.();
    } catch (err) {
      setRecipientOverrideError(err instanceof Error ? err.message : "Failed to save broker recipient");
    } finally {
      setRecipientOverrideSaving(false);
    }
  };

  const clearRecipientOverride = async () => {
    setRecipientOverrideSaving(true);
    setRecipientOverrideError(null);
    setRecipientOverrideNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/recipient-resolution/manual`, {
        method: "DELETE",
      });
      const data: RecipientResolutionResponse = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error((data?.error || data?.details || "Failed to clear broker recipient") as string);
      }
      const nextResolution = data.recipientResolution ?? null;
      const nextEmail = nextResolution?.contactEmail?.trim() || "";
      setRecipientResolution(nextResolution);
      setRecipientOverrideDraft("");
      setInquiryDraft((prev) => ({ ...prev, to: nextEmail }));
      setManualInquiryDraft((prev) => ({ ...prev, to: nextEmail }));
      setRecipientOverrideNotice("Manual broker email cleared. Inquiry actions will use sourced broker emails again.");
      onRefreshPropertyData?.();
      onWorkflowActivity?.();
    } catch (err) {
      setRecipientOverrideError(err instanceof Error ? err.message : "Failed to clear broker recipient");
    } finally {
      setRecipientOverrideSaving(false);
    }
  };

  // When OM is present and property is not saved, auto-save (star) the deal once
  useEffect(() => {
    if (
      unifiedDocuments == null ||
      !hasOmDocument ||
      isSaved === true ||
      hasAutoSavedRef.current ||
      !onSavedChange
    )
      return;
    hasAutoSavedRef.current = true;
    fetch(`${API_BASE}/api/profile/saved-deals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: property.id }),
    })
      .then((r) => {
        if (r.ok) onSavedChange(property.id, true);
      })
      .catch(() => {});
  }, [property.id, unifiedDocuments, hasOmDocument, isSaved, onSavedChange]);

  // When owner section has a business-like name (from owner module or permit data), fetch NY DOS entity details
  useEffect(() => {
    const d = (detailsFromApi != null && typeof detailsFromApi === "object" ? detailsFromApi : property.details) as Record<string, unknown> | null | undefined;
    const enrichment = d?.enrichment as Record<string, unknown> | undefined;
    const ps = enrichment?.permits_summary as Record<string, unknown> | undefined;
    const modName = d?.ownerModuleName ?? d?.owner_module_name;
    const modBiz = d?.ownerModuleBusiness ?? d?.owner_module_business;
    const permName = ps?.owner_name;
    const permBiz = ps?.owner_business_name;
    const candidates = [
      modBiz != null ? normalizeBusinessNameForSearch(String(modBiz)) : "",
      permBiz != null ? normalizeBusinessNameForSearch(String(permBiz)) : "",
      modName != null ? normalizeBusinessNameForSearch(String(modName)) : "",
      permName != null ? normalizeBusinessNameForSearch(String(permName)) : "",
    ].filter(Boolean);
    const businessName = candidates.find((c) => isBusinessEntityName(c)) ?? null;

    if (!businessName) {
      setDosEntityQueryName(null);
      setDosEntity("n/a");
      return;
    }
    if (businessName === dosEntityQueryName) return; // already fetched or loading for this name
    setDosEntityQueryName(businessName);
    setDosEntity(null);
    setDosEntityLoading(true);
    let cancelled = false;
    const controller = new AbortController();
    const timeoutMs = 25_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    fetch(`${API_BASE}/api/properties/ny-dos-entity?name=${encodeURIComponent(businessName)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDosEntity(data?.entity ?? "n/a");
      })
      .catch(() => { if (!cancelled) setDosEntity("n/a"); })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setDosEntityLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
      setDosEntityLoading(false);
    };
  }, [detailsFromApi, property.details, property.id, dosEntityQueryName]);

  const toggle = (key: string) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  const d = (detailsFromApi != null && typeof detailsFromApi === "object" ? detailsFromApi : property.details) as Record<string, unknown> | null | undefined;
  const persistedDossierAssumptions = getPropertyDossierAssumptions(d);
  const persistedDossierGeneration = getPropertyDossierGeneration(d);
  const enrichment = d?.enrichment as Record<string, unknown> | undefined;
  const ps = enrichment?.permits_summary as Record<string, unknown> | undefined;
  const bbl = d?.bbl ?? d?.BBL ?? d?.buildingLotBlock;
  const bblBase = d?.bblBase ?? d?.condoBaseBbl;
  const lat = d?.lat ?? d?.latitude;
  const lon = d?.lon ?? d?.longitude;
  const monthlyHoa = d?.monthlyHoa ?? d?.monthly_hoa;
  const monthlyTax = d?.monthlyTax ?? d?.monthly_tax;
  const manualSourceLinks = normalizePropertyManualSourceLinks(d?.manualSourceLinks);
  const ownerInfo = d?.ownerInfo ?? d?.owner_info;
  const ownerModuleName = d?.ownerModuleName ?? d?.owner_module_name ?? null;
  const ownerModuleBusiness = d?.ownerModuleBusiness ?? d?.owner_module_business ?? null;
  const omData = d?.omData as {
    authoritative?: {
      currentFinancials?: {
        noi?: number | null;
        grossRentalIncome?: number | null;
        otherIncome?: number | null;
        effectiveGrossIncome?: number | null;
        operatingExpenses?: number | null;
      } | null;
      rentRoll?: Array<{ unit?: string; monthlyRent?: number; annualRent?: number; beds?: number; baths?: number; sqft?: number; rentType?: string; tenantStatus?: string; notes?: string }> | null;
      expenses?: {
        expensesTable?: Array<{ lineItem?: string | null; amount?: number | null }> | null;
        totalExpenses?: number | null;
      } | null;
      validationFlags?: Array<{
        severity?: string | null;
        message?: string | null;
        field?: string | null;
        brokerValue?: unknown;
        externalValue?: unknown;
      }> | null;
    } | null;
  } | null | undefined;
  const rentalFinancials = d?.rentalFinancials as {
    rentalUnits?: Array<{ unit?: string | null; rentalPrice?: number | null; status?: string | null; sqft?: number | null; listedDate?: string | null; lastRentedDate?: string | null; beds?: number | null; baths?: number | null; images?: string[] | null; source?: string | null; streeteasyUrl?: string | null }> | null;
    fromLlm?: { noi?: number | null; capRate?: number | null; grossRentTotal?: number | null; totalExpenses?: number | null; expensesTable?: Array<{ lineItem: string; amount: number }> | null; rentalEstimates?: string | null; rentalNumbersPerUnit?: Array<{ unit?: string; monthlyRent?: number; annualRent?: number; rent?: number; beds?: number; baths?: number; sqft?: number; occupied?: boolean | string; lastRentedDate?: string; dateVacant?: string; note?: string }> | null; otherFinancials?: string | null; keyTakeaways?: string | null; dataGapSuggestions?: string | null } | null;
    omAnalysis?: {
      propertyInfo?: Record<string, unknown> | null;
      rentRoll?: Array<{ unit?: string; monthlyRent?: number; annualRent?: number; beds?: number; baths?: number; sqft?: number; rentType?: string; tenantStatus?: string; notes?: string }> | null;
      income?: Record<string, unknown> | null;
      expenses?: { expensesTable?: Array<{ lineItem: string; amount: number }>; totalExpenses?: number } | null;
      financialMetrics?: Record<string, unknown> | null;
      valuationMetrics?: Record<string, unknown> | null;
      underwritingMetrics?: Record<string, unknown> | null;
      nycRegulatorySummary?: Record<string, unknown> | null;
      furnishedModel?: Record<string, unknown> | null;
      investmentTakeaways?: string[] | null;
      recommendedOfferAnalysis?: Record<string, unknown> | null;
      uiFinancialSummary?: Record<string, unknown> | null;
      dossierMemo?: Record<string, string> | null;
    } | null;
    source?: string | null;
    lastUpdatedAt?: string | null;
  } | null | undefined;
  const rentalUnits = rentalFinancials?.rentalUnits ?? [];
  const authoritativeOm = omData?.authoritative ?? null;
  const authoritativeCurrentFinancials = authoritativeOm?.currentFinancials ?? null;
  const authoritativeExpenses = authoritativeOm?.expenses ?? null;
  const authoritativeExpensesTable = Array.isArray(authoritativeExpenses?.expensesTable)
    ? authoritativeExpenses.expensesTable
    : [];
  const authoritativeExpensesTotal =
    authoritativeExpenses?.totalExpenses ??
    (authoritativeExpensesTable.length > 0
      ? authoritativeExpensesTable.reduce((sum, row) => sum + (typeof row?.amount === "number" ? row.amount : 0), 0)
      : null);
  const authoritativeSummary =
    authoritativeOm != null
      ? {
          grossRent: authoritativeCurrentFinancials?.grossRentalIncome ?? null,
          otherIncome: authoritativeCurrentFinancials?.otherIncome ?? null,
          effectiveGrossIncome: authoritativeCurrentFinancials?.effectiveGrossIncome ?? null,
          _expenses: authoritativeExpensesTotal,
          noi: authoritativeCurrentFinancials?.noi ?? null,
        }
      : null;
  const authoritativeValidationMessages = Array.isArray(authoritativeOm?.validationFlags)
    ? authoritativeOm.validationFlags
        .map((flag) => {
          if (typeof flag?.message === "string" && flag.message.trim().length > 0) return flag.message.trim();
          const field = typeof flag?.field === "string" ? flag.field.trim() : "";
          const brokerValue = flag?.brokerValue == null ? "" : String(flag.brokerValue);
          const externalValue = flag?.externalValue == null ? "" : String(flag.externalValue);
          const compared = [brokerValue, externalValue].filter((value) => value.trim().length > 0).join(" vs ");
          if (field && compared) return `Verify ${field}: ${compared}`;
          if (field) return `Verify ${field}`;
          return "";
        })
        .filter((value): value is string => value.trim().length > 0)
    : [];
  const hasAuthoritativeOm = authoritativeOm != null;
  const omRentRollSource = authoritativeOm?.rentRoll;
  const omRentRoll = Array.isArray(omRentRollSource)
    ? omRentRollSource.filter(
        (row) => !isAggregateOmUnitLabel(row?.unit) && !isPlaceholderOmRentRollRow(row)
      )
    : [];
  const displayedExpenseTable = authoritativeExpensesTable;
  const displayedExpenseTotal = authoritativeExpensesTotal;
  const hasDisplayedOmPanel =
    hasAuthoritativeOm &&
    ((authoritativeSummary != null && Object.values(authoritativeSummary).some((value) => value != null)) ||
      omRentRoll.length > 0 ||
      displayedExpenseTable.length > 0 ||
      authoritativeValidationMessages.length > 0);
  const matchedOmIndexes = new Set<number>();
  const matchedMediaIndexes = new Set<number>();
  const matchedMediaByOmIndex = new Map<number, typeof rentalUnits[number]>();
  rentalUnits.forEach((row, mediaIndex) => {
    const financialRow = findMatchingOmRentRollRow(
      row as Record<string, unknown>,
      omRentRoll as Array<Record<string, unknown>>
    );
    if (financialRow) {
      const matchedIndex = omRentRoll.findIndex((candidate) => candidate === financialRow);
      if (matchedIndex >= 0 && !matchedMediaByOmIndex.has(matchedIndex)) {
        matchedOmIndexes.add(matchedIndex);
        matchedMediaIndexes.add(mediaIndex);
        matchedMediaByOmIndex.set(matchedIndex, row);
      }
    }
  });
  const unmatchedMediaIndexes = rentalUnits
    .map((_, index) => index)
    .filter((index) => !matchedMediaIndexes.has(index));
  const unmatchedOmIndexes = omRentRoll
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => !matchedOmIndexes.has(index))
    .map(({ index }) => index);
  if (unmatchedMediaIndexes.length === 1 && unmatchedOmIndexes.length === 1) {
    const mediaIndex = unmatchedMediaIndexes[0];
    const omIndex = unmatchedOmIndexes[0];
    const mediaRow = rentalUnits[mediaIndex] as Record<string, unknown> | undefined;
    const omRow = omRentRoll[omIndex] as Record<string, unknown> | undefined;
    const mediaRent = numericValue(mediaRow?.rentalPrice);
    const omRent = numericValue(omRow?.monthlyRent);
    const shouldPair =
      valuesClose(mediaRent, omRent) ||
      (isSpecialOmUnitLabel(omRow?.unit) && mediaIndex === rentalUnits.length - 1);
    if (shouldPair) {
      matchedOmIndexes.add(omIndex);
      matchedMediaIndexes.add(mediaIndex);
      matchedMediaByOmIndex.set(omIndex, rentalUnits[mediaIndex]!);
    }
  }
  const unmatchedMediaCount = Math.max(0, rentalUnits.length - matchedMediaIndexes.size);
  const displayRentalCards =
    omRentRoll.length > 0
      ? omRentRoll.map((row, index) => ({
          mediaRow: matchedMediaByOmIndex.get(index) ?? null,
          financialRow: row,
        }))
      : rentalUnits.map((row) => ({ mediaRow: row, financialRow: null }));
  const rentalUnitsHeading =
    omRentRoll.length > 0 ? "Rental units and listing media" : "Rental units (from Streeteasy / inquiry)";
  const rentalUnitsCopy =
    omRentRoll.length > 0
      ? unmatchedMediaCount > 0
        ? `OM rent-roll rows are primary. StreetEasy links and photos are attached only when a listing can be matched; ${unmatchedMediaCount} external listing${unmatchedMediaCount === 1 ? "" : "s"} could not be reconciled to the OM and were omitted from the merged unit view.`
        : "OM rent-roll rows are primary. StreetEasy links and photos stay attached when a listing can be matched."
      : "Per-unit listing and inquiry data pulled from Streeteasy / RapidAPI.";
  const financialsHeading =
    hasAuthoritativeOm
      ? "Authoritative OM snapshot"
      : "Authoritative OM snapshot unavailable";
  const financialsCopy =
    hasAuthoritativeOm
      ? "Promoted broker-reported OM data currently feeding dossier calculations. Placeholder rows and fallback values are excluded from totals."
      : "No promoted OM snapshot is available. Legacy OM extraction is intentionally excluded from this view and from calculations.";
  const ownerValuations = (d?.ownerValuations ?? d?.owner_valuations) as string | null | undefined;
  const assessedMarketValue = (d?.assessedMarketValue ?? d?.assessed_market_value) as number | null | undefined;
  const assessedActualValue = (d?.assessedActualValue ?? d?.assessed_actual_value) as number | null | undefined;
  const assessedTaxBeforeTotal = (d?.assessedTaxBeforeTotal ?? d?.assessed_tax_before_total) as number | null | undefined;
  const assessedGrossSqft = (d?.assessedGrossSqft ?? d?.assessed_gross_sqft) as number | null | undefined;
  const assessedLandArea = (d?.assessedLandArea ?? d?.assessed_land_area) as number | null | undefined;
  const assessedResidentialAreaGross = (d?.assessedResidentialAreaGross ?? d?.assessed_residential_area_gross) as number | null | undefined;
  const assessedOfficeAreaGross = (d?.assessedOfficeAreaGross ?? d?.assessed_office_area_gross) as number | null | undefined;
  const assessedRetailAreaGross = (d?.assessedRetailAreaGross ?? d?.assessed_retail_area_gross) as number | null | undefined;
  const assessedApptDate = (d?.assessedApptDate ?? d?.assessed_appt_date) as string | null | undefined;
  const assessedExtractDate = (d?.assessedExtractDate ?? d?.assessed_extract_date) as string | null | undefined;
  const isDossierDirty =
    (dossierDraft.renovationCosts ?? 0) !== (savedDossierDraft.renovationCosts ?? 0) ||
    (dossierDraft.furnishingSetupCosts ?? null) !== (savedDossierDraft.furnishingSetupCosts ?? null);
  const isDossierBusy =
    dossierGenerating ||
    authoritativeOmRefreshing ||
    dossierSettingsSaving ||
    dossierJob?.status === "running" ||
    persistedDossierGeneration?.status === "running";
  const showDossierProgress =
    dossierGenerating ||
    dossierJob?.status === "running" ||
    persistedDossierGeneration?.status === "running";
  const activeDossierProgressPct =
    dossierJob?.status === "running"
      ? dossierJob.progressPct
      : persistedDossierGeneration?.status === "running"
        ? Math.max(8, estimateGenerationProgress(Date.now() - new Date(persistedDossierGeneration.startedAt ?? Date.now()).getTime()))
        : 0;
  const activeDossierStageLabel =
    dossierJob?.status === "running"
      ? dossierJob.stageLabel
      : persistedDossierGeneration?.stageLabel ?? "Not started";

  const fetchUnifiedTable = () => {
    if (unifiedFetched) return;
    setUnifiedLoading(true);
    const base = `${API_BASE}/api/properties/${property.id}/enrichment`;
    Promise.all([
      fetch(`${base}/permits`).then((r) => r.json()).then((data) => data.permits ?? []),
      fetch(`${base}/violations`).then((r) => r.json()).then((data) => data.violations ?? []),
      fetch(`${base}/complaints`).then((r) => r.json()).then((data) => data.complaints ?? []),
      fetch(`${base}/litigations`).then((r) => r.json()).then((data) => data.litigations ?? []),
    ])
      .then(([permits, violations, complaints, litigations]) => {
        const rows: UnifiedEnrichmentRow[] = [];
        let firstOwner: { owner_name?: string; owner_business_name?: string } | null = null;
        for (const p of permits as Record<string, unknown>[]) {
          const n = p.normalizedJson as Record<string, unknown> | undefined;
          const raw = p.rawJson as Record<string, unknown> | undefined;
          const date = (p.approvedDate ?? p.approved_date ?? p.issuedDate ?? p.issued_date ?? n?.approvedDate ?? n?.issuedDate ?? "") as string;
          const workType = (n?.workType ?? n?.work_type ?? p.workPermit ?? p.work_permit ?? raw?.work_type ?? "") as string;
          const status = (n?.status ?? p.status ?? "") as string;
          const jobDesc = (n?.jobDescription ?? n?.job_description ?? raw?.job_description ?? "") as string;
          const infoParts = [workType, status, jobDesc].filter(Boolean);
          rows.push({ date: formatDateOnly(date) || "—", category: "Permit", info: infoParts.join(" · ") || "—" });
          if (!firstOwner && (raw || n)) {
            const r = raw ?? n ?? {};
            const on = (r.owner_name ?? r.owner_business_name) ? { owner_name: String(r.owner_name ?? "").trim() || undefined, owner_business_name: String(r.owner_business_name ?? "").trim() || undefined } : null;
            if (on && (on.owner_name || on.owner_business_name)) firstOwner = on;
          }
        }
        setOwnerFromPermits(firstOwner);
        for (const v of violations as Record<string, unknown>[]) {
          const n = v.normalizedJson as Record<string, unknown> | undefined;
          const raw = v.rawJson as Record<string, unknown> | undefined;
          const date = (n?.approvedDate ?? "") as string;
          const cls = (n?.class ?? "") as string;
          const status = (n?.currentStatus ?? n?.current_status ?? "") as string;
          const desc = (n?.novDescription ?? n?.nov_description ?? raw?.novdescription ?? raw?.nov_description ?? "") as string;
          rows.push({ date: formatDateOnly(date) || "—", category: "HPD Violation", info: [cls, status, desc].filter(Boolean).join(" · ") || "—" });
        }
        for (const c of complaints as Record<string, unknown>[]) {
          const n = c.normalizedJson as Record<string, unknown> | undefined;
          const raw = c.rawJson as Record<string, unknown> | undefined;
          const date = (n?.dateEntered ?? n?.date_entered ?? raw?.date_entered ?? "") as string;
          const cat = (n?.complaintCategory ?? n?.complaint_category ?? raw?.complaint_category ?? "") as string;
          const status = (n?.status ?? raw?.status ?? "") as string;
          const unit = (n?.unit ?? raw?.unit ?? "") as string;
          const disposition = (n?.dispositionCode ?? n?.disposition_code ?? raw?.disposition_code ?? "") as string;
          const infoParts = [cat, disposition, status, unit].filter(Boolean);
          rows.push({ date: formatDateOnly(date) || "—", category: "DOB Complaint", info: infoParts.join(" · ") || "—" });
        }
        for (const l of litigations as Record<string, unknown>[]) {
          const n = l.normalizedJson as Record<string, unknown> | undefined;
          const date = (n?.findingDate ?? n?.finding_date ?? "") as string;
          const caseType = (n?.caseType ?? n?.case_type ?? "") as string;
          const status = (n?.caseStatus ?? n?.case_status ?? "") as string;
          rows.push({ date: formatDateOnly(date) || "—", category: "Housing Litigation", info: [caseType, status].filter(Boolean).join(" · ") || "—" });
        }
        rows.sort((a, b) => (b.date === "—" ? -1 : a.date === "—" ? 1 : b.date.localeCompare(a.date)));
        setUnifiedRows(rows);
        setUnifiedFetched(true);
      })
      .finally(() => setUnifiedLoading(false));
  };

  const persistDossierSettings = async (
    nextDraft: DossierSettingsDraft = dossierDraft
  ): Promise<DossierSettingsDraft> => {
    const payload: DossierSettingsDraft = {
      renovationCosts: nextDraft.renovationCosts ?? 0,
      furnishingSetupCosts: nextDraft.furnishingSetupCosts ?? null,
    };
    setDossierSettingsSaving(true);
    setDossierError(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/dossier-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : data?.details ?? "Failed to save dossier settings");
      }
      setSavedDossierDraft(payload);
      setDossierDraft(payload);
      setDetailsFromApi((prev) => {
        const base = ((prev ?? d ?? {}) as Record<string, unknown>) ?? {};
        const dealDossier = ((base.dealDossier as Record<string, unknown> | undefined) ?? {});
        return {
          ...base,
          dealDossier: {
            ...dealDossier,
            assumptions: {
              renovationCosts: payload.renovationCosts,
              furnishingSetupCosts: payload.furnishingSetupCosts,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
      return payload;
    } finally {
      setDossierSettingsSaving(false);
    }
  };

  const handleRefreshAuthoritativeOm = async () => {
    if (authoritativeOmRefreshing || !hasOmDocument) return;
    try {
      setAuthoritativeOmRefreshing(true);
      setDossierError(null);
      onWorkflowActivity?.();

      const res = await fetch(`${API_BASE}/api/properties/${property.id}/refresh-om-financials`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to build authoritative OM"
        );
      }

      await Promise.all([
        refreshPropertySnapshot().catch(() => {}),
        fetch(`${API_BASE}/api/properties/${property.id}/documents`)
          .then((r) => r.json())
          .then((docs) => setUnifiedDocuments(docs?.documents ?? []))
          .catch(() => {}),
      ]);

      onRefreshPropertyData?.();
      onWorkflowActivity?.();
      onDossierNotice?.(property.id, {
        type: "success",
        message: `Authoritative OM ready for ${property.canonicalAddress}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build authoritative OM";
      setDossierError(message);
      onDossierNotice?.(property.id, {
        type: "error",
        message: `Authoritative OM refresh failed for ${property.canonicalAddress}: ${message}`,
      });
      onWorkflowActivity?.();
    } finally {
      setAuthoritativeOmRefreshing(false);
    }
  };

  const handleGenerateDossier = async () => {
    if (dossierGenerating) return;
    if (!hasAuthoritativeOm) {
      setDossierError("Generate dossier requires a promoted authoritative OM snapshot. Build the authoritative OM first.");
      return;
    }
    try {
      const savedDraft = await persistDossierSettings();
      const startedAt = Date.now();
      setDossierGenerating(true);
      onDossierJobChange?.(property.id, {
        status: "running",
        startedAt,
        progressPct: 3,
        stageLabel: "Preparing property inputs",
        notice: null,
      });
      onWorkflowActivity?.();
      setDossierError(null);

      const res = await fetch(`${API_BASE}/api/dossier/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: property.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to generate dossier"
        );
      }

      await Promise.all([
        refreshPropertySnapshot().catch(() => {}),
        fetch(`${API_BASE}/api/properties/${property.id}/documents`)
          .then((r) => r.json())
          .then((docs) => setUnifiedDocuments(docs?.documents ?? []))
          .catch(() => {}),
      ]);

      setSavedDossierDraft(savedDraft);
      setDossierGenerating(false);
      onDossierJobChange?.(property.id, {
        status: "completed",
        startedAt,
        progressPct: 100,
        stageLabel: "Dossier ready",
        notice: "PDF + Excel saved",
      });
      onRefreshPropertyData?.();
      onWorkflowActivity?.();
      onDossierNotice?.(property.id, {
        type: "success",
        message: `Dossier complete for ${property.canonicalAddress}. PDF and Excel are now in Documents.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate dossier";
      setDossierGenerating(false);
      setDossierError(message);
      onDossierJobChange?.(property.id, {
        status: "failed",
        startedAt: dossierJob?.startedAt ?? Date.now(),
        progressPct: activeDossierProgressPct || 0,
        stageLabel: "Generation failed",
        notice: message,
      });
      onDossierNotice?.(property.id, {
        type: "error",
        message: `Dossier failed for ${property.canonicalAddress}: ${message}`,
      });
      onWorkflowActivity?.();
    }
  };

  const hasListing = primaryListing && primaryListing !== "loading";
  const listingForDisplay = hasListing ? primaryListing : null;
  const listingAgents = listingForDisplay?.agentEnrichment ?? [];
  const listingAgentSource = listingAgents.length > 0 ? listingAgents : (property.listingAgentEnrichment ?? []);
  const brokerEmailOptionMap = new Map<string, BrokerEmailOption>();
  for (const candidate of recipientResolution?.candidateContacts ?? []) {
    const option = brokerOptionFromCandidate(candidate);
    if (!option) continue;
    const key = option.email.toLowerCase();
    if (!brokerEmailOptionMap.has(key)) brokerEmailOptionMap.set(key, option);
  }
  for (const agent of listingAgentSource) {
    const email = agent.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (!brokerEmailOptionMap.has(key)) {
      brokerEmailOptionMap.set(key, {
        email,
        name: agent.name?.trim() || null,
        firm: agent.firm?.trim() || null,
      });
    }
  }
  const brokerEmailOptions = [...brokerEmailOptionMap.values()];
  const primaryBroker = brokerEmailOptions[0] ?? null;
  const usingManualRecipientOverride = recipientResolution?.status === "manual_override";
  const preferredRecipientEmail =
    recipientResolution?.contactEmail?.trim() || property.recipientContactEmail?.trim() || primaryBroker?.email || "";
  const preferredRecipientOption = findBrokerEmailOption(brokerEmailOptions, preferredRecipientEmail);
  const preferredInquiryRecipient = {
    email: preferredRecipientEmail,
    name: preferredRecipientOption?.name ?? property.recipientContactName?.trim() ?? primaryBroker?.name ?? null,
    firm: preferredRecipientOption?.firm ?? null,
  };
  const inquiryNeedsOverride = Boolean(
    lastInquirySentAt ||
    inquiryGuard?.sameRecipientSamePropertyAt ||
    (inquiryGuard?.sameRecipientOtherProperties.length ?? 0) > 0 ||
    (inquiryGuard?.sameBrokerTeamOtherProperties.length ?? 0) > 0
  );
  const extra = listingForDisplay?.extra as Record<string, unknown> | undefined;
  const listingActivity = listingForDisplay
    ? (listingForDisplay.lastActivity ?? deriveListingActivitySummary({
        listedAt: listingForDisplay.listedAt ?? null,
        currentPrice: listingForDisplay.price ?? null,
        priceHistory: listingForDisplay.priceHistory ?? null,
      }))
    : null;
  const listingActivitySummary = describeListingActivity(listingActivity);
  const photoUrls = (listingForDisplay?.imageUrls?.length ? listingForDisplay.imageUrls : Array.isArray(extra?.images) ? (extra!.images as string[]).filter((u): u is string => typeof u === "string") : []) ?? [];
  const floorplanUrls = (Array.isArray(extra?.floorplans) ? (extra.floorplans as string[]).filter((u): u is string => typeof u === "string") : []) ?? [];
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [unitGalleryIndices, setUnitGalleryIndices] = useState<Record<number, number>>({});
  const sectionLinks = [
    { id: "deal-dossier", label: "Dossier", open: !!openSections.dealDossier },
    { id: "photos-floorplans", label: "Media", open: !!openSections.photosFloorplans },
    { id: "details-broker-amenities-price-history", label: "Listing", open: !!openSections.detailsBrokerAmenitiesPriceHistory },
    { id: "owner", label: "Owner", open: !!openSections.owner },
    { id: "valuations", label: "Valuations", open: !!openSections.valuations },
    { id: "rental-om", label: "Rental / OM", open: !!openSections.rentalOm },
    { id: "violations-complaints-permits", label: "Issues", open: !!openSections.violationsComplaintsPermits },
  ];
  const sourcingUpdate = getSourcingUpdate(d);
  const sourcingUpdateMeta = getSourcingUpdateMeta(d);
  const overviewItems = [
    { label: "Saved search", value: sourcingUpdateMeta.label },
    { label: "OM status", value: property.omStatus ?? "—" },
    { label: "Deal score", value: dealScore != null ? `${dealScore}/100` : "Pending" },
    { label: "Documents", value: unifiedDocuments == null ? "…" : String(unifiedDocuments.length) },
    { label: "Media", value: String(photoUrls.length + floorplanUrls.length) },
    { label: "Inquiry", value: lastInquirySentAt ? formatDateOnly(lastInquirySentAt) : "Not sent" },
  ];

  const jumpToSection = (sectionId: string) => {
    const node = document.getElementById(`canonical-section-${sectionId}`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (autoOpenInquiryComposerNonce == null) return;
    if (lastAutoOpenInquiryNonceRef.current === autoOpenInquiryComposerNonce) return;
    lastAutoOpenInquiryNonceRef.current = autoOpenInquiryComposerNonce;
    setOpenSections((prev) => ({ ...prev, rentalOm: true }));
    setInquiryDraft(buildInquiryDraft({
      canonicalAddress: property.canonicalAddress,
      recipientName: preferredInquiryRecipient.name,
      to: preferredInquiryRecipient.email,
    }));
    setInquirySendError(null);
    setInquiryGuard(null);
    setSendAnotherConfirm(false);
    setInquiryEmailModalOpen(true);
  }, [
    autoOpenInquiryComposerNonce,
    preferredInquiryRecipient.email,
    preferredInquiryRecipient.name,
    property.canonicalAddress,
  ]);

  return (
    <div className="property-detail-collapsible">
      {/* Linked listing — single header row, since there should only be one per canonical property */}
      {primaryListing !== "loading" && listingForDisplay && (
        <div className="linked-listing-bar">
          <div className="linked-listing-bar-inner">
            <div className="property-metric">
              <div className="property-metric-label">Listing ID</div>
              <div className="property-metric-value">{listingForDisplay.externalId}</div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Source</div>
              <div className="property-metric-value">
                {listingForDisplay.source === "streeteasy" ? "Streeteasy" : listingForDisplay.source}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Raw address</div>
              <div className="property-metric-value">{fullAddress(listingForDisplay)}</div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Listed date</div>
              <div className="property-metric-value">{formatListedDate(listingForDisplay.listedAt)}</div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Last activity</div>
              <div className="property-metric-value" title={listingActivitySummary ?? undefined}>
                {listingActivity?.lastActivityDate
                  ? `${formatListedDate(listingActivity.lastActivityDate)} · ${formatPriceEventLabel(listingActivity.lastActivityEvent)}`
                  : "—"}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Days on market</div>
              <div className="property-metric-value">
                {daysOnMarket(listingForDisplay.listedAt) != null ? `${daysOnMarket(listingForDisplay.listedAt)} days` : "—"}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Dup. conf.</div>
              <div
                className="property-metric-value"
                style={{
                  color:
                    (listingForDisplay.duplicateScore ?? 0) >= 80
                      ? "#b91c1c"
                      : (listingForDisplay.duplicateScore ?? 0) <= 20
                        ? "#15803d"
                        : "#854d0e",
                }}
              >
                {listingForDisplay.duplicateScore != null ? listingForDisplay.duplicateScore : "—"}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Link</div>
              <div className="property-metric-value">
                {listingForDisplay.url && listingForDisplay.url !== "#" ? (
                  <a href={listingForDisplay.url} target="_blank" rel="noopener noreferrer">
                    view source
                  </a>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {manualSourceLinks && (
        <div className="linked-listing-bar" style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
          <div className="linked-listing-bar-inner" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
            <div className="property-metric">
              <div className="property-metric-label">Manual add</div>
              <div className="property-metric-value">
                {manualSourceLinks.addedAt ? formatDateOnly(manualSourceLinks.addedAt) : "Saved"}
              </div>
            </div>
            {manualSourceLinks.streetEasyUrl && manualSourceLinks.streetEasyUrl !== listingForDisplay?.url ? (
              <div className="property-metric">
                <div className="property-metric-label">StreetEasy link</div>
                <div className="property-metric-value">
                  <a href={manualSourceLinks.streetEasyUrl} target="_blank" rel="noopener noreferrer">
                    open source
                  </a>
                </div>
              </div>
            ) : null}
            {manualSourceLinks.omUrl ? (
              <div className="property-metric">
                <div className="property-metric-label">OM link</div>
                <div className="property-metric-value">
                  <a href={manualSourceLinks.omUrl} target="_blank" rel="noopener noreferrer">
                    {manualSourceLinks.omFileName?.trim() || "open OM"}
                  </a>
                </div>
              </div>
            ) : null}
            {manualSourceLinks.omImportedAt ? (
              <div className="property-metric">
                <div className="property-metric-label">OM imported</div>
                <div className="property-metric-value">{formatDateOnly(manualSourceLinks.omImportedAt)}</div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Deal score — generated after dossier flow persists deal_signals */}
      <div className="linked-listing-bar" style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
        <div className="linked-listing-bar-inner" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <div className="property-metric">
            <div className="property-metric-label">Deal score</div>
            <div className="property-metric-value">
              {dealScore != null ? `${dealScore}/100` : "Pending dossier"}
            </div>
          </div>
          {calculatedDealScore != null && calculatedDealScore !== dealScore && (
            <div className="property-metric">
              <div className="property-metric-label">Calculated</div>
              <div className="property-metric-value">{calculatedDealScore}/100</div>
            </div>
          )}
          {dealSignals && typeof dealSignals.confidenceScore === "number" && (
            <div className="property-metric">
              <div className="property-metric-label">Confidence</div>
              <div className="property-metric-value">{Number(dealSignals.confidenceScore).toFixed(2)}</div>
            </div>
          )}
          {scoreOverride && (
            <div className="property-metric">
              <div className="property-metric-label">Override</div>
              <div className="property-metric-value" title={scoreOverride.reason}>
                {scoreOverride.score}/100
              </div>
            </div>
          )}
          {dealSignals && typeof dealSignals.assetCapRate === "number" && (
            <div className="property-metric">
              <div className="property-metric-label">Asset cap</div>
              <div className="property-metric-value">{Number(dealSignals.assetCapRate).toFixed(2)}%</div>
            </div>
          )}
          {dealSignals && typeof dealSignals.adjustedCapRate === "number" && (
            <div className="property-metric">
              <div className="property-metric-label">Adj. cap</div>
              <div className="property-metric-value">{Number(dealSignals.adjustedCapRate).toFixed(2)}%</div>
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center",
            padding: "0.75rem 1rem 0",
            borderTop: "1px solid rgba(0,0,0,0.08)",
            marginTop: "0.75rem",
          }}
        >
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={scoreOverrideDraft.score}
            onChange={(e) => setScoreOverrideDraft((prev) => ({ ...prev, score: e.target.value }))}
            placeholder={dealScore != null ? String(dealScore) : "Score"}
            style={{ width: "6rem" }}
          />
          <input
            type="text"
            value={scoreOverrideDraft.reason}
            onChange={(e) => setScoreOverrideDraft((prev) => ({ ...prev, reason: e.target.value }))}
            placeholder="Override reason"
            style={{ minWidth: "16rem", flex: "1 1 18rem" }}
          />
          <button type="button" onClick={saveScoreOverride} disabled={scoreOverrideSaving}>
            {scoreOverrideSaving ? "Saving…" : scoreOverride ? "Replace override" : "Set override"}
          </button>
          {scoreOverride && (
            <button type="button" onClick={clearScoreOverride} disabled={scoreOverrideSaving}>
              Clear override
            </button>
          )}
          {scoreOverride && (
            <span style={{ fontSize: "0.85rem", color: "#555" }} title={scoreOverride.reason}>
              Active override: {scoreOverride.reason}
            </span>
          )}
          {scoreOverrideError && (
            <span style={{ fontSize: "0.85rem", color: "#b91c1c" }}>{scoreOverrideError}</span>
          )}
        </div>
      </div>

      <div className="property-detail-overview-strip">
        {overviewItems.map((item) => (
          <div key={item.label} className="property-detail-overview-item">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      {sourcingUpdate && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.85rem 1rem",
            borderRadius: "0.9rem",
            border: `1px solid ${sourcingUpdateMeta.style.borderColor}`,
            background: sourcingUpdateMeta.style.backgroundColor,
            color: sourcingUpdateMeta.style.color,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Saved-search sync
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 600 }}>{sourcingUpdateMeta.label}</div>
            </div>
            <div style={{ fontSize: "0.82rem", opacity: 0.9 }}>
              {sourcingUpdate.lastEvaluatedAt ? `Last checked ${formatDateOnly(sourcingUpdate.lastEvaluatedAt)}` : sourcingUpdateMeta.detail}
            </div>
          </div>
          {typeof sourcingUpdate.summary === "string" && sourcingUpdate.summary.trim().length > 0 && (
            <p style={{ margin: "0.6rem 0 0", fontSize: "0.9rem", lineHeight: 1.5 }}>{sourcingUpdate.summary}</p>
          )}
          {Array.isArray(sourcingUpdate.changes) && sourcingUpdate.changes.length > 0 && (
            <ul style={{ margin: "0.65rem 0 0", paddingLeft: "1.1rem", fontSize: "0.88rem", lineHeight: 1.5 }}>
              {sourcingUpdate.changes.slice(0, 6).map((change, index) => (
                <li key={`${change.field}-${index}`}>{formatSourcingUpdateChange(change)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="property-detail-jump-row">
        {sectionLinks.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`property-detail-jump-pill ${section.open ? "property-detail-jump-pill--open" : ""}`}
            onClick={() => jumpToSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>

      <CollapsibleSection
        id="deal-dossier"
        title="Deal dossier"
        open={!!openSections.dealDossier}
        onToggle={() => toggle("dealDossier")}
      >
        <div
          style={{
            padding: "1rem",
            border: "1px solid #dbeafe",
            borderRadius: "12px",
            background: "#f8fbff",
          }}
        >
          <p style={{ margin: "0 0 0.85rem", fontSize: "0.85rem", color: "#475569", lineHeight: 1.5 }}>
            Save renovation and furnishing costs on this property, then generate the dossier here using those property-level costs plus your profile defaults for leverage, exit, and operating assumptions.
          </p>
          {dossierSettingsLoading ? (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>Loading dossier defaults…</p>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.85rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#0f172a" }}>Renovation costs</span>
                  <input
                    type="number"
                    min={0}
                    value={dossierDraft.renovationCosts ?? ""}
                    onChange={(e) =>
                      setDossierDraft((prev) => ({
                        ...prev,
                        renovationCosts: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    style={{ padding: "0.55rem 0.65rem", border: "1px solid #cbd5e1", borderRadius: "8px" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#0f172a" }}>Furnishing / setup costs</span>
                  <input
                    type="number"
                    min={0}
                    value={dossierDraft.furnishingSetupCosts ?? ""}
                    onChange={(e) =>
                      setDossierDraft((prev) => ({
                        ...prev,
                        furnishingSetupCosts: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    style={{ padding: "0.55rem 0.65rem", border: "1px solid #cbd5e1", borderRadius: "8px" }}
                  />
                </label>
              </div>
              <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "#64748b", lineHeight: 1.5 }}>
                <div>
                  Formula default: {formatPrice(formulaDossierDefaults.furnishingSetupCosts ?? 0)} using eligible-unit count, bed/bath mix, and average eligible unit sqft from the rent roll or building square footage.
                </div>
                <div>
                  Target sizing is roughly $10k per unit around 500-1,500 sqft, $15k-$20k per unit above that, and $25k-$30k per unit once average unit size is above 2,500 sqft. Override this with your actual furnishing quote whenever you have one.
                </div>
                {dossierMixSummary && (
                  <div>
                    Mix context: {dossierMixSummary.eligibleResidentialUnits ?? 0} eligible residential unit(s), {dossierMixSummary.commercialUnits ?? 0} commercial, {dossierMixSummary.rentStabilizedUnits ?? 0} rent-stabilized.
                  </div>
                )}
                {persistedDossierAssumptions?.updatedAt && (
                  <div>Last saved: {formatListedDate(persistedDossierAssumptions.updatedAt)}</div>
                )}
              </div>
              {dossierError && (
                <p style={{ margin: "0.75rem 0 0", fontSize: "0.82rem", color: "#b91c1c" }}>{dossierError}</p>
              )}
              {persistedDossierGeneration?.status === "failed" && !dossierError && persistedDossierGeneration.lastError && (
                <p style={{ margin: "0.75rem 0 0", fontSize: "0.82rem", color: "#b91c1c" }}>
                  Last generation failed: {persistedDossierGeneration.lastError}
                </p>
              )}
              {showDossierProgress && (
                <div className="dossier-progress-shell" style={{ marginTop: "0.9rem" }} aria-live="polite">
                  <div className="dossier-progress-header">
                    <div>
                      <div className="dossier-progress-title">{Math.min(activeDossierProgressPct, 100)}% complete</div>
                      <div className="dossier-progress-subtitle">{activeDossierStageLabel}</div>
                    </div>
                    <div className="dossier-progress-step">Property-level dossier run</div>
                  </div>
                  <div
                    className="dossier-progress-track"
                    role="progressbar"
                    aria-label="Property dossier generation progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(activeDossierProgressPct, 100)}
                  >
                    <div className="dossier-progress-fill" style={{ width: `${Math.min(activeDossierProgressPct, 100)}%` }} />
                  </div>
                </div>
              )}
              {!hasAuthoritativeOm && (
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "0.85rem 1rem",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#334155",
                    fontSize: "0.92rem",
                  }}
                >
                  {hasOmDocument
                    ? "Generate dossier now requires a promoted authoritative OM snapshot. Build the authoritative OM first, then run dossier generation."
                    : "Upload an OM, brochure, or rent roll before generating a dossier."}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.65rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  disabled={isDossierBusy || !isDossierDirty}
                  onClick={async () => {
                    try {
                      await persistDossierSettings();
                      onRefreshPropertyData?.();
                    } catch (err) {
                      setDossierError(err instanceof Error ? err.message : "Failed to save dossier settings");
                    }
                  }}
                  style={{
                    padding: "0.55rem 0.9rem",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    cursor: isDossierBusy || !isDossierDirty ? "not-allowed" : "pointer",
                  }}
                >
                  {dossierSettingsSaving ? "Saving…" : "Save property costs"}
                </button>
                <button
                  type="button"
                  disabled={isDossierBusy}
                  onClick={() =>
                    setDossierDraft((prev) => ({
                      ...prev,
                      furnishingSetupCosts: formulaDossierDefaults.furnishingSetupCosts ?? null,
                    }))
                  }
                  style={{
                    padding: "0.55rem 0.9rem",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    cursor: isDossierBusy ? "not-allowed" : "pointer",
                  }}
                >
                  Use formula default
                </button>
                {hasOmDocument && !hasAuthoritativeOm && (
                  <button
                    type="button"
                    disabled={isDossierBusy}
                    onClick={handleRefreshAuthoritativeOm}
                    style={{
                      padding: "0.55rem 0.9rem",
                      borderRadius: "8px",
                      border: "1px solid #0f766e",
                      background: "#ecfeff",
                      color: "#115e59",
                      fontWeight: 600,
                      cursor: isDossierBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {authoritativeOmRefreshing ? "Building OM..." : "Build authoritative OM"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={isDossierBusy || !hasAuthoritativeOm}
                  onClick={handleGenerateDossier}
                  style={{
                    padding: "0.55rem 1rem",
                    borderRadius: "8px",
                    border: "none",
                    background: "#0066cc",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: isDossierBusy || !hasAuthoritativeOm ? "not-allowed" : "pointer",
                    opacity: !hasAuthoritativeOm ? 0.65 : 1,
                  }}
                >
                  {dossierGenerating ? "Generating..." : "Generate dossier"}
                </button>
                <a
                  href={`/dossier-assumptions?property_id=${encodeURIComponent(property.id)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0.55rem 0.9rem",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    color: "#334155",
                    textDecoration: "none",
                    background: "#fff",
                  }}
                >
                  Advanced assumptions
                </a>
              </div>
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* 1. Photos / floor plans — side by side, same layout as raw listings */}
      <CollapsibleSection
        id="photos-floorplans"
        title="Photos / floor plans"
        count={photoUrls.length + floorplanUrls.length}
        open={!!openSections.photosFloorplans}
        onToggle={() => toggle("photosFloorplans")}
      >
        {primaryListing === "loading" ? (
          <p style={{ color: "#737373" }}>Loading listing…</p>
        ) : photoUrls.length > 0 || floorplanUrls.length > 0 ? (
          <div className="property-detail-media-columns" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              {photoUrls.length > 0 ? (
                <div className="property-card-gallery-wrap">
                  <div className="property-card-gallery">
                    <a href={photoUrls[galleryIndex]} target="_blank" rel="noopener noreferrer" className="property-card-gallery-main-wrap">
                      <img key={galleryIndex} src={photoUrls[galleryIndex]} alt="" className="property-card-gallery-main" />
                    </a>
                    <div className="property-card-gallery-thumbs">
                      {photoUrls.map((src, i) => (
                        <button key={i} type="button" onClick={() => setGalleryIndex(i)} className={`property-card-gallery-thumb-wrap ${i === galleryIndex ? "property-card-gallery-thumb-wrap--active" : ""}`}>
                          <img src={src} alt="" loading="lazy" className="property-card-gallery-thumb" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="property-detail-text" style={{ color: "#737373" }}>No photos</p>
              )}
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              {floorplanUrls.length > 0 ? (
                <div className="property-card-photos">
                  {floorplanUrls.map((src, i) => (
                    <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="property-card-photo-wrap">
                      <img src={src} alt="" loading="lazy" className="property-card-photo" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="property-detail-text" style={{ color: "#737373" }}>No floor plans</p>
              )}
            </div>
          </div>
        ) : (
          <p style={{ color: "#737373" }}>No linked listing or no media. Add raw listings and link to this property.</p>
        )}
      </CollapsibleSection>

      {/* 2. Initial property info: same as raw (details, broker, amenities, price history) + Geospatial data */}
      <CollapsibleSection
        id="details-broker-amenities-price-history"
        title="Initial property info"
        open={!!openSections.detailsBrokerAmenitiesPriceHistory}
        onToggle={() => toggle("detailsBrokerAmenitiesPriceHistory")}
      >
        <div className="initial-info-grid">
          <div className="initial-info-card initial-info-card--details">
            <h4 className="initial-info-subtitle">Details</h4>
            {listingForDisplay && (
              <>
                <div className="initial-info-price">{formatPrice(listingForDisplay.price)}</div>
                <div className="initial-info-listing-meta">
                  <span>Listed {formatListedDate(listingForDisplay.listedAt)}</span>
                  {daysOnMarket(listingForDisplay.listedAt) != null && (
                    <span> · {daysOnMarket(listingForDisplay.listedAt)} days on market</span>
                  )}
                </div>
                {listingActivity?.lastActivityDate && (
                  <div className="initial-info-listing-meta" title={listingActivitySummary ?? undefined}>
                    <span>
                      Last activity {formatListedDate(listingActivity.lastActivityDate)} · {formatPriceEventLabel(listingActivity.lastActivityEvent)}
                    </span>
                    {listingActivity.lastActivityPrice != null && (
                      <span> · {formatPrice(listingActivity.lastActivityPrice)}</span>
                    )}
                  </div>
                )}
                {(extra?.priceChangeSinceListed as { listedPrice: number; currentPrice: number; changeAmount: number; changePercent: number } | undefined) && (() => {
                  const p = extra!.priceChangeSinceListed as { listedPrice: number; currentPrice: number; changeAmount: number; changePercent: number };
                  const isDecrease = p.changeAmount < 0;
                  const isIncrease = p.changeAmount > 0;
                  return (
                    <div className="initial-info-price-change">
                      <span>Listed at {formatPrice(p.listedPrice)}</span>
                      {p.changeAmount === 0 ? (
                        <span> — No change</span>
                      ) : (
                        <span className={isDecrease ? "initial-info-price-change--down" : "initial-info-price-change--up"}>
                          {" → "}{isDecrease ? "−" : "+"}{formatPrice(Math.abs(p.changeAmount))} ({isDecrease ? "" : "+"}{p.changePercent.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  );
                })()}
                <div className="initial-info-stat-grid">
                  <div className="initial-info-stat-card">
                    <span>Beds</span>
                    <strong>{listingForDisplay.beds ?? "—"}</strong>
                  </div>
                  <div className="initial-info-stat-card">
                    <span>Baths</span>
                    <strong>{listingForDisplay.baths ?? "—"}</strong>
                  </div>
                  <div className="initial-info-stat-card">
                    <span>Sqft</span>
                    <strong>{listingForDisplay.sqft != null ? Number(listingForDisplay.sqft).toLocaleString() : "—"}</strong>
                  </div>
                  <div className="initial-info-stat-card">
                    <span>Type</span>
                    <strong>{formatPropertyType(extra?.propertyType ?? extra?.property_type ?? extra?.type ?? "")}</strong>
                  </div>
                  <div className="initial-info-stat-card">
                    <span>HOA</span>
                    <strong>{(monthlyHoa == null || monthlyHoa === 0) ? "NA" : formatPrice(typeof monthlyHoa === "number" ? monthlyHoa : null)}</strong>
                  </div>
                  <div className="initial-info-stat-card">
                    <span>Tax</span>
                    <strong>{(monthlyTax == null || monthlyTax === 0) ? "NA" : formatPrice(typeof monthlyTax === "number" ? monthlyTax : null)}</strong>
                  </div>
                </div>
                <dl className="initial-info-dl">
                  <div className="initial-info-dl-row"><dt>Beds / Baths</dt><dd>{listingForDisplay.beds ?? "—"} / {listingForDisplay.baths ?? "—"}</dd></div>
                  <div className="initial-info-dl-row"><dt>Sqft</dt><dd>{listingForDisplay.sqft ?? "—"}</dd></div>
                  <div className="initial-info-dl-row"><dt>Property type</dt><dd>{formatPropertyType(extra?.propertyType ?? extra?.property_type ?? extra?.type ?? "")}</dd></div>
                  {(extra?.builtIn ?? extra?.built_in ?? extra?.yearBuilt) != null && <div className="initial-info-dl-row"><dt>Built</dt><dd>{String(extra?.builtIn ?? extra?.built_in ?? extra?.yearBuilt)}</dd></div>}
                  {(monthlyHoa != null || monthlyTax != null) && (
                    <div className="initial-info-dl-row">
                      <dt>HOA / Tax</dt>
                      <dd>
                        {(monthlyHoa == null || monthlyHoa === 0) ? "NA" : formatPrice(typeof monthlyHoa === "number" ? monthlyHoa : null)} / {(monthlyTax == null || monthlyTax === 0) ? "NA" : formatPrice(typeof monthlyTax === "number" ? monthlyTax : null)}
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            )}
            {!listingForDisplay && primaryListing === "loading" && <p className="initial-info-empty">Loading listing…</p>}
            {!listingForDisplay && primaryListing !== "loading" && <p className="initial-info-empty">No linked listing.</p>}
            <h4 className="initial-info-subtitle">Geospatial data</h4>
            <div className="initial-info-geo initial-info-data-grid">
              {bbl != null && <dl className="initial-info-dl"><div className="initial-info-dl-row"><dt>BBL (tax)</dt><dd>{String(bbl)}</dd></div></dl>}
              {bblBase != null && <dl className="initial-info-dl"><div className="initial-info-dl-row"><dt>BBL (base)</dt><dd>{String(bblBase)}</dd></div></dl>}
              {(lat != null && lon != null) && (
                <dl className="initial-info-dl">
                  <div className="initial-info-dl-row">
                    <dt>Location</dt>
                    <dd>
                      <a className="initial-info-geo-link" href={`https://www.google.com/maps?q=${lat},${lon}`} target="_blank" rel="noopener noreferrer">{String(lat)}, {String(lon)}</a>
                    </dd>
                  </div>
                </dl>
              )}
              {bbl == null && bblBase == null && lat == null && lon == null && <p className="initial-info-empty">—</p>}
            </div>
            <h4 className="initial-info-subtitle">Enriched data</h4>
            <div className="initial-info-geo initial-info-data-grid">
              <dl className="initial-info-dl">
                <div className="initial-info-dl-row"><dt>Tax code</dt><dd>{d?.taxCode != null && String(d.taxCode).trim() !== "" ? String(d.taxCode) : "—"}</dd></div>
                <div className="initial-info-dl-row"><dt>2010 Census Block</dt><dd>{d?.censusBlock2010 != null && String(d.censusBlock2010).trim() !== "" ? String(d.censusBlock2010) : "—"}</dd></div>
                {(() => {
                  const co = enrichment?.certificateOfOccupancy as Record<string, unknown> | undefined;
                  const coJobNumber = co?.jobNumber ?? co?.job_number;
                  const coStatus = co?.status ?? co?.c_of_o_status;
                  const coDate = co?.issuanceDate ?? co?.issuance_date ?? co?.c_of_o_issuance_date;
                  const coJobType = co?.jobType ?? co?.job_type;
                  const hasCo = co != null && (coJobNumber != null || coStatus != null || coDate != null || coJobType != null);
                  return (
                    <>
                      <div className="initial-info-dl-row"><dt>CO ID (job number)</dt><dd>{coJobNumber != null && String(coJobNumber).trim() !== "" ? String(coJobNumber) : "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>CO issuance date</dt><dd>{formatDateOnly(coDate as string | null | undefined) ?? "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>Certificate of occupancy</dt><dd>{coStatus != null && String(coStatus).trim() !== "" ? String(coStatus) : "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>CO job type</dt><dd>{coJobType != null && String(coJobType).trim() !== "" ? String(coJobType) : "—"}</dd></div>
                      {!hasCo && (
                        <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From certificate_of_occupancy enrichment (BBL). Run enrichment to populate.</p>
                      )}
                    </>
                  );
                })()}
                {(() => {
                  const z = enrichment?.zoning as Record<string, unknown> | undefined;
                  const zd1 = z?.zoningDistrict1 ?? z?.zoning_district_1;
                  const zd2 = z?.zoningDistrict2 ?? z?.zoning_district_2;
                  const zMap = z?.zoningMapNumber ?? z?.zoning_map_number ?? z?.zoningMapCode ?? z?.zoning_map_code;
                  const hasZoning = z != null && (zd1 != null || zd2 != null || zMap != null);
                  return (
                    <>
                      <div className="initial-info-dl-row"><dt>Zoning district</dt><dd>{[zd1, zd2].filter(Boolean).map(String).join(", ") || "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>Zoning map</dt><dd>{zMap != null && String(zMap).trim() !== "" ? String(zMap) : "—"}</dd></div>
                      {!hasZoning && (
                        <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From zoning_ztl enrichment (BBL). Run enrichment to populate.</p>
                      )}
                    </>
                  );
                })()}
                {(() => {
                  const hpd = enrichment?.hpdRegistration as Record<string, unknown> | undefined;
                  const hpdId = hpd?.registrationId ?? hpd?.registration_id;
                  const hpdDate = hpd?.lastRegistrationDate ?? hpd?.last_registration_date;
                  const hasHpd = hpd != null && (hpdId != null || hpdDate != null);
                  return (
                    <>
                      <div className="initial-info-dl-row"><dt>HPD Registration ID</dt><dd>{hpdId != null && String(hpdId).trim() !== "" ? String(hpdId) : "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>HPD Last Registration Date</dt><dd>{formatDateOnly(hpdDate as string | null | undefined) ?? "—"}</dd></div>
                      {!hasHpd && (
                        <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From hpd_registration enrichment (BBL). Run enrichment to populate.</p>
                      )}
                    </>
                  );
                })()}
              </dl>
              {!enrichment?.certificateOfOccupancy && !enrichment?.zoning && !enrichment?.hpdRegistration && (d?.taxCode == null || String(d.taxCode).trim() === "") && (
                <p className="initial-info-empty">Run enrichment to populate tax code, certificate of occupancy, zoning, and HPD registration.</p>
              )}
            </div>
          </div>
          <div className="initial-info-right-col">
            <div className="initial-info-card">
              <h4 className="initial-info-subtitle">Broker / Agent</h4>
              {listingForDisplay?.agentEnrichment?.length ? (
                <ul className="initial-info-broker-list">
                  {listingForDisplay.agentEnrichment.map((e, i) => (
                    <li key={i}>
                      <span className="initial-info-broker-name">{e.name}</span>
                      <span className="initial-info-broker-meta">
                        {e.firm && <span>{e.firm}</span>}
                        <span className={!e.email && !e.phone ? "initial-info-broker-contact-missing" : ""}>
                          {e.firm && " · "}
                          Email: {e.email ?? "—"} · Phone: {e.phone ?? "—"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : listingForDisplay?.agentNames?.length ? (
                <p style={{ margin: 0, color: "#0f172a", fontSize: "0.875rem" }}>{listingForDisplay.agentNames.join(", ")}</p>
              ) : (
                <p className="initial-info-empty">—</p>
              )}
            </div>
            <div className="initial-info-card">
              <h4 className="initial-info-subtitle">Amenities</h4>
              {listingForDisplay && Array.isArray(extra?.amenities) && (extra!.amenities as string[]).length > 0 ? (
                <ul className="initial-info-amenities-pills">
                  {(extra!.amenities as string[]).map((a, i) => (
                    <li key={i}>{String(a).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</li>
                  ))}
                </ul>
              ) : (
                <p className="initial-info-empty">From linked listing when available.</p>
              )}
            </div>
            {(listingForDisplay?.priceHistory?.length ?? 0) > 0 && (
              <div className="initial-info-card initial-info-card--price-history">
                <h4 className="initial-info-subtitle">Price history</h4>
                <div className="initial-info-price-history-list">
                  {listingForDisplay!.priceHistory!.map((r, i) => (
                    <div key={i} className="initial-info-price-history-row">
                      <span className="initial-info-price-history-date">{formatPriceHistoryDate(r.date)}</span>
                      <span className="initial-info-price-history-sep">·</span>
                      <span className="initial-info-price-history-price">{formatPriceCompact(r.price)}</span>
                      <span className="initial-info-price-history-sep">·</span>
                      <span className="initial-info-price-history-event">{formatPriceEventLabel(r.event)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {listingForDisplay?.description && (
            <div className="initial-info-card initial-info-card--description">
              <h4 className="initial-info-subtitle">Description</h4>
              <div className="initial-info-description-wrap property-card-description-wrap">
                <p
                  className={`property-card-description ${descriptionExpanded ? "property-card-description--expanded" : ""}`}
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {listingForDisplay.description}
                </p>
                <button
                  type="button"
                  className="property-card-expand"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDescriptionExpanded((prev) => !prev);
                  }}
                >
                  {descriptionExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* 3. Owner information: Owner module (Phase 1 / PLUTO) + Permit module (permits_summary) + NY DOS entity when business-like */}
      <CollapsibleSection id="owner" title="Owner information" open={!!openSections.owner} onToggle={() => toggle("owner")}>
        <div style={{ fontSize: "0.875rem" }}>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", marginBottom: "0.25rem" }}>Owner module: name, business</strong>
            <div><strong>Name:</strong> {ownerModuleName != null && String(ownerModuleName).trim() !== "" ? String(ownerModuleName).trim() : "—"}</div>
            <div><strong>Business:</strong> {ownerModuleBusiness != null && String(ownerModuleBusiness).trim() !== "" ? String(ownerModuleBusiness).trim() : "—"}</div>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", marginBottom: "0.25rem" }}>Permit module: name, business</strong>
            <div><strong>Name:</strong> {ps?.owner_name != null && String(ps.owner_name).trim() !== "" ? String(ps.owner_name).trim() : "—"}</div>
            <div><strong>Business:</strong> {ps?.owner_business_name != null && String(ps.owner_business_name).trim() !== "" ? String(ps.owner_business_name).trim() : "—"}</div>
          </div>
          {ownerValuations != null && String(ownerValuations).trim() !== "" && (
            <div style={{ marginBottom: "0.75rem" }}>
              <strong style={{ display: "block", marginBottom: "0.25rem" }}>Owner (Valuations module)</strong>
              <div>{String(ownerValuations).trim()}</div>
            </div>
          )}
          {/* NY DOS entity details when owner name looks like LLC, Corp, etc. */}
          <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e5e5" }}>
            <strong style={{ display: "block", marginBottom: "0.35rem" }}>NY DOS entity details</strong>
            {!dosEntityQueryName && dosEntity === "n/a" && (
              <p style={{ margin: 0, color: "#737373" }}>N/A — Owner name does not appear to be a corporation, LLC, or similar entity.</p>
            )}
            {dosEntityQueryName && dosEntityLoading && (
              <p style={{ margin: 0, color: "#737373" }}>Loading…</p>
            )}
            {dosEntityQueryName && !dosEntityLoading && dosEntity === "n/a" && (
              <p style={{ margin: 0, color: "#737373" }}>No matching entity found in NY DOS for &quot;{dosEntityQueryName}&quot;.</p>
            )}
            {dosEntityQueryName && !dosEntityLoading && dosEntity !== null && dosEntity !== "n/a" && (
              <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                <li><strong>Filing date:</strong> {dosEntity.filingDate ?? "N/A"}</li>
                <li>
                  <strong>DOS process:</strong> {dosEntity.dosProcessName ?? "N/A"}
                  {dosEntity.dosProcessAddress && (
                    <ul style={{ margin: "0.15rem 0 0", paddingLeft: "1rem" }}>
                      <li>{dosEntity.dosProcessAddress}</li>
                    </ul>
                  )}
                </li>
                <li>
                  <strong>CEO:</strong> {dosEntity.ceoName ?? "N/A"}
                  {dosEntity.ceoAddress && (
                    <ul style={{ margin: "0.15rem 0 0", paddingLeft: "1rem" }}>
                      <li>{dosEntity.ceoAddress}</li>
                    </ul>
                  )}
                </li>
                <li>
                  <strong>Registered agent:</strong> {dosEntity.registeredAgentName ?? "N/A"}
                  {dosEntity.registeredAgentAddress && (
                    <ul style={{ margin: "0.15rem 0 0", paddingLeft: "1rem" }}>
                      <li>{dosEntity.registeredAgentAddress}</li>
                    </ul>
                  )}
                </li>
              </ul>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* 4. Valuations (assessment): market value, assessed value, tax before total, sqft/area, dates */}
      <CollapsibleSection id="valuations" title="Valuations (assessment)" open={!!openSections.valuations} onToggle={() => toggle("valuations")}>
        <div style={{ fontSize: "0.875rem" }}>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Market value:</strong> {assessedMarketValue != null ? `$${Number(assessedMarketValue).toLocaleString()}` : "—"}</li>
            <li><strong>Actual assessed:</strong> {assessedActualValue != null ? `$${Number(assessedActualValue).toLocaleString()}` : "—"}</li>
            <li><strong>Tax before total:</strong> {assessedTaxBeforeTotal != null ? `$${Number(assessedTaxBeforeTotal).toLocaleString()}` : "—"}</li>
          </ul>
          <strong style={{ display: "block", marginBottom: "0.25rem" }}>Area</strong>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Gross sqft:</strong> {assessedGrossSqft != null ? Number(assessedGrossSqft).toLocaleString() : "—"}</li>
            <li><strong>Land area:</strong> {assessedLandArea != null ? Number(assessedLandArea).toLocaleString() : "—"}</li>
            <li><strong>Residential area gross:</strong> {assessedResidentialAreaGross != null ? Number(assessedResidentialAreaGross).toLocaleString() : "—"}</li>
            <li><strong>Office area gross:</strong> {assessedOfficeAreaGross != null ? Number(assessedOfficeAreaGross).toLocaleString() : "—"}</li>
            <li><strong>Retail area gross:</strong> {assessedRetailAreaGross != null ? Number(assessedRetailAreaGross).toLocaleString() : "—"}</li>
          </ul>
          <strong style={{ display: "block", marginBottom: "0.25rem" }}>Dates</strong>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li><strong>Appt date:</strong> {assessedApptDate != null && String(assessedApptDate).trim() !== "" ? formatDateOnly(assessedApptDate) ?? String(assessedApptDate) : "—"}</li>
            <li><strong>Extract date:</strong> {assessedExtractDate != null && String(assessedExtractDate).trim() !== "" ? formatDateOnly(assessedExtractDate) ?? String(assessedExtractDate) : "—"}</li>
          </ul>
          {assessedMarketValue == null && assessedActualValue == null && assessedTaxBeforeTotal == null && assessedGrossSqft == null && assessedLandArea == null && assessedResidentialAreaGross == null && assessedOfficeAreaGross == null && assessedRetailAreaGross == null && (assessedApptDate == null || String(assessedApptDate).trim() === "") && (assessedExtractDate == null || String(assessedExtractDate).trim() === "") && (
            <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From valuations enrichment (BBL). Run enrichment to populate.</p>
          )}
        </div>
      </CollapsibleSection>

      {/* 5. Rental pricing / OM + rental financials (per-unit table, NOI, cap rate) */}
      <CollapsibleSection id="rental-om" title="Rental pricing / OM" open={!!openSections.rentalOm} onToggle={() => toggle("rentalOm")}>
        <div className="rental-om-shell" style={{ fontSize: "0.875rem" }}>
          {/* Request info by email — always first */}
          <div className="rental-om-panel rental-om-panel--inquiry" style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.9rem", color: "#1a1a1a" }}>Request info by email</strong>
            {lastInquirySentAt && (
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "#166534", fontWeight: 500 }}>
                Last inquiry sent: {formatDateOnly(lastInquirySentAt) ?? lastInquirySentAt}
              </p>
            )}
            {inquirySendSuccess && (
              <p style={{ margin: "0 0 0.5rem", padding: "0.4rem 0.6rem", backgroundColor: "#dcfce7", border: "1px solid #22c55e", borderRadius: "6px", fontSize: "0.875rem", color: "#166534" }}>
                {inquirySendSuccess}
              </p>
            )}
            {hasOmDocument && (
              <p style={{ margin: "0 0 0.5rem", padding: "0.4rem 0.6rem", backgroundColor: "#f0f9ff", border: "1px solid #0ea5e9", borderRadius: "6px", fontSize: "0.8rem", color: "#0369a1" }}>
                OM already received or uploaded. See <strong>Documents (from inquiry replies)</strong> and <strong>Uploaded documents</strong> below.
              </p>
            )}
            <div
              style={{
                margin: "0 0 0.75rem",
                padding: "0.7rem 0.8rem",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                backgroundColor: "#fafafa",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#4b5563" }}>
                    Preferred broker email
                  </div>
                  <div style={{ marginTop: "0.2rem", fontSize: "0.92rem", fontWeight: 600, color: "#111827" }}>
                    {preferredInquiryRecipient.email || "No broker email selected yet"}
                  </div>
                  <div style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: "#6b7280", lineHeight: 1.5 }}>
                    {usingManualRecipientOverride
                      ? "Manual override is active. Inquiry actions use this email first."
                      : recipientResolution?.status === "resolved"
                        ? "Currently using the LLM/listing-sourced broker email. Save a manual override if you found a better address."
                        : recipientResolution?.status === "multiple_candidates"
                          ? "Multiple broker emails were sourced. Save one manual email to make it the default."
                          : "No broker email is locked in yet. Add one manually if you found it outside the LLM run."}
                  </div>
                </div>
                {recipientResolutionLoading ? (
                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Refreshing…</span>
                ) : null}
              </div>
              {recipientOverrideNotice && (
                <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "#166534" }}>{recipientOverrideNotice}</p>
              )}
              {recipientOverrideError && (
                <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "#b91c1c" }}>{recipientOverrideError}</p>
              )}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.65rem" }}>
                <input
                  type="text"
                  value={recipientOverrideDraft}
                  onChange={(e) => setRecipientOverrideDraft(e.target.value)}
                  placeholder={preferredInquiryRecipient.email || "broker@firm.com"}
                  style={{ flex: "1 1 18rem", minWidth: "14rem", padding: "0.45rem", fontSize: "0.85rem", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                <button
                  type="button"
                  onClick={saveRecipientOverride}
                  disabled={Boolean(recipientOverrideSaving || !recipientOverrideDraft.trim())}
                  style={{
                    padding: "0.4rem 0.7rem",
                    borderRadius: "6px",
                    border: "1px solid #0f766e",
                    backgroundColor: recipientOverrideSaving ? "#99f6e4" : "#ccfbf1",
                    color: "#115e59",
                    cursor: recipientOverrideSaving ? "wait" : "pointer",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                  }}
                >
                  {recipientOverrideSaving ? "Saving…" : usingManualRecipientOverride ? "Update preferred email" : "Save preferred email"}
                </button>
                {usingManualRecipientOverride && (
                  <button
                    type="button"
                    onClick={clearRecipientOverride}
                    disabled={recipientOverrideSaving}
                    style={{
                      padding: "0.4rem 0.7rem",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      color: "#334155",
                      cursor: recipientOverrideSaving ? "wait" : "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    Use sourced email
                  </button>
                )}
              </div>
              {brokerEmailOptions.length > 0 && (
                <div style={{ marginTop: "0.65rem" }}>
                  <div style={{ marginBottom: "0.35rem", fontSize: "0.72rem", fontWeight: 600, color: "#6b7280" }}>
                    LLM / listing candidate emails
                  </div>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    {brokerEmailOptions.map((option) => (
                      <button
                        key={option.email.toLowerCase()}
                        type="button"
                        onClick={() => setRecipientOverrideDraft(option.email)}
                        style={{
                          padding: "0.25rem 0.55rem",
                          borderRadius: "999px",
                          border: "1px solid #d1d5db",
                          backgroundColor: "#fff",
                          color: "#374151",
                          cursor: "pointer",
                          fontSize: "0.74rem",
                        }}
                        title={option.name ? `${option.name} - ${option.email}` : option.email}
                      >
                        {option.email}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={hasOmDocument}
                onClick={() => {
                  setInquiryDraft(buildInquiryDraft({
                    canonicalAddress: property.canonicalAddress,
                    recipientName: preferredInquiryRecipient.name,
                    to: preferredInquiryRecipient.email,
                  }));
                  setInquirySendError(null);
                  setInquiryGuard(null);
                  setSendAnotherConfirm(false);
                  setInquiryEmailModalOpen(true);
                }}
                style={{
                  padding: "0.35rem 0.6rem",
                  backgroundColor: hasOmDocument ? "#e5e7eb" : "#f0f0f0",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  color: hasOmDocument ? "#9ca3af" : "#333",
                  cursor: hasOmDocument ? "not-allowed" : "pointer",
                }}
              >
                {lastInquirySentAt ? "Send another inquiry" : "Request info / OM by email & track reply"}
              </button>
              <button
                type="button"
                disabled={hasOmDocument}
                onClick={() => {
                  setManualInquiryDraft({
                    to: preferredInquiryRecipient.email,
                    sentAt: new Date().toISOString().slice(0, 10),
                  });
                  setManualInquiryError(null);
                  setInquiryGuard(null);
                  setManualInquiryModalOpen(true);
                }}
                style={{
                  padding: "0.35rem 0.6rem",
                  backgroundColor: hasOmDocument ? "#e5e7eb" : "#fff",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  color: hasOmDocument ? "#9ca3af" : "#333",
                  cursor: hasOmDocument ? "not-allowed" : "pointer",
                }}
              >
                Mark prior inquiry as sent
              </button>
            </div>
            <p style={{ margin: "0.25rem 0 0", color: "#737373", fontSize: "0.75rem" }}>
              Review the draft and click Send to email the broker. Use the subject line so replies are matched to this property. If you already reached out outside the app, use <strong>Mark prior inquiry as sent</strong> so the guardrail persists across refreshes. Replies and attachments appear in <strong>Documents (from inquiry replies)</strong> below after the daily process-inbox cron runs.
            </p>
          </div>
          {inquiryEmailModalOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }} onClick={() => setInquiryEmailModalOpen(false)}>
              <div style={{ backgroundColor: "#fff", borderRadius: "8px", padding: "1.25rem", maxWidth: "520px", width: "100%", maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }} onClick={(e) => e.stopPropagation()}>
                <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Request OM / rent roll from broker</p>
                {lastInquirySentAt && (
                  <p style={{ margin: "0 0 0.75rem", padding: "0.5rem 0.6rem", backgroundColor: "#fef3c7", border: "1px solid #f59e0b", borderRadius: "6px", fontSize: "0.8rem", color: "#92400e" }}>
                    An inquiry was already sent on {formatDateOnly(lastInquirySentAt) ?? lastInquirySentAt}. Sending again may result in duplicate emails to the broker.
                  </p>
                )}
                <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#555" }}>
                  Review the draft below and edit if needed (e.g. add your phone and email in the signature). Click <strong>Send email</strong> to send from your connected Gmail. Keep the subject line so replies can be matched to this property.
                </p>
                {inquirySendError && <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "#b91c1c" }}>{inquirySendError}</p>}
                {inquiryGuardLoading && (
                  <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "#64748b" }}>Checking inquiry guardrails…</p>
                )}
                {inquiryGuard?.sameRecipientOtherProperties.length ? (
                  <div style={{ margin: "0 0 0.75rem", padding: "0.5rem 0.6rem", backgroundColor: "#fff7ed", border: "1px solid #fb923c", borderRadius: "6px", fontSize: "0.8rem", color: "#9a3412" }}>
                    <strong style={{ display: "block", marginBottom: "0.25rem" }}>This broker email was already contacted for another property.</strong>
                    {inquiryGuard.sameRecipientOtherProperties.map((row) => (
                      <div key={`${row.propertyId}-${row.sentAt}`}>
                        {row.canonicalAddress} — {formatDateOnly(row.sentAt)}
                      </div>
                    ))}
                  </div>
                ) : null}
                {inquiryGuard?.sameBrokerTeamOtherProperties.length ? (
                  <div style={{ margin: "0 0 0.75rem", padding: "0.5rem 0.6rem", backgroundColor: "#fff7ed", border: "1px solid #fb923c", borderRadius: "6px", fontSize: "0.8rem", color: "#9a3412" }}>
                    <strong style={{ display: "block", marginBottom: "0.25rem" }}>A broker on this listing team was already involved on another contacted property.</strong>
                    {inquiryGuard.sameBrokerTeamOtherProperties.map((row) => (
                      <div key={`${row.propertyId}-${row.sentAt}`}>
                        {row.canonicalAddress} — {formatDateOnly(row.sentAt)}
                        {row.sharedBrokers.length ? ` — shared broker${row.sharedBrokers.length === 1 ? "" : "s"}: ${row.sharedBrokers.join(", ")}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>To (broker)</label>
                  <input
                    type="text"
                    value={inquiryDraft.to}
                    onChange={(e) => setInquiryDraft((p) => ({ ...p, to: e.target.value }))}
                    placeholder="Preferred broker email"
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                  {!inquiryDraft.to && (
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#888" }}>No broker email on file yet. Save a preferred email above or enter one here manually.</p>
                  )}
                  {brokerEmailOptions.length > 1 && (
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#666" }}>
                      Other sourced emails: {brokerEmailOptions.slice(1).map((entry) => entry.email).join(", ") || "—"}
                    </p>
                  )}
                </div>
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>Subject</label>
                  <input
                    type="text"
                    value={inquiryDraft.subject}
                    onChange={(e) => setInquiryDraft((p) => ({ ...p, subject: e.target.value }))}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>Body (editable)</label>
                  <textarea
                    value={inquiryDraft.body}
                    onChange={(e) => setInquiryDraft((p) => ({ ...p, body: e.target.value }))}
                    rows={6}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px", resize: "vertical" }}
                  />
                </div>
                {inquiryNeedsOverride && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.875rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={sendAnotherConfirm}
                        onChange={(e) => setSendAnotherConfirm(e.target.checked)}
                      />
                      Proceed anyway (I understand this may duplicate outreach)
                    </label>
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => { setInquiryEmailModalOpen(false); setInquirySendError(null); }} style={{ padding: "0.4rem 0.75rem", border: "1px solid #ccc", borderRadius: "4px", background: "#fff", cursor: "pointer" }}>Cancel</button>
                  <button
                    type="button"
                    disabled={Boolean(inquirySending || !inquiryDraft.to?.trim() || (inquiryNeedsOverride && !sendAnotherConfirm))}
                    onClick={async () => {
                      setInquirySendError(null);
                      setInquirySending(true);
                      onWorkflowActivity?.();
                      try {
                        const res = await fetch(`${API_BASE}/api/properties/${property.id}/send-inquiry-email`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ to: inquiryDraft.to.trim(), subject: inquiryDraft.subject, body: inquiryDraft.body, force: sendAnotherConfirm }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          if (data?.guard && data.guard.lastInquirySentAt != null) {
                            setLastInquirySentAt(data.guard.lastInquirySentAt);
                          }
                          if (data?.guard) {
                            setInquiryGuard(normalizeInquiryGuardState(data.guard));
                          }
                          const msg = typeof data?.details === "string" ? data.details : typeof data?.error === "string" ? data.error : "Failed to send";
                          throw new Error(msg);
                        }
                        setLastInquirySentAt(data.sentAt ?? null);
                        if (data.guard) {
                          setInquiryGuard(normalizeInquiryGuardState(data.guard));
                        }
                        setInquirySendSuccess("Email sent successfully.");
                        setInquiryEmailModalOpen(false);
                        setTimeout(() => setInquirySendSuccess(null), 4000);
                        onWorkflowActivity?.();
                      } catch (e) {
                        setInquirySendError(e instanceof Error ? e.message : "Failed to send email");
                        onWorkflowActivity?.();
                      } finally {
                        setInquirySending(false);
                      }
                    }}
                    style={{ padding: "0.4rem 0.75rem", border: "1px solid #0066cc", borderRadius: "4px", background: inquirySending ? "#94a3b8" : "#0066cc", color: "#fff", cursor: inquirySending ? "wait" : "pointer" }}
                  >
                    {inquirySending ? "Sending…" : "Send email"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {manualInquiryModalOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }} onClick={() => setManualInquiryModalOpen(false)}>
              <div style={{ backgroundColor: "#fff", borderRadius: "8px", padding: "1.25rem", maxWidth: "460px", width: "100%", maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }} onClick={(e) => e.stopPropagation()}>
                <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Mark prior inquiry as sent</p>
                <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#555" }}>
                  This does <strong>not</strong> send an email. It records prior outreach on the server so duplicate-send guardrails continue to work after refresh.
                </p>
                {manualInquiryError && <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "#b91c1c" }}>{manualInquiryError}</p>}
                {inquiryGuard?.sameRecipientOtherProperties.length ? (
                  <div style={{ margin: "0 0 0.75rem", padding: "0.5rem 0.6rem", backgroundColor: "#fff7ed", border: "1px solid #fb923c", borderRadius: "6px", fontSize: "0.8rem", color: "#9a3412" }}>
                    <strong style={{ display: "block", marginBottom: "0.25rem" }}>This broker email already has inquiry history on other properties.</strong>
                    {inquiryGuard.sameRecipientOtherProperties.map((row) => (
                      <div key={`${row.propertyId}-${row.sentAt}`}>
                        {row.canonicalAddress} — {formatDateOnly(row.sentAt)}
                      </div>
                    ))}
                  </div>
                ) : null}
                {inquiryGuard?.sameBrokerTeamOtherProperties.length ? (
                  <div style={{ margin: "0 0 0.75rem", padding: "0.5rem 0.6rem", backgroundColor: "#fff7ed", border: "1px solid #fb923c", borderRadius: "6px", fontSize: "0.8rem", color: "#9a3412" }}>
                    <strong style={{ display: "block", marginBottom: "0.25rem" }}>This listing team overlaps with other properties that already have inquiry history.</strong>
                    {inquiryGuard.sameBrokerTeamOtherProperties.map((row) => (
                      <div key={`${row.propertyId}-${row.sentAt}`}>
                        {row.canonicalAddress} — {formatDateOnly(row.sentAt)}
                        {row.sharedBrokers.length ? ` — shared broker${row.sharedBrokers.length === 1 ? "" : "s"}: ${row.sharedBrokers.join(", ")}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>Broker email</label>
                  <input
                    type="text"
                    value={manualInquiryDraft.to}
                    onChange={(e) => setManualInquiryDraft((prev) => ({ ...prev, to: e.target.value }))}
                    placeholder="Preferred broker email (optional but recommended)"
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>Sent date</label>
                  <input
                    type="date"
                    value={manualInquiryDraft.sentAt}
                    onChange={(e) => setManualInquiryDraft((prev) => ({ ...prev, sentAt: e.target.value }))}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => { setManualInquiryModalOpen(false); setManualInquiryError(null); }} style={{ padding: "0.4rem 0.75rem", border: "1px solid #ccc", borderRadius: "4px", background: "#fff", cursor: "pointer" }}>Cancel</button>
                  <button
                    type="button"
                    disabled={Boolean(manualInquirySaving)}
                    onClick={async () => {
                      setManualInquiryError(null);
                      setManualInquirySaving(true);
                      onWorkflowActivity?.();
                      try {
                        const res = await fetch(`${API_BASE}/api/properties/${property.id}/mark-inquiry-sent`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ to: manualInquiryDraft.to.trim(), sentAt: manualInquiryDraft.sentAt }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          const msg = typeof data?.details === "string" ? data.details : typeof data?.error === "string" ? data.error : "Failed to record inquiry";
                          throw new Error(msg);
                        }
                        setLastInquirySentAt(data.inquirySend?.sentAt ?? data.guard?.lastInquirySentAt ?? null);
                        if (data.guard) {
                          setInquiryGuard(normalizeInquiryGuardState(data.guard));
                        }
                        setInquirySendSuccess("Prior inquiry recorded.");
                        setManualInquiryModalOpen(false);
                        setTimeout(() => setInquirySendSuccess(null), 4000);
                        onWorkflowActivity?.();
                      } catch (e) {
                        setManualInquiryError(e instanceof Error ? e.message : "Failed to record inquiry");
                        onWorkflowActivity?.();
                      } finally {
                        setManualInquirySaving(false);
                      }
                    }}
                    style={{ padding: "0.4rem 0.75rem", border: "1px solid #0066cc", borderRadius: "4px", background: manualInquirySaving ? "#94a3b8" : "#0066cc", color: "#fff", cursor: manualInquirySaving ? "wait" : "pointer" }}
                  >
                    {manualInquirySaving ? "Saving…" : "Save inquiry history"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {displayRentalCards.length > 0 && (
            <div className="rental-om-panel">
              <strong style={{ display: "block", marginBottom: "0.2rem", fontSize: "0.95rem", color: "#1a1a1a" }}>{rentalUnitsHeading}</strong>
              <p style={{ margin: "0 0 0.45rem", fontSize: "0.75rem", color: "#64748b" }}>{rentalUnitsCopy}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "520px", overflowY: "auto" }}>
                {displayRentalCards.map((card, i) => {
                  const mediaRow = card.mediaRow;
                  const financialRow = card.financialRow as Record<string, unknown> | null;
                  const unitImages = (mediaRow?.images ?? []).filter((u): u is string => typeof u === "string");
                  const idx = unitGalleryIndices[i] ?? 0;
                  const setIdx = (n: number) => setUnitGalleryIndices((prev) => ({ ...prev, [i]: n }));
                  const bulletStyle = { margin: "0.2rem 0", fontSize: "0.85rem", color: "#404040" };
                  const referenceStyle = { display: "block", marginTop: "0.1rem", fontSize: "0.74rem", color: "#7a7a7a", fontStyle: "italic" } as const;
                  const unitLabel =
                    (typeof financialRow?.unit === "string" && financialRow.unit.trim()) ||
                    (typeof mediaRow?.unit === "string" && mediaRow.unit.trim()) ||
                    String(i + 1);
                  const omSqft = typeof financialRow?.sqft === "number" ? financialRow.sqft : null;
                  const omBeds = typeof financialRow?.beds === "number" ? financialRow.beds : null;
                  const omBaths = typeof financialRow?.baths === "number" ? financialRow.baths : null;
                  const displaySqft = omSqft ?? mediaRow?.sqft;
                  const displayBeds = omBeds ?? mediaRow?.beds;
                  const displayBaths = omBaths ?? mediaRow?.baths;
                  const displayMonthlyRent =
                    typeof financialRow?.monthlyRent === "number" ? financialRow.monthlyRent : mediaRow?.rentalPrice;
                  const displayAnnualRent =
                    typeof financialRow?.annualRent === "number"
                      ? financialRow.annualRent
                      : typeof financialRow?.monthlyRent === "number"
                        ? Number(financialRow.monthlyRent) * 12
                        : null;
                  const displayLastRented =
                    typeof financialRow?.lastRentedDate === "string" ? financialRow.lastRentedDate : mediaRow?.lastRentedDate;
                  const cardNote = [
                    typeof financialRow?.unitCategory === "string" ? financialRow.unitCategory : null,
                    typeof financialRow?.tenantName === "string" ? financialRow.tenantName : null,
                    typeof financialRow?.rentType === "string" ? financialRow.rentType : null,
                    typeof financialRow?.tenantStatus === "string" ? financialRow.tenantStatus : null,
                    typeof financialRow?.notes === "string" ? financialRow.notes : null,
                  ].filter(Boolean).join("; ");
                  return (
                    <div key={`${unitLabel}-${i}`} style={{ border: "1px solid #e5e5e5", borderRadius: "8px", overflow: "hidden", backgroundColor: "#fafafa", display: "flex", flexDirection: "row", alignItems: "stretch", minHeight: "120px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0.5rem 0.75rem", justifyContent: "center", gap: "0.35rem", minWidth: 0, borderRight: "1px solid #eee" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem", flexWrap: "wrap" }}>
                          <strong style={{ fontSize: "0.95rem", color: "#1a1a1a" }}>Unit {unitLabel}</strong>
                          {mediaRow?.streeteasyUrl && (
                            <a href={mediaRow.streeteasyUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.8rem", color: "#0066cc" }}>View on Streeteasy</a>
                          )}
                          {financialRow && (
                            <span style={{ padding: "0.1rem 0.45rem", borderRadius: "999px", background: "#ecfdf5", color: "#166534", fontSize: "0.72rem", fontWeight: 600 }}>
                              OM values
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "0.75rem 2rem", fontSize: "0.85rem" }}>
                          <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc", flexShrink: 0 }}>
                            <li style={bulletStyle}>
                              Sq ft: {displaySqft != null && displaySqft > 0 ? String(displaySqft) : "—"}
                              {financialRow && mediaRow?.sqft != null && mediaRow.sqft !== displaySqft ? <span style={referenceStyle}>StreetEasy: {String(mediaRow.sqft)}</span> : null}
                            </li>
                            <li style={bulletStyle}>
                              Beds: {displayBeds != null ? String(displayBeds) : "—"}
                              {financialRow && mediaRow?.beds != null && mediaRow.beds !== displayBeds ? <span style={referenceStyle}>StreetEasy: {String(mediaRow.beds)}</span> : null}
                            </li>
                            <li style={bulletStyle}>
                              Baths: {displayBaths != null ? String(displayBaths) : "—"}
                              {financialRow && mediaRow?.baths != null && mediaRow.baths !== displayBaths ? <span style={referenceStyle}>StreetEasy: {String(mediaRow.baths)}</span> : null}
                            </li>
                          </ul>
                          <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc", flexShrink: 0 }}>
                            <li style={bulletStyle}>
                              Monthly rent: {displayMonthlyRent != null ? formatPrice(displayMonthlyRent) : "—"}
                              {financialRow && mediaRow?.rentalPrice != null && mediaRow.rentalPrice !== displayMonthlyRent ? <span style={referenceStyle}>StreetEasy latest: {formatPrice(mediaRow.rentalPrice)}</span> : null}
                            </li>
                            <li style={bulletStyle}>
                              Annual rent: {displayAnnualRent != null ? formatPrice(displayAnnualRent) : "—"}
                            </li>
                            <li style={bulletStyle}>
                              Last rented: {displayLastRented ? formatDateOnly(displayLastRented) : "—"}
                              {financialRow && mediaRow?.lastRentedDate && mediaRow.lastRentedDate !== displayLastRented ? <span style={referenceStyle}>StreetEasy: {formatDateOnly(mediaRow.lastRentedDate)}</span> : null}
                            </li>
                          </ul>
                        </div>
                        {(cardNote || mediaRow?.listedDate) && (
                          <div style={{ fontSize: "0.78rem", color: "#5b5b5b", lineHeight: 1.45, overflowWrap: "anywhere" }}>
                            {cardNote ? cardNote : `Last listed: ${formatDateOnly(mediaRow?.listedDate ?? null)}`}
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, display: "flex", flexDirection: "row", padding: "0.35rem", gap: "0.35rem" }}>
                        {unitImages.length > 0 ? (
                          <>
                            <a href={unitImages[idx]} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, display: "block", maxHeight: "140px", maxWidth: "220px" }}>
                              <img src={unitImages[idx]} alt="" style={{ maxHeight: "140px", maxWidth: "220px", width: "auto", height: "auto", objectFit: "contain", display: "block" }} />
                            </a>
                            <div style={{ display: "flex", flexDirection: "column", flexWrap: "wrap", gap: "0.25rem", maxHeight: "140px", alignContent: "flex-start" }}>
                              {unitImages.map((src, j) => (
                                <button key={j} type="button" onClick={() => setIdx(j)} className={`property-card-gallery-thumb-wrap ${j === idx ? "property-card-gallery-thumb-wrap--active" : ""}`} style={{ flexShrink: 0 }}>
                                  <img src={src} alt="" loading="lazy" className="property-card-gallery-thumb" />
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div style={{ minWidth: "120px", minHeight: "80px", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: "0.85rem" }}>No photo</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {rentRollComparison && !rentRollComparison.comparable && rentalUnits.length > 0 && omRentRoll.length > 0 && (
            <p style={{ margin: "0.5rem 0", padding: "0.35rem 0.5rem", backgroundColor: "#fef3c7", borderRadius: "4px", fontSize: "0.8rem", color: "#92400e" }}>
              <strong>RapidAPI rent roll likely incomplete — comparison disabled.</strong> Only compare when total units and total bedrooms match (RapidAPI: {rentRollComparison.totalUnitsRapid} units, {rentRollComparison.totalBedsRapid} beds; OM: {rentRollComparison.totalUnitsOm} units, {rentRollComparison.totalBedsOm} beds).
            </p>
          )}
          {hasDisplayedOmPanel ? (
            <div className="rental-om-panel">
              <strong style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.95rem", color: "#1a1a1a" }}>{financialsHeading}</strong>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", color: "#64748b" }}>{financialsCopy}</p>
              {hasAuthoritativeOm && authoritativeValidationMessages.length > 0 && (
                <div style={{ marginBottom: "0.6rem", padding: "0.45rem 0.55rem", backgroundColor: "#fefce8", borderRadius: "6px", fontSize: "0.8rem" }}>
                  <strong style={{ display: "block", marginBottom: "0.2rem" }}>Validation flags</strong>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.45 }}>
                    {authoritativeValidationMessages.slice(0, 4).map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {hasAuthoritativeOm && authoritativeSummary && Object.values(authoritativeSummary).some((value) => value != null) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem 1rem", marginBottom: "0.75rem", fontSize: "0.8rem" }}>
                  {(() => {
                    const summary = authoritativeSummary as Record<string, unknown>;
                    const order: string[] = ["grossRent", "otherIncome", "effectiveGrossIncome", "_expenses", "noi"];
                    const labels: Record<string, string> = {
                      grossRent: "Gross rent",
                      otherIncome: "Other income",
                      effectiveGrossIncome: "EGI",
                      _expenses: "Expenses",
                      noi: "NOI",
                    };
                    return order.map((key) => {
                      const raw = summary[key];
                      if (raw == null) return null;
                      const num = typeof raw === "number" ? raw : (typeof raw === "string" ? Number(raw.replace(/[$,%\s]/g, "")) : NaN);
                      const display = !Number.isNaN(num) ? formatPrice(num) : String(raw);
                      return (
                        <div key={key} style={{ padding: "0.25rem 0.5rem", backgroundColor: "#f8fafc", borderRadius: "4px" }}>
                          <span style={{ color: "#64748b", display: "block", fontSize: "0.7rem" }}>{labels[key] ?? key}</span>
                          <span style={{ fontWeight: 600 }}>{display}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              {omRentRoll.length > 0 && displayRentalCards.length === 0 && (
                <div style={{ marginBottom: "0.6rem" }}>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>Rent roll</span>
                  <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", tableLayout: "auto" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
                          <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Unit</th>
                          <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Monthly</th>
                          <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Annual</th>
                          {omRentRoll.some((u) => u.beds != null) && <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Beds</th>}
                          {omRentRoll.some((u) => u.baths != null) && <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Baths</th>}
                          {omRentRoll.some((u) => u.sqft != null) && <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Sq ft</th>}
                          {omRentRoll.some((u) => (u as { occupied?: boolean | string }).occupied != null) && <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Occupied</th>}
                          {omRentRoll.some((u) => (u as { lastRentedDate?: string }).lastRentedDate != null) && <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Last rented</th>}
                          {omRentRoll.some((u) => (u as { dateVacant?: string }).dateVacant != null) && <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Date vacant</th>}
                          {(omRentRoll.some((u) => u.notes) || omRentRoll.some((u) => u.rentType)) && <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600, minWidth: "220px" }}>Note</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {omRentRoll.map((u, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{u.unit ?? "—"}</td>
                            <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{u.monthlyRent != null ? formatPrice(u.monthlyRent) : "—"}</td>
                            <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{u.annualRent != null ? formatPrice(u.annualRent) : u.monthlyRent != null ? formatPrice(u.monthlyRent * 12) : "—"}</td>
                            {omRentRoll.some((x) => x.beds != null) && <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{u.beds != null ? String(u.beds) : "—"}</td>}
                            {omRentRoll.some((x) => x.baths != null) && <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{u.baths != null ? String(u.baths) : "—"}</td>}
                            {omRentRoll.some((x) => x.sqft != null) && <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{u.sqft != null ? u.sqft.toLocaleString() : "—"}</td>}
                            {omRentRoll.some((x) => (x as { occupied?: boolean | string }).occupied != null) && <td style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>{(u as { occupied?: boolean | string }).occupied === true ? "Yes" : (u as { occupied?: boolean | string }).occupied === false ? "No" : String((u as { occupied?: boolean | string }).occupied ?? "—")}</td>}
                            {omRentRoll.some((x) => (x as { lastRentedDate?: string }).lastRentedDate != null) && <td style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>{(u as { lastRentedDate?: string }).lastRentedDate ?? "—"}</td>}
                            {omRentRoll.some((x) => (x as { dateVacant?: string }).dateVacant != null) && <td style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontSize: "0.75rem" }}>{(u as { dateVacant?: string }).dateVacant ?? "—"}</td>}
                            {omRentRoll.some((x) => x.notes || x.rentType) && (
                              <td style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontSize: "0.75rem", color: "#555", minWidth: "220px", whiteSpace: "normal", overflowWrap: "anywhere" }}>{[u.rentType, u.tenantStatus, u.notes].filter(Boolean).join("; ") || "—"}</td>
                            )}
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid #e2e8f0", backgroundColor: "#f8fafc", fontWeight: 600 }}>
                          <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>Total rent roll</td>
                          <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{formatPrice(omRentRoll.reduce((s, u) => s + (u.monthlyRent ?? 0), 0))}</td>
                          <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>{formatPrice(omRentRoll.reduce((s, u) => s + (u.annualRent ?? (u.monthlyRent ?? 0) * 12), 0))}</td>
                          {(omRentRoll.some((x) => x.beds != null) || omRentRoll.some((x) => x.baths != null) || omRentRoll.some((x) => x.sqft != null) || omRentRoll.some((x) => (x as { occupied?: unknown }).occupied != null) || omRentRoll.some((x) => (x as { lastRentedDate?: unknown }).lastRentedDate != null) || omRentRoll.some((x) => (x as { dateVacant?: unknown }).dateVacant != null) || omRentRoll.some((x) => x.notes || x.rentType)) && (
                            <td colSpan={[omRentRoll.some((x) => x.beds != null), omRentRoll.some((x) => x.baths != null), omRentRoll.some((x) => x.sqft != null), omRentRoll.some((x) => (x as { occupied?: unknown }).occupied != null), omRentRoll.some((x) => (x as { lastRentedDate?: unknown }).lastRentedDate != null), omRentRoll.some((x) => (x as { dateVacant?: unknown }).dateVacant != null), omRentRoll.some((x) => x.notes || x.rentType)].filter(Boolean).length} style={{ textAlign: "center", padding: "0.4rem 0.5rem" }} />
                          )}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {displayedExpenseTable.length > 0 && (
                <div style={{ marginBottom: "0.6rem" }}>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "#666", marginBottom: "0.25rem" }}>Expenses</span>
                  <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
                          <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Line item</th>
                          <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedExpenseTable.map((row, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "0.4rem 0.5rem" }}>{row.lineItem ?? "—"}</td>
                            <td style={{ textAlign: "right", padding: "0.4rem 0.5rem" }}>{formatPrice(row.amount ?? null)}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid #e2e8f0", backgroundColor: "#f8fafc", fontWeight: 600 }}>
                          <td style={{ padding: "0.4rem 0.5rem" }}>Total expenses</td>
                          <td style={{ textAlign: "right", padding: "0.4rem 0.5rem" }}>{formatPrice(displayedExpenseTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rental-om-panel">
              <strong style={{ display: "block", marginBottom: "0.2rem", fontSize: "0.9rem", color: "#1a1a1a" }}>{financialsHeading}</strong>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b", lineHeight: 1.45 }}>{financialsCopy}</p>
            </div>
          )}
          <div className="rental-om-doc-grid">
            <div className="rental-om-panel rental-om-panel--documents">
              <strong style={{ display: "block", marginBottom: "0.2rem" }}>Documents</strong>
              <p style={{ margin: "0 0 0.35rem", fontSize: "0.75rem", color: "#666" }}>Inquiry attachments, uploaded docs, and generated dossier/Excel.</p>
              {unifiedDocuments === null ? (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#737373" }}>Loading…</p>
              ) : unifiedDocuments.length > 0 ? (
                <div className="rental-om-doc-list">
                  {unifiedDocuments.map((doc) => (
                    <div key={doc.id} className="rental-om-doc-card">
                      <div style={{ minWidth: 0 }}>
                        <a
                          href={`${API_BASE}/api/properties/${property.id}/documents/${doc.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#0066cc", fontWeight: 600, overflowWrap: "anywhere" }}
                        >
                          {doc.fileName}
                        </a>
                        <div style={{ fontSize: "0.75rem", color: "#555", marginTop: "0.15rem" }}>{doc.source}</div>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(deletingDocId === doc.id)}
                        onClick={async () => {
                          if (deletingDocId) return;
                          setDeletingDocId(doc.id);
                          try {
                            const res = await fetch(
                              `${API_BASE}/api/properties/${property.id}/documents/${doc.id}?sourceType=${encodeURIComponent(doc.sourceType)}`,
                              { method: "DELETE" }
                            );
                            if (!res.ok) {
                              const data = await res.json().catch(() => ({}));
                              throw new Error(typeof data?.details === "string" ? data.details : data?.error ?? "Failed to remove");
                            }
                            setUnifiedDocuments((prev) => (prev ? prev.filter((d) => d.id !== doc.id) : []));
                          } catch (e) {
                            setUploadError(e instanceof Error ? e.message : "Failed to remove document");
                          } finally {
                            setDeletingDocId(null);
                          }
                        }}
                        style={{ flexShrink: 0, padding: "0.28rem 0.55rem", fontSize: "0.75rem", border: "1px solid #dc2626", borderRadius: "999px", background: "#fff", color: "#dc2626", cursor: deletingDocId === doc.id ? "wait" : "pointer" }}
                      >
                        {deletingDocId === doc.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#737373" }}>No documents yet. Send an inquiry, upload a file, or use the Deal dossier section above to generate the PDF and Excel.</p>
              )}
            </div>
            <div className="rental-om-panel rental-om-panel--upload">
              <strong style={{ display: "block", marginBottom: "0.2rem" }}>Upload document</strong>
              <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
                const categorySelect = form.querySelector<HTMLSelectElement>('select[name="docCategory"]');
                const file = fileInput?.files?.[0];
                if (!file) {
                  setUploadError("Select a file.");
                  return;
                }
                setUploadError(null);
                setUploading(true);
                try {
                  const formData = new FormData();
                  formData.append("file", file);
                  formData.append("category", categorySelect?.value ?? "Other");
                  const sourceInput = form.querySelector<HTMLInputElement>('input[name="docSource"]');
                  if (sourceInput?.value?.trim()) formData.append("source", sourceInput.value.trim());
                  const res = await fetch(`${API_BASE}/api/properties/${property.id}/documents/upload`, {
                    method: "POST",
                    body: formData,
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : data?.details ?? "Upload failed");
                  setUnifiedDocuments((prev) => (prev ? [{ id: data.document.id, fileName: data.document.filename, fileType: data.document.contentType ?? null, source: data.document.category ?? "uploaded", sourceType: "uploaded", createdAt: data.document.createdAt }, ...prev] : [{ id: data.document.id, fileName: data.document.filename, fileType: data.document.contentType ?? null, source: data.document.category ?? "uploaded", sourceType: "uploaded", createdAt: data.document.createdAt }]));
                  form.reset();
                  fileInput.value = "";
                } catch (err) {
                  setUploadError(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setUploading(false);
                }
              }}
              style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}
            >
              <input type="file" name="file" style={{ fontSize: "0.8rem" }} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*" />
              <input type="text" name="docSource" placeholder="Source (e.g. Broker, Listing agent)" style={{ padding: "0.35rem 0.5rem", fontSize: "0.8rem", border: "1px solid #ccc", borderRadius: "4px", minWidth: "140px" }} />
              <select name="docCategory" style={{ padding: "0.35rem 0.5rem", fontSize: "0.8rem", border: "1px solid #ccc", borderRadius: "4px" }}>
                <option value="OM">OM</option>
                <option value="Brochure">Brochure</option>
                <option value="Rent Roll">Rent Roll</option>
                <option value="Financial Model">Financial Model</option>
                <option value="T12 / Operating Summary">T12 / Operating Summary</option>
                <option value="Other">Other</option>
              </select>
              <button type="submit" disabled={Boolean(uploading)} style={{ padding: "0.35rem 0.6rem", fontSize: "0.8rem", border: "1px solid #0066cc", borderRadius: "4px", background: uploading ? "#94a3b8" : "#0066cc", color: "#fff", cursor: uploading ? "wait" : "pointer" }}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
              </form>
              {uploadError && <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#b91c1c" }}>{uploadError}</p>}
            </div>
          </div>
          {listingForDisplay?.rentalPriceHistory?.length && rentalUnits.length === 0 && !hasAuthoritativeOm ? (
            <div className="initial-info-price-history-list">
              {listingForDisplay.rentalPriceHistory.slice(0, 10).map((r, i) => (
                <div key={i} className="initial-info-price-history-row">
                  <span className="initial-info-price-history-date">{formatPriceHistoryDate(r.date)}</span>
                  <span className="initial-info-price-history-sep">·</span>
                  <span className="initial-info-price-history-price">{formatPriceCompact(r.price)}</span>
                  <span className="initial-info-price-history-sep">·</span>
                  <span className="initial-info-price-history-event">{formatPriceEventLabel(r.event)}</span>
                </div>
              ))}
            </div>
          ) : rentalUnits.length === 0 && !hasAuthoritativeOm ? (
            <p style={{ color: "#737373", margin: 0 }}>—</p>
          ) : null}
        </div>
      </CollapsibleSection>

      {/* 6. Violations, complaints, permits — one table */}
      <CollapsibleSection
        id="violations-complaints-permits"
        title="Violations, complaints, permits"
        count={unifiedRows.length}
        open={!!openSections.violationsComplaintsPermits}
        onToggle={() => { toggle("violationsComplaintsPermits"); if (!unifiedFetched) fetchUnifiedTable(); }}
      >
        {unifiedLoading ? (
          <p style={{ color: "#737373" }}>Loading…</p>
        ) : unifiedRows.length === 0 ? (
          <p style={{ color: "#737373" }}>No permits, violations, complaints, or litigations on file. Open this section to load data.</p>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "7rem", minWidth: "7rem" }} />
                <col style={{ width: "8rem", minWidth: "8rem" }} />
                <col style={{ width: "auto" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                  <th style={{ textAlign: "left", padding: "0.5rem 0.75rem 0.5rem 0" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Category</th>
                  <th style={{ textAlign: "left", padding: "0.5rem 0 0.5rem 0.75rem" }}>Info</th>
                </tr>
              </thead>
              <tbody>
                {unifiedRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "0.5rem 0.75rem 0.5rem 0", whiteSpace: "nowrap", verticalAlign: "top" }}>{row.date}</td>
                    <td style={{ padding: "0.5rem 0.75rem", verticalAlign: "top" }}>{row.category}</td>
                    <td style={{ padding: "0.5rem 0 0.5rem 0.75rem", wordBreak: "break-word", verticalAlign: "top" }}>{row.info}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      <div style={{ marginTop: "1.5rem", fontSize: "0.8rem", color: "#64748b" }}>
        Deal dossier generation now runs from the dedicated section above using these property-level costs plus your saved profile defaults.
      </div>
    </div>
  );
}
