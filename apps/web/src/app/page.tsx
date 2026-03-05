"use client";

import { useState } from "react";

const MAX_SELECT = 10;

type DealStatus = "active" | "off market" | "in contract" | "delisted";

type PlaceholderProperty = {
  id: string;
  score: number;
  imageUrl: string;
  address: string;
  price: string;
  beds: number;
  baths: number;
  sqft: string;
  listedDate: string;
  daysOnMarket: string;
  status: DealStatus;
  projectedIRR: string;
  currentNOI: string;
  valueAddNOI: string;
  currentCapRate: string;
  projectedCapRate: string;
  cashOnCashReturn: string;
  amenities: string;
};

const PLACEHOLDER_PROPERTIES: PlaceholderProperty[] = [
  {
    id: "1",
    score: 92,
    imageUrl: "https://picsum.photos/seed/re1/400/260",
    address: "123 Oak St, Brooklyn",
    price: "$1.2M",
    beds: 3,
    baths: 2,
    sqft: "1,840",
    listedDate: "Feb 15, 2025",
    daysOnMarket: "13",
    status: "active",
    projectedIRR: "12.4%",
    currentNOI: "$84,200",
    valueAddNOI: "$98,500",
    currentCapRate: "7.0%",
    projectedCapRate: "8.2%",
    cashOnCashReturn: "14.1%",
    amenities: "Parking, Laundry",
  },
  {
    id: "2",
    score: 89,
    imageUrl: "https://picsum.photos/seed/re2/400/260",
    address: "456 Pine Ave, Queens",
    price: "$895K",
    beds: 2,
    baths: 2,
    sqft: "1,200",
    listedDate: "Feb 8, 2025",
    daysOnMarket: "20",
    status: "active",
    projectedIRR: "10.8%",
    currentNOI: "$62,100",
    valueAddNOI: "$71,200",
    currentCapRate: "6.9%",
    projectedCapRate: "8.0%",
    cashOnCashReturn: "11.5%",
    amenities: "Gym, Doorman",
  },
  {
    id: "3",
    score: 87,
    imageUrl: "https://picsum.photos/seed/re3/400/260",
    address: "789 Maple Dr, Manhattan",
    price: "$2.1M",
    beds: 4,
    baths: 3,
    sqft: "2,400",
    listedDate: "Feb 20, 2025",
    daysOnMarket: "8",
    status: "in contract",
    projectedIRR: "9.2%",
    currentNOI: "$118,500",
    valueAddNOI: "$132,000",
    currentCapRate: "5.6%",
    projectedCapRate: "6.3%",
    cashOnCashReturn: "9.8%",
    amenities: "Parking, Laundry, Roof deck",
  },
];

function getScoreBubbleClass(score: number): string {
  if (score > 90) return "property-card-score-bubble--green";
  if (score >= 70) return "property-card-score-bubble--yellow";
  return "property-card-score-bubble--red";
}

