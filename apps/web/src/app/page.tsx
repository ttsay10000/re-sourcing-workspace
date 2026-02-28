export default function HomePage() {
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
            {/* Placeholder cards – static, no data */}
            <div className="property-card">
              <div className="property-card-score">92</div>
              <div className="property-card-placeholder">Placeholder property</div>
              <div className="property-card-placeholder">Address, details</div>
              <div className="property-card-actions">
                <button type="button" className="btn-card">Generate Memo</button>
                <button type="button" className="btn-card">Add to Queue</button>
              </div>
            </div>
            <div className="property-card">
              <div className="property-card-score">89</div>
              <div className="property-card-placeholder">Placeholder property</div>
              <div className="property-card-placeholder">Address, details</div>
              <div className="property-card-actions">
                <button type="button" className="btn-card">Generate Memo</button>
                <button type="button" className="btn-card">Add to Queue</button>
              </div>
            </div>
          </div>
          <div className="home-action-bar">
            <label className="home-action-checkbox">
              <input type="checkbox" disabled />
              Select up to 10
            </label>
            <button type="button" className="btn-primary">Generate Dossiers</button>
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
