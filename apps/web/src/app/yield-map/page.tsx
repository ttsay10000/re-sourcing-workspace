"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, PageHeader, StatCard } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { formatPercent, formatCurrencyExact, EMPTY_VALUE } from "@/lib/format";
import styles from "./yieldMap.module.css";
import { YieldMapCanvas, type HollowPin, type MapPin, type MarketHood } from "./YieldMapCanvas";

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
  /** Set when yield data is untrustworthy (0%/negative cap, $0 NOI); excluded from stats. */
  yieldFlag: string | null;
  yieldFlagDetail: string | null;
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
    flaggedCount?: number;
    averageLtrYieldPct: number | null;
    medianLtrYieldPct: number | null;
    boroughStats: BoroughStat[];
  };
}

/** Provenance tag carried by every market comp/stat (see contracts/marketContext). */
interface MarketProvenance {
  source_type: "broker_provided" | "market_research";
  publisher: string | null;
  document_class: string;
  report_title: string | null;
  page: number | null;
}

interface MarketCompRow {
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
  topComps: MarketCompRow[];
}

interface MarketSummariesResponse {
  summaries: NeighborhoodSummaryRow[];
  askingPins: MarketCompRow[];
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

/** Market cap rates arrive as decimals (0.0596). */
function fmtCapRate(rate: number | null | undefined, digits = 2): string {
  return rate != null && Number.isFinite(rate) ? `${(rate * 100).toFixed(digits)}%` : EMPTY_VALUE;
}

function fmtPsf(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${Math.round(value).toLocaleString("en-US")}/SF` : EMPTY_VALUE;
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

type MarketSourceFilter = "all" | "market_research" | "broker_provided";

const MARKET_SOURCE_OPTIONS: Array<{ value: MarketSourceFilter; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "market_research", label: "Research only" },
  { value: "broker_provided", label: "Broker only" },
];

function publisherInitials(publisher: string | null): string {
  if (!publisher) return "R";
  return publisher
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeHoodName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Per-row source badge(s): RESEARCH chip (publisher initials) vs BROKER; corroborated comps get both. */
function appendSourceChips(target: HTMLElement, comp: MarketCompRow): void {
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

export default function YieldMapPage() {
  const [data, setData] = useState<CompsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boroughFilter, setBoroughFilter] = useState("");
  const [colorBy, setColorBy] = useState<"yield" | "stage">("yield");
  const [market, setMarket] = useState<MarketSummariesResponse | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketSource, setMarketSource] = useState<MarketSourceFilter>("all");
  const [marketLayerOn, setMarketLayerOn] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const loadDeals = useCallback(async (options?: { signal?: AbortSignal; initial?: boolean }) => {
    if (options?.initial) setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/comps/operating`, {
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

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([loadDeals(), loadMarket()]);
    setLastRefreshedAt(new Date());
    setRefreshing(false);
  }, [loadDeals, loadMarket]);

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
          ...(row.yieldFlagDetail ? [`⚠ ${row.yieldFlagDetail}`] : []),
        ],
      })),
    [colorBy, geoRows]
  );

  const flaggedRows = useMemo(() => rows.filter((row) => row.yieldFlag != null), [rows]);
  const yieldRows = useMemo(() => rows.filter((row) => row.ltrYieldPct != null), [rows]);

  const boroughOptions = useMemo(
    () => [...new Set((data?.comps ?? []).map((row) => row.borough ?? "Unknown"))].sort(),
    [data]
  );

  const summaries = useMemo(() => market?.summaries ?? [], [market]);
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
      if (!row.neighborhood || row.ltrYieldPct == null) continue;
      const hoodId = aliasToHood.get(normalizeHoodName(row.neighborhood));
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
  }, [data, summaries]);

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
          `ASKING ${formatCurrencyExact(comp.salePrice)} · ${fmtPsf(comp.pricePsf)}`,
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
        hero.textContent = `Median ${fmtPsf(summary.medianPsf)}`;
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
          psfCell.textContent = fmtPsf(comp.pricePsf);
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

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Living comps"
        title="Yield Map"
        subtitle="Deal-level LTR yield (extracted NOI ÷ price) from our own pipeline, layered over market context from ingested broker materials and published research — with provenance on every number."
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
              label="Market comps (12mo)"
              value={summaries.reduce((sum, summary) => sum + summary.compCount12mo, 0)}
            />
            {flaggedRows.length > 0 ? (
              <StatCard
                tone="danger"
                label="Yield data flags"
                value={flaggedRows.length}
                sub="0% / $0 NOI — excluded from stats"
              />
            ) : null}
          </div>

          <div className={styles.panel}>
            <div className={styles.mapHeader}>
              <span className={styles.mapTitle}>
                Deal pins colored by {colorBy === "yield" ? "LTR yield" : "deal stage"} · market fill = median cap
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
                <div className={styles.colorToggle} role="group" aria-label="Market comp sources">
                  {MARKET_SOURCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={marketSource === option.value && marketLayerOn ? styles.colorToggleActive : undefined}
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
                <div className={styles.legendList}>
                  {(colorBy === "yield" ? YIELD_BANDS : STAGE_LEGEND).map((band) => (
                    <span key={band.label} className={styles.legendItem}>
                      <span className={styles.legendDot} style={{ background: band.color }} />
                      {band.label}
                    </span>
                  ))}
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
            <YieldMapCanvas
              pins={pins}
              marketHoods={marketHoods}
              hollowPins={hollowPins}
              renderHoodPopup={renderHoodPopup}
            />
            {geoRows.length === 0 ? (
              <div className={styles.mapEmpty}>
                No geocoded deals to plot yet ({geoRows.length} with coordinates). Coordinates backfill
                from matched listings automatically; the market-context layer renders regardless.
              </div>
            ) : null}
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
                        {row.yieldFlag ? (
                          <Badge tone="danger" title={row.yieldFlagDetail ?? undefined}>
                            review
                          </Badge>
                        ) : (
                          fmtPct(row.ltrYieldPct, 2)
                        )}
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
