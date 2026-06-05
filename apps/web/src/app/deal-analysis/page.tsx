"use client";

import type { PropertyDetails } from "@re-sourcing/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OM_CALC_NUMERIC_FIELDS,
  OmCalculationPanel,
  type OmCalculationDraft,
  type OmCalculationExpenseModelRow,
  type OmCalculationNumericField,
  type OmCalculationSnapshot,
  type OmCalculationTextField,
  type OmCalculationUnitModelRow,
} from "../property-data/OmCalculationPanel";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const OM_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const OM_IMPORT_MAX_FILES = 20;

type WorkspaceProperty = OmCalculationSnapshot["property"];

interface UploadedDocumentSummary {
  id?: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
}

interface ResolvedOmAddress {
  rawAddress: string;
  addressLine: string;
  locality: string | null;
  zip: string | null;
  canonicalAddress: string;
  addressSource: "packageAddress" | "addressLine" | "address";
  canAttemptBblResolution: boolean;
}

interface MatchedPropertyPreview {
  id: string;
  canonicalAddress: string;
  matchStrategy: "exact_canonical" | "address_line" | "new";
}

interface AnalyzeUploadResponse {
  ok: boolean;
  property: WorkspaceProperty;
  propertyId?: string;
  canonicalAddress?: string;
  createdProperty?: boolean;
  matchStrategy?: "exact_canonical" | "address_line" | "new";
  resolvedAddress: ResolvedOmAddress | null;
  matchedProperty: MatchedPropertyPreview | null;
  uploadedDocuments: UploadedDocumentSummary[];
  details: PropertyDetails;
  calculation: OmCalculationSnapshot;
  enrichment?: CreatePropertyResponse["enrichment"];
}

interface RecalculateResponse {
  ok: boolean;
  property: WorkspaceProperty;
  calculation: OmCalculationSnapshot;
}

interface CreatePropertyResponse {
  ok: boolean;
  propertyId: string;
  canonicalAddress: string;
  createdProperty: boolean;
  matchStrategy: "exact_canonical" | "address_line" | "new";
  enrichment?: {
    attempted: boolean;
    ok: boolean;
    bbl: string | null;
    bin: string | null;
    warning?: string | null;
  } | null;
}

interface PropertyResponse {
  id: string;
  canonicalAddress: string;
  details: PropertyDetails | null;
  createdAt: string;
  updatedAt: string;
}

interface PropertyDocumentResponse {
  fileName: string;
  fileType?: string | null;
  source?: string | null;
  sourceType: "inquiry" | "uploaded" | "generated";
  createdAt?: string | null;
}

interface PropertyDocumentsResponse {
  propertyId?: string;
  documents: PropertyDocumentResponse[];
}

interface GeneratedDocumentSummary {
  id: string;
  fileName: string;
  storagePath?: string | null;
}

interface PersistedDossierResponse {
  ok: boolean;
  propertyId: string;
  dossierDoc?: GeneratedDocumentSummary | null;
  excelDoc?: GeneratedDocumentSummary | null;
  dealScore?: number | null;
  dossierFormat?: string | null;
  scoringProfile?: string | null;
  error?: string;
  details?: string;
}

interface SavedWorkspaceSummary {
  propertyId: string;
  canonicalAddress: string;
  updatedAt: string;
  omImportedAt: string | null;
  assumptionsUpdatedAt: string | null;
  workspaceUpdatedAt?: string | null;
  uploadedOmAt?: string | null;
  uploadedOmFileName?: string | null;
  uploadedOmCategory?: string | null;
  omFileName: string | null;
  hasAuthoritativeOm: boolean;
  unitModelRowCount: number;
  expenseModelRowCount: number;
  hasBrokerEmailNotes: boolean;
  dossierStatus: "not_started" | "running" | "completed" | "failed" | null;
}

interface SavedWorkspacesResponse {
  workspaces: SavedWorkspaceSummary[];
}

type WorkspaceFilter = "all" | "uploaded_docs" | "manual_edits" | "dossier_ready" | "needs_dossier";
type WorkspaceSort = "recent" | "address" | "dossier";

const pageShellStyle: React.CSSProperties = {
  width: "min(100%, 1640px)",
  margin: "0 auto",
  padding: "0",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  color: "var(--app-ink)",
  fontVariantNumeric: "tabular-nums",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--app-line)",
  borderRadius: "8px",
  background: "var(--app-surface)",
  boxShadow: "var(--app-shadow-xs)",
};

const inputStyle: React.CSSProperties = {
  minHeight: "2.45rem",
  border: "1px solid var(--app-line-strong)",
  borderRadius: "8px",
  padding: "0.52rem 0.68rem",
  color: "var(--app-ink)",
  background: "var(--app-surface)",
  fontSize: "0.88rem",
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: "2.35rem",
  padding: "0.58rem 0.85rem",
  borderRadius: "8px",
  border: "1px solid var(--brand)",
  background: "var(--brand)",
  color: "var(--brand-on)",
  fontSize: "0.86rem",
  fontWeight: 750,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: "2.35rem",
  padding: "0.58rem 0.85rem",
  borderRadius: "8px",
  border: "1px solid var(--app-line-strong)",
  background: "var(--app-surface)",
  color: "var(--brand-strong)",
  fontSize: "0.86rem",
  fontWeight: 750,
  cursor: "pointer",
};

