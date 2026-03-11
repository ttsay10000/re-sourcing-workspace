"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type DealRow = {
  id: string;
  address: string;
  price: number | null;
  imageUrl: string | null;
  totalUnits: number | null;
  beds: number | null;
  baths: number | null;
  listedAt: string | null;
  residentialUnits: number | null;
  commercialUnits: number | null;
  rentStabilizedUnits: number | null;
  eligibleResidentialUnits: number | null;
  recommendedOfferLow: number | null;
  recommendedOfferHigh: number | null;
  targetIrrPct: number | null;
  discountToAskingPct: number | null;
  irrAtAskingPct: number | null;
  targetMetAtAsking: boolean;
  currentNoi: number | null;
  adjustedNoi: number | null;
  stabilizedNoi: number | null;
  annualDebtService: number | null;
  year1EquityYield: number | null;
  dealScore: number | null;
  assetCapRate: number | null;
  adjustedCapRate: number | null;
  rentUpside: number | null;
  irrPct: number | null;
  equityMultiple: number | null;
  cocPct: number | null;
  holdYears: number | null;
  generatedAt: string | null;
  dossierDocumentId: string | null;
  dossierFileName: string | null;
  dossierCreatedAt: string | null;
};

type ActionMessage = {
  type: "success" | "error";
  text: string;
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

function getDealStatusToneClass(score: number): string {
  if (score >= 80) return "home-deal-market-pill--strong";
  if (score >= 70) return "home-deal-market-pill--attractive";
  if (score >= 60) return "home-deal-market-pill--neutral";
  return "home-deal-market-pill--weak";
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCount(n: number | null | undefined, suffix = ""): string {
  if (n == null || Number.isNaN(n)) return "—";
  const whole = Math.abs(n % 1) < 0.001;
  return `${whole ? n.toFixed(0) : n.toFixed(1)}${suffix}`;
}

function formatCountLabel(
  value: number | null | undefined,
  singular: string,
  plural = `${singular}s`
): string | null {
  if (value == null || Number.isNaN(value)) return null;
  const label = Math.abs(value - 1) < 0.001 ? singular : plural;
  return `${formatCount(value)} ${label}`;
}

function formatPctPoints(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function formatPctDecimal(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysOnMarket(value: string | null | undefined): number | null {
  if (!value) return null;
  const listedAt = new Date(value);
  if (Number.isNaN(listedAt.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  listedAt.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - listedAt.getTime()) / (1000 * 60 * 60 * 24)));
}

function formatDaysOnMarket(value: number | null): string | null {
  if (value == null) return null;
  return `${value} ${value === 1 ? "Day" : "Days"} on Market`;
}

function buildFactPills(deal: DealRow): string[] {
  const facts: string[] = [];
  const totalUnits = formatCountLabel(deal.totalUnits, "Unit");
  const beds = deal.beds != null && deal.beds > 0 ? formatCountLabel(deal.beds, "Bed") : null;
  const baths = deal.baths != null && deal.baths > 0 ? formatCountLabel(deal.baths, "Bath") : null;

  if (totalUnits) facts.push(totalUnits);
  if (beds) facts.push(beds);
  if (baths) facts.push(baths);

  const shouldShowResidentialMix =
    (deal.commercialUnits ?? 0) > 0 ||
    (deal.rentStabilizedUnits ?? 0) > 0 ||
    (deal.totalUnits != null &&
      deal.residentialUnits != null &&
      Math.abs(deal.totalUnits - deal.residentialUnits) > 0.001);

  if (shouldShowResidentialMix && deal.residentialUnits != null && deal.residentialUnits > 0) {
    facts.push(`${formatCount(deal.residentialUnits)} Residential`);
  }
  if (deal.commercialUnits != null && deal.commercialUnits > 0) {
    facts.push(`${formatCount(deal.commercialUnits)} Commercial`);
  }
  if (deal.rentStabilizedUnits != null && deal.rentStabilizedUnits > 0) {
    facts.push(`${formatCount(deal.rentStabilizedUnits)} Rent Stabilized`);
  }

  return facts;
}

function buildDateItems(deal: DealRow): Array<{ label: string; value: string }> {
  return [
    { label: "Listed", value: formatDateLabel(deal.listedAt) },
    { label: "Scored", value: formatDateLabel(deal.generatedAt) },
    { label: "Dossier", value: formatDateLabel(deal.dossierCreatedAt) },
  ].filter((item) => item.value !== "—");
}

function buildDossierFileUrl(deal: DealRow): string | null {
  if (!deal.dossierDocumentId) return null;
  return `${API_BASE}/api/properties/${encodeURIComponent(deal.id)}/documents/${encodeURIComponent(deal.dossierDocumentId)}/file`;
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
  const [search, setSearch] = useState("");
  const [dossierFilter, setDossierFilter] = useState<"all" | "ready" | "missing">("all");
  const [runningAction, setRunningAction] = useState<"enrichment" | "rental" | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);

  const fetchDeals = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ sort, order, limit: "60" });
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
  }, [order, sort]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const available = new Set(deals.map((deal) => deal.id));
      const next = new Set(Array.from(prev).filter((id) => available.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [deals]);

  useEffect(() => {
    if (deals.length === 0) {
      setSavedIds(new Set());
      return;
    }
    const ids = deals.map((deal) => deal.id).join(",");
    fetch(`${API_BASE}/api/profile/saved-deals/check?propertyIds=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.saved === "object") {
          setSavedIds(new Set(Object.keys(data.saved).filter((id: string) => Boolean(data.saved[id]))));
        }
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
      return;
    }

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
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredDeals = deals.filter((deal) => {
    if (normalizedSearch && !deal.address.toLowerCase().includes(normalizedSearch)) return false;
    if (dossierFilter === "ready" && !deal.dossierDocumentId) return false;
    if (dossierFilter === "missing" && deal.dossierDocumentId) return false;
    return true;
  });

  const selectedCount = selectedIds.size;
  const selectedVisibleCount = filteredDeals.filter((deal) => selectedIds.has(deal.id)).length;
  const allVisibleSelected = filteredDeals.length > 0 && selectedVisibleCount === filteredDeals.length;
  const visibleIds = filteredDeals.map((deal) => deal.id);
  const dossiersReadyCount = deals.filter((deal) => Boolean(deal.dossierDocumentId)).length;
  const withScore = deals.filter((deal) => deal.dealScore != null);
  const avgScore = withScore.length > 0
    ? withScore.reduce((sum, deal) => sum + (deal.dealScore ?? 0), 0) / withScore.length
    : null;
  const above90Count = deals.filter((deal) => (deal.dealScore ?? 0) >= 90).length;
  const withDiscount = deals.filter((deal) => deal.discountToAskingPct != null);
  const avgDiscount = withDiscount.length > 0
    ? withDiscount.reduce((sum, deal) => sum + (deal.discountToAskingPct ?? 0), 0) / withDiscount.length
    : null;
  const withDom = deals
    .map((deal) => daysOnMarket(deal.listedAt))
    .filter((value): value is number => value != null);
  const avgDaysOnMarket = withDom.length > 0
    ? withDom.reduce((sum, value) => sum + value, 0) / withDom.length
    : null;

  const handleToggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleRunSelected = async (mode: "enrichment" | "rental") => {
    const propertyIds = Array.from(selectedIds);
    if (propertyIds.length === 0) return;
    const label = mode === "enrichment" ? "enrichment" : "rental flow";
    const confirmed = window.confirm(
      `Run ${label} for ${propertyIds.length} selected propert${propertyIds.length === 1 ? "y" : "ies"}?`
    );
    if (!confirmed) return;

    setRunningAction(mode);
    setActionMessage(null);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/properties/${mode === "enrichment" ? "run-enrichment" : "run-rental-flow"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyIds }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data.error || data.details || `HTTP ${response.status}`) as string);
      }

      if (mode === "enrichment") {
        const success = Number(data.permitEnrichment?.success ?? 0);
        const failed = Number(data.permitEnrichment?.failed ?? 0);
        const processed = Number(data.omFinancialsRefresh?.documentsProcessed ?? 0);
        setActionMessage({
          type: "success",
          text: `Re-ran enrichment for ${propertyIds.length} selected properties. ${success} succeeded, ${failed} failed, ${processed} OM document${processed === 1 ? "" : "s"} refreshed.`,
        });
      } else {
        const results = Array.isArray(data.results) ? data.results : [];
        const withUnits = results.filter((row: { rentalUnitsCount?: number }) => (row.rentalUnitsCount ?? 0) > 0).length;
        const withLlm = results.filter((row: { hasLlmFinancials?: boolean }) => Boolean(row.hasLlmFinancials)).length;
        setActionMessage({
          type: "success",
          text: `Re-ran rental flow for ${propertyIds.length} selected properties. ${withUnits} returned rental units and ${withLlm} refreshed listing-derived financials.`,
        });
      }
      fetchDeals();
    } catch (e) {
      const message = e instanceof Error ? e.message : `Failed to run ${label}`;
      setActionMessage({ type: "error", text: message });
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="home-layout">
      <section className="home-hero">
        <div>
          <div className="home-hero-eyebrow">Deal triage board</div>
          <h1 className="home-hero-title">Score deals, pull dossiers, and refresh the feed from one board.</h1>
          <p className="home-hero-copy">
            Scan property mix, listed days, offer guidance, and dossier status in one place. Use selection to refresh only the properties you care about.
          </p>
        </div>
        <div className="home-hero-actions">
          <Link href="/property-data" className="btn-primary">
            Add new deals
          </Link>
          <button type="button" className="btn-secondary" onClick={fetchDeals}>
            Refresh feed
          </button>
        </div>
      </section>

      <section className="home-metrics">
        <div className="metric-card">
          <div className="metric-label">Scored deals</div>
          <div className="metric-value">{total}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg deal score</div>
          <div className="metric-value">{avgScore != null ? avgScore.toFixed(1) : "—"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Deals 90+</div>
          <div className="metric-value">{above90Count}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Dossiers ready</div>
          <div className="metric-value">{dossiersReadyCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg required discount</div>
          <div className="metric-value">{avgDiscount != null ? `${avgDiscount.toFixed(1)}%` : "—"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg days on market</div>
          <div className="metric-value">{avgDaysOnMarket != null ? Math.round(avgDaysOnMarket) : "—"}</div>
        </div>
      </section>

      <div className="home-content">
        <section className="home-main">
          <div className="home-toolbar">
            <div className="home-toolbar-controls">
              <input
                type="search"
                placeholder="Search address"
                className="input-text home-toolbar-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search deals by address"
              />
              <select
                className="input-text home-toolbar-select"
                value={dossierFilter}
                onChange={(e) => setDossierFilter(e.target.value as typeof dossierFilter)}
                aria-label="Filter by dossier status"
              >
                <option value="all">All dossier states</option>
                <option value="ready">Dossier ready</option>
                <option value="missing">Needs dossier</option>
              </select>
              <select
                className="input-text home-toolbar-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Sort deals"
              >
                <option value="deal_score">Deal Score</option>
                <option value="adjusted_cap_rate">Adjusted Cap Rate</option>
                <option value="asset_cap_rate">Asset Cap Rate</option>
                <option value="rent_upside">Rent Upside</option>
                <option value="price">Price</option>
              </select>
              <select
                className="input-text home-toolbar-select"
                value={order}
                onChange={(e) => setOrder(e.target.value as "asc" | "desc")}
                aria-label="Sort direction"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
            <div className="home-toolbar-meta">
              {filteredDeals.length} visible
              {selectedCount > 0 ? ` • ${selectedCount} selected` : ""}
            </div>
          </div>

          {error && (
            <div className="card error" style={{ maxWidth: "none" }}>
              {error}
            </div>
          )}

          {actionMessage && (
            <div
              className="card"
              style={{
                maxWidth: "none",
                borderColor: actionMessage.type === "success" ? "#86efac" : "#fca5a5",
                background: actionMessage.type === "success" ? "#f0fdf4" : "#fef2f2",
                color: actionMessage.type === "success" ? "#166534" : "#b91c1c",
              }}
            >
              {actionMessage.text}
            </div>
          )}

          {loading ? (
            <div className="home-empty-state">Loading deals…</div>
          ) : filteredDeals.length === 0 ? (
            <div className="home-empty-state">
              {deals.length === 0 ? (
                <>
                  <strong>No scored deals yet.</strong>
                  <span>Add listings in Property Data, generate a dossier, and they will show up here.</span>
                </>
              ) : (
                <>
                  <strong>No deals match the current filters.</strong>
                  <span>Adjust search, sort, or dossier status to widen the feed.</span>
                </>
              )}
            </div>
          ) : (
            <div className="home-deal-grid">
              {filteredDeals.map((deal) => {
                const isSelected = selectedIds.has(deal.id);
                const isSaved = savedIds.has(deal.id);
                const dom = daysOnMarket(deal.listedAt);
                const score = deal.dealScore ?? 0;
                const dossierUrl = buildDossierFileUrl(deal);
                const factPills = buildFactPills(deal);
                const dateItems = buildDateItems(deal);

                return (
                  <article
                    key={deal.id}
                    className={`home-deal-card ${isSelected ? "home-deal-card--selected" : ""}`}
                  >
                    <div className="home-deal-card-media">
                      {deal.imageUrl ? (
                        <img src={deal.imageUrl} alt="" className="home-deal-card-image" />
                      ) : (
                        <div className="home-deal-card-image home-deal-card-image--placeholder">No image</div>
                      )}
                      <div className={`property-card-score-bubble ${getScoreBubbleClass(score)}`}>
                        {Math.round(score)}
                      </div>
                      <div className="home-deal-card-media-actions">
                        <button
                          type="button"
                          onClick={() => toggleSaved(deal.id)}
                          disabled={savingId === deal.id}
                          className="property-card-star"
                          title={isSaved ? "Unsave deal" : "Save deal"}
                          aria-label={isSaved ? "Unsave deal" : "Save deal"}
                        >
                          {isSaved ? "★" : "☆"}
                        </button>
                        <span className={`home-deal-status-pill ${deal.dossierDocumentId ? "home-deal-status-pill--ready" : "home-deal-status-pill--pending"}`}>
                          {deal.dossierDocumentId ? "Dossier ready" : "Needs dossier"}
                        </span>
                      </div>
                    </div>

                    <div className="home-deal-card-body">
                      <div className="home-deal-card-header">
                        <div className="home-deal-title-block">
                          <div className="property-card-address">{deal.address || "—"}</div>
                          <div className="home-deal-market-pills">
                            {dom != null && (
                              <span className="home-deal-market-pill">{formatDaysOnMarket(dom)}</span>
                            )}
                            {deal.dealScore != null && (
                              <span
                                className={`home-deal-market-pill ${getDealStatusToneClass(
                                  deal.dealScore
                                )}`}
                              >
                                {getDealStatusTag(deal.dealScore)}
                              </span>
                            )}
                          </div>
                        </div>
                        <label className="property-card-checkbox-wrap">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(deal.id)}
                            className="property-card-checkbox"
                          />
                          <span className="property-card-checkbox-label">Select</span>
                        </label>
                      </div>

                      <div className="home-deal-price-row">
                        <div className="home-deal-price-block">
                          <span className="home-deal-price-label">Ask</span>
                          <strong className="home-deal-price-value">{formatPrice(deal.price)}</strong>
                        </div>
                      </div>

                      <div className="home-deal-facts">
                        {factPills.map((fact) => (
                          <span key={fact} className="home-fact-pill">
                            {fact}
                          </span>
                        ))}
                      </div>

                      <div className="home-offer-strip">
                        <div className="home-offer-strip-header">
                          <span className="home-offer-strip-title">Offer guidance</span>
                          {deal.targetIrrPct != null && (
                            <span className="home-offer-strip-note">
                              Underwritten to {deal.targetIrrPct.toFixed(0)}% target IRR
                            </span>
                          )}
                        </div>
                        <div className="home-offer-strip-grid">
                          <div className="home-offer-strip-item">
                            <span className="home-offer-strip-label">Recommended offer</span>
                            <strong>
                              {deal.recommendedOfferLow != null && deal.recommendedOfferHigh != null
                                ? `${formatPrice(deal.recommendedOfferLow)} - ${formatPrice(deal.recommendedOfferHigh)}`
                                : "—"}
                            </strong>
                          </div>
                          <div className="home-offer-strip-item">
                            <span className="home-offer-strip-label">Discount to ask</span>
                            <strong>
                              {deal.targetMetAtAsking
                                ? "Target met at ask"
                                : formatPctPoints(deal.discountToAskingPct)}
                            </strong>
                          </div>
                        </div>
                      </div>

                      <div className="property-card-section-title">Quick underwriting</div>
                      <div className="property-card-metrics">
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">Asset cap</span>
                            <span className="property-metric-value">{formatPctPoints(deal.assetCapRate)}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Current NOI</span>
                            <span className="property-metric-value">{formatPrice(deal.currentNoi)}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Debt service</span>
                            <span className="property-metric-value">{formatPrice(deal.annualDebtService)}</span>
                          </div>
                        </div>
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">Adjusted cap</span>
                            <span className="property-metric-value">{formatPctPoints(deal.adjustedCapRate)}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Stabilized NOI</span>
                            <span className="property-metric-value">{formatPrice(deal.stabilizedNoi ?? deal.adjustedNoi)}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Rent upside</span>
                            <span className="property-metric-value">{formatPctPoints(deal.rentUpside)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="property-card-section-title">Returns</div>
                      <div className="property-card-metrics">
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">IRR {deal.holdYears != null ? `(${deal.holdYears} yr)` : ""}</span>
                            <span className="property-metric-value">{formatPctDecimal(deal.irrPct)}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Equity yield</span>
                            <span className="property-metric-value">{formatPctDecimal(deal.year1EquityYield)}</span>
                          </div>
                        </div>
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">Equity multiple</span>
                            <span className="property-metric-value">{deal.equityMultiple != null ? `${deal.equityMultiple.toFixed(2)}x` : "—"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="home-deal-card-footer">
                        {dateItems.length > 0 && (
                          <div className="home-deal-date-grid">
                            {dateItems.map((item) => (
                              <div key={item.label} className="home-deal-date-item">
                                <span className="home-deal-date-label">{item.label}</span>
                                <span className="home-deal-date-value">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="property-card-actions">
                          <Link href={`/property/${deal.id}`} className="btn-card">
                            View deal
                          </Link>
                          {dossierUrl ? (
                            <a href={dossierUrl} className="btn-card" target="_blank" rel="noreferrer">
                              Download dossier
                            </a>
                          ) : (
                            <Link href={`/dossier-assumptions?property_id=${encodeURIComponent(deal.id)}`} className="btn-card">
                              Generate dossier
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="home-sidebar home-sidebar--sticky">
          <h2 className="sidebar-title">Selection & Actions</h2>
          <p className="home-sidebar-copy">
            Rerun enrichment or rental flow only for the properties you select. Use filters plus “select all visible” to refresh a subset fast.
          </p>

          <div className="home-sidebar-selection-card">
            <div className="home-sidebar-selection-count">{selectedCount}</div>
            <div>
              <div className="home-sidebar-selection-label">Selected properties</div>
              <div className="home-sidebar-selection-subtext">
                {selectedVisibleCount} visible in the current filter set
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <button type="button" className="btn-secondary" onClick={handleToggleSelectAllVisible} disabled={filteredDeals.length === 0}>
              {allVisibleSelected ? "Clear visible selection" : `Select all visible (${filteredDeals.length})`}
            </button>
            <button type="button" className="btn-secondary" onClick={clearSelection} disabled={selectedCount === 0}>
              Clear all selection
            </button>
          </div>

          <div className="sidebar-section">
            <span className="sidebar-section-label">Refresh selected properties</span>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleRunSelected("enrichment")}
              disabled={selectedCount === 0 || runningAction != null}
            >
              {runningAction === "enrichment" ? "Re-running enrichment…" : "Re-run enrichment"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleRunSelected("rental")}
              disabled={selectedCount === 0 || runningAction != null}
            >
              {runningAction === "rental" ? "Running rental flow…" : "Re-run rental flow"}
            </button>
          </div>

          <div className="sidebar-section">
            <span className="sidebar-section-label">What is new on this homepage</span>
            <div className="home-sidebar-note">
              Quick facts now surface units, beds, baths, residential vs commercial mix, rent-stabilized count, listed days, and recommended offer range directly on each card.
            </div>
            <div className="home-sidebar-note">
              Dossiers can be downloaded directly when already generated; otherwise the card takes you straight to assumptions for generation.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
