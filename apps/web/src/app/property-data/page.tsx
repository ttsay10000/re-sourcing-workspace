"use client";

import React, { useCallback, useEffect, useState } from "react";
import { PropertyDetailCollapsible } from "./PropertyDetailCollapsible";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type TabId = "raw" | "canonical";

interface ListingRow {
  id: string;
  externalId: string;
  source: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft?: number | null;
  description?: string | null;
  listedAt?: string | null;
  url?: string;
  imageUrls?: string[] | null;
  agentNames?: string[] | null;
  extra?: Record<string, unknown> | null;
}

export default function PropertyDataPage() {
  const [activeTab, setActiveTab] = useState<TabId>("raw");
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const fetchListings = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/listings`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setListings(data.listings ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e.message || "Failed to load listings"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "raw") fetchListings();
  }, [activeTab, fetchListings]);

  const selectedListing = selectedId ? listings.find((l) => l.id === selectedId) ?? null : null;

  const formatPrice = (n: number) =>
    n != null && !Number.isNaN(n)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
      : "—";

  const handleClearPropertyData = () => {
    if (!confirm("Clear all raw listings and their snapshots? This cannot be undone.")) return;
    setClearing(true);
    setError(null);
    fetch(`${API_BASE}/api/test-agent/property-data?confirm=1`, { method: "DELETE" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok && data?.error) {
          const detail = data.details ? ` — ${data.details}` : "";
          throw new Error(data.error + detail);
        }
        if (data?.error) throw new Error(data.error);
        fetchListings();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to clear property data"))
      .finally(() => setClearing(false));
  };

  return (
    <div className="property-data-layout">
      <h1 className="page-title">Property Data</h1>

      <div className="property-data-search-row">
        <input
          type="search"
          placeholder="Search by Address, property ID, or Listing ID"
          className="input-text property-data-search"
          disabled
        />
      </div>

      <div className="property-data-tabs-row">
        <div className="property-data-tabs">
          <button
            type="button"
            className={`property-data-tab ${activeTab === "raw" ? "property-data-tab--active" : ""}`}
            onClick={() => setActiveTab("raw")}
          >
            Raw Listings
          </button>
          <button
            type="button"
            className={`property-data-tab ${activeTab === "canonical" ? "property-data-tab--active" : ""}`}
            onClick={() => setActiveTab("canonical")}
          >
            Canonical Properties
          </button>
        </div>
        <div className="property-data-filters">
          <select className="input-text property-data-filter-select" disabled>
            <option>Filters</option>
          </select>
          <select className="input-text property-data-filter-select" disabled>
            <option>Source...</option>
          </select>
          <select className="input-text property-data-filter-select" disabled>
            <option>Dedup Confidence</option>
          </select>
          <select className="input-text property-data-filter-select" disabled>
            <option>Missing Data</option>
          </select>
        </div>
      </div>

      <div className="property-data-content">
        <div className="property-data-table-wrap">
          {error && (
            <div className="card error" style={{ margin: "1rem" }}>
              {error}
            </div>
          )}
          {loading && activeTab === "raw" && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#525252" }}>
              Loading raw listings…
            </div>
          )}
          {activeTab === "canonical" && (
            <div style={{ padding: "2rem", color: "#525252" }}>
              Canonical properties (after deduping and enrichment) — coming soon.
            </div>
          )}
          {activeTab === "raw" && !loading && (
            <table className="property-data-table">
              <thead>
                <tr>
                  <th className="property-data-table-expand-col" aria-label="Expand row" />
                  <th>Listing ID</th>
                  <th>Source</th>
                  <th>Raw Address</th>
                  <th>Property ID</th>
                  <th>Dup. Conf.</th>
                  <th>Price History</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {listings.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "2rem", color: "#737373", textAlign: "center" }}>
                      No raw listings yet. Run a flow from Runs, then use &quot;Send to property data&quot; for a
                      completed run.
                    </td>
                  </tr>
                ) : (
                  listings.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`property-data-row--clickable ${selectedId === row.id ? "property-data-row--selected" : ""}`}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td className="property-data-table-expand-col">
                          <button
                            type="button"
                            className="property-data-row-expand-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRowId((id) => (id === row.id ? null : row.id));
                            }}
                            aria-expanded={expandedRowId === row.id}
                            aria-label={expandedRowId === row.id ? "Collapse row" : "Expand row"}
                          >
                            <span className={`property-data-row-expand-chevron ${expandedRowId === row.id ? "property-data-row-expand-chevron--open" : ""}`}>
                              ▼
                            </span>
                          </button>
                        </td>
                        <td>{row.externalId}</td>
                        <td>{row.source === "streeteasy" ? "Streeteasy" : row.source}</td>
                        <td>{row.address || "—"}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>{formatPrice(row.price)}</td>
                        <td>
                          {row.url && row.url !== "#" ? (
                            <a href={row.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              view source
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                      {expandedRowId === row.id && (
                        <tr key={`${row.id}-detail`} className="property-data-detail-row">
                          <td colSpan={8} className="property-data-detail-cell">
                            <PropertyDetailCollapsible listing={row} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        <aside className="property-data-sidebar">
          {selectedListing ? (
            <>
              <h3 className="sidebar-title">Property</h3>
              <PropertyDetailCollapsible listing={selectedListing} />
            </>
          ) : (
            <>
              <h3 className="sidebar-title">QA Actions</h3>
              <p style={{ fontSize: "0.875rem", color: "#737373", margin: 0 }}>
                Select a listing from the table to view its details.
              </p>
              <div className="sidebar-section">
                <span className="sidebar-section-label">Select one</span>
                <label className="sidebar-radio">
                  <input type="radio" name="qa-action" disabled />
                  Re-run dedupe
                </label>
                <label className="sidebar-radio">
                  <input type="radio" name="qa-action" disabled />
                  Override match
                </label>
                <label className="sidebar-radio">
                  <input type="radio" name="qa-action" disabled />
                  Flag incorrect merge
                </label>
                <label className="sidebar-radio">
                  <input type="radio" name="qa-action" disabled />
                  Re-trigger enrichment
                </label>
              </div>
              <div className="sidebar-section">
                <span className="sidebar-section-label">Batch (check all that apply)</span>
                <label className="sidebar-checkbox">
                  <input type="checkbox" disabled />
                  Re-run dedupe
                </label>
                <label className="sidebar-checkbox">
                  <input type="checkbox" disabled />
                  Flag incorrect merge
                </label>
                <label className="sidebar-checkbox">
                  <input type="checkbox" disabled />
                  Re-trigger enrichment
                </label>
                <label className="sidebar-checkbox">
                  <input type="checkbox" disabled />
                  Recompute features
                </label>
                <label className="sidebar-checkbox">
                  <input type="checkbox" disabled />
                  Re-score property
                </label>
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="property-data-bottom-bar">
        <span className="property-data-bottom-label">
          {activeTab === "raw" && total > 0 ? `${total} raw listing(s)` : "Reset of filters"}
        </span>
        <div className="property-data-bottom-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClearPropertyData}
            disabled={clearing || activeTab !== "raw"}
            title="Remove all raw listings and snapshots (for testing)"
          >
            {clearing ? "Clearing…" : "Clear all (test)"}
          </button>
          <button type="button" className="btn-secondary" disabled>Reset</button>
          <button type="button" className="btn-primary" disabled>Apply</button>
        </div>
      </div>
    </div>
  );
}
