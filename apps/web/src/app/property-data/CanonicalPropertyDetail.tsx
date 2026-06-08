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
import { buildInquiryDraft, updateInquiryDraftTourRequest } from "./inquiryDraft";
import {
  plannedBrokerCompReviewEndpoint,
  plannedBrokerCompUploadEndpoint,
  readBrokerCompSurface,
  type BrokerCompUiSurface,
} from "./brokerComps";
import { formatSourcingUpdateChange, getSourcingUpdate, getSourcingUpdateMeta } from "./sourcingUpdate";
import {
  OmCalculationPanel,
  OM_CALC_NUMERIC_FIELDS,
  type OmCalculationDraft,
  type OmCalculationExpenseModelRow,
  type OmCalculationNumericField,
  type OmCalculationSnapshot,
  type OmCalculationTextField,
  type OmCalculationUnitModelRow,
} from "./OmCalculationPanel";
import {
  PropertyDetailWorkspace,
  type PropertyDetailActivityItem,
  type PropertyDetailRailItem,
  type PropertyDetailTabId,
  type PropertyDetailTabItem,
} from "./PropertyDetailWorkspace";

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
  pipelineStatus?: string | null;
  enrichmentStatus?: string | null;
  rentalFlowStatus?: string | null;
  underwritingStatus?: string | null;
  dossierStatus?: string | null;
  excelStatus?: string | null;
  propertyTags?: string[] | null;
  defaultTags?: string[] | null;
  missingFields?: string[] | null;
  actionRequired?: string[] | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
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

