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

type WorkspaceProperty = OmCalculationSnapshot["property"];

interface UploadedDocumentSummary {
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
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
  matchStrategy: "exact_canonical" | "address_line";
}

interface AnalyzeUploadResponse {
  ok: boolean;
  property: WorkspaceProperty;
  resolvedAddress: ResolvedOmAddress | null;
  matchedProperty: MatchedPropertyPreview | null;
  uploadedDocuments: UploadedDocumentSummary[];
  details: PropertyDetails;
  calculation: OmCalculationSnapshot;
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

interface SavedWorkspaceSummary {
  propertyId: string;
  canonicalAddress: string;
  updatedAt: string;
  omImportedAt: string | null;
  assumptionsUpdatedAt: string | null;
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

const pageShellStyle: React.CSSProperties = {
  maxWidth: "1360px",
  margin: "0 auto",
  padding: "1.5rem",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #dbe2ea",
  borderRadius: "18px",
  background: "#ffffff",
  boxShadow: "0 14px 34px rgba(15, 23, 42, 0.06)",
};

function emptyDraft(): OmCalculationDraft {
  return {
    purchasePrice: null,
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

function DealAnalysisPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("property_id")?.trim() || null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
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
  const [recalculating, setRecalculating] = useState(false);
  const [dossierDownloading, setDossierDownloading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [savedWorkspaceLoading, setSavedWorkspaceLoading] = useState(false);
  const [savedWorkspacesLoading, setSavedWorkspacesLoading] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspaceSummary[]>([]);
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
  const isDirty = numericFieldsDirty || unitRowsDirty || expenseRowsDirty || metadataDirty;
  const hasAuthoritativeOm = workspaceDetails?.omData?.authoritative != null;
  const canAnalyze = pendingFiles.length > 0;
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
    activeSavedWorkspace?.omImportedAt ??
    workspaceDetails?.dealDossier?.assumptions?.updatedAt ??
    null;

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
      const res = await fetch(`${API_BASE}/api/deal-analysis/workspaces?limit=8`);
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
  }

  async function analyzeUploads() {
    if (pendingFiles.length === 0) return;
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
      const nextCalculation = data.calculation as OmCalculationSnapshot;
      const nextDraft = draftFromCalculation(nextCalculation);
      setWorkspaceFiles(pendingFiles);
      setUploadedDocuments(data.uploadedDocuments ?? []);
      setWorkspaceDetails((data.details ?? null) as PropertyDetails | null);
      setWorkspaceProperty((data.property ?? null) as WorkspaceProperty | null);
      setResolvedAddress((data.resolvedAddress ?? null) as ResolvedOmAddress | null);
      setMatchedProperty((data.matchedProperty ?? null) as MatchedPropertyPreview | null);
      setCalculation(nextCalculation);
      setDraft(nextDraft);
      setBaselineDraft(nextDraft);
      if (propertyId) router.replace("/deal-analysis");
      setNotice("Uploaded OM PDF(s) analyzed. Adjust assumptions and refresh analysis as needed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze uploaded OM PDF(s).");
    } finally {
      setUploading(false);
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
      const nextDraft = draftFromCalculation(nextCalculation);
      setWorkspaceProperty((data.property ?? null) as WorkspaceProperty | null);
      setCalculation(nextCalculation);
      setDraft(nextDraft);
      setBaselineDraft(nextDraft);
      setNotice("Analysis refreshed with the latest underwriting edits.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh OM analysis.");
    } finally {
      setRecalculating(false);
    }
  }

  async function saveWorkspaceToProperty() {
    if (!propertyId) return;
    setWorkspaceSaving(true);
    setError(null);
    try {
      const nextDraft: OmCalculationDraft = {
        ...draft,
        brokerEmailNotes: draft.brokerEmailNotes.trim(),
      };
      const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/dossier-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildAssumptionsPayload(nextDraft),
          brokerEmailNotes: nextDraft.brokerEmailNotes,
          unitModelRows: nextDraft.unitModelRows ?? [],
          expenseModelRows: nextDraft.expenseModelRows ?? [],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.details || data.error || "Failed to save the OM workspace.");
      }
      setDraft(nextDraft);
      setBaselineDraft(nextDraft);
      setNotice("Saved the OM workspace back to the property record.");
      void loadSavedWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the OM workspace.");
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function downloadDossier() {
    if (!workspaceDetails) return;
    setDossierDownloading(true);
    setError(null);
    try {
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
          ...cardStyle,
          padding: "1.35rem",
          background:
            "radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 34%), linear-gradient(180deg, #f8fcff 0%, #ffffff 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <div style={{ maxWidth: "820px" }}>
            <h1 style={{ margin: 0, fontSize: "1.55rem", color: "#0f172a" }}>
              Deal analysis from uploaded OM PDFs
            </h1>
            <p style={{ margin: "0.55rem 0 0", color: "#475569", lineHeight: 1.65, fontSize: "0.98rem" }}>
              Upload one or more OM PDFs for a fresh underwriting workspace, or reopen a prior
              property-backed OM workspace with its saved assumptions, unit edits, and expense rows.
            </p>
          </div>
          <button
            type="button"
            onClick={resetWorkspace}
            style={{
              padding: "0.65rem 0.95rem",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              cursor: "pointer",
            }}
          >
            Start new OM workspace
          </button>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: "1.15rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <strong style={{ color: "#0f172a", fontSize: "1rem" }}>Resume prior OM workspace builds</strong>
            <div style={{ marginTop: "0.3rem", color: "#64748b", fontSize: "0.9rem", lineHeight: 1.55 }}>
              Prior deal-analysis builds tied to a property record can be reopened here with their saved
              assumptions and model rows.
            </div>
          </div>
          {propertyId ? (
            <div style={{ color: "#1d4ed8", fontSize: "0.84rem", fontWeight: 700 }}>
              {savedWorkspaceLoading ? "Loading saved workspace..." : "Saved workspace loaded"}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: "0.95rem", display: "grid", gap: "0.75rem" }}>
          {savedWorkspacesLoading ? (
            <div style={{ color: "#64748b", fontSize: "0.9rem" }}>Loading recent OM workspaces...</div>
          ) : savedWorkspaces.length > 0 ? (
            savedWorkspaces.map((workspace) => {
              const isActive = workspace.propertyId === propertyId;
              const lastUpdatedAt =
                workspace.assumptionsUpdatedAt ?? workspace.omImportedAt ?? workspace.updatedAt;
              return (
                <button
                  key={workspace.propertyId}
                  type="button"
                  onClick={() =>
                    router.replace(`/deal-analysis?property_id=${encodeURIComponent(workspace.propertyId)}`)
                  }
                  disabled={savedWorkspaceLoading && isActive}
                  style={{
                    display: "grid",
                    gap: "0.38rem",
                    padding: "0.95rem 1rem",
                    borderRadius: "14px",
                    border: isActive ? "1px solid #93c5fd" : "1px solid #dbe2ea",
                    background: isActive ? "#eff6ff" : "#fff",
                    textAlign: "left",
                    cursor: savedWorkspaceLoading && isActive ? "not-allowed" : "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.8rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <strong style={{ color: "#0f172a" }}>{workspace.canonicalAddress}</strong>
                    <span
                      style={{
                        color: isActive ? "#1d4ed8" : "#475569",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                      }}
                    >
                      {isActive ? "Loaded" : "Open workspace"}
                    </span>
                  </div>
                  <div style={{ color: "#64748b", fontSize: "0.84rem", lineHeight: 1.5 }}>
                    Last saved {formatDateLabel(lastUpdatedAt)}
                    {workspace.omFileName ? ` • ${workspace.omFileName}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
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
                          background: "#f8fafc",
                          color: "#334155",
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
                          background: "#f8fafc",
                          color: "#334155",
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
                          background: "#eef2ff",
                          color: "#4338ca",
                          fontSize: "0.76rem",
                          fontWeight: 700,
                        }}
                      >
                        Dossier ready
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })
          ) : (
            <div style={{ color: "#64748b", fontSize: "0.9rem", lineHeight: 1.55 }}>
              No saved OM workspaces yet. Analyze uploaded OM PDFs and create the property record once to
              make that workspace reusable from this page.
            </div>
          )}
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
              <strong style={{ color: "#0f172a", fontSize: "1rem" }}>1. Upload OM PDFs</strong>
              <div style={{ marginTop: "0.3rem", color: "#64748b", fontSize: "0.9rem", lineHeight: 1.5 }}>
                Start from new uploads here, or use the saved workspace list above to pull a prior OM build
                back into the page.
              </div>
            </div>
            <button
              type="button"
              onClick={analyzeUploads}
              disabled={!canAnalyze || uploading}
              style={{
                padding: "0.7rem 1rem",
                borderRadius: "10px",
                border: "none",
                background: "#0f62fe",
                color: "#fff",
                fontWeight: 700,
                cursor: !canAnalyze || uploading ? "not-allowed" : "pointer",
                opacity: !canAnalyze ? 0.65 : 1,
              }}
            >
              {uploading ? "Analyzing uploaded PDFs..." : "Analyze uploaded OM PDFs"}
            </button>
          </div>

          <div
            style={{
              marginTop: "1rem",
              border: "1px dashed #93c5fd",
              borderRadius: "16px",
              padding: "1rem",
              background: "#f8fbff",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => {
                setPendingFiles(Array.from(event.target.files ?? []));
                setNotice(
                  workspaceDetails != null
                    ? "New OM files selected. Analyze uploads to replace the current workspace."
                    : null
                );
                setError(null);
              }}
              style={{ display: "block", width: "100%" }}
            />
            <div style={{ marginTop: "0.7rem", color: "#64748b", fontSize: "0.84rem", lineHeight: 1.5 }}>
              Upload OM PDFs, rent roll PDFs, or other OM-side PDF supplements. The analysis will combine
              them into one underwriting workspace.
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
                    borderRadius: "10px",
                    background: "#fff",
                    border: "1px solid #dbe2ea",
                    fontSize: "0.86rem",
                  }}
                >
                  <span style={{ color: "#0f172a", fontWeight: 600 }}>{file.name}</span>
                  <span style={{ color: "#64748b" }}>{formatBytes(file.size)}</span>
                </div>
              ))}
              {pendingFiles.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: "0.86rem" }}>
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
        </div>

        <div style={{ ...cardStyle, padding: "1.2rem" }}>
          <strong style={{ color: "#0f172a", fontSize: "1rem" }}>2. Analysis workspace</strong>
          <div style={{ marginTop: "0.3rem", color: "#64748b", fontSize: "0.9rem", lineHeight: 1.55 }}>
            Once the OM is parsed, this page will populate current state, unit-level rows, sensitivities,
            assumptions, and the deal dossier PDF.
          </div>

          <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.7rem" }}>
            <div
              style={{
                padding: "0.8rem 0.9rem",
                borderRadius: "12px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Extracted address
              </div>
              <div style={{ marginTop: "0.2rem", fontWeight: 700, color: "#0f172a" }}>
                {resolvedAddress?.canonicalAddress ?? workspaceProperty?.canonicalAddress ?? "Waiting on OM analysis"}
              </div>
            </div>

            <div
              style={{
                padding: "0.8rem 0.9rem",
                borderRadius: "12px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Canonical property match
              </div>
              <div style={{ marginTop: "0.2rem", color: "#0f172a", lineHeight: 1.5 }}>
                {matchedProperty ? (
                  <>
                    <strong>{matchedProperty.canonicalAddress}</strong>
                    <div style={{ fontSize: "0.84rem", color: "#64748b" }}>
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
                borderRadius: "12px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
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
                      <span style={{ color: "#64748b" }}>{row.label}</span>
                      <strong style={{ color: "#0f172a" }}>{row.value}</strong>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#64748b", fontSize: "0.86rem" }}>
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
            borderRadius: "14px",
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            color: "#1d4ed8",
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
                background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
              }}
            >
              <div>
                <strong style={{ color: "#0f172a", fontSize: "0.98rem" }}>
                  Property-backed OM workspace
                </strong>
                <div style={{ marginTop: "0.28rem", color: "#64748b", fontSize: "0.88rem", lineHeight: 1.55 }}>
                  Reopened from the saved property record
                  {savedWorkspaceUpdatedAt ? ` • last saved ${formatDateLabel(savedWorkspaceUpdatedAt)}` : ""}.
                </div>
                <div style={{ marginTop: "0.3rem" }}>
                  <Link
                    href={`/property-data?property_id=${encodeURIComponent(propertyId)}`}
                    style={{ color: "#0f62fe", fontWeight: 700, textDecoration: "none", fontSize: "0.86rem" }}
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
                  padding: "0.72rem 1rem",
                  borderRadius: "12px",
                  border: "1px solid #bfdbfe",
                  background: workspaceSaving ? "#eff6ff" : "#fff",
                  color: "#0f172a",
                  fontWeight: 700,
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
              <strong style={{ color: "#0f172a", fontSize: "1rem" }}>3. Generate outputs</strong>
              <div style={{ marginTop: "0.35rem", color: "#64748b", lineHeight: 1.6, fontSize: "0.9rem" }}>
                Generate the deal dossier PDF or Excel workbook from this OM workspace.
                {propertyId
                  ? " This reopened workspace is already tied to a canonical property record."
                  : " You can also create or match a canonical property record from the extracted address and send it through BBL resolution and enrichment."}
              </div>
              <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.45rem", fontSize: "0.86rem" }}>
                <div style={{ color: "#0f172a" }}>
                  Uploaded OM docs: <strong>{uploadedDocuments.length || workspaceFiles.length}</strong>
                </div>
                <div style={{ color: "#0f172a" }}>
                  Workspace address: <strong>{resolvedAddress?.canonicalAddress ?? workspaceProperty?.canonicalAddress ?? "—"}</strong>
                </div>
                <div style={{ color: "#64748b" }}>
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
                  padding: "0.85rem 1rem",
                  borderRadius: "12px",
                  border: "none",
                  background: "#0f62fe",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: !canGenerateDossier || dossierDownloading ? "not-allowed" : "pointer",
                }}
              >
                {dossierDownloading ? "Generating deal dossier PDF..." : "Download deal dossier PDF"}
              </button>

              <button
                type="button"
                onClick={downloadDossierExcel}
                disabled={!canGenerateDossier || excelDownloading}
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "12px",
                  border: "1px solid #8ec5ff",
                  background: "#eff6ff",
                  color: "#0f172a",
                  fontWeight: 700,
                  cursor: !canGenerateDossier || excelDownloading ? "not-allowed" : "pointer",
                }}
              >
                {excelDownloading ? "Generating deal dossier Excel..." : "Download deal dossier Excel"}
              </button>

              <button
                type="button"
                onClick={createPropertyRecord}
                disabled={!canGenerateDossier || propertyCreating || workspaceFiles.length === 0 || propertyId != null}
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "12px",
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#0f172a",
                  fontWeight: 700,
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
                    borderRadius: "12px",
                    border: "1px solid #dbe2ea",
                    background: "#f8fafc",
                    fontSize: "0.86rem",
                    lineHeight: 1.55,
                  }}
                >
                  <div style={{ color: "#0f172a", fontWeight: 700 }}>{createResult.canonicalAddress}</div>
                  <div style={{ marginTop: "0.22rem", color: "#64748b" }}>
                    {createResult.createdProperty ? "New property created" : "Existing property matched"} via{" "}
                    {createResult.matchStrategy}.
                  </div>
                  {createResult.enrichment?.bbl ? (
                    <div style={{ marginTop: "0.22rem", color: "#64748b" }}>
                      BBL: {createResult.enrichment.bbl}
                    </div>
                  ) : null}
                  <div style={{ marginTop: "0.45rem" }}>
                    <Link
                      href={`/property-data?property_id=${encodeURIComponent(createResult.propertyId)}`}
                      style={{ color: "#0f62fe", fontWeight: 700, textDecoration: "none" }}
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
            color: "#64748b",
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
