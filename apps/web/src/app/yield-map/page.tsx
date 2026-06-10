"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { formatPercent, formatCurrencyExact, EMPTY_VALUE } from "@/lib/format";
import styles from "./yieldMap.module.css";
import { YieldMapCanvas, type MapPin, type AreaStat } from "./YieldMapCanvas";
import {
  featureBBox,
  featureLabelPoint,
  pointInFeature,
  type FeatureBBox,
  type NeighborhoodCollection,
} from "./geo";

type YieldTrend = "up" | "down" | "flat" | null;

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
  sourcedAt: string | null;
  firstYieldPct: number | null;
  firstYieldAt: string | null;
  yieldDeltaPct: number | null;
  yieldTrend: YieldTrend;
}

interface CompsResponse {
  comps: CompRow[];
  summary: {
    count: number;
    withCoordinates: number;
    averageLtrYieldPct: number | null;
    medianLtrYieldPct: number | null;
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

/** Signed percentage-point delta, e.g. "+0.32pp". */
function fmtDeltaPp(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}pp`;
}

function fmtDateMDY(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMonthYear(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Same flat threshold the API uses — below display precision reads as flat. */
const TREND_FLAT_EPSILON_PP = 0.005;

function trendOfDelta(delta: number | null): YieldTrend {
  if (delta == null) return null;
  return delta > TREND_FLAT_EPSILON_PP ? "up" : delta < -TREND_FLAT_EPSILON_PP ? "down" : "flat";
}

const TREND_GLYPH: Record<NonNullable<YieldTrend>, string> = { up: "▲", down: "▼", flat: "–" };

/** Arrow + signed pp move since the yield was first produced. Tooltip carries the dates. */
function TrendIndicator({ row }: { row: CompRow }) {
  if (row.yieldTrend == null || row.yieldDeltaPct == null) {
    return (
      <span className={styles.trendNone} title="Single observation so far — trend appears after the next data refresh.">
        {EMPTY_VALUE}
      </span>
    );
  }
  const cls = row.yieldTrend === "up" ? styles.trendUp : row.yieldTrend === "down" ? styles.trendDown : styles.trendFlat;
  const title = `First ${fmtPct(row.firstYieldPct, 2)} on ${fmtDateMDY(row.firstYieldAt)} → now ${fmtPct(row.ltrYieldPct, 2)}`;
  return (
    <span className={cls} title={title}>
      {TREND_GLYPH[row.yieldTrend]} {row.yieldTrend === "flat" ? "flat" : fmtDeltaPp(row.yieldDeltaPct)}
    </span>
  );
}

interface AreaTableStat {
  name: string;
  borough: string | null;
  count: number;
  medianYieldPct: number;
  minYieldPct: number;
  maxYieldPct: number;
  upCount: number;
  downCount: number;
  medianDeltaPct: number | null;
  firstSourcedAt: string | null;
}

function groupStats(rows: CompRow[], keyOf: (row: CompRow) => string | null): AreaTableStat[] {
  const groups = new Map<string, CompRow[]>();
  for (const row of rows) {
    if (row.ltrYieldPct == null) continue;
    const key = keyOf(row)?.trim() || "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([name, members]) => {
      const yields = members.map((m) => m.ltrYieldPct as number).sort((a, b) => a - b);
      const deltas = members.map((m) => m.yieldDeltaPct).filter((v): v is number => v != null);
      const firstDates = members
        .map((m) => m.firstYieldAt ?? m.sourcedAt)
        .filter((v): v is string => v != null)
        .sort();
      return {
        name,
        borough: members.find((m) => m.borough)?.borough ?? null,
        count: yields.length,
        medianYieldPct: median(yields) as number,
        minYieldPct: yields[0],
        maxYieldPct: yields[yields.length - 1],
        upCount: members.filter((m) => m.yieldTrend === "up").length,
        downCount: members.filter((m) => m.yieldTrend === "down").length,
        medianDeltaPct: median(deltas),
        firstSourcedAt: firstDates[0] ?? null,
      };
    })
    .sort((a, b) => (a.name === "Unknown" ? 1 : b.name === "Unknown" ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
}

/** Compact "▲ +0.12pp" cell for area tables; em dash when no deal has history yet. */
function AreaTrendCell({ stat }: { stat: AreaTableStat }) {
  const trend = trendOfDelta(stat.medianDeltaPct);
  if (trend == null || stat.medianDeltaPct == null) {
    return <span className={styles.trendNone}>{EMPTY_VALUE}</span>;
  }
  const cls = trend === "up" ? styles.trendUp : trend === "down" ? styles.trendDown : styles.trendFlat;
  const title = `Median move since first sourced · ${stat.upCount} up / ${stat.downCount} down`;
  return (
    <span className={cls} title={title}>
      {TREND_GLYPH[trend]} {trend === "flat" ? "flat" : fmtDeltaPp(stat.medianDeltaPct)}
    </span>
  );
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
  const [showAreas, setShowAreas] = useState(true);
  const [boundaries, setBoundaries] = useState<NeighborhoodCollection | null>(null);

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

  // Neighborhood delineations ship with the app; the map degrades gracefully without them.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/nyc-neighborhoods.geojson", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => setBoundaries(payload as NeighborhoodCollection | null))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    const all = data?.comps ?? [];
    if (!boroughFilter) return all;
    return all.filter((row) => (row.borough ?? "Unknown") === boroughFilter);
  }, [data, boroughFilter]);

  const geoRows = useMemo(() => rows.filter((row) => row.lat != null && row.lng != null), [rows]);

  // Headline stats follow the borough filter (the API summary covers all boroughs).
  const stats = useMemo(() => {
    const yields = rows.map((row) => row.ltrYieldPct).filter((v): v is number => v != null);
    return {
      medianYieldPct: median(yields),
      averageYieldPct: yields.length > 0 ? yields.reduce((sum, v) => sum + v, 0) / yields.length : null,
      upCount: rows.filter((row) => row.yieldTrend === "up").length,
      downCount: rows.filter((row) => row.yieldTrend === "down").length,
      flatCount: rows.filter((row) => row.yieldTrend === "flat").length,
    };
  }, [rows]);

  const neighborhoodStats = useMemo(() => groupStats(rows, (row) => row.neighborhood), [rows]);
  const boroughStats = useMemo(() => groupStats(rows, (row) => row.borough), [rows]);

  const featureBBoxes = useMemo(() => {
    const out = new Map<string, FeatureBBox>();
    for (const feature of boundaries?.features ?? []) out.set(feature.properties.code, featureBBox(feature));
    return out;
  }, [boundaries]);

  // Geometric roll-up for the map: assign mapped deals to the NTA polygon they
  // fall inside, then badge each area with its median yield + trend.
  const areas = useMemo<AreaStat[]>(() => {
    if (!boundaries) return [];
    const result: AreaStat[] = [];
    for (const feature of boundaries.features) {
      if (feature.properties.park) continue;
      const bbox = featureBBoxes.get(feature.properties.code);
      const members = geoRows.filter((row) => pointInFeature(row.lng!, row.lat!, feature, bbox));
      const yields = members.map((m) => m.ltrYieldPct).filter((v): v is number => v != null);
      const medianYieldPct = median(yields);
      if (medianYieldPct == null) continue;
      const deltas = members.map((m) => m.yieldDeltaPct).filter((v): v is number => v != null);
      const medianDeltaPct = median(deltas);
      result.push({
        code: feature.properties.code,
        name: feature.properties.name,
        borough: feature.properties.borough,
        labelPoint: featureLabelPoint(feature),
        count: yields.length,
        medianYieldPct,
        medianDeltaPct,
        trend: trendOfDelta(medianDeltaPct),
        color: yieldColor(medianYieldPct),
      });
    }
    return result;
  }, [boundaries, featureBBoxes, geoRows]);

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
          row.yieldDeltaPct != null
            ? `Yield ${fmtDeltaPp(row.yieldDeltaPct)} since first sourced ${fmtDateMDY(row.firstYieldAt)}`
            : `First sourced ${fmtDateMDY(row.firstYieldAt ?? row.sourcedAt)}`,
          row.dealStage ? `Stage: ${row.dealStage.replace(/_/g, " ")}` : "Stage: not set",
        ],
      })),
    [colorBy, geoRows]
  );

  const boroughOptions = useMemo(
    () => [...new Set((data?.comps ?? []).map((row) => row.borough ?? "Unknown"))].sort(),
    [data]
  );

  const trendTone = stats.upCount > stats.downCount ? "success" : stats.downCount > stats.upCount ? "danger" : "neutral";

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
              sub={`${geoRows.length} mapped`}
            />
            <StatCard
              tone="brand"
              label="Median LTR yield"
              value={formatPercent(stats.medianYieldPct, 2)}
              sub={boroughFilter ? boroughFilter : "all boroughs"}
            />
            <StatCard
              tone="warning"
              label="Average LTR yield"
              value={formatPercent(stats.averageYieldPct, 2)}
              sub={`across ${rows.length} deals`}
            />
            <StatCard
              tone={trendTone}
              label="Cap-rate moves"
              value={
                <>
                  <span className={styles.kpiTrendUp}>▲ {stats.upCount}</span>
                  <span className={styles.kpiTrendSep}> · </span>
                  <span className={styles.kpiTrendDown}>▼ {stats.downCount}</span>
                </>
              }
              sub="since first sourced"
              title="Deals whose LTR yield rose / fell between the first stored signal and the latest refresh."
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
                <div className={styles.colorToggle} role="group" aria-label="Neighborhood overlay">
                  <button
                    type="button"
                    className={showAreas ? styles.colorToggleActive : undefined}
                    aria-pressed={showAreas}
                    onClick={() => setShowAreas((value) => !value)}
                  >
                    Neighborhoods
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
              <>
                <YieldMapCanvas pins={pins} boundaries={boundaries} areas={areas} showAreas={showAreas} />
                {showAreas ? (
                  <p className={styles.mapFootnote}>
                    Neighborhood badges show the median LTR yield of mapped deals inside each boundary (NYC NTA
                    delineations); ▲/▼ marks the median cap-rate move since each deal was first sourced.
                  </p>
                ) : null}
              </>
            ) : (
              <div className={styles.mapEmpty}>
                No geocoded deals to plot yet ({geoRows.length} with coordinates). Coordinates backfill
                from matched listings automatically; the table below shows every yield-bearing deal regardless.
              </div>
            )}
          </div>

          <div className={styles.dataGrid}>
            <div className={styles.sideColumn}>
              <div className={styles.panel}>
                <span className={styles.tableTitle}>Cap rates by neighborhood</span>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Neighborhood</th>
                      <th>Deals</th>
                      <th>Median</th>
                      <th>Trend</th>
                      <th>Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {neighborhoodStats.map((stat) => (
                      <tr key={stat.name}>
                        <td className={styles.dealAddressCell}>
                          <span className={styles.boroughName}>{stat.name}</span>
                          <div className={styles.dealNeighborhood}>{stat.borough ?? ""}</div>
                        </td>
                        <td>{stat.count}</td>
                        <td
                          className={styles.boroughMedian}
                          style={{ color: yieldColor(stat.medianYieldPct) }}
                          title={`Range ${fmtPct(stat.minYieldPct)}–${fmtPct(stat.maxYieldPct)}`}
                        >
                          {fmtPct(stat.medianYieldPct, 2)}
                        </td>
                        <td>
                          <AreaTrendCell stat={stat} />
                        </td>
                        <td className={styles.sinceCell} title="When the first yield in this area was produced">
                          {fmtMonthYear(stat.firstSourcedAt)}
                        </td>
                      </tr>
                    ))}
                    {neighborhoodStats.length === 0 ? (
                      <tr className={styles.emptyRow}>
                        <td colSpan={5}>No yield-bearing deals yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className={styles.panel}>
                <span className={styles.tableTitle}>Cap rates by borough</span>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Borough</th>
                      <th>Deals</th>
                      <th>Median</th>
                      <th>Range</th>
                      <th>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boroughStats.map((stat) => (
                      <tr key={stat.name}>
                        <td className={styles.boroughName}>{stat.name}</td>
                        <td>{stat.count}</td>
                        <td className={styles.boroughMedian} style={{ color: yieldColor(stat.medianYieldPct) }}>
                          {fmtPct(stat.medianYieldPct, 2)}
                        </td>
                        <td className={styles.boroughRange}>{fmtPct(stat.minYieldPct)}–{fmtPct(stat.maxYieldPct)}</td>
                        <td>
                          <AreaTrendCell stat={stat} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`${styles.panel} ${styles.tablePanel}`}>
              <span className={styles.tableTitle}>All yield-bearing deals</span>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>LTR yield</th>
                    <th title="Move since the yield was first produced; refreshes that change the cap rate add a new observation.">
                      Trend
                    </th>
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
                      <td>
                        <TrendIndicator row={row} />
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
                      <td colSpan={9}>
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
