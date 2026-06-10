"use client";

/**
 * Rental Analysis — competitor furnished-rental pricing calendar (Haus live;
 * Rove/Blueground coming soon). Month-by-month accommodation-subtotal comps
 * on a map + table, with a selected acquisition target, best-match ranking,
 * and a suggested low/base/high MTR rent. Rates are undiscounted monthly
 * equivalents by default; every caveated number carries its status label.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, PageHeader } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { EMPTY_VALUE, formatDateTimeShort, formatNumber } from "@/lib/format";
import { RentalMapCanvas, type RentalMapPin, type RentalMapTarget } from "./RentalMapCanvas";
import styles from "./rentalAnalysis.module.css";

type CompetitorSource = "haus" | "rove" | "blueground";

interface SourceStatus {
  source: CompetitorSource;
  enabled: boolean;
  supportsDateQuotes: boolean;
  listingCount: number;
  excludedCount: number;
  lastScrapedAt: string | null;
}

interface Listing {
  id: string;
  source: CompetitorSource;
  url: string;
  title: string | null;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  latitude: number | null;
  longitude: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  minStayNights: number | null;
  imageUrl: string | null;
  excludedFromComps: boolean;
  exclusionReason: string | null;
}

interface Observation {
  quoteType: string;
  availabilityStatus: string;
  effectiveAdr: number | null;
  undiscountedAdr: number | null;
  effectiveMonthlyEquivalent: number | null;
  undiscountedMonthlyEquivalent: number | null;
  discountAmount: number | null;
  normalizationStatus: string;
  confidence: "high" | "medium" | "low";
}

interface ListingRow {
  listing: Listing;
  observation: Observation | null;
  monthlyEquivalent: number | null;
}

interface Summary {
  compCount: number;
  excludedCount: number;
  unavailableCount: number;
  lowConfidenceCount: number;
  averageMonthlyRate: number | null;
  medianMonthlyRate: number | null;
  p25MonthlyRate: number | null;
  p75MonthlyRate: number | null;
  averageAdr: number | null;
  medianAdr: number | null;
}

interface TargetOption {
  propertyId: string;
  address: string;
  neighborhood: string | null;
  hasCoordinates: boolean;
  saved: boolean;
}

interface MatchScore {
  totalScore: number;
  explanation: string;
  labels: string[];
  distanceMiles: number | null;
}

interface MatchResponse {
  target: {
    propertyId: string;
    address: string;
    neighborhood: string | null;
    borough: string | null;
    lat: number | null;
    lng: number | null;
    units: number | null;
    gsf: number | null;
    medianBeds: number | null;
    mtrYieldPct: number | null;
    ltrYieldPct: number | null;
    monthlyMtrRentAssumption: number | null;
  };
  comps: Array<{ score: MatchScore; listing: Listing; observation: Observation | null; monthlyEquivalent: number | null }>;
  suggestedRent: {
    suggestedMonthlyRentLow: number | null;
    suggestedMonthlyRentBase: number | null;
    suggestedMonthlyRentHigh: number | null;
    suggestedAdrBase: number | null;
    compCount: number;
    confidence: "high" | "medium" | "low";
    explanation: string;
  };
  summary: Summary;
}

interface RunSummary {
  id: string;
  source: CompetitorSource;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  metadataSuccessCount: number;
  metadataFailureCount: number;
  pricingSuccessCount: number;
  pricingFailureCount: number;
  excludedCount: number;
  errorCount: number;
  note: string | null;
}

const SOURCE_LABELS: Record<CompetitorSource, string> = {
  haus: "Haus",
  rove: "Rove",
  blueground: "Blueground",
};

const STATUS_LABELS: Record<string, string> = {
  subtotal_clean_no_fees_taxes: "Clean subtotal",
  discount_removed: "Discount removed",
  discount_estimated: "Discount estimated",
  effective_rate_only: "Effective rate only",
  pricing_unavailable: "No pricing",
  excluded_term_requirement: "Excluded terms",
  low_confidence: "Low confidence",
};

const QUOTE_TYPES = [
  { value: "calendar_month", label: "Calendar month" },
  { value: "rolling_30_nights", label: "Rolling 30 nights" },
  { value: "rolling_60_nights", label: "60 nights (discount analysis)" },
  { value: "rolling_90_nights", label: "90 nights (discount analysis)" },
  { value: "rolling_180_nights", label: "180 nights (discount analysis)" },
];

function nextMonths(count: number): Array<{ value: string; label: string }> {
  const now = new Date();
  const months: Array<{ value: string; label: string }> = [];
  for (let offset = 1; offset <= count; offset++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    months.push({
      value: date.toISOString().slice(0, 7),
      label: date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return months;
}

function rateColor(monthly: number | null): string {
  if (monthly == null) return "#94a3b8";
  if (monthly < 4000) return "#16a34a";
  if (monthly < 6000) return "#0d9488";
  if (monthly < 8000) return "#d97706";
  return "#dc2626";
}

function money(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${Math.round(value).toLocaleString("en-US")}` : EMPTY_VALUE;
}

export default function RentalAnalysisPage() {
  const months = useMemo(() => nextMonths(12), []);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [sourceFilter, setSourceFilter] = useState<CompetitorSource | "all">("all");
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const [quoteType, setQuoteType] = useState("calendar_month");
  const [rateBasis, setRateBasis] = useState<"undiscounted" | "effective">("undiscounted");
  const [hideLowConfidence, setHideLowConfidence] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [beds, setBeds] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("1.5");

  const [rows, setRows] = useState<ListingRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [targetQuery, setTargetQuery] = useState("");
  const [targetOptions, setTargetOptions] = useState<TargetOption[]>([]);
  const [showTargetOptions, setShowTargetOptions] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const listingParams = useCallback(() => {
    const params = new URLSearchParams({ month, quoteType });
    if (sourceFilter !== "all") params.set("sources", sourceFilter);
    if (rateBasis === "effective") params.set("rates", "effective");
    if (hideLowConfidence) params.set("hideLowConfidence", "1");
    if (showExcluded) params.set("includeExcluded", "1");
    if (beds) params.set("beds", beds);
    if (neighborhood.trim()) params.set("neighborhood", neighborhood.trim());
    return params;
  }, [month, quoteType, sourceFilter, rateBasis, hideLowConfidence, showExcluded, beds, neighborhood]);

  const loadSources = useCallback(() => {
    fetch(`${API_BASE}/api/rental-analysis/sources`, { credentials: "include" })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as { sources?: SourceStatus[]; error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setSources(payload.sources ?? []);
      })
      .catch(() => {});
  }, []);

  const loadRuns = useCallback(() => {
    fetch(`${API_BASE}/api/rental-analysis/runs?limit=10`, { credentials: "include" })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as { runs?: RunSummary[]; error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setRuns(payload.runs ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSources();
    loadRuns();
  }, [loadSources, loadRuns]);

  // Listings for the selected month/filters.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${API_BASE}/api/rental-analysis/listings?${listingParams().toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as {
          rows?: ListingRow[];
          summary?: Summary;
          error?: string;
        };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setRows(payload.rows ?? []);
        setSummary(payload.summary ?? null);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load rental comps.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [listingParams]);

  // Target typeahead.
  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`${API_BASE}/api/rental-analysis/targets?q=${encodeURIComponent(targetQuery)}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then(async (res) => {
          const payload = (await res.json().catch(() => ({}))) as { targets?: TargetOption[] };
          setTargetOptions(payload.targets ?? []);
        })
        .catch(() => {});
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [targetQuery]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (targetRef.current && !targetRef.current.contains(event.target as Node)) setShowTargetOptions(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Match for the selected target.
  useEffect(() => {
    if (!targetId) {
      setMatch(null);
      return;
    }
    const controller = new AbortController();
    const params = listingParams();
    params.set("propertyId", targetId);
    params.set("radiusMiles", radiusMiles);
    fetch(`${API_BASE}/api/rental-analysis/match?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as MatchResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setMatch(payload);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setNotice(err instanceof Error ? err.message : "Failed to build comp match.");
      });
    return () => controller.abort();
  }, [targetId, listingParams, radiusMiles]);

  const refreshData = useCallback(() => {
    setRefreshing(true);
    setNotice(null);
    fetch(`${API_BASE}/api/rental-analysis/refresh?wait=1`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "haus" }),
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as {
          status?: string;
          note?: string | null;
          counts?: { discoveredCount: number; pricingSuccessCount: number };
          error?: string;
        };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        if (payload.status === "failed") {
          setNotice(`Haus run failed: ${payload.note ?? "see diagnostics"}. The source may block automated access — it is marked unavailable rather than bypassed.`);
        } else {
          setNotice(
            `Haus run complete: ${payload.counts?.discoveredCount ?? 0} listings discovered, ${payload.counts?.pricingSuccessCount ?? 0} priced.`
          );
        }
        loadSources();
        loadRuns();
        setMonth((current) => current); // re-trigger listings load
      })
      .catch((err) => setNotice(err instanceof Error ? err.message : "Refresh failed."))
      .finally(() => setRefreshing(false));
  }, [loadSources, loadRuns]);

  const bestCompIds = useMemo(
    () => new Set((match?.comps ?? []).slice(0, 10).map((comp) => comp.listing.id)),
    [match]
  );

  const pins = useMemo<RentalMapPin[]>(() => {
    return rows
      .filter((row) => row.listing.latitude != null && row.listing.longitude != null)
      .map((row) => {
        const statusLabel = row.observation ? STATUS_LABELS[row.observation.normalizationStatus] ?? row.observation.normalizationStatus : "No pricing";
        return {
          id: row.listing.id,
          source: row.listing.source,
          lat: row.listing.latitude as number,
          lng: row.listing.longitude as number,
          color: rateColor(row.monthlyEquivalent),
          excluded: row.listing.excludedFromComps,
          highlighted: bestCompIds.has(row.listing.id),
          title: row.listing.title ?? row.listing.address ?? "Listing",
          subtitle: [SOURCE_LABELS[row.listing.source], row.listing.neighborhood].filter(Boolean).join(" · "),
          lines: [
            [
              row.listing.beds != null ? `${row.listing.beds} BD` : null,
              row.listing.baths != null ? `${row.listing.baths} BA` : null,
              row.listing.sqft != null ? `${formatNumber(row.listing.sqft)} SF` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            `${months.find((entry) => entry.value === month)?.label ?? month}: ${money(row.monthlyEquivalent)}/mo`,
            row.observation?.undiscountedAdr != null ? `ADR ${money(rateBasis === "effective" ? row.observation.effectiveAdr : row.observation.undiscountedAdr)}` : "",
            `${statusLabel}${row.observation ? ` · ${row.observation.confidence} confidence` : ""}`,
            row.listing.excludedFromComps ? `Excluded: ${row.listing.exclusionReason ?? "terms"}` : "",
          ].filter(Boolean),
          imageUrl: row.listing.imageUrl,
          url: row.listing.url,
        };
      });
  }, [rows, bestCompIds, month, months, rateBasis]);

  const mapTarget = useMemo<RentalMapTarget | null>(() => {
    if (!match?.target || match.target.lat == null || match.target.lng == null) return null;
    return {
      lat: match.target.lat,
      lng: match.target.lng,
      label: match.target.address,
      radiusMiles: Number(radiusMiles) || null,
    };
  }, [match, radiusMiles]);

  const hausStatus = sources.find((status) => status.source === "haus");
  const assumptionDelta =
    match?.target.monthlyMtrRentAssumption != null && match.suggestedRent.suggestedMonthlyRentBase != null
      ? match.target.monthlyMtrRentAssumption - match.suggestedRent.suggestedMonthlyRentBase
      : null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Rental intelligence"
        title="Rental Analysis"
        subtitle="Monthly furnished-rental pricing sampled from public competitor inventory — accommodation subtotal only, taxes and fees always excluded. Select an acquisition target to rank the best comps and get a suggested MTR rent."
        actions={
          <button type="button" className={styles.refreshButton} onClick={refreshData} disabled={refreshing}>
            {refreshing ? "Collecting…" : "Refresh Haus data"}
          </button>
        }
      />

      {notice ? <div className={styles.noticeBanner}>{notice}</div> : null}
      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.controlsRow}>
        <div className={styles.segmented} role="group" aria-label="Source">
          <button
            type="button"
            className={sourceFilter === "all" ? styles.segmentedActive : undefined}
            onClick={() => setSourceFilter("all")}
          >
            All sources
          </button>
          {(["haus", "rove", "blueground"] as CompetitorSource[]).map((source) => {
            const status = sources.find((entry) => entry.source === source);
            const comingSoon = status ? !status.enabled : source !== "haus";
            return (
              <button
                key={source}
                type="button"
                disabled={comingSoon}
                className={sourceFilter === source ? styles.segmentedActive : undefined}
                title={comingSoon ? "Adapter coming soon" : `${status?.listingCount ?? 0} listings`}
                onClick={() => setSourceFilter(source)}
              >
                {SOURCE_LABELS[source]}
                {comingSoon ? <span className={styles.comingSoon}> soon</span> : null}
              </button>
            );
          })}
        </div>

        <select className={styles.control} value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Month">
          {months.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </select>

        <select className={styles.control} value={quoteType} onChange={(event) => setQuoteType(event.target.value)} aria-label="Quote type">
          {QUOTE_TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </select>

        <div className={styles.segmented} role="group" aria-label="Rate basis">
          <button
            type="button"
            className={rateBasis === "undiscounted" ? styles.segmentedActive : undefined}
            onClick={() => setRateBasis("undiscounted")}
            title="Undiscounted accommodation subtotal — the comparable metric"
          >
            Undiscounted
          </button>
          <button
            type="button"
            className={rateBasis === "effective" ? styles.segmentedActive : undefined}
            onClick={() => setRateBasis("effective")}
            title="Effective rate after visible discounts"
          >
            Effective
          </button>
        </div>

        <label className={styles.toggle}>
          <input type="checkbox" checked={hideLowConfidence} onChange={(event) => setHideLowConfidence(event.target.checked)} />
          Hide low confidence
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)} />
          Show excluded
        </label>
      </div>

      <div className={styles.controlsRow}>
        <div className={styles.targetWrap} ref={targetRef}>
          <input
            type="search"
            className={styles.targetSearch}
            placeholder={match?.target ? match.target.address : "Select acquisition target (address)…"}
            value={targetQuery}
            onFocus={() => setShowTargetOptions(true)}
            onChange={(event) => {
              setTargetQuery(event.target.value);
              setShowTargetOptions(true);
            }}
            aria-label="Acquisition target"
          />
          {showTargetOptions && targetOptions.length > 0 ? (
            <div className={styles.targetOptions}>
              {targetOptions.map((option) => (
                <button
                  key={option.propertyId}
                  type="button"
                  className={styles.targetOption}
                  onClick={() => {
                    setTargetId(option.propertyId);
                    setShowTargetOptions(false);
                    setTargetQuery("");
                  }}
                >
                  <span className={styles.targetOptionAddress}>
                    {option.address}
                    {option.saved ? <span className={styles.savedChip}>Saved</span> : null}
                  </span>
                  <span className={styles.targetOptionMeta}>
                    {option.neighborhood ?? "—"}
                    {option.hasCoordinates ? "" : " · no coordinates"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {targetId ? (
          <button type="button" className={styles.clearTarget} onClick={() => setTargetId(null)}>
            Clear target
          </button>
        ) : null}

        <select className={styles.control} value={beds} onChange={(event) => setBeds(event.target.value)} aria-label="Bedrooms">
          <option value="">Any beds</option>
          <option value="0">Studio</option>
          <option value="1">1 BR</option>
          <option value="2">2 BR</option>
          <option value="3">3+ BR</option>
        </select>
        <input
          type="search"
          className={styles.control}
          placeholder="Neighborhood…"
          value={neighborhood}
          onChange={(event) => setNeighborhood(event.target.value)}
          aria-label="Neighborhood filter"
        />
        {targetId ? (
          <select className={styles.control} value={radiusMiles} onChange={(event) => setRadiusMiles(event.target.value)} aria-label="Radius">
            <option value="0.5">0.5 mi radius</option>
            <option value="1">1 mi radius</option>
            <option value="1.5">1.5 mi radius</option>
            <option value="3">3 mi radius</option>
          </select>
        ) : null}
      </div>

      {summary ? (
        <div className={styles.summaryStrip}>
          <span><strong>{summary.compCount}</strong> priced comps</span>
          <span>Median <strong>{money(summary.medianMonthlyRate)}</strong>/mo</span>
          <span>p25–p75 <strong>{money(summary.p25MonthlyRate)} – {money(summary.p75MonthlyRate)}</strong></span>
          <span>Median ADR <strong>{money(summary.medianAdr)}</strong></span>
          <span>{summary.excludedCount} excluded · {summary.lowConfidenceCount} low-confidence</span>
          {hausStatus?.lastScrapedAt ? (
            <span className={styles.summaryMuted}>Haus updated {formatDateTimeShort(hausStatus.lastScrapedAt)}</span>
          ) : null}
        </div>
      ) : null}

      <div className={styles.workspace}>
        <div className={styles.leftColumn}>
          {match ? (
            <section className={styles.targetPanel}>
              <div className={styles.targetHeader}>
                <div>
                  <h3 className={styles.targetTitle}>{match.target.address}</h3>
                  <div className={styles.targetMeta}>
                    {[match.target.neighborhood, match.target.borough].filter(Boolean).join(" · ")}
                    {match.target.units != null ? ` · ${match.target.units} units` : ""}
                    {match.target.gsf != null ? ` · ${formatNumber(match.target.gsf)} SF` : ""}
                    {match.target.medianBeds != null ? ` · typ. ${match.target.medianBeds} BR` : ""}
                  </div>
                  <div className={styles.targetMeta}>
                    {match.target.ltrYieldPct != null ? `LTR yield ${match.target.ltrYieldPct.toFixed(2)}%` : ""}
                    {match.target.mtrYieldPct != null ? ` · MTR yield ${match.target.mtrYieldPct.toFixed(2)}%` : ""}
                    {match.target.monthlyMtrRentAssumption != null
                      ? ` · UW MTR rent ${money(match.target.monthlyMtrRentAssumption)}/mo`
                      : ""}
                  </div>
                </div>
                <div className={`${styles.suggestBox} ${styles[`confidence_${match.suggestedRent.confidence}`]}`}>
                  <span className={styles.suggestLabel}>
                    Suggested MTR rent · {months.find((entry) => entry.value === month)?.label ?? month}
                  </span>
                  <span className={styles.suggestValue}>
                    {money(match.suggestedRent.suggestedMonthlyRentBase)}
                    <small> base</small>
                  </span>
                  <span className={styles.suggestRange}>
                    {money(match.suggestedRent.suggestedMonthlyRentLow)} low · {money(match.suggestedRent.suggestedMonthlyRentHigh)} high
                    {match.suggestedRent.suggestedAdrBase != null ? ` · ADR ${money(match.suggestedRent.suggestedAdrBase)}` : ""}
                  </span>
                  <span className={styles.suggestExplain} title={match.suggestedRent.explanation}>
                    {match.suggestedRent.compCount} comps · {match.suggestedRent.confidence} confidence
                    {assumptionDelta != null
                      ? ` · UW assumption ${assumptionDelta >= 0 ? `${money(Math.abs(assumptionDelta))} above` : `${money(Math.abs(assumptionDelta))} below`} comps`
                      : ""}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          <section className={styles.tablePanel}>
            {loading ? <div className={styles.loadingBanner}>Loading comps…</div> : null}
            {!loading && rows.length === 0 ? (
              <EmptyState
                title="No competitor listings yet"
                description='Run "Refresh Haus data" to discover public Haus inventory and sample its monthly pricing. Rove and Blueground adapters are next.'
              />
            ) : null}
            {!loading && rows.length > 0 ? (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {match ? <th>Match</th> : null}
                      <th>Listing</th>
                      <th>Source</th>
                      <th>Beds</th>
                      <th>Baths</th>
                      <th>SF</th>
                      {match ? <th>Distance</th> : null}
                      <th>{rateBasis === "effective" ? "Effective /mo" : "Undiscounted /mo"}</th>
                      <th>ADR</th>
                      <th>Status</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(match
                      ? match.comps.map((comp) => ({
                          listing: comp.listing,
                          observation: comp.observation,
                          monthlyEquivalent: comp.monthlyEquivalent,
                          score: comp.score as MatchScore | null,
                        }))
                      : rows.map((row) => ({ ...row, score: null as MatchScore | null }))
                    ).map((row) => {
                      const statusLabel = row.observation
                        ? STATUS_LABELS[row.observation.normalizationStatus] ?? row.observation.normalizationStatus
                        : "No pricing";
                      return (
                        <tr
                          key={row.listing.id}
                          className={row.listing.excludedFromComps ? styles.rowExcluded : undefined}
                        >
                          {match ? (
                            <td className={styles.matchCell}>
                              {row.score ? (
                                <>
                                  <span className={styles.matchScore}>{Math.round(row.score.totalScore)}</span>
                                  <div className={styles.labelChips}>
                                    {row.score.labels.slice(0, 2).map((label) => (
                                      <span
                                        key={label}
                                        className={label === "Best match" ? styles.bestChip : styles.labelChip}
                                        title={row.score?.explanation}
                                      >
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                EMPTY_VALUE
                              )}
                            </td>
                          ) : null}
                          <td className={styles.listingCell}>
                            <a href={row.listing.url} target="_blank" rel="noopener noreferrer" className={styles.listingLink}>
                              {row.listing.title ?? row.listing.address ?? "Listing"}
                            </a>
                            <div className={styles.listingSub}>
                              {[row.listing.neighborhood ?? row.listing.borough, row.listing.minStayNights != null ? `min ${row.listing.minStayNights}n` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </td>
                          <td>{SOURCE_LABELS[row.listing.source]}</td>
                          <td>{row.listing.beds ?? EMPTY_VALUE}</td>
                          <td>{row.listing.baths ?? EMPTY_VALUE}</td>
                          <td>{row.listing.sqft != null ? formatNumber(row.listing.sqft) : EMPTY_VALUE}</td>
                          {match ? <td>{row.score?.distanceMiles != null ? `${row.score.distanceMiles.toFixed(2)} mi` : EMPTY_VALUE}</td> : null}
                          <td className={styles.rateCell} style={{ color: rateColor(row.monthlyEquivalent) }}>
                            {money(row.monthlyEquivalent)}
                          </td>
                          <td>
                            {money(
                              rateBasis === "effective"
                                ? row.observation?.effectiveAdr
                                : row.observation?.undiscountedAdr
                            )}
                          </td>
                          <td>
                            <span
                              className={styles.statusChip}
                              data-status={row.observation?.normalizationStatus ?? "pricing_unavailable"}
                              title={
                                row.listing.excludedFromComps
                                  ? row.listing.exclusionReason ?? undefined
                                  : row.observation?.discountAmount != null
                                    ? `Discount ${money(row.observation.discountAmount)}`
                                    : undefined
                              }
                            >
                              {row.listing.excludedFromComps ? "Excluded" : statusLabel}
                            </span>
                          </td>
                          <td>{row.observation?.confidence ?? EMPTY_VALUE}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className={styles.diagnosticsPanel}>
            <button type="button" className={styles.diagnosticsToggle} onClick={() => setShowDiagnostics((open) => !open)}>
              {showDiagnostics ? "Hide" : "Show"} collection diagnostics ({runs.length} runs)
            </button>
            {showDiagnostics ? (
              runs.length > 0 ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Discovered</th>
                        <th>Metadata ✓/✗</th>
                        <th>Pricing ✓/✗</th>
                        <th>Excluded</th>
                        <th>Errors</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id}>
                          <td>{formatDateTimeShort(run.startedAt)}</td>
                          <td>{SOURCE_LABELS[run.source]}</td>
                          <td>
                            <span className={styles.statusChip} data-run-status={run.status}>{run.status}</span>
                          </td>
                          <td>{run.discoveredCount}</td>
                          <td>{run.metadataSuccessCount}/{run.metadataFailureCount}</td>
                          <td>{run.pricingSuccessCount}/{run.pricingFailureCount}</td>
                          <td>{run.excludedCount}</td>
                          <td>{run.errorCount}</td>
                          <td className={styles.noteCell} title={run.note ?? undefined}>{run.note ?? EMPTY_VALUE}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.diagnosticsEmpty}>No collection runs yet.</p>
              )
            ) : null}
          </section>
        </div>

        <div className={styles.mapColumn}>
          <RentalMapCanvas pins={pins} target={mapTarget} />
          <div className={styles.legend}>
            <span className={styles.legendTitle}>Monthly rate</span>
            <span className={styles.legendItem}><i style={{ background: "#16a34a" }} /> &lt;$4k</span>
            <span className={styles.legendItem}><i style={{ background: "#0d9488" }} /> $4–6k</span>
            <span className={styles.legendItem}><i style={{ background: "#d97706" }} /> $6–8k</span>
            <span className={styles.legendItem}><i style={{ background: "#dc2626" }} /> $8k+</span>
            <span className={styles.legendDivider} />
            <span className={styles.legendItem}><i className={styles.legendCircle} /> Haus</span>
            <span className={styles.legendItem}><i className={styles.legendSquare} /> Rove</span>
            <span className={styles.legendItem}><i className={styles.legendDiamond} /> Blueground</span>
          </div>
        </div>
      </div>
    </div>
  );
}
