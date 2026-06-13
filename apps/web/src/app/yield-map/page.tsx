"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { formatPercent, EMPTY_VALUE } from "@/lib/format";
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
  ltrListedYieldPct: number | null;
  ltrWhisperYieldPct: number | null;
  ltrNegotiatedYieldPct: number | null;
  mtrYieldPct: number | null;
  mtrNegotiatedYieldPct: number | null;
  yieldSpreadPct: number | null;
  currentNoi: number | null;
  adjustedNoi: number | null;
  listedPrice: number | null;
  whisperPrice: number | null;
  inputPrice: number | null;
  negotiatedPrice: number | null;
  negotiatedPriceSource: "input" | "whisper" | "listed" | "om" | "signal" | null;
  whisperSource: string | null;
  pricePerUnit: number | null;
  pricePsf: number | null;
  expenseRatioPct: number | null;
  dealScore: number | null;
  signalAt?: string | null;
  yieldSource?: "signal" | "derived";
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

interface LocationStat {
  name: string;
  count: number;
  medianYieldPct: number | null;
  minYieldPct: number | null;
  maxYieldPct: number | null;
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
  sourced: "#94a3b8",
  om_requested: "#2563eb",
  underwriting_awaiting_review: "#d97706",
  underwriting_review_completed: "#f59e0b",
  tour_requested: "#8b5cf6",
  tour_scheduled: "#7c3aed",
  tour_completed_awaiting_inputs: "#6d28d9",
  drafting_loi: "#0f766e",
  loi_sent_awaiting_response: "#14b8a6",
  negotiation: "#0d9488",
  contract_signed_diligence: "#16a34a",
  deal_closed: "#15803d",
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
  { label: "LOI / Negotiation", color: "#0f766e" },
  { label: "Contract", color: "#16a34a" },
  { label: "Closed", color: "#15803d" },
];

function stagePinColor(stage: string | null): string {
  return (stage && STAGE_PIN_COLORS[stage]) || "#cbd5e1";
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function summarizeLocation(rows: CompRow[], key: "borough" | "neighborhood", limit = 8): LocationStat[] {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const name = (row[key] ?? "Unknown").trim() || "Unknown";
    const yieldValue = row.ltrNegotiatedYieldPct ?? row.ltrYieldPct;
    if (yieldValue == null) continue;
    grouped.set(name, [...(grouped.get(name) ?? []), yieldValue]);
  }
  return [...grouped.entries()]
    .map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        name,
        count: values.length,
        medianYieldPct: median(sorted),
        minYieldPct: sorted[0] ?? null,
        maxYieldPct: sorted[sorted.length - 1] ?? null,
      };
    })
    .sort((a, b) => b.count - a.count || (b.medianYieldPct ?? -Infinity) - (a.medianYieldPct ?? -Infinity))
    .slice(0, limit);
}

function sourceLabel(source: CompRow["negotiatedPriceSource"]): string {
  if (source === "input") return "User input";
  if (source === "whisper") return "Broker whisper";
  if (source === "listed") return "Listed price";
  if (source === "om") return "OM ask";
  if (source === "signal") return "Signal";
  return EMPTY_VALUE;
}

function displayStage(row: CompRow): string {
  const value = row.dealStage ?? row.dealState;
  return value ? value.replace(/_/g, " ") : EMPTY_VALUE;
}

