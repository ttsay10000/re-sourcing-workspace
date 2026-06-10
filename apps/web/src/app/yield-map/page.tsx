"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

interface CompRow {
  propertyId: string;
  canonicalAddress: string;
  borough: string | null;
  neighborhood: string | null;
  dealState: string | null;
  dealStage: string | null;
  lat: number | null;
  lng: number | null;
  units: number | null;
  ltrYieldPct: number | null;
  mtrYieldPct: number | null;
  yieldSpreadPct: number | null;
  currentNoi: number | null;
  pricePerUnit: number | null;
  pricePsf: number | null;
  expenseRatioPct: number | null;
  dealScore: number | null;
}

interface BoroughStat {
  borough: string;
  count: number;
  medianLtrYieldPct: number;
  minLtrYieldPct: number;
  maxLtrYieldPct: number;
}

interface CompsResponse {
  comps: CompRow[];
  summary: {
    count: number;
    withCoordinates: number;
    averageLtrYieldPct: number | null;
    medianLtrYieldPct: number | null;
    boroughStats: BoroughStat[];
  };
}

const YIELD_BANDS = [
  { min: 6.5, label: "6.5%+", color: "#0f766e" },
  { min: 5.5, label: "5.5-6.5%", color: "#16a34a" },
  { min: 4.5, label: "4.5-5.5%", color: "#d97706" },
  { min: -Infinity, label: "< 4.5%", color: "#94a3b8" },
];