interface DossierAssumptionsResponse {
  defaults?: {
    buildingSqft?: number | null;
    purchasePrice?: number | null;
    purchaseClosingCostPct?: number | null;
    renovationCosts?: number | null;
    furnishingSetupCosts?: number | null;
    investmentProfile?: string | null;
    targetAcquisitionDate?: string | null;
    ltvPct?: number | null;
    interestRatePct?: number | null;
    amortizationYears?: number | null;
    loanFeePct?: number | null;
    rentUpliftPct?: number | null;
    expenseIncreasePct?: number | null;
    managementFeePct?: number | null;
    occupancyTaxPct?: number | null;
    vacancyPct?: number | null;
    leadTimeMonths?: number | null;
    annualRentGrowthPct?: number | null;
    annualCommercialRentGrowthPct?: number | null;
    annualOtherIncomeGrowthPct?: number | null;
    annualExpenseGrowthPct?: number | null;
    annualPropertyTaxGrowthPct?: number | null;
    recurringCapexAnnual?: number | null;
    currentNoi?: number | null;
    holdPeriodYears?: number | null;
    exitCapPct?: number | null;
    exitClosingCostPct?: number | null;
    targetIrrPct?: number | null;
    unitModelRows?: OmCalculationUnitModelRow[] | null;
    expenseModelRows?: OmCalculationExpenseModelRow[] | null;
    brokerEmailNotes?: string | null;
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

function documentIsPdf(doc: { fileName?: string | null; fileType?: string | null }): boolean {
  return /pdf/i.test(doc.fileType ?? "") || /\.pdf$/i.test(doc.fileName ?? "");
}

function documentIsImage(doc: { fileName?: string | null; fileType?: string | null }): boolean {
  return /^image\//i.test(doc.fileType ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(doc.fileName ?? "");
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

function formatReadableToken(value: unknown): string {
  if (value == null) return "—";
  const raw = String(value).trim();
  if (!raw) return "—";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNumberValue(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString();
}

function formatMoneyValue(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return String(value);
  return formatPrice(n);
}

function compactText(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  return raw.length > 0 ? raw : null;
}

function splitTakeawayText(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => splitTakeawayText(entry))
      .filter((entry, index, arr) => arr.indexOf(entry) === index);
  }
  const raw = compactText(value);
  if (!raw) return [];
  return raw
    .replace(/\s+/g, " ")
    .split(/(?:\n+|(?:^|\s)(?:[•*-]|\d+\.)\s+|(?<=\.)\s+(?=[A-Z][A-Za-z ]{2,24}:))/)
    .map((entry) => entry.trim().replace(/^[-•*\d.]+\s*/, ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 8);
}

function joinedSummary(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ") || "—";
}

type V3FactItem = {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger";
};

function V3ReportPanel({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="v3-report-panel">
      <div className="v3-report-panel-header">
        <div>
          <h3 className="v3-report-panel-title">{title}</h3>
          {subtitle ? (
            <p className="v3-report-panel-subtitle">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="v3-report-panel-actions">{actions}</div> : null}
      </div>
      <div className="v3-report-panel-body">{children}</div>
    </section>
  );
}

function V3ReportSection({
  title,
  children,
  subtitle,
}: {
  title: string;
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <section className="v3-report-section">
      <div>
        <h4 className="v3-report-section-title">{title}</h4>
        {subtitle ? (
          <p className="v3-report-section-subtitle">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function V3FactList({ items }: { items: V3FactItem[] }) {
  return (
    <dl className="v3-fact-list">
      {items.map((item) => (
        <div key={item.label} className="v3-fact-row">
          <dt className="v3-fact-label">{item.label}</dt>
          <dd
            className={`v3-fact-value v3-fact-value--${item.tone ?? "neutral"}`}
          >
            {item.value}
          </dd>
          {item.detail ? (
            <div className="v3-fact-detail">{item.detail}</div>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function V3Bullets({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="v3-empty-copy">No summary available yet.</p>;
  }
  return (
    <ul className="v3-bullet-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function V3RecordsTable({
  columns,
  rows,
  emptyText,
}: {
  columns: Array<{ key: string; label: string; width?: string; align?: "left" | "right" | "center" }>;
  rows: Array<Record<string, React.ReactNode>>;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          border: "1px dashed rgba(38, 47, 44, 0.18)",
          borderRadius: "8px",
          padding: "0.8rem",
          color: "#7a847d",
          fontSize: "0.86rem",
          background: "#fbfaf6",
        }}
      >
        {emptyText}
      </div>
    );
  }
  return (
    <div
      style={{
        maxHeight: "380px",
        overflow: "auto",
        border: "1px solid rgba(38, 47, 44, 0.12)",
        borderRadius: "8px",
        background: "#fff",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: "720px" }}>
        <thead>
          <tr style={{ background: "#f5f2eb", borderBottom: "1px solid rgba(38, 47, 44, 0.12)" }}>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  width: column.width,
                  padding: "0.55rem 0.65rem",
                  textAlign: column.align ?? "left",
                  color: "#59645f",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: 0,
                  background: "#f5f2eb",
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ borderBottom: "1px solid rgba(38, 47, 44, 0.08)" }}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    padding: "0.58rem 0.65rem",
                    textAlign: column.align ?? "left",
                    color: "#1f2933",
                    verticalAlign: "middle",
                    overflowWrap: "anywhere",
                  }}
                >
                  {row[column.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface BrokerCompSubjectBaseline {
  price: number | null;
  priceSource?: string | null;
  sqft: number | null;
  pricePerSqft: number | null;
  capRatePct: number | null;
  rentPsfByBedroom: Record<string, number>;
}

function BrokerCompsDetailPanel({
  propertyId,
  surface,
  subject,
}: {
  propertyId: string;
  surface: BrokerCompUiSurface;
  subject: BrokerCompSubjectBaseline;
}) {
  const uploadEndpoint = plannedBrokerCompUploadEndpoint(propertyId);
  const reviewEndpoint = plannedBrokerCompReviewEndpoint(propertyId);
  const [livePayload, setLivePayload] = useState<unknown | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const activeSurface = readBrokerCompSurface(livePayload, surface);

  const loadBrokerComps = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}${reviewEndpoint}?limit=20&refresh=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : `Failed to load broker comps (${response.status})`;
        throw new Error(message);
      }
      setLivePayload(payload);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load broker comps.");
    } finally {
      setLoading(false);
    }
  }, [reviewEndpoint]);

  useEffect(() => {
    setLivePayload(null);
    setSelectedFile(null);
    void loadBrokerComps();
  }, [loadBrokerComps]);

  async function uploadSelectedPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      form.append("category", "Broker Comp Package");
      const response = await fetch(`${API_BASE}${uploadEndpoint}`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : `Upload failed (${response.status})`;
        throw new Error(message);
      }
      setLivePayload(payload);
      setSelectedFile(null);
      await loadBrokerComps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload broker comp package.");
    } finally {
      setUploading(false);
    }
  }

  const formatWholeMoney = (value: unknown): string => {
    if (value == null || value === "") return "—";
    const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  };
  const formatPpsf = (value: unknown): string => {
    const money = formatWholeMoney(value);
    return money === "—" ? money : money;
  };
  const formatPercentValue = (value: unknown): string => {
    if (value == null || value === "") return "—";
    const n = typeof value === "number" ? value : Number(String(value).replace(/[,%\s]/g, ""));
    return Number.isFinite(n) ? `${n.toFixed(n % 1 === 0 ? 0 : 1)}%` : String(value);
  };
  const formatSqftValue = (value: unknown): string => {
    const formatted = formatNumberValue(value);
    return formatted === "—" ? formatted : `${formatted} SF`;
  };
  const formatSignedPercent = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return "—";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
  };
  const formatSignedMoney = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return "—";
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${formatWholeMoney(Math.abs(value))}`;
  };
  const weightedPpsf = (rows: Array<{ price: number | null; interiorSqft: number | null; ppsf: number | null }>): number | null => {
    const totals = rows.reduce(
      (acc, row) => {
        if (row.price != null && row.interiorSqft != null && row.price > 0 && row.interiorSqft > 0) {
          acc.price += row.price;
          acc.sqft += row.interiorSqft;
        }
        if (row.ppsf != null && row.ppsf > 0) {
          acc.ppsfSum += row.ppsf;
          acc.ppsfCount += 1;
        }
        return acc;
      },
      { price: 0, sqft: 0, ppsfSum: 0, ppsfCount: 0 }
    );
    if (totals.price > 0 && totals.sqft > 0) return totals.price / totals.sqft;
    return totals.ppsfCount > 0 ? totals.ppsfSum / totals.ppsfCount : null;
  };
  const subjectPackagePpsf = weightedPpsf(activeSurface.subjectUnitPricingRows);
  const subjectOverallPpsf = subjectPackagePpsf ?? subject.pricePerSqft;
  const subjectPpsfSource = subjectPackagePpsf != null ? "Projected package" : subject.pricePerSqft != null ? subject.priceSource ?? "Deal baseline" : null;
  const subjectBedroomPpsf = new Map<number, number>();
  for (const bedroom of [...new Set(activeSurface.subjectUnitPricingRows.map((row) => row.bedrooms).filter((value): value is number => value != null))]) {
    const ppsf = weightedPpsf(activeSurface.subjectUnitPricingRows.filter((row) => row.bedrooms === bedroom));
    if (ppsf != null) subjectBedroomPpsf.set(bedroom, ppsf);
  }
  const compPpsfForProject = (row: { soldPpsf: number | null; askingPpsf: number | null; pricePerSqft: number | null }): number | null =>
    row.soldPpsf ?? row.askingPpsf ?? row.pricePerSqft;
  const compPpsfForBedroom = (row: { avgSoldPpsf: number | null; avgAskingPpsf: number | null }): number | null =>
    row.avgSoldPpsf ?? row.avgAskingPpsf;
  const comparisonDelta = (subjectValue: number | null, compValue: number | null): { diff: number | null; pct: number | null } => {
    if (subjectValue == null || compValue == null || !Number.isFinite(subjectValue) || !Number.isFinite(compValue) || compValue <= 0) {
      return { diff: null, pct: null };
    }
    const diff = subjectValue - compValue;
    return { diff, pct: (diff / compValue) * 100 };
  };
  const renderPpsfSpread = (subjectValue: number | null, compValue: number | null): React.ReactNode => {
    const delta = comparisonDelta(subjectValue, compValue);
    if (delta.diff == null || delta.pct == null) return "—";
    const tone = delta.diff <= 0 ? "#166534" : "#991b1b";
    return (
      <span style={{ color: tone, fontWeight: 700 }}>
        {formatSignedMoney(delta.diff)} <span style={{ color: "#64748b", fontWeight: 600 }}>({formatSignedPercent(delta.pct)})</span>
      </span>
    );
  };
  const renderRentSpread = (subjectRentPsf: number | null, compRentPsf: number | null): React.ReactNode => {
    const delta = comparisonDelta(subjectRentPsf, compRentPsf);
    if (delta.diff == null || delta.pct == null) return "—";
    const tone = delta.diff <= 0 ? "#166534" : "#991b1b";
    return <span style={{ color: tone, fontWeight: 700 }}>{formatSignedMoney(delta.diff)} ({formatSignedPercent(delta.pct)})</span>;
  };
  const averageSpreadPct = (pairs: Array<{ subjectValue: number | null; compValue: number | null }>): number | null => {
    const spreads = pairs
      .map((pair) => comparisonDelta(pair.subjectValue, pair.compValue).pct)
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (spreads.length === 0) return null;
    return spreads.reduce((sum, value) => sum + value, 0) / spreads.length;
  };
  const projectSpreadPct = averageSpreadPct(
    activeSurface.comparables
      .filter((row) => row.itemType === "pricing_comp")
      .map((row) => ({ subjectValue: subjectOverallPpsf, compValue: compPpsfForProject(row) }))
  );
  const bedroomSpreadPct = averageSpreadPct(
    activeSurface.bedroomBreakdowns.map((row) => ({
      subjectValue: row.bedrooms != null ? subjectBedroomPpsf.get(row.bedrooms) ?? subjectOverallPpsf : subjectOverallPpsf,
      compValue: compPpsfForBedroom(row),
    }))
  );
  const hasBedroomRentComps = activeSurface.bedroomBreakdowns.some((row) => row.avgRentPerSqft != null || row.avgRentMonthly != null);

  const pricingCompRows = activeSurface.comparables.filter((row) => row.itemType === "pricing_comp");
  const averageNumber = (values: Array<number | null | undefined>): number | null => {
    const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
    if (clean.length === 0) return null;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
  };
  const weightedAverageNumber = (rows: Array<{ value: number | null; weight: number | null }>): number | null => {
    const totals = rows.reduce<{ value: number; weight: number }>(
      (acc, row) => {
        const value = row.value;
        if (value == null || !Number.isFinite(value)) return acc;
        const weight = row.weight != null && Number.isFinite(row.weight) && row.weight > 0 ? row.weight : 1;
        acc.value += value * weight;
        acc.weight += weight;
        return acc;
      },
      { value: 0, weight: 0 }
    );
    return totals.weight > 0 ? totals.value / totals.weight : null;
  };
  const priceRangeLabel = (low: number | null, high: number | null, fallback?: string | null): string => {
    if (fallback) return fallback;
    if (low != null && high != null) return `${formatWholeMoney(low)} - ${formatWholeMoney(high)}`;
    if (low != null) return formatWholeMoney(low);
    if (high != null) return formatWholeMoney(high);
    return "—";
  };
  const sourcePackage = activeSurface.packages.find((pkg) => pkg.packageType !== "broker_opinion") ?? activeSurface.packages[0] ?? null;
  const packageProjectedSelloutFromRows = activeSurface.subjectUnitPricingRows.reduce((sum, row) => sum + (row.price ?? 0), 0);
  const packageProjectedSellout =
    packageProjectedSelloutFromRows > 0
      ? packageProjectedSelloutFromRows
      : activeSurface.pricingOpinions.find((opinion) => opinion.sourceType === "package" && opinion.amount != null)?.amount ?? null;
  const packageVsListing = packageProjectedSellout != null && subject.price != null ? packageProjectedSellout - subject.price : null;
  const packageVsListingPct = packageProjectedSellout != null && subject.price != null && subject.price > 0 ? ((packageVsListing ?? 0) / subject.price) * 100 : null;
  const brokerPriceSignal =
    activeSurface.pricingOpinions.find((opinion) => opinion.sourceType !== "package" && opinion.amount != null) ??
    activeSurface.pricingOpinions.find((opinion) => opinion.amount != null) ??
    null;
  const brokerSignalVsListing =
    brokerPriceSignal?.amount != null && subject.price != null ? brokerPriceSignal.amount - subject.price : null;
  const brokerSignalVsListingPct =
    brokerPriceSignal?.amount != null && subject.price != null && subject.price > 0 ? ((brokerSignalVsListing ?? 0) / subject.price) * 100 : null;
  const averageProjectPpsf = averageNumber(pricingCompRows.map(compPpsfForProject));
  const pricingFacts: V3FactItem[] = [
    { label: "Deal price", value: formatWholeMoney(subject.price), detail: subject.priceSource ?? null },
    { label: "Package sellout", value: formatWholeMoney(packageProjectedSellout), detail: "Projected pricing from comp package" },
    {
      label: "Package vs deal",
      value: packageVsListing == null ? "—" : formatSignedMoney(packageVsListing),
      detail: packageVsListingPct == null ? null : formatSignedPercent(packageVsListingPct),
      tone: packageVsListing == null ? "neutral" : packageVsListing > 0 ? "warn" : "good",
    },
    {
      label: "Broker/user price",
      value: formatWholeMoney(brokerPriceSignal?.amount),
      detail: brokerSignalVsListingPct == null
        ? brokerPriceSignal?.source ?? null
        : `${formatSignedPercent(brokerSignalVsListingPct)} vs deal${brokerPriceSignal?.source ? ` · ${brokerPriceSignal.source}` : ""}`,
      tone: brokerSignalVsListing == null ? "neutral" : brokerSignalVsListing > 0 ? "warn" : "good",
    },
    { label: "Subject $/SF", value: formatPpsf(subjectOverallPpsf), detail: subjectPpsfSource },
    { label: "Avg comp $/SF", value: formatPpsf(averageProjectPpsf) },
    { label: "Avg project spread", value: formatSignedPercent(projectSpreadPct), tone: projectSpreadPct == null ? "neutral" : projectSpreadPct <= 0 ? "good" : "warn" },
    { label: "Avg bedroom spread", value: formatSignedPercent(bedroomSpreadPct), tone: bedroomSpreadPct == null ? "neutral" : bedroomSpreadPct <= 0 ? "good" : "warn" },
    { label: "Loaded", value: formatDateOnly(lastLoadedAt ?? activeSurface.updatedAt), detail: sourcePackage ? sourcePackage.label : null },
  ];
  const buildingRows = pricingCompRows.map((row) => ({
    property: (
      <div style={{ display: "grid", gap: "0.12rem" }}>
        <strong>{row.propertyName ?? row.address ?? "Unlabeled comp"}</strong>
        {row.address ? <span style={{ color: "#64748b", fontSize: "0.78rem" }}>{row.address}</span> : null}
      </div>
    ),
    neighborhood: row.neighborhood ?? "—",
    year: formatNumberValue(row.yearCompleted),
    floors: formatNumberValue(row.floors),
    units: formatNumberValue(row.units),
    salesBegan: row.salesBegan ?? "—",
    sold: formatPercentValue(row.percentSoldPct),
    avgSize: formatSqftValue(row.averageUnitSqft),
    askPpsf: formatPpsf(row.askingPpsf ?? row.pricePerSqft),
    soldPpsf: formatPpsf(row.soldPpsf),
    range: priceRangeLabel(row.priceRangeLow, row.priceRangeHigh, row.priceRange),
  }));
  const bedroomRows = [...activeSurface.bedroomBreakdowns]
    .sort((left, right) => {
      const bedDelta = (left.bedrooms ?? 99) - (right.bedrooms ?? 99);
      if (bedDelta !== 0) return bedDelta;
      return (left.address ?? "").localeCompare(right.address ?? "");
    })
    .map((row) => {
      const subjectBedroomValue = row.bedrooms != null ? subjectBedroomPpsf.get(row.bedrooms) ?? subjectOverallPpsf : subjectOverallPpsf;
      const compPpsf = compPpsfForBedroom(row);
      const compRentPsf = row.avgRentPerSqft ?? (row.avgRentMonthly != null && row.avgSizeSqft != null && row.avgSizeSqft > 0 ? row.avgRentMonthly / row.avgSizeSqft : null);
      const subjectRentPsf = row.bedrooms != null ? subject.rentPsfByBedroom[String(row.bedrooms)] ?? null : null;
      return {
        address: (
          <div style={{ display: "grid", gap: "0.12rem" }}>
            <strong>{row.propertyName ?? row.address ?? "Unlabeled comp"}</strong>
            {row.address ? <span style={{ color: "#64748b", fontSize: "0.78rem" }}>{row.address}</span> : null}
          </div>
        ),
        bedBath: joinedSummary([row.bedroomType ?? (row.bedrooms != null ? `${row.bedrooms} Bed` : null), row.bathrooms != null ? `${row.bathrooms} Bath` : null]),
        offered: formatNumberValue(row.count),
        avgSize: formatSqftValue(row.avgSizeSqft),
        askPpsf: formatPpsf(row.avgAskingPpsf),
        soldPpsf: formatPpsf(row.avgSoldPpsf),
        avgCc: row.avgCommonChargesMonthly != null ? `${formatWholeMoney(row.avgCommonChargesMonthly)}/mo` : "—",
        subjectPpsf: formatPpsf(subjectBedroomValue),
        psfSpread: renderPpsfSpread(subjectBedroomValue, compPpsf),
        rentPsf: compRentPsf != null ? formatMoneyValue(compRentPsf) : "—",
        rentSpread: renderRentSpread(subjectRentPsf, compRentPsf),
        range: priceRangeLabel(row.priceRangeLow, row.priceRangeHigh, row.priceRange),
      };
    });
  const bedroomSummaryGroups = new Map<string, { bedrooms: number | null; label: string; rows: typeof activeSurface.bedroomBreakdowns }>();
  for (const row of activeSurface.bedroomBreakdowns) {
    const key = row.bedrooms != null ? String(row.bedrooms) : row.bedroomType ?? "unknown";
    const label = row.bedroomType ?? (row.bedrooms != null ? `${row.bedrooms} Bed` : "Unknown");
    const existing = bedroomSummaryGroups.get(key);
    if (existing) existing.rows.push(row);
    else bedroomSummaryGroups.set(key, { bedrooms: row.bedrooms, label, rows: [row] });
  }
  const bedroomSummaryRows = [...bedroomSummaryGroups.values()]
    .sort((left, right) => (left.bedrooms ?? 99) - (right.bedrooms ?? 99))
    .map((group) => {
      const subjectBedroomRows = group.bedrooms != null
        ? activeSurface.subjectUnitPricingRows.filter((row) => row.bedrooms === group.bedrooms)
        : [];
      const subjectBedroomValue = group.bedrooms != null ? subjectBedroomPpsf.get(group.bedrooms) ?? subjectOverallPpsf : subjectOverallPpsf;
      const compAskPpsf = weightedAverageNumber(group.rows.map((row) => ({ value: row.avgAskingPpsf, weight: row.count })));
      const compSoldPpsf = weightedAverageNumber(group.rows.map((row) => ({ value: row.avgSoldPpsf, weight: row.count })));
      const compPpsf = compSoldPpsf ?? compAskPpsf;
      const subjectAvgSize = subjectBedroomRows.length > 0 ? averageNumber(subjectBedroomRows.map((row) => row.interiorSqft)) : null;
      const avgCc = weightedAverageNumber(group.rows.map((row) => ({ value: row.avgCommonChargesMonthly, weight: row.count })));
      return {
        bed: group.label,
        compRows: formatNumberValue(group.rows.length),
        offered: formatNumberValue(group.rows.reduce((sum, row) => sum + (row.count ?? 0), 0) || null),
        compAvgSize: formatSqftValue(weightedAverageNumber(group.rows.map((row) => ({ value: row.avgSizeSqft, weight: row.count })))),
        subjectAvgSize: formatSqftValue(subjectAvgSize),
        compAskPpsf: formatPpsf(compAskPpsf),
        compSoldPpsf: formatPpsf(compSoldPpsf),
        subjectPpsf: formatPpsf(subjectBedroomValue),
        psfSpread: renderPpsfSpread(subjectBedroomValue, compPpsf),
        avgCc: avgCc != null ? `${formatWholeMoney(avgCc)}/mo` : "—",
      };
    });
  const subjectRows = activeSurface.subjectUnitPricingRows.map((row) => ({
    unit: row.unitLabel ?? "—",
    bedBath: joinedSummary([
      row.bedrooms != null ? `${row.bedrooms} Bed` : null,
      row.bathrooms != null ? `${row.bathrooms} Bath` : null,
    ]),
    intSf: formatSqftValue(row.interiorSqft),
    extSf: formatSqftValue(row.exteriorSqft),
    price: formatWholeMoney(row.price),
    ppsf: formatPpsf(row.ppsf),
    notes: row.notes ?? "—",
  }));
  const extractionNotes = [
    activeSurface.summary,
    activeSurface.missingDataFlags.length > 0
      ? `${activeSurface.missingDataFlags.length} missing-data field${activeSurface.missingDataFlags.length === 1 ? "" : "s"} were flagged by the extractor.`
      : null,
  ].filter((entry): entry is string => Boolean(entry && entry.trim()));

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <V3ReportPanel
        title="Market / comps"
        subtitle="Broker market analysis, project comps, bedroom mix, and pricing signals."
        actions={(
          <form onSubmit={uploadSelectedPackage} style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", justifyContent: "flex-end", alignItems: "center" }}>
            <input
              aria-label="Broker comp package"
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.txt"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              style={{ maxWidth: "15rem", fontSize: "0.78rem" }}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadBrokerComps()}
              title={`GET ${reviewEndpoint}`}
              style={{ minHeight: "2rem", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "0.35rem 0.7rem", background: "#f8fafc", color: "#334155", fontSize: "0.78rem", fontWeight: 700 }}
            >
              {loading ? "Refreshing…" : "Refresh extract"}
            </button>
            <button
              type="submit"
              disabled={!selectedFile || uploading}
              title={`POST ${uploadEndpoint}`}
              style={{ minHeight: "2rem", border: "1px solid #1f6b4d", borderRadius: "8px", padding: "0.35rem 0.7rem", background: selectedFile && !uploading ? "#1f6b4d" : "#f8fafc", color: selectedFile && !uploading ? "#fff" : "#64748b", fontSize: "0.78rem", fontWeight: 700 }}
            >
              {uploading ? "Replacing…" : "Replace extract"}
            </button>
          </form>
        )}
      >
        <V3ReportSection title="Pricing Check">
          <V3FactList items={pricingFacts} />
          {error ? <p style={{ margin: 0, color: "#991b1b", fontSize: "0.86rem" }}>{error}</p> : null}
          {!activeSurface.hasData ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.86rem" }}>
              No broker comp package has been uploaded or extracted yet.
            </p>
          ) : null}
          {extractionNotes.length > 0 ? <V3Bullets items={extractionNotes.flatMap(splitTakeawayText).slice(0, 4)} /> : null}
        </V3ReportSection>

        <V3ReportSection title="Building Level Comps">
          <V3RecordsTable
            columns={[
              { key: "property", label: "Property" },
              { key: "neighborhood", label: "Neighborhood", width: "9rem" },
              { key: "year", label: "Year", width: "5rem", align: "right" },
              { key: "floors", label: "Floors", width: "5rem", align: "right" },
              { key: "units", label: "Units", width: "5rem", align: "right" },
              { key: "salesBegan", label: "Sales Began", width: "8rem" },
              { key: "sold", label: "% Sold", width: "6rem", align: "right" },
              { key: "avgSize", label: "Avg Unit SF", width: "8rem", align: "right" },
              { key: "askPpsf", label: "Ask $/SF", width: "8rem", align: "right" },
              { key: "soldPpsf", label: "Sold $/SF", width: "8rem", align: "right" },
              { key: "range", label: "Price Range", width: "11rem", align: "right" },
            ]}
            rows={buildingRows}
            emptyText="No building-level comp rows are available yet."
          />
        </V3ReportSection>

        <V3ReportSection title="Bedroom Summary">
          <V3RecordsTable
            columns={[
              { key: "bed", label: "Type", width: "6rem" },
              { key: "compRows", label: "Projects", width: "6rem", align: "right" },
              { key: "offered", label: "Offered", width: "6rem", align: "right" },
              { key: "compAvgSize", label: "Comp Avg SF", width: "8rem", align: "right" },
              { key: "subjectAvgSize", label: "Deal Avg SF", width: "8rem", align: "right" },
              { key: "compAskPpsf", label: "Comp Ask $/SF", width: "9rem", align: "right" },
              { key: "compSoldPpsf", label: "Comp Sold $/SF", width: "9rem", align: "right" },
              { key: "subjectPpsf", label: "Deal $/SF", width: "8rem", align: "right" },
              { key: "psfSpread", label: "$/SF Δ", width: "10rem", align: "right" },
              { key: "avgCc", label: "Avg CC", width: "8rem", align: "right" },
            ]}
            rows={bedroomSummaryRows}
            emptyText="No bedroom summary rows are available yet."
          />
        </V3ReportSection>

        <V3ReportSection title="Subject Unit Pricing">
          <V3RecordsTable
            columns={[
              { key: "unit", label: "Unit", width: "9rem" },
              { key: "bedBath", label: "Bed / Bath", width: "8rem" },
              { key: "intSf", label: "Int SF", width: "7rem", align: "right" },
              { key: "extSf", label: "Ext SF", width: "7rem", align: "right" },
              { key: "price", label: "Price", width: "9rem", align: "right" },
              { key: "ppsf", label: "PPSF", width: "7rem", align: "right" },
              { key: "notes", label: "Notes" },
            ]}
            rows={subjectRows}
            emptyText="No subject projected-pricing rows are available yet."
          />
        </V3ReportSection>

        <V3ReportSection title="Unit Type Comps">
          <V3RecordsTable
            columns={[
              { key: "address", label: "Address" },
              { key: "bedBath", label: "Bed / Bath", width: "8rem" },
              { key: "offered", label: "Offered", width: "6rem", align: "right" },
              { key: "avgSize", label: "Avg SF", width: "8rem", align: "right" },
              { key: "askPpsf", label: "Ask $/SF", width: "8rem", align: "right" },
              { key: "soldPpsf", label: "Sold $/SF", width: "8rem", align: "right" },
              { key: "avgCc", label: "Avg CC", width: "8rem", align: "right" },
              { key: "subjectPpsf", label: "Deal $/SF", width: "8rem", align: "right" },
              { key: "psfSpread", label: "$/SF Δ", width: "10rem", align: "right" },
              ...(hasBedroomRentComps
                ? [
                    { key: "rentPsf", label: "Rent $/SF", width: "8rem", align: "right" as const },
                    { key: "rentSpread", label: "Rent Δ", width: "9rem", align: "right" as const },
                  ]
                : []),
              { key: "range", label: "Range", width: "11rem", align: "right" },
            ]}
            rows={bedroomRows}
            emptyText="No bedroom-level comp rows are available yet."
          />
        </V3ReportSection>
      </V3ReportPanel>
    </div>
  );
}

function formatTourDateTime(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function labelFromPipelineKey(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function propertyPipeline(property: CanonicalProperty): Record<string, unknown> {
  const details = property.details as Record<string, unknown> | null | undefined;
  return details && typeof details.pipeline === "object" && details.pipeline != null
    ? details.pipeline as Record<string, unknown>
    : {};
}

function propertyPipelineTags(property: CanonicalProperty): string[] {
  const pipeline = propertyPipeline(property);
  const fromProperty = Array.isArray(property.propertyTags) ? property.propertyTags : [];
  const fromDetails = Array.isArray(pipeline.tags) ? pipeline.tags : null;
  return [...new Set((fromDetails ?? fromProperty).filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0))];
}

function propertyPipelineMissingFields(property: CanonicalProperty): string[] {
  const pipeline = propertyPipeline(property);
  const fromProperty = Array.isArray(property.missingFields) ? property.missingFields : [];
  const fromDetails = Array.isArray(pipeline.missingFields) ? pipeline.missingFields : null;
  return [...new Set((fromDetails ?? fromProperty).filter((field): field is string => typeof field === "string" && field.trim().length > 0))];
}

function propertyPipelineStatus(property: CanonicalProperty): string {
  const pipeline = propertyPipeline(property);
  if (typeof property.pipelineStatus === "string" && property.pipelineStatus.trim()) return property.pipelineStatus.trim();
  if (typeof pipeline.status === "string" && pipeline.status.trim()) return pipeline.status.trim();
  return "new_sourced";
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

function emptyOmCalculationDraft(): OmCalculationDraft {
  return {
    purchasePrice: null,
    buildingSqft: null,
    purchaseClosingCostPct: null,
    renovationCosts: 0,
    furnishingSetupCosts: null,
    investmentProfile: "",
    targetAcquisitionDate: "",
    ltvPct: null,
    interestRatePct: null,
    amortizationYears: null,
    loanFeePct: null,
    rentUpliftPct: null,
    expenseIncreasePct: null,
    managementFeePct: null,
    occupancyTaxPct: null,
    vacancyPct: null,
    leadTimeMonths: null,
    annualRentGrowthPct: null,
    annualCommercialRentGrowthPct: null,
    annualOtherIncomeGrowthPct: null,
    annualExpenseGrowthPct: null,
    annualPropertyTaxGrowthPct: null,
    recurringCapexAnnual: null,
    currentNoi: null,
    holdPeriodYears: null,
    exitCapPct: null,
    exitClosingCostPct: null,
    targetIrrPct: null,
    brokerEmailNotes: "",
  };
}

function serializeUnitModelRows(rows: OmCalculationUnitModelRow[] | undefined): string {
  return JSON.stringify(
    (rows ?? []).map((row) => ({
      rowId: row.rowId,
      unitLabel: row.unitLabel,
      building: row.building ?? null,
      unitCategory: row.unitCategory ?? null,
      tenantName: row.tenantName ?? null,
      currentAnnualRent: row.currentAnnualRent ?? null,
      underwrittenAnnualRent: row.underwrittenAnnualRent ?? null,
      rentUpliftPct: row.rentUpliftPct ?? null,
      occupancyPct: row.occupancyPct ?? null,
      furnishingCost: row.furnishingCost ?? null,
      onboardingLaborFee: row.onboardingLaborFee ?? null,
      onboardingOtherCosts: row.onboardingOtherCosts ?? null,
      onboardingFee: row.onboardingFee ?? null,
      monthlyRecurringOpex: row.monthlyRecurringOpex ?? null,
      monthlyHospitalityExpense: row.monthlyHospitalityExpense ?? null,
      includeInUnderwriting: row.includeInUnderwriting,
      isProtected: row.isProtected,
      isCommercial: row.isCommercial,
      isRentStabilized: row.isRentStabilized,
      beds: row.beds ?? null,
      baths: row.baths ?? null,
      sqft: row.sqft ?? null,
      tenantStatus: row.tenantStatus ?? null,
      notes: row.notes ?? null,
    }))
  );
}

function serializeExpenseModelRows(rows: OmCalculationExpenseModelRow[] | undefined): string {
  return JSON.stringify(
    (rows ?? []).map((row) => ({
      rowId: row.rowId,
      lineItem: row.lineItem,
      amount: row.amount ?? null,
      annualGrowthPct: row.annualGrowthPct ?? null,
      treatment: row.treatment,
    }))
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
    omCalculation: true,
    photosFloorplans: true,
    detailsBrokerAmenitiesPriceHistory: true,
    owner: true,
    valuations: true,
    rentalOm: true,
    violationsComplaintsPermits: true,
  });
  const [activeTab, setActiveTab] = useState<PropertyDetailTabId>("overview");
  const [unifiedRows, setUnifiedRows] = useState<UnifiedEnrichmentRow[]>([]);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedFetched, setUnifiedFetched] = useState(false);
  const [ownerFromPermits, setOwnerFromPermits] = useState<{ owner_name?: string; owner_business_name?: string } | null>(null);
  type UnifiedDoc = { id: string; fileName: string; fileType?: string | null; source: string; sourceType: "inquiry" | "uploaded" | "generated"; createdAt: string };
  const [unifiedDocuments, setUnifiedDocuments] = useState<UnifiedDoc[] | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [inquiryEmailModalOpen, setInquiryEmailModalOpen] = useState(false);
  const [inquiryDraft, setInquiryDraft] = useState<{ to: string; subject: string; body: string }>({ to: "", subject: "", body: "" });
  const [includeTourRequest, setIncludeTourRequest] = useState(false);
  const [tourDateTime, setTourDateTime] = useState("");
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
  const [dossierDraft, setDossierDraft] = useState<OmCalculationDraft>(emptyOmCalculationDraft);
  const [savedDossierDraft, setSavedDossierDraft] = useState<OmCalculationDraft>(emptyOmCalculationDraft);
  const [formulaDossierDefaults, setFormulaDossierDefaults] = useState<OmCalculationDraft>(emptyOmCalculationDraft);
  const [dossierMixSummary, setDossierMixSummary] = useState<
    DossierAssumptionsResponse["mixSummary"]
  >(null);
  const [dossierSettingsLoading, setDossierSettingsLoading] = useState(true);
  const [dossierSettingsSaving, setDossierSettingsSaving] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [dossierGenerating, setDossierGenerating] = useState(false);
  const [scoreRefreshing, setScoreRefreshing] = useState(false);
  const [enrichmentRunning, setEnrichmentRunning] = useState(false);
  const [enrichmentActionNotice, setEnrichmentActionNotice] = useState<string | null>(null);
  const [enrichmentActionError, setEnrichmentActionError] = useState<string | null>(null);
  const [pipelineActionBusy, setPipelineActionBusy] = useState(false);
  const [pipelineActionNotice, setPipelineActionNotice] = useState<string | null>(null);
  const [pipelineActionError, setPipelineActionError] = useState<string | null>(null);
  const [omCalculation, setOmCalculation] = useState<OmCalculationSnapshot | null>(null);
  const [omCalculationLoading, setOmCalculationLoading] = useState(true);
  const [omCalculationRunning, setOmCalculationRunning] = useState(false);
  const [omCalculationError, setOmCalculationError] = useState<string | null>(null);
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

  const refreshUnifiedDocuments = async () => {
    const res = await fetch(`${API_BASE}/api/properties/${property.id}/documents`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error((data?.error || data?.details || "Failed to refresh documents") as string);
    setUnifiedDocuments(data?.documents ?? []);
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

  const hydrateDossierAssumptions = (data: DossierAssumptionsResponse): OmCalculationDraft => {
    const nextDraft: OmCalculationDraft = {
      purchasePrice: data.defaults?.purchasePrice ?? null,
      buildingSqft: data.defaults?.buildingSqft ?? null,
      purchaseClosingCostPct: data.defaults?.purchaseClosingCostPct ?? null,
      renovationCosts: data.defaults?.renovationCosts ?? 0,
      furnishingSetupCosts: data.defaults?.furnishingSetupCosts ?? null,
      investmentProfile: data.defaults?.investmentProfile ?? "",
      targetAcquisitionDate: data.defaults?.targetAcquisitionDate ?? "",
      ltvPct: data.defaults?.ltvPct ?? null,
      interestRatePct: data.defaults?.interestRatePct ?? null,
      amortizationYears: data.defaults?.amortizationYears ?? null,
      loanFeePct: data.defaults?.loanFeePct ?? null,
      rentUpliftPct: data.defaults?.rentUpliftPct ?? null,
      expenseIncreasePct: data.defaults?.expenseIncreasePct ?? null,
      managementFeePct: data.defaults?.managementFeePct ?? null,
      occupancyTaxPct: data.defaults?.occupancyTaxPct ?? null,
      vacancyPct: data.defaults?.vacancyPct ?? null,
      leadTimeMonths: data.defaults?.leadTimeMonths ?? null,
      annualRentGrowthPct: data.defaults?.annualRentGrowthPct ?? null,
      annualCommercialRentGrowthPct: data.defaults?.annualCommercialRentGrowthPct ?? null,
      annualOtherIncomeGrowthPct: data.defaults?.annualOtherIncomeGrowthPct ?? null,
      annualExpenseGrowthPct: data.defaults?.annualExpenseGrowthPct ?? null,
      annualPropertyTaxGrowthPct: data.defaults?.annualPropertyTaxGrowthPct ?? null,
      recurringCapexAnnual: data.defaults?.recurringCapexAnnual ?? null,
      currentNoi: data.defaults?.currentNoi ?? null,
      holdPeriodYears: data.defaults?.holdPeriodYears ?? null,
      exitCapPct: data.defaults?.exitCapPct ?? null,
      exitClosingCostPct: data.defaults?.exitClosingCostPct ?? null,
      targetIrrPct: data.defaults?.targetIrrPct ?? null,
      unitModelRows: data.defaults?.unitModelRows ?? undefined,
      expenseModelRows: data.defaults?.expenseModelRows ?? undefined,
      brokerEmailNotes: data.defaults?.brokerEmailNotes ?? "",
    };
    setDossierDraft(nextDraft);
    setSavedDossierDraft(nextDraft);
    setFormulaDossierDefaults({
      ...emptyOmCalculationDraft(),
      renovationCosts: data.formulaDefaults?.renovationCosts ?? 0,
      buildingSqft: data.defaults?.buildingSqft ?? null,
      furnishingSetupCosts: data.formulaDefaults?.furnishingSetupCosts ?? null,
    });
    setDossierMixSummary(data.mixSummary ?? null);
    return nextDraft;
  };

  useEffect(() => {
    let cancelled = false;
    setDossierSettingsLoading(true);
    setDossierError(null);
    fetch(`${API_BASE}/api/dossier-assumptions?property_id=${encodeURIComponent(property.id)}`)
      .then((r) => r.json())
      .then((data: DossierAssumptionsResponse & { error?: string }) => {
        if (cancelled || data?.error) return;
        hydrateDossierAssumptions(data);
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
    if (!unifiedDocuments || unifiedDocuments.length === 0) {
      setSelectedDocumentId(null);
      return;
    }
    setSelectedDocumentId((current) =>
      current && unifiedDocuments.some((document) => document.id === current)
        ? current
        : unifiedDocuments[0]?.id ?? null
    );
  }, [unifiedDocuments]);

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

  useEffect(() => {
    if (!inquiryEmailModalOpen) return;
    const label = includeTourRequest ? formatTourDateTime(tourDateTime) : null;
    setInquiryDraft((prev) => ({
      ...prev,
      body: updateInquiryDraftTourRequest(prev.body, label),
    }));
  }, [includeTourRequest, inquiryEmailModalOpen, tourDateTime]);

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
  const brokerCompSurface = readBrokerCompSurface(d);
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
      propertyInfo?: Record<string, unknown> | null;
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
  const numericDossierFieldsDirty = OM_CALC_NUMERIC_FIELDS.some(
    (field) => (dossierDraft[field] ?? null) !== (savedDossierDraft[field] ?? null)
  );
  const unitRowsDirty =
    serializeUnitModelRows(dossierDraft.unitModelRows) !==
    serializeUnitModelRows(savedDossierDraft.unitModelRows);
  const expenseRowsDirty =
    serializeExpenseModelRows(dossierDraft.expenseModelRows) !==
    serializeExpenseModelRows(savedDossierDraft.expenseModelRows);
  const dossierMetadataDirty =
    dossierDraft.investmentProfile.trim() !== savedDossierDraft.investmentProfile.trim() ||
    dossierDraft.targetAcquisitionDate !== savedDossierDraft.targetAcquisitionDate;
  const isDossierDirty =
    numericDossierFieldsDirty ||
    unitRowsDirty ||
    expenseRowsDirty ||
    dossierMetadataDirty ||
    dossierDraft.brokerEmailNotes.trim() !== savedDossierDraft.brokerEmailNotes.trim();
  const hasSavedBrokerEmailNotes = savedDossierDraft.brokerEmailNotes.trim().length > 0;
  const hasBrokerEmailNotes =
    dossierDraft.brokerEmailNotes.trim().length > 0 ||
    hasSavedBrokerEmailNotes;
  const canGenerateDossier = hasAuthoritativeOm || hasBrokerEmailNotes;
  const isDossierBusy =
    dossierGenerating ||
    scoreRefreshing ||
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
  const analysisStatusLabel =
    dossierJob?.status === "running"
      ? `${Math.min(activeDossierProgressPct, 100)}% complete`
      : persistedDossierGeneration?.status === "completed"
        ? "Dossier ready"
        : persistedDossierGeneration?.status === "failed"
          ? "Last run failed"
          : hasAuthoritativeOm
            ? "Ready for underwriting"
            : hasOmDocument
              ? "OM uploaded"
              : "Waiting on OM or notes";

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
    nextDraft: OmCalculationDraft = dossierDraft
  ): Promise<OmCalculationDraft> => {
    const payload: OmCalculationDraft = {
      ...nextDraft,
      brokerEmailNotes: nextDraft.brokerEmailNotes.trim(),
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
        const updatedAt = new Date().toISOString();
        return {
          ...base,
          dealDossier: {
            ...dealDossier,
            assumptions: {
              ...payload,
              updatedAt,
            },
          },
        };
      });
      return payload;
    } finally {
      setDossierSettingsSaving(false);
    }
  };

  const fetchOmCalculation = async (
    nextDraft: OmCalculationDraft = dossierDraft,
    options?: { initialLoad?: boolean }
  ) => {
    if (options?.initialLoad) setOmCalculationLoading(true);
    else setOmCalculationRunning(true);
    setOmCalculationError(null);
    try {
      const assumptions = OM_CALC_NUMERIC_FIELDS.reduce<Record<string, number | string | null>>((acc, field) => {
        acc[field] = nextDraft[field] ?? null;
        return acc;
      }, {});
      assumptions.investmentProfile = nextDraft.investmentProfile.trim() || null;
      assumptions.targetAcquisitionDate = nextDraft.targetAcquisitionDate.trim() || null;
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/om-calculation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assumptions,
          brokerEmailNotes: nextDraft.brokerEmailNotes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to run OM calculation"
        );
      }
      setOmCalculation(data as OmCalculationSnapshot);
      return data as OmCalculationSnapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run OM calculation";
      setOmCalculationError(message);
      return null;
    } finally {
      setOmCalculationLoading(false);
      setOmCalculationRunning(false);
    }
  };

  useEffect(() => {
    if (dossierSettingsLoading) return;
    if (!hasAuthoritativeOm && !hasSavedBrokerEmailNotes) {
      setOmCalculation(null);
      setOmCalculationLoading(false);
      return;
    }
    void fetchOmCalculation(dossierDraft, { initialLoad: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run after persisted assumptions or OM availability change
  }, [property.id, dossierSettingsLoading, hasAuthoritativeOm, hasSavedBrokerEmailNotes]);

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
      void fetchOmCalculation(dossierDraft, { initialLoad: true });

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
    if (!canGenerateDossier) {
      setDossierError(
        "Generate dossier requires either a promoted authoritative OM snapshot or saved broker email notes with rent/expense inputs."
      );
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

  const handleRefreshDealScore = async () => {
    if (scoreRefreshing) return;
    setScoreRefreshing(true);
    setDossierError(null);
    try {
      const res = await fetch(`${API_BASE}/api/dossier/refresh-scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "selected", propertyIds: [property.id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to refresh score"
        );
      }
      await refreshPropertySnapshot();
      onWorkflowActivity?.();
    } catch (err) {
      setDossierError(err instanceof Error ? err.message : "Failed to refresh score");
    } finally {
      setScoreRefreshing(false);
    }
  };

  const handleOmCalculationFieldChange = (
    field: OmCalculationNumericField,
    value: number | null
  ) => {
    setDossierDraft((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleOmCalculationTextChange = (
    field: OmCalculationTextField,
    value: string
  ) => {
    setDossierDraft((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleOmUnitModelRowsChange = (rows: OmCalculationUnitModelRow[]) => {
    setDossierDraft((prev) => ({
      ...prev,
      unitModelRows: rows,
    }));
  };

  const handleOmExpenseModelRowsChange = (rows: OmCalculationExpenseModelRow[]) => {
    setDossierDraft((prev) => ({
      ...prev,
      expenseModelRows: rows,
    }));
  };

  const handleOmCalculationSave = async () => {
    try {
      const savedDraft = await persistDossierSettings();
      await fetchOmCalculation(savedDraft);
      onRefreshPropertyData?.();
    } catch (err) {
      setOmCalculationError(err instanceof Error ? err.message : "Failed to save OM defaults");
    }
  };

  const handleOmCalculationReset = () => {
    setDossierDraft(savedDossierDraft);
    setOmCalculationError(null);
  };

  const handleClearSavedOmOverrides = async () => {
    try {
      await persistDossierSettings(emptyOmCalculationDraft());
      const res = await fetch(`${API_BASE}/api/dossier-assumptions?property_id=${encodeURIComponent(property.id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === "string" ? data.error : data?.details ?? "Failed to reload defaults");
      }
      const nextDraft = hydrateDossierAssumptions(data as DossierAssumptionsResponse);
      if (hasAuthoritativeOm || nextDraft.brokerEmailNotes.trim().length > 0) {
        await fetchOmCalculation(nextDraft, { initialLoad: true });
      } else {
        setOmCalculation(null);
        setOmCalculationLoading(false);
      }
      onRefreshPropertyData?.();
    } catch (err) {
      setOmCalculationError(err instanceof Error ? err.message : "Failed to clear OM overrides");
    }
  };

  const hasListing = primaryListing && primaryListing !== "loading";
  const listingForDisplay = hasListing ? primaryListing : null;
  const listingPricePerSqft =
    listingForDisplay?.price != null && listingForDisplay?.sqft != null && listingForDisplay.sqft > 0
      ? listingForDisplay.price / listingForDisplay.sqft
      : null;
  const omUiFinancialSummary = rentalFinancials?.omAnalysis?.uiFinancialSummary ?? null;
  const authoritativePropertyInfo = authoritativeOm?.propertyInfo ?? null;
  const dealBaselinePrice =
    listingForDisplay?.price ??
    numericValue(omUiFinancialSummary?.price) ??
    numericValue(authoritativePropertyInfo?.price) ??
    numericValue(persistedDossierAssumptions?.purchasePrice);
  const dealBaselineSqft =
    listingForDisplay?.sqft ??
    numericValue(authoritativePropertyInfo?.buildingSqft) ??
    formulaDossierDefaults.buildingSqft ??
    dossierDraft.buildingSqft;
  const dealBaselinePpsf =
    listingPricePerSqft ??
    numericValue(omUiFinancialSummary?.pricePerSqft) ??
    (dealBaselinePrice != null && dealBaselineSqft != null && dealBaselineSqft > 0 ? dealBaselinePrice / dealBaselineSqft : null);
  const dealBaselinePriceSource =
    listingForDisplay?.price != null
      ? "Primary listing"
      : numericValue(omUiFinancialSummary?.price) != null || numericValue(authoritativePropertyInfo?.price) != null
        ? "OM / underwriting"
        : persistedDossierAssumptions?.purchasePrice != null
          ? "Dossier assumptions"
          : null;
  const subjectRentPsfTotals = omRentRoll.reduce<Record<string, { monthlyRent: number; sqft: number }>>((acc, row) => {
    const beds = numericValue(row.beds ?? (row as Record<string, unknown>).bedrooms);
    const sqft = numericValue(row.sqft);
    const annualRent = numericValue(row.annualRent);
    const monthlyRent = numericValue(row.monthlyRent) ?? (annualRent != null ? annualRent / 12 : null);
    if (beds == null || sqft == null || sqft <= 0 || monthlyRent == null || monthlyRent <= 0) return acc;
    const key = String(beds);
    const current = acc[key] ?? { monthlyRent: 0, sqft: 0 };
    current.monthlyRent += monthlyRent;
    current.sqft += sqft;
    acc[key] = current;
    return acc;
  }, {});
  const subjectRentPsfByBedroom = Object.fromEntries(
    Object.entries(subjectRentPsfTotals)
      .filter(([, value]) => value.sqft > 0)
      .map(([bedroom, value]) => [bedroom, value.monthlyRent / value.sqft])
  );
  const subjectCapRatePct =
    numericValue(rentalFinancials?.fromLlm?.capRate) ??
    numericValue(rentalFinancials?.omAnalysis?.uiFinancialSummary?.capRate);
  const brokerCompSubjectBaseline: BrokerCompSubjectBaseline = {
    price: dealBaselinePrice,
    priceSource: dealBaselinePriceSource,
    sqft: dealBaselineSqft,
    pricePerSqft: dealBaselinePpsf,
    capRatePct: subjectCapRatePct,
    rentPsfByBedroom: subjectRentPsfByBedroom,
  };
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
  const tourDateTimeLabel = formatTourDateTime(tourDateTime);
  const tourRequestNeedsDateTime = includeTourRequest && !tourDateTimeLabel;
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
  const co = enrichment?.certificateOfOccupancy as Record<string, unknown> | undefined;
  const coJobNumber = co?.jobNumber ?? co?.job_number;
  const coStatus = co?.status ?? co?.c_of_o_status;
  const coDate = co?.issuanceDate ?? co?.issuance_date ?? co?.c_of_o_issuance_date;
  const coJobType = co?.jobType ?? co?.job_type;
  const zoning = enrichment?.zoning as Record<string, unknown> | undefined;
  const zoningDistrict1 = zoning?.zoningDistrict1 ?? zoning?.zoning_district_1;
  const zoningDistrict2 = zoning?.zoningDistrict2 ?? zoning?.zoning_district_2;
  const zoningMap = zoning?.zoningMapNumber ?? zoning?.zoning_map_number ?? zoning?.zoningMapCode ?? zoning?.zoning_map_code;
  const hpdRegistration = enrichment?.hpdRegistration as Record<string, unknown> | undefined;
  const hpdRegistrationId = hpdRegistration?.registrationId ?? hpdRegistration?.registration_id;
  const hpdRegistrationDate = hpdRegistration?.lastRegistrationDate ?? hpdRegistration?.last_registration_date;
  const listingNeighborhood = extra?.neighborhood ?? d?.neighborhood ?? d?.neighborhoodName ?? null;
  const listingBorough = extra?.borough ?? d?.borough ?? null;
  const listingZip = extra?.zipcode ?? extra?.zipCode ?? listingForDisplay?.zip ?? d?.zipcode ?? d?.zip ?? null;
  const listingBuilt = extra?.builtIn ?? extra?.built_in ?? extra?.yearBuilt;
  const listingPropertyType = extra?.propertyType ?? extra?.property_type ?? extra?.type ?? "";
  const propertyBasics: V3FactItem[] = [
    { label: "Ask", value: listingForDisplay ? formatPrice(listingForDisplay.price) : "—" },
    { label: "Beds / Baths", value: `${listingForDisplay?.beds ?? "—"} / ${listingForDisplay?.baths ?? "—"}` },
    { label: "Sqft", value: listingForDisplay?.sqft != null ? formatNumberValue(listingForDisplay.sqft) : "—" },
    { label: "Type", value: formatPropertyType(listingPropertyType) },
    { label: "Built", value: listingBuilt != null ? String(listingBuilt) : "—" },
    { label: "Listed", value: listingForDisplay ? formatListedDate(listingForDisplay.listedAt) : "—", detail: daysOnMarket(listingForDisplay?.listedAt) != null ? `${daysOnMarket(listingForDisplay?.listedAt)} days on market` : null },
  ];
  const locationFacts: V3FactItem[] = [
    { label: "Neighborhood", value: formatReadableToken(listingNeighborhood) },
    { label: "Borough", value: formatReadableToken(listingBorough) },
    { label: "ZIP", value: listingZip != null ? String(listingZip) : "—" },
    { label: "BBL", value: bbl != null ? String(bbl) : "—" },
    { label: "Base BBL", value: bblBase != null ? String(bblBase) : "—" },
    {
      label: "Map",
      value:
        lat != null && lon != null ? (
          <a className="initial-info-geo-link" href={`https://www.google.com/maps?q=${lat},${lon}`} target="_blank" rel="noopener noreferrer">
            {String(lat)}, {String(lon)}
          </a>
        ) : "—",
    },
  ];
  const zoningTaxFacts: V3FactItem[] = [
    { label: "Tax code", value: d?.taxCode != null && String(d.taxCode).trim() !== "" ? String(d.taxCode) : "—" },
    { label: "2010 census block", value: d?.censusBlock2010 != null && String(d.censusBlock2010).trim() !== "" ? String(d.censusBlock2010) : "—" },
    { label: "Zoning district", value: [zoningDistrict1, zoningDistrict2].filter(Boolean).map(String).join(", ") || "—" },
    { label: "Zoning map", value: zoningMap != null && String(zoningMap).trim() !== "" ? String(zoningMap) : "—" },
    { label: "CO status", value: coStatus != null && String(coStatus).trim() !== "" ? String(coStatus) : "—" },
    { label: "CO job", value: coJobNumber != null && String(coJobNumber).trim() !== "" ? String(coJobNumber) : "—", detail: coDate ? `Issued ${formatDateOnly(coDate as string)}` : null },
    { label: "HPD registration", value: hpdRegistrationId != null && String(hpdRegistrationId).trim() !== "" ? String(hpdRegistrationId) : "—", detail: hpdRegistrationDate ? `Last filed ${formatDateOnly(hpdRegistrationDate as string)}` : null },
    { label: "CO job type", value: coJobType != null && String(coJobType).trim() !== "" ? String(coJobType) : "—" },
  ];
  const assessmentFacts: V3FactItem[] = [
    { label: "Market value", value: formatMoneyValue(assessedMarketValue) },
    { label: "Actual assessed", value: formatMoneyValue(assessedActualValue) },
    { label: "Tax before total", value: formatMoneyValue(assessedTaxBeforeTotal) },
    { label: "Gross sqft", value: formatNumberValue(assessedGrossSqft) },
    { label: "Land area", value: formatNumberValue(assessedLandArea) },
    { label: "Residential gross", value: formatNumberValue(assessedResidentialAreaGross) },
    { label: "Office gross", value: formatNumberValue(assessedOfficeAreaGross) },
    { label: "Retail gross", value: formatNumberValue(assessedRetailAreaGross) },
  ];
  const brokerFacts: V3FactItem[] =
    listingForDisplay?.agentEnrichment?.length
      ? listingForDisplay.agentEnrichment.slice(0, 4).map((agent, index) => ({
          label: index === 0 ? "Primary broker" : `Broker ${index + 1}`,
          value: agent.name,
          detail: joinedSummary([agent.firm ?? null, agent.email ?? null, agent.phone ?? null]),
          tone: agent.email ? "neutral" : "warn",
        }))
      : listingForDisplay?.agentNames?.length
        ? [{ label: "Broker / agent", value: listingForDisplay.agentNames.join(", "), detail: "Email not sourced", tone: "warn" }]
        : [{ label: "Broker / agent", value: "—", detail: "No broker contact sourced yet", tone: "warn" }];
  const priceHistoryRows: Array<Record<string, React.ReactNode>> =
    listingForDisplay?.priceHistory?.slice(0, 12).map((entry) => ({
      date: formatPriceHistoryDate(entry.date),
      price: formatPriceCompact(entry.price),
      event: formatPriceEventLabel(entry.event),
    })) ?? [];
  const rentalReviewRows: Array<Record<string, React.ReactNode>> = displayRentalCards.map((card, i) => {
    const mediaRow = card.mediaRow;
    const financialRow = card.financialRow as Record<string, unknown> | null;
    const unitImages = (mediaRow?.images ?? []).filter((u): u is string => typeof u === "string");
    const unitLabel =
      (typeof financialRow?.unit === "string" && financialRow.unit.trim()) ||
      (typeof mediaRow?.unit === "string" && mediaRow.unit.trim()) ||
      String(i + 1);
    const displaySqft = (typeof financialRow?.sqft === "number" ? financialRow.sqft : null) ?? mediaRow?.sqft ?? null;
    const displayBeds = (typeof financialRow?.beds === "number" ? financialRow.beds : null) ?? mediaRow?.beds ?? null;
    const displayBaths = (typeof financialRow?.baths === "number" ? financialRow.baths : null) ?? mediaRow?.baths ?? null;
    const displayMonthlyRent =
      typeof financialRow?.monthlyRent === "number" ? financialRow.monthlyRent : mediaRow?.rentalPrice ?? null;
    const displayAnnualRent =
      typeof financialRow?.annualRent === "number"
        ? financialRow.annualRent
        : typeof financialRow?.monthlyRent === "number"
          ? Number(financialRow.monthlyRent) * 12
          : null;
    const displayLastRented =
      typeof financialRow?.lastRentedDate === "string" ? financialRow.lastRentedDate : mediaRow?.lastRentedDate ?? mediaRow?.listedDate ?? null;
    const source = financialRow ? "OM" : mediaRow?.source ?? rentalFinancials?.source ?? "Rental pull";
    const note = [
      typeof financialRow?.rentType === "string" ? financialRow.rentType : null,
      typeof financialRow?.tenantStatus === "string" ? financialRow.tenantStatus : null,
      typeof financialRow?.notes === "string" ? financialRow.notes : null,
      mediaRow?.status ?? null,
    ].filter(Boolean).join("; ");
    return {
      image: unitImages[0] ? (
        <a href={unitImages[0]} target="_blank" rel="noopener noreferrer">
          <img src={unitImages[0]} alt="" style={{ width: "64px", height: "46px", objectFit: "cover", borderRadius: "6px", display: "block" }} />
        </a>
      ) : (
        <span style={{ color: "#94a3b8" }}>No photo</span>
      ),
      unit: (
        <span>
          <strong>{unitLabel}</strong>
          {mediaRow?.streeteasyUrl ? (
            <a href={mediaRow.streeteasyUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", color: "#1f4f46", fontSize: "0.76rem", marginTop: "0.1rem" }}>
              Source listing
            </a>
          ) : null}
        </span>
      ),
      mix: `${displayBeds ?? "—"} bd / ${displayBaths ?? "—"} ba`,
      sqft: displaySqft != null ? formatNumberValue(displaySqft) : "—",
      rent: displayMonthlyRent != null ? formatPrice(displayMonthlyRent) : "—",
      annual: displayAnnualRent != null ? formatPrice(displayAnnualRent) : "—",
      date: displayLastRented ? formatDateOnly(displayLastRented) : "—",
      source,
      notes: note || "—",
    };
  });
  const rentalSummaryFacts: V3FactItem[] = [
    { label: "Rental source", value: rentalFinancials?.source ?? "—" },
    { label: "Rental units", value: rentalUnits.length ? String(rentalUnits.length) : "—" },
    { label: "OM rent roll rows", value: omRentRoll.length ? String(omRentRoll.length) : "—" },
    { label: "Gross rent", value: formatMoneyValue(rentalFinancials?.fromLlm?.grossRentTotal ?? authoritativeSummary?.grossRent) },
    { label: "NOI", value: formatMoneyValue(rentalFinancials?.fromLlm?.noi ?? authoritativeSummary?.noi) },
    { label: "Cap rate", value: rentalFinancials?.fromLlm?.capRate != null ? `${Number(rentalFinancials.fromLlm.capRate).toFixed(2)}%` : "—" },
    { label: "Last updated", value: rentalFinancials?.lastUpdatedAt ? formatDateOnly(rentalFinancials.lastUpdatedAt) : "—" },
  ];
  const omAnalysis = rentalFinancials?.omAnalysis ?? null;
  const omTakeaways = [
    ...splitTakeawayText(omAnalysis?.investmentTakeaways),
    ...splitTakeawayText(omAnalysis?.dossierMemo?.investmentHighlights),
    ...splitTakeawayText(rentalFinancials?.fromLlm?.keyTakeaways),
    ...splitTakeawayText(rentalFinancials?.fromLlm?.dataGapSuggestions),
  ].filter((entry, index, arr) => arr.indexOf(entry) === index).slice(0, 7);
  const omMetricFacts: V3FactItem[] = [
    { label: "Current NOI", value: formatMoneyValue(authoritativeSummary?.noi ?? rentalFinancials?.fromLlm?.noi) },
    { label: "Gross rent", value: formatMoneyValue(authoritativeSummary?.grossRent ?? rentalFinancials?.fromLlm?.grossRentTotal) },
    { label: "Expenses", value: formatMoneyValue(authoritativeSummary?._expenses ?? rentalFinancials?.fromLlm?.totalExpenses) },
    { label: "Effective gross income", value: formatMoneyValue(authoritativeSummary?.effectiveGrossIncome) },
    { label: "Validation flags", value: String(authoritativeValidationMessages.length) },
    { label: "Expense rows", value: displayedExpenseTable.length ? String(displayedExpenseTable.length) : "—" },
  ];
  const expenseRows: Array<Record<string, React.ReactNode>> = displayedExpenseTable.map((row) => ({
    item: row.lineItem ?? "—",
    amount: formatMoneyValue(row.amount),
  }));
  const unifiedRecordRows: Array<Record<string, React.ReactNode>> = unifiedRows.map((row) => ({
    date: row.date,
    category: row.category,
    info: row.info,
  }));
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const sourcingUpdate = getSourcingUpdate(d);
  const sourcingUpdateMeta = getSourcingUpdateMeta(d);
  const pipelineProperty = { ...property, details: d };
  const pipelineTags = propertyPipelineTags(pipelineProperty);
  const pipelineMissingFields = propertyPipelineMissingFields(pipelineProperty);
  const currentPipelineStatus = propertyPipelineStatus(pipelineProperty);
  const isRejected = currentPipelineStatus === "rejected_removed" || pipelineTags.includes("rejected") || Boolean(property.rejectedAt);
  const overviewItems = [
    { label: "Saved search", value: sourcingUpdateMeta.label },
    { label: "Stage", value: labelFromPipelineKey(currentPipelineStatus) },
    { label: "OM status", value: property.omStatus ?? "—" },
    { label: "Deal score", value: dealScore != null ? `${dealScore}/100` : "Pending" },
    { label: "Documents", value: unifiedDocuments == null ? "…" : String(unifiedDocuments.length) },
    { label: "Media", value: String(photoUrls.length + floorplanUrls.length) },
    { label: "Inquiry", value: lastInquirySentAt ? formatDateOnly(lastInquirySentAt) : "Not sent" },
  ];

  const detailTabs: PropertyDetailTabItem[] = [
    { id: "overview", label: "Overview" },
    { id: "documents", label: "Documents", badge: unifiedDocuments == null ? null : unifiedDocuments.length },
    { id: "omWorkspace", label: "OM" },
    { id: "marketComps", label: "Market / Comps", badge: brokerCompSurface.hasData ? brokerCompSurface.comparables.length : null },
    { id: "dossierScore", label: "Dossier/Score" },
    { id: "underwriting", label: "Model" },
    { id: "enrichment", label: "Enrichment" },
    { id: "outreach", label: "Outreach" },
    { id: "sources", label: "Sources" },
  ];

  const statusRailItems: PropertyDetailRailItem[] = [
    {
      label: "OM",
      value: property.omStatus ?? (hasOmDocument ? "Document on file" : "Not received"),
      detail: hasAuthoritativeOm ? "Authoritative snapshot" : hasOmDocument ? "Ready to parse" : null,
      tone: hasAuthoritativeOm || hasOmDocument ? "good" : "warn",
    },
    {
      label: "Outreach",
      value: lastInquirySentAt ? "Sent" : "Not sent",
      detail: lastInquirySentAt ? formatDateOnly(lastInquirySentAt) : preferredInquiryRecipient.email || null,
      tone: lastInquirySentAt ? "good" : preferredInquiryRecipient.email ? "neutral" : "warn",
    },
    {
      label: "Documents",
      value: unifiedDocuments == null ? "Loading" : String(unifiedDocuments.length),
      detail: hasOmDocument ? "OM/Brochure present" : null,
      tone: hasOmDocument ? "good" : "neutral",
    },
    {
      label: "Comps",
      value: brokerCompSurface.hasData ? `${brokerCompSurface.comparables.length} extracted` : "Not started",
      detail: brokerCompSurface.pricingOpinions.length > 0 ? `${brokerCompSurface.pricingOpinions.length} pricing opinion${brokerCompSurface.pricingOpinions.length === 1 ? "" : "s"}` : null,
      tone: brokerCompSurface.hasData ? "good" : "neutral",
    },
    {
      label: "Deal",
      value: dealScore != null ? `${dealScore}/100` : analysisStatusLabel,
      detail: scoreOverride ? "Manual score override" : null,
      tone: dealScore != null ? "good" : "neutral",
    },
    {
      label: "Listing",
      value: listingForDisplay ? formatPrice(listingForDisplay.price) : primaryListing === "loading" ? "Loading" : "No listing",
      detail: listingForDisplay?.source ?? null,
      tone: listingForDisplay ? "good" : "neutral",
    },
    {
      label: "Enrichment",
      value: bbl != null || bblBase != null ? "BBL ready" : "Needs BBL",
      detail: sourcingUpdateMeta.label,
      tone: bbl != null || bblBase != null ? "good" : "warn",
    },
  ];

  const recentActivityItems: PropertyDetailActivityItem[] = [
    sourcingUpdate
      ? {
          label: `Saved search: ${sourcingUpdateMeta.label}`,
          detail: sourcingUpdate.lastEvaluatedAt
            ? `Checked ${formatDateOnly(sourcingUpdate.lastEvaluatedAt)}`
            : sourcingUpdateMeta.detail,
          tone: sourcingUpdate.status === "new" ? "good" : sourcingUpdate.status === "updated" ? "warn" : "neutral",
        }
      : null,
    listingActivity?.lastActivityDate
      ? {
          label: formatPriceEventLabel(listingActivity.lastActivityEvent),
          detail: `${formatDateOnly(listingActivity.lastActivityDate)}${listingActivity.lastActivityPrice != null ? ` · ${formatPrice(listingActivity.lastActivityPrice)}` : ""}`,
          tone: "neutral",
        }
      : null,
    lastInquirySentAt
      ? { label: "Inquiry sent", detail: formatDateOnly(lastInquirySentAt), tone: "good" }
      : null,
    unifiedDocuments != null && unifiedDocuments.length > 0
      ? {
          label: "Latest document",
          detail: `${unifiedDocuments[0]?.fileName ?? "Document"} · ${formatDateOnly(unifiedDocuments[0]?.createdAt)}`,
          tone: hasOmDocument ? "good" : "neutral",
        }
      : null,
    persistedDossierGeneration?.completedAt
      ? {
          label: "Dossier generated",
          detail: formatDateOnly(persistedDossierGeneration.completedAt),
          tone: "good",
        }
      : persistedDossierGeneration?.status === "running"
        ? {
            label: "Dossier running",
            detail: activeDossierStageLabel,
            tone: "warn",
          }
        : null,
    ...unifiedRows.slice(0, 2).map((row): PropertyDetailActivityItem => ({
      label: row.category,
      detail: `${row.date} · ${row.info}`,
      tone: /violation|complaint|litigation/i.test(row.category) ? "warn" : "neutral",
    })),
  ].filter((item): item is PropertyDetailActivityItem => item != null).slice(0, 6);

  const selectedDocument =
    unifiedDocuments?.find((document) => document.id === selectedDocumentId) ??
    unifiedDocuments?.[0] ??
    null;
  const selectedDocumentUrl = selectedDocument
    ? `${API_BASE}/api/properties/${property.id}/documents/${selectedDocument.id}/file`
    : null;

  const selectDetailTab = (tab: PropertyDetailTabId) => {
    setActiveTab(tab);
    if (tab === "documents" || tab === "outreach" || tab === "omWorkspace") {
      setOpenSections((prev) => ({ ...prev, rentalOm: true }));
    }
    if ((tab === "enrichment" || tab === "activity") && !unifiedFetched && !unifiedLoading) {
      fetchUnifiedTable();
    }
  };

  const runEnrichmentForThisProperty = async () => {
    if (enrichmentRunning) return;
    setEnrichmentRunning(true);
    setEnrichmentActionError(null);
    setEnrichmentActionNotice("Running enrichment. This may take a minute while NYC Open Data modules refresh.");
    onWorkflowActivity?.();
    try {
      const res = await fetch(`${API_BASE}/api/properties/run-enrichment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds: [property.id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error((data?.details || data?.error || "Failed to run enrichment") as string);
      }
      await Promise.all([
        refreshPropertySnapshot(),
        refreshUnifiedDocuments().catch(() => undefined),
        refreshRecipientResolution({ keepDraft: true }).catch(() => undefined),
      ]);
      setUnifiedFetched(false);
      setUnifiedRows([]);
      onRefreshPropertyData?.();
      onWorkflowActivity?.();
      const success = data?.permitEnrichment?.success ?? 0;
      const failed = data?.permitEnrichment?.failed ?? 0;
      const processed = data?.omFinancialsRefresh?.documentsProcessed ?? 0;
      setEnrichmentActionNotice(
        `Enrichment refreshed. ${success} succeeded, ${failed} failed, ${processed} OM document${processed === 1 ? "" : "s"} refreshed.`
      );
    } catch (error) {
      setEnrichmentActionError(error instanceof Error ? error.message : "Failed to run enrichment.");
      setEnrichmentActionNotice(null);
    } finally {
      setEnrichmentRunning(false);
    }
  };

  const refreshPipelineAfterAction = async () => {
    await Promise.all([
      refreshPropertySnapshot(),
      refreshUnifiedDocuments().catch(() => undefined),
      refreshRecipientResolution({ keepDraft: true }).catch(() => undefined),
    ]);
    onRefreshPropertyData?.();
    onWorkflowActivity?.();
  };

  const addPipelineTag = async (tag: string) => {
    if (pipelineActionBusy) return;
    setPipelineActionBusy(true);
    setPipelineActionError(null);
    setPipelineActionNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error((data?.details || data?.error || "Failed to add tag") as string);
      await refreshPipelineAfterAction();
      setPipelineActionNotice(`${labelFromPipelineKey(tag)} tag added.`);
    } catch (error) {
      setPipelineActionError(error instanceof Error ? error.message : "Failed to add tag.");
    } finally {
      setPipelineActionBusy(false);
    }
  };

  const removePipelineTag = async (tag: string) => {
    if (pipelineActionBusy) return;
    setPipelineActionBusy(true);
    setPipelineActionError(null);
    setPipelineActionNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/tags/${encodeURIComponent(tag)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error((data?.details || data?.error || "Failed to remove tag") as string);
      await refreshPipelineAfterAction();
      setPipelineActionNotice(`${labelFromPipelineKey(tag)} tag removed.`);
    } catch (error) {
      setPipelineActionError(error instanceof Error ? error.message : "Failed to remove tag.");
    } finally {
      setPipelineActionBusy(false);
    }
  };

  const rejectOrRestoreProperty = async () => {
    if (pipelineActionBusy) return;
    const reason = isRejected
      ? ""
      : prompt("Optional rejection reason (examples: too expensive, wrong location, regulatory risk):") ?? "";
    if (!isRejected) {
      const confirmed = confirm("Reject/remove this property from the active pipeline? History and documents will be preserved.");
      if (!confirmed) return;
    }
    setPipelineActionBusy(true);
    setPipelineActionError(null);
    setPipelineActionNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${property.id}/${isRejected ? "restore" : "reject"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error((data?.details || data?.error || "Failed to update property") as string);
      await refreshPipelineAfterAction();
      setPipelineActionNotice(isRejected ? "Property restored to the active pipeline." : "Property rejected and hidden from default views.");
    } catch (error) {
      setPipelineActionError(error instanceof Error ? error.message : "Failed to update property.");
    } finally {
      setPipelineActionBusy(false);
    }
  };

  useEffect(() => {
    if (autoOpenInquiryComposerNonce == null) return;
    if (lastAutoOpenInquiryNonceRef.current === autoOpenInquiryComposerNonce) return;
    lastAutoOpenInquiryNonceRef.current = autoOpenInquiryComposerNonce;
    setOpenSections((prev) => ({ ...prev, rentalOm: true }));
    setActiveTab("outreach");
    setInquiryDraft(buildInquiryDraft({
      canonicalAddress: property.canonicalAddress,
      recipientName: preferredInquiryRecipient.name,
      to: preferredInquiryRecipient.email,
    }));
    setIncludeTourRequest(false);
    setTourDateTime("");
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
    <div className="property-detail-collapsible property-detail-collapsible--workspace">
      <PropertyDetailWorkspace
        tabs={detailTabs}
        activeTab={activeTab}
        onTabChange={selectDetailTab}
        railItems={statusRailItems}
        activityItems={recentActivityItems}
        actions={(
          <>
            <button
              type="button"
              className="property-detail-rail-button property-detail-rail-button--primary"
              onClick={() => selectDetailTab("outreach")}
            >
              Email broker
            </button>
            <button
              type="button"
              className="property-detail-rail-button"
              onClick={runEnrichmentForThisProperty}
              disabled={enrichmentRunning}
            >
              {enrichmentRunning ? "Running enrichment..." : "Run enrichment"}
            </button>
            <a
              className="property-detail-rail-button"
              href={`/deal-analysis?property_id=${encodeURIComponent(property.id)}`}
            >
              Open deal analysis
            </a>
          </>
        )}
      >
      {(enrichmentActionNotice || enrichmentActionError) && (
        <div
          style={{
            margin: "0 0 0.85rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "8px",
            border: enrichmentActionError ? "1px solid #fecaca" : "1px solid #bfdbfe",
            background: enrichmentActionError ? "#fef2f2" : "#eff6ff",
            color: enrichmentActionError ? "#991b1b" : "#1e3a8a",
            fontSize: "0.86rem",
          }}
        >
          {enrichmentActionError ?? enrichmentActionNotice}
        </div>
      )}
      {activeTab === "sources" && (
        <>
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
        {!listingForDisplay && !manualSourceLinks && (
          <div className="property-detail-tab-empty">
            No linked listing or manual source links are available for this property yet.
          </div>
        )}
        </>
      )}

      {activeTab === "dossierScore" && (
      <>
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
      </>
      )}

      {activeTab === "dossierScore" && (
        <div className="rental-om-panel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <strong style={{ display: "block", color: "#0f172a" }}>Dossier workflow</strong>
              <span style={{ display: "block", marginTop: "0.2rem", color: "#64748b", fontSize: "0.8rem" }}>
                {analysisStatusLabel}
                {showDossierProgress ? ` · ${activeDossierStageLabel}` : ""}
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleRefreshAuthoritativeOm}
                disabled={Boolean(authoritativeOmRefreshing || !hasOmDocument)}
                style={{ padding: "0.4rem 0.65rem", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff", color: "#0f172a", cursor: authoritativeOmRefreshing || !hasOmDocument ? "not-allowed" : "pointer", fontSize: "0.78rem", fontWeight: 650 }}
              >
                {authoritativeOmRefreshing ? "Refreshing…" : "Refresh OM inputs"}
              </button>
              <button
                type="button"
                onClick={handleGenerateDossier}
                disabled={Boolean(isDossierBusy || !canGenerateDossier)}
                style={{ padding: "0.4rem 0.65rem", borderRadius: "6px", border: "1px solid #0f172a", background: isDossierBusy || !canGenerateDossier ? "#e2e8f0" : "#0f172a", color: isDossierBusy || !canGenerateDossier ? "#64748b" : "#fff", cursor: isDossierBusy || !canGenerateDossier ? "not-allowed" : "pointer", fontSize: "0.78rem", fontWeight: 650 }}
              >
                {isDossierBusy ? "Working…" : "Generate dossier"}
              </button>
              <button
                type="button"
                onClick={handleRefreshDealScore}
                disabled={Boolean(scoreRefreshing || !dealSignals)}
                style={{ padding: "0.4rem 0.65rem", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff", color: scoreRefreshing || !dealSignals ? "#64748b" : "#0f172a", cursor: scoreRefreshing || !dealSignals ? "not-allowed" : "pointer", fontSize: "0.78rem", fontWeight: 650 }}
              >
                {scoreRefreshing ? "Refreshing…" : "Refresh score"}
              </button>
            </div>
          </div>
          {showDossierProgress && (
            <div className="dossier-progress-track" style={{ marginTop: "0.7rem" }}>
              <div className="dossier-progress-fill" style={{ width: `${Math.min(activeDossierProgressPct, 100)}%` }} />
            </div>
          )}
          {dossierError && (
            <p style={{ margin: "0.6rem 0 0", color: "#b91c1c", fontSize: "0.8rem" }}>{dossierError}</p>
          )}
        </div>
      )}

      {activeTab === "overview" && (
      <div className="property-detail-overview-strip">
        {overviewItems.map((item) => (
          <div key={item.label} className="property-detail-overview-item">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      )}

      {activeTab === "overview" && (
        <div className="property-pipeline-panel">
          <div className="property-pipeline-panel-section">
            <div className="property-pipeline-panel-title">Tags</div>
            <div className="property-pipeline-chip-row">
              {pipelineTags.length === 0 ? (
                <span className="property-mini-chip property-mini-chip--muted">No tags yet</span>
              ) : (
                pipelineTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="property-mini-chip property-mini-chip--tag property-mini-chip--button"
                    onClick={() => { void removePipelineTag(tag); }}
                    disabled={pipelineActionBusy}
                    title={`Remove ${labelFromPipelineKey(tag)} tag`}
                  >
                    {labelFromPipelineKey(tag)} ×
                  </button>
                ))
              )}
              {!pipelineTags.includes("property_toured") ? (
                <button
                  type="button"
                  className="property-mini-chip property-mini-chip--stage property-mini-chip--button"
                  onClick={() => { void addPipelineTag("property_toured"); }}
                  disabled={pipelineActionBusy}
                >
                  Mark toured
                </button>
              ) : null}
              <button
                type="button"
                className="property-mini-chip property-mini-chip--button"
                onClick={() => {
                  const tag = prompt("Add custom tag");
                  if (tag) void addPipelineTag(tag);
                }}
                disabled={pipelineActionBusy}
              >
                Add tag
              </button>
            </div>
          </div>
          <div className="property-pipeline-panel-section">
            <div className="property-pipeline-panel-title">Missing information</div>
            <div className="property-pipeline-chip-row">
              {pipelineMissingFields.length === 0 ? (
                <span className="property-mini-chip property-mini-chip--stage">Complete for now</span>
              ) : (
                pipelineMissingFields.slice(0, 10).map((field) => (
                  <span key={field} className="property-mini-chip property-mini-chip--missing">{labelFromPipelineKey(field)}</span>
                ))
              )}
            </div>
          </div>
          <div className="property-pipeline-panel-actions">
            <button
              type="button"
              className={isRejected ? "btn-secondary" : "btn-danger-outline"}
              onClick={() => { void rejectOrRestoreProperty(); }}
              disabled={pipelineActionBusy}
            >
              {pipelineActionBusy ? "Updating…" : isRejected ? "Restore to pipeline" : "Reject / remove"}
            </button>
          </div>
          {(pipelineActionNotice || pipelineActionError) && (
            <div className={pipelineActionError ? "property-pipeline-panel-message property-pipeline-panel-message--error" : "property-pipeline-panel-message"}>
              {pipelineActionError ?? pipelineActionNotice}
            </div>
          )}
        </div>
      )}

      {(activeTab === "underwriting" || activeTab === "dossierScore") && (
      <div
        style={{
          marginBottom: "1rem",
          padding: "1rem 1.1rem",
          borderRadius: "1rem",
          border: "1px solid #dbeafe",
          background: "linear-gradient(135deg, #f8fbff 0%, #ffffff 100%)",
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ maxWidth: "760px" }}>
          <div style={{ fontSize: "0.76rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1d4ed8" }}>
            Deal Analysis
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>
            OM calculation and dossier generation now live on a standalone page.
          </div>
          <p style={{ margin: "0.45rem 0 0", fontSize: "0.9rem", color: "#475569", lineHeight: 1.55 }}>
            Use the dedicated analysis workspace to save property-specific underwriting, run the simplified OM metrics view, and generate the dossier without adding more collapsible sections here.
          </p>
          <div style={{ marginTop: "0.55rem", fontSize: "0.82rem", color: "#475569" }}>
            Status: <strong style={{ color: "#0f172a" }}>{analysisStatusLabel}</strong>
            {persistedDossierGeneration?.completedAt ? ` · Last completed ${formatDateOnly(persistedDossierGeneration.completedAt)}` : ""}
            {persistedDossierGeneration?.status === "running" ? ` · ${activeDossierStageLabel}` : ""}
          </div>
          {persistedDossierGeneration?.status === "failed" && persistedDossierGeneration.lastError && (
            <div style={{ marginTop: "0.35rem", fontSize: "0.82rem", color: "#b91c1c" }}>
              Last run failed: {persistedDossierGeneration.lastError}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
          <a
            href={`/deal-analysis?property_id=${encodeURIComponent(property.id)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.7rem 1rem",
              borderRadius: "999px",
              background: "#0f172a",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Open deal analysis
          </a>
          <a
            href={`/dossier-assumptions?property_id=${encodeURIComponent(property.id)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.7rem 1rem",
              borderRadius: "999px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#334155",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Advanced assumptions
          </a>
        </div>
      </div>
      )}

      {activeTab === "underwriting" && (
        <OmCalculationPanel
          draft={dossierDraft}
          calculation={omCalculation}
          loading={omCalculationLoading}
          running={omCalculationRunning}
          saving={dossierSettingsSaving}
          error={omCalculationError || dossierError}
          isDirty={isDossierDirty}
          hasAuthoritativeOm={hasAuthoritativeOm}
          hasBrokerEmailNotes={hasBrokerEmailNotes}
          formulaFurnishingSetupCosts={formulaDossierDefaults.furnishingSetupCosts}
          onDraftNumberChange={handleOmCalculationFieldChange}
          onDraftTextChange={handleOmCalculationTextChange}
          onUnitModelRowsChange={handleOmUnitModelRowsChange}
          onExpenseModelRowsChange={handleOmExpenseModelRowsChange}
          onRunCalculation={() => { void fetchOmCalculation(dossierDraft); }}
          onSave={() => { void handleOmCalculationSave(); }}
          onResetToSaved={handleOmCalculationReset}
          onApplyFormulaDefault={() => setDossierDraft((prev) => ({
            ...prev,
            furnishingSetupCosts: formulaDossierDefaults.furnishingSetupCosts,
          }))}
          onClearSaved={() => { void handleClearSavedOmOverrides(); }}
        />
      )}

      {(activeTab === "overview" || activeTab === "sources" || activeTab === "activity") && sourcingUpdate && (
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

      {activeTab === "overview" && (
      <>
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
        <V3ReportPanel
          title="Property details"
          subtitle="Listing facts, location identifiers, zoning, tax, assessment, broker, and source context in one readable view."
        >
          {!listingForDisplay && primaryListing === "loading" ? (
            <p className="initial-info-empty">Loading listing…</p>
          ) : null}
          {!listingForDisplay && primaryListing !== "loading" ? (
            <p className="initial-info-empty">No linked listing. Add a source listing or manual details to populate this section.</p>
          ) : null}

          <V3ReportSection title="Listing basics">
            <V3FactList items={propertyBasics} />
            {listingActivity?.lastActivityDate || extra?.priceChangeSinceListed ? (
              <V3Bullets
                items={[
                  listingActivity?.lastActivityDate
                    ? `Last activity: ${formatListedDate(listingActivity.lastActivityDate)} · ${formatPriceEventLabel(listingActivity.lastActivityEvent)}${listingActivity.lastActivityPrice != null ? ` · ${formatPrice(listingActivity.lastActivityPrice)}` : ""}`
                    : "",
                  (() => {
                    const p = extra?.priceChangeSinceListed as { listedPrice: number; currentPrice: number; changeAmount: number; changePercent: number } | undefined;
                    if (!p) return "";
                    if (p.changeAmount === 0) return `Listed at ${formatPrice(p.listedPrice)} with no price change.`;
                    const isDecrease = p.changeAmount < 0;
                    return `Listed at ${formatPrice(p.listedPrice)}; ${isDecrease ? "down" : "up"} ${formatPrice(Math.abs(p.changeAmount))} (${isDecrease ? "" : "+"}${p.changePercent.toFixed(1)}%).`;
                  })(),
                ].filter((item): item is string => Boolean(item))}
              />
            ) : null}
          </V3ReportSection>

          <V3ReportSection title="Location, zoning, and tax">
            <V3FactList items={[...locationFacts, ...zoningTaxFacts]} />
            {!enrichment?.certificateOfOccupancy && !enrichment?.zoning && !enrichment?.hpdRegistration && (d?.taxCode == null || String(d.taxCode).trim() === "") ? (
              <p className="initial-info-empty">Run enrichment to populate certificate of occupancy, zoning, tax code, and HPD registration.</p>
            ) : null}
          </V3ReportSection>

          <V3ReportSection title="Assessment and building area">
            <V3FactList items={assessmentFacts} />
          </V3ReportSection>

          <V3ReportSection title="Broker / agent">
            <V3FactList items={brokerFacts} />
          </V3ReportSection>

          <V3ReportSection title="Amenities and listing notes">
            {listingForDisplay && Array.isArray(extra?.amenities) && (extra!.amenities as string[]).length > 0 ? (
              <ul className="initial-info-amenities-pills">
                {(extra!.amenities as string[]).map((a, i) => (
                  <li key={i}>{formatReadableToken(a)}</li>
                ))}
              </ul>
            ) : (
              <p className="initial-info-empty">No amenities sourced from the linked listing yet.</p>
            )}
          </V3ReportSection>

          {priceHistoryRows.length > 0 ? (
            <V3ReportSection title="Price history">
              <V3RecordsTable
                columns={[
                  { key: "date", label: "Date", width: "9rem" },
                  { key: "price", label: "Price", width: "9rem", align: "right" },
                  { key: "event", label: "Event" },
                ]}
                rows={priceHistoryRows}
                emptyText="No price history rows sourced."
              />
            </V3ReportSection>
          ) : null}

          {listingForDisplay?.description ? (
            <V3ReportSection title="Description">
              <div className="initial-info-description-wrap property-card-description-wrap">
                <p
                  className={`property-card-description ${descriptionExpanded ? "property-card-description--expanded" : ""}`}
                  style={{ whiteSpace: "pre-wrap", color: "#34413b", lineHeight: 1.55, margin: 0 }}
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
            </V3ReportSection>
          ) : null}
        </V3ReportPanel>
      </CollapsibleSection>
      </>
      )}

      {activeTab === "enrichment" && (
      <>
      <V3ReportPanel
        title="Enrichment summary"
        subtitle="Owner, assessment, zoning, and NYC record checks are grouped as a single property intelligence report."
      >
        <V3ReportSection title="Owner and entity">
          <V3FactList
            items={[
              { label: "Owner name", value: ownerModuleName != null && String(ownerModuleName).trim() !== "" ? String(ownerModuleName).trim() : "—" },
              { label: "Owner business", value: ownerModuleBusiness != null && String(ownerModuleBusiness).trim() !== "" ? String(ownerModuleBusiness).trim() : "—" },
              { label: "Permit owner", value: ps?.owner_name != null && String(ps.owner_name).trim() !== "" ? String(ps.owner_name).trim() : "—" },
              { label: "Permit business", value: ps?.owner_business_name != null && String(ps.owner_business_name).trim() !== "" ? String(ps.owner_business_name).trim() : "—" },
              { label: "Valuation owner", value: ownerValuations != null && String(ownerValuations).trim() !== "" ? String(ownerValuations).trim() : "—" },
            ]}
          />
          {dosEntityQueryName && dosEntityLoading ? (
            <p className="initial-info-empty">Loading NY DOS entity details…</p>
          ) : null}
          {!dosEntityQueryName && dosEntity === "n/a" ? (
            <p className="initial-info-empty">NY DOS lookup not required because the owner does not appear to be a corporation, LLC, or similar entity.</p>
          ) : null}
          {dosEntityQueryName && !dosEntityLoading && dosEntity === "n/a" ? (
            <p className="initial-info-empty">No matching NY DOS entity found for &quot;{dosEntityQueryName}&quot;.</p>
          ) : null}
          {dosEntityQueryName && !dosEntityLoading && dosEntity !== null && dosEntity !== "n/a" ? (
            <V3Bullets
              items={[
                `Filing date: ${dosEntity.filingDate ?? "N/A"}`,
                `DOS process: ${joinedSummary([dosEntity.dosProcessName, dosEntity.dosProcessAddress])}`,
                `CEO: ${joinedSummary([dosEntity.ceoName, dosEntity.ceoAddress])}`,
                `Registered agent: ${joinedSummary([dosEntity.registeredAgentName, dosEntity.registeredAgentAddress])}`,
              ]}
            />
          ) : null}
        </V3ReportSection>

        <V3ReportSection title="Assessment and building area">
          <V3FactList
            items={[
              ...assessmentFacts,
              { label: "Appt date", value: assessedApptDate != null && String(assessedApptDate).trim() !== "" ? formatDateOnly(assessedApptDate) : "—" },
              { label: "Extract date", value: assessedExtractDate != null && String(assessedExtractDate).trim() !== "" ? formatDateOnly(assessedExtractDate) : "—" },
            ]}
          />
          {assessmentFacts.every((item) => item.value === "—") && (assessedApptDate == null || String(assessedApptDate).trim() === "") && (assessedExtractDate == null || String(assessedExtractDate).trim() === "") ? (
            <p className="initial-info-empty">From valuations enrichment by BBL. Run enrichment to populate.</p>
          ) : null}
        </V3ReportSection>

        <V3ReportSection title="Zoning, tax, and registration">
          <V3FactList items={[...locationFacts, ...zoningTaxFacts]} />
        </V3ReportSection>

        <V3ReportSection
          title="Permits, complaints, violations, and litigation"
          subtitle="Row-level city records are kept in one scrollable table instead of scattered cards."
        >
          {unifiedLoading ? (
            <p className="initial-info-empty">Loading city records…</p>
          ) : (
            <V3RecordsTable
              columns={[
                { key: "date", label: "Date", width: "8rem" },
                { key: "category", label: "Type", width: "10rem" },
                { key: "info", label: "Record details" },
              ]}
              rows={unifiedRecordRows}
              emptyText="No permit, violation, complaint, or litigation rows are on file yet. Open enrichment after running city data enrichment to populate this table."
            />
          )}
        </V3ReportSection>
      </V3ReportPanel>
      </>
      )}

      {activeTab === "marketComps" && (
        <BrokerCompsDetailPanel propertyId={property.id} surface={brokerCompSurface} subject={brokerCompSubjectBaseline} />
      )}

      {(activeTab === "documents" || activeTab === "outreach" || activeTab === "omWorkspace") && (
      <>
      {/* 5. Rental pricing / OM + rental financials (per-unit table, NOI, cap rate) */}
      <CollapsibleSection
        id="rental-om"
        title={activeTab === "documents" ? "Documents" : activeTab === "outreach" ? "Outreach" : "OM Workspace"}
        open={!!openSections.rentalOm}
        onToggle={() => toggle("rentalOm")}
      >
        <div className="rental-om-shell" data-active-tab={activeTab} style={{ fontSize: "0.875rem" }}>
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
                  setIncludeTourRequest(false);
                  setTourDateTime("");
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
            <div className="rental-om-modal" style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }} onClick={() => setInquiryEmailModalOpen(false)}>
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
                <div
                  style={{
                    marginBottom: "0.75rem",
                    padding: "0.65rem 0.7rem",
                    border: "1px solid #dbeafe",
                    borderRadius: "6px",
                    background: "#eff6ff",
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.82rem", fontWeight: 600, color: "#1e3a8a", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={includeTourRequest}
                      onChange={(e) => setIncludeTourRequest(e.target.checked)}
                    />
                    Also ask for a tour if available
                  </label>
                  {includeTourRequest && (
                    <div style={{ marginTop: "0.55rem" }}>
                      <label style={{ display: "block", fontSize: "0.72rem", marginBottom: "0.25rem", color: "#1e40af" }}>Preferred tour date and time</label>
                      <input
                        type="datetime-local"
                        value={tourDateTime}
                        onChange={(e) => setTourDateTime(e.target.value)}
                        style={{ width: "100%", maxWidth: "18rem", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #93c5fd", borderRadius: "4px" }}
                      />
                      <p style={{ margin: "0.35rem 0 0", color: tourRequestNeedsDateTime ? "#b91c1c" : "#1e40af", fontSize: "0.74rem", lineHeight: 1.4 }}>
                        {tourRequestNeedsDateTime
                          ? "Choose a date and time to add the tour request to the draft."
                          : tourDateTimeLabel
                            ? `Draft includes a polite tour request for ${tourDateTimeLabel}.`
                            : "The draft will update when you choose a date and time."}
                      </p>
                    </div>
                  )}
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
                    disabled={Boolean(inquirySending || !inquiryDraft.to?.trim() || tourRequestNeedsDateTime || (inquiryNeedsOverride && !sendAnotherConfirm))}
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
            <div className="rental-om-modal" style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }} onClick={() => setManualInquiryModalOpen(false)}>
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
          {(displayRentalCards.length > 0 || rentalFinancials?.fromLlm || rentalFinancials?.source) && (
            <V3ReportPanel
              title="Rental review"
              subtitle={rentalUnitsCopy}
            >
              <V3ReportSection title="Rental summary">
                <V3FactList items={rentalSummaryFacts} />
              </V3ReportSection>
              <V3ReportSection
                title={rentalUnitsHeading}
                subtitle="Unit media, unit mix, size, rent, dates, and source are shown as rows so rental history is scannable."
              >
                <V3RecordsTable
                  columns={[
                    { key: "image", label: "Photo", width: "5.5rem" },
                    { key: "unit", label: "Unit", width: "9rem" },
                    { key: "mix", label: "Beds / Baths", width: "8rem", align: "center" },
                    { key: "sqft", label: "Sqft", width: "7rem", align: "right" },
                    { key: "rent", label: "Last rent", width: "8rem", align: "right" },
                    { key: "annual", label: "Annual", width: "8rem", align: "right" },
                    { key: "date", label: "Date", width: "8rem" },
                    { key: "source", label: "Source", width: "8rem" },
                    { key: "notes", label: "Notes" },
                  ]}
                  rows={rentalReviewRows}
                  emptyText="No unit-level rental rows are available yet. Re-run rental flow or upload an OM/rent roll to populate the table."
                />
              </V3ReportSection>
              <V3ReportSection title="Rental notes">
                <V3Bullets
                  items={[
                    ...splitTakeawayText(rentalFinancials?.fromLlm?.rentalEstimates),
                    ...splitTakeawayText(rentalFinancials?.fromLlm?.dataGapSuggestions),
                  ]}
                />
              </V3ReportSection>
            </V3ReportPanel>
          )}
          {rentRollComparison && !rentRollComparison.comparable && rentalUnits.length > 0 && omRentRoll.length > 0 && (
            <p style={{ margin: "0.5rem 0", padding: "0.35rem 0.5rem", backgroundColor: "#fef3c7", borderRadius: "4px", fontSize: "0.8rem", color: "#92400e" }}>
              <strong>RapidAPI rent roll likely incomplete — comparison disabled.</strong> Only compare when total units and total bedrooms match (RapidAPI: {rentRollComparison.totalUnitsRapid} units, {rentRollComparison.totalBedsRapid} beds; OM: {rentRollComparison.totalUnitsOm} units, {rentRollComparison.totalBedsOm} beds).
            </p>
          )}
          {hasDisplayedOmPanel || omTakeaways.length > 0 ? (
            <V3ReportPanel title="OM analysis" subtitle={financialsCopy}>
              <V3ReportSection title="Investor takeaways">
                <V3Bullets items={omTakeaways} />
              </V3ReportSection>

              <V3ReportSection title="Key metrics">
                <V3FactList items={omMetricFacts} />
              </V3ReportSection>

              {hasAuthoritativeOm && authoritativeValidationMessages.length > 0 ? (
                <V3ReportSection title="Validation flags">
                  <V3Bullets items={authoritativeValidationMessages.slice(0, 8)} />
                </V3ReportSection>
              ) : null}

              {omRentRoll.length > 0 ? (
                <V3ReportSection title="OM rent roll">
                  <V3RecordsTable
                    columns={[
                      { key: "unit", label: "Unit", width: "8rem" },
                      { key: "monthly", label: "Monthly", width: "8rem", align: "right" },
                      { key: "annual", label: "Annual", width: "8rem", align: "right" },
                      { key: "mix", label: "Beds / Baths", width: "8rem", align: "center" },
                      { key: "sqft", label: "SF", width: "7rem", align: "right" },
                      { key: "status", label: "Status", width: "10rem" },
                      { key: "notes", label: "Notes" },
                    ]}
                    rows={omRentRoll.map((unit) => ({
                      unit: unit.unit ?? "—",
                      monthly: unit.monthlyRent != null ? formatPrice(unit.monthlyRent) : "—",
                      annual: unit.annualRent != null ? formatPrice(unit.annualRent) : unit.monthlyRent != null ? formatPrice(unit.monthlyRent * 12) : "—",
                      mix: `${unit.beds ?? "—"} / ${unit.baths ?? "—"}`,
                      sqft: unit.sqft != null ? unit.sqft.toLocaleString() : "—",
                      status: joinedSummary([unit.rentType ?? null, unit.tenantStatus ?? null]),
                      notes: unit.notes ?? "—",
                    }))}
                    emptyText="No OM rent roll rows are available."
                  />
                </V3ReportSection>
              ) : null}

              {expenseRows.length > 0 ? (
                <V3ReportSection title="Expense table">
                  <V3RecordsTable
                    columns={[
                      { key: "item", label: "Line item" },
                      { key: "amount", label: "Amount", width: "10rem", align: "right" },
                    ]}
                    rows={[
                      ...expenseRows,
                      { item: <strong>Total expenses</strong>, amount: <strong>{formatPrice(displayedExpenseTotal)}</strong> },
                    ]}
                    emptyText="No expense rows are available."
                  />
                </V3ReportSection>
              ) : null}
            </V3ReportPanel>
          ) : (
            <V3ReportPanel title={financialsHeading} subtitle={financialsCopy}>
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.86rem" }}>
                Upload or promote an OM snapshot to populate investor takeaways, key metrics, rent roll rows, and expense tables.
              </p>
            </V3ReportPanel>
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
                    <div key={doc.id} className={`rental-om-doc-card ${selectedDocument?.id === doc.id ? "rental-om-doc-card--selected" : ""}`}>
                      <div style={{ minWidth: 0 }}>
                        <button
                          type="button"
                          className="rental-om-doc-title-button"
                          onClick={() => setSelectedDocumentId(doc.id)}
                        >
                          {doc.fileName}
                        </button>
                        <div style={{ fontSize: "0.75rem", color: "#555", marginTop: "0.15rem" }}>
                          {doc.source} · {formatDateOnly(doc.createdAt)}
                        </div>
                        <a
                          href={`${API_BASE}/api/properties/${property.id}/documents/${doc.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-block", marginTop: "0.3rem", fontSize: "0.74rem", color: "#475569", fontWeight: 650 }}
                        >
                          Open file
                        </a>
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
                            setSelectedDocumentId((current) => (current === doc.id ? null : current));
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
            <div className="rental-om-panel rental-om-document-preview">
              <strong style={{ display: "block", marginBottom: "0.2rem" }}>Preview</strong>
              <p style={{ margin: "0 0 0.55rem", fontSize: "0.75rem", color: "#666" }}>
                Select a document to preview it here.
              </p>
              {selectedDocument && selectedDocumentUrl ? (
                documentIsPdf(selectedDocument) ? (
                  <iframe
                    title={`Preview ${selectedDocument.fileName}`}
                    src={selectedDocumentUrl}
                    className="rental-om-document-preview-frame"
                  />
                ) : documentIsImage(selectedDocument) ? (
                  <img
                    src={selectedDocumentUrl}
                    alt={selectedDocument.fileName}
                    className="rental-om-document-preview-image"
                  />
                ) : (
                  <div className="rental-om-document-preview-empty">
                    <div>
                      <strong style={{ display: "block", color: "#0f172a", marginBottom: "0.25rem" }}>
                        Preview not available
                      </strong>
                      <div style={{ marginBottom: "0.65rem" }}>{selectedDocument.fileName}</div>
                      <a
                        href={selectedDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="property-detail-rail-button"
                        style={{ width: "auto", minHeight: "2.1rem", display: "inline-flex" }}
                      >
                        Open file
                      </a>
                    </div>
                  </div>
                )
              ) : (
                <div className="rental-om-document-preview-empty">No document selected.</div>
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
                  const nextDocument = { id: data.document.id, fileName: data.document.filename, fileType: data.document.contentType ?? null, source: data.document.category ?? "uploaded", sourceType: "uploaded" as const, createdAt: data.document.createdAt };
                  setUnifiedDocuments((prev) => (prev ? [nextDocument, ...prev] : [nextDocument]));
                  setSelectedDocumentId(nextDocument.id);
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
      </>
      )}

      {activeTab === "activity" && (
      <>
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
      </>
      )}

      {activeTab === "dossierScore" && (
      <div style={{ marginTop: "1.5rem", fontSize: "0.8rem", color: "#64748b" }}>
        Deal dossier generation now runs from the dedicated section above using these property-level costs plus your saved profile defaults.
      </div>
      )}
      </PropertyDetailWorkspace>
    </div>
  );
}