function emptyDraft(): OmCalculationDraft {
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

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value || value.trim().length === 0) return "—";
  const normalized = value.includes("T") ? value : `${value}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || value <= 0) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function resolveSavedWorkspaceAddress(
  property: Pick<PropertyResponse, "canonicalAddress" | "details">
): ResolvedOmAddress | null {
  const raw = property.details?.omDerivedAddress;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const canonicalAddress =
      typeof record.canonicalAddress === "string" && record.canonicalAddress.trim().length > 0
        ? record.canonicalAddress.trim()
        : property.canonicalAddress;
    const addressLine =
      typeof record.addressLine === "string" && record.addressLine.trim().length > 0
        ? record.addressLine.trim()
        : canonicalAddress.split(",")[0]?.trim() || canonicalAddress;
    return {
      rawAddress:
        typeof record.rawAddress === "string" && record.rawAddress.trim().length > 0
          ? record.rawAddress.trim()
          : canonicalAddress,
      addressLine,
      locality:
        typeof record.locality === "string" && record.locality.trim().length > 0
          ? record.locality.trim()
          : null,
      zip:
        typeof record.zip === "string" && record.zip.trim().length > 0
          ? record.zip.trim()
          : null,
      canonicalAddress,
      addressSource:
        record.addressSource === "packageAddress" ||
        record.addressSource === "addressLine" ||
        record.addressSource === "address"
          ? record.addressSource
          : "address",
      canAttemptBblResolution: false,
    };
  }
  if (!property.canonicalAddress.trim()) return null;
  return {
    rawAddress: property.canonicalAddress,
    addressLine: property.canonicalAddress.split(",")[0]?.trim() || property.canonicalAddress,
    locality: null,
    zip: null,
    canonicalAddress: property.canonicalAddress,
    addressSource: "address",
    canAttemptBblResolution: false,
  };
}

function summarizeUploadedPropertyDocuments(
  documents: PropertyDocumentResponse[] | null | undefined
): UploadedDocumentSummary[] {
  return (documents ?? [])
    .filter((document) => document.sourceType === "uploaded")
    .map((document) => ({
      fileName: document.fileName,
      mimeType: document.fileType ?? null,
      sizeBytes: null,
    }));
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

function draftFromCalculation(calculation: OmCalculationSnapshot): OmCalculationDraft {
  return {
    purchasePrice: calculation.assumptions.purchasePrice ?? calculation.property.askingPrice ?? null,
    buildingSqft: calculation.assumptions.buildingSqft ?? calculation.propertyInfo.sizeSqft ?? null,
    purchaseClosingCostPct: calculation.assumptions.purchaseClosingCostPct ?? null,
    renovationCosts: calculation.assumptions.renovationCosts ?? 0,
    furnishingSetupCosts: calculation.assumptions.furnishingSetupCosts ?? null,
    investmentProfile: calculation.acquisitionMetadata.investmentProfile ?? "",
    targetAcquisitionDate: calculation.acquisitionMetadata.targetAcquisitionDate ?? "",
    ltvPct: calculation.assumptions.ltvPct ?? null,
    interestRatePct: calculation.assumptions.interestRatePct ?? null,
    amortizationYears: calculation.assumptions.amortizationYears ?? null,
    loanFeePct: calculation.assumptions.loanFeePct ?? null,
    rentUpliftPct: calculation.assumptions.rentUpliftPct ?? null,
    expenseIncreasePct: calculation.assumptions.expenseIncreasePct ?? null,
    managementFeePct: calculation.assumptions.managementFeePct ?? null,
    occupancyTaxPct: calculation.assumptions.occupancyTaxPct ?? null,
    vacancyPct: calculation.assumptions.vacancyPct ?? null,
    leadTimeMonths: calculation.assumptions.leadTimeMonths ?? null,
    annualRentGrowthPct: calculation.assumptions.annualRentGrowthPct ?? null,
    annualCommercialRentGrowthPct: calculation.assumptions.annualCommercialRentGrowthPct ?? null,
    annualOtherIncomeGrowthPct: calculation.assumptions.annualOtherIncomeGrowthPct ?? null,
    annualExpenseGrowthPct: calculation.assumptions.annualExpenseGrowthPct ?? null,
    annualPropertyTaxGrowthPct: calculation.assumptions.annualPropertyTaxGrowthPct ?? null,
    recurringCapexAnnual: calculation.assumptions.recurringCapexAnnual ?? null,
    currentNoi:
      calculation.savedAssumptions?.currentNoi ??
      (calculation.currentFinancials.isNoiOverridden ? calculation.currentFinancials.noi : null),
    holdPeriodYears: calculation.assumptions.holdPeriodYears ?? null,
    exitCapPct: calculation.assumptions.exitCapPct ?? null,
    exitClosingCostPct: calculation.assumptions.exitClosingCostPct ?? null,
    targetIrrPct: calculation.assumptions.targetIrrPct ?? null,
    unitModelRows: calculation.unitModelRows,
    expenseModelRows: calculation.expenseModelRows,
    brokerEmailNotes: calculation.savedAssumptions?.brokerEmailNotes ?? "",
  };
}

function buildAssumptionsPayload(draft: OmCalculationDraft): Record<string, number | string | null> {
  const assumptions = OM_CALC_NUMERIC_FIELDS.reduce<Record<string, number | string | null>>(
    (acc, field) => {
      acc[field] = draft[field] ?? null;
      return acc;
    },
    {}
  );
  assumptions.investmentProfile = draft.investmentProfile.trim() || null;
  assumptions.targetAcquisitionDate = draft.targetAcquisitionDate.trim() || null;
  return assumptions;
}

function normalizeWorkspaceDraft(draft: OmCalculationDraft): OmCalculationDraft {
  return {
    ...draft,
    brokerEmailNotes: draft.brokerEmailNotes.trim(),
  };
}

function workspaceSavePayload(draft: OmCalculationDraft) {
  return {
    ...buildAssumptionsPayload(draft),
    brokerEmailNotes: draft.brokerEmailNotes,
    unitModelRows: draft.unitModelRows ?? [],
    expenseModelRows: draft.expenseModelRows ?? [],
  };
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }, 1000);
}

function getSavedWorkspaceUpdatedAt(workspace: SavedWorkspaceSummary): string | null {
  return (
    workspace.assumptionsUpdatedAt ??
    workspace.workspaceUpdatedAt ??
    workspace.omImportedAt ??
    workspace.uploadedOmAt ??
    workspace.updatedAt ??
    null
  );
}

function hasManualWorkspaceEdits(workspace: SavedWorkspaceSummary): boolean {
  return (
    workspace.assumptionsUpdatedAt != null ||
    workspace.unitModelRowCount > 0 ||
    workspace.expenseModelRowCount > 0 ||
    workspace.hasBrokerEmailNotes
  );
}

async function downloadPropertyDocument(propertyId: string, document: GeneratedDocumentSummary, fallbackName: string) {
  const res = await fetch(
    `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/${encodeURIComponent(document.id)}/file`
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.details || data?.error || `Failed to download ${fallbackName}.`);
  }
  const blob = await res.blob();
  downloadBlob(blob, document.fileName || fallbackName);
}

function DealAnalysisPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("property_id")?.trim() || null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [omUrl, setOmUrl] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<File[]>([]);
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocumentSummary[]>([]);
  const [workspaceDetails, setWorkspaceDetails] = useState<PropertyDetails | null>(null);
  const [workspaceProperty, setWorkspaceProperty] = useState<WorkspaceProperty | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<ResolvedOmAddress | null>(null);
  const [matchedProperty, setMatchedProperty] = useState<MatchedPropertyPreview | null>(null);
  const [calculation, setCalculation] = useState<OmCalculationSnapshot | null>(null);
  const [draft, setDraft] = useState<OmCalculationDraft>(emptyDraft);
  const [baselineDraft, setBaselineDraft] = useState<OmCalculationDraft>(emptyDraft);
  const [uploading, setUploading] = useState(false);
  const [linkAnalyzing, setLinkAnalyzing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [dossierDownloading, setDossierDownloading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [savedWorkspaceLoading, setSavedWorkspaceLoading] = useState(false);
  const [savedWorkspacesLoading, setSavedWorkspacesLoading] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspaceSummary[]>([]);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("all");
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>("recent");
  const [workspaceResultsOpen, setWorkspaceResultsOpen] = useState(false);
  const [propertyCreating, setPropertyCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreatePropertyResponse | null>(null);

  const numericFieldsDirty = OM_CALC_NUMERIC_FIELDS.some(
    (field) => (draft[field] ?? null) !== (baselineDraft[field] ?? null)
  );
  const unitRowsDirty =
    serializeUnitModelRows(draft.unitModelRows) !== serializeUnitModelRows(baselineDraft.unitModelRows);
  const expenseRowsDirty =
    serializeExpenseModelRows(draft.expenseModelRows) !==
    serializeExpenseModelRows(baselineDraft.expenseModelRows);
  const metadataDirty =
    draft.investmentProfile.trim() !== baselineDraft.investmentProfile.trim() ||
    draft.targetAcquisitionDate !== baselineDraft.targetAcquisitionDate;
  const brokerNotesDirty = draft.brokerEmailNotes.trim() !== baselineDraft.brokerEmailNotes.trim();
  const isDirty = numericFieldsDirty || unitRowsDirty || expenseRowsDirty || metadataDirty || brokerNotesDirty;
  const hasAuthoritativeOm = workspaceDetails?.omData?.authoritative != null;
  const oversizedPendingFiles = pendingFiles.filter((file) => file.size > OM_IMPORT_MAX_BYTES);
  const tooManyPendingFiles = pendingFiles.length > OM_IMPORT_MAX_FILES;
  const canAnalyze = pendingFiles.length > 0 && oversizedPendingFiles.length === 0 && !tooManyPendingFiles;
  const canAnalyzeLink = omUrl.trim().length > 0;
  const canGenerateDossier = workspaceDetails != null;
  const pendingSelectionReplacesWorkspace =
    workspaceDetails != null && pendingFiles.length > 0 && pendingFiles !== workspaceFiles;
  const formulaFurnishingDefault =
    typeof calculation?.assumptions.furnishingSetupCosts === "number"
      ? calculation.assumptions.furnishingSetupCosts
      : null;
  const activeSavedWorkspace = savedWorkspaces.find((workspace) => workspace.propertyId === propertyId) ?? null;
  const savedWorkspaceUpdatedAt =
    activeSavedWorkspace?.assumptionsUpdatedAt ??
    activeSavedWorkspace?.workspaceUpdatedAt ??
    activeSavedWorkspace?.omImportedAt ??
    activeSavedWorkspace?.uploadedOmAt ??
    workspaceDetails?.dealDossier?.assumptions?.updatedAt ??
    null;
  const filteredSavedWorkspaces = useMemo(() => {
    const normalizedSearch = workspaceSearch.trim().toLowerCase();
    return savedWorkspaces
      .filter((workspace) => {
        if (workspaceFilter === "uploaded_docs" && workspace.uploadedOmAt == null) return false;
        if (workspaceFilter === "manual_edits" && !hasManualWorkspaceEdits(workspace)) return false;
        if (workspaceFilter === "dossier_ready" && workspace.dossierStatus !== "completed") return false;
        if (workspaceFilter === "needs_dossier" && workspace.dossierStatus === "completed") return false;
        if (!normalizedSearch) return true;
        const haystack = [
          workspace.canonicalAddress,
          workspace.omFileName,
          workspace.uploadedOmFileName,
          workspace.uploadedOmCategory,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((left, right) => {
        if (workspaceSort === "address") {
          return left.canonicalAddress.localeCompare(right.canonicalAddress);
        }
        if (workspaceSort === "dossier") {
          const leftDossier = left.dossierStatus === "completed" ? 0 : 1;
          const rightDossier = right.dossierStatus === "completed" ? 0 : 1;
          if (leftDossier !== rightDossier) return leftDossier - rightDossier;
        }
        return (getSavedWorkspaceUpdatedAt(right) ?? "").localeCompare(
          getSavedWorkspaceUpdatedAt(left) ?? ""
        );
      });
  }, [savedWorkspaces, workspaceFilter, workspaceSearch, workspaceSort]);

  const summaryCards = useMemo(
    () =>
      calculation
        ? [
            {
              label: "Current NOI",
              value: formatCurrency(calculation.topLineMetrics.currentNoi),
            },
            {
              label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} NOI`,
              value: formatCurrency(calculation.topLineMetrics.projectedYearNoi),
            },
            {
              label:
                calculation.topLineMetrics.holdPeriodYears != null
                  ? `Projected ${formatNumber(calculation.topLineMetrics.holdPeriodYears)}-year IRR`
                  : "Projected IRR",
              value:
                calculation.topLineMetrics.irrPct != null
                  ? `${(calculation.topLineMetrics.irrPct * 100).toFixed(1)}%`
                  : "—",
            },
            {
              label: "Avg cash-on-cash",
              value:
                calculation.topLineMetrics.averageCashOnCashReturn != null
                  ? `${(calculation.topLineMetrics.averageCashOnCashReturn * 100).toFixed(1)}%`
                  : "—",
            },
          ]
        : [],
    [calculation]
  );

  const loadSavedWorkspaces = useCallback(async () => {
    setSavedWorkspacesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/deal-analysis/workspaces?limit=80`);
      const data = (await res.json().catch(() => ({}))) as Partial<SavedWorkspacesResponse> & {
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load saved OM workspaces.");
      }
      setSavedWorkspaces(data.workspaces ?? []);
    } catch {
      setSavedWorkspaces([]);
    } finally {
      setSavedWorkspacesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedWorkspaces();
  }, [loadSavedWorkspaces]);

  useEffect(() => {
    if (!propertyId) return;
    const activePropertyId = propertyId;
    const abortController = new AbortController();
    let cancelled = false;

    async function loadSavedWorkspace() {
      setSavedWorkspaceLoading(true);
      setError(null);
      setNotice(null);
      setCreateResult(null);
      try {
        const [propertyRes, calculationRes, documentsData] = await Promise.all([
          fetch(`${API_BASE}/api/properties/${encodeURIComponent(activePropertyId)}`, {
            signal: abortController.signal,
          }),
          fetch(`${API_BASE}/api/properties/${encodeURIComponent(activePropertyId)}/om-calculation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: abortController.signal,
          }),
          fetch(`${API_BASE}/api/properties/${encodeURIComponent(activePropertyId)}/documents`, {
            signal: abortController.signal,
          })
            .then(async (response) => {
              if (!response.ok) return { documents: [] } as PropertyDocumentsResponse;
              return ((await response.json().catch(() => ({}))) ?? {}) as PropertyDocumentsResponse;
            })
            .catch(() => ({ documents: [] } as PropertyDocumentsResponse)),
        ]);

        const propertyData = ((await propertyRes.json().catch(() => ({}))) ?? {}) as
          | PropertyResponse
          | { error?: string; details?: string };
        if (
          !propertyRes.ok ||
          ("error" in propertyData && typeof propertyData.error === "string")
        ) {
          const failedProperty = propertyData as { error?: string; details?: string };
          throw new Error(
            failedProperty.details || failedProperty.error || "Failed to load saved OM workspace."
          );
        }

        const calculationData = ((await calculationRes.json().catch(() => ({}))) ?? {}) as
          | Partial<OmCalculationSnapshot>
          | { error?: string; details?: string };
        if (
          !calculationRes.ok ||
          ("error" in calculationData && typeof calculationData.error === "string")
        ) {
          const failedCalculation = calculationData as { error?: string; details?: string };
          throw new Error(
            failedCalculation.details ||
              failedCalculation.error ||
              "Failed to rebuild the saved OM workspace."
          );
        }

        if (cancelled) return;

        const nextProperty = propertyData as PropertyResponse;
        const nextCalculation = calculationData as OmCalculationSnapshot;
        const nextDraft = draftFromCalculation(nextCalculation);
        setPendingFiles([]);
        setWorkspaceFiles([]);
        setUploadedDocuments(summarizeUploadedPropertyDocuments(documentsData.documents));
        setWorkspaceDetails((nextProperty.details ?? null) as PropertyDetails | null);
        setWorkspaceProperty((nextCalculation.property ?? null) as WorkspaceProperty | null);
        setResolvedAddress(resolveSavedWorkspaceAddress(nextProperty));
        setMatchedProperty({
          id: nextProperty.id,
          canonicalAddress: nextProperty.canonicalAddress,
          matchStrategy: "exact_canonical",
        });
        setCalculation(nextCalculation);
        setDraft(nextDraft);
        setBaselineDraft(nextDraft);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setNotice("Prior OM workspace loaded from the saved property record.");
      } catch (err) {
        if (cancelled || abortController.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load saved OM workspace.");
      } finally {
        if (!cancelled) setSavedWorkspaceLoading(false);
      }
    }

    void loadSavedWorkspace();
    return () => {
      cancelled = true;
      abortController.abort();
      setSavedWorkspaceLoading(false);
    };
  }, [propertyId]);

  function clearWorkspaceState() {
    setPendingFiles([]);
    setOmUrl("");
    setWorkspaceFiles([]);
    setUploadedDocuments([]);
    setWorkspaceDetails(null);
    setWorkspaceProperty(null);
    setResolvedAddress(null);
    setMatchedProperty(null);
    setCalculation(null);
    setDraft(emptyDraft());
    setBaselineDraft(emptyDraft());
    setError(null);
    setNotice(null);
    setCreateResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function resetWorkspace() {
    clearWorkspaceState();
    if (propertyId) router.replace("/deal-analysis");
    setNotice("Fresh OM workspace ready. Upload OM PDFs below to create or match a property-backed workspace.");
  }

  function applyAnalyzedWorkspace(
    data: Partial<AnalyzeUploadResponse>,
    sourceFiles: File[],
    sourceLabel: "uploaded OM" | "OM link"
  ) {
    const nextCalculation = data.calculation as OmCalculationSnapshot;
    const nextDraft = draftFromCalculation(nextCalculation);
    setWorkspaceFiles(data.propertyId ? [] : sourceFiles);
    setUploadedDocuments(data.uploadedDocuments ?? []);
    setWorkspaceDetails((data.details ?? null) as PropertyDetails | null);
    setWorkspaceProperty((data.property ?? null) as WorkspaceProperty | null);
    setResolvedAddress((data.resolvedAddress ?? null) as ResolvedOmAddress | null);
    setMatchedProperty((data.matchedProperty ?? null) as MatchedPropertyPreview | null);
    setCalculation(nextCalculation);
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    if (data.propertyId) {
      setPendingFiles([]);
      setOmUrl("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      const createSummary: CreatePropertyResponse = {
        ok: true,
        propertyId: data.propertyId,
        canonicalAddress:
          data.canonicalAddress ??
          data.matchedProperty?.canonicalAddress ??
          data.property?.canonicalAddress ??
          "Unknown property",
        createdProperty: data.createdProperty ?? data.matchStrategy === "new",
        matchStrategy: data.matchStrategy ?? data.matchedProperty?.matchStrategy ?? "new",
        enrichment: data.enrichment ?? null,
      };
      setCreateResult(createSummary);
      void loadSavedWorkspaces();
      router.replace(`/deal-analysis?property_id=${encodeURIComponent(data.propertyId)}`);
      setNotice(
        createSummary.createdProperty
          ? `Draft property workspace created from the ${sourceLabel} and sent through enrichment.`
          : `Existing property workspace matched from the ${sourceLabel} and updated.`
      );
    } else if (propertyId) {
      router.replace("/deal-analysis");
      setNotice(`${sourceLabel === "OM link" ? "OM link" : "Uploaded OM PDF(s)"} analyzed. Adjust assumptions and refresh analysis as needed.`);
    } else {
      setNotice(`${sourceLabel === "OM link" ? "OM link" : "Uploaded OM PDF(s)"} analyzed. Adjust assumptions and refresh analysis as needed.`);
    }
  }

  async function analyzeUploads() {
    if (pendingFiles.length === 0) return;
    if (tooManyPendingFiles) {
      setError(`Upload up to ${OM_IMPORT_MAX_FILES} OM PDFs at a time.`);
      return;
    }
    if (oversizedPendingFiles.length > 0) {
      setError(`Each OM PDF must be ${formatBytes(OM_IMPORT_MAX_BYTES)} or smaller.`);
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    setCreateResult(null);
    try {
      const formData = new FormData();
      for (const file of pendingFiles) formData.append("files", file);
      const res = await fetch(`${API_BASE}/api/deal-analysis/analyze-upload`, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AnalyzeUploadResponse> & {
        error?: string;
        details?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.details || data.error || "Failed to analyze uploaded OM PDF(s).");
      }
      applyAnalyzedWorkspace(data, pendingFiles, "uploaded OM");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze uploaded OM PDF(s).");
    } finally {
      setUploading(false);
    }
  }

  async function analyzeOmLink() {
    const trimmedUrl = omUrl.trim();
    if (!trimmedUrl) return;
    setLinkAnalyzing(true);
    setError(null);
    setNotice(null);
    setCreateResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/deal-analysis/analyze-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ omUrl: trimmedUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AnalyzeUploadResponse> & {
        error?: string;
        details?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.details || data.error || "Failed to analyze OM link.");
      }
      applyAnalyzedWorkspace(data, [], "OM link");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze OM link.");
    } finally {
      setLinkAnalyzing(false);
    }
  }

  async function persistWorkspaceDraft(nextDraft: OmCalculationDraft) {
    if (!propertyId) {
      throw new Error("No property workspace is open.");
    }
    const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/dossier-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspaceSavePayload(nextDraft)),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: string;
    };
    if (!res.ok || data.error) {
      throw new Error(data.details || data.error || "Failed to save the OM workspace.");
    }
  }

  async function recalculateAnalysis() {
    if (!workspaceDetails) return;
    setRecalculating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/deal-analysis/recalculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          details: workspaceDetails,
          assumptions: buildAssumptionsPayload(draft),
          brokerEmailNotes: draft.brokerEmailNotes.trim() || null,
          unitModelRows: draft.unitModelRows ?? null,
          expenseModelRows: draft.expenseModelRows ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<RecalculateResponse> & {
        error?: string;
        details?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.details || data.error || "Failed to refresh OM analysis.");
      }
      const nextCalculation = data.calculation as OmCalculationSnapshot;
      const nextDraft = normalizeWorkspaceDraft(draftFromCalculation(nextCalculation));
      let savedToWorkspace = false;
      let saveError: string | null = null;
      if (propertyId) {
        setWorkspaceSaving(true);
        try {
          await persistWorkspaceDraft(nextDraft);
          savedToWorkspace = true;
        } catch (err) {
          saveError = getErrorMessage(err, "Failed to save the OM workspace.");
        } finally {
          setWorkspaceSaving(false);
        }
      }
      setWorkspaceProperty((data.property ?? null) as WorkspaceProperty | null);
      setCalculation(nextCalculation);
      setDraft(nextDraft);
      if (!propertyId || savedToWorkspace) {
        setBaselineDraft(nextDraft);
      }
      if (saveError) {
        setError(`Analysis refreshed, but the workspace could not be saved: ${saveError}`);
        setNotice(null);
      } else {
        setNotice(
          propertyId
            ? "Analysis refreshed and saved to this property workspace."
            : "Analysis refreshed with the latest underwriting edits."
        );
      }
      if (savedToWorkspace) {
        void loadSavedWorkspaces();
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to refresh OM analysis."));
    } finally {
      setRecalculating(false);
    }
  }

  async function saveWorkspaceToProperty() {
    if (!propertyId) return;
    setWorkspaceSaving(true);
    setError(null);
    try {
      const nextDraft = normalizeWorkspaceDraft(draft);
      await persistWorkspaceDraft(nextDraft);
      setDraft(nextDraft);
      setBaselineDraft(nextDraft);
      setNotice("Saved the OM workspace back to the property record.");
      void loadSavedWorkspaces();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save the OM workspace."));
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function generatePersistedDossier(downloadKind: "pdf" | "excel") {
    if (!propertyId) return false;
    const nextDraft = normalizeWorkspaceDraft(draft);
    setWorkspaceSaving(true);
    try {
      await persistWorkspaceDraft(nextDraft);
    } finally {
      setWorkspaceSaving(false);
    }
    const res = await fetch(`${API_BASE}/api/dossier/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        assumptions: buildAssumptionsPayload(nextDraft),
        dossierFormat: "teaser",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as PersistedDossierResponse;
    if (!res.ok || data.error) {
      throw new Error(data.details || data.error || "Failed to generate saved deal dossier.");
    }
    const document = downloadKind === "pdf" ? data.dossierDoc : data.excelDoc;
    if (!document?.id) {
      throw new Error(downloadKind === "pdf" ? "Dossier document was not returned." : "Excel document was not returned.");
    }
    await downloadPropertyDocument(
      propertyId,
      document,
      downloadKind === "pdf" ? "Deal-Dossier.pdf" : "Deal-Dossier-Workbook.xlsx"
    );
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    void loadSavedWorkspaces();
    void (async () => {
      try {
        const [propertyRes, calculationRes, documentsRes] = await Promise.all([
          fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}`),
          fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/om-calculation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }),
          fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents`),
        ]);
        if (propertyRes.ok) {
          const propertyData = (await propertyRes.json().catch(() => null)) as PropertyResponse | null;
          if (propertyData?.details) {
            setWorkspaceDetails(propertyData.details as PropertyDetails);
            setResolvedAddress(resolveSavedWorkspaceAddress(propertyData));
          }
        }
        if (calculationRes.ok) {
          const calculationData = (await calculationRes.json().catch(() => null)) as OmCalculationSnapshot | null;
          if (calculationData?.property) {
            const refreshedDraft = normalizeWorkspaceDraft(draftFromCalculation(calculationData));
            setWorkspaceProperty((calculationData.property ?? null) as WorkspaceProperty | null);
            setCalculation(calculationData);
            setDraft(refreshedDraft);
            setBaselineDraft(refreshedDraft);
          }
        }
        if (documentsRes.ok) {
          const documentsData = (await documentsRes.json().catch(() => ({}))) as PropertyDocumentsResponse;
          setUploadedDocuments(summarizeUploadedPropertyDocuments(documentsData.documents));
        }
      } catch {
        // Generation already succeeded; keep the current workspace visible if refresh fails.
      }
    })();
    setNotice(
      [
        downloadKind === "pdf"
          ? "Saved deal dossier PDF generated and downloaded."
          : "Saved deal dossier Excel generated and downloaded.",
        data.dealScore != null ? `Deal score: ${data.dealScore}/100.` : null,
        "Homepage and property documents now reference the generated dossier package.",
      ]
        .filter(Boolean)
        .join(" ")
    );
    return true;
  }

  async function downloadDossier() {
    if (!workspaceDetails) return;
    setDossierDownloading(true);
    setError(null);
    try {
      if (propertyId && await generatePersistedDossier("pdf")) return;
      const res = await fetch(`${API_BASE}/api/deal-analysis/generate-dossier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          details: workspaceDetails,
          assumptions: buildAssumptionsPayload(draft),
          brokerEmailNotes: draft.brokerEmailNotes.trim() || null,
          unitModelRows: draft.unitModelRows ?? null,
          expenseModelRows: draft.expenseModelRows ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.details || data?.error || "Failed to generate deal dossier PDF.");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
      downloadBlob(blob, fileNameMatch?.[1] || "Deal-Dossier.pdf");
      setNotice("Deal dossier PDF generated from the current underwriting inputs.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate deal dossier PDF.");
    } finally {
      setDossierDownloading(false);
    }
  }

  async function downloadDossierExcel() {
    if (!workspaceDetails) return;
    setExcelDownloading(true);
    setError(null);
    try {
      if (propertyId && await generatePersistedDossier("excel")) return;
      const res = await fetch(`${API_BASE}/api/deal-analysis/generate-dossier-excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          details: workspaceDetails,
          assumptions: buildAssumptionsPayload(draft),
          brokerEmailNotes: draft.brokerEmailNotes.trim() || null,
          unitModelRows: draft.unitModelRows ?? null,
          expenseModelRows: draft.expenseModelRows ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.details || data?.error || "Failed to generate deal dossier Excel.");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
      downloadBlob(blob, fileNameMatch?.[1] || "Deal-Dossier-Workbook.xlsx");
      setNotice("Deal dossier Excel generated from the current underwriting inputs.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate deal dossier Excel.");
    } finally {
      setExcelDownloading(false);
    }
  }

  async function createPropertyRecord() {
    if (!workspaceDetails || workspaceFiles.length === 0) return;
    setPropertyCreating(true);
    setError(null);
    try {
      const formData = new FormData();
      for (const file of workspaceFiles) formData.append("files", file);
      formData.append("details", JSON.stringify(workspaceDetails));
      formData.append("assumptions", JSON.stringify(buildAssumptionsPayload(draft)));
      formData.append("brokerEmailNotes", draft.brokerEmailNotes.trim());
      formData.append("unitModelRows", JSON.stringify(draft.unitModelRows ?? []));
      formData.append("expenseModelRows", JSON.stringify(draft.expenseModelRows ?? []));
      const res = await fetch(`${API_BASE}/api/deal-analysis/create-property`, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as Partial<CreatePropertyResponse> & {
        error?: string;
        details?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.details || data.error || "Failed to create property record from OM.");
      }
      const result = data as CreatePropertyResponse;
      setCreateResult(result);
      void loadSavedWorkspaces();
      router.replace(`/deal-analysis?property_id=${encodeURIComponent(result.propertyId)}`);
      setNotice(
        result.createdProperty
          ? "Property record created from the OM address and sent through enrichment."
          : "Existing property matched from the OM address and updated with the uploaded OM."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create property record from OM.");
    } finally {
      setPropertyCreating(false);
    }
  }

  function updateDraftNumber(field: OmCalculationNumericField, value: number | null) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateDraftText(field: OmCalculationTextField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateUnitModelRows(rows: OmCalculationUnitModelRow[]) {
    setDraft((current) => ({ ...current, unitModelRows: rows }));
  }

  function updateExpenseModelRows(rows: OmCalculationExpenseModelRow[]) {
    setDraft((current) => ({ ...current, expenseModelRows: rows }));
  }

  return (
    <div style={pageShellStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          alignItems: "flex-end",
          padding: "0.35rem 0 0.15rem",
        }}
      >
        <div style={{ maxWidth: "760px" }}>
          <div
            style={{
              color: "var(--brand-strong)",
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: "var(--tracking-label)",
              textTransform: "uppercase",
            }}
          >
            Deal Progress
          </div>
          <h1
            style={{
              margin: "0.18rem 0 0",
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-3xl)",
              fontWeight: 700,
              lineHeight: 1.06,
              color: "var(--app-ink)",
            }}
          >
            OM Workspace Analysis
          </h1>
          <p style={{ margin: "0.45rem 0 0", color: "var(--app-ink-secondary)", lineHeight: 1.45, fontSize: "0.95rem" }}>
            Open saved property-backed OM workspaces, parse new OM PDFs, and keep underwriting edits in sync
            with dossier outputs.
          </p>
        </div>
        <button
          type="button"
          onClick={resetWorkspace}
          style={{
            ...secondaryButtonStyle,
            alignSelf: "center",
          }}
        >
          New OM workspace
        </button>
      </div>

      <div style={{ ...cardStyle, padding: "1.15rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <strong style={{ color: "var(--app-ink)", fontSize: "1rem" }}>OM workspace navigator</strong>
            <div style={{ marginTop: "0.3rem", color: "var(--app-muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
              One reusable workspace per property with OM-side uploads, authoritative OM data, or saved
              underwriting edits.
            </div>
          </div>
          {propertyId ? (
            <div style={{ color: "var(--brand-strong)", fontSize: "0.84rem", fontWeight: 800 }}>
              {savedWorkspaceLoading ? "Loading saved workspace..." : "Saved workspace loaded"}
            </div>
          ) : null}
        </div>

        <div
          style={{
            marginTop: "0.95rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem",
            alignItems: "end",
          }}
        >
          <label style={{ display: "grid", gap: "0.32rem", color: "var(--app-ink-secondary)", fontSize: "0.78rem", fontWeight: 800 }}>
            Open workspace
            <select
              value={propertyId ?? ""}
              onChange={(event) => {
                const nextPropertyId = event.target.value.trim();
                if (!nextPropertyId) {
                  resetWorkspace();
                  return;
                }
                router.replace(`/deal-analysis?property_id=${encodeURIComponent(nextPropertyId)}`);
              }}
              disabled={savedWorkspacesLoading || filteredSavedWorkspaces.length === 0}
              style={inputStyle}
            >
              <option value="">
                {savedWorkspacesLoading
                  ? "Loading OM workspaces..."
                  : filteredSavedWorkspaces.length === 0
                    ? "No matching OM workspaces"
                    : "Choose a property workspace"}
              </option>
              {filteredSavedWorkspaces.map((workspace) => (
                <option key={workspace.propertyId} value={workspace.propertyId}>
                  {workspace.canonicalAddress} - {formatDateLabel(getSavedWorkspaceUpdatedAt(workspace))}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.32rem", color: "var(--app-ink-secondary)", fontSize: "0.78rem", fontWeight: 800 }}>
            Search
            <input
              type="search"
              value={workspaceSearch}
              onChange={(event) => setWorkspaceSearch(event.target.value)}
              placeholder="Address or file name"
              style={inputStyle}
            />
          </label>

          <label style={{ display: "grid", gap: "0.32rem", color: "var(--app-ink-secondary)", fontSize: "0.78rem", fontWeight: 800 }}>
            Sort
            <select
              value={workspaceSort}
              onChange={(event) => setWorkspaceSort(event.target.value as WorkspaceSort)}
              style={inputStyle}
            >
              <option value="recent">Recently updated</option>
              <option value="address">Address A-Z</option>
              <option value="dossier">Dossier status</option>
            </select>
          </label>
        </div>

        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
            {[
              ["all", "All"],
              ["uploaded_docs", "Uploaded docs"],
              ["manual_edits", "Manual edits"],
              ["dossier_ready", "Dossier ready"],
              ["needs_dossier", "Needs dossier"],
            ].map(([value, label]) => {
              const isActive = workspaceFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWorkspaceFilter(value as WorkspaceFilter)}
                  style={{
                    padding: "0.35rem 0.62rem",
                    borderRadius: "999px",
                    border: isActive ? "1px solid var(--brand-border)" : "1px solid var(--app-line)",
                    background: isActive ? "var(--brand-soft)" : "var(--app-surface)",
                    color: isActive ? "var(--brand-strong)" : "var(--app-ink-secondary)",
                    fontSize: "0.8rem",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceResultsOpen((open) => !open)}
            style={{
              ...secondaryButtonStyle,
              minHeight: "2rem",
              padding: "0.38rem 0.7rem",
              fontSize: "0.82rem",
            }}
          >
            {workspaceResultsOpen ? "Hide matches" : `Show matches (${filteredSavedWorkspaces.length})`}
          </button>
        </div>

        {activeSavedWorkspace ? (
          <div
            style={{
              marginTop: "0.85rem",
              padding: "0.75rem 0.85rem",
              borderRadius: "8px",
              border: "1px solid var(--brand-border)",
              background: "var(--brand-soft)",
              display: "flex",
              justifyContent: "space-between",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ color: "var(--brand-strong)", fontWeight: 850 }}>{activeSavedWorkspace.canonicalAddress}</div>
              <div style={{ marginTop: "0.25rem", color: "var(--app-muted)", fontSize: "0.84rem" }}>
                Last workspace update {formatDateLabel(getSavedWorkspaceUpdatedAt(activeSavedWorkspace))}
                {activeSavedWorkspace.omFileName ? ` • ${activeSavedWorkspace.omFileName}` : ""}
              </div>
            </div>
            <div style={{ color: "var(--brand-strong)", fontSize: "0.82rem", fontWeight: 850 }}>Currently open</div>
          </div>
        ) : null}

        <div style={{ marginTop: "0.95rem", display: "grid", gap: "0.55rem" }}>
          {savedWorkspacesLoading ? (
            <div style={{ color: "#68736d", fontSize: "0.9rem" }}>Loading recent OM workspaces...</div>
          ) : savedWorkspaces.length > 0 && workspaceResultsOpen ? (
            filteredSavedWorkspaces.slice(0, 12).map((workspace) => {
              const isActive = workspace.propertyId === propertyId;
              const lastUpdatedAt = getSavedWorkspaceUpdatedAt(workspace);
              return (
                <button
                  key={workspace.propertyId}
                  type="button"
                  onClick={() =>
                    router.replace(`/deal-analysis?property_id=${encodeURIComponent(workspace.propertyId)}`)
                  }
                  disabled={savedWorkspaceLoading && isActive}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                    padding: "0.72rem 0.85rem",
                    borderRadius: "8px",
                    border: isActive ? "1px solid rgba(47, 111, 82, 0.48)" : "1px solid rgba(38, 47, 44, 0.12)",
                    background: isActive ? "#edf8f1" : "#fff",
                    textAlign: "left",
                    cursor: savedWorkspaceLoading && isActive ? "not-allowed" : "pointer",
                  }}
                >
                  <div style={{ minWidth: "260px", flex: "1 1 320px" }}>
                    <strong style={{ color: "#18231e" }}>{workspace.canonicalAddress}</strong>
                    <div style={{ color: "#68736d", fontSize: "0.84rem", lineHeight: 1.5 }}>
                      Last update {formatDateLabel(lastUpdatedAt)}
                      {workspace.omFileName ? ` • ${workspace.omFileName}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                    {workspace.uploadedOmAt ? (
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "999px",
                          background: "#edf8f1",
                          color: "#1c5d3f",
                          fontSize: "0.76rem",
                          fontWeight: 700,
                        }}
                      >
                        Uploaded docs
                      </span>
                    ) : null}
                    {workspace.hasAuthoritativeOm ? (
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "999px",
                          background: "#ecfdf5",
                          color: "#166534",
                          fontSize: "0.76rem",
                          fontWeight: 700,
                        }}
                      >
                        Authoritative OM
                      </span>
                    ) : null}
                    {workspace.unitModelRowCount > 0 ? (
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "999px",
                          background: "#f2f6f4",
                          color: "#40524a",
                          fontSize: "0.76rem",
                          fontWeight: 700,
                        }}
                      >
                        {workspace.unitModelRowCount} unit rows
                      </span>
                    ) : null}
                    {workspace.expenseModelRowCount > 0 ? (
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "999px",
                          background: "#f2f6f4",
                          color: "#40524a",
                          fontSize: "0.76rem",
                          fontWeight: 700,
                        }}
                      >
                        {workspace.expenseModelRowCount} expense rows
                      </span>
                    ) : null}
                    {workspace.hasBrokerEmailNotes ? (
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "999px",
                          background: "#fff7ed",
                          color: "#9a3412",
                          fontSize: "0.76rem",
                          fontWeight: 700,
                        }}
                      >
                        Broker notes saved
                      </span>
                    ) : null}
                    {workspace.dossierStatus === "completed" ? (
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "999px",
                          background: "#edf8f1",
                          color: "#1c5d3f",
                          fontSize: "0.76rem",
                          fontWeight: 700,
                        }}
                      >
                        Dossier ready
                      </span>
                    ) : null}
                    <span
                      style={{
                        color: isActive ? "#2f6f52" : "#47534d",
                        fontSize: "0.8rem",
                        fontWeight: 800,
                        alignSelf: "center",
                      }}
                    >
                      {isActive ? "Loaded" : "Open"}
                    </span>
                  </div>
                </button>
              );
            })
          ) : savedWorkspaces.length > 0 && filteredSavedWorkspaces.length === 0 ? (
            <div style={{ color: "#68736d", fontSize: "0.9rem", lineHeight: 1.55 }}>
              No OM workspaces match the current search and filters.
            </div>
          ) : (
            <div style={{ color: "#68736d", fontSize: "0.9rem", lineHeight: 1.55 }}>
              {savedWorkspaces.length === 0
                ? "No saved OM workspaces yet. Analyze uploaded OM PDFs or upload an OM to a property card to make that workspace reusable from this page."
                : "Use the dropdown, search, or filters above to open a saved OM workspace."}
            </div>
          )}
          {workspaceResultsOpen && filteredSavedWorkspaces.length > 12 ? (
            <div style={{ color: "#68736d", fontSize: "0.84rem" }}>
              Showing 12 of {filteredSavedWorkspaces.length} matching workspaces. Narrow the search to jump
              directly to a property.
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.9fr)",
          gap: "1rem",
        }}
      >
        <div style={{ ...cardStyle, padding: "1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <strong style={{ color: "#18231e", fontSize: "1rem" }}>1. Add OM PDFs or link</strong>
              <div style={{ marginTop: "0.3rem", color: "#68736d", fontSize: "0.9rem", lineHeight: 1.5 }}>
                Start from PDF uploads or a directly downloadable OM link, then pull prior builds back from
                the saved workspace list above.
              </div>
            </div>
            <button
              type="button"
              onClick={analyzeUploads}
              disabled={!canAnalyze || uploading || linkAnalyzing}
              style={{
                ...primaryButtonStyle,
                cursor: !canAnalyze || uploading || linkAnalyzing ? "not-allowed" : "pointer",
                border: canAnalyze ? primaryButtonStyle.border : "1px solid var(--app-line)",
                background: canAnalyze ? primaryButtonStyle.background : "var(--app-surface-strong)",
                color: canAnalyze ? "#ffffff" : "var(--app-muted)",
                opacity: uploading || linkAnalyzing ? 0.65 : 1,
              }}
            >
              {uploading ? "Analyzing uploaded PDFs..." : "Analyze uploaded OM PDFs"}
            </button>
          </div>

          <div
            style={{
              marginTop: "1rem",
              border: "1px dashed rgba(47, 111, 82, 0.34)",
              borderRadius: "8px",
              padding: "1rem",
              background: "#f7fbf8",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => {
                const selectedFiles = Array.from(event.target.files ?? []);
                setPendingFiles(selectedFiles);
                setNotice(
                  workspaceDetails != null
                    ? "New OM files selected. Analyze uploads to replace the current workspace."
                    : null
                );
                const oversized = selectedFiles.filter((file) => file.size > OM_IMPORT_MAX_BYTES);
                if (selectedFiles.length > OM_IMPORT_MAX_FILES) {
                  setError(`Upload up to ${OM_IMPORT_MAX_FILES} OM PDFs at a time.`);
                } else if (oversized.length > 0) {
                  setError(`Each OM PDF must be ${formatBytes(OM_IMPORT_MAX_BYTES)} or smaller.`);
                } else {
                  setError(null);
                }
              }}
              style={{ display: "block", width: "100%" }}
            />
            <div style={{ marginTop: "0.7rem", color: "#68736d", fontSize: "0.84rem", lineHeight: 1.5 }}>
              Upload OM PDFs, rent roll PDFs, or other OM-side PDF supplements. The analysis will combine
              them into one underwriting workspace. Max {formatBytes(OM_IMPORT_MAX_BYTES)} per PDF.
            </div>
            <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.55rem" }}>
              {(pendingFiles.length > 0 ? pendingFiles : []).map((file) => (
                <div
                  key={`${file.name}-${file.size}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    padding: "0.55rem 0.7rem",
                    borderRadius: "6px",
                    background: "#fff",
                    border: file.size > OM_IMPORT_MAX_BYTES ? "1px solid #fca5a5" : "1px solid rgba(38, 47, 44, 0.12)",
                    fontSize: "0.86rem",
                  }}
                >
                  <span style={{ color: "#18231e", fontWeight: 700 }}>{file.name}</span>
                  <span style={{ color: file.size > OM_IMPORT_MAX_BYTES ? "#b91c1c" : "#68736d" }}>
                    {formatBytes(file.size)}
                  </span>
                </div>
              ))}
              {pendingFiles.length === 0 ? (
                <div style={{ color: "#68736d", fontSize: "0.86rem" }}>
                  No files selected yet.
                </div>
              ) : null}
            </div>
            {pendingSelectionReplacesWorkspace ? (
              <div style={{ marginTop: "0.7rem", color: "#92400e", fontSize: "0.82rem" }}>
                These pending files are not in the active workspace yet. Run analysis again to replace the
                current OM workspace.
              </div>
            ) : null}
          </div>
          <div
            style={{
              marginTop: "1rem",
              border: "1px solid rgba(38, 47, 44, 0.12)",
              borderRadius: "8px",
              padding: "1rem",
              background: "#ffffff",
              display: "grid",
              gap: "0.7rem",
            }}
          >
            <label style={{ display: "grid", gap: "0.35rem", color: "#303832", fontSize: "0.8rem", fontWeight: 800 }}>
              OM PDF link
              <input
                value={omUrl}
                onChange={(event) => {
                  setOmUrl(event.target.value);
                  setError(null);
                }}
                placeholder="https://.../offering-memorandum.pdf"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ color: "#68736d", fontSize: "0.84rem", lineHeight: 1.5 }}>
                Link imports use the same OM analysis prompt and save back to the matched property workspace.
              </div>
              <button
                type="button"
                onClick={analyzeOmLink}
                disabled={!canAnalyzeLink || uploading || linkAnalyzing}
                style={{
                  ...secondaryButtonStyle,
                  background: canAnalyzeLink ? "#fff" : "#f2f6f4",
                  cursor: !canAnalyzeLink || uploading || linkAnalyzing ? "not-allowed" : "pointer",
                  opacity: !canAnalyzeLink ? 0.65 : 1,
                }}
              >
                {linkAnalyzing ? "Analyzing OM link..." : "Analyze OM link"}
              </button>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, padding: "1.2rem" }}>
          <strong style={{ color: "#18231e", fontSize: "1rem" }}>2. Analysis workspace</strong>
          <div style={{ marginTop: "0.3rem", color: "#68736d", fontSize: "0.9rem", lineHeight: 1.55 }}>
            Once the OM is parsed, this page will populate current state, unit-level rows, sensitivities,
            assumptions, and the deal dossier PDF.
          </div>

          <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.7rem" }}>
            <div
              style={{
                padding: "0.8rem 0.9rem",
                borderRadius: "8px",
                background: "#f7fbf8",
                border: "1px solid rgba(38, 47, 44, 0.12)",
              }}
            >
              <div style={{ fontSize: "0.72rem", color: "#65736b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 850 }}>
                Extracted address
              </div>
              <div style={{ marginTop: "0.2rem", fontWeight: 800, color: "#18231e" }}>
                {resolvedAddress?.canonicalAddress ?? workspaceProperty?.canonicalAddress ?? "Waiting on OM analysis"}
              </div>
            </div>

            <div
              style={{
                padding: "0.8rem 0.9rem",
                borderRadius: "8px",
                background: "#f7fbf8",
                border: "1px solid rgba(38, 47, 44, 0.12)",
              }}
            >
              <div style={{ fontSize: "0.72rem", color: "#65736b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 850 }}>
                Canonical property match
              </div>
              <div style={{ marginTop: "0.2rem", color: "#18231e", lineHeight: 1.5 }}>
                {matchedProperty ? (
                  <>
                    <strong>{matchedProperty.canonicalAddress}</strong>
                    <div style={{ fontSize: "0.84rem", color: "#68736d" }}>
                      Match strategy: {matchedProperty.matchStrategy === "exact_canonical" ? "Exact canonical" : "Address line"}
                    </div>
                  </>
                ) : (
                  "No match preview yet."
                )}
              </div>
            </div>

            <div
              style={{
                padding: "0.8rem 0.9rem",
                borderRadius: "8px",
                background: "#f7fbf8",
                border: "1px solid rgba(38, 47, 44, 0.12)",
              }}
            >
              <div style={{ fontSize: "0.72rem", color: "#65736b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 850 }}>
                Current outputs
              </div>
              <div style={{ marginTop: "0.45rem", display: "grid", gap: "0.35rem" }}>
                {summaryCards.length > 0 ? (
                  summaryCards.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.8rem",
                        fontSize: "0.86rem",
                      }}
                    >
                      <span style={{ color: "#68736d" }}>{row.label}</span>
                      <strong style={{ color: "#18231e" }}>{row.value}</strong>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#68736d", fontSize: "0.86rem" }}>
                    {savedWorkspaceLoading
                      ? "Loading the saved OM workspace metrics..."
                      : "Analyze the uploaded OM PDFs or reopen a saved workspace to populate returns and current-state metrics."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {notice ? (
        <div
          style={{
            padding: "0.9rem 1rem",
            borderRadius: "8px",
            border: "1px solid rgba(47, 111, 82, 0.22)",
            background: "#edf8f1",
            color: "#1c5d3f",
            fontWeight: 700,
          }}
        >
          {notice}
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            padding: "0.9rem 1rem",
            borderRadius: "14px",
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      ) : null}

      {workspaceDetails ? (
        <>
          {propertyId ? (
            <div
              style={{
                ...cardStyle,
                padding: "1rem 1.1rem",
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
                alignItems: "center",
                background: "linear-gradient(180deg, #f7fbf8 0%, #ffffff 100%)",
              }}
            >
              <div>
                <strong style={{ color: "#18231e", fontSize: "0.98rem" }}>
                  Property-backed OM workspace
                </strong>
                <div style={{ marginTop: "0.28rem", color: "#68736d", fontSize: "0.88rem", lineHeight: 1.55 }}>
                  Reopened from the saved property record
                  {savedWorkspaceUpdatedAt ? ` • last saved ${formatDateLabel(savedWorkspaceUpdatedAt)}` : ""}.
                </div>
                <div style={{ marginTop: "0.3rem" }}>
                  <Link
                    href={`/property-data?property_id=${encodeURIComponent(propertyId)}`}
                    style={{ color: "#173f36", fontWeight: 800, textDecoration: "none", fontSize: "0.86rem" }}
                  >
                    Open property record
                  </Link>
                </div>
              </div>
              <button
                type="button"
                onClick={saveWorkspaceToProperty}
                disabled={workspaceSaving || !isDirty}
                style={{
                  ...secondaryButtonStyle,
                  background: workspaceSaving ? "#edf8f1" : "#fff",
                  cursor: workspaceSaving || !isDirty ? "not-allowed" : "pointer",
                }}
              >
                {workspaceSaving ? "Saving workspace..." : "Save workspace to property"}
              </button>
            </div>
          ) : null}

          <OmCalculationPanel
            mode="standalone"
            draft={draft}
            calculation={calculation}
            loading={uploading && !calculation}
            running={recalculating}
            saving={workspaceSaving}
            error={null}
            isDirty={isDirty}
            hasAuthoritativeOm={hasAuthoritativeOm}
            hasBrokerEmailNotes={
              draft.brokerEmailNotes.trim().length > 0 || baselineDraft.brokerEmailNotes.trim().length > 0
            }
            formulaFurnishingSetupCosts={formulaFurnishingDefault}
            onDraftNumberChange={updateDraftNumber}
            onDraftTextChange={updateDraftText}
            onUnitModelRowsChange={updateUnitModelRows}
            onExpenseModelRowsChange={updateExpenseModelRows}
            onRunCalculation={recalculateAnalysis}
            onSave={() => {}}
            onResetToSaved={() => setDraft(baselineDraft)}
            onApplyFormulaDefault={() =>
              setDraft((current) => ({
                ...current,
                furnishingSetupCosts: formulaFurnishingDefault,
              }))
            }
            onClearSaved={() => {}}
          />

          <div
            style={{
              ...cardStyle,
              padding: "1.15rem",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)",
              gap: "1rem",
            }}
          >
            <div>
              <strong style={{ color: "#18231e", fontSize: "1rem" }}>3. Generate outputs</strong>
              <div style={{ marginTop: "0.35rem", color: "#68736d", lineHeight: 1.55, fontSize: "0.9rem" }}>
                Generate the deal dossier PDF or Excel workbook from this OM workspace.
                {propertyId
                  ? " Because this workspace is tied to a canonical property, generation will save the dossier, refresh deal scoring, and make the deal visible from the property record."
                  : " You can also create or match a canonical property record from the extracted address and send it through BBL resolution and enrichment."}
              </div>
              <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.45rem", fontSize: "0.86rem" }}>
                <div style={{ color: "#18231e" }}>
                  Uploaded OM docs: <strong>{uploadedDocuments.length || workspaceFiles.length}</strong>
                </div>
                <div style={{ color: "#18231e" }}>
                  Workspace address: <strong>{resolvedAddress?.canonicalAddress ?? workspaceProperty?.canonicalAddress ?? "—"}</strong>
                </div>
                <div style={{ color: "#68736d" }}>
                  {isDirty
                    ? "The PDF and property-create step will use your current edits. Refresh analysis if you also want the on-screen metrics updated first."
                    : "The on-screen metrics are in sync with the latest underwriting inputs."}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: "0.75rem", alignContent: "start" }}>
              <button
                type="button"
                onClick={downloadDossier}
                disabled={!canGenerateDossier || dossierDownloading}
                style={{
                  ...primaryButtonStyle,
                  cursor: !canGenerateDossier || dossierDownloading ? "not-allowed" : "pointer",
                }}
              >
                {dossierDownloading
                  ? propertyId
                    ? "Generating saved deal dossier PDF..."
                    : "Generating deal dossier PDF..."
                  : propertyId
                    ? "Generate saved deal dossier PDF"
                    : "Download deal dossier PDF"}
              </button>

              <button
                type="button"
                onClick={downloadDossierExcel}
                disabled={!canGenerateDossier || excelDownloading}
                style={{
                  ...secondaryButtonStyle,
                  background: "#edf8f1",
                  cursor: !canGenerateDossier || excelDownloading ? "not-allowed" : "pointer",
                }}
              >
                {excelDownloading
                  ? propertyId
                    ? "Generating saved deal dossier Excel..."
                    : "Generating deal dossier Excel..."
                  : propertyId
                    ? "Generate saved deal dossier Excel"
                    : "Download deal dossier Excel"}
              </button>

              <button
                type="button"
                onClick={createPropertyRecord}
                disabled={!canGenerateDossier || propertyCreating || workspaceFiles.length === 0 || propertyId != null}
                style={{
                  ...secondaryButtonStyle,
                  cursor:
                    !canGenerateDossier ||
                    propertyCreating ||
                    workspaceFiles.length === 0 ||
                    propertyId != null
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {propertyId
                  ? "Property record already attached"
                  : propertyCreating
                    ? "Creating / matching property..."
                    : "Create property record from OM"}
              </button>

              {createResult ? (
                <div
                  style={{
                    padding: "0.85rem 0.95rem",
                    borderRadius: "8px",
                    border: "1px solid rgba(38, 47, 44, 0.12)",
                    background: "#f7fbf8",
                    fontSize: "0.86rem",
                    lineHeight: 1.55,
                  }}
                >
                  <div style={{ color: "#18231e", fontWeight: 800 }}>{createResult.canonicalAddress}</div>
                  <div style={{ marginTop: "0.22rem", color: "#68736d" }}>
                    {createResult.createdProperty ? "New property created" : "Existing property matched"} via{" "}
                    {createResult.matchStrategy}.
                  </div>
                  {createResult.enrichment?.bbl ? (
                    <div style={{ marginTop: "0.22rem", color: "#68736d" }}>
                      BBL: {createResult.enrichment.bbl}
                    </div>
                  ) : null}
                  <div style={{ marginTop: "0.45rem" }}>
                    <Link
                      href={`/property-data?property_id=${encodeURIComponent(createResult.propertyId)}`}
                      style={{ color: "#173f36", fontWeight: 800, textDecoration: "none" }}
                    >
                      Open property record
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {!workspaceDetails ? (
        <div
          style={{
            ...cardStyle,
            padding: "1.1rem",
            color: "#68736d",
            lineHeight: 1.6,
            fontSize: "0.92rem",
          }}
        >
          {savedWorkspaceLoading
            ? "Loading the saved OM workspace..."
            : "Analyze uploaded OM PDFs or reopen a saved OM workspace to populate current state, unit-by-unit rent uplift and occupancy assumptions, recurring opex, upfront furnishing and onboarding costs, sensitivities, and the deal dossier output."}
        </div>
      ) : null}
    </div>
  );
}

export default function DealAnalysisPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading deal analysis...</div>}>
      <DealAnalysisPageContent />
    </Suspense>
  );
}
