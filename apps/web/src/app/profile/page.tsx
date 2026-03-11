"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
type ProfileFieldKey = "name" | "email" | "organization";
type AssumptionFieldKey =
  | "defaultPurchaseClosingCostPct"
  | "defaultLtv"
  | "defaultInterestRate"
  | "defaultAmortization"
  | "defaultLoanFeePct"
  | "defaultHoldPeriodYears"
  | "defaultExitCap"
  | "defaultExitClosingCostPct"
  | "defaultRentUplift"
  | "defaultExpenseIncrease"
  | "defaultManagementFee"
  | "defaultVacancyPct"
  | "defaultLeadTimeMonths"
  | "defaultAnnualRentGrowthPct"
  | "defaultAnnualOtherIncomeGrowthPct"
  | "defaultAnnualExpenseGrowthPct"
  | "defaultAnnualPropertyTaxGrowthPct"
  | "defaultRecurringCapexAnnual"
  | "defaultTargetIrrPct";

interface AssumptionFieldDefinition {
  key: AssumptionFieldKey;
  label: string;
  step?: string;
  min?: number;
  max?: number;
}

const profileFields: Array<{ key: ProfileFieldKey; label: string; type: "text" | "email" }> = [
  { key: "name", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "organization", label: "Organization", type: "text" },
] as const;
const assumptionSections: Array<{
  title: string;
  description: string;
  fields: AssumptionFieldDefinition[];
}> = [
  {
    title: "Financing",
    description: "Debt structure defaults used to seed new analyses.",
    fields: [
      { key: "defaultPurchaseClosingCostPct", label: "Purchase closing costs (%)", step: "0.1" },
      { key: "defaultLtv", label: "LTV (%)" },
      { key: "defaultInterestRate", label: "Interest rate (%)", step: "0.1" },
      { key: "defaultAmortization", label: "Amortization (years)" },
      { key: "defaultLoanFeePct", label: "Loan fee (%)", step: "0.1" },
    ],
  },
  {
    title: "Operations",
    description: "Income lift and operating drag assumptions before long-term growth.",
    fields: [
      { key: "defaultRentUplift", label: "Rent uplift (%)", step: "0.1" },
      { key: "defaultExpenseIncrease", label: "Expense increase (%)", step: "0.1" },
      { key: "defaultManagementFee", label: "Management fee (%)", step: "0.1" },
      { key: "defaultVacancyPct", label: "Vacancy (%)", step: "0.1" },
      { key: "defaultLeadTimeMonths", label: "Lead time (months)" },
    ],
  },
  {
    title: "Growth and reserves",
    description: "Annual escalators and recurring reserve assumptions.",
    fields: [
      { key: "defaultAnnualRentGrowthPct", label: "Annual rent growth (%)", step: "0.1" },
      { key: "defaultAnnualOtherIncomeGrowthPct", label: "Annual other income growth (%)", step: "0.1" },
      { key: "defaultAnnualExpenseGrowthPct", label: "Annual expense growth (%)", step: "0.1" },
      { key: "defaultAnnualPropertyTaxGrowthPct", label: "Fallback annual property tax growth (%)", step: "0.1" },
      { key: "defaultRecurringCapexAnnual", label: "Recurring CapEx reserve", step: "100" },
    ],
  },
  {
    title: "Disposition",
    description: "Return targets and terminal assumptions for exit underwriting.",
    fields: [
      { key: "defaultHoldPeriodYears", label: "Hold period (years)", min: 1, max: 10 },
      { key: "defaultExitCap", label: "Exit cap (%)", step: "0.1" },
      { key: "defaultExitClosingCostPct", label: "Exit closing costs (%)", step: "0.1" },
      { key: "defaultTargetIrrPct", label: "Target IRR (%)", step: "0.1" },
    ],
  },
] as const;

