"use client";

import { useState } from "react";

type TabId = "raw" | "canonical";

export default function PropertyDataPage() {
  const [activeTab, setActiveTab] = useState<TabId>("raw");

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
          <table className="property-data-table">
            <thead>
              <tr>
                <th>Listing ID</th>
                <th>Source</th>
                <th>Raw Address</th>
                <th>Norm. Address</th>
                <th>Property ID</th>
                <th>Dup. Conf.</th>
                <th>Price History</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
              </tr>
              <tr>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside className="property-data-sidebar">
          <h3 className="sidebar-title">QA Actions</h3>
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
        </aside>
      </div>

      <div className="property-data-bottom-bar">
        <span className="property-data-bottom-label">Reset of filters</span>
        <div className="property-data-bottom-actions">
          <button type="button" className="btn-secondary" disabled>Reset</button>
          <button type="button" className="btn-primary" disabled>Apply</button>
        </div>
      </div>
    </div>
  );
}
