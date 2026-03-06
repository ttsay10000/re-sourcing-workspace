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
  defaultLtv?: number | null;
  defaultInterestRate?: number | null;
  defaultAmortization?: number | null;
  defaultExitCap?: number | null;
  defaultRentUplift?: number | null;
  defaultExpenseIncrease?: number | null;
  defaultManagementFee?: number | null;
}

interface PropertySummary {
  id: string;
  canonicalAddress: string;
  primaryListing: { price: number | null; city: string | null } | null;
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
  const [draft, setDraft] = useState<Partial<AssumptionsProfile>>({});

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
      const p = data.profile ?? {};
      setDraft({
        defaultLtv: p.defaultLtv ?? undefined,
        defaultInterestRate: p.defaultInterestRate ?? undefined,
        defaultAmortization: p.defaultAmortization ?? undefined,
        defaultExitCap: p.defaultExitCap ?? undefined,
        defaultRentUplift: p.defaultRentUplift ?? undefined,
        defaultExpenseIncrease: p.defaultExpenseIncrease ?? undefined,
        defaultManagementFee: p.defaultManagementFee ?? undefined,
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

  const handleSaveAssumptions = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultLtv: draft.defaultLtv,
          defaultInterestRate: draft.defaultInterestRate,
          defaultAmortization: draft.defaultAmortization,
          defaultExitCap: draft.defaultExitCap,
          defaultRentUplift: draft.defaultRentUplift,
          defaultExpenseIncrease: draft.defaultExpenseIncrease,
          defaultManagementFee: draft.defaultManagementFee,
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
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/dossier/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to generate");
      const params = new URLSearchParams({
        property_id: propertyId,
        dossier_id: data.dossierDoc?.id ?? "",
        excel_id: data.excelDoc?.id ?? "",
      });
      if (data.emailSent) params.set("email_sent", "1");
      window.location.href = `/dossier-success?${params.toString()}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate dossier");
    } finally {
      setGenerating(false);
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

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Rent &amp; expenses</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Rent uplift (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.defaultRentUplift ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, defaultRentUplift: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Expense increase (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.defaultExpenseIncrease ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, defaultExpenseIncrease: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Management fee (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.defaultManagementFee ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, defaultManagementFee: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Mortgage</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>LTV (%)</span>
            <input
              type="number"
              value={draft.defaultLtv ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, defaultLtv: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Interest rate (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.defaultInterestRate ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, defaultInterestRate: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Amortization (years)</span>
            <input
              type="number"
              value={draft.defaultAmortization ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, defaultAmortization: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Exit cap (%)</span>
            <input
              type="number"
              step="0.1"
              value={draft.defaultExitCap ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, defaultExitCap: e.target.value ? Number(e.target.value) : undefined }))}
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
            />
          </label>
        </div>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.5rem" }}>
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
          }}
        >
          {saving ? "Saving…" : "Save to profile"}
        </button>
        <button
          type="button"
          onClick={handleGenerateStandardLeverage}
          disabled={saving}
          style={{
            padding: "0.5rem 1rem",
            background: "#f0f0f0",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: "4px",
            cursor: saving ? "wait" : "pointer",
          }}
        >
          Generate standard leverage
        </button>
        <span style={{ alignSelf: "center", color: "#666", fontSize: "0.875rem" }}>
          (65% LTV, 6.5% rate, 30-year amortization)
        </span>
      </div>

      <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid #e5e5e5" }}>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
          Generate deal dossier (text + Excel) and save to property documents. Requires a property in the URL.
        </p>
        <button
          type="button"
          disabled={!propertyId || generating}
          onClick={handleGenerateDossier}
          style={{
            padding: "0.5rem 1rem",
            background: propertyId && !generating ? "#0066cc" : "#ccc",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: propertyId && !generating ? "pointer" : "not-allowed",
          }}
        >
          {generating ? "Generating…" : "Generate dossier"}
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
