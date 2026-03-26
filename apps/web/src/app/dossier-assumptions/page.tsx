"use client";

import React, { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface AssumptionsProfile {
  id: string;
  name?: string | null;
  email?: string | null;
  organization?: string | null;
  defaultPurchaseClosingCostPct?: number | null;
  defaultLtv?: number | null;
  defaultInterestRate?: number | null;
  defaultAmortization?: number | null;
  defaultHoldPeriodYears?: number | null;
  defaultExitCap?: number | null;
  defaultExitClosingCostPct?: number | null;
  defaultRentUplift?: number | null;
  defaultExpenseIncrease?: number | null;
  defaultManagementFee?: number | null;
  defaultTargetIrrPct?: number | null;
  defaultVacancyPct?: number | null;
  defaultLeadTimeMonths?: number | null;
  defaultAnnualRentGrowthPct?: number | null;
  defaultAnnualCommercialRentGrowthPct?: number | null;
  defaultAnnualOtherIncomeGrowthPct?: number | null;
  defaultAnnualExpenseGrowthPct?: number | null;
  defaultAnnualPropertyTaxGrowthPct?: number | null;
  defaultRecurringCapexAnnual?: number | null;
  defaultLoanFeePct?: number | null;
}

interface PropertySummary {
  id: string;
  canonicalAddress: string;
  primaryListing: { price: number | null; city: string | null } | null;
}

interface DossierAssumptionsDraft {
  purchasePrice?: number;
  purchaseClosingCostPct?: number;
  renovationCosts?: number;
  furnishingSetupCosts?: number;
  ltvPct?: number;
  interestRatePct?: number;
  amortizationYears?: number;
  loanFeePct?: number;
  rentUpliftPct?: number;
  expenseIncreasePct?: number;
  managementFeePct?: number;
  vacancyPct?: number;
  leadTimeMonths?: number;
  annualRentGrowthPct?: number;
  annualCommercialRentGrowthPct?: number;
  annualOtherIncomeGrowthPct?: number;
  annualExpenseGrowthPct?: number;
  annualPropertyTaxGrowthPct?: number;
  recurringCapexAnnual?: number;
  holdPeriodYears?: number;
  exitCapPct?: number;
  exitClosingCostPct?: number;
  targetIrrPct?: number;
}

interface PropertyMixSummary {
  totalUnits?: number | null;
  residentialUnits?: number | null;
  eligibleResidentialUnits?: number | null;
  commercialUnits?: number | null;
  rentStabilizedUnits?: number | null;
  eligibleRevenueSharePct?: number | null;
  eligibleUnitSharePct?: number | null;
}

const DOSSIER_GENERATION_ESTIMATE_MS = 95_000;
const DOSSIER_GENERATION_STEPS = [
  { startPct: 0, label: "Preparing property inputs" },
  { startPct: 16, label: "Running underwriting model" },
  { startPct: 38, label: "Drafting investment memo" },
  { startPct: 67, label: "Rendering PDF and Excel" },
  { startPct: 90, label: "Saving documents" },
] as const;

const inputStyle: React.CSSProperties = {
  padding: "0.5rem",
  border: "1px solid #ccc",
  borderRadius: "4px",
};

const sectionStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
  padding: "1rem",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
  background: "#fafafa",
};

