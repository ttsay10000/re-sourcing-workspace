"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Dialog, PageHeader, SortableTh, StatCard, useTableSort } from "@/components/ui";
import { dealFlowStageForStatus, STATUS_TO_CANONICAL } from "@re-sourcing/contracts";
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

/** Pricing basis the LTR yields are quoted on (mirrors the API's ask_source). */
type AskSource = "listed" | "whisper" | "user";

interface CompRow {
  propertyId: string;
  canonicalAddress: string;
  borough: string | null;
  neighborhood: string | null;
  dealState: string | null;
  dealStage: string | null;
  /** The deal-progress board's current pipeline status (rejection > deal path > board moves > legacy). */
  boardStatus: string | null;
  /** Manually scrubbed from yield-map calculations; persists with the property. */
  yieldMapExcluded: boolean;
  lat: number | null;
  lng: number | null;
  units: number | null;
  /** The price behind ltrYieldPct — the active pricing basis's price. */
  askingPrice: number | null;
  /** LTR yield on the active pricing basis. */
  ltrYieldPct: number | null;
  /** LTR yield recomputed on every basis; null where that basis has no price/NOI. */
  ltrYieldBySource?: Record<AskSource, number | null>;
  /** listed = OM ask → matched listing; whisper = latest broker pricing opinion; user = entered/negotiated. */
  askBySource?: Record<AskSource, number | null>;
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
    askSource?: AskSource;
    count: number;
    withCoordinates: number;
    flaggedCount?: number;
    pendingCount?: number;
    rejectedCount?: number;
    excludedCount?: number;
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

/** Comparable from GET /api/comps/market: broker-package items + approved market-doc deals. */
interface MarketComp {
  itemId: string;
  packageId: string;
  packageType: string;
  packageCreatedAt: string | null;
  subjectPropertyId: string | null;
  subjectAddress: string | null;
  itemType: string;
  origin?: "broker_package" | "market_doc";
  source?: {
    kind: "broker_package" | "market_doc";
    label: string;
    period: string | null;
  };
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
  // The trend tracks the stored underwriting signals, so "now" is the latest
  // signal (first + delta) — not the displayed yield, whose pricing basis can differ.
  const latestSignalPct =
    row.firstYieldPct != null && row.yieldDeltaPct != null ? row.firstYieldPct + row.yieldDeltaPct : row.ltrYieldPct;
  const title = `First ${fmtPct(row.firstYieldPct, 2)} on ${fmtDateMDY(row.firstYieldAt)} → now ${fmtPct(latestSignalPct, 2)}`;
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

const REJECTED_PIN_COLOR = "#dc2626";
/** Excluded-from-calcs rows render visibly muted in every color mode. */
const EXCLUDED_PIN_COLOR = "#cbd5e1";

function stagePinColor(stage: string | null): string {
  return (stage && STAGE_PIN_COLORS[stage]) || "#cbd5e1";
}

/** Rejected on the deal-progress board (dead deal). */
function isRejectedRow(row: CompRow): boolean {
  return row.boardStatus === "rejected";
}

/** Canonical pipeline stage for pin coloring — board status first, stored stage as fallback. */
function canonicalStageOf(row: CompRow): string | null {
  const fromStatus = row.boardStatus ? STATUS_TO_CANONICAL[row.boardStatus]?.stage : undefined;
  return fromStatus ?? row.dealStage;
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

const ASK_SOURCE_OPTIONS: Array<{ value: AskSource; label: string; title: string }> = [
  {
    value: "listed",
    label: "Listed",
    title: "Yields on the marketed price — the OM's asking price, else the matched listing's price.",
  },
  {
    value: "whisper",
    label: "Whisper",
    title: "Yields on the latest whisper price / broker pricing opinion saved for each deal (manual signal or comp-package extraction).",
  },
  {
    value: "user",
    label: "User input",
    title: "Yields on your entered or negotiated pricing — the underwriting basis (stored deal signals; manual price when no signal).",
  },
];

/** Inline tag for popup/KPI copy, e.g. "listed pricing". */
const ASK_SOURCE_SHORT: Record<AskSource, string> = {
  listed: "listed",
  whisper: "whisper",
  user: "user input",
};

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
  const [stageFilter, setStageFilter] = useState("");
  const [hoodFilter, setHoodFilter] = useState("");
  const [dealSearch, setDealSearch] = useState("");
  const [colorBy, setColorBy] = useState<"yield" | "psf" | "stage" | "vsMarket">("yield");
  // Listed pricing is the default read — negotiated/entered prices inflate yields.
  const [askSource, setAskSource] = useState<AskSource>("listed");
  const [showAreas, setShowAreas] = useState(true);
  const [includePending, setIncludePending] = useState(false);
  // Rejected deals stay off the free-market read unless toggled back in.
  const [showRejected, setShowRejected] = useState(false);
  // Manually scrubbed properties stay hidden unless toggled in for review.
  const [showExcluded, setShowExcluded] = useState(false);
  const [exclusionBusyId, setExclusionBusyId] = useState<string | null>(null);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [headlines, setHeadlines] = useState<MarketHeadline[]>([]);
  const [headlinesAsOf, setHeadlinesAsOf] = useState<string | null>(null);
  const [showAllHeadlines, setShowAllHeadlines] = useState(false);
  const [boundaries, setBoundaries] = useState<NeighborhoodCollection | null>(null);
  const [showComps, setShowComps] = useState(false);
  const [marketComps, setMarketComps] = useState<MarketCompsResponse | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  // Distinguish map-origin hover (scroll the table to the row) from
  // table-origin hover (never scroll — the user is already there).
  const hoverSourceRef = useRef<"map" | "table" | null>(null);

  // Two-way highlight: hovering a pin spotlights AND scrolls to its table row,
  // so far-down rows are actually findable from the map.
  useEffect(() => {
    if (!activePinId || hoverSourceRef.current !== "map") return;
    document.getElementById(`yield-row-${activePinId}`)?.scrollIntoView({ block: "nearest" });
  }, [activePinId]);
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
      const res = await fetch(`${API_BASE}/api/comps/operating?include_pending=1&ask_source=${askSource}`, {
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
  }, [askSource]);

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

  // Re-runs when the pricing basis changes (loadDeals identity). Only the very
  // first load gets the full-page banner; basis switches swap data in place.
  const hasLoadedOnceRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadDeals({ signal: controller.signal, initial: !hasLoadedOnceRef.current }).then(() => {
      hasLoadedOnceRef.current = true;
      setLastRefreshedAt(new Date());
    });
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
      .then((payload: { headlines?: MarketHeadline[]; generatedAt?: string | null } | null) => {
        if (Array.isArray(payload?.headlines)) {
          setHeadlines(payload.headlines.slice(0, 6));
          setHeadlinesAsOf(payload.headlines.find((headline) => headline.asOf)?.asOf ?? payload.generatedAt ?? null);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

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

  /** Board stage chip text — the same stage the deal-progress board shows right now. */
  const boardStageLabel = useCallback((row: CompRow): string => {
    if (isRejectedRow(row)) return "Rejected";
    const stage = dealFlowStageForStatus(row.boardStatus);
    if (stage) return stage.shortLabel;
    if (row.dealStage) return labelFromKey(row.dealStage);
    return row.dealState ? labelFromKey(row.dealState) : EMPTY_VALUE;
  }, []);

  // The working universe: rejected deals and manually scrubbed properties
  // only enter when their toggles bring them back. Filter options and counts
  // downstream all follow this set.
  const visibleComps = useMemo(
    () =>
      (data?.comps ?? []).filter(
        (row) => (showRejected || !isRejectedRow(row)) && (showExcluded || !row.yieldMapExcluded)
      ),
    [data, showRejected, showExcluded]
  );

  // All filters apply here so the headline stats, every table, and the map
  // pins narrow together.
  const rows = useMemo(() => {
    let all = visibleComps;
    if (!includePending) all = all.filter((row) => !row.pendingReview);
    if (boroughFilter) all = all.filter((row) => (row.borough ?? "Unknown") === boroughFilter);
    if (stageFilter) all = all.filter((row) => boardStageLabel(row) === stageFilter);
    if (hoodFilter) all = all.filter((row) => (displayHood(row) ?? "Unknown") === hoodFilter);
    return all;
  }, [visibleComps, boroughFilter, includePending, stageFilter, hoodFilter, boardStageLabel, displayHood]);

  // Calculation set: excluded properties can be *visible* (toggle) but never
  // count toward medians, averages, trends, or area badges.
  const calcRows = useMemo(() => rows.filter((row) => !row.yieldMapExcluded), [rows]);

  const pendingAvailable = useMemo(
    () => (data?.comps ?? []).filter((row) => row.pendingReview).length,
    [data]
  );
  const rejectedAvailable = useMemo(() => (data?.comps ?? []).filter(isRejectedRow).length, [data]);
  const excludedAvailable = useMemo(
    () => (data?.comps ?? []).filter((row) => row.yieldMapExcluded).length,
    [data]
  );

  /** Persist the scrub designation, then update the loaded rows in place. */
  const toggleExclusion = useCallback(async (row: CompRow) => {
    const next = !row.yieldMapExcluded;
    setExclusionBusyId(row.propertyId);
    try {
      const res = await fetch(`${API_BASE}/api/properties/${encodeURIComponent(row.propertyId)}/yield-map-exclusion`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excluded: next }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
      setData((current) =>
        current
          ? {
              ...current,
              comps: current.comps.map((comp) =>
                comp.propertyId === row.propertyId ? { ...comp, yieldMapExcluded: next } : comp
              ),
            }
          : current
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update yield-map exclusion.");
    } finally {
      setExclusionBusyId(null);
    }
  }, []);

  const compRows = useMemo(() => {
    if (!showComps) return [];
    const all = marketComps?.comps ?? [];
    if (!boroughFilter) return all;
    return all.filter((comp) => (comp.borough ?? "Unknown") === boroughFilter);
  }, [showComps, marketComps, boroughFilter]);

  const geoRows = useMemo(() => rows.filter((row) => row.lat != null && row.lng != null), [rows]);
  const calcGeoRows = useMemo(() => geoRows.filter((row) => !row.yieldMapExcluded), [geoRows]);
  const geoComps = useMemo(() => compRows.filter((comp) => comp.lat != null && comp.lng != null), [compRows]);

  const flaggedRows = useMemo(() => calcRows.filter((row) => row.yieldFlag != null), [calcRows]);
  const yieldRows = useMemo(() => calcRows.filter((row) => row.ltrYieldPct != null), [calcRows]);

  /** How many filtered deals carry a yield on each pricing basis — labels the toggle. */
  const askSourceCounts = useMemo(
    () => ({
      listed: rows.filter((row) => row.ltrYieldBySource?.listed != null).length,
      whisper: rows.filter((row) => row.ltrYieldBySource?.whisper != null).length,
      user: rows.filter((row) => row.ltrYieldBySource?.user != null).length,
    }),
    [rows]
  );

  /** "listed 4.82% · whisper 5.10% · user input 5.55%" — only bases with a yield. */
  const basisComparisonLine = useCallback((row: CompRow): string | null => {
    const parts = ASK_SOURCE_OPTIONS.map((option) => {
      const value = row.ltrYieldBySource?.[option.value];
      return value != null ? `${ASK_SOURCE_SHORT[option.value]} ${fmtPct(value, 2)}` : null;
    }).filter((part): part is string => part != null);
    return parts.length > 1 ? parts.join(" · ") : null;
  }, []);

  const summaries = useMemo(() => (marketLayerOn ? market?.summaries ?? [] : []), [market, marketLayerOn]);
  const summaryById = useMemo(
    () => new Map(summaries.map((summary) => [summary.neighborhoodId, summary])),
    [summaries]
  );

  // Hygiene set for "our deals vs market" medians: visibility toggles apply,
  // but excluded properties never feed the numbers even while shown.
  const statsComps = useMemo(() => visibleComps.filter((row) => !row.yieldMapExcluded), [visibleComps]);

  /** Our own deals' median LTR yield per neighborhood (alias-matched) for the spread line. */
  const ourYieldByHood = useMemo(() => {
    const aliasToHood = new Map<string, string>();
    for (const summary of summaries) {
      aliasToHood.set(normalizeHoodName(summary.neighborhoodId), summary.neighborhoodId);
      aliasToHood.set(normalizeHoodName(summary.name), summary.neighborhoodId);
      for (const alias of summary.aliases) aliasToHood.set(normalizeHoodName(alias), summary.neighborhoodId);
    }
    const grouped = new Map<string, number[]>();
    for (const row of statsComps) {
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
  }, [statsComps, summaries, hoodNameByPropertyId]);

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
          // Cap-median scale; muted slate when only a $/SF median exists;
          // null → faint neutral wash (submarket estimate).
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

  // Headline stats follow the borough filter (the API summary covers all
  // boroughs) and read from the calculation set — excluded rows never count.
  const stats = useMemo(() => {
    const yields = calcRows.map((row) => row.ltrYieldPct).filter((v): v is number => v != null);
    const psfs = calcRows.map((row) => row.pricePsf).filter((v): v is number => v != null);
    return {
      medianYieldPct: median(yields),
      averageYieldPct: yields.length > 0 ? yields.reduce((sum, v) => sum + v, 0) / yields.length : null,
      medianPsf: median(psfs),
      psfCount: psfs.length,
      upCount: calcRows.filter((row) => row.yieldTrend === "up").length,
      downCount: calcRows.filter((row) => row.yieldTrend === "down").length,
      flatCount: calcRows.filter((row) => row.yieldTrend === "flat").length,
    };
  }, [calcRows]);

  // Default order: cap-rate mode ranks neighborhoods by median cap rate
  // (highest first — the buyer's read); $/SF mode cheap-to-expensive.
  const neighborhoodStats = useMemo(
    () =>
      groupStats(calcRows, displayHood, dealMetricValue).sort((a, b) =>
        a.name === "Unknown" ? 1 : b.name === "Unknown" ? -1 : metric === "psf" ? a.medianValue - b.medianValue : b.medianValue - a.medianValue
      ),
    [calcRows, displayHood, dealMetricValue, metric]
  );
  const boroughStats = useMemo(
    () => groupStats(calcRows, (row) => row.borough, dealMetricValue),
    [calcRows, dealMetricValue]
  );

  // Click-to-sort on every table (default order preserved until a header is clicked).
  const areaSortAccessors = useMemo(
    () => ({
      name: (stat: AreaTableStat) => stat.name,
      count: (stat: AreaTableStat) => stat.count,
      median: (stat: AreaTableStat) => stat.medianValue,
      trend: (stat: AreaTableStat) => stat.medianDeltaPct,
      range: (stat: AreaTableStat) => stat.maxValue - stat.minValue,
      since: (stat: AreaTableStat) => stat.firstSourcedAt,
    }),
    []
  );
  const hoodSort = useTableSort(neighborhoodStats, areaSortAccessors);
  const boroughSort = useTableSort(boroughStats, areaSortAccessors);

  // Geometric roll-up for the map: assign mapped deals to the NTA polygon they
  // fall inside, then badge each area with its median for the active metric.
  const areas = useMemo<AreaStat[]>(() => {
    if (!boundaries) return [];
    const result: AreaStat[] = [];
    for (const feature of boundaries.features) {
      if (feature.properties.park) continue;
      const bbox = featureBBoxes.get(feature.properties.code);
      const members = calcGeoRows.filter((row) => pointInFeature(row.lng!, row.lat!, feature, bbox));
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
  }, [boundaries, featureBBoxes, calcGeoRows, dealMetricValue, metric, metricColor]);

  const pins = useMemo<MapPin[]>(() => {
    const dealPins: MapPin[] = geoRows.map((row) => {
      const vsMarket = vsMarketByPropertyId.get(row.propertyId) ?? null;
      const color = row.yieldMapExcluded
        ? EXCLUDED_PIN_COLOR
        : colorBy === "stage"
          ? isRejectedRow(row)
            ? REJECTED_PIN_COLOR
            : stagePinColor(canonicalStageOf(row))
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
      const basisLine = basisComparisonLine(row);
      const missingBasisLine =
        row.ltrYieldPct == null && row.yieldFlag == null && row.askBySource?.[askSource] == null
          ? `No ${ASK_SOURCE_SHORT[askSource]} price on file — switch the pricing basis to see this deal's yield`
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
          `Cap rate ${fmtPct(row.ltrYieldPct, 2)} (${ASK_SOURCE_SHORT[askSource]}) · ${fmtPsf(row.pricePsf)}/SF`,
          `MTR ${fmtPct(row.mtrYieldPct, 2)} · NOI ${formatCurrencyExact(row.currentNoi)} · ${row.units ?? EMPTY_VALUE} units`,
          ...(basisLine ? [`LTR by pricing: ${basisLine}`] : []),
          ...(missingBasisLine ? [missingBasisLine] : []),
          ...(vsMarketLine ? [vsMarketLine] : []),
          row.yieldDeltaPct != null
            ? `Yield ${fmtDeltaPp(row.yieldDeltaPct)} since first sourced ${fmtDateMDY(row.firstYieldAt)}`
            : `First sourced ${fmtDateMDY(row.firstYieldAt ?? row.sourcedAt)}`,
          `Stage: ${boardStageLabel(row)}`,
          ...(row.yieldMapExcluded ? ["✂ Excluded from yield calcs — not counted in medians or area stats"] : []),
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
        comp.subjectAddress
          ? `Subject: ${comp.subjectAddress.split(",")[0]} · ${packageTypeLabel(comp.packageType)}`
          : `Source: ${comp.source?.label ?? packageTypeLabel(comp.packageType)}${comp.source?.period ? ` · ${comp.source.period}` : ""}`,
      ],
    }));

    return [...dealPins, ...compPins];
  }, [colorBy, askSource, geoRows, geoComps, metric, metricColor, dealMetricValue, vsMarketByPropertyId, displayHood, boardStageLabel, basisComparisonLine]);

  // Comps slot into the deal list ordered by the active metric: cap rates rank
  // high-to-low, $/SF cheap-to-expensive (the buyer's read in both cases).
  const tableEntries = useMemo<TableEntry[]>(() => {
    const search = dealSearch.trim().toLowerCase();
    const matchesSearch = (entry: TableEntry): boolean => {
      if (!search) return true;
      const haystack =
        entry.kind === "deal"
          ? [entry.deal.canonicalAddress, displayHood(entry.deal), entry.deal.borough, boardStageLabel(entry.deal)]
          : [compDisplayName(entry.comp), entry.comp.neighborhood, entry.comp.borough, packageTypeLabel(entry.comp.packageType)];
      return haystack.filter(Boolean).join(" ").toLowerCase().includes(search);
    };
    const entries: TableEntry[] = [
      ...rows.map((deal): TableEntry => ({ kind: "deal", rowId: deal.propertyId, deal })),
      ...compRows.map((comp): TableEntry => ({ kind: "comp", rowId: `comp:${comp.itemId}`, comp })),
    ].filter(matchesSearch);
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
  }, [rows, compRows, metric, dealMetricValue, dealSearch, displayHood, boardStageLabel]);

  const dealSortAccessors = useMemo(
    () => ({
      address: (entry: TableEntry) =>
        entry.kind === "deal" ? entry.deal.canonicalAddress : compDisplayName(entry.comp),
      capRate: (entry: TableEntry) => (entry.kind === "deal" ? entry.deal.ltrYieldPct : entry.comp.capRatePct),
      trend: (entry: TableEntry) => (entry.kind === "deal" ? entry.deal.yieldDeltaPct : null),
      mtr: (entry: TableEntry) => (entry.kind === "deal" ? entry.deal.mtrYieldPct : null),
      noi: (entry: TableEntry) => (entry.kind === "deal" ? entry.deal.currentNoi : entry.comp.noi),
      units: (entry: TableEntry) => (entry.kind === "deal" ? entry.deal.units : entry.comp.units),
      pricePerUnit: (entry: TableEntry) => (entry.kind === "deal" ? entry.deal.pricePerUnit : entry.comp.pricePerUnit),
      psf: (entry: TableEntry) => (entry.kind === "deal" ? entry.deal.pricePsf : entry.comp.pricePsf),
      stage: (entry: TableEntry) =>
        entry.kind === "deal" ? boardStageLabel(entry.deal) : packageTypeLabel(entry.comp.packageType),
    }),
    [boardStageLabel]
  );
  const dealSort = useTableSort(tableEntries, dealSortAccessors);

  const boroughOptions = useMemo(
    () => [...new Set(visibleComps.map((row) => row.borough ?? "Unknown"))].sort(),
    [visibleComps]
  );
  const stageOptions = useMemo(
    () => [...new Set(visibleComps.map((row) => boardStageLabel(row)))].filter((label) => label !== EMPTY_VALUE).sort(),
    [visibleComps, boardStageLabel]
  );
  const hoodOptions = useMemo(
    () => [...new Set(visibleComps.map((row) => displayHood(row) ?? "Unknown"))].sort(),
    [visibleComps, displayHood]
  );

  // Toggling rejected/excluded visibility can remove the selected stage (e.g.
  // "Rejected") from the option list — reset instead of pinning an empty table.
  useEffect(() => {
    if (stageFilter && !stageOptions.includes(stageFilter)) setStageFilter("");
  }, [stageFilter, stageOptions]);

  const trendTone = stats.upCount > stats.downCount ? "success" : "neutral";
  const metricNoun = metric === "psf" ? "Sale $/SF" : "Cap rates";
  const legendBands =
    colorBy === "stage"
      ? showRejected
        ? [...STAGE_LEGEND, { label: "Rejected", color: REJECTED_PIN_COLOR }]
        : STAGE_LEGEND
      : colorBy === "vsMarket"
        ? VS_MARKET_BANDS
        : colorBy === "psf"
          ? PSF_BANDS
          : YIELD_BANDS;

  // Resolved against the full payload (not the filtered rows) so the dialog
  // survives the row being scrubbed/toggled out from under it.
  const quickViewRow = useMemo(
    () => (quickViewId ? (data?.comps ?? []).find((row) => row.propertyId === quickViewId) ?? null : null),
    [quickViewId, data]
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Pipeline · Living comps"
        title="Yield Map"
        subtitle="Every deal with a calculated LTR yield (extracted NOI ÷ price) from OMs, broker docs, and notes — active, dead, or closed. Yields quote on listed pricing by default; toggle to whisper or user-entered/negotiated pricing on the map. Toggle $/PSF for the price-per-foot read, overlay broker-package comps, and layer market context from ingested research with provenance on every number."
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
            <a href="/market-docs" className={styles.headerLink}>
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
            <label className={styles.filterLabel}>
              Neighborhood
              <select
                className={styles.filterSelect}
                value={hoodFilter}
                onChange={(event) => setHoodFilter(event.target.value)}
              >
                <option value="">All neighborhoods</option>
                {hoodOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className={styles.filterLabel}>
              Stage
              <select
                className={styles.filterSelect}
                value={stageFilter}
                onChange={(event) => setStageFilter(event.target.value)}
              >
                <option value="">All stages</option>
                {stageOptions.map((name) => (
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
                calcGeoRows.length < yieldRows.length
                  ? `${calcGeoRows.length} mapped · ${yieldRows.length - calcGeoRows.length} missing geocode`
                  : `${calcGeoRows.length} mapped`
              }
              title={
                calcGeoRows.length < yieldRows.length
                  ? "Mapped deals have coordinates. Deals missing a geocode still count in the stats — run enrichment on them to place them on the map."
                  : "Every deal with a usable yield is geocoded and on the map."
              }
            />
            <StatCard
              tone="brand"
              label={metric === "psf" ? "Median sale $/SF" : "Median LTR yield"}
              value={metric === "psf" ? `${fmtPsf(stats.medianPsf)}/SF` : formatPercent(stats.medianYieldPct, 2)}
              sub={`${boroughFilter ? boroughFilter : "all boroughs"}${metric === "psf" ? "" : ` · ${ASK_SOURCE_SHORT[askSource]} pricing`}`}
              title={
                metric === "psf"
                  ? undefined
                  : `Yields quoted on ${ASK_SOURCE_SHORT[askSource]} pricing — use the pricing-basis toggle on the map to switch between listed, whisper, and user-entered prices.`
              }
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
            {excludedAvailable > 0 ? (
              <StatCard
                tone="neutral"
                label="Scrubbed from calcs"
                value={excludedAvailable}
                sub={showExcluded ? "shown muted on the map" : "hidden — toggle ‘Excluded’"}
                title="Properties manually excluded from yield-map calculations (e.g. rent-stabilized buildings). They never count toward medians, averages, or area stats."
              />
            ) : null}
          </div>

          {headlines.length > 0 ? (
            <div className={styles.headlineStrip} aria-label="Market movement headlines">
              <div className={styles.headlineStripHead}>
                <span className={styles.headlineKicker}>
                  Market headlines
                  {headlinesAsOf ? (
                    <span className={styles.headlineAsOf}>· data through {fmtMonthYear(headlinesAsOf)}</span>
                  ) : null}
                </span>
                <a href="/market-docs" className={styles.headlineLink}>
                  Knowledge base →
                </a>
              </div>
              <ul className={styles.headlineList}>
                {(showAllHeadlines ? headlines : headlines.slice(0, 4)).map((headline) => (
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
              {headlines.length > 4 ? (
                <button
                  type="button"
                  className={styles.headlineMoreButton}
                  onClick={() => setShowAllHeadlines((current) => !current)}
                >
                  {showAllHeadlines ? "Show fewer" : `+${headlines.length - 4} more`}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={styles.panel}>
            <div className={styles.mapHeader}>
              <span className={styles.mapTitle}>
                Deal map — pins colored by{" "}
                {colorBy === "yield"
                  ? `cap rate (${ASK_SOURCE_SHORT[askSource]} pricing)`
                  : colorBy === "psf"
                    ? "sale $/SF"
                    : "deal stage"}
              </span>
              <div className={styles.mapControls}>
                <div
                  className={styles.colorToggle}
                  role="group"
                  aria-label="LTR pricing basis"
                  title="Which price the LTR yields divide by: the listed ask, the broker's whisper price, or your entered/negotiated pricing. Counts show how many filtered deals carry each basis."
                >
                  {ASK_SOURCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={askSource === option.value ? styles.colorToggleActive : undefined}
                      title={option.title}
                      onClick={() => setAskSource(option.value)}
                    >
                      {option.label} ({askSourceCounts[option.value]})
                    </button>
                  ))}
                </div>
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
                <label
                  className={styles.compToggle}
                  title="Deals rejected on the deal-progress board stay out of the map, tables, and medians by default, keeping the cap-rate read on free-market availability. Toggle them back in — while shown they count in the stats."
                >
                  <input
                    type="checkbox"
                    checked={showRejected}
                    onChange={(event) => setShowRejected(event.target.checked)}
                  />
                  Rejected
                  {rejectedAvailable > 0 ? <span className={styles.compToggleNote}>{rejectedAvailable}</span> : null}
                </label>
                <label
                  className={styles.compToggle}
                  title="Properties manually scrubbed from yield calculations (✂ on a deal row — e.g. rent-stabilized buildings that would distort free-market cap rates). They never count toward medians, averages, or area stats; toggle to show them muted for review or re-inclusion."
                >
                  <input
                    type="checkbox"
                    checked={showExcluded}
                    onChange={(event) => setShowExcluded(event.target.checked)}
                  />
                  Excluded
                  {excludedAvailable > 0 ? <span className={styles.compToggleNote}>{excludedAvailable}</span> : null}
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
                        <span className={styles.legendDot} style={{ background: "#94a3b8", opacity: 0.5 }} />
                        submarket estimate
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
                  onPinHover={(id) => {
                    hoverSourceRef.current = "map";
                    setActivePinId(id);
                  }}
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
                      <SortableTh label="Neighborhood" sortKey="name" firstDir="asc" activeKey={hoodSort.sortKey} direction={hoodSort.sortDir} onToggle={hoodSort.toggle} />
                      <SortableTh label="Deals" sortKey="count" activeKey={hoodSort.sortKey} direction={hoodSort.sortDir} onToggle={hoodSort.toggle} />
                      <SortableTh label="Median" sortKey="median" activeKey={hoodSort.sortKey} direction={hoodSort.sortDir} onToggle={hoodSort.toggle} />
                      {metric === "capRate" ? (
                        <SortableTh label="Trend" sortKey="trend" activeKey={hoodSort.sortKey} direction={hoodSort.sortDir} onToggle={hoodSort.toggle} />
                      ) : (
                        <SortableTh label="Range" sortKey="range" activeKey={hoodSort.sortKey} direction={hoodSort.sortDir} onToggle={hoodSort.toggle} />
                      )}
                      <SortableTh label="Since" sortKey="since" firstDir="asc" activeKey={hoodSort.sortKey} direction={hoodSort.sortDir} onToggle={hoodSort.toggle} />
                    </tr>
                  </thead>
                  <tbody>
                    {hoodSort.sorted.map((stat) => (
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
                      <SortableTh label="Borough" sortKey="name" firstDir="asc" activeKey={boroughSort.sortKey} direction={boroughSort.sortDir} onToggle={boroughSort.toggle} />
                      <SortableTh label="Deals" sortKey="count" activeKey={boroughSort.sortKey} direction={boroughSort.sortDir} onToggle={boroughSort.toggle} />
                      <SortableTh label="Median" sortKey="median" activeKey={boroughSort.sortKey} direction={boroughSort.sortDir} onToggle={boroughSort.toggle} />
                      <SortableTh label="Range" sortKey="range" activeKey={boroughSort.sortKey} direction={boroughSort.sortDir} onToggle={boroughSort.toggle} />
                      {metric === "capRate" ? (
                        <SortableTh label="Trend" sortKey="trend" activeKey={boroughSort.sortKey} direction={boroughSort.sortDir} onToggle={boroughSort.toggle} />
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {boroughSort.sorted.map((stat) => (
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
              <div className={styles.tableTitleRow}>
                <span className={styles.tableTitle}>
                  All yield-bearing deals{showComps && compRows.length > 0 ? ` + ${compRows.length} comps` : ""}
                </span>
                <input
                  type="search"
                  className={styles.tableFilterInput}
                  value={dealSearch}
                  onChange={(event) => setDealSearch(event.target.value)}
                  placeholder="Filter by address, neighborhood, stage…"
                  aria-label="Filter deals table"
                />
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <SortableTh label="Address" sortKey="address" firstDir="asc" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <SortableTh label="Cap rate" sortKey="capRate" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <SortableTh
                      label="Trend"
                      sortKey="trend"
                      activeKey={dealSort.sortKey}
                      direction={dealSort.sortDir}
                      onToggle={dealSort.toggle}
                      title="Move since the yield was first produced; refreshes that change the cap rate add a new observation."
                    />
                    <SortableTh label="MTR" sortKey="mtr" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <SortableTh label="NOI" sortKey="noi" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <SortableTh label="Units" sortKey="units" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <SortableTh label="$/Unit" sortKey="pricePerUnit" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <SortableTh label="$/SF" sortKey="psf" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <SortableTh label="Stage" sortKey="stage" firstDir="asc" activeKey={dealSort.sortKey} direction={dealSort.sortDir} onToggle={dealSort.toggle} />
                    <th
                      className={styles.actionTh}
                      aria-label="Yield calculation inclusion"
                      title="Scrub a property out of yield-map calculations (medians, averages, area stats). The designation persists with the property."
                    />
                  </tr>
                </thead>
                <tbody>
                  {dealSort.sorted.map((entry) =>
                    entry.kind === "deal" ? (
                      <tr
                        key={entry.rowId}
                        id={`yield-row-${entry.rowId}`}
                        className={
                          [
                            entry.deal.yieldMapExcluded ? styles.rowExcluded : null,
                            activePinId === entry.rowId ? styles.rowActive : null,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                        onMouseEnter={() => {
                          hoverSourceRef.current = "table";
                          setActivePinId(entry.rowId);
                        }}
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
                          ) : entry.deal.ltrYieldPct == null ? (
                            <span
                              className={styles.trendNone}
                              title={
                                entry.deal.askBySource?.[askSource] == null
                                  ? `No ${ASK_SOURCE_SHORT[askSource]} price on file for this deal — switch the pricing basis to compare. ${basisComparisonLine(entry.deal) ?? ""}`.trim()
                                  : "No NOI extracted yet for this deal."
                              }
                            >
                              {EMPTY_VALUE}
                            </span>
                          ) : (
                            <span title={basisComparisonLine(entry.deal) ?? undefined}>{fmtPct(entry.deal.ltrYieldPct, 2)}</span>
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
                          ) : isRejectedRow(entry.deal) ? (
                            <Badge tone="danger" title="Rejected on the deal-progress board — shown because the Rejected toggle is on.">
                              rejected
                            </Badge>
                          ) : (
                            boardStageLabel(entry.deal)
                          )}
                        </td>
                        <td className={styles.actionCell}>
                          <button
                            type="button"
                            className={styles.excludeButton}
                            disabled={exclusionBusyId === entry.deal.propertyId}
                            onClick={() => void toggleExclusion(entry.deal)}
                            title={
                              entry.deal.yieldMapExcluded
                                ? "Excluded from yield-map calculations. Click to count this property again — the designation persists with the property."
                                : "Scrub this property out of yield-map calculations (medians, averages, area stats) — e.g. rent-stabilized buildings. Persists with the property until re-included."
                            }
                          >
                            {entry.deal.yieldMapExcluded ? "↺ include" : "✂ exclude"}
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={entry.rowId}
                        id={`yield-row-${entry.rowId}`}
                        className={`${styles.compRow} ${activePinId === entry.rowId ? styles.rowActive : ""}`}
                        onMouseEnter={() => {
                          hoverSourceRef.current = "table";
                          setActivePinId(entry.rowId);
                        }}
                        onMouseLeave={() => setActivePinId(null)}
                      >
                        <td className={styles.dealAddressCell}>
                          <span className={styles.compRowHead}>
                            {entry.comp.subjectPropertyId ? (
                              <a
                                href={`/pipeline?propertyId=${encodeURIComponent(entry.comp.subjectPropertyId)}`}
                                className={styles.compLink}
                                title={`From a ${packageTypeLabel(entry.comp.packageType)} package on ${entry.comp.subjectAddress ?? "a subject deal"}`}
                              >
                                {compDisplayName(entry.comp)}
                              </a>
                            ) : (
                              <span
                                className={styles.compLink}
                                title={`From ${entry.comp.source?.label ?? "a market document"}${entry.comp.source?.period ? ` · ${entry.comp.source.period}` : ""}`}
                              >
                                {compDisplayName(entry.comp)}
                              </span>
                            )}
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
                        <td className={styles.actionCell} />
                      </tr>
                    )
                  )}
                  {dealSort.sorted.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={10}>
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
              <button
                type="button"
                className={styles.quickViewActionSecondary}
                disabled={exclusionBusyId === quickViewRow.propertyId}
                onClick={() => void toggleExclusion(quickViewRow)}
                title={
                  quickViewRow.yieldMapExcluded
                    ? "Count this property in yield-map calculations again."
                    : "Scrub this property out of yield-map calculations (medians, averages, area stats). Persists with the property."
                }
              >
                {quickViewRow.yieldMapExcluded ? "↺ Include in yield calcs" : "✂ Exclude from yield calcs"}
              </button>
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
            {quickViewRow.yieldMapExcluded ? (
              <div className={styles.quickViewNotice}>
                ✂ Excluded from yield-map calculations — this property never counts toward medians, averages, or
                area stats until re-included.
              </div>
            ) : null}
            <dl className={styles.quickViewGrid}>
              <div>
                <dt>Cap rate (LTR · {ASK_SOURCE_SHORT[askSource]})</dt>
                <dd style={{ color: yieldColor(quickViewRow.ltrYieldPct) }}>{fmtPct(quickViewRow.ltrYieldPct, 2)}</dd>
              </div>
              <div>
                <dt>MTR</dt>
                <dd>{fmtPct(quickViewRow.mtrYieldPct, 2)}</dd>
              </div>
              <div>
                <dt>Ask ({ASK_SOURCE_SHORT[askSource]})</dt>
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
              const parts = ASK_SOURCE_OPTIONS.map((option) => {
                const yieldPct = quickViewRow.ltrYieldBySource?.[option.value];
                const ask = quickViewRow.askBySource?.[option.value];
                if (yieldPct == null && ask == null) return null;
                return `${ASK_SOURCE_SHORT[option.value]} ${fmtPct(yieldPct, 2)}${
                  ask != null ? ` @ ${formatCurrencyCompact(ask)}` : ""
                }`;
              }).filter((part): part is string => part != null);
              if (parts.length === 0) return null;
              return <p className={styles.quickViewMarket}>LTR by pricing basis: {parts.join(" · ")}</p>;
            })()}
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