interface UserProfile {
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
  defaultAnnualOtherIncomeGrowthPct?: number | null;
  defaultAnnualExpenseGrowthPct?: number | null;
  defaultAnnualPropertyTaxGrowthPct?: number | null;
  defaultRecurringCapexAnnual?: number | null;
  defaultLoanFeePct?: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<UserProfile>>({});
  const [savedDeals, setSavedDeals] = useState<Array<{ savedDeal: { id: string; propertyId: string; dealStatus: string; createdAt: string }; address: string; price: number | null; units: number | null; dealScore: number | null }>>([]);
  const [savedDealsLoading, setSavedDealsLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load profile");
      setProfile(data);
      setDraft({
        name: data.name ?? "",
        email: data.email ?? "",
        organization: data.organization ?? "",
        defaultPurchaseClosingCostPct: data.defaultPurchaseClosingCostPct ?? 3,
        defaultLtv: data.defaultLtv ?? 64,
        defaultInterestRate: data.defaultInterestRate ?? 6,
        defaultAmortization: data.defaultAmortization ?? 30,
        defaultHoldPeriodYears: data.defaultHoldPeriodYears ?? 2,
        defaultExitCap: data.defaultExitCap ?? 5,
        defaultExitClosingCostPct: data.defaultExitClosingCostPct ?? 6,
        defaultRentUplift: data.defaultRentUplift ?? 76.3,
        defaultExpenseIncrease: data.defaultExpenseIncrease ?? 0,
        defaultManagementFee: data.defaultManagementFee ?? 8,
        defaultTargetIrrPct: data.defaultTargetIrrPct ?? 25,
        defaultVacancyPct: data.defaultVacancyPct ?? 15,
        defaultLeadTimeMonths: data.defaultLeadTimeMonths ?? 2,
        defaultAnnualRentGrowthPct: data.defaultAnnualRentGrowthPct ?? 1,
        defaultAnnualOtherIncomeGrowthPct: data.defaultAnnualOtherIncomeGrowthPct ?? 0,
        defaultAnnualExpenseGrowthPct: data.defaultAnnualExpenseGrowthPct ?? 0,
        defaultAnnualPropertyTaxGrowthPct: data.defaultAnnualPropertyTaxGrowthPct ?? 6,
        defaultRecurringCapexAnnual: data.defaultRecurringCapexAnnual ?? 1200,
        defaultLoanFeePct: data.defaultLoanFeePct ?? 0.63,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name ?? profile.name,
          email: draft.email ?? profile.email,
          organization: draft.organization ?? profile.organization,
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

  const handleSaveAssumptions = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultPurchaseClosingCostPct: draft.defaultPurchaseClosingCostPct ?? profile.defaultPurchaseClosingCostPct,
          defaultLtv: draft.defaultLtv ?? profile.defaultLtv,
          defaultInterestRate: draft.defaultInterestRate ?? profile.defaultInterestRate,
          defaultAmortization: draft.defaultAmortization ?? profile.defaultAmortization,
          defaultHoldPeriodYears: draft.defaultHoldPeriodYears ?? profile.defaultHoldPeriodYears,
          defaultExitCap: draft.defaultExitCap ?? profile.defaultExitCap,
          defaultExitClosingCostPct: draft.defaultExitClosingCostPct ?? profile.defaultExitClosingCostPct,
          defaultRentUplift: draft.defaultRentUplift ?? profile.defaultRentUplift,
          defaultExpenseIncrease: draft.defaultExpenseIncrease ?? profile.defaultExpenseIncrease,
          defaultManagementFee: draft.defaultManagementFee ?? profile.defaultManagementFee,
          defaultTargetIrrPct: draft.defaultTargetIrrPct ?? profile.defaultTargetIrrPct,
          defaultVacancyPct: draft.defaultVacancyPct ?? profile.defaultVacancyPct,
          defaultLeadTimeMonths: draft.defaultLeadTimeMonths ?? profile.defaultLeadTimeMonths,
          defaultAnnualRentGrowthPct:
            draft.defaultAnnualRentGrowthPct ?? profile.defaultAnnualRentGrowthPct,
          defaultAnnualOtherIncomeGrowthPct:
            draft.defaultAnnualOtherIncomeGrowthPct ?? profile.defaultAnnualOtherIncomeGrowthPct,
          defaultAnnualExpenseGrowthPct:
            draft.defaultAnnualExpenseGrowthPct ?? profile.defaultAnnualExpenseGrowthPct,
          defaultAnnualPropertyTaxGrowthPct:
            draft.defaultAnnualPropertyTaxGrowthPct ?? profile.defaultAnnualPropertyTaxGrowthPct,
          defaultRecurringCapexAnnual:
            draft.defaultRecurringCapexAnnual ?? profile.defaultRecurringCapexAnnual,
          defaultLoanFeePct: draft.defaultLoanFeePct ?? profile.defaultLoanFeePct,
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

  const fetchSavedDeals = useCallback(async () => {
    setSavedDealsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/profile/saved-deals`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load");
      setSavedDeals(data.savedDeals ?? []);
    } catch {
      setSavedDeals([]);
    } finally {
      setSavedDealsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSavedDeals();
  }, [fetchSavedDeals]);

  const handleUnsave = async (propertyId: string) => {
    try {
      await fetch(`${API_BASE}/api/profile/saved-deals/${encodeURIComponent(propertyId)}`, { method: "DELETE" });
      setSavedDeals((prev) => prev.filter((r) => r.savedDeal.propertyId !== propertyId));
    } catch {
      // ignore
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
        defaultLtv: 65,
        defaultInterestRate: 6.5,
        defaultAmortization: 30,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set standard leverage");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-page" style={{ padding: "1.5rem" }}>
        <h1 className="page-title">Profile</h1>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="profile-page profile-page--holistic">
      <header className="profile-page-header">
        <div>
          <p className="profile-page-kicker">Profile workspace</p>
          <h1 className="page-title profile-page-title">Profile</h1>
          <p className="profile-page-intro">
            Keep underwriting defaults tidy here so deal-specific inputs only need lightweight edits downstream.
          </p>
        </div>
        <div className="profile-page-summary">
          <div className="profile-page-summary-item">
            <span>Account fields</span>
            <strong>{profileFields.length}</strong>
          </div>
          <div className="profile-page-summary-item">
            <span>Assumptions</span>
            <strong>{assumptionSections.reduce((total, section) => total + section.fields.length, 0)}</strong>
          </div>
        </div>
      </header>
      {error && <p className="profile-page-error">{error}</p>}

      <section className="profile-section profile-identity-section">
        <div className="profile-section-heading">
          <div>
            <h2>Account</h2>
            <p>Core profile details used across sourcing, underwriting, and dossier workflows.</p>
          </div>
          <button type="button" onClick={handleSaveProfile} disabled={saving} className="profile-primary-button">
            {saving ? "Saving…" : "Save account"}
          </button>
        </div>
        <div className="profile-form-grid profile-form-grid--compact">
          {profileFields.map((field) => (
            <label key={field.key} className="profile-field">
              <span>{field.label}</span>
              <input
                type={field.type}
                value={draft[field.key] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="profile-input"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="profile-section">
        <div className="profile-section-heading">
          <div>
            <h2>Underwriting assumptions</h2>
            <p>Reusable defaults for dossier underwriting. Deal-specific purchase, renovation, and furnishing costs still live on the property dossier flow.</p>
          </div>
          <button type="button" onClick={handleSaveAssumptions} disabled={saving} className="profile-primary-button">
            {saving ? "Saving…" : "Save assumptions"}
          </button>
        </div>
        <p className="profile-section-note profile-section-note--callout">
          Property-tax growth is auto-derived from NYC tax class when available. The fallback field below is only used when the property tax class is missing or not recognized.
        </p>
        <div className="profile-assumption-groups">
          {assumptionSections.map((section) => (
            <section key={section.title} className="profile-assumption-group">
              <div className="profile-assumption-group-header">
                <h3>{section.title}</h3>
                <p>{section.description}</p>
              </div>
              <div className="profile-form-grid profile-form-grid--grouped">
                {section.fields.map((field) => (
                  <label key={field.key} className="profile-field">
                    <span>{field.label}</span>
                    <input
                      type="number"
                      step={"step" in field ? field.step : undefined}
                      min={"min" in field ? field.min : undefined}
                      max={"max" in field ? field.max : undefined}
                      value={draft[field.key] ?? ""}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [field.key]: e.target.value ? Number(e.target.value) : undefined,
                        }))
                      }
                      className="profile-input"
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="profile-assumptions-toolbar">
          <button
            type="button"
            onClick={handleGenerateStandardLeverage}
            disabled={saving}
            className="profile-secondary-button"
          >
            Generate standard leverage
          </button>
          <span>LTV 65%, interest 6.5%, amortization 30 years.</span>
        </div>
      </section>

      <section className="profile-section profile-saved-deals-section">
        <div className="profile-section-heading">
          <div>
            <h2>Saved deals</h2>
            <p className="profile-saved-deals-intro">
              Deals you saved from Property Data. Dossier download still routes through the property view after generation.
            </p>
          </div>
        </div>
        {savedDealsLoading ? (
          <p>Loading saved deals…</p>
        ) : savedDeals.length === 0 ? (
          <p style={{ color: "#737373" }}>No saved deals. Use the star on a property in Property Data to save.</p>
        ) : (
          <div className="profile-saved-deals-grid">
            {savedDeals.map((row) => (
              <article key={row.savedDeal.id} className="profile-saved-deal-card">
                <div className="profile-saved-deal-main">
                  <h3 className="profile-saved-deal-address">{row.address || "—"}</h3>
                  <div className="profile-saved-deal-stats">
                    <div className="profile-saved-deal-stat">
                      <span>Price</span>
                      <strong>{row.price != null ? currencyFormatter.format(row.price) : "—"}</strong>
                    </div>
                    <div className="profile-saved-deal-stat">
                      <span>Units</span>
                      <strong>{row.units != null ? String(row.units) : "—"}</strong>
                    </div>
                    <div className="profile-saved-deal-stat">
                      <span>Deal score</span>
                      <strong>{row.dealScore != null ? <span className="profile-saved-deals-score">{Math.round(row.dealScore)}</span> : "—"}</strong>
                    </div>
                  </div>
                </div>
                <div className="profile-saved-deals-actions profile-saved-deals-actions--row">
                  <Link href={`/property-data?expand=${row.savedDeal.propertyId}`} className="profile-saved-deals-action">
                    View property
                  </Link>
                  <Link href={`/property-data?expand=${row.savedDeal.propertyId}#documents`} className="profile-saved-deals-action">
                    Download dossier
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleUnsave(row.savedDeal.propertyId)}
                    className="profile-saved-deals-action profile-saved-deals-action--danger"
                  >
                    Unsave
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
