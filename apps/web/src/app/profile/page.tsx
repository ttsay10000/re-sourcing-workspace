"use client";

import React, { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface UserProfile {
  id: string;
  name?: string | null;
  email?: string | null;
  organization?: string | null;
  defaultLtv?: number | null;
  defaultInterestRate?: number | null;
  defaultAmortization?: number | null;
  defaultExitCap?: number | null;
  defaultRentUplift?: number | null;
  defaultExpenseIncrease?: number | null;
  defaultManagementFee?: number | null;
  expectedAppreciationPct?: number | null;
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
        defaultLtv: data.defaultLtv ?? undefined,
        defaultInterestRate: data.defaultInterestRate ?? undefined,
        defaultAmortization: data.defaultAmortization ?? undefined,
        defaultExitCap: data.defaultExitCap ?? undefined,
        defaultRentUplift: data.defaultRentUplift ?? undefined,
        defaultExpenseIncrease: data.defaultExpenseIncrease ?? undefined,
        defaultManagementFee: data.defaultManagementFee ?? undefined,
        expectedAppreciationPct: data.expectedAppreciationPct ?? undefined,
      });
    } catch (e) {
      // #region agent log
      fetch("http://127.0.0.1:7590/ingest/742bd78a-5157-440b-b6aa-e9509cd8e861",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"fd8b77"},body:JSON.stringify({sessionId:"fd8b77",location:"profile/page.tsx:fetchProfile-catch",message:"Profile fetch failed",data:{message:e instanceof Error?e.message:String(e)},timestamp:Date.now(),hypothesisId:"H3"})}).catch(()=>{});
      // #endregion
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
          defaultLtv: draft.defaultLtv ?? profile.defaultLtv,
          defaultInterestRate: draft.defaultInterestRate ?? profile.defaultInterestRate,
          defaultAmortization: draft.defaultAmortization ?? profile.defaultAmortization,
          defaultExitCap: draft.defaultExitCap ?? profile.defaultExitCap,
          defaultRentUplift: draft.defaultRentUplift ?? profile.defaultRentUplift,
          defaultExpenseIncrease: draft.defaultExpenseIncrease ?? profile.defaultExpenseIncrease,
          defaultManagementFee: draft.defaultManagementFee ?? profile.defaultManagementFee,
          expectedAppreciationPct: draft.expectedAppreciationPct ?? profile.expectedAppreciationPct,
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
    <div className="profile-page" style={{ padding: "1.5rem", maxWidth: "640px" }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
            Default assumptions for dossier and underwriting. Used when generating deal dossiers.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
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
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Expected appreciation (%/yr)</span>
              <input
                type="number"
                step="0.1"
                value={draft.expectedAppreciationPct ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, expectedAppreciationPct: e.target.value ? Number(e.target.value) : undefined }))}
                style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                placeholder="e.g. 3"
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
        <div>
          <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
            Deals you saved from the Property Data table. Download dossier after generating from the property page.
          </p>
          {savedDealsLoading ? (
            <p>Loading saved deals…</p>
          ) : savedDeals.length === 0 ? (
            <p style={{ color: "#737373" }}>No saved deals. Use the star on a property in Property Data to save.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e5e5", textAlign: "left" }}>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Address</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Price</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Units</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Deal score</th>
                    <th style={{ padding: "0.5rem 0.75rem" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {savedDeals.map((row) => (
                    <tr key={row.savedDeal.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "0.5rem 0.75rem" }}>{row.address || "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>{row.price != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(row.price) : "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>{row.units != null ? String(row.units) : "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>{row.dealScore != null ? String(Math.round(row.dealScore)) : "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <a href={`/property-data?expand=${row.savedDeal.propertyId}`} style={{ color: "#0066cc" }}>View property</a>
                        <span style={{ color: "#999" }}>|</span>
                        <a href={`/property-data?expand=${row.savedDeal.propertyId}#documents`} style={{ color: "#0066cc" }}>Download dossier</a>
                        <span style={{ color: "#999" }}>|</span>
                        <button type="button" onClick={() => handleUnsave(row.savedDeal.propertyId)} style={{ background: "none", border: "none", color: "#0066cc", cursor: "pointer", padding: 0, textDecoration: "underline" }}>Unsave</button>
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
