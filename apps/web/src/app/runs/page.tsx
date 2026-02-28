"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AREA_OPTIONS } from "./areas";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface RunCriteria {
  areas: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  maxBeds?: number | null;
  minBaths?: number | null;
  maxHoa?: number | null;
  maxTax?: number | null;
  amenities?: string | null;
  types?: string | null;
  limit?: number | null;
  offset?: number | null;
}

interface RunRow {
  id: string;
  startedAt: string;
  criteria: RunCriteria;
  step1Status: string;
  step1Count: number;
  step1Error: string | null;
  step2Status: string;
  step2Count: number;
  step2Total: number;
  step2Error: string | null;
  propertiesCount: number;
  errorsCount: number;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Filters (all variable, no hardcoded numbers in request)
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [minBeds, setMinBeds] = useState<string>("");
  const [maxBeds, setMaxBeds] = useState<string>("");
  const [minBaths, setMinBaths] = useState<string>("");
  const [maxHoa, setMaxHoa] = useState<string>("");
  const [maxTax, setMaxTax] = useState<string>("");
  const [amenities, setAmenities] = useState<string>("");
  const [types, setTypes] = useState<string>("");
  const [limit, setLimit] = useState<string>("100");

  const fetchRuns = useCallback(() => {
    fetch(`${API_BASE}/api/test-agent/runs`)
      .then((r) => r.json())
      .then((data) => setRuns(data.runs ?? []))
      .catch((e) => setError(e.message || "Failed to load runs"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Poll when any run is still in progress
  const hasRunning = runs.some(
    (r) =>
      r.step1Status === "running" || r.step1Status === "pending" || r.step2Status === "running"
  );
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(fetchRuns, 2000);
    return () => clearInterval(t);
  }, [hasRunning, fetchRuns]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    const areasValue =
      selectedAreas.length > 0 ? selectedAreas.join(",") : "all-downtown,all-midtown";
    const body: RunCriteria = {
      areas: areasValue,
      limit: limit ? Math.min(Number(limit), 200) : 100,
    };
    if (minPrice !== "") body.minPrice = Number(minPrice);
    if (maxPrice !== "") body.maxPrice = Number(maxPrice);
    if (minBeds !== "") body.minBeds = Number(minBeds);
    if (maxBeds !== "") body.maxBeds = Number(maxBeds);
    if (minBaths !== "") body.minBaths = Number(minBaths);
    if (maxHoa !== "") body.maxHoa = Number(maxHoa);
    if (maxTax !== "") body.maxTax = Number(maxTax);
    if (amenities.trim()) body.amenities = amenities.trim();
    if (types.trim()) body.types = types.trim();

    fetch(`${API_BASE}/api/test-agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        fetchRuns();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Request failed"))
      .finally(() => setSending(false));
  };

  const toggleArea = (value: string) => {
    setSelectedAreas((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]
    );
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  const elapsed = (startedAt: string) => {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const sec = Math.floor((now - start) / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}m ${s}s`;
  };

  const step1Label = (r: RunRow) => {
    if (r.step1Status === "running") return "GET Active Sales…";
    if (r.step1Status === "completed")
      return `GET Active Sales completed (${r.step1Count} properties)`;
    if (r.step1Status === "failed") return `GET Active Sales failed${r.step1Error ? `: ${r.step1Error}` : ""}`;
    return "GET Active Sales pending";
  };

  const step2Label = (r: RunRow) => {
    if (r.step2Status === "running")
      return `GET Sale Details in progress (${r.step2Count}/${r.step2Total})`;
    if (r.step2Status === "completed")
      return `GET Sale Details completed (${r.step2Count} properties)`;
    if (r.step2Status === "failed") return `GET Sale Details failed${r.step2Error ? `: ${r.step2Error}` : ""}`;
    return "GET Sale Details pending";
  };

  return (
    <>
      <h1 className="page-title">Runs</h1>
      <p className="card" style={{ marginBottom: "1rem" }}>
        Two-step flow: GET Active Sales with filters → GET Sale details by URL for each listing.
        Results appear as properties in the raw data lake (Property Data). Set{" "}
        <code>RAPIDAPI_KEY</code> in the API server.
      </p>

      <form onSubmit={handleSubmit} className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Filters</h2>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
            Areas (required)
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              maxHeight: "8rem",
              overflowY: "auto",
              padding: "0.5rem",
              border: "1px solid #27272a",
              borderRadius: 6,
              background: "#18181b",
            }}
          >
            {AREA_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedAreas.includes(opt.value)}
                  onChange={() => toggleArea(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#a1a1aa", marginTop: "0.25rem" }}>
            Selected: {selectedAreas.length > 0 ? selectedAreas.join(", ") : "all-downtown, all-midtown (default)"}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "0.75rem 1rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Min price
            </label>
            <input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max price
            </label>
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Min beds
            </label>
            <input
              type="number"
              min={0}
              value={minBeds}
              onChange={(e) => setMinBeds(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max beds
            </label>
            <input
              type="number"
              min={0}
              value={maxBeds}
              onChange={(e) => setMaxBeds(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Min baths
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={minBaths}
              onChange={(e) => setMinBaths(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max HOA
            </label>
            <input
              type="number"
              value={maxHoa}
              onChange={(e) => setMaxHoa(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max tax
            </label>
            <input
              type="number"
              value={maxTax}
              onChange={(e) => setMaxTax(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Limit (properties)
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="input-text"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
            Amenities (e.g. washer_dryer,doorman)
          </label>
          <input
            type="text"
            value={amenities}
            onChange={(e) => setAmenities(e.target.value)}
            className="input-text"
            placeholder="—"
            style={{ width: "100%", maxWidth: "20rem" }}
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
            Types (e.g. condo)
          </label>
          <input
            type="text"
            value={types}
            onChange={(e) => setTypes(e.target.value)}
            className="input-text"
            placeholder="—"
            style={{ width: "100%", maxWidth: "20rem" }}
          />
        </div>

        <button type="submit" disabled={sending} className="btn-primary">
          {sending ? "Starting run…" : "Send (run two-step flow)"}
        </button>
      </form>

      {error && (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {loading && <div className="card">Loading runs…</div>}

      {!loading && (
        <div className="card" style={{ maxWidth: "none" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Runs log</h2>
          {runs.length === 0 ? (
            <p style={{ color: "#a1a1aa" }}>No runs yet. Use filters above and click Send.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      Started (timer)
                    </th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      Step 1
                    </th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      Step 2
                    </th>
                    <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      Properties
                    </th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                        <div>{formatTime(run.startedAt)}</div>
                        <div style={{ fontSize: "0.75rem", color: "#a1a1aa" }}>
                          Elapsed: {elapsed(run.startedAt)}
                        </div>
                      </td>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                        <span
                          className={
                            run.step1Status === "failed" ? "error" : run.step1Status === "running" ? "" : ""
                          }
                        >
                          {step1Label(run)}
                        </span>
                      </td>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                        <span
                          className={
                            run.step2Status === "failed" ? "error" : run.step2Status === "running" ? "" : ""
                          }
                        >
                          {step2Label(run)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                        {run.propertiesCount}
                        {run.errorsCount > 0 && (
                          <span className="error" style={{ marginLeft: "0.35rem" }}>
                            ({run.errorsCount} errors)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                        <Link href={`/runs/${run.id}`}>View properties</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
