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

/** Broker-package comparable from GET /api/comps/market. */
interface MarketComp {
  itemId: string;
  packageId: string;
  packageType: string;
  packageCreatedAt: string | null;
  subjectPropertyId: string;
  subjectAddress: string;
  itemType: string;
  propertyName: string | null;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  units: number | null;
  yearCompleted: number | null;
  capRatePct: number | null;
  noi: number | null;
  salePrice: number | null;
  saleDate: string | null;
  pricePsf: number | null;
  pricePerUnit: number | null;
  percentSoldPct: number | null;
  psfOnly: boolean;
  lat: number | null;
  lng: number | null;
}

interface MarketCompsResponse {
  comps: MarketComp[];
  summary: {
    count: number;
    withCapRate: number;
    psfOnly: number;
    withCoordinates: number;
    medianCapRatePct: number | null;
    medianPricePsf: number | null;
  };
}

const YIELD_BANDS = [
  { min: 6.5, label: "6.5%+", color: "#0f766e" },
  { min: 5.5, label: "5.5-6.5%", color: "#16a34a" },
  { min: 4.5, label: "4.5-5.5%", color: "#d97706" },
  { min: -Infinity, label: "< 4.5%", color: "#94a3b8" },
];

/** Buyer's view of sale $/SF: cheaper bands read "better" (teal). */
const PSF_BANDS = [
  { max: 500, label: "≤ $500", color: "#0f766e" },
  { max: 750, label: "$500-750", color: "#16a34a" },
  { max: 1000, label: "$750-1,000", color: "#d97706" },
  { max: Infinity, label: "$1,000+", color: "#94a3b8" },
];

const COMP_ACCENT = "#7c3aed";

function yieldColor(value: number | null): string {
  if (value == null) return "#cbd5e1";
  for (const band of YIELD_BANDS) {
    if (value >= band.min) return band.color;
  }
  return "#cbd5e1";
}

function psfColor(value: number | null): string {
  if (value == null) return "#cbd5e1";
  for (const band of PSF_BANDS) {
    if (value <= band.max) return band.color;
  }
  return "#cbd5e1";
}

