"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { formatPercent, formatCurrencyExact, EMPTY_VALUE } from "@/lib/format";
import styles from "./yieldMap.module.css";
import { YieldMapCanvas, type MapPin } from "./YieldMapCanvas";

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

/** Page-local formatter: percentage with configurable digits and em-dash fallback. */
function fmtPct(value: number | null | undefined, digits = 1): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(digits)}%` : EMPTY_VALUE;
}

const STAGE_PIN_COLORS: Record<string, string> = {
  inbox: "#94a3b8",
  screening: "#94a3b8",
  pursuing: "#64748b",
  outreach: "#2563eb",
  om_review: "#0ea5e9",
  underwriting: "#d97706",
  tour: "#7c3aed",
  offer_loi: "#0f766e",
  contract_dd: "#16a34a",
  closed: "#15803d",
};

const STAGE_LEGEND = [
  { label: "Sourcing", color: "#94a3b8" },
  { label: "Outreach / OM", color: "#2563eb" },
  { label: "Underwriting", color: "#d97706" },
  { label: "Tour", color: "#7c3aed" },
  { label: "Offer / Contract", color: "#0f766e" },
  { label: "Closed", color: "#15803d" },
];

function stagePinColor(stage: string | null): string {
  return (stage && STAGE_PIN_COLORS[stage]) || "#cbd5e1";
}

export default function YieldMapPage() {
  const [data, setData] = useState<CompsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boroughFilter, setBoroughFilter] = useState("");
  const [colorBy, setColorBy] = useState<"yield" | "stage">("yield");

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

  const pins = useMemo<MapPin[]>(
    () =>
      geoRows.map((row) => ({
        propertyId: row.propertyId,
        address: row.canonicalAddress,
        lat: row.lat!,
        lng: row.lng!,
        color: colorBy === "yield" ? yieldColor(row.ltrYieldPct) : stagePinColor(row.dealStage),
        lines: [
          `LTR ${fmtPct(row.ltrYieldPct, 2)} · MTR ${fmtPct(row.mtrYieldPct, 2)}`,
          `NOI ${formatCurrencyExact(row.currentNoi)} · ${row.units ?? EMPTY_VALUE} units`,
          row.dealStage ? `Stage: ${row.dealStage.replace(/_/g, " ")}` : "Stage: not set",
        ],
      })),
    [colorBy, geoRows]
  );

  const boroughOptions = useMemo(
    () => [...new Set((data?.comps ?? []).map((row) => row.borough ?? "Unknown"))].sort(),
    [data]
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Living comps"
        title="Yield Map"
        subtitle="Every deal with a calculated LTR yield (extracted NOI ÷ price) from OMs, broker docs, and notes — active, dead, or closed. This is the market-research layer building itself as you source."
        actions={
          <label className={styles.filterLabel}>
            Borough
            <select
              className={styles.filterSelect}
              value={boroughFilter}
              onChange={(event) => setBoroughFilter(event.target.value)}
            >
              <option value="">All boroughs</option>
              {boroughOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        }
      />

      {error ? (
        <div className={styles.errorBanner}>{error}</div>
      ) : null}
      {loading ? (
        <div className={styles.loadingBanner}>Loading yield data…</div>
      ) : null}

      {!loading && data ? (
        <>
          <div className={styles.kpiStrip}>
            <StatCard
              tone="neutral"
              label="Deals with yield"
              value={rows.length}
            />
            <StatCard
              tone="brand"
              label="Median LTR yield"
              value={formatPercent(data.summary.medianLtrYieldPct, 2)}
            />
            <StatCard
              tone="warning"
              label="Average LTR yield"
              value={formatPercent(data.summary.averageLtrYieldPct, 2)}
            />
            <StatCard
              tone="neutral"
              label="Mapped"
              value={geoRows.length}
            />
          </div>

          <div className={styles.panel}>
            <div className={styles.mapHeader}>
              <span className={styles.mapTitle}>
                Deal map — pins colored by {colorBy === "yield" ? "LTR yield" : "deal stage"}
              </span>
              <div className={styles.mapControls}>
                <div className={styles.colorToggle} role="group" aria-label="Color pins by">
                  <button
                    type="button"
                    className={colorBy === "yield" ? styles.colorToggleActive : undefined}
                    onClick={() => setColorBy("yield")}
                  >
                    Yield
                  </button>
                  <button
                    type="button"
                    className={colorBy === "stage" ? styles.colorToggleActive : undefined}
                    onClick={() => setColorBy("stage")}
                  >
                    Stage
                  </button>
                </div>
                <div className={styles.legendList}>
                  {(colorBy === "yield" ? YIELD_BANDS : STAGE_LEGEND).map((band) => (
                    <span key={band.label} className={styles.legendItem}>
                      <span className={styles.legendDot} style={{ background: band.color }} />
                      {band.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {geoRows.length > 0 ? (
              <YieldMapCanvas pins={pins} />
            ) : (
              <div className={styles.mapEmpty}>
                No geocoded deals to plot yet ({geoRows.length} with coordinates). Coordinates backfill
                from matched listings automatically; the table below shows every yield-bearing deal regardless.
              </div>
            )}
          </div>

          <div className={styles.dataGrid}>
            <div className={styles.panel}>
              <span className={styles.tableTitle}>Cap rates by borough</span>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Borough</th>
                    <th>Deals</th>
                    <th>Median</th>
                    <th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary.boroughStats.map((stat) => (
                    <tr key={stat.borough}>
                      <td className={styles.boroughName}>{stat.borough}</td>
                      <td>{stat.count}</td>
                      <td className={styles.boroughMedian} style={{ color: yieldColor(stat.medianLtrYieldPct) }}>
                        {fmtPct(stat.medianLtrYieldPct, 2)}
                      </td>
                      <td className={styles.boroughRange}>{fmtPct(stat.minLtrYieldPct)}–{fmtPct(stat.maxLtrYieldPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`${styles.panel} ${styles.tablePanel}`}>
              <span className={styles.tableTitle}>All yield-bearing deals</span>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Address</th>
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
                    <tr key={row.propertyId}>
                      <td className={styles.dealAddressCell}>
                        <a
                          href={`/deal-analysis?propertyId=${encodeURIComponent(row.propertyId)}`}
                          className={styles.dealLink}
                        >
                          {row.canonicalAddress.split(",")[0]}
                        </a>
                        <div className={styles.dealNeighborhood}>{row.neighborhood ?? row.borough ?? ""}</div>
                      </td>
                      <td className={styles.yieldCell} style={{ color: yieldColor(row.ltrYieldPct) }}>
                        {fmtPct(row.ltrYieldPct, 2)}
                      </td>
                      <td>{fmtPct(row.mtrYieldPct, 2)}</td>
                      <td>{formatCurrencyExact(row.currentNoi)}</td>
                      <td>{row.units ?? EMPTY_VALUE}</td>
                      <td>{formatCurrencyExact(row.pricePerUnit)}</td>
                      <td>{formatCurrencyExact(row.pricePsf)}</td>
                      <td className={styles.stageCell}>{row.dealStage ?? row.dealState ?? EMPTY_VALUE}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={8}>
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
