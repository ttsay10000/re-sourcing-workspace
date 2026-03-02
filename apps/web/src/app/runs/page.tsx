"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AREA_TREE, isIncludedByParent, type AreaNode } from "./areas";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const BEDS_BATHS_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4] as const;

// Active Sales Search API supports only: condo, coop, house (https://streasy.gitbook.io/search-api)
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "condo", label: "Condo" },
  { value: "coop", label: "Co-op" },
  { value: "house", label: "House" },
];

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
  /** Exclude these types after fetch (e.g. condo,coop,house → multifamily only). */
  excludeTypes?: string | null;
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
  const [sendingRunId, setSendingRunId] = useState<string | null>(null);
  const [sendTimerSeconds, setSendTimerSeconds] = useState(0);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const [multifamilyOnly, setMultifamilyOnly] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
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

  // Timer while sending to property data (LLM enrichment in progress)
  useEffect(() => {
    if (sendingRunId) {
      setSendTimerSeconds(0);
      sendTimerRef.current = setInterval(() => setSendTimerSeconds((s) => s + 1), 1000);
    } else {
      if (sendTimerRef.current) {
        clearInterval(sendTimerRef.current);
        sendTimerRef.current = null;
      }
      setSendTimerSeconds(0);
    }
    return () => {
      if (sendTimerRef.current) {
        clearInterval(sendTimerRef.current);
        sendTimerRef.current = null;
      }
    };
  }, [sendingRunId]);

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
      limit: limit ? Math.min(Number(limit), 500) : 100,
    };
    if (minPrice !== "") body.minPrice = Number(minPrice);
    if (maxPrice !== "") body.maxPrice = Number(maxPrice);
    if (minBeds !== "") body.minBeds = Number(minBeds);
    if (maxBeds !== "") body.maxBeds = Number(maxBeds);
    if (minBaths !== "") body.minBaths = Number(minBaths);
    if (maxHoa !== "") body.maxHoa = Number(maxHoa);
    if (maxTax !== "") body.maxTax = Number(maxTax);
    if (amenities.trim()) body.amenities = amenities.trim();
    if (multifamilyOnly) {
      body.excludeTypes = "condo,coop,house,townhouse";
    } else if (selectedTypes.length > 0) {
      body.types = selectedTypes.join(",");
    }

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

  const renderAreaNodes = (nodes: AreaNode[], depth: number) =>
    nodes.map((opt) => {
      const includedByParent = isIncludedByParent(opt.value, selectedAreas);
      const isChecked = selectedAreas.includes(opt.value) || includedByParent;
      const isBold = /^all\s/i.test(opt.label);
      return (
        <div key={opt.value}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: "0.5rem",
              fontSize: "0.85rem",
              cursor: includedByParent ? "default" : "pointer",
              paddingLeft: depth * 1.25 + "rem",
              opacity: includedByParent ? 0.6 : 1,
              color: includedByParent ? "#525252" : undefined,
            }}
          >
            <input
              type="checkbox"
              checked={isChecked}
              disabled={includedByParent}
              onChange={() => !includedByParent && toggleArea(opt.value)}
            />
            <span style={{ fontWeight: isBold ? 700 : 400 }}>{opt.label}</span>
          </label>
          {opt.children?.length ? renderAreaNodes(opt.children, depth + 1) : null}
        </div>
      );
    });

  const toggleType = (value: string) => {
    setSelectedTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    );
  };

  const handleMultifamilyOnlyChange = (checked: boolean) => {
    setMultifamilyOnly(checked);
    if (checked) setSelectedTypes([]);
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

  const handleSendToPropertyData = (runId: string) => {
    setSendingRunId(runId);
    setError(null);
    fetch(`${API_BASE}/api/test-agent/runs/${runId}/send-to-property-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, status: r.status, data })))
      .then(({ ok, data }) => {
        if (!ok && data?.error) {
          const detail = data.details ? ` — ${data.details}` : "";
          throw new Error(data.error + detail);
        }
        if (data?.error) throw new Error(data.error);
        setSendingRunId(null);
        const runNum = data?.runNumber != null ? ` Run #${data.runNumber} logged.` : "";
        const msg = [data?.created ?? 0, data?.updated ?? 0].some((n) => n > 0)
          ? `${data?.created ?? 0} created, ${data?.updated ?? 0} updated.${runNum}`
          : runNum || "Sent.";
        window.location.href = `/property-data?sent=${encodeURIComponent(msg)}`;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to send to property data");
        setSendingRunId(null);
      });
  };

  return (
    <div className="runs-page">
      <h1 className="page-title">Runs</h1>

      {sendingRunId && (
        <div
          className="card"
          role="status"
          aria-live="polite"
          style={{
            marginBottom: "1.5rem",
            padding: "0.75rem 1rem",
            background: "#fef9c3",
            borderColor: "#facc15",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 600 }}>
            Sending to property data — enriching brokers &amp; price history…
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {formatElapsed(sendTimerSeconds)}
          </span>
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem", fontWeight: 600 }}>
          How it works
        </h2>
        <p style={{ marginBottom: "0.75rem", lineHeight: 1.5 }}>
          Runs use a two-step flow to pull NYC real estate data into your raw data lake:
        </p>
        <ol style={{ marginBottom: "0.75rem", paddingLeft: "1.5rem", lineHeight: 1.6 }}>
          <li>
            <strong>Step 1 — GET Active Sales:</strong> The API returns a list of active listings
            that match your filters (areas, price, beds, baths, types, etc.). Each listing includes
            a StreetEasy URL.
          </li>
          <li>
            <strong>Step 2 — GET Sale details by URL:</strong> For each URL from step 1, the API
            is called again to fetch full property details. Those results are stored as separate
            properties and appear in the runs log below and in{" "}
            <Link href="/property-data">Property Data</Link> (raw data lake).
          </li>
        </ol>
        <p style={{ marginBottom: "0.5rem", lineHeight: 1.5 }}>
          Choose your filters, set a limit on how many properties to fetch, then click{" "}
          <strong>Send</strong>. Each run appears in the log with step progress. When a run is
          complete, use <strong>Send to property data</strong> to persist that run&apos;s
          properties into Property Data (raw listings). Data is not auto-populated.
        </p>
        <p style={{ fontSize: "0.875rem", color: "#525252", marginTop: "0.5rem" }}>
          <strong>Filters (Active Sales API):</strong> Property type is limited to Condo, Co-op, House
          (multifamily is not supported by the API). Step 2 (Get Sale by URL) returns full details
          (e.g. propertyType, monthlyHoa, monthlyTax) per listing but has no filter parameters.
          If you use <strong>Exclude types</strong> (e.g. Multifamily only), the step counts show
          how many were fetched; the <strong>Properties</strong> column shows how many remain after
          excluding those types.
        </p>
        <p style={{ fontSize: "0.875rem", color: "#525252", marginTop: "0.75rem" }}>
          Ensure <code>RAPIDAPI_KEY</code> is set in the API server environment (see{" "}
          <code>ENV.md</code>).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Filters</h2>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>
            Areas (required)
          </label>
          <div
            className="runs-areas-list"
            style={{
              maxHeight: "10rem",
              overflowY: "auto",
              padding: "0.75rem 1rem",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              background: "#f5f5f5",
            }}
          >
            {AREA_TREE.map((node) => renderAreaNodes([node], 0))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#525252", marginTop: "0.35rem" }}>
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
            <select
              value={minBeds}
              onChange={(e) => setMinBeds(e.target.value)}
              className="input-text"
              style={{ width: "100%" }}
            >
              <option value="">—</option>
              {BEDS_BATHS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max beds
            </label>
            <select
              value={maxBeds}
              onChange={(e) => setMaxBeds(e.target.value)}
              className="input-text"
              style={{ width: "100%" }}
            >
              <option value="">—</option>
              {BEDS_BATHS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Min baths
            </label>
            <select
              value={minBaths}
              onChange={(e) => setMinBaths(e.target.value)}
              className="input-text"
              style={{ width: "100%" }}
            >
              <option value="">—</option>
              {BEDS_BATHS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max HOA/mo
            </label>
            <input
              type="number"
              min={0}
              value={maxHoa}
              onChange={(e) => setMaxHoa(e.target.value)}
              className="input-text"
              placeholder="—"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Max tax/mo
            </label>
            <input
              type="number"
              min={0}
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
              max={500}
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
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              marginBottom: "0.5rem",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={multifamilyOnly}
              onChange={(e) => handleMultifamilyOnlyChange(e.target.checked)}
            />
            <strong>Multifamily only</strong> (exclude Condo, Co-op, House, Townhouse — run returns multifamily and other types)
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              padding: "0.5rem",
              border: "1px solid #e5e5e5",
              borderRadius: 6,
              background: "#f5f5f5",
              marginTop: "0.35rem",
              opacity: multifamilyOnly ? 0.5 : 1,
              pointerEvents: multifamilyOnly ? "none" : "auto",
            }}
          >
            {TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.85rem",
                  cursor: multifamilyOnly ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(opt.value)}
                  disabled={multifamilyOnly}
                  onChange={() => toggleType(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "#525252", marginTop: "0.35rem" }}>
            {multifamilyOnly
              ? "Include types are disabled when Multifamily only is on."
              : "Optionally include only these property types (API filter). Leave unchecked for all types."}
          </p>
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
            <p style={{ color: "#525252" }}>No runs yet. Use filters above and click Send.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      Started (timer)
                    </th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      Step 1
                    </th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      Step 2
                    </th>
                    <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      Properties
                    </th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                        <div>{formatTime(run.startedAt)}</div>
                        <div style={{ fontSize: "0.75rem", color: "#525252" }}>
                          Elapsed: {elapsed(run.startedAt)}
                        </div>
                      </td>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                        <span
                          className={
                            run.step1Status === "failed" ? "error" : run.step1Status === "running" ? "" : ""
                          }
                        >
                          {step1Label(run)}
                        </span>
                      </td>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                        <span
                          className={
                            run.step2Status === "failed" ? "error" : run.step2Status === "running" ? "" : ""
                          }
                        >
                          {step2Label(run)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                        {run.criteria.excludeTypes?.trim() ? (
                          <span title={`Exclude types: ${run.criteria.excludeTypes}. ${run.propertiesCount} properties remain after filtering.`}>
                            {run.propertiesCount} of {run.step2Total} (after type filter)
                          </span>
                        ) : (
                          run.propertiesCount
                        )}
                        {run.errorsCount > 0 && (
                          <span className="error" style={{ marginLeft: "0.35rem" }}>
                            ({run.errorsCount} errors)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e5e5" }}>
                        <Link href={`/runs/${run.id}`} style={{ marginRight: "0.75rem" }}>
                          View properties
                        </Link>
                        {run.step2Status === "completed" && run.propertiesCount > 0 ? (
                          <button
                            type="button"
                            className="btn-primary"
                            style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                            disabled={sendingRunId === run.id}
                            onClick={() => handleSendToPropertyData(run.id)}
                          >
                            {sendingRunId === run.id ? "Sending…" : "Send to property data"}
                          </button>
                        ) : null}
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
