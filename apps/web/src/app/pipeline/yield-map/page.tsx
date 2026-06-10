"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Dialog, PageHeader, StatCard } from "@/components/ui";
import { dealFlowStageForStatus } from "@re-sourcing/contracts";
import { API_BASE } from "@/lib/api";
import { formatPercent, formatCurrencyCompact, formatCurrencyExact, labelFromKey, EMPTY_VALUE } from "@/lib/format";
import styles from "./yieldMap.module.css";
import { YieldMapCanvas, type MapPin, type AreaStat, type HollowPin, type MarketHood } from "./YieldMapCanvas";
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
  savedStatus: string | null;
  lat: number | null;
  lng: number | null;
  units: number | null;
  askingPrice: number | null;
  ltrYieldPct: number | null;
  mtrYieldPct: number | null;
  yieldSpreadPct: number | null;
  currentNoi: number | null;
  pricePerUnit: number | null;
  pricePsf: number | null;
  expenseRatioPct: number | null;
  dealScore: number | null;
  /** Set when yield data is untrustworthy (0%/negative cap, $0 NOI); excluded from stats. */
  yieldFlag: string | null;
  yieldFlagDetail: string | null;
  sourcedAt: string | null;
  firstYieldPct: number | null;
  firstYieldAt: string | null;
  yieldDeltaPct: number | null;
  yieldTrend: YieldTrend;
  /** True when the numbers come from an unpromoted OM extraction awaiting review. */
  pendingReview: boolean;
}

interface CompsResponse {
  comps: CompRow[];
  summary: {
    count: number;
    withCoordinates: number;
    flaggedCount?: number;
    pendingCount?: number;
    averageLtrYieldPct: number | null;
    medianLtrYieldPct: number | null;
  };
}

/** One line of GET /api/market-headlines — LLM/rule-written movement notes for the map. */
interface MarketHeadline {
  id: string;
  text: string;
  tone: "up" | "down" | "neutral" | "watch";
  scope: string | null;
  source: string | null;
  asOf: string | null;
}

/** Provenance tag carried by every market comp/stat (see contracts/marketContext). */
interface MarketProvenance {
  source_type: "broker_provided" | "market_research";
  publisher: string | null;
  document_class: string;
  report_title: string | null;
  page: number | null;
}

/** A comp from the ingested market-context layer (PDF research/broker docs). */
interface MarketContextComp {
  id: string;
  address: string;
  salePrice: number | null;
  priceType: "closed" | "asking" | "in_contract" | "unknown";
  saleDate: string | null;
  pricePsf: number | null;
  capRate: number | null;
  pctRentStabilized: number | null;
  provenance: MarketProvenance;
  provenanceList: MarketProvenance[];
  lat: number | null;
  lng: number | null;
}

interface NeighborhoodSummaryRow {
  neighborhoodId: string;
  name: string;
  borough: string;
  aliases: string[];
  polygon: [number, number][];
  compCount12mo: number;
  nResearch: number;
  nBroker: number;
  nCherryPickExcluded: number;
  nAskingExcluded: number;
  medianCapRate: number | null;
  capRateRange: [number, number] | null;
  medianPsf: number | null;
  psfRange: [number, number] | null;
  regulatorySkew: string | null;
  bullets: string[];
  fallbackContext: string | null;
  dataFreshness: string | null;
  sources: string[];
  topComps: MarketContextComp[];
}

interface MarketSummariesResponse {
  summaries: NeighborhoodSummaryRow[];
  askingPins: MarketContextComp[];
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

/**
 * "Vs market" mode: pin color reads the deal against the comps we hold for its
 * area (market layer + broker packages), not an absolute band. Cap-rate mode:
 * above-market yield = cheap for the area (teal); below = paying up (red).
 * $/PSF mode mirrors with cheap = teal.
 */
const VS_MARKET_BANDS = [
  { label: "≥ +50bps vs comps", color: "#0f766e" },
  { label: "0 to +50bps", color: "#16a34a" },
  { label: "0 to −50bps", color: "#d97706" },
  { label: "≤ −50bps", color: "#dc2626" },
  { label: "no area comps", color: "#94a3b8" },
];

function vsMarketCapColor(deltaPp: number | null): string {
  if (deltaPp == null) return "#94a3b8";
  if (deltaPp >= 0.5) return "#0f766e";
  if (deltaPp >= 0) return "#16a34a";
  if (deltaPp >= -0.5) return "#d97706";
  return "#dc2626";
}

/** $/PSF read: percentage above/below the area median (cheaper = better). */
function vsMarketPsfColor(deltaPct: number | null): string {
  if (deltaPct == null) return "#94a3b8";
  if (deltaPct <= -10) return "#0f766e";
  if (deltaPct <= 0) return "#16a34a";
  if (deltaPct <= 10) return "#d97706";
  return "#dc2626";
}

/** Ray-cast point-in-ring test for the market layer's simplified polygons. */
function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

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

type MarketSourceFilter = "all" | "market_research" | "broker_provided";

const MARKET_SOURCE_OPTIONS: Array<{ value: MarketSourceFilter; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "market_research", label: "Research only" },
  { value: "broker_provided", label: "Broker only" },
];