/** Page-local formatter: percentage with configurable digits and em-dash fallback. */
function fmtPct(value: number | null | undefined, digits = 1): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(digits)}%` : EMPTY_VALUE;
}

/** "$612" — sale $/SF figures stay compact. */
function fmtPsf(value: number | null | undefined): string {
  return value != null && Number.isFinite(value)
    ? `$${Math.round(value).toLocaleString("en-US")}`
    : EMPTY_VALUE;
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

type Metric = "capRate" | "psf";

interface AreaTableStat {
  name: string;
  borough: string | null;
  count: number;
  medianValue: number;
  minValue: number;
  maxValue: number;
  upCount: number;
  downCount: number;
  medianDeltaPct: number | null;
  firstSourcedAt: string | null;
}

function groupStats(
  rows: CompRow[],
  keyOf: (row: CompRow) => string | null,
  valueOf: (row: CompRow) => number | null
): AreaTableStat[] {
  const groups = new Map<string, CompRow[]>();
  for (const row of rows) {
    if (valueOf(row) == null) continue;
    const key = keyOf(row)?.trim() || "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([name, members]) => {
      const values = members.map((m) => valueOf(m) as number).sort((a, b) => a - b);
      const deltas = members.map((m) => m.yieldDeltaPct).filter((v): v is number => v != null);
      const firstDates = members
        .map((m) => m.firstYieldAt ?? m.sourcedAt)
        .filter((v): v is string => v != null)
        .sort();
      return {
        name,
        borough: members.find((m) => m.borough)?.borough ?? null,
        count: values.length,
        medianValue: median(values) as number,
        minValue: values[0],
        maxValue: values[values.length - 1],
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

function packageTypeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compDisplayName(comp: MarketComp): string {
  return comp.propertyName ?? comp.address?.split(",")[0] ?? "Unnamed comp";
}

/** A merged table line: a sourced deal or a broker-package comp, ordered together. */
type TableEntry =
  | { kind: "deal"; rowId: string; deal: CompRow }
  | { kind: "comp"; rowId: string; comp: MarketComp };

export default function YieldMapPage() {
  const [data, setData] = useState<CompsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boroughFilter, setBoroughFilter] = useState("");
  const [colorBy, setColorBy] = useState<"yield" | "psf" | "stage">("yield");
  const [showAreas, setShowAreas] = useState(true);
  const [boundaries, setBoundaries] = useState<NeighborhoodCollection | null>(null);
  const [showComps, setShowComps] = useState(false);
  const [marketComps, setMarketComps] = useState<MarketCompsResponse | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);

  const metric: Metric = colorBy === "psf" ? "psf" : "capRate";

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

  // Broker-package comps load lazily the first time "Show comps" is enabled.
  // geocode=1 lets the API resolve a batch of uncached comp addresses per load.
  useEffect(() => {
    if (!showComps || marketComps || compsLoading) return;
    const controller = new AbortController();
    setCompsLoading(true);
    fetch(`${API_BASE}/api/comps/market?geocode=1`, { credentials: "include", signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as MarketCompsResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setMarketComps(payload);
        setCompsError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCompsError(err instanceof Error ? err.message : "Failed to load comps.");
      })
      .finally(() => setCompsLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComps]);

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

  const compRows = useMemo(() => {
    if (!showComps) return [];
    const all = marketComps?.comps ?? [];
    if (!boroughFilter) return all;
    return all.filter((comp) => (comp.borough ?? "Unknown") === boroughFilter);
  }, [showComps, marketComps, boroughFilter]);

  const geoRows = useMemo(() => rows.filter((row) => row.lat != null && row.lng != null), [rows]);
  const geoComps = useMemo(() => compRows.filter((comp) => comp.lat != null && comp.lng != null), [compRows]);

  const dealMetricValue = useMemo(
    () => (metric === "psf" ? (row: CompRow) => row.pricePsf : (row: CompRow) => row.ltrYieldPct),
    [metric]
  );
  const metricColor = metric === "psf" ? psfColor : yieldColor;
  const fmtMetric = (value: number | null) => (metric === "psf" ? fmtPsf(value) : fmtPct(value, 2));

  // Headline stats follow the borough filter (the API summary covers all boroughs).
  const stats = useMemo(() => {
    const yields = rows.map((row) => row.ltrYieldPct).filter((v): v is number => v != null);
    const psfs = rows.map((row) => row.pricePsf).filter((v): v is number => v != null);
    return {
      medianYieldPct: median(yields),
      averageYieldPct: yields.length > 0 ? yields.reduce((sum, v) => sum + v, 0) / yields.length : null,
      medianPsf: median(psfs),
      psfCount: psfs.length,
      upCount: rows.filter((row) => row.yieldTrend === "up").length,
      downCount: rows.filter((row) => row.yieldTrend === "down").length,
      flatCount: rows.filter((row) => row.yieldTrend === "flat").length,
    };
  }, [rows]);

  const neighborhoodStats = useMemo(
    () => groupStats(rows, (row) => row.neighborhood, dealMetricValue),
    [rows, dealMetricValue]
  );
  const boroughStats = useMemo(
    () => groupStats(rows, (row) => row.borough, dealMetricValue),
    [rows, dealMetricValue]
  );

  const featureBBoxes = useMemo(() => {
    const out = new Map<string, FeatureBBox>();
    for (const feature of boundaries?.features ?? []) out.set(feature.properties.code, featureBBox(feature));
    return out;
  }, [boundaries]);

  // Geometric roll-up for the map: assign mapped deals to the NTA polygon they
  // fall inside, then badge each area with its median for the active metric.
  const areas = useMemo<AreaStat[]>(() => {
    if (!boundaries) return [];
    const result: AreaStat[] = [];
    for (const feature of boundaries.features) {
      if (feature.properties.park) continue;
      const bbox = featureBBoxes.get(feature.properties.code);
      const members = geoRows.filter((row) => pointInFeature(row.lng!, row.lat!, feature, bbox));
      const values = members.map(dealMetricValue).filter((v): v is number => v != null);
      const medianValue = median(values);
      if (medianValue == null) continue;
      const deltas = members.map((m) => m.yieldDeltaPct).filter((v): v is number => v != null);
      const medianDeltaPct = metric === "capRate" ? median(deltas) : null;
      const trend = metric === "capRate" ? trendOfDelta(medianDeltaPct) : null;
      const valueLabel = metric === "psf" ? `${fmtPsf(medianValue)}/SF` : `${medianValue.toFixed(2)}%`;
      const deltaText =
        medianDeltaPct != null
          ? ` · Δ ${medianDeltaPct >= 0 ? "+" : ""}${medianDeltaPct.toFixed(2)}pp since first sourced`
          : "";
      result.push({
        code: feature.properties.code,
        name: feature.properties.name,
        borough: feature.properties.borough,
        labelPoint: featureLabelPoint(feature),
        count: values.length,
        valueLabel,
        titleLabel: `${feature.properties.name} (${feature.properties.borough}) — median ${valueLabel} across ${values.length} mapped ${
          values.length === 1 ? "deal" : "deals"
        }${deltaText}`,
        trend,
        color: metricColor(medianValue),
      });
    }
    return result;
  }, [boundaries, featureBBoxes, geoRows, dealMetricValue, metric, metricColor]);

  const pins = useMemo<MapPin[]>(() => {
    const dealPins: MapPin[] = geoRows.map((row) => ({
      id: row.propertyId,
      propertyId: row.propertyId,
      kind: "deal" as const,
      address: row.canonicalAddress,
      lat: row.lat!,
      lng: row.lng!,
      color:
        colorBy === "stage"
          ? stagePinColor(row.dealStage)
          : metricColor(dealMetricValue(row)),
      lines: [
        `Cap rate ${fmtPct(row.ltrYieldPct, 2)} · ${fmtPsf(row.pricePsf)}/SF`,
        `MTR ${fmtPct(row.mtrYieldPct, 2)} · NOI ${formatCurrencyExact(row.currentNoi)} · ${row.units ?? EMPTY_VALUE} units`,
        row.yieldDeltaPct != null
          ? `Yield ${fmtDeltaPp(row.yieldDeltaPct)} since first sourced ${fmtDateMDY(row.firstYieldAt)}`
          : `First sourced ${fmtDateMDY(row.firstYieldAt ?? row.sourcedAt)}`,
        row.dealStage ? `Stage: ${row.dealStage.replace(/_/g, " ")}` : "Stage: not set",
      ],
    }));

    const compPins: MapPin[] = geoComps.map((comp) => ({
      id: `comp:${comp.itemId}`,
      propertyId: comp.subjectPropertyId,
      kind: "comp" as const,
      address: compDisplayName(comp),
      lat: comp.lat!,
      lng: comp.lng!,
      color:
        colorBy === "stage"
          ? COMP_ACCENT
          : metricColor(metric === "psf" ? comp.pricePsf : comp.capRatePct),
      lines: [
        `Cap rate ${fmtPct(comp.capRatePct, 2)} · ${fmtPsf(comp.pricePsf)}/SF`,
        ...(comp.salePrice != null || comp.saleDate
          ? [`Sale ${formatCurrencyExact(comp.salePrice)}${comp.saleDate ? ` · ${comp.saleDate}` : ""}`]
          : []),
        ...(comp.units != null || comp.noi != null
          ? [`${comp.units ?? EMPTY_VALUE} units · NOI ${formatCurrencyExact(comp.noi)}`]
          : []),
        ...(comp.psfOnly ? ["$/PSF only — no cap rate in package"] : []),
        `Subject: ${comp.subjectAddress.split(",")[0]} · ${packageTypeLabel(comp.packageType)}`,
      ],
    }));

    return [...dealPins, ...compPins];
  }, [colorBy, geoRows, geoComps, metric, metricColor, dealMetricValue]);

  // Comps slot into the deal list ordered by the active metric: cap rates rank
  // high-to-low, $/SF cheap-to-expensive (the buyer's read in both cases).
  const tableEntries = useMemo<TableEntry[]>(() => {
    const entries: TableEntry[] = [
      ...rows.map((deal): TableEntry => ({ kind: "deal", rowId: deal.propertyId, deal })),
      ...compRows.map((comp): TableEntry => ({ kind: "comp", rowId: `comp:${comp.itemId}`, comp })),
    ];
    const valueOf = (entry: TableEntry): number | null =>
      entry.kind === "deal"
        ? dealMetricValue(entry.deal)
        : metric === "psf"
          ? entry.comp.pricePsf
          : entry.comp.capRatePct;
    return entries.sort((a, b) => {
      const aValue = valueOf(a);
      const bValue = valueOf(b);
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      return metric === "psf" ? aValue - bValue : bValue - aValue;
    });
  }, [rows, compRows, metric, dealMetricValue]);

  const boroughOptions = useMemo(
    () => [...new Set((data?.comps ?? []).map((row) => row.borough ?? "Unknown"))].sort(),
    [data]
  );

  const trendTone = stats.upCount > stats.downCount ? "success" : "neutral";
  const metricNoun = metric === "psf" ? "Sale $/SF" : "Cap rates";
  const legendBands = colorBy === "stage" ? STAGE_LEGEND : colorBy === "psf" ? PSF_BANDS : YIELD_BANDS;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Pipeline · Living comps"
        title="Yield Map"
        subtitle="Every deal with a calculated LTR yield (extracted NOI ÷ price) from OMs, broker docs, and notes — active, dead, or closed. Toggle $/PSF for the price-per-foot read, and overlay broker-package comps to see the market side by side."
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
              label={metric === "psf" ? "Median sale $/SF" : "Median LTR yield"}
              value={metric === "psf" ? `${fmtPsf(stats.medianPsf)}/SF` : formatPercent(stats.medianYieldPct, 2)}
              sub={boroughFilter ? boroughFilter : "all boroughs"}
            />
            <StatCard
              tone="warning"
              label={metric === "psf" ? "Deals with $/SF" : "Average LTR yield"}
              value={metric === "psf" ? stats.psfCount : formatPercent(stats.averageYieldPct, 2)}
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
            {showComps && marketComps ? (
              <StatCard
                tone="neutral"
                label="Comps overlaid"
                value={compRows.length}
                sub={`median cap ${fmtPct(marketComps.summary.medianCapRatePct, 2)} · ${marketComps.summary.psfOnly} $/PSF-only`}
                title="Comparables extracted from uploaded broker comp packages. $/PSF-only comps have no cap rate — chase the broker for sale comps."
              />
            ) : null}
          </div>

          <div className={styles.panel}>
            <div className={styles.mapHeader}>
              <span className={styles.mapTitle}>
                Deal map — pins colored by {colorBy === "yield" ? "cap rate" : colorBy === "psf" ? "sale $/SF" : "deal stage"}
              </span>
              <div className={styles.mapControls}>
                <div className={styles.colorToggle} role="group" aria-label="Color pins by">
                  <button
                    type="button"
                    className={colorBy === "yield" ? styles.colorToggleActive : undefined}
                    onClick={() => setColorBy("yield")}
                  >
                    Cap rate %
                  </button>
                  <button
                    type="button"
                    className={colorBy === "psf" ? styles.colorToggleActive : undefined}
                    onClick={() => setColorBy("psf")}
                  >
                    $/PSF
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
                <label className={styles.compToggle}>
                  <input
                    type="checkbox"
                    checked={showComps}
                    onChange={(event) => setShowComps(event.target.checked)}
                  />
                  Show comps
                  {compsLoading ? <span className={styles.compToggleNote}>loading…</span> : null}
                </label>
                <div className={styles.legendList}>
                  {legendBands.map((band) => (
                    <span key={band.label} className={styles.legendItem}>
                      <span className={styles.legendDot} style={{ background: band.color }} />
                      {band.label}
                    </span>
                  ))}
                  {showComps ? (
                    <span className={styles.legendItem}>
                      <span className={styles.legendDiamond} />
                      Comp
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {compsError && showComps ? <div className={styles.errorBanner}>{compsError}</div> : null}
            {geoRows.length > 0 || geoComps.length > 0 ? (
              <>
                <YieldMapCanvas
                  pins={pins}
                  boundaries={boundaries}
                  areas={areas}
                  showAreas={showAreas}
                  highlightedId={activePinId}
                  onPinHover={setActivePinId}
                />
                <p className={styles.mapFootnote}>
                  {showAreas
                    ? `Neighborhood badges show the median ${metric === "psf" ? "sale $/SF" : "LTR yield"} of mapped deals inside each boundary (NYC NTA delineations)${
                        metric === "capRate" ? "; ▲/▼ marks the median cap-rate move since each deal was first sourced" : ""
                      }. `
                    : ""}
                  Hover a table row to spotlight its pin; hover a pin for cap rate and $/PSF
                  {showComps ? "; diamonds are broker-package comps" : ""}.
                </p>
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
                <span className={styles.tableTitle}>{metricNoun} by neighborhood</span>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Neighborhood</th>
                      <th>Deals</th>
                      <th>Median</th>
                      {metric === "capRate" ? <th>Trend</th> : <th>Range</th>}
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
                          style={{ color: metricColor(stat.medianValue) }}
                          title={`Range ${fmtMetric(stat.minValue)}–${fmtMetric(stat.maxValue)}`}
                        >
                          {fmtMetric(stat.medianValue)}
                        </td>
                        {metric === "capRate" ? (
                          <td>
                            <AreaTrendCell stat={stat} />
                          </td>
                        ) : (
                          <td className={styles.boroughRange}>
                            {fmtMetric(stat.minValue)}–{fmtMetric(stat.maxValue)}
                          </td>
                        )}
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
                <span className={styles.tableTitle}>{metricNoun} by borough</span>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Borough</th>
                      <th>Deals</th>
                      <th>Median</th>
                      <th>Range</th>
                      {metric === "capRate" ? <th>Trend</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {boroughStats.map((stat) => (
                      <tr key={stat.name}>
                        <td className={styles.boroughName}>{stat.name}</td>
                        <td>{stat.count}</td>
                        <td className={styles.boroughMedian} style={{ color: metricColor(stat.medianValue) }}>
                          {fmtMetric(stat.medianValue)}
                        </td>
                        <td className={styles.boroughRange}>{fmtMetric(stat.minValue)}–{fmtMetric(stat.maxValue)}</td>
                        {metric === "capRate" ? (
                          <td>
                            <AreaTrendCell stat={stat} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`${styles.panel} ${styles.tablePanel}`}>
              <span className={styles.tableTitle}>
                All yield-bearing deals{showComps && compRows.length > 0 ? ` + ${compRows.length} comps` : ""}
              </span>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Cap rate</th>
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
                  {tableEntries.map((entry) =>
                    entry.kind === "deal" ? (
                      <tr
                        key={entry.rowId}
                        className={activePinId === entry.rowId ? styles.rowActive : undefined}
                        onMouseEnter={() => setActivePinId(entry.rowId)}
                        onMouseLeave={() => setActivePinId(null)}
                      >
                        <td className={styles.dealAddressCell}>
                          <a
                            href={`/deal-analysis?propertyId=${encodeURIComponent(entry.deal.propertyId)}`}
                            className={styles.dealLink}
                          >
                            {entry.deal.canonicalAddress.split(",")[0]}
                          </a>
                          <div className={styles.dealNeighborhood}>
                            {entry.deal.neighborhood ?? entry.deal.borough ?? ""}
                          </div>
                        </td>
                        <td className={styles.yieldCell} style={{ color: yieldColor(entry.deal.ltrYieldPct) }}>
                          {fmtPct(entry.deal.ltrYieldPct, 2)}
                        </td>
                        <td>
                          <TrendIndicator row={entry.deal} />
                        </td>
                        <td>{fmtPct(entry.deal.mtrYieldPct, 2)}</td>
                        <td>{formatCurrencyExact(entry.deal.currentNoi)}</td>
                        <td>{entry.deal.units ?? EMPTY_VALUE}</td>
                        <td>{formatCurrencyExact(entry.deal.pricePerUnit)}</td>
                        <td style={metric === "psf" ? { color: psfColor(entry.deal.pricePsf), fontWeight: 750 } : undefined}>
                          {formatCurrencyExact(entry.deal.pricePsf)}
                        </td>
                        <td className={styles.stageCell}>
                          {entry.deal.dealStage ?? entry.deal.dealState ?? EMPTY_VALUE}
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={entry.rowId}
                        className={`${styles.compRow} ${activePinId === entry.rowId ? styles.rowActive : ""}`}
                        onMouseEnter={() => setActivePinId(entry.rowId)}
                        onMouseLeave={() => setActivePinId(null)}
                      >
                        <td className={styles.dealAddressCell}>
                          <span className={styles.compRowHead}>
                            <a
                              href={`/pipeline?propertyId=${encodeURIComponent(entry.comp.subjectPropertyId)}`}
                              className={styles.compLink}
                              title={`From a ${packageTypeLabel(entry.comp.packageType)} package on ${entry.comp.subjectAddress}`}
                            >
                              {compDisplayName(entry.comp)}
                            </a>
                            <span className={styles.compChip}>Comp</span>
                          </span>
                          <div className={styles.dealNeighborhood}>
                            {entry.comp.neighborhood ?? entry.comp.borough ?? ""}
                            {entry.comp.saleDate ? ` · sold ${entry.comp.saleDate}` : ""}
                          </div>
                        </td>
                        <td className={styles.yieldCell} style={{ color: yieldColor(entry.comp.capRatePct) }}>
                          {fmtPct(entry.comp.capRatePct, 2)}
                        </td>
                        <td>
                          {entry.comp.psfOnly ? (
                            <span className={styles.psfOnlyChip} title="This comp carries $/PSF only — no cap rate was in the package.">
                              $/PSF only
                            </span>
                          ) : (
                            <span className={styles.trendNone}>{EMPTY_VALUE}</span>
                          )}
                        </td>
                        <td>{EMPTY_VALUE}</td>
                        <td>{formatCurrencyExact(entry.comp.noi)}</td>
                        <td>{entry.comp.units ?? EMPTY_VALUE}</td>
                        <td>{formatCurrencyExact(entry.comp.pricePerUnit)}</td>
                        <td style={metric === "psf" ? { color: psfColor(entry.comp.pricePsf), fontWeight: 750 } : undefined}>
                          {formatCurrencyExact(entry.comp.pricePsf)}
                        </td>
                        <td className={styles.stageCell}>{packageTypeLabel(entry.comp.packageType)}</td>
                      </tr>
                    )
                  )}
                  {tableEntries.length === 0 ? (
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