function yieldColor(value: number | null): string {
  if (value == null) return "#cbd5e1";
  for (const band of YIELD_BANDS) {
    if (value >= band.min) return band.color;
  }
  return "#cbd5e1";
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(digits)}%` : "—";
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const card: React.CSSProperties = {
  background: "var(--app-surface, #fff)",
  border: "1px solid var(--app-line, #e4e4e7)",
  borderRadius: "14px",
  padding: "1.1rem 1.2rem",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
};

const kpiLabel: React.CSSProperties = {
  fontSize: "0.68rem",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--app-muted, #71717a)",
};

const kpiValue: React.CSSProperties = {
  fontSize: "1.55rem",
  fontWeight: 850,
  color: "var(--app-ink, #18181b)",
  fontVariantNumeric: "tabular-nums",
};

export default function YieldMapPage() {
  const [data, setData] = useState<CompsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boroughFilter, setBoroughFilter] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${API_BASE}/api/comps/operating`, { credentials: "include", signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as CompsResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setData(payload);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load yield map.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    const all = data?.comps ?? [];
    if (!boroughFilter) return all;
    return all.filter((row) => (row.borough ?? "Unknown") === boroughFilter);
  }, [data, boroughFilter]);

  const geoRows = useMemo(() => rows.filter((row) => row.lat != null && row.lng != null), [rows]);

  const bounds = useMemo(() => {
    if (geoRows.length < 2) return null;
    const lats = geoRows.map((row) => row.lat!);
    const lngs = geoRows.map((row) => row.lng!);
    const pad = 0.004;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad,
    };
  }, [geoRows]);

  const boroughOptions = useMemo(
    () => [...new Set((data?.comps ?? []).map((row) => row.borough ?? "Unknown"))].sort(),
    [data]
  );

  return (
    <div style={{ display: "grid", gap: "1rem", padding: "0.25rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ ...kpiLabel, margin: 0 }}>Living database</p>
          <h1 style={{ margin: "0.15rem 0 0", fontSize: "1.45rem", fontWeight: 850, color: "var(--app-ink)" }}>
            Yield Map
          </h1>
          <p style={{ margin: "0.3rem 0 0", color: "var(--app-muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
            Every deal with a calculated LTR yield (extracted NOI ÷ price) from OMs, broker docs, and notes —
            active, dead, or closed. This is the market-research layer building itself as you source.
          </p>
        </div>
        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.78rem", fontWeight: 800, color: "var(--app-ink-secondary)" }}>
          Borough
          <select
            value={boroughFilter}
            onChange={(event) => setBoroughFilter(event.target.value)}
            style={{ padding: "0.45rem 0.6rem", borderRadius: "9px", border: "1px solid var(--app-line)", background: "#fff", fontSize: "0.85rem" }}
          >
            <option value="">All boroughs</option>
            {boroughOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div style={{ ...card, borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b", fontSize: "0.9rem" }}>{error}</div>
      ) : null}
      {loading ? <div style={{ ...card, color: "var(--app-muted)" }}>Loading yield data…</div> : null}

      {!loading && data ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.8rem" }}>
            <div style={{ ...card, borderLeft: "4px solid #0f766e" }}>
              <div style={kpiLabel}>Deals with yield</div>
              <div style={kpiValue}>{rows.length}</div>
            </div>
            <div style={{ ...card, borderLeft: "4px solid #16a34a" }}>
              <div style={kpiLabel}>Median LTR yield</div>
              <div style={kpiValue}>{fmtPct(data.summary.medianLtrYieldPct, 2)}</div>
            </div>
            <div style={{ ...card, borderLeft: "4px solid #d97706" }}>
              <div style={kpiLabel}>Average LTR yield</div>
              <div style={kpiValue}>{fmtPct(data.summary.averageLtrYieldPct, 2)}</div>
            </div>
            <div style={{ ...card, borderLeft: "4px solid #64748b" }}>
              <div style={kpiLabel}>Mapped</div>
              <div style={kpiValue}>{geoRows.length}</div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
              <strong style={{ fontSize: "0.92rem", color: "var(--app-ink)" }}>Deal map — pins colored by LTR yield</strong>
              <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
                {YIELD_BANDS.map((band) => (
                  <span key={band.label} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.74rem", fontWeight: 700, color: "var(--app-ink-secondary)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: band.color, display: "inline-block" }} />
                    {band.label}
                  </span>
                ))}
              </div>
            </div>
            {bounds ? (
              <svg
                viewBox="0 0 860 540"
                style={{ width: "100%", height: "auto", background: "#f8fafc", borderRadius: "12px", border: "1px solid var(--app-line-subtle, #f4f4f5)" }}
                role="img"
                aria-label="Scatter map of deals colored by LTR yield"
              >
                {geoRows.map((row) => {
                  const x = 24 + ((row.lng! - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (860 - 48);
                  const y = 24 + (1 - (row.lat! - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * (540 - 48);
                  return (
                    <a key={row.propertyId} href={`/deal-analysis?propertyId=${encodeURIComponent(row.propertyId)}`}>
                      <circle cx={x} cy={y} r={7.5} fill={yieldColor(row.ltrYieldPct)} fillOpacity={0.88} stroke="#ffffff" strokeWidth={1.6}>
                        <title>
                          {`${row.canonicalAddress}\nLTR yield ${fmtPct(row.ltrYieldPct, 2)} · MTR ${fmtPct(row.mtrYieldPct, 2)}\nNOI ${fmtMoney(row.currentNoi)} · ${row.units ?? "—"} units · ${row.dealStage ?? row.dealState ?? "unstaged"}`}
                        </title>
                      </circle>
                    </a>
                  );
                })}
              </svg>
            ) : (
              <div style={{ color: "var(--app-muted)", fontSize: "0.88rem", lineHeight: 1.5 }}>
                Not enough geocoded deals to plot yet ({geoRows.length} with coordinates). Coordinates backfill
                from matched listings automatically; the table below shows every yield-bearing deal regardless.
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 0.8fr) minmax(0, 1.6fr)", gap: "1rem", alignItems: "start" }}>
            <div style={card}>
              <strong style={{ fontSize: "0.92rem", color: "var(--app-ink)" }}>Cap rates by borough</strong>
              <table style={{ width: "100%", marginTop: "0.6rem", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--app-muted)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    <th style={{ padding: "0.3rem 0" }}>Borough</th>
                    <th>Deals</th>
                    <th>Median</th>
                    <th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary.boroughStats.map((stat) => (
                    <tr key={stat.borough} style={{ borderTop: "1px solid var(--app-line-subtle)" }}>
                      <td style={{ padding: "0.45rem 0", fontWeight: 700 }}>{stat.borough}</td>
                      <td>{stat.count}</td>
                      <td style={{ fontWeight: 800, color: yieldColor(stat.medianLtrYieldPct) }}>{fmtPct(stat.medianLtrYieldPct, 2)}</td>
                      <td style={{ color: "var(--app-muted)" }}>{fmtPct(stat.minLtrYieldPct)}–{fmtPct(stat.maxLtrYieldPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ ...card, overflowX: "auto" }}>
              <strong style={{ fontSize: "0.92rem", color: "var(--app-ink)" }}>All yield-bearing deals</strong>
              <table style={{ width: "100%", marginTop: "0.6rem", borderCollapse: "collapse", fontSize: "0.84rem", fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--app-muted)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    <th style={{ padding: "0.3rem 0.4rem 0.3rem 0" }}>Address</th>
                    <th>LTR yield</th>
                    <th>MTR</th>
                    <th>NOI</th>
                    <th>Units</th>
                    <th>$/Unit</th>
                    <th>$/SF</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.propertyId} style={{ borderTop: "1px solid var(--app-line-subtle)" }}>
                      <td style={{ padding: "0.45rem 0.4rem 0.45rem 0" }}>
                        <a href={`/deal-analysis?propertyId=${encodeURIComponent(row.propertyId)}`} style={{ fontWeight: 750, color: "var(--app-ink)" }}>
                          {row.canonicalAddress.split(",")[0]}
                        </a>
                        <div style={{ fontSize: "0.72rem", color: "var(--app-muted)" }}>{row.neighborhood ?? row.borough ?? ""}</div>
                      </td>
                      <td style={{ fontWeight: 850, color: yieldColor(row.ltrYieldPct) }}>{fmtPct(row.ltrYieldPct, 2)}</td>
                      <td>{fmtPct(row.mtrYieldPct, 2)}</td>
                      <td>{fmtMoney(row.currentNoi)}</td>
                      <td>{row.units ?? "—"}</td>
                      <td>{fmtMoney(row.pricePerUnit)}</td>
                      <td>{fmtMoney(row.pricePsf)}</td>
                      <td style={{ color: "var(--app-muted)", fontSize: "0.78rem" }}>{row.dealStage ?? row.dealState ?? "—"}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "0.8rem 0", color: "var(--app-muted)" }}>
                        No deals with calculated yields yet — run OM analysis or compute scores to populate the living database.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