/** Market cap rates arrive as decimals (0.0596). */
function fmtCapRate(rate: number | null | undefined, digits = 2): string {
  return rate != null && Number.isFinite(rate) ? `${(rate * 100).toFixed(digits)}%` : EMPTY_VALUE;
}

/** "$612/SF" — market-context popups carry the unit inline. */
function fmtPsfPerSf(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${Math.round(value).toLocaleString("en-US")}/SF` : EMPTY_VALUE;
}

function publisherInitials(publisher: string | null): string {
  if (!publisher) return "R";
  return publisher
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function normalizeHoodName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Per-row source badge(s): RESEARCH chip (publisher initials) vs BROKER; corroborated comps get both. */
function appendSourceChips(target: HTMLElement, comp: MarketContextComp): void {
  const list = comp.provenanceList.length > 0 ? comp.provenanceList : [comp.provenance];
  const hasResearch = list.some((p) => p.source_type === "market_research");
  const hasBroker = list.some((p) => p.source_type === "broker_provided");
  if (hasResearch) {
    const chip = document.createElement("span");
    chip.className = styles.chipResearch;
    chip.textContent = publisherInitials(list.find((p) => p.source_type === "market_research")?.publisher ?? null);
    chip.title = "Research-sourced";
    target.appendChild(chip);
  }
  if (hasBroker) {
    const chip = document.createElement("span");
    chip.className = styles.chipBroker;
    chip.textContent = "BRKR";
    chip.title = "Broker-provided";
    target.appendChild(chip);
  }
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
  const [colorBy, setColorBy] = useState<"yield" | "psf" | "stage" | "vsMarket">("yield");
  const [showAreas, setShowAreas] = useState(true);
  const [includePending, setIncludePending] = useState(false);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [headlines, setHeadlines] = useState<MarketHeadline[]>([]);
  const [boundaries, setBoundaries] = useState<NeighborhoodCollection | null>(null);
  const [showComps, setShowComps] = useState(false);
  const [marketComps, setMarketComps] = useState<MarketCompsResponse | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketSummariesResponse | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketSource, setMarketSource] = useState<MarketSourceFilter>("all");
  const [marketLayerOn, setMarketLayerOn] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const metric: Metric = colorBy === "psf" ? "psf" : "capRate";

  const loadDeals = useCallback(async (options?: { signal?: AbortSignal; initial?: boolean }) => {
    if (options?.initial) setLoading(true);
    try {
      // Pending (awaiting-review) rows always come back; the toggle filters client-side.
      const res = await fetch(`${API_BASE}/api/comps/operating?include_pending=1`, {
        credentials: "include",
        signal: options?.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as CompsResponse & { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
      setData(payload);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load yield map.");
    } finally {
      if (options?.initial) setLoading(false);
    }
  }, []);

  const loadMarket = useCallback(
    async (options?: { signal?: AbortSignal }) => {
      const query = marketSource === "all" ? "" : `?source_type=${marketSource}`;
      try {
        const res = await fetch(`${API_BASE}/api/neighborhood-summaries${query}`, {
          credentials: "include",
          signal: options?.signal,
        });
        const payload = (await res.json().catch(() => ({}))) as MarketSummariesResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setMarket(payload);
        setMarketError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMarketError(err instanceof Error ? err.message : "Failed to load market layer.");
      }
    },
    [marketSource]
  );

  const loadMarketComps = useCallback(async (options?: { signal?: AbortSignal }) => {
    setCompsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/comps/market?geocode=1`, {
        credentials: "include",
        signal: options?.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as MarketCompsResponse & { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
      setMarketComps(payload);
      setCompsError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setCompsError(err instanceof Error ? err.message : "Failed to load comps.");
    } finally {
      setCompsLoading(false);
    }
  }, []);

  /** Re-pull everything currently visible; broker-package comps only once loaded. */
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    const jobs = [loadDeals(), loadMarket()];
    if (marketComps != null) jobs.push(loadMarketComps());
    await Promise.allSettled(jobs);
    setLastRefreshedAt(new Date());
    setRefreshing(false);
  }, [loadDeals, loadMarket, loadMarketComps, marketComps]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDeals({ signal: controller.signal, initial: true }).then(() => setLastRefreshedAt(new Date()));
    return () => controller.abort();
  }, [loadDeals]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMarket({ signal: controller.signal });
    return () => controller.abort();
  }, [loadMarket]);

  // New uploads land via async extraction, so the map re-pulls from the
  // database automatically: every 60s while the tab is visible, and whenever
  // the user returns to the tab.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshAll();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshAll]);

  // Broker-package comps load lazily the first time "Show comps" is enabled.
  // geocode=1 lets the API resolve a batch of uncached comp addresses per load.
  useEffect(() => {
    if (!showComps || marketComps || compsLoading) return;
    const controller = new AbortController();
    void loadMarketComps({ signal: controller.signal });
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

  // Market-movement headlines (knowledge base + ingested reports). The strip
  // simply stays hidden when the endpoint has nothing or isn't deployed yet.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/market-headlines`, { credentials: "include", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { headlines?: MarketHeadline[] } | null) => {
        if (Array.isArray(payload?.headlines)) setHeadlines(payload.headlines.slice(0, 6));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    let all = data?.comps ?? [];
    if (!includePending) all = all.filter((row) => !row.pendingReview);
    if (!boroughFilter) return all;
    return all.filter((row) => (row.borough ?? "Unknown") === boroughFilter);
  }, [data, boroughFilter, includePending]);

  const pendingAvailable = useMemo(
    () => (data?.comps ?? []).filter((row) => row.pendingReview).length,
    [data]
  );

  const compRows = useMemo(() => {
    if (!showComps) return [];
    const all = marketComps?.comps ?? [];
    if (!boroughFilter) return all;
    return all.filter((comp) => (comp.borough ?? "Unknown") === boroughFilter);
  }, [showComps, marketComps, boroughFilter]);

  const geoRows = useMemo(() => rows.filter((row) => row.lat != null && row.lng != null), [rows]);
  const geoComps = useMemo(() => compRows.filter((comp) => comp.lat != null && comp.lng != null), [compRows]);

  const featureBBoxes = useMemo(() => {
    const out = new Map<string, FeatureBBox>();
    for (const feature of boundaries?.features ?? []) out.set(feature.properties.code, featureBBox(feature));
    return out;
  }, [boundaries]);

  // Neighborhood names the rest of the page shows should match the map: deals
  // with coordinates take the NTA polygon they fall inside; the enrichment
  // name (title-cased) covers the rest. Eliminates "GREENWICH VILLAGE-CENTRAL"
  // vs "Greenwich Village" mismatches between the tables and the map.
  const hoodNameByPropertyId = useMemo(() => {
    const out = new Map<string, string>();
    if (!boundaries) return out;
    for (const row of data?.comps ?? []) {
      if (row.lat == null || row.lng == null) continue;
      for (const feature of boundaries.features) {
        if (feature.properties.park) continue;
        const bbox = featureBBoxes.get(feature.properties.code);
        if (pointInFeature(row.lng, row.lat, feature, bbox)) {
          out.set(row.propertyId, feature.properties.name);
          break;
        }
      }
    }
    return out;
  }, [boundaries, featureBBoxes, data]);

  const displayHood = useCallback(
    (row: CompRow): string | null =>
      hoodNameByPropertyId.get(row.propertyId) ?? (row.neighborhood ? labelFromKey(row.neighborhood) : null),
    [hoodNameByPropertyId]
  );

  /** Board stage chip text — the same stage the deal-progress board shows for this status. */
  const boardStageLabel = useCallback((row: CompRow): string => {
    const stage = dealFlowStageForStatus(row.savedStatus);
    if (stage) return stage.shortLabel;
    if (row.dealStage) return labelFromKey(row.dealStage);
    return row.dealState ? labelFromKey(row.dealState) : EMPTY_VALUE;
  }, []);

  const flaggedRows = useMemo(() => rows.filter((row) => row.yieldFlag != null), [rows]);
  const yieldRows = useMemo(() => rows.filter((row) => row.ltrYieldPct != null), [rows]);

  const summaries = useMemo(() => (marketLayerOn ? market?.summaries ?? [] : []), [market, marketLayerOn]);
  const summaryById = useMemo(
    () => new Map(summaries.map((summary) => [summary.neighborhoodId, summary])),
    [summaries]
  );

  /** Our own deals' median LTR yield per neighborhood (alias-matched) for the spread line. */
  const ourYieldByHood = useMemo(() => {
    const aliasToHood = new Map<string, string>();
    for (const summary of summaries) {
      aliasToHood.set(normalizeHoodName(summary.neighborhoodId), summary.neighborhoodId);
      aliasToHood.set(normalizeHoodName(summary.name), summary.neighborhoodId);
      for (const alias of summary.aliases) aliasToHood.set(normalizeHoodName(alias), summary.neighborhoodId);
    }
    const grouped = new Map<string, number[]>();
    for (const row of data?.comps ?? []) {
      if (row.ltrYieldPct == null) continue;
      const hoodName = hoodNameByPropertyId.get(row.propertyId) ?? row.neighborhood;
      if (!hoodName) continue;
      const hoodId = aliasToHood.get(normalizeHoodName(hoodName));
      if (!hoodId) continue;
      const bucket = grouped.get(hoodId) ?? [];
      bucket.push(row.ltrYieldPct);
      grouped.set(hoodId, bucket);
    }
    const result = new Map<string, { median: number; count: number }>();
    for (const [hoodId, values] of grouped) {
      const value = median(values);
      if (value != null) result.set(hoodId, { median: value, count: values.length });
    }
    return result;
  }, [data, summaries, hoodNameByPropertyId]);

  /**
   * Per-deal read against area comps for the "Vs market" pin mode and popup
   * line. Benchmark preference: the market-layer hood median (research +
   * broker uploads), else the median of broker-package comps falling in the
   * same hood polygon. Deals locate by point-in-polygon, falling back to
   * alias-matched neighborhood names for unmapped rows.
   */
  const vsMarketByPropertyId = useMemo(() => {
    const out = new Map<
      string,
      { hoodName: string; capDeltaPp: number | null; psfDeltaPct: number | null; marketCapPct: number | null; marketPsf: number | null }
    >();
    if (summaries.length === 0) return out;
    const aliasToHood = new Map<string, NeighborhoodSummaryRow>();
    for (const summary of summaries) {
      aliasToHood.set(normalizeHoodName(summary.neighborhoodId), summary);
      aliasToHood.set(normalizeHoodName(summary.name), summary);
      for (const alias of summary.aliases) aliasToHood.set(normalizeHoodName(alias), summary);
    }
    const hoodOfDeal = (row: CompRow): NeighborhoodSummaryRow | null => {
      if (row.lat != null && row.lng != null) {
        for (const summary of summaries) {
          if (summary.polygon.length >= 3 && pointInRing(row.lng, row.lat, summary.polygon)) return summary;
        }
      }
      return row.neighborhood ? aliasToHood.get(normalizeHoodName(row.neighborhood)) ?? null : null;
    };
    // Broker-package comps grouped per hood (fallback benchmark when the
    // market layer has no median for that hood yet).
    const packageCompsByHood = new Map<string, { caps: number[]; psfs: number[] }>();
    for (const comp of geoComps) {
      for (const summary of summaries) {
        if (summary.polygon.length < 3 || !pointInRing(comp.lng!, comp.lat!, summary.polygon)) continue;
        const bucket = packageCompsByHood.get(summary.neighborhoodId) ?? { caps: [], psfs: [] };
        if (comp.capRatePct != null) bucket.caps.push(comp.capRatePct);
        if (comp.pricePsf != null) bucket.psfs.push(comp.pricePsf);
        packageCompsByHood.set(summary.neighborhoodId, bucket);
        break;
      }
    }
    for (const row of data?.comps ?? []) {
      const hood = hoodOfDeal(row);
      if (!hood) continue;
      const packageBucket = packageCompsByHood.get(hood.neighborhoodId);
      const marketCapPct =
        hood.medianCapRate != null ? hood.medianCapRate * 100 : median(packageBucket?.caps ?? []);
      const marketPsf = hood.medianPsf ?? median(packageBucket?.psfs ?? []);
      const capDeltaPp =
        row.ltrYieldPct != null && marketCapPct != null ? row.ltrYieldPct - marketCapPct : null;
      const psfDeltaPct =
        row.pricePsf != null && marketPsf != null && marketPsf > 0
          ? ((row.pricePsf - marketPsf) / marketPsf) * 100
          : null;
      if (capDeltaPp == null && psfDeltaPct == null) continue;
      out.set(row.propertyId, { hoodName: hood.name, capDeltaPp, psfDeltaPct, marketCapPct, marketPsf });
    }
    return out;
  }, [data, summaries, geoComps]);

  const marketHoods = useMemo<MarketHood[]>(() => {
    if (!marketLayerOn) return [];
    return summaries
      .filter((summary) => summary.polygon.length >= 3)
      .map((summary) => {
        const hasCapMedian = summary.compCount12mo >= 3 && summary.medianCapRate != null;
        const hasPsfOnly = summary.compCount12mo >= 3 && summary.medianCapRate == null && summary.medianPsf != null;
        const fallbackOnly = !hasCapMedian && !hasPsfOnly && summary.fallbackContext != null;
        if (!hasCapMedian && !hasPsfOnly && !fallbackOnly) return null;
        return {
          id: summary.neighborhoodId,
          name: summary.name,
          polygon: summary.polygon,
          // Cap-median scale; muted slate when only a $/SF median exists; null → hatch.
          fillColor: hasCapMedian ? yieldColor((summary.medianCapRate as number) * 100) : hasPsfOnly ? "#cbd5e1" : null,
          fallbackOnly,
        };
      })
      .filter((hood): hood is MarketHood => hood != null);
  }, [summaries, marketLayerOn]);

  const hollowPins = useMemo<HollowPin[]>(() => {
    if (!marketLayerOn || !market) return [];
    return market.askingPins
      .filter((comp) => comp.lat != null && comp.lng != null)
      .map((comp) => ({
        id: comp.id,
        address: comp.address,
        lat: comp.lat!,
        lng: comp.lng!,
        color: "#7c3aed",
        lines: [
          `ASKING ${formatCurrencyExact(comp.salePrice)} · ${fmtPsfPerSf(comp.pricePsf)}`,
          `${comp.provenance.publisher ?? "Broker-provided"} — excluded from medians`,
        ],
      }));
  }, [market, marketLayerOn]);

  /** Hover/click popup per spec: header, hero stat, mini comp table, bullets, fallback, sources. */
  const renderHoodPopup = useMemo(() => {
    return (hoodId: string): HTMLElement | null => {
      const summary = summaryById.get(hoodId);
      if (!summary) return null;
      const root = document.createElement("div");
      root.className = styles.hoodPopup;

      const header = document.createElement("div");
      header.className = styles.hoodPopupHeader;
      const name = document.createElement("strong");
      name.textContent = summary.name;
      header.appendChild(name);
      const meta = document.createElement("span");
      const freshness = summary.dataFreshness ? ` · ${summary.dataFreshness}` : "";
      meta.textContent = `n=${summary.compCount12mo} · ${summary.nResearch} research / ${summary.nBroker} broker${freshness}`;
      header.appendChild(meta);
      root.appendChild(header);

      const hero = document.createElement("div");
      hero.className = styles.hoodPopupHero;
      if (summary.medianCapRate != null) {
        const range = summary.capRateRange;
        hero.textContent = `Median cap ${fmtCapRate(summary.medianCapRate)}${
          range ? ` (${fmtCapRate(range[0])}–${fmtCapRate(range[1])})` : ""
        }`;
      } else if (summary.medianPsf != null) {
        hero.textContent = `Median ${fmtPsfPerSf(summary.medianPsf)}`;
      } else {
        hero.textContent = "submarket estimate — no neighborhood-level closed comps yet";
        hero.className = `${styles.hoodPopupHero} ${styles.hoodPopupHeroMuted}`;
      }
      root.appendChild(hero);

      if (summary.topComps.length > 0) {
        const table = document.createElement("table");
        table.className = styles.hoodPopupTable;
        for (const comp of summary.topComps.slice(0, 3)) {
          const tr = document.createElement("tr");
          const addressCell = document.createElement("td");
          addressCell.textContent = comp.address.split(",")[0];
          tr.appendChild(addressCell);
          const psfCell = document.createElement("td");
          psfCell.textContent = fmtPsfPerSf(comp.pricePsf);
          tr.appendChild(psfCell);
          const capCell = document.createElement("td");
          capCell.textContent = fmtCapRate(comp.capRate);
          tr.appendChild(capCell);
          const badgeCell = document.createElement("td");
          badgeCell.className = styles.hoodPopupBadges;
          appendSourceChips(badgeCell, comp);
          tr.appendChild(badgeCell);
          table.appendChild(tr);
        }
        root.appendChild(table);
      }

      if (summary.bullets.length > 0) {
        const list = document.createElement("ul");
        list.className = styles.hoodPopupBullets;
        for (const bullet of summary.bullets) {
          const item = document.createElement("li");
          item.textContent = bullet;
          list.appendChild(item);
        }
        root.appendChild(list);
      }

      if (summary.fallbackContext && summary.compCount12mo < 3) {
        const fallback = document.createElement("div");
        fallback.className = styles.hoodPopupFallback;
        fallback.textContent = summary.fallbackContext;
        root.appendChild(fallback);
      }

      const ours = ourYieldByHood.get(hoodId);
      if (ours && summary.medianCapRate != null) {
        const spread = document.createElement("div");
        spread.className = styles.hoodPopupSpread;
        const marketPct = summary.medianCapRate * 100;
        const bps = Math.round((ours.median - marketPct) * 100);
        spread.textContent = `Your LTR yield ${ours.median.toFixed(2)}% vs market median cap ${marketPct.toFixed(2)}% → ${
          bps >= 0 ? "+" : ""
        }${bps} bps`;
        root.appendChild(spread);
      }

      if (summary.sources.length > 0) {
        const sources = document.createElement("div");
        sources.className = styles.hoodPopupSources;
        sources.textContent = summary.sources.join(" · ");
        root.appendChild(sources);
      }
      return root;
    };
  }, [summaryById, ourYieldByHood]);

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
    () => groupStats(rows, displayHood, dealMetricValue),
    [rows, displayHood, dealMetricValue]
  );
  const boroughStats = useMemo(
    () => groupStats(rows, (row) => row.borough, dealMetricValue),
    [rows, dealMetricValue]
  );

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
    const dealPins: MapPin[] = geoRows.map((row) => {
      const vsMarket = vsMarketByPropertyId.get(row.propertyId) ?? null;
      const color =
        colorBy === "stage"
          ? stagePinColor(row.dealStage)
          : colorBy === "vsMarket"
            ? metric === "psf"
              ? vsMarketPsfColor(vsMarket?.psfDeltaPct ?? null)
              : vsMarketCapColor(vsMarket?.capDeltaPp ?? null)
            : metricColor(dealMetricValue(row));
      const vsMarketLine =
        vsMarket?.capDeltaPp != null
          ? `${vsMarket.capDeltaPp >= 0 ? "+" : ""}${Math.round(vsMarket.capDeltaPp * 100)} bps vs ${vsMarket.hoodName} comps (${fmtPct(vsMarket.marketCapPct, 2)})`
          : vsMarket?.psfDeltaPct != null
            ? `${vsMarket.psfDeltaPct >= 0 ? "+" : ""}${vsMarket.psfDeltaPct.toFixed(0)}% vs ${vsMarket.hoodName} $/SF (${fmtPsf(vsMarket.marketPsf)})`
            : null;
      return {
        id: row.propertyId,
        propertyId: row.propertyId,
        kind: "deal" as const,
        address: row.canonicalAddress.split(",")[0],
        neighborhood: [displayHood(row), row.borough].filter(Boolean).join(" · ") || null,
        pending: row.pendingReview,
        lat: row.lat!,
        lng: row.lng!,
        color,
        lines: [
          `Cap rate ${fmtPct(row.ltrYieldPct, 2)} · ${fmtPsf(row.pricePsf)}/SF`,
          `MTR ${fmtPct(row.mtrYieldPct, 2)} · NOI ${formatCurrencyExact(row.currentNoi)} · ${row.units ?? EMPTY_VALUE} units`,
          ...(vsMarketLine ? [vsMarketLine] : []),
          row.yieldDeltaPct != null
            ? `Yield ${fmtDeltaPp(row.yieldDeltaPct)} since first sourced ${fmtDateMDY(row.firstYieldAt)}`
            : `First sourced ${fmtDateMDY(row.firstYieldAt ?? row.sourcedAt)}`,
          `Stage: ${boardStageLabel(row)}`,
          ...(row.pendingReview ? ["⏳ OM extraction awaiting review — promote it to confirm these numbers"] : []),
          ...(row.yieldFlagDetail ? [`⚠ ${row.yieldFlagDetail}`] : []),
        ],
      };
    });

    const compPins: MapPin[] = geoComps.map((comp) => ({
      id: `comp:${comp.itemId}`,
      propertyId: comp.subjectPropertyId,
      kind: "comp" as const,
      address: compDisplayName(comp),
      neighborhood: [comp.neighborhood, comp.borough ? labelFromKey(comp.borough) : null].filter(Boolean).join(" · ") || null,
      lat: comp.lat!,
      lng: comp.lng!,
      color:
        colorBy === "stage" || colorBy === "vsMarket"
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
  }, [colorBy, geoRows, geoComps, metric, metricColor, dealMetricValue, vsMarketByPropertyId, displayHood, boardStageLabel]);

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
  const legendBands =
    colorBy === "stage"
      ? STAGE_LEGEND
      : colorBy === "vsMarket"
        ? VS_MARKET_BANDS
        : colorBy === "psf"
          ? PSF_BANDS
          : YIELD_BANDS;

  const quickViewRow = useMemo(
    () => (quickViewId ? rows.find((row) => row.propertyId === quickViewId) ?? null : null),
    [quickViewId, rows]
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Pipeline · Living comps"
        title="Yield Map"
        subtitle="Every deal with a calculated LTR yield (extracted NOI ÷ price) from OMs, broker docs, and notes — active, dead, or closed. Toggle $/PSF for the price-per-foot read, overlay broker-package comps, and layer market context from ingested research with provenance on every number."
        actions={
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void refreshAll()}
              disabled={refreshing}
              title="Re-pull deals and market layer from the database. Auto-refreshes every 60s and on tab focus."
            >
              {refreshing ? "Refreshing…" : "Refresh"}
              {lastRefreshedAt ? (
                <span className={styles.refreshStamp}>
                  {lastRefreshedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              ) : null}
            </button>
            <a href="/pipeline/market-docs" className={styles.headerLink}>
              Market docs →
            </a>
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
      {marketError ? (
        <div className={styles.errorBanner}>Market layer unavailable: {marketError}</div>
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
              value={yieldRows.length}
              sub={
                geoRows.length < yieldRows.length
                  ? `${geoRows.length} mapped · ${yieldRows.length - geoRows.length} missing geocode`
                  : `${geoRows.length} mapped`
              }
              title={
                geoRows.length < yieldRows.length
                  ? "Mapped deals have coordinates. Deals missing a geocode still count in the stats — run enrichment on them to place them on the map."
                  : "Every deal with a usable yield is geocoded and on the map."
              }
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
              sub={
                metric === "psf"
                  ? `across ${rows.length} deals`
                  : `across ${yieldRows.length} usable yield${yieldRows.length === 1 ? "" : "s"}`
              }
              title={
                metric === "psf"
                  ? undefined
                  : `Average over the ${yieldRows.length} deals with a usable LTR yield. Deals flagged for 0%/negative cap signals are excluded from the median and average until their extraction is fixed.`
              }
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
            {marketLayerOn && summaries.length > 0 ? (
              <StatCard
                tone="neutral"
                label="Market comps (12mo)"
                value={summaries.reduce((sum, summary) => sum + summary.compCount12mo, 0)}
                sub="from ingested research/broker docs"
              />
            ) : null}
            {flaggedRows.length > 0 ? (
              <StatCard
                tone="danger"
                label="Yield data flags"
                value={flaggedRows.length}
                sub="0% / $0 NOI — excluded from stats"
              />
            ) : null}
          </div>

          {headlines.length > 0 ? (
            <div className={styles.headlineStrip} aria-label="Market movement headlines">
              <span className={styles.headlineKicker}>Market headlines</span>
              <ul className={styles.headlineList}>
                {headlines.map((headline) => (
                  <li key={headline.id} className={styles.headlineItem}>
                    <span
                      className={
                        headline.tone === "up"
                          ? styles.headlineDotUp
                          : headline.tone === "down"
                            ? styles.headlineDotDown
                            : headline.tone === "watch"
                              ? styles.headlineDotWatch
                              : styles.headlineDotNeutral
                      }
                    />
                    <span className={styles.headlineText}>{headline.text}</span>
                    {headline.scope || headline.source ? (
                      <span className={styles.headlineMeta}>
                        {[headline.scope, headline.source, headline.asOf ? fmtMonthYear(headline.asOf) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <a href="/pipeline/market-docs" className={styles.headlineLink}>
                Knowledge base →
              </a>
            </div>
          ) : null}

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
                  <button
                    type="button"
                    className={colorBy === "vsMarket" ? styles.colorToggleActive : undefined}
                    onClick={() => setColorBy("vsMarket")}
                    title="Color each deal by whether its cap rate sits above or below the comps we hold for its neighborhood (market layer + broker packages)."
                  >
                    Vs comps
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
                <div
                  className={styles.colorToggle}
                  role="group"
                  aria-label="Market comp sources"
                  title="Where the market layer's comps come from: Research = published reports ingested on Market docs (Avison Young, Ariel, …); Broker = comps inside broker-provided OMs/BOVs/comp packages."
                >
                  {MARKET_SOURCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={marketSource === option.value && marketLayerOn ? styles.colorToggleActive : undefined}
                      title={
                        option.value === "market_research"
                          ? "Only comps from published market reports (uploaded on the Market docs page)."
                          : option.value === "broker_provided"
                            ? "Only comps that arrived inside broker-provided documents (OMs, BOVs, comp packages)."
                            : "Blend both comp sources."
                      }
                      onClick={() => {
                        setMarketSource(option.value);
                        setMarketLayerOn(true);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={!marketLayerOn ? styles.colorToggleActive : undefined}
                    onClick={() => setMarketLayerOn(false)}
                  >
                    Hide
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
                <label
                  className={styles.compToggle}
                  title="Underwritten properties whose OM extraction is still awaiting your review don't normally count. Toggle them into the map and the deal list — marked with a dashed ring until promoted."
                >
                  <input
                    type="checkbox"
                    checked={includePending}
                    onChange={(event) => setIncludePending(event.target.checked)}
                  />
                  Awaiting review
                  {pendingAvailable > 0 ? <span className={styles.compToggleNote}>{pendingAvailable}</span> : null}
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
                  {marketLayerOn ? (
                    <>
                      <span className={styles.legendItem}>
                        <span className={styles.legendHatch} />
                        submarket fallback
                      </span>
                      <span className={styles.legendItem}>
                        <span className={styles.legendHollow} />
                        asking (excluded)
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            {compsError && showComps ? <div className={styles.errorBanner}>{compsError}</div> : null}
            {geoRows.length > 0 || geoComps.length > 0 || marketHoods.length > 0 || hollowPins.length > 0 ? (
              <>
                <YieldMapCanvas
                  pins={pins}
                  boundaries={boundaries}
                  areas={areas}
                  showAreas={showAreas}
                  highlightedId={activePinId}
                  onPinHover={setActivePinId}
                  marketHoods={marketHoods}
                  hollowPins={hollowPins}
                  renderHoodPopup={renderHoodPopup}
                />
                <p className={styles.mapFootnote}>
                  {showAreas
                    ? `Neighborhood badges show the median ${metric === "psf" ? "sale $/SF" : "LTR yield"} of mapped deals inside each boundary (NYC NTA delineations)${
                        metric === "capRate" ? "; ▲/▼ marks the median cap-rate move since each deal was first sourced" : ""
                      }. `
                    : ""}
                  Hover a table row to spotlight its pin; hover a pin for cap rate and $/PSF
                  {showComps ? "; diamonds are broker-package comps" : ""}.
                  {marketLayerOn
                    ? " Sources: Research = published market reports ingested on Market docs; Broker = comps from broker-provided documents."
                    : ""}
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
                          <button
                            type="button"
                            className={styles.dealLink}
                            onClick={() => setQuickViewId(entry.deal.propertyId)}
                            title="Open the property wizard"
                          >
                            {entry.deal.canonicalAddress.split(",")[0]}
                          </button>
                          <div className={styles.dealNeighborhood}>
                            {[displayHood(entry.deal), entry.deal.borough].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td className={styles.yieldCell} style={{ color: yieldColor(entry.deal.ltrYieldPct) }}>
                          {entry.deal.yieldFlag ? (
                            <Badge tone="danger" title={entry.deal.yieldFlagDetail ?? undefined}>
                              review
                            </Badge>
                          ) : entry.deal.pendingReview ? (
                            <span
                              className={styles.pendingChip}
                              title="From an OM extraction still awaiting review — promote it in OM review to confirm."
                            >
                              {fmtPct(entry.deal.ltrYieldPct, 2)} ⏳
                            </span>
                          ) : (
                            fmtPct(entry.deal.ltrYieldPct, 2)
                          )}
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
                        <td className={styles.stageCell} title="Mirrors the deal-progress board stage for this property.">
                          {entry.deal.pendingReview ? (
                            <Badge tone="warning" title="OM extraction awaiting review">
                              awaiting review
                            </Badge>
                          ) : (
                            boardStageLabel(entry.deal)
                          )}
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
                            {entry.comp.neighborhood ?? (entry.comp.borough ? labelFromKey(entry.comp.borough) : "")}
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

      <Dialog
        open={quickViewRow != null}
        onClose={() => setQuickViewId(null)}
        title={quickViewRow ? quickViewRow.canonicalAddress.split(",")[0] : ""}
        description={
          quickViewRow
            ? [displayHood(quickViewRow), quickViewRow.borough].filter(Boolean).join(" · ") || undefined
            : undefined
        }
        size="md"
        footer={
          quickViewRow ? (
            <>
              <a className={styles.quickViewAction} href={`/pipeline?propertyId=${encodeURIComponent(quickViewRow.propertyId)}`}>
                Open property wizard →
              </a>
              <a
                className={styles.quickViewActionSecondary}
                href={`/deal-analysis?propertyId=${encodeURIComponent(quickViewRow.propertyId)}`}
              >
                OM workspace →
              </a>
            </>
          ) : undefined
        }
      >
        {quickViewRow ? (
          <div className={styles.quickView}>
            {quickViewRow.pendingReview ? (
              <div className={styles.quickViewNotice}>
                ⏳ Numbers come from an OM extraction awaiting review — promote or reject it in{" "}
                <a href="/om-review">OM review</a>.
              </div>
            ) : null}
            {quickViewRow.yieldFlagDetail ? (
              <div className={styles.quickViewNotice}>⚠ {quickViewRow.yieldFlagDetail}</div>
            ) : null}
            <dl className={styles.quickViewGrid}>
              <div>
                <dt>Cap rate (LTR)</dt>
                <dd style={{ color: yieldColor(quickViewRow.ltrYieldPct) }}>{fmtPct(quickViewRow.ltrYieldPct, 2)}</dd>
              </div>
              <div>
                <dt>MTR</dt>
                <dd>{fmtPct(quickViewRow.mtrYieldPct, 2)}</dd>
              </div>
              <div>
                <dt>Ask</dt>
                <dd>{formatCurrencyCompact(quickViewRow.askingPrice)}</dd>
              </div>
              <div>
                <dt>NOI</dt>
                <dd>{formatCurrencyExact(quickViewRow.currentNoi)}</dd>
              </div>
              <div>
                <dt>Units</dt>
                <dd>{quickViewRow.units ?? EMPTY_VALUE}</dd>
              </div>
              <div>
                <dt>$/Unit</dt>
                <dd>{formatCurrencyExact(quickViewRow.pricePerUnit)}</dd>
              </div>
              <div>
                <dt>$/SF</dt>
                <dd>{formatCurrencyExact(quickViewRow.pricePsf)}</dd>
              </div>
              <div>
                <dt>Deal score</dt>
                <dd>{quickViewRow.dealScore ?? EMPTY_VALUE}</dd>
              </div>
              <div>
                <dt>Stage</dt>
                <dd>{boardStageLabel(quickViewRow)}</dd>
              </div>
              <div>
                <dt>First sourced</dt>
                <dd>{fmtDateMDY(quickViewRow.firstYieldAt ?? quickViewRow.sourcedAt)}</dd>
              </div>
            </dl>
            {(() => {
              const vsMarket = vsMarketByPropertyId.get(quickViewRow.propertyId);
              if (!vsMarket) return null;
              return (
                <p className={styles.quickViewMarket}>
                  {vsMarket.capDeltaPp != null
                    ? `${vsMarket.capDeltaPp >= 0 ? "+" : ""}${Math.round(vsMarket.capDeltaPp * 100)} bps vs ${vsMarket.hoodName} comps (median cap ${fmtPct(vsMarket.marketCapPct, 2)})`
                    : vsMarket.psfDeltaPct != null
                      ? `${vsMarket.psfDeltaPct >= 0 ? "+" : ""}${vsMarket.psfDeltaPct.toFixed(0)}% vs ${vsMarket.hoodName} median $/SF (${fmtPsf(vsMarket.marketPsf)})`
                      : null}
                </p>
              );
            })()}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
