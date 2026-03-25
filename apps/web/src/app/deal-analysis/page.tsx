"use client";

import type {
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierUnitModelRow,
} from "@re-sourcing/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalProperty } from "../property-data/CanonicalPropertyDetail";
import {
  DOSSIER_GENERATION_STEPS,
  estimateGenerationProgress,
  getPropertyDossierAssumptions,
  getPropertyDossierGeneration,
} from "../property-data/dossierState";
import {
  OM_CALC_NUMERIC_FIELDS,
  OmCalculationPanel,
  type OmCalculationDraft,
  type OmCalculationExpenseModelRow,
  type OmCalculationNumericField,
  type OmCalculationSnapshot,
  type OmCalculationUnitModelRow,
} from "../property-data/OmCalculationPanel";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const pageShellStyle: React.CSSProperties = {
  maxWidth: "1320px",
  margin: "0 auto",
  padding: "1.5rem",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

interface ListingRow {
  price?: number | null;
  listedAt?: string | null;
  city?: string | null;
  url?: string | null;
}

interface PropertyDocument {
  id: string;
  fileName: string;
  fileType?: string | null;
  source?: string | null;
  sourceType?: string | null;
  createdAt?: string | null;
}

interface DossierAssumptionsResponse {
  defaults?: {
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
    annualOtherIncomeGrowthPct?: number | null;
    annualExpenseGrowthPct?: number | null;
    annualPropertyTaxGrowthPct?: number | null;
    recurringCapexAnnual?: number | null;
    holdPeriodYears?: number | null;
    exitCapPct?: number | null;
    exitClosingCostPct?: number | null;
    targetIrrPct?: number | null;
    unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
    expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
    brokerEmailNotes?: string | null;
    updatedAt?: string | null;
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

interface ManualAddResponse {
  ok: boolean;
  propertyId: string;
  listingId: string | null;
  canonicalAddress: string;
  createdProperty: boolean;
  createdListing: boolean;
  matchStrategy?: "exact_canonical" | "address_line" | "new";
  omImport?: {
    requested?: boolean;
    imported?: boolean;
    fileName?: string | null;
    warning?: string | null;
  } | null;
}

const COMMERCIAL_ROW_PATTERN =
  /\b(commercial|retail|office|storefront|store front|restaurant|cafe|gallery|medical|community facility)\b/i;
const RENT_STABILIZED_ROW_PATTERN = /(rent[\s-]*(?:stabilized|stabilised|controlled?)|\bRS\b)/i;
const VACANT_LIKE_ROW_PATTERN = /\b(vacant|available|delivered vacant|owner[\s-]*occupied|owner occupied)\b/i;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toFiniteNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function roundCurrencyAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function isManagementLineItem(lineItem: string): boolean {
  return /\b(management|mgmt)\b/i.test(lineItem);
}

function normalizeUnitModelRows(
  rows: Array<PropertyDealDossierUnitModelRow | OmCalculationUnitModelRow> | null | undefined
): OmCalculationUnitModelRow[] | undefined {
  if (!Array.isArray(rows)) return undefined;

  const normalized = rows.flatMap((row, index) => {
    const rowId = trimmedOrNull(row.rowId);
    if (!rowId) return [];

    const unitLabel = trimmedOrNull(row.unitLabel) ?? `Unit ${index + 1}`;
    const building = trimmedOrNull(row.building);
    const unitCategory = trimmedOrNull(row.unitCategory);
    const tenantName = trimmedOrNull(row.tenantName);
    const tenantStatus = trimmedOrNull(row.tenantStatus);
    const notes = trimmedOrNull(row.notes);
    const descriptor = [unitLabel, unitCategory, tenantStatus, notes].filter(Boolean).join(" ");
    const isCommercial =
      "isCommercial" in row && typeof row.isCommercial === "boolean"
        ? row.isCommercial
        : COMMERCIAL_ROW_PATTERN.test(descriptor);
    const isRentStabilized =
      "isRentStabilized" in row && typeof row.isRentStabilized === "boolean"
        ? row.isRentStabilized
        : RENT_STABILIZED_ROW_PATTERN.test(descriptor);
    const isVacantLike =
      "isVacantLike" in row && typeof row.isVacantLike === "boolean"
        ? row.isVacantLike
        : VACANT_LIKE_ROW_PATTERN.test(descriptor);
    const isProtected = row.isProtected ?? (isCommercial || isRentStabilized);
    const currentAnnualRent = toFiniteNumber(row.currentAnnualRent);
    const underwrittenAnnualRent =
      toFiniteNumber(row.underwrittenAnnualRent) ?? currentAnnualRent;
    const rentUpliftPct = toFiniteNumber(row.rentUpliftPct) ?? (isProtected ? 0 : null);
    const occupancyPct = toFiniteNumber(row.occupancyPct);
    const furnishingCost = toFiniteNumber(row.furnishingCost);
    const onboardingFee = toFiniteNumber(row.onboardingFee);
    const monthlyHospitalityExpense = toFiniteNumber(row.monthlyHospitalityExpense);
    const includeInUnderwriting = row.includeInUnderwriting ?? true;
    const defaultProjectedAnnualRent =
      "defaultProjectedAnnualRent" in row && isFiniteNumber(row.defaultProjectedAnnualRent)
        ? row.defaultProjectedAnnualRent
        : underwrittenAnnualRent ?? currentAnnualRent;
    const modeledAnnualRent =
      includeInUnderwriting && underwrittenAnnualRent != null
        ? roundCurrencyAmount(
            underwrittenAnnualRent *
              (1 + Math.max(0, rentUpliftPct ?? 0) / 100) *
              (Math.max(0, occupancyPct ?? 100) / 100)
          )
        : null;

    return [
      {
        rowId,
        unitLabel,
        building,
        unitCategory,
        tenantName,
        currentAnnualRent,
        underwrittenAnnualRent,
        rentUpliftPct,
        occupancyPct,
        furnishingCost,
        onboardingFee,
        monthlyHospitalityExpense,
        includeInUnderwriting,
        isProtected,
        beds: toFiniteNumber(row.beds),
        baths: toFiniteNumber(row.baths),
        sqft: toFiniteNumber(row.sqft),
        tenantStatus,
        notes,
        isCommercial,
        isRentStabilized,
        isVacantLike,
        modeledAnnualRent,
        defaultProjectedAnnualRent,
      },
    ];
  });

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeExpenseModelRows(
  rows: Array<PropertyDealDossierExpenseModelRow | OmCalculationExpenseModelRow> | null | undefined
): OmCalculationExpenseModelRow[] | undefined {
  if (!Array.isArray(rows)) return undefined;

  const normalized = rows.flatMap((row) => {
    const rowId = trimmedOrNull(row.rowId);
    if (!rowId) return [];

    const lineItem = trimmedOrNull(row.lineItem) ?? "";
    const amount = toFiniteNumber(row.amount);
    const annualGrowthPct = toFiniteNumber(row.annualGrowthPct);
    if (!lineItem && amount == null && annualGrowthPct == null) return [];

    const isManagementLine =
      "isManagementLine" in row && typeof row.isManagementLine === "boolean"
        ? row.isManagementLine
        : isManagementLineItem(lineItem);
    const treatment =
      row.treatment === "operating" ||
      row.treatment === "replace_management" ||
      row.treatment === "exclude"
        ? row.treatment
        : isManagementLine
          ? "replace_management"
          : "operating";

    return [
      {
        rowId,
        lineItem,
        amount,
        annualGrowthPct,
        treatment,
        isManagementLine,
      },
    ];
  });

  return normalized.length > 0 ? normalized : undefined;
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
      onboardingFee: row.onboardingFee ?? null,
      monthlyHospitalityExpense: row.monthlyHospitalityExpense ?? null,
      includeInUnderwriting: row.includeInUnderwriting,
      isProtected: row.isProtected,
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

function emptyOmCalculationDraft(): OmCalculationDraft {
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
    annualOtherIncomeGrowthPct: null,
    annualExpenseGrowthPct: null,
    annualPropertyTaxGrowthPct: null,
    recurringCapexAnnual: null,
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

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(ms: number, roundUp = false): string {
  const totalSeconds = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function documentLooksLikeOm(doc: { fileName?: string | null; source?: string | null; sourceType?: string | null }): boolean {
  const haystack = `${doc.fileName ?? ""} ${doc.source ?? ""} ${doc.sourceType ?? ""}`.toLowerCase();
  return /(offering\s*memo|offering memorandum|\bom\b|brochure|rent\s*roll|t-?12|financial)/i.test(haystack);
}

function categoryTriggersOmBuild(category: string): boolean {
  return category === "OM" || category === "Brochure" || category === "Rent Roll";
}

function fileLooksLikePdf(filename: string | null | undefined, mimeType?: string | null): boolean {
  if (typeof mimeType === "string" && mimeType.toLowerCase().includes("pdf")) return true;
  return typeof filename === "string" && /\.pdf$/i.test(filename.trim());
}

function DealAnalysisContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("property_id")?.trim() ?? "";

  const [properties, setProperties] = useState<CanonicalProperty[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [propertySearch, setPropertySearch] = useState("");

  const [selectedProperty, setSelectedProperty] = useState<CanonicalProperty | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingRow | null>(null);
  const [documents, setDocuments] = useState<PropertyDocument[]>([]);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [propertyError, setPropertyError] = useState<string | null>(null);

  const [draft, setDraft] = useState<OmCalculationDraft>(emptyOmCalculationDraft);
  const [savedDraft, setSavedDraft] = useState<OmCalculationDraft>(emptyOmCalculationDraft);
  const [formulaDefaults, setFormulaDefaults] = useState<OmCalculationDraft>(emptyOmCalculationDraft);
  const [mixSummary, setMixSummary] = useState<DossierAssumptionsResponse["mixSummary"]>(null);
  const [dossierSettingsLoading, setDossierSettingsLoading] = useState(false);
  const [dossierSettingsSaving, setDossierSettingsSaving] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);

  const [omCalculation, setOmCalculation] = useState<OmCalculationSnapshot | null>(null);
  const [omCalculationLoading, setOmCalculationLoading] = useState(false);
  const [omCalculationRunning, setOmCalculationRunning] = useState(false);
  const [omCalculationError, setOmCalculationError] = useState<string | null>(null);
  const [authoritativeOmRefreshing, setAuthoritativeOmRefreshing] = useState(false);

  const [dossierGenerating, setDossierGenerating] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [generationProgressPct, setGenerationProgressPct] = useState(0);

  const [manualAddDraft, setManualAddDraft] = useState({ streetEasyUrl: "", omUrl: "" });
  const [manualAddSubmitting, setManualAddSubmitting] = useState(false);
  const [manualAddError, setManualAddError] = useState<string | null>(null);
  const [manualAddNotice, setManualAddNotice] = useState<string | null>(null);
  const [documentUploadCategory, setDocumentUploadCategory] = useState("OM");
  const [documentUploadSource, setDocumentUploadSource] = useState("");
  const [documentUploadError, setDocumentUploadError] = useState<string | null>(null);
  const [documentUploadNotice, setDocumentUploadNotice] = useState<string | null>(null);
  const [documentUploading, setDocumentUploading] = useState(false);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const activePropertyIdRef = useRef(propertyId);

  const setPropertyParam = useCallback((nextPropertyId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPropertyId && nextPropertyId.trim()) params.set("property_id", nextPropertyId.trim());
    else params.delete("property_id");
    const query = params.toString();
    router.replace(query ? `/deal-analysis?${query}` : "/deal-analysis");
  }, [router, searchParams]);

  const hydrateDossierAssumptions = useCallback((data: DossierAssumptionsResponse, listingPrice?: number | null) => {
    const nextDraft: OmCalculationDraft = {
      purchasePrice: data.defaults?.purchasePrice ?? listingPrice ?? null,
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
      annualOtherIncomeGrowthPct: data.defaults?.annualOtherIncomeGrowthPct ?? null,
      annualExpenseGrowthPct: data.defaults?.annualExpenseGrowthPct ?? null,
      annualPropertyTaxGrowthPct: data.defaults?.annualPropertyTaxGrowthPct ?? null,
      recurringCapexAnnual: data.defaults?.recurringCapexAnnual ?? null,
      holdPeriodYears: data.defaults?.holdPeriodYears ?? null,
      exitCapPct: data.defaults?.exitCapPct ?? null,
      exitClosingCostPct: data.defaults?.exitClosingCostPct ?? null,
      targetIrrPct: data.defaults?.targetIrrPct ?? null,
      unitModelRows: normalizeUnitModelRows(data.defaults?.unitModelRows),
      expenseModelRows: normalizeExpenseModelRows(data.defaults?.expenseModelRows),
      brokerEmailNotes: data.defaults?.brokerEmailNotes ?? "",
    };

    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setFormulaDefaults({
      ...emptyOmCalculationDraft(),
      renovationCosts: data.formulaDefaults?.renovationCosts ?? 0,
      furnishingSetupCosts: data.formulaDefaults?.furnishingSetupCosts ?? null,
    });
    setMixSummary(data.mixSummary ?? null);
    return nextDraft;
  }, []);

  const fetchProperties = useCallback(async (quiet = false) => {
    if (!quiet) {
      setPropertiesLoading(true);
      setPropertiesError(null);
    }
    try {
      const res = await fetch(`${API_BASE}/api/properties?includeListingSummary=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to load properties"
        );
      }
      setProperties(data.properties ?? []);
    } catch (err) {
      if (!quiet) setPropertiesError(err instanceof Error ? err.message : "Failed to load properties");
    } finally {
      if (!quiet) setPropertiesLoading(false);
    }
  }, []);

  const fetchPropertyCore = useCallback(async (targetPropertyId: string) => {
    const [propertyRes, listingRes, documentsRes] = await Promise.all([
      fetch(`${API_BASE}/api/properties/${encodeURIComponent(targetPropertyId)}`),
      fetch(`${API_BASE}/api/properties/${encodeURIComponent(targetPropertyId)}/listing`),
      fetch(`${API_BASE}/api/properties/${encodeURIComponent(targetPropertyId)}/documents`),
    ]);

    const propertyData = await propertyRes.json().catch(() => ({}));
    const listingData = await listingRes.json().catch(() => ({}));
    const documentsData = await documentsRes.json().catch(() => ({}));

    if (!propertyRes.ok || propertyData?.error) {
      throw new Error(
        typeof propertyData?.details === "string"
          ? propertyData.details
          : typeof propertyData?.error === "string"
            ? propertyData.error
            : "Failed to load property"
      );
    }

    const listing = (listingData?.listing ?? null) as ListingRow | null;
    const canonical: CanonicalProperty = {
      id: propertyData.id,
      canonicalAddress: propertyData.canonicalAddress ?? "",
      details: propertyData.details ?? null,
      createdAt: propertyData.createdAt,
      updatedAt: propertyData.updatedAt,
      primaryListing: listing
        ? {
            price: listing.price ?? null,
            listedAt: listing.listedAt ?? null,
            city: listing.city ?? null,
          }
        : null,
      omStatus: propertyData.omStatus ?? undefined,
      dealScore: propertyData.dealScore ?? null,
    };
    return { canonical, listing, documents: documentsData?.documents ?? [] };
  }, []);

  const applyPropertyCore = useCallback(
    (targetPropertyId: string, next: { canonical: CanonicalProperty; listing: ListingRow | null; documents: PropertyDocument[] }) => {
      if (activePropertyIdRef.current !== targetPropertyId) return;
      setSelectedProperty(next.canonical);
      setSelectedListing(next.listing);
      setDocuments(next.documents);
    },
    []
  );

  const runOmCalculation = useCallback(async (
    nextDraft: OmCalculationDraft,
    options?: { initialLoad?: boolean; propertyIdOverride?: string }
  ) => {
    const targetPropertyId = options?.propertyIdOverride ?? propertyId;
    if (!targetPropertyId) return null;

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
      const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(targetPropertyId)}/om-calculation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assumptions,
          brokerEmailNotes: nextDraft.brokerEmailNotes.trim(),
          unitModelRows: nextDraft.unitModelRows,
          expenseModelRows: nextDraft.expenseModelRows,
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
      setOmCalculationError(err instanceof Error ? err.message : "Failed to run OM calculation");
      return null;
    } finally {
      setOmCalculationLoading(false);
      setOmCalculationRunning(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void fetchProperties();
  }, [fetchProperties]);

  useEffect(() => {
    activePropertyIdRef.current = propertyId;
  }, [propertyId]);

  useEffect(() => {
    if (!propertyId) {
      setSelectedProperty(null);
      setSelectedListing(null);
      setDocuments([]);
      setDraft(emptyOmCalculationDraft());
      setSavedDraft(emptyOmCalculationDraft());
      setFormulaDefaults(emptyOmCalculationDraft());
      setMixSummary(null);
      setDossierError(null);
      setOmCalculation(null);
      setOmCalculationError(null);
      setPropertyError(null);
      setPropertyLoading(false);
      setDossierSettingsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setPropertyLoading(true);
      setDossierSettingsLoading(true);
      setPropertyError(null);
      setDossierError(null);
      setOmCalculationError(null);
      try {
        const [{ canonical, listing, documents: nextDocuments }, assumptionsRes] = await Promise.all([
          fetchPropertyCore(propertyId),
          fetch(`${API_BASE}/api/dossier-assumptions?property_id=${encodeURIComponent(propertyId)}`),
        ]);
        const assumptionsData = await assumptionsRes.json().catch(() => ({}));
        if (!assumptionsRes.ok || assumptionsData?.error) {
          throw new Error(
            typeof assumptionsData?.details === "string"
              ? assumptionsData.details
              : typeof assumptionsData?.error === "string"
                ? assumptionsData.error
                : "Failed to load property assumptions"
          );
        }

        if (cancelled) return;
        applyPropertyCore(propertyId, { canonical, listing, documents: nextDocuments });
        const nextDraft = hydrateDossierAssumptions(assumptionsData as DossierAssumptionsResponse, listing?.price ?? canonical.primaryListing?.price ?? null);
        const authoritativeOm = ((canonical.details as Record<string, unknown> | null | undefined)?.omData as { authoritative?: unknown } | null | undefined)?.authoritative;
        if (authoritativeOm != null || nextDraft.brokerEmailNotes.trim().length > 0) {
          const calculation = await runOmCalculation(nextDraft, {
            initialLoad: true,
            propertyIdOverride: propertyId,
          });
          if (!cancelled && calculation) {
            const syncedDraft: OmCalculationDraft = {
              ...nextDraft,
              unitModelRows: calculation.unitModelRows,
              expenseModelRows: calculation.expenseModelRows,
            };
            setDraft(syncedDraft);
            setSavedDraft(syncedDraft);
          }
        } else {
          setOmCalculation(null);
          setOmCalculationLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setPropertyError(err instanceof Error ? err.message : "Failed to load property");
          setOmCalculation(null);
          setOmCalculationLoading(false);
        }
      } finally {
        if (!cancelled) {
          setPropertyLoading(false);
          setDossierSettingsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [applyPropertyCore, fetchPropertyCore, hydrateDossierAssumptions, propertyId, runOmCalculation]);

  useEffect(() => {
    if (!dossierGenerating || generationStartedAt == null) return;
    const tick = () => {
      const elapsed = Date.now() - generationStartedAt;
      setGenerationElapsedMs(elapsed);
      setGenerationProgressPct(estimateGenerationProgress(elapsed));
    };
    tick();
    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [dossierGenerating, generationStartedAt]);

  useEffect(() => {
    if (!manualAddNotice) return;
    const timeoutId = window.setTimeout(() => setManualAddNotice(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [manualAddNotice]);

  useEffect(() => {
    if (!documentUploadNotice) return;
    const timeoutId = window.setTimeout(() => setDocumentUploadNotice(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [documentUploadNotice]);

  const filteredProperties = useMemo(() => {
    const normalized = propertySearch.trim().toLowerCase();
    const sorted = [...properties].sort((a, b) => a.canonicalAddress.localeCompare(b.canonicalAddress));
    if (!normalized) return sorted.slice(0, 18);
    return sorted
      .filter((property) => {
        const haystack = [
          property.id,
          property.canonicalAddress,
          property.primaryListing?.city ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, 18);
  }, [properties, propertySearch]);

  const authoritativeOm = (((selectedProperty?.details as Record<string, unknown> | null | undefined)?.omData as {
    authoritative?: unknown;
  } | null | undefined)?.authoritative ?? null) as Record<string, unknown> | null;
  const hasAuthoritativeOm = authoritativeOm != null;
  const omDocuments = documents.filter((document) => document.source === "OM" || document.source === "Brochure" || documentLooksLikeOm(document));
  const hasOmDocument = omDocuments.length > 0;
  const persistedDossierGeneration = getPropertyDossierGeneration(selectedProperty?.details);
  const persistedDossierAssumptions = getPropertyDossierAssumptions(selectedProperty?.details);

  const numericFieldsDirty = OM_CALC_NUMERIC_FIELDS.some((field) => (draft[field] ?? null) !== (savedDraft[field] ?? null));
  const unitModelRowsDirty = serializeUnitModelRows(draft.unitModelRows) !== serializeUnitModelRows(savedDraft.unitModelRows);
  const expenseModelRowsDirty =
    serializeExpenseModelRows(draft.expenseModelRows) !== serializeExpenseModelRows(savedDraft.expenseModelRows);
  const metadataDirty =
    draft.investmentProfile.trim() !== savedDraft.investmentProfile.trim() ||
    draft.targetAcquisitionDate !== savedDraft.targetAcquisitionDate;
  const isDirty =
    numericFieldsDirty ||
    metadataDirty ||
    unitModelRowsDirty ||
    expenseModelRowsDirty ||
    draft.brokerEmailNotes.trim() !== savedDraft.brokerEmailNotes.trim();
  const hasSavedBrokerEmailNotes = savedDraft.brokerEmailNotes.trim().length > 0;
  const hasBrokerEmailNotes = draft.brokerEmailNotes.trim().length > 0 || hasSavedBrokerEmailNotes;
  const canGenerateDossier = hasAuthoritativeOm || hasBrokerEmailNotes;
  const isBusy =
    dossierSettingsSaving ||
    omCalculationRunning ||
    authoritativeOmRefreshing ||
    dossierGenerating ||
    persistedDossierGeneration?.status === "running";

  const activeGenerationStepIndex = DOSSIER_GENERATION_STEPS.reduce(
    (activeIndex, step, index) => (generationProgressPct >= step.startPct ? index : activeIndex),
    0
  );
  const activeGenerationStepLabel =
    generationProgressPct >= 100
      ? "Dossier ready"
      : DOSSIER_GENERATION_STEPS[activeGenerationStepIndex]?.label ?? "Preparing property inputs";
  const remainingDurationLabel =
    generationProgressPct >= 100
      ? "0:00"
      : generationElapsedMs >= 95_000
        ? "Almost done"
        : formatDuration(95_000 - generationElapsedMs, true);

  const updateLocalAssumptionsState = useCallback((payload: OmCalculationDraft) => {
    setSelectedProperty((prev) => {
      if (!prev) return prev;
      const details = ((prev.details ?? {}) as Record<string, unknown>) ?? {};
      const dealDossier = ((details.dealDossier as Record<string, unknown> | undefined) ?? {});
      return {
        ...prev,
        details: {
          ...details,
          dealDossier: {
            ...dealDossier,
            assumptions: {
              ...payload,
              updatedAt: new Date().toISOString(),
            },
          },
        },
      };
    });
  }, []);

  const persistDossierSettings = useCallback(async (nextDraft: OmCalculationDraft = draft) => {
    if (!propertyId) throw new Error("Select a property first.");
    const payload: OmCalculationDraft = {
      ...nextDraft,
      unitModelRows: nextDraft.unitModelRows ?? savedDraft.unitModelRows,
      expenseModelRows: nextDraft.expenseModelRows ?? savedDraft.expenseModelRows,
      brokerEmailNotes: nextDraft.brokerEmailNotes.trim(),
    };

    setDossierSettingsSaving(true);
    setDossierError(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/dossier-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to save dossier settings"
        );
      }
      setSavedDraft(payload);
      setDraft(payload);
      updateLocalAssumptionsState(payload);
      return payload;
    } finally {
      setDossierSettingsSaving(false);
    }
  }, [draft, propertyId, savedDraft.expenseModelRows, savedDraft.unitModelRows, updateLocalAssumptionsState]);

  const handleDraftNumberChange = useCallback((field: OmCalculationNumericField, value: number | null) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleDraftTextChange = useCallback((field: "investmentProfile" | "targetAcquisitionDate", value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const refreshAuthoritativeOmWorkspace = useCallback(async (
    targetPropertyId: string,
    nextDraft: OmCalculationDraft,
    options?: { skipDocumentCheck?: boolean }
  ) => {
    if (!targetPropertyId || authoritativeOmRefreshing) return;
    if (!options?.skipDocumentCheck && !hasOmDocument) return;

    setAuthoritativeOmRefreshing(true);
    setDossierError(null);
    setOmCalculationError(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(targetPropertyId)}/refresh-om-financials`, {
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
      const refreshed = await fetchPropertyCore(targetPropertyId);
      applyPropertyCore(targetPropertyId, refreshed);
      const nextHasAuthoritativeOm =
        ((((refreshed.canonical.details as Record<string, unknown> | null | undefined)?.omData as {
          authoritative?: unknown;
        } | null | undefined)?.authoritative ?? null) != null);
      if (nextDraft.brokerEmailNotes.trim().length > 0 || nextHasAuthoritativeOm) {
        await runOmCalculation(nextDraft, { initialLoad: true, propertyIdOverride: targetPropertyId });
      }
    } finally {
      setAuthoritativeOmRefreshing(false);
    }
  }, [applyPropertyCore, authoritativeOmRefreshing, fetchPropertyCore, hasOmDocument, runOmCalculation]);

  const handleRefreshAuthoritativeOm = useCallback(async () => {
    if (!propertyId || !hasOmDocument || authoritativeOmRefreshing) return;
    try {
      await refreshAuthoritativeOmWorkspace(propertyId, draft);
    } catch (err) {
      setDossierError(err instanceof Error ? err.message : "Failed to build authoritative OM");
    }
  }, [authoritativeOmRefreshing, draft, hasOmDocument, propertyId, refreshAuthoritativeOmWorkspace]);

  const handleUploadDocument = useCallback(async () => {
    if (!propertyId) {
      setDocumentUploadError("Select a property first.");
      return;
    }

    const file = documentFileInputRef.current?.files?.[0];
    if (!file) {
      setDocumentUploadError("Select a file to upload.");
      return;
    }

    setDocumentUploading(true);
    setDocumentUploadError(null);
    setDocumentUploadNotice(null);
    setDossierError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", documentUploadCategory);
      if (documentUploadSource.trim()) formData.append("source", documentUploadSource.trim());

      const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to upload document"
        );
      }

      const uploadedFileName =
        typeof data?.document?.filename === "string" && data.document.filename.trim().length > 0
          ? data.document.filename.trim()
          : file.name;
      const refreshed = await fetchPropertyCore(propertyId);
      applyPropertyCore(propertyId, refreshed);

      if (categoryTriggersOmBuild(documentUploadCategory) && fileLooksLikePdf(uploadedFileName, file.type)) {
        setDocumentUploadNotice(`Uploaded ${uploadedFileName}. Building authoritative OM...`);
        await refreshAuthoritativeOmWorkspace(propertyId, draft, { skipDocumentCheck: true });
        setDocumentUploadNotice(`Uploaded ${uploadedFileName} and refreshed the OM analysis workspace.`);
      } else {
        setDocumentUploadNotice(
          categoryTriggersOmBuild(documentUploadCategory)
            ? `Uploaded ${uploadedFileName}. Use a PDF OM when you want to build the authoritative analysis automatically.`
            : `Uploaded ${uploadedFileName}.`
        );
      }

      if (documentFileInputRef.current) documentFileInputRef.current.value = "";
      setDocumentUploadCategory("OM");
      setDocumentUploadSource("");
    } catch (err) {
      setDocumentUploadError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setDocumentUploading(false);
    }
  }, [applyPropertyCore, documentUploadCategory, documentUploadSource, draft, fetchPropertyCore, propertyId, refreshAuthoritativeOmWorkspace]);

  const handleGenerateDossier = useCallback(async () => {
    if (!propertyId) {
      setDossierError("Select a property before generating a dossier.");
      return;
    }
    if (!canGenerateDossier) {
      setDossierError("Generate dossier requires an authoritative OM or saved broker email notes with rent and expense inputs.");
      return;
    }

    try {
      const saved = await persistDossierSettings();
      const startedAt = Date.now();
      setDossierGenerating(true);
      setGenerationStartedAt(startedAt);
      setGenerationElapsedMs(0);
      setGenerationProgressPct(3);
      setDossierError(null);

      const res = await fetch(`${API_BASE}/api/dossier/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
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

      setSavedDraft(saved);
      const refreshed = await fetchPropertyCore(propertyId);
      applyPropertyCore(propertyId, refreshed);
      setGenerationStartedAt(null);
      setGenerationElapsedMs(Date.now() - startedAt);
      setGenerationProgressPct(100);
      await new Promise((resolve) => window.setTimeout(resolve, 300));

      const params = new URLSearchParams({
        property_id: propertyId,
        dossier_id: data.dossierDoc?.id ?? "",
        excel_id: data.excelDoc?.id ?? "",
      });
      if (data.emailSent) params.set("email_sent", "1");
      if (data.dealScore != null && !Number.isNaN(data.dealScore)) {
        params.set("deal_score", String(Math.round(data.dealScore)));
      }
      window.location.href = `/dossier-success?${params.toString()}`;
    } catch (err) {
      setDossierError(err instanceof Error ? err.message : "Failed to generate dossier");
      setDossierGenerating(false);
      setGenerationStartedAt(null);
      setGenerationElapsedMs(0);
      setGenerationProgressPct(0);
    }
  }, [applyPropertyCore, canGenerateDossier, fetchPropertyCore, persistDossierSettings, propertyId]);

  const handleClearSavedOverrides = useCallback(async () => {
    if (!propertyId) return;
    try {
      await persistDossierSettings({
        ...emptyOmCalculationDraft(),
        unitModelRows: [],
        expenseModelRows: [],
      });
      const res = await fetch(`${API_BASE}/api/dossier-assumptions?property_id=${encodeURIComponent(propertyId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to reload defaults"
        );
      }
      const nextDraft = hydrateDossierAssumptions(data as DossierAssumptionsResponse, selectedListing?.price ?? selectedProperty?.primaryListing?.price ?? null);
      if (hasAuthoritativeOm || nextDraft.brokerEmailNotes.trim().length > 0) {
        await runOmCalculation(nextDraft, { initialLoad: true, propertyIdOverride: propertyId });
      } else {
        setOmCalculation(null);
        setOmCalculationLoading(false);
      }
    } catch (err) {
      setOmCalculationError(err instanceof Error ? err.message : "Failed to clear saved overrides");
    }
  }, [hasAuthoritativeOm, hydrateDossierAssumptions, persistDossierSettings, propertyId, runOmCalculation, selectedListing?.price, selectedProperty?.primaryListing?.price]);

  const runWorkspaceSetup = useCallback(async (mode: "streeteasy" | "om") => {
    const streetEasyUrl = manualAddDraft.streetEasyUrl.trim();
    const omUrl = manualAddDraft.omUrl.trim();
    if (mode === "streeteasy" && !streetEasyUrl) {
      setManualAddError("StreetEasy URL is required.");
      return;
    }
    if (mode === "om" && !omUrl) {
      setManualAddError("OM URL is required.");
      return;
    }

    setManualAddSubmitting(true);
    setManualAddError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/properties/${mode === "streeteasy" ? "manual-add" : "manual-add-from-om"}`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body:
            mode === "streeteasy"
              ? JSON.stringify({ streetEasyUrl, omUrl: omUrl || null })
              : JSON.stringify({ omUrl }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(
          typeof data?.details === "string"
            ? data.details
            : typeof data?.error === "string"
              ? data.error
              : "Failed to add property"
        );
      }

      const payload = data as ManualAddResponse;
      const warning = payload.omImport?.warning?.trim() || "";
      const recordMessage = payload.createdProperty
        ? `Created a new OM workspace for ${payload.canonicalAddress}.`
        : payload.matchStrategy === "address_line"
          ? `Matched an existing property workspace for ${payload.canonicalAddress} from the OM address line.`
          : `Matched the existing property workspace for ${payload.canonicalAddress}.`;
      const omMessage =
        payload.omImport?.imported && payload.omImport?.fileName
          ? ` OM saved as ${payload.omImport.fileName}.`
          : warning
            ? ` OM import needs attention: ${warning}`
            : "";

      setManualAddNotice(`${recordMessage}${omMessage}`.trim());
      setManualAddDraft({ streetEasyUrl: "", omUrl: "" });
      setPropertySearch(payload.canonicalAddress);
      await fetchProperties(true);
      setPropertyParam(payload.propertyId);
    } catch (err) {
      setManualAddError(err instanceof Error ? err.message : "Failed to add property");
    } finally {
      setManualAddSubmitting(false);
    }
  }, [fetchProperties, manualAddDraft.omUrl, manualAddDraft.streetEasyUrl, setPropertyParam]);

  const handleManualAddProperty = useCallback(async () => {
    await runWorkspaceSetup("streeteasy");
  }, [runWorkspaceSetup]);

  const handleOmOnlyAddProperty = useCallback(async () => {
    await runWorkspaceSetup("om");
  }, [runWorkspaceSetup]);

  const propertySummaryCards = [
    { label: "Address", value: selectedProperty?.canonicalAddress ?? "Select a property" },
    { label: "List price", value: formatCurrency(selectedListing?.price ?? selectedProperty?.primaryListing?.price ?? null) },
    { label: "OM files", value: String(omDocuments.length) },
    { label: "All docs", value: String(documents.length) },
    { label: "OM status", value: hasAuthoritativeOm ? "Authoritative OM ready" : hasOmDocument ? "OM document uploaded" : "No OM yet" },
    { label: "Deal score", value: selectedProperty?.dealScore != null ? `${selectedProperty.dealScore}/100` : "Pending dossier" },
    { label: "Saved inputs", value: persistedDossierAssumptions?.updatedAt ? formatDateOnly(persistedDossierAssumptions.updatedAt) : "Not saved" },
  ];

  return (
    <div style={pageShellStyle}>
      <div>
        <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1d4ed8" }}>
          Standalone Workspace
        </p>
        <h1 className="page-title" style={{ marginBottom: "0.35rem" }}>Deal Analysis</h1>
        <p style={{ margin: 0, maxWidth: "900px", color: "#475569", lineHeight: 1.6 }}>
          Analyze each OM as its own underwriting workspace. Start from an existing canonical property, or
          create and match one from a StreetEasy listing when you need persistence, then upload the OM,
          tune the assumptions, and generate the dossier from the same screen.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, 0.9fr)", gap: "1rem" }}>
        <section className="card" style={{ padding: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Select OM workspace</h2>
              <p style={{ margin: "0.3rem 0 0", color: "#64748b", fontSize: "0.9rem" }}>
                Search existing canonical property records, then open their OM analysis and dossier workflow here.
              </p>
            </div>
            {propertyId && (
              <button type="button" className="btn-secondary" onClick={() => setPropertyParam(null)}>
                Clear selection
              </button>
            )}
          </div>
          <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.75rem" }}>
            <input
              type="search"
              value={propertySearch}
              onChange={(event) => setPropertySearch(event.target.value)}
              placeholder="Search address, city, or property ID"
              className="profile-input"
            />
            {propertiesError && <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.88rem" }}>{propertiesError}</p>}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", minHeight: "180px", background: "#fff" }}>
              {propertiesLoading ? (
                <div style={{ padding: "1rem", color: "#64748b" }}>Loading properties...</div>
              ) : filteredProperties.length === 0 ? (
                <div style={{ padding: "1rem", color: "#64748b" }}>No matching properties yet.</div>
              ) : (
                filteredProperties.map((property) => {
                  const isActive = property.id === propertyId;
                  return (
                    <button
                      key={property.id}
                      type="button"
                      onClick={() => setPropertyParam(property.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.85rem 1rem",
                        border: "none",
                        borderBottom: "1px solid #eef2f7",
                        background: isActive ? "#eff6ff" : "#fff",
                        cursor: "pointer",
                        display: "grid",
                        gap: "0.2rem",
                      }}
                    >
                      <strong style={{ color: "#0f172a" }}>{property.canonicalAddress}</strong>
                      <span style={{ fontSize: "0.82rem", color: "#64748b" }}>
                        {property.primaryListing?.city ?? "Unknown city"} · {formatCurrency(property.primaryListing?.price ?? null)} · {property.id}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="card" style={{ padding: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Create or match workspace</h2>
          <p style={{ margin: "0.3rem 0 0.85rem", color: "#64748b", fontSize: "0.9rem", lineHeight: 1.5 }}>
            Use StreetEasy when you have the listing handy, or create directly from a PDF OM URL when the OM
            itself has the building address. If the address already matches a canonical property record, we
            will attach to that existing record instead of creating a duplicate.
          </p>
          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            <span style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.82rem", fontWeight: 600, color: "#0f172a" }}>
              StreetEasy URL
            </span>
            <input
              type="url"
              value={manualAddDraft.streetEasyUrl}
              onChange={(event) => setManualAddDraft((prev) => ({ ...prev, streetEasyUrl: event.target.value }))}
              placeholder="https://streeteasy.com/sale/..."
              className="profile-input"
            />
          </label>
          <label style={{ display: "block", marginBottom: "0.35rem" }}>
            <span style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.82rem", fontWeight: 600, color: "#0f172a" }}>
              OM URL
            </span>
            <input
              type="url"
              value={manualAddDraft.omUrl}
              onChange={(event) => setManualAddDraft((prev) => ({ ...prev, omUrl: event.target.value }))}
              placeholder="https://.../offering-memo.pdf"
              className="profile-input"
            />
          </label>
          <p style={{ margin: "0 0 0.9rem", color: "#64748b", fontSize: "0.82rem", lineHeight: 1.5 }}>
            Best OM-only results come from a direct PDF or downloadable OM link rather than an HTML landing page.
          </p>
          {manualAddError && <p style={{ margin: "0 0 0.8rem", color: "#b91c1c", fontSize: "0.85rem" }}>{manualAddError}</p>}
          {manualAddNotice && <p style={{ margin: "0 0 0.8rem", color: "#166534", fontSize: "0.85rem" }}>{manualAddNotice}</p>}
          <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleManualAddProperty()}
              disabled={manualAddSubmitting || !manualAddDraft.streetEasyUrl.trim()}
            >
              {manualAddSubmitting ? "Setting up..." : "Create / match from StreetEasy"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void handleOmOnlyAddProperty()}
              disabled={manualAddSubmitting || !manualAddDraft.omUrl.trim()}
            >
              {manualAddSubmitting ? "Setting up..." : "Create / match from OM"}
            </button>
          </div>
        </section>
      </div>

      {propertyId && (
        <>
          <section className="card" style={{ padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ maxWidth: "800px" }}>
                <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>
                  {selectedProperty?.canonicalAddress ?? propertyId}
                </h2>
                <p style={{ margin: "0.35rem 0 0", color: "#64748b", fontSize: "0.9rem", lineHeight: 1.5 }}>
                  This OM workspace stays tied to the canonical property record so uploads, assumptions, and
                  dossier output persist in one place.
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
                <Link href={`/property/${encodeURIComponent(propertyId)}`} className="btn-secondary">
                  Open property record
                </Link>
                <Link href="/profile" className="btn-secondary">
                  Profile defaults
                </Link>
              </div>
            </div>

            <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
              {propertySummaryCards.map((card) => (
                <div key={card.label} style={{ border: "1px solid #e2e8f0", borderRadius: "14px", padding: "0.85rem 0.95rem", background: "#fff" }}>
                  <div style={{ fontSize: "0.76rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                    {card.label}
                  </div>
                  <div style={{ marginTop: "0.35rem", fontWeight: 700, color: "#0f172a", lineHeight: 1.4 }}>
                    {card.value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card" style={{ padding: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.05fr) minmax(320px, 0.95fr)", gap: "1rem" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>OM notes and fallback inputs</h2>
                <p style={{ margin: "0.3rem 0 0.85rem", fontSize: "0.9rem", color: "#64748b", lineHeight: 1.55 }}>
                  Save the broker notes, rent roll bullets, or T12 highlights that should fill gaps when the
                  OM is incomplete or when you want to override what was extracted.
                </p>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#0f172a" }}>
                    Broker notes, rent roll notes, or OM fallback assumptions
                  </span>
                  <textarea
                    value={draft.brokerEmailNotes}
                    onChange={(event) => setDraft((prev) => ({ ...prev, brokerEmailNotes: event.target.value }))}
                    rows={8}
                    placeholder="Paste broker email notes, rent roll bullets, projected rents, expense assumptions, or any off-market underwriting context here."
                    style={{
                      minHeight: "180px",
                      padding: "0.75rem 0.85rem",
                      border: "1px solid #cbd5e1",
                      borderRadius: "12px",
                      resize: "vertical",
                      fontFamily: "inherit",
                      lineHeight: 1.55,
                    }}
                  />
                </label>
                <div style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "#64748b", lineHeight: 1.55 }}>
                  <div>
                    Save assumptions below to persist both the calculator inputs and these notes onto the
                    property workspace.
                  </div>
                  <div>
                    Formula furnishing default: {formatCurrency(formulaDefaults.furnishingSetupCosts ?? 0)}.
                  </div>
                  {mixSummary && (
                    <div>
                      Mix context: {mixSummary.eligibleResidentialUnits ?? 0} eligible residential unit(s), {mixSummary.commercialUnits ?? 0} commercial, {mixSummary.rentStabilizedUnits ?? 0} rent-stabilized.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.9rem" }}>
                <div style={{ border: "1px solid #dbe2ea", borderRadius: "14px", padding: "1rem", background: "#fbfdff" }}>
                  <h3 style={{ margin: 0, fontSize: "0.98rem", color: "#0f172a" }}>Upload OM / rent roll</h3>
                  <p style={{ margin: "0.35rem 0 0.85rem", color: "#64748b", fontSize: "0.85rem", lineHeight: 1.5 }}>
                    Upload PDFs and supporting files directly from this workspace. PDF OM, brochure, and rent
                    roll uploads can refresh the authoritative OM analysis automatically here.
                  </p>
                  <input
                    ref={documentFileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                    style={{ width: "100%", fontSize: "0.84rem" }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(170px, 210px)", gap: "0.55rem", marginTop: "0.75rem" }}>
                    <input
                      type="text"
                      value={documentUploadSource}
                      onChange={(event) => setDocumentUploadSource(event.target.value)}
                      placeholder="Source, e.g. broker or seller"
                      className="profile-input"
                    />
                    <select
                      value={documentUploadCategory}
                      onChange={(event) => setDocumentUploadCategory(event.target.value)}
                      className="profile-input"
                    >
                      <option value="OM">OM</option>
                      <option value="Brochure">Brochure</option>
                      <option value="Rent Roll">Rent Roll</option>
                      <option value="Financial Model">Financial Model</option>
                      <option value="T12 / Operating Summary">T12 / Operating Summary</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  {documentUploadError && (
                    <p style={{ margin: "0.75rem 0 0", color: "#b91c1c", fontSize: "0.84rem" }}>{documentUploadError}</p>
                  )}
                  {documentUploadNotice && (
                    <p style={{ margin: "0.75rem 0 0", color: "#166534", fontSize: "0.84rem" }}>{documentUploadNotice}</p>
                  )}
                  <div style={{ marginTop: "0.85rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void handleUploadDocument()}
                      disabled={documentUploading || dossierGenerating}
                    >
                      {documentUploading ? "Uploading..." : "Upload document"}
                    </button>
                    {hasOmDocument && !hasAuthoritativeOm && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void handleRefreshAuthoritativeOm()}
                        disabled={authoritativeOmRefreshing || isBusy || documentUploading}
                      >
                        {authoritativeOmRefreshing ? "Building OM..." : "Build authoritative OM"}
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ border: "1px solid #dbe2ea", borderRadius: "14px", padding: "1rem", background: "#fbfdff" }}>
                  <h3 style={{ margin: 0, fontSize: "0.98rem", color: "#0f172a" }}>Source readiness</h3>
                  <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.55rem", fontSize: "0.9rem", color: "#334155" }}>
                    <div>OM documents: <strong>{hasOmDocument ? `${omDocuments.length} file(s)` : "Not uploaded"}</strong></div>
                    <div>Authoritative OM: <strong>{hasAuthoritativeOm ? "Ready" : "Not built yet"}</strong></div>
                    <div>Broker notes saved: <strong>{hasSavedBrokerEmailNotes ? "Yes" : "No"}</strong></div>
                    <div>Dossier status: <strong>{persistedDossierGeneration?.status ?? "not_started"}</strong></div>
                  </div>
                  <div style={{ marginTop: "0.95rem" }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>
                      Recent OM files
                    </div>
                    <div style={{ marginTop: "0.55rem", display: "grid", gap: "0.5rem" }}>
                      {omDocuments.length > 0 ? (
                        omDocuments.slice(0, 4).map((document) => (
                          <a
                            key={document.id}
                            href={`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/${encodeURIComponent(document.id)}/file`}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: "0.75rem",
                              padding: "0.6rem 0.7rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "10px",
                              background: "#fff",
                              color: "#0f172a",
                              textDecoration: "none",
                              fontSize: "0.84rem",
                            }}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {document.fileName}
                            </span>
                            <span style={{ color: "#64748b", flexShrink: 0 }}>{formatDateOnly(document.createdAt)}</span>
                          </a>
                        ))
                      ) : (
                        <p style={{ margin: 0, color: "#64748b", fontSize: "0.84rem", lineHeight: 1.5 }}>
                          Upload an OM, brochure, or rent roll to start building this workspace.
                        </p>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: "0.85rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                    <Link href={`/property/${encodeURIComponent(propertyId)}`} className="btn-secondary">
                      Open all documents
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {(dossierError || propertyError) && (
              <p style={{ margin: "0.9rem 0 0", color: "#b91c1c", fontSize: "0.88rem" }}>
                {dossierError || propertyError}
              </p>
            )}
            {persistedDossierGeneration?.status === "failed" && !dossierError && persistedDossierGeneration.lastError && (
              <p style={{ margin: "0.9rem 0 0", color: "#b91c1c", fontSize: "0.88rem" }}>
                Last dossier run failed: {persistedDossierGeneration.lastError}
              </p>
            )}
          </section>

          {dossierGenerating && (
            <section className="dossier-progress-shell" aria-live="polite">
              <div className="dossier-progress-header">
                <div>
                  <div className="dossier-progress-title">{generationProgressPct}% complete</div>
                  <div className="dossier-progress-subtitle">{activeGenerationStepLabel}</div>
                </div>
                <div className="dossier-progress-step">
                  Step {Math.min(activeGenerationStepIndex + 1, DOSSIER_GENERATION_STEPS.length)} of {DOSSIER_GENERATION_STEPS.length}
                </div>
              </div>
              <div
                className="dossier-progress-track"
                role="progressbar"
                aria-label="Deal dossier generation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={generationProgressPct}
              >
                <div className="dossier-progress-fill" style={{ width: `${generationProgressPct}%` }} />
              </div>
              <div className="dossier-progress-metrics">
                <div className="dossier-progress-metric">
                  <span className="dossier-progress-metric-label">Est. remaining</span>
                  <strong>{remainingDurationLabel}</strong>
                </div>
                <div className="dossier-progress-metric">
                  <span className="dossier-progress-metric-label">Elapsed</span>
                  <strong>{formatDuration(generationElapsedMs)}</strong>
                </div>
                <div className="dossier-progress-metric">
                  <span className="dossier-progress-metric-label">Output</span>
                  <strong>PDF + Excel</strong>
                </div>
              </div>
            </section>
          )}

          <section>
            <OmCalculationPanel
              draft={draft}
              calculation={omCalculation}
              loading={dossierSettingsLoading || omCalculationLoading || propertyLoading}
              running={omCalculationRunning}
              saving={dossierSettingsSaving}
              error={omCalculationError}
              isDirty={isDirty}
              hasAuthoritativeOm={hasAuthoritativeOm}
              hasBrokerEmailNotes={hasBrokerEmailNotes}
              formulaFurnishingSetupCosts={formulaDefaults.furnishingSetupCosts}
              onDraftNumberChange={handleDraftNumberChange}
              onDraftTextChange={handleDraftTextChange}
              onUnitModelRowsChange={(unitModelRows) => {
                setDraft((prev) => ({ ...prev, unitModelRows }));
              }}
              onExpenseModelRowsChange={(expenseModelRows) => {
                setDraft((prev) => ({ ...prev, expenseModelRows }));
              }}
              onRunCalculation={() => {
                void runOmCalculation(draft, { propertyIdOverride: propertyId });
              }}
              onSave={() => {
                void persistDossierSettings()
                  .then((saved) => runOmCalculation(saved, { propertyIdOverride: propertyId }))
                  .catch((err) => setOmCalculationError(err instanceof Error ? err.message : "Failed to save property defaults"));
              }}
              onResetToSaved={() => {
                setDraft(savedDraft);
                setOmCalculationError(null);
                setDossierError(null);
              }}
              onApplyFormulaDefault={() => {
                setDraft((prev) => ({ ...prev, furnishingSetupCosts: formulaDefaults.furnishingSetupCosts ?? null }));
              }}
              onClearSaved={() => {
                void handleClearSavedOverrides();
              }}
            />
          </section>

          <section className="card" style={{ padding: "1rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Generate dossier</h2>
            <p style={{ margin: "0.35rem 0 0.85rem", color: "#64748b", fontSize: "0.9rem", lineHeight: 1.55 }}>
              Once the OM analysis looks right, generate the dossier and Excel using these saved inputs. The
              package will carry forward the current state, cash flow tables, sensitivities, and resolved
              assumptions from this workspace.
            </p>
            {!hasAuthoritativeOm && !hasBrokerEmailNotes && (
              <div style={{ marginBottom: "0.9rem", padding: "0.85rem 1rem", borderRadius: "12px", border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155", fontSize: "0.92rem" }}>
                Add an OM/rent roll or save broker notes first so the calculation has a current rent and expense source.
              </div>
            )}
            {!hasAuthoritativeOm && hasBrokerEmailNotes && (
              <div style={{ marginBottom: "0.9rem", padding: "0.85rem 1rem", borderRadius: "12px", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1e3a8a", fontSize: "0.92rem" }}>
                No authoritative OM is built yet, so this dossier will use the saved broker notes as the current underwriting source.
              </div>
            )}
            <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleGenerateDossier()}
                disabled={isBusy || !canGenerateDossier}
              >
                {dossierGenerating ? `Generating... ${generationProgressPct}%` : "Generate dossier"}
              </button>
              <Link href={`/dossier-assumptions?property_id=${encodeURIComponent(propertyId)}`} className="btn-secondary">
                Advanced assumptions
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function DealAnalysisPage() {
  return (
    <Suspense
      fallback={
        <div style={pageShellStyle}>
          <h1 className="page-title">Deal Analysis</h1>
          <p style={{ margin: 0, color: "#64748b" }}>Loading analysis workspace...</p>
        </div>
      }
    >
      <DealAnalysisContent />
    </Suspense>
  );
}
