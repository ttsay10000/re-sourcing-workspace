"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const MAX_SELECT = 10;

type DealRow = {
  id: string;
  address: string;
  price: number | null;
  imageUrl: string | null;
  totalUnits: number | null;
  dealScore: number | null;
  assetCapRate: number | null;
  adjustedCapRate: number | null;
  rentUpside: number | null;
  irrPct: number | null;
  equityMultiple: number | null;
  cocPct: number | null;
  holdYears: number | null;
  currentNoi: number | null;
  adjustedNoi: number | null;
  generatedAt: string | null;
};

function getScoreBubbleClass(score: number): string {
  if (score >= 80) return "property-card-score-bubble--green";
  if (score >= 65) return "property-card-score-bubble--yellow";
  return "property-card-score-bubble--red";
}

function getDealStatusTag(score: number): string {
  if (score >= 80) return "Strong Buy";
  if (score >= 70) return "Attractive";
  if (score >= 60) return "Neutral";
  return "Weak";
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/** Values already in percentage points (e.g. 5.5 for 5.5%) — do not multiply by 100. */
function formatPctPoints(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Number(n).toFixed(2)}%`;
}

/** IRR and CoC are stored as decimals (e.g. 0.12 for 12%). */
function formatPctDecimal(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(Number(n) * 100).toFixed(2)}%`;
}