export default function HomePage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dossiersGenerated, setDossiersGenerated] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_SELECT) {
        next.add(id);
      }
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  const handleGenerateDossiers = () => {
    if (selectedCount > 0) setDossiersGenerated(true);
  };

  const selectedProperties = PLACEHOLDER_PROPERTIES.filter((p) =>
    selectedIds.has(p.id)
  );

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
          <div className="metric-value">—</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Number of Deals Above 90</div>
          <div className="metric-value">—</div>
        </div>
      </section>

      {/* Main content + sidebar */}
      <div className="home-content">
        <section className="home-main">
          <h2 className="home-section-title">Top Ranked Deals</h2>
          <div className="home-cards-container">
            {PLACEHOLDER_PROPERTIES.map((prop) => {
              const isSelected = selectedIds.has(prop.id);
              const disabled = !isSelected && selectedCount >= MAX_SELECT;
              return (
                <div
                  key={prop.id}
                  className={`property-card ${isSelected ? "property-card--selected" : ""}`}
                >
                  <div className="property-card-inner">
                    <div className="property-card-image-wrap">
                      <img
                        src={prop.imageUrl}
                        alt=""
                        className="property-card-image"
                        width={400}
                        height={260}
                      />
                      <div
                        className={`property-card-score-bubble ${getScoreBubbleClass(prop.score)}`}
                      >
                        {prop.score}
                      </div>
                    </div>
                    <div className="property-card-body">
                      <div className="property-card-header">
                        <div className="property-card-header-left">
                          <div className="property-card-address">{prop.address}</div>
                          <div className="property-card-meta">
                            {prop.beds} bed · {prop.baths} bath · {prop.sqft} sq ft · {prop.price}
                          </div>
                        </div>
                        <label className="property-card-checkbox-wrap">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(prop.id)}
                            disabled={Boolean(disabled)}
                            className="property-card-checkbox"
                          />
                          <span className="property-card-checkbox-label">Select</span>
                        </label>
                      </div>
                      <div className="property-card-section-title">Property & listing</div>
                      <div className="property-card-metrics">
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">Listed date</span>
                            <span className="property-metric-value">{prop.listedDate}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Status</span>
                            <span className="property-metric-value">{prop.status}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Days on market</span>
                            <span className="property-metric-value">{prop.daysOnMarket}</span>
                          </div>
                        </div>
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">Price</span>
                            <span className="property-metric-value">{prop.price}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Sq ft</span>
                            <span className="property-metric-value">{prop.sqft}</span>
                          </div>
                        </div>
                      </div>
                      <div className="property-card-section-title">Financial</div>
                      <div className="property-card-metrics">
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">IRR (calc)</span>
                            <span className="property-metric-value">{prop.projectedIRR}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Current NOI</span>
                            <span className="property-metric-value">{prop.currentNOI}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Projected NOI</span>
                            <span className="property-metric-value">{prop.valueAddNOI}</span>
                          </div>
                        </div>
                        <div className="property-card-metrics-col">
                          <div className="property-metric">
                            <span className="property-metric-label">Market cap rate</span>
                            <span className="property-metric-value">{prop.currentCapRate}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">Projected cap</span>
                            <span className="property-metric-value">{prop.projectedCapRate}</span>
                          </div>
                          <div className="property-metric">
                            <span className="property-metric-label">CoC</span>
                            <span className="property-metric-value">{prop.cashOnCashReturn}</span>
                          </div>
                        </div>
                      </div>
                      <div className="property-card-actions">
                        <button type="button" className="btn-card">
                          Generate Memo
                        </button>
                        <button type="button" className="btn-card">
                          Add to Queue
                        </button>
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
                Select up to 10 {selectedCount > 0 && `(${selectedCount} selected)`}
              </span>
            </label>
            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerateDossiers}
              disabled={Boolean(selectedCount === 0)}
            >
              Generate Dossiers
            </button>
            <input
              type="search"
              placeholder="Search"
              className="input-text home-action-search"
              disabled
            />
            <select className="input-text home-action-select" disabled>
              <option>Secure confidence</option>
            </select>
          </div>

          {dossiersGenerated && selectedProperties.length > 0 && (
            <section className="home-dossiers">
              <h3 className="home-dossiers-title">Generated Dossiers</h3>
              <div className="home-dossiers-list">
                {selectedProperties.map((prop) => (
                  <div key={prop.id} className="dossier-card">
                    <div className="dossier-card-image">
                      <img
                        src={prop.imageUrl}
                        alt=""
                        width={120}
                        height={78}
                      />
                    </div>
                    <div className="dossier-card-body">
                      <div className="dossier-card-address">{prop.address}</div>
                      <div className="dossier-card-meta">
                        Score {prop.score} · {prop.price} · {prop.beds} bed, {prop.baths} bath
                      </div>
                      <div className="dossier-card-placeholder">
                        Dossier content placeholder (memo, comps, etc.)
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
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