function formatDuration(ms: number, roundUp = false): string {
  const totalSeconds = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function estimateGenerationProgress(elapsedMs: number): number {
  const clampedRatio = Math.min(Math.max(elapsedMs / DOSSIER_GENERATION_ESTIMATE_MS, 0), 1);
  const easedRatio = 1 - Math.pow(1 - clampedRatio, 1.6);
  return Math.min(96, Math.max(3, Math.round(easedRatio * 96)));
}

function DossierAssumptionsContent() {
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("property_id")?.trim() ?? null;

  const [profile, setProfile] = useState<AssumptionsProfile | null>(null);
  const [property, setProperty] = useState<PropertySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DossierAssumptionsDraft>({});
  const [mixSummary, setMixSummary] = useState<PropertyMixSummary | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [generationProgressPct, setGenerationProgressPct] = useState(0);

  const fetchAssumptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = propertyId
        ? `${API_BASE}/api/dossier-assumptions?property_id=${encodeURIComponent(propertyId)}`
        : `${API_BASE}/api/dossier-assumptions`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load");
      setProfile(data.profile ?? null);
      setProperty(data.property ?? null);
      setMixSummary(data.mixSummary ?? null);
      const defaults = (data.defaults ?? {}) as DossierAssumptionsDraft;
      setDraft({
        purchasePrice: defaults.purchasePrice ?? data.property?.primaryListing?.price ?? undefined,
        purchaseClosingCostPct: defaults.purchaseClosingCostPct ?? undefined,
        renovationCosts: defaults.renovationCosts ?? 0,
        furnishingSetupCosts: defaults.furnishingSetupCosts ?? 0,
        ltvPct: defaults.ltvPct ?? undefined,
        interestRatePct: defaults.interestRatePct ?? undefined,
        amortizationYears: defaults.amortizationYears ?? undefined,
        loanFeePct: defaults.loanFeePct ?? undefined,
        rentUpliftPct: defaults.rentUpliftPct ?? undefined,
        expenseIncreasePct: defaults.expenseIncreasePct ?? undefined,
        managementFeePct: defaults.managementFeePct ?? undefined,
        vacancyPct: defaults.vacancyPct ?? undefined,
        leadTimeMonths: defaults.leadTimeMonths ?? undefined,
        annualRentGrowthPct: defaults.annualRentGrowthPct ?? undefined,
        annualCommercialRentGrowthPct: defaults.annualCommercialRentGrowthPct ?? undefined,
        annualOtherIncomeGrowthPct: defaults.annualOtherIncomeGrowthPct ?? undefined,
        annualExpenseGrowthPct: defaults.annualExpenseGrowthPct ?? undefined,
        annualPropertyTaxGrowthPct: defaults.annualPropertyTaxGrowthPct ?? undefined,
        recurringCapexAnnual: defaults.recurringCapexAnnual ?? undefined,
        holdPeriodYears: defaults.holdPeriodYears ?? undefined,
        exitCapPct: defaults.exitCapPct ?? undefined,
        exitClosingCostPct: defaults.exitClosingCostPct ?? undefined,
        targetIrrPct: defaults.targetIrrPct ?? undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assumptions");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    fetchAssumptions();
  }, [fetchAssumptions]);

  useEffect(() => {
    if (!generating || generationStartedAt == null) return;

    const tick = () => {
      const elapsed = Date.now() - generationStartedAt;
      setGenerationElapsedMs(elapsed);
      setGenerationProgressPct(estimateGenerationProgress(elapsed));
    };

    tick();
    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [generationStartedAt, generating]);

  const handleSaveAssumptions = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultPurchaseClosingCostPct: draft.purchaseClosingCostPct,
          defaultLtv: draft.ltvPct,
          defaultInterestRate: draft.interestRatePct,
          defaultAmortization: draft.amortizationYears,
          defaultLoanFeePct: draft.loanFeePct,
          defaultHoldPeriodYears: draft.holdPeriodYears,
          defaultExitCap: draft.exitCapPct,
          defaultExitClosingCostPct: draft.exitClosingCostPct,
          defaultRentUplift: draft.rentUpliftPct,
          defaultExpenseIncrease: draft.expenseIncreasePct,
          defaultManagementFee: draft.managementFeePct,
          defaultVacancyPct: draft.vacancyPct,
          defaultLeadTimeMonths: draft.leadTimeMonths,
          defaultAnnualRentGrowthPct: draft.annualRentGrowthPct,
          defaultAnnualCommercialRentGrowthPct: draft.annualCommercialRentGrowthPct,
          defaultAnnualOtherIncomeGrowthPct: draft.annualOtherIncomeGrowthPct,
          defaultAnnualExpenseGrowthPct: draft.annualExpenseGrowthPct,
          defaultAnnualPropertyTaxGrowthPct: draft.annualPropertyTaxGrowthPct,
          defaultRecurringCapexAnnual: draft.recurringCapexAnnual,
          defaultTargetIrrPct: draft.targetIrrPct,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to save");
      setProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateDossier = async () => {
    if (!propertyId) {
      setError("Open this page with a property (e.g. from Property Data: use the link with property_id).");
      return;
    }
    const startedAt = Date.now();
    setGenerating(true);
    setGenerationStartedAt(startedAt);
    setGenerationElapsedMs(0);
    setGenerationProgressPct(3);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/dossier/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          assumptions: {
            purchasePrice: draft.purchasePrice,
            purchaseClosingCostPct: draft.purchaseClosingCostPct,
            renovationCosts: draft.renovationCosts,
            furnishingSetupCosts: draft.furnishingSetupCosts,
            ltvPct: draft.ltvPct,
            interestRatePct: draft.interestRatePct,
            amortizationYears: draft.amortizationYears,
            loanFeePct: draft.loanFeePct,
            rentUpliftPct: draft.rentUpliftPct,
            expenseIncreasePct: draft.expenseIncreasePct,
            managementFeePct: draft.managementFeePct,
            vacancyPct: draft.vacancyPct,
            leadTimeMonths: draft.leadTimeMonths,
            annualRentGrowthPct: draft.annualRentGrowthPct,
            annualCommercialRentGrowthPct: draft.annualCommercialRentGrowthPct,
            annualOtherIncomeGrowthPct: draft.annualOtherIncomeGrowthPct,
            annualExpenseGrowthPct: draft.annualExpenseGrowthPct,
            annualPropertyTaxGrowthPct: draft.annualPropertyTaxGrowthPct,
            recurringCapexAnnual: draft.recurringCapexAnnual,
            holdPeriodYears: draft.holdPeriodYears,
            exitCapPct: draft.exitCapPct,
            exitClosingCostPct: draft.exitClosingCostPct,
            targetIrrPct: draft.targetIrrPct,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.details || data?.error || "Failed to generate");
      const params = new URLSearchParams({
        property_id: propertyId,
        dossier_id: data.dossierDoc?.id ?? "",
        excel_id: data.excelDoc?.id ?? "",
      });
      if (data.emailSent) params.set("email_sent", "1");
      if (data.dealScore != null && !Number.isNaN(data.dealScore)) params.set("deal_score", String(Math.round(data.dealScore)));
      setGenerationStartedAt(null);
      setGenerationElapsedMs(Date.now() - startedAt);
      setGenerationProgressPct(100);
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      window.location.href = `/dossier-success?${params.toString()}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate dossier");
      setGenerating(false);
      setGenerationStartedAt(null);
      setGenerationElapsedMs(0);
      setGenerationProgressPct(0);
    }
  };

  const handleGenerateStandardLeverage = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile/generate-standard-leverage`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to set");
      setProfile(data);
      setDraft((prev) => ({
        ...prev,
        ltvPct: 65,
        interestRatePct: 6.5,
        amortizationYears: 30,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set standard leverage");
    } finally {
      setSaving(false);
    }
  };

  const eligibleShare =
    mixSummary?.eligibleRevenueSharePct ??
    mixSummary?.eligibleUnitSharePct ??
    1;
  const blendedRentUpliftPct =
    draft.rentUpliftPct != null ? draft.rentUpliftPct * eligibleShare : null;
  const activeGenerationStepIndex = DOSSIER_GENERATION_STEPS.reduce(
    (activeIndex, step, index) => (generationProgressPct >= step.startPct ? index : activeIndex),
    0
  );
  const activeGenerationStepLabel =
    generationProgressPct >= 100 ? "Dossier ready" : DOSSIER_GENERATION_STEPS[activeGenerationStepIndex]?.label ?? "Preparing property inputs";
  const remainingDurationLabel =
    generationProgressPct >= 100
      ? "0:00"
      : generationElapsedMs >= DOSSIER_GENERATION_ESTIMATE_MS
        ? "Almost done"
        : formatDuration(DOSSIER_GENERATION_ESTIMATE_MS - generationElapsedMs, true);

  if (loading) {
    return (
      <div style={{ padding: "1.5rem" }}>
        <h1 className="page-title">Dossier assumptions</h1>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: "720px" }}>
      <h1 className="page-title">Dossier assumptions</h1>
      {propertyId && (
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
          Property: <code>{propertyId}</code>
          {property ? (
            <>
              {" — "}
              {property.canonicalAddress}
              {property.primaryListing?.price != null && (
                <> · {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(property.primaryListing.price)}</>
              )}
            </>
          ) : (
            <span style={{ color: "#b91c1c" }}> — Property not found</span>
          )}
        </p>
      )}
      {!propertyId && (
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
          Add <code>?property_id=...</code> to preload assumptions for a specific property, or use your profile defaults below.
        </p>
      )}
      {error && (
        <p style={{ color: "#b91c1c", marginBottom: "1rem" }}>{error}</p>
      )}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>Acquisition assumptions</h2>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.75rem" }}>
          These drive Year 0 capital required to buy and prepare the asset.
        </p>
        <div className="dossier-assumptions-grid">
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Purchase price</span>
            <input
              type="number"
              value={draft.purchasePrice ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, purchasePrice: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Purchase closing costs (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.purchaseClosingCostPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, purchaseClosingCostPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Renovation costs</span>
            <input
              type="number"
              value={draft.renovationCosts ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, renovationCosts: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Furnishing / setup costs</span>
            <input
              type="number"
              value={draft.furnishingSetupCosts ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, furnishingSetupCosts: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
            <span style={{ fontSize: "0.75rem", color: "#666" }}>
              Rough default uses eligible-unit count, bed/bath mix, and average eligible unit sqft from the rent roll or building square footage. It targets roughly $10k per unit around 500-1,500 sqft, $15k-$20k per unit above that, and $25k-$30k per unit above 2,500 sqft, but it should usually be overwritten with your actual furnishing quote.
            </span>
          </label>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>Offer / return target</h2>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.75rem" }}>
          The dossier will solve for the highest offer that still clears this target IRR.
        </p>
        <div className="dossier-assumptions-grid">
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Target IRR (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.targetIrrPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, targetIrrPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>Financing assumptions</h2>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.75rem" }}>
          These determine loan size, debt service, and remaining balance at exit.
        </p>
        <div className="dossier-assumptions-grid">
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>LTV (%)</span>
            <input
              type="number"
              value={draft.ltvPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, ltvPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Interest rate (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.interestRatePct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, interestRatePct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Amortization (years)</span>
            <input
              type="number"
              value={draft.amortizationYears ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, amortizationYears: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Loan fee / points (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.loanFeePct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, loanFeePct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>Operating assumptions</h2>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.75rem" }}>
          These drive stabilized gross rent, stabilized expenses, and NOI.
        </p>
        <div className="dossier-assumptions-grid">
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Rent uplift (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.rentUpliftPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, rentUpliftPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
            <span style={{ fontSize: "0.75rem", color: "#666" }}>
              Applied only to eligible residential units. Blended uplift for this deal: {blendedRentUpliftPct != null ? `${blendedRentUpliftPct.toFixed(2)}%` : "—"}.
            </span>
            {mixSummary && ((mixSummary.commercialUnits ?? 0) > 0 || (mixSummary.rentStabilizedUnits ?? 0) > 0) && (
              <span style={{ fontSize: "0.75rem", color: "#666" }}>
                {mixSummary.commercialUnits ?? 0} commercial and {mixSummary.rentStabilizedUnits ?? 0} rent-stabilized unit(s) are excluded from the uplift.
              </span>
            )}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Expense increase (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.expenseIncreasePct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, expenseIncreasePct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Management fee (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.managementFeePct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, managementFeePct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Vacancy (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.vacancyPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, vacancyPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Lead time (months)</span>
            <input
              type="number"
              min={0}
              max={12}
              value={draft.leadTimeMonths ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, leadTimeMonths: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual FM rent growth (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.annualRentGrowthPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, annualRentGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual commercial rent growth (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.annualCommercialRentGrowthPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, annualCommercialRentGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual other-income growth (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.annualOtherIncomeGrowthPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, annualOtherIncomeGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual expense growth (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.annualExpenseGrowthPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, annualExpenseGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual property-tax growth (%)</span>
            <span style={{ fontSize: "0.75rem", color: "#666" }}>
              Auto-filled from NYC tax class caps when available. Larger Class 2 and Class 4 default to the conservative top-of-range `20%` phase-in.
            </span>
            <input
              type="number"
              step="0.1"
              value={draft.annualPropertyTaxGrowthPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, annualPropertyTaxGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Recurring CapEx / reserve</span>
            <input
              type="number"
              step="1"
              value={draft.recurringCapexAnnual ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, recurringCapexAnnual: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>Hold period assumptions</h2>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.75rem" }}>
          The model will generate Years 1 through N operating cash flows and sell in the final year. Maximum supported hold period: 10 years.
        </p>
        <div className="dossier-assumptions-grid">
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Hold period (years)</span>
            <input
              type="number"
              min={1}
              max={10}
              value={draft.holdPeriodYears ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, holdPeriodYears: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>Exit / sale assumptions</h2>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.75rem" }}>
          These determine terminal value, sale friction, and net proceeds to equity.
        </p>
        <div className="dossier-assumptions-grid">
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Exit cap rate (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.exitCapPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, exitCapPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Exit closing costs (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.exitClosingCostPct ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, exitClosingCostPct: e.target.value ? Number(e.target.value) : undefined }))}
              style={inputStyle}
            />
          </label>
        </div>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.5rem" }}>
        <button
          type="button"
          onClick={handleSaveAssumptions}
          disabled={saving || generating}
          style={{
            padding: "0.5rem 1rem",
            background: "#0066cc",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: saving || generating ? "wait" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save to profile"}
        </button>
        <button
          type="button"
          onClick={handleGenerateStandardLeverage}
          disabled={saving || generating}
          style={{
            padding: "0.5rem 1rem",
            background: "#f0f0f0",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: "4px",
            cursor: saving || generating ? "wait" : "pointer",
          }}
        >
          Generate standard leverage
        </button>
        <span style={{ alignSelf: "center", color: "#666", fontSize: "0.875rem" }}>
          Saves reusable defaults only. Renovation and furnishing costs remain deal-specific.
        </span>
      </div>

      <div className="dossier-generate-panel">
        <p style={{ fontSize: "0.875rem", color: "#4b5563", marginBottom: generating ? "1rem" : "0.75rem" }}>
          Generate deal dossier (text + Excel) and save to property documents. Requires a property in the URL.
        </p>
        {generating ? (
          <div className="dossier-progress-shell" aria-live="polite">
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
            <div className="dossier-progress-steps">
              {DOSSIER_GENERATION_STEPS.map((step, index) => {
                const isComplete = generationProgressPct >= 100 || index < activeGenerationStepIndex;
                const isActive = generationProgressPct < 100 && index === activeGenerationStepIndex;
                return (
                  <span
                    key={step.label}
                    className={`dossier-progress-pill${isComplete ? " dossier-progress-pill--complete" : ""}${isActive ? " dossier-progress-pill--active" : ""}`}
                  >
                    {step.label}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="dossier-generate-note">
            Typical generation takes about 1-2 minutes. Progress is estimated from the current pipeline until the backend exposes live job events.
          </p>
        )}
        <button
          type="button"
          disabled={!propertyId || generating}
          onClick={handleGenerateDossier}
          className="dossier-generate-button"
          style={{
            padding: "0.5rem 1rem",
            background: propertyId && !generating ? "#0066cc" : "#ccc",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: propertyId && !generating ? "pointer" : "not-allowed",
          }}
        >
          {generating ? `Generating… ${generationProgressPct}%` : "Generate dossier"}
        </button>
      </div>

      <p style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/profile">Edit profile &amp; defaults</Link>
        {propertyId && (
          <>
            {" · "}
            <Link href={`/property-data?expand=${propertyId}`}>View property</Link>
          </>
        )}
      </p>
    </div>
  );
}

export default function DossierAssumptionsPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: "1.5rem" }}>
        <h1 className="page-title">Dossier assumptions</h1>
        <p>Loading…</p>
      </div>
    }>
      <DossierAssumptionsContent />
    </Suspense>
  );
}
