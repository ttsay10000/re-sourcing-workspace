"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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

type ProfileTab = "profile" | "assumptions" | "saved-deals";

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("profile");
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
    if (activeTab === "saved-deals") fetchSavedDeals();
  }, [activeTab, fetchSavedDeals]);

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
    <div className="profile-page" style={{ padding: "1.5rem", maxWidth: "960px" }}>
      <h1 className="page-title">Profile</h1>
      {error && (
        <p style={{ color: "#b91c1c", marginBottom: "1rem" }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid #e5e5e5" }}>
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          style={{
            padding: "0.5rem 1rem",
            border: "none",
            borderBottom: activeTab === "profile" ? "2px solid #0066cc" : "2px solid transparent",
            background: "none",
            cursor: "pointer",
            fontWeight: activeTab === "profile" ? 600 : 400,
          }}
        >
          Profile
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("assumptions")}
          style={{
            padding: "0.5rem 1rem",
            border: "none",
            borderBottom: activeTab === "assumptions" ? "2px solid #0066cc" : "2px solid transparent",
            background: "none",
            cursor: "pointer",
            fontWeight: activeTab === "assumptions" ? 600 : 400,
          }}
        >
          Assumptions
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("saved-deals")}
          style={{
            padding: "0.5rem 1rem",
            border: "none",
            borderBottom: activeTab === "saved-deals" ? "2px solid #0066cc" : "2px solid transparent",
            background: "none",
            cursor: "pointer",
            fontWeight: activeTab === "saved-deals" ? 600 : 400,
          }}
        >
          Saved deals
        </button>
      </div>

      {activeTab === "profile" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "640px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Name</span>
            <input
              type="text"
              value={draft.name ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Email</span>
            <input
              type="email"
              value={draft.email ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Organization</span>
            <input
              type="text"
              value={draft.organization ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, organization: e.target.value }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={saving}
            style={{
              padding: "0.5rem 1rem",
              background: "#0066cc",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: saving ? "wait" : "pointer",
              alignSelf: "flex-start",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {activeTab === "assumptions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "640px" }}>
          <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
            Default reusable assumptions for dossier underwriting. Deal-specific purchase price, renovation, and furnishing costs are set on the dossier page.
          </p>
          <p style={{ fontSize: "0.875rem", color: "#666", marginTop: "-0.5rem" }}>
            Property-tax growth is auto-derived from NYC tax class when the property has a tax code. The profile value below is the fallback for missing or unrecognized tax classes.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default purchase closing costs (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultPurchaseClosingCostPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultPurchaseClosingCostPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default LTV (%)</span>
              <input
                type="number"
                value={draft.defaultLtv ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultLtv: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default interest rate (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultInterestRate ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultInterestRate: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default amortization (years)</span>
              <input
                type="number"
                value={draft.defaultAmortization ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultAmortization: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default loan fee (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultLoanFeePct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultLoanFeePct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default hold period (years)</span>
              <input
                type="number"
                min={1}
                max={10}
                value={draft.defaultHoldPeriodYears ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultHoldPeriodYears: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default exit cap (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultExitCap ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultExitCap: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default exit closing costs (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultExitClosingCostPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultExitClosingCostPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default rent uplift (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultRentUplift ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultRentUplift: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default expense increase (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultExpenseIncrease ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultExpenseIncrease: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default management fee (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultManagementFee ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultManagementFee: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default vacancy (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultVacancyPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultVacancyPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default lead time (months)</span>
              <input
                type="number"
                value={draft.defaultLeadTimeMonths ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultLeadTimeMonths: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual rent growth (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultAnnualRentGrowthPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultAnnualRentGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual other income growth (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultAnnualOtherIncomeGrowthPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultAnnualOtherIncomeGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Annual expense growth (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultAnnualExpenseGrowthPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultAnnualExpenseGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Fallback annual property tax growth (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultAnnualPropertyTaxGrowthPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultAnnualPropertyTaxGrowthPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Recurring CapEx reserve</span>
              <input
                type="number"
                step="100"
                value={draft.defaultRecurringCapexAnnual ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultRecurringCapexAnnual: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Default target IRR (%)</span>
              <input
                type="number"
                step="0.1"
                value={draft.defaultTargetIrrPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, defaultTargetIrrPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleGenerateStandardLeverage}
              disabled={saving}
              style={{
                padding: "0.5rem 1rem",
                background: "#0d9488",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: saving ? "wait" : "pointer",
              }}
            >
              Generate Standard Leverage
            </button>
            <span style={{ fontSize: "0.8rem", color: "#666", alignSelf: "center" }}>LTV 65%, Interest 6.5%, Amortization 30</span>
          </div>
          <button
            type="button"
            onClick={handleSaveAssumptions}
            disabled={saving}
            style={{
              padding: "0.5rem 1rem",
              background: "#0066cc",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: saving ? "wait" : "pointer",
              alignSelf: "flex-start",
            }}
          >
            {saving ? "Saving…" : "Save assumptions"}
          </button>
        </div>
      )}

      {activeTab === "saved-deals" && (
        <div className="profile-saved-deals-section">
          <p className="profile-saved-deals-intro">
            Deals you saved from the Property Data table. Download dossier after generating from the property page.
          </p>
          {savedDealsLoading ? (
            <p>Loading saved deals…</p>
          ) : savedDeals.length === 0 ? (
            <p style={{ color: "#737373" }}>No saved deals. Use the star on a property in Property Data to save.</p>
          ) : (
            <div className="profile-saved-deals-table-wrap">
              <table className="profile-saved-deals-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th className="profile-saved-deals-table__numeric">Price</th>
                    <th className="profile-saved-deals-table__numeric">Units</th>
                    <th className="profile-saved-deals-table__numeric">Deal score</th>
                    <th className="profile-saved-deals-table__actions-cell">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {savedDeals.map((row) => (
                    <tr key={row.savedDeal.id}>
                      <td className="profile-saved-deals-table__address">{row.address || "—"}</td>
                      <td className="profile-saved-deals-table__numeric">{row.price != null ? currencyFormatter.format(row.price) : "—"}</td>
                      <td className="profile-saved-deals-table__numeric">{row.units != null ? String(row.units) : "—"}</td>
                      <td className="profile-saved-deals-table__numeric">
                        {row.dealScore != null ? <span className="profile-saved-deals-score">{Math.round(row.dealScore)}</span> : "—"}
                      </td>
                      <td className="profile-saved-deals-table__actions-cell">
                        <div className="profile-saved-deals-actions">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