export default function HomePage() {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [sort, setSort] = useState<"deal_score" | "adjusted_cap_rate" | "asset_cap_rate" | "rent_upside" | "price">("deal_score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dossiersGenerated, setDossiersGenerated] = useState(false);

  const fetchDeals = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ sort, order: order, limit: "50" });
    fetch(`${API_BASE}/api/deals?${params}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data.error || data.details || `HTTP ${r.status}`) as string);
        setDeals(data.deals ?? []);
        setTotal(Number(data.total) ?? 0);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load deals");
        setDeals([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [sort, order]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  useEffect(() => {
    if (deals.length === 0) return;
    const ids = deals.map((d) => d.id).join(",");
    fetch(`${API_BASE}/api/profile/saved-deals/check?propertyIds=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.saved === "object")
          setSavedIds(new Set(Object.keys(data.saved).filter((id: string) => Boolean(data.saved[id]))));
      })
      .catch(() => {});
  }, [deals]);

  const toggleSaved = (propertyId: string) => {
    const isSaved = savedIds.has(propertyId);
    setSavingId(propertyId);
    if (isSaved) {
      fetch(`${API_BASE}/api/profile/saved-deals/${encodeURIComponent(propertyId)}`, { method: "DELETE" })
        .then((r) => r.json())
        .then(() => {
          setSavedIds((prev) => {
            const next = new Set(prev);
            next.delete(propertyId);
            return next;
          });
        })
        .finally(() => setSavingId(null));
    } else {
      fetch(`${API_BASE}/api/profile/saved-deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      })
        .then((r) => r.json())
        .then(() => {
          setSavedIds((prev) => new Set(prev).add(propertyId));
        })
        .finally(() => setSavingId(null));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECT) next.add(id);
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const selectedDeals = deals.filter((d) => selectedIds.has(d.id));
  const withScore = deals.filter((d) => d.dealScore != null);
  const avgScore = withScore.length > 0
    ? withScore.reduce((s, d) => s + (d.dealScore ?? 0), 0) / withScore.length
    : null;
  const countAbove90 = deals.filter((d) => (d.dealScore ?? 0) >= 90).length;

  return (
    <div className="home-layout">
      {/* Metrics row */}
      <section className="home-metrics">
        <div className="metric-card">
          <div className="metric-label">New Listings Today</div>
          <div className="metric-value">—</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Successfully Deduped %</div>
          <div className="metric-value">—</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Enrichment Coverage %</div>
          <div className="metric-value">—</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg Deal Score</div>
          <div className="metric-value">{avgScore != null && !Number.isNaN(avgScore) ? avgScore.toFixed(1) : "—"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Number of Deals Above 90</div>
          <div className="metric-value">{countAbove90}</div>
        </div>
      </section>

      <div className="home-content">
        <section className="home-main">
          <div className="home-section-header" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
            <h2 className="home-section-title">Top Ranked Deals</h2>
            <Link href="/property-data" className="btn-card" style={{ fontSize: "0.85rem", padding: "0.4rem 0.75rem" }}>
              Add new deals
            </Link>
            <span style={{ fontSize: "0.85rem", color: "#737373" }}>
              Add listings in Property Data, then generate a dossier to see scored deals here.
            </span>
          </div>

          <div className="home-cards-sort" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "#525252" }}>Sort by</label>
            <select
              className="input-text"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              style={{ width: "auto", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
            >
              <option value="deal_score">Deal Score</option>
              <option value="adjusted_cap_rate">Adjusted Cap Rate</option>
              <option value="asset_cap_rate">Asset Cap Rate</option>
              <option value="rent_upside">Rent Upside</option>
              <option value="price">Price</option>
            </select>
            <select
              className="input-text"
              value={order}
              onChange={(e) => setOrder(e.target.value as "asc" | "desc")}
              style={{ width: "auto", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </div>

          {error && (
            <div className="card error" style={{ marginBottom: "1rem" }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "#737373" }}>
              Loading deals…
            </div>
          ) : deals.length === 0 ? (
            <div className="card" style={{ padding: "2rem", textAlign: "center", color: "#525252", marginBottom: "1rem" }}>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>No scored deals yet</p>
              <p style={{ margin: 0, fontSize: "0.9rem" }}>
                Add properties and generate a dossier from Property Data to see deals here.
              </p>
              <Link href="/property-data" className="btn-primary" style={{ marginTop: "1rem", display: "inline-block" }}>
                Go to Property Data
              </Link>
            </div>
          ) : (
            <>
              <div className="home-cards-container">
                {deals.map((deal) => {
                  const isSelected = selectedIds.has(deal.id);
                  const disabled = !isSelected && selectedCount >= MAX_SELECT;
                  const score = deal.dealScore ?? 0;
                  const isSaved = savedIds.has(deal.id);
                  return (
                    <div
                      key={deal.id}
                      className={`property-card ${isSelected ? "property-card--selected" : ""}`}
                    >
                      <div className="property-card-inner">
                        <div className="property-card-image-wrap">
                          {deal.imageUrl ? (
                            <img
                              src={deal.imageUrl}
                              alt=""
                              className="property-card-image"
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          ) : (
                            <div
                              className="property-card-image"
                              style={{ width: "100%", height: "100%", background: "#e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", color: "#737373", fontSize: "0.85rem" }}
                            >
                              No image
                            </div>
                          )}
                          <div className={`property-card-score-bubble ${getScoreBubbleClass(score)}`}>
                            {Math.round(score)}
                          </div>
                          <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem" }}>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSaved(deal.id); }}
                              disabled={savingId === deal.id}
                              className="property-card-star"
                              style={{
                                background: "rgba(0,0,0,0.3)",
                                border: "none",
                                borderRadius: "4px",
                                padding: "0.35rem",
                                cursor: savingId === deal.id ? "wait" : "pointer",
                                color: isSaved ? "#facc15" : "#fff",
                              }}
                              title={isSaved ? "Unsave deal" : "Save deal"}
                              aria-label={isSaved ? "Unsave deal" : "Save deal"}
                            >
                              {isSaved ? "★" : "☆"}
                            </button>
                          </div>
                        </div>
                        <div className="property-card-body">
                          <div className="property-card-header">
                            <div className="property-card-header-left">
                              <div className="property-card-address">{deal.address || "—"}</div>
                              <div className="property-card-meta">
                                {deal.totalUnits != null ? `${deal.totalUnits} units` : "—"} · {formatPrice(deal.price)}
                              </div>
                              {deal.dealScore != null && (
                                <div style={{ fontSize: "0.7rem", color: "#737373", marginTop: "0.2rem" }}>
                                  {getDealStatusTag(deal.dealScore)}
                                </div>
                              )}
                            </div>
                            <label className="property-card-checkbox-wrap">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(deal.id)}
                                disabled={Boolean(disabled)}
                                className="property-card-checkbox"
                              />
                              <span className="property-card-checkbox-label">Select</span>
                            </label>
                          </div>
                          <div className="property-card-section-title">Financial</div>
                          <div className="property-card-metrics">
                            <div className="property-card-metrics-col">
                              <div className="property-metric">
                                <span className="property-metric-label">Asset Cap</span>
                                <span className="property-metric-value">{formatPctPoints(deal.assetCapRate)}</span>
                              </div>
                              <div className="property-metric">
                                <span className="property-metric-label">Adjusted Cap</span>
                                <span className="property-metric-value">{formatPctPoints(deal.adjustedCapRate)}</span>
                              </div>
                              <div className="property-metric">
                                <span className="property-metric-label">Current NOI</span>
                                <span className="property-metric-value">{deal.currentNoi != null ? formatPrice(deal.currentNoi) : "—"}</span>
                              </div>
                            </div>
                            <div className="property-card-metrics-col">
                              <div className="property-metric">
                                <span className="property-metric-label">Rent Upside</span>
                                <span className="property-metric-value">{formatPctPoints(deal.rentUpside)}</span>
                              </div>
                              <div className="property-metric">
                                <span className="property-metric-label">Adjusted NOI</span>
                                <span className="property-metric-value">{deal.adjustedNoi != null ? formatPrice(deal.adjustedNoi) : "—"}</span>
                              </div>
                              <div className="property-metric">
                                <span className="property-metric-label">Deal Score</span>
                                <span className="property-metric-value">{deal.dealScore != null ? Math.round(deal.dealScore) : "—"}</span>
                              </div>
                            </div>
                          </div>
                          <div className="property-card-section-title" style={{ marginTop: "0.5rem" }}>Returns</div>
                          <div className="property-card-metrics">
                            <div className="property-card-metrics-col">
                              <div className="property-metric">
                                <span className="property-metric-label">IRR {deal.holdYears != null ? `(${deal.holdYears} yr)` : ""}</span>
                                <span className="property-metric-value">{formatPctDecimal(deal.irrPct)}</span>
                              </div>
                            </div>
                            <div className="property-card-metrics-col">
                              <div className="property-metric">
                                <span className="property-metric-label">Equity multiple</span>
                                <span className="property-metric-value">{deal.equityMultiple != null ? `${deal.equityMultiple.toFixed(2)}x` : "—"}</span>
                              </div>
                              <div className="property-metric">
                                <span className="property-metric-label">CoC %</span>
                                <span className="property-metric-value">{formatPctDecimal(deal.cocPct)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="property-card-actions">
                            <Link href={`/property/${deal.id}`} className="btn-card">
                              View Deal
                            </Link>
                            <Link href={`/dossier-assumptions?property_id=${encodeURIComponent(deal.id)}`} className="btn-card">
                              Generate Dossier
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="home-action-bar">
                <label className="home-action-checkbox">
                  <span>
                    Select up to {MAX_SELECT} {selectedCount > 0 && `(${selectedCount} selected)`}
                  </span>
                </label>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => selectedCount > 0 && setDossiersGenerated(true)}
                  disabled={selectedCount === 0}
                >
                  Generate Dossiers
                </button>
                <input type="search" placeholder="Search" className="input-text home-action-search" disabled />
                <select className="input-text home-action-select" disabled>
                  <option>Secure confidence</option>
                </select>
              </div>

              {dossiersGenerated && selectedDeals.length > 0 && (
                <section className="home-dossiers">
                  <h3 className="home-dossiers-title">Generated Dossiers</h3>
                  <div className="home-dossiers-list">
                    {selectedDeals.map((deal) => (
                      <div key={deal.id} className="dossier-card">
                        <div className="dossier-card-image" style={{ background: "#e5e5e5", minHeight: "78px" }} />
                        <div className="dossier-card-body">
                          <div className="dossier-card-address">{deal.address || "—"}</div>
                          <div className="dossier-card-meta">
                            Score {deal.dealScore != null ? Math.round(deal.dealScore) : "—"} · {formatPrice(deal.price)} · {deal.totalUnits != null ? `${deal.totalUnits} units` : "—"}
                          </div>
                          <div className="dossier-card-placeholder">
                            <Link href={`/dossier-assumptions?property_id=${encodeURIComponent(deal.id)}`}>Open assumptions</Link> to generate full dossier.
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </section>

        <aside className="home-sidebar">
          <h3 className="sidebar-title">Alerts & Actions</h3>
          <div className="sidebar-section">
            <label className="sidebar-checkbox">
              <input type="checkbox" disabled />
              Low confidence dedupes
            </label>
            <label className="sidebar-checkbox">
              <input type="checkbox" disabled />
              Flag incorrect merge
            </label>
          </div>
          <div className="sidebar-section">
            <span className="sidebar-section-label">Qu Features</span>
            <button type="button" className="btn-sidebar" disabled>Retrigger</button>
            <button type="button" className="btn-sidebar" disabled>Recompute features</button>
            <button type="button" className="btn-sidebar" disabled>Compute features</button>
          </div>
          <div className="sidebar-section">
            <label className="sidebar-checkbox">
              <input type="checkbox" disabled />
              Scoring tax
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}