export default function YieldMapPage() {
  const [data, setData] = useState<CompsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boroughFilter, setBoroughFilter] = useState("");
  const [neighborhoodFilter, setNeighborhoodFilter] = useState("");
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
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

  const allRows = useMemo(() => data?.comps ?? [], [data]);

  const includedRows = useMemo(
    () => allRows.filter((row) => !excludedIds.has(row.propertyId)),
    [allRows, excludedIds]
  );

  const excludedRows = useMemo(
    () => allRows.filter((row) => excludedIds.has(row.propertyId)),
    [allRows, excludedIds]
  );

  const rows = useMemo(() => {
    return includedRows.filter((row) => {
      if (boroughFilter && (row.borough ?? "Unknown") !== boroughFilter) return false;
      if (neighborhoodFilter && (row.neighborhood ?? "Unknown") !== neighborhoodFilter) return false;
      return true;
    });
  }, [boroughFilter, includedRows, neighborhoodFilter]);

  const activeYieldValues = useMemo(
    () =>
      rows
        .map((row) => row.ltrNegotiatedYieldPct ?? row.ltrYieldPct)
        .filter((value): value is number => value != null),
    [rows]
  );

  const averageActiveYield = useMemo(() => average(activeYieldValues), [activeYieldValues]);
  const medianActiveYield = useMemo(() => median(activeYieldValues), [activeYieldValues]);

  const boroughStats = useMemo(() => summarizeLocation(includedRows, "borough"), [includedRows]);
  const neighborhoodStats = useMemo(() => summarizeLocation(includedRows, "neighborhood", 10), [includedRows]);

  const geoRows = useMemo(() => rows.filter((row) => row.lat != null && row.lng != null), [rows]);

  const pins = useMemo<MapPin[]>(
    () =>
      geoRows.map((row) => ({
        propertyId: row.propertyId,
        address: row.canonicalAddress,
        lat: row.lat!,
        lng: row.lng!,
        color: colorBy === "yield" ? yieldColor(row.ltrNegotiatedYieldPct ?? row.ltrYieldPct) : stagePinColor(row.dealStage),
        lines: [
          `LTR listed ${fmtPct(row.ltrListedYieldPct, 2)} | whisper ${fmtPct(row.ltrWhisperYieldPct, 2)}`,
          `LTR negotiated ${fmtPct(row.ltrNegotiatedYieldPct ?? row.ltrYieldPct, 2)} via ${sourceLabel(row.negotiatedPriceSource)}`,
          `MTR negotiated ${fmtPct(row.mtrNegotiatedYieldPct ?? row.mtrYieldPct, 2)}`,
          `NOI ${formatCompactCurrency(row.currentNoi)} | price ${formatCompactCurrency(row.negotiatedPrice)}`,
          `Stage: ${displayStage(row)}`,
        ],
      })),
    [colorBy, geoRows]
  );

  const boroughOptions = useMemo(
    () => [...new Set(includedRows.map((row) => row.borough ?? "Unknown"))].sort(),
    [includedRows]
  );

  const setBoroughChip = (name: string) => {
    setBoroughFilter((current) => (current === name ? "" : name));
  };

  const setNeighborhoodChip = (name: string) => {
    setNeighborhoodFilter((current) => (current === name ? "" : name));
  };

  const excludeRow = (propertyId: string) => {
    setExcludedIds((current) => {
      const next = new Set(current);
      next.add(propertyId);
      return next;
    });
  };

  const restoreRow = (propertyId: string) => {
    setExcludedIds((current) => {
      const next = new Set(current);
      next.delete(propertyId);
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Living comps"
        title="Yield Map"
        subtitle="Every deal with calculated yield variants from OMs, broker docs, listings, and notes - active, dead, or closed. This is the market-research layer building itself as you source."
        actions={
          <div className={styles.headerFilters}>
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
          </div>
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
          {boroughFilter || neighborhoodFilter || excludedRows.length > 0 ? (
            <div className={styles.filterChipBar}>
              {boroughFilter ? (
                <button type="button" className={styles.filterChip} onClick={() => setBoroughFilter("")}>
                  Borough: {boroughFilter} x
                </button>
              ) : null}
              {neighborhoodFilter ? (
                <button type="button" className={styles.filterChip} onClick={() => setNeighborhoodFilter("")}>
                  Neighborhood: {neighborhoodFilter} x
                </button>
              ) : null}
              {excludedRows.length > 0 ? (
                <span className={styles.filterNote}>{excludedRows.length} excluded from this view</span>
              ) : null}
            </div>
          ) : null}

          <div className={styles.kpiStrip}>
            <StatCard
              tone="neutral"
              label="Active deals"
              value={rows.length}
            />
            <StatCard
              tone="brand"
              label="Median LTR negotiated"
              value={formatPercent(medianActiveYield, 2)}
            />
            <StatCard
              tone="warning"
              label="Average LTR negotiated"
              value={formatPercent(averageActiveYield, 2)}
            />
            <StatCard
              tone="neutral"
              label="Mapped"
              value={`${geoRows.length}/${rows.length}`}
            />
          </div>

          <div className={styles.panel}>
            <div className={styles.mapHeader}>
              <span className={styles.mapTitle}>
                Deal map - pins colored by {colorBy === "yield" ? "LTR negotiated yield" : "deal stage"}
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
                from matched listings automatically; Deals and Comp Flow still shows every active yield-bearing deal.
              </div>
            )}
          </div>

          <div className={styles.summaryGrid}>
            <div className={styles.panel}>
              <div className={styles.panelTitleRow}>
                <span className={styles.tableTitle}>Cap rates by borough</span>
                <span className={styles.panelMeta}>{boroughStats.length} markets</span>
              </div>
              <table className={`${styles.table} ${styles.summaryTable}`}>
                <thead>
                  <tr>
                    <th>Borough</th>
                    <th>Deals</th>
                    <th>Median</th>
                    <th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {boroughStats.map((stat) => (
                    <tr key={stat.name} className={boroughFilter === stat.name ? styles.activeSummaryRow : undefined}>
                      <td className={styles.boroughName}>
                        <button type="button" className={styles.summaryFilterButton} onClick={() => setBoroughChip(stat.name)}>
                          {stat.name}
                        </button>
                      </td>
                      <td>{stat.count}</td>
                      <td className={styles.boroughMedian} style={{ color: yieldColor(stat.medianYieldPct) }}>
                        {fmtPct(stat.medianYieldPct, 2)}
                      </td>
                      <td className={styles.boroughRange}>{fmtPct(stat.minYieldPct)}-{fmtPct(stat.maxYieldPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelTitleRow}>
                <span className={styles.tableTitle}>Cap rates by neighborhood</span>
                <span className={styles.panelMeta}>Top {neighborhoodStats.length}</span>
              </div>
              <table className={`${styles.table} ${styles.summaryTable}`}>
                <thead>
                  <tr>
                    <th>Neighborhood</th>
                    <th>Deals</th>
                    <th>Median</th>
                    <th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {neighborhoodStats.map((stat) => (
                    <tr key={stat.name} className={neighborhoodFilter === stat.name ? styles.activeSummaryRow : undefined}>
                      <td className={styles.boroughName}>
                        <button type="button" className={styles.summaryFilterButton} onClick={() => setNeighborhoodChip(stat.name)}>
                          {stat.name}
                        </button>
                      </td>
                      <td>{stat.count}</td>
                      <td className={styles.boroughMedian} style={{ color: yieldColor(stat.medianYieldPct) }}>
                        {fmtPct(stat.medianYieldPct, 2)}
                      </td>
                      <td className={styles.boroughRange}>{fmtPct(stat.minYieldPct)}-{fmtPct(stat.maxYieldPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`${styles.panel} ${styles.flowPanel}`}>
            <div className={styles.flowHeader}>
              <div>
                <span className={styles.tableTitle}>Deals and Comp Flow</span>
                <p className={styles.flowSubtitle}>
                  Listed, whisper, and negotiated yield views use the same NOI base, with negotiated falling back from user input to whisper to listed price.
                </p>
              </div>
              <span className={styles.panelMeta}>
                Showing {rows.length} of {includedRows.length}
              </span>
            </div>

            {excludedRows.length > 0 ? (
              <div className={styles.excludedTray}>
                <span>Excluded from this page view</span>
                <div className={styles.excludedList}>
                  {excludedRows.map((row) => (
                    <button key={row.propertyId} type="button" onClick={() => restoreRow(row.propertyId)}>
                      Restore {row.canonicalAddress.split(",")[0]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.flowTable}`}>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>LTR listed</th>
                    <th>LTR whisper</th>
                    <th>LTR negotiated</th>
                    <th>MTR negotiated</th>
                    <th>NOI</th>
                    <th>Price</th>
                    <th>Units</th>
                    <th>$/Unit</th>
                    <th>$/SF</th>
                    <th className={styles.stageColumn}>Stage</th>
                    <th className={styles.sourceColumn}>Source</th>
                    <th>Exclude</th>
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
                      <td className={styles.yieldCell} style={{ color: yieldColor(row.ltrListedYieldPct) }}>
                        {fmtPct(row.ltrListedYieldPct, 2)}
                      </td>
                      <td className={styles.yieldCell} style={{ color: yieldColor(row.ltrWhisperYieldPct) }}>
                        {fmtPct(row.ltrWhisperYieldPct, 2)}
                      </td>
                      <td className={styles.yieldCell} style={{ color: yieldColor(row.ltrNegotiatedYieldPct ?? row.ltrYieldPct) }}>
                        {fmtPct(row.ltrNegotiatedYieldPct ?? row.ltrYieldPct, 2)}
                      </td>
                      <td>{fmtPct(row.mtrNegotiatedYieldPct ?? row.mtrYieldPct, 2)}</td>
                      <td>{formatCompactCurrency(row.currentNoi)}</td>
                      <td>{formatCompactCurrency(row.negotiatedPrice)}</td>
                      <td>{row.units ?? EMPTY_VALUE}</td>
                      <td>{formatCompactCurrency(row.pricePerUnit)}</td>
                      <td>{formatCompactCurrency(row.pricePsf)}</td>
                      <td className={`${styles.stageCell} ${styles.stageColumn}`}>{displayStage(row)}</td>
                      <td className={`${styles.sourceCell} ${styles.sourceColumn}`}>
                        <strong>{sourceLabel(row.negotiatedPriceSource)}</strong>
                        <span>
                          {row.negotiatedPriceSource === "whisper" && row.whisperSource
                            ? row.whisperSource
                            : formatCompactCurrency(row.negotiatedPrice)}
                        </span>
                      </td>
                      <td>
                        <button type="button" className={styles.excludeButton} onClick={() => excludeRow(row.propertyId)}>
                          Exclude
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={13}>
                        No deals match the active filters. Clear a chip or restore excluded rows to repopulate the flow.
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
