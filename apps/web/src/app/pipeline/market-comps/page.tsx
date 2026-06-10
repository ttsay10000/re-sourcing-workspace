"use client";

/**
 * Market Comps — rent & expense comping for one subject deal against three
 * always-on comp sets: Same Submarket, Same Borough, All NYC. Every metric
 * shows the comp-set median, the subject's variance vs that median, and the
 * dispersion (p25–p75, n) behind it, plus rent-by-unit-type, expense
 * categories, closed-sale market evidence, and the underlying peer rows.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { EMPTY_VALUE, formatCurrencyExact, formatNumber } from "@/lib/format";
import styles from "./marketComps.module.css";

interface SubjectOption {
  propertyId: string;
  address: string;
  neighborhood: string | null;
  hasOmData: boolean;
}

interface MetricStat {
  count: number;
  median: number | null;
  mean: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  varianceAbs: number | null;
  variancePct: number | null;
}

type CompSetKey = "submarket" | "borough" | "nyc";
type MetricFormat = "currency" | "currency2" | "percent" | "number";

interface AnalysisResponse {
  subject: {
    propertyId: string;
    address: string;
    neighborhood: string | null;
    borough: string | null;
    units: number | null;
    gsf: number | null;
    yearBuilt: number | null;
    propertyType: string | null;
    askingPrice: number | null;
    hasOmData: boolean;
  };
  compSets: Array<{ key: CompSetKey; label: string; propertyCount: number; unitCount: number }>;
  metrics: Array<{
    key: string;
    label: string;
    format: MetricFormat;
    subject: number | null;
    sets: Record<CompSetKey, MetricStat>;
  }>;
  rentByUnitType: Array<{
    unitType: string;
    label: string;
    subjectMonthlyRent: number | null;
    subjectRentPsf: number | null;
    subjectUnitCount: number;
    sets: Record<CompSetKey, MetricStat & { rentPsfMedian: number | null }>;
  }>;
  expenseCategories: Array<{
    category: string;
    label: string;
    subjectPerUnit: number | null;
    sets: Record<CompSetKey, MetricStat>;
  }>;
  marketEvidence: Array<{
    set: CompSetKey;
    compCount: number;
    closedCount: number;
    pricePsf: MetricStat;
    closedPricePsf: MetricStat;
    capRatePct: MetricStat;
    closedCapRatePct: MetricStat;
  }>;
  peerRows: Array<{
    propertyId: string;
    address: string;
    neighborhood: string | null;
    borough: string | null;
    units: number | null;
    yearBuilt: number | null;
    occupancyPct: number | null;
    revenuePerUnit: number | null;
    expensePerUnit: number | null;
    noiPerUnit: number | null;
    capRatePct: number | null;
    pricePsf: number | null;
    inSubmarket: boolean;
  }>;
}

const SET_KEYS: CompSetKey[] = ["submarket", "borough", "nyc"];

/** Metrics where a subject above the comp-set median reads as favorable. */
const HIGHER_IS_BETTER: Record<string, boolean> = {
  occupancyPct: true,
  revenuePerUnit: true,
  revenuePsf: true,
  expensePerUnit: false,
  expensePsf: false,
  expenseRatioPct: false,
  noiPerUnit: true,
  noiPsf: true,
  noiMarginPct: true,
  avgMonthlyRentPerUnit: true,
  capRatePct: true,
  pricePerUnit: false,
  pricePsf: false,
};

const VINTAGE_OPTIONS = [
  { label: "Any vintage", min: "", max: "" },
  { label: "2010 – Current", min: "2010", max: "" },
  { label: "2000 – 2009", min: "2000", max: "2009" },
  { label: "1990 – 1999", min: "1990", max: "1999" },
  { label: "1970 – 1989", min: "1970", max: "1989" },
  { label: "Pre-1970", min: "", max: "1969" },
];

const UNIT_OPTIONS = [
  { label: "Any unit count", min: "", max: "" },
  { label: "Under 5 units", min: "", max: "4" },
  { label: "5 – 10 units", min: "5", max: "10" },
  { label: "10 – 20 units", min: "10", max: "20" },
  { label: "20+ units", min: "20", max: "" },
];

function fmtMetric(value: number | null | undefined, format: MetricFormat): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "currency":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "currency2":
      return `$${value.toFixed(2)}`;
    default:
      return formatNumber(value);
  }
}

function VarianceBadge({
  stat,
  metricKey,
}: {
  stat: MetricStat;
  metricKey: string;
}) {
  if (stat.variancePct == null) return null;
  const higherIsBetter = HIGHER_IS_BETTER[metricKey] ?? true;
  const above = stat.variancePct >= 0;
  const favorable = above === higherIsBetter;
  const magnitude = Math.abs(stat.variancePct);
  const text = `${above ? "+" : "−"}${magnitude >= 100 ? Math.round(magnitude) : magnitude.toFixed(1)}%`;
  return (
    <span
      className={`${styles.varianceBadge} ${favorable ? styles.varianceGood : styles.varianceBad}`}
      title={`Subject vs set median: ${text} (${above ? "above" : "below"} median)`}
    >
      {text}
    </span>
  );
}

function StatCellContent({
  stat,
  format,
  metricKey,
}: {
  stat: MetricStat;
  format: MetricFormat;
  metricKey: string;
}) {
  if (stat.count === 0) return <span className={styles.cellEmpty}>{EMPTY_VALUE}</span>;
  return (
    <div className={styles.statCell}>
      <div className={styles.statTop}>
        <span className={styles.statMedian}>{fmtMetric(stat.median, format)}</span>
        <VarianceBadge stat={stat} metricKey={metricKey} />
      </div>
      <div className={styles.statRange}>
        {fmtMetric(stat.p25, format)} – {fmtMetric(stat.p75, format)} · n={stat.count}
      </div>
    </div>
  );
}

/** Min→max range bar with p25–p75 band, median tick, and subject marker. */
function DistributionBar({
  stat,
  subject,
  format,
}: {
  stat: MetricStat;
  subject: number | null;
  format: MetricFormat;
}) {
  if (stat.count === 0 || stat.min == null || stat.max == null) {
    return <span className={styles.cellEmpty}>{EMPTY_VALUE}</span>;
  }
  const span = Math.max(stat.max - stat.min, 1e-9);
  const pct = (value: number) => Math.min(100, Math.max(0, ((value - stat.min!) / span) * 100));
  return (
    <div className={styles.distRow}>
      <span className={styles.distEdge}>{fmtMetric(stat.min, format)}</span>
      <div className={styles.distTrack}>
        {stat.p25 != null && stat.p75 != null ? (
          <div
            className={styles.distBand}
            style={{ left: `${pct(stat.p25)}%`, width: `${Math.max(pct(stat.p75) - pct(stat.p25), 2)}%` }}
          />
        ) : null}
        {stat.median != null ? <div className={styles.distMedian} style={{ left: `${pct(stat.median)}%` }} /> : null}
        {subject != null ? (
          <div
            className={styles.distSubject}
            style={{ left: `${pct(subject)}%` }}
            title={`Subject: ${fmtMetric(subject, format)}`}
          />
        ) : null}
      </div>
      <span className={styles.distEdge}>{fmtMetric(stat.max, format)}</span>
    </div>
  );
}

function MarketCompsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("propertyId") ?? "";

  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [showOptions, setShowOptions] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vintage, setVintage] = useState(0);
  const [unitsBand, setUnitsBand] = useState(0);
  const [showPeers, setShowPeers] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);

  // Subject typeahead.
  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`${API_BASE}/api/market-comps/subjects?q=${encodeURIComponent(subjectQuery)}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then(async (res) => {
          const payload = (await res.json().catch(() => ({}))) as { subjects?: SubjectOption[]; error?: string };
          if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
          setSubjectOptions(payload.subjects ?? []);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [subjectQuery]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setShowOptions(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const selectSubject = useCallback(
    (id: string) => {
      setShowOptions(false);
      router.replace(`/pipeline/market-comps?propertyId=${encodeURIComponent(id)}`, { scroll: false });
    },
    [router]
  );

  // Analysis load.
  useEffect(() => {
    if (!propertyId) {
      setAnalysis(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ propertyId });
    const vintageOption = VINTAGE_OPTIONS[vintage];
    const unitOption = UNIT_OPTIONS[unitsBand];
    if (vintageOption.min) params.set("vintageMin", vintageOption.min);
    if (vintageOption.max) params.set("vintageMax", vintageOption.max);
    if (unitOption.min) params.set("unitsMin", unitOption.min);
    if (unitOption.max) params.set("unitsMax", unitOption.max);
    fetch(`${API_BASE}/api/market-comps/analysis?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as AnalysisResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setAnalysis(payload);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load market comp analysis.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [propertyId, vintage, unitsBand]);

  const subject = analysis?.subject;
  const revenueMetric = useMemo(
    () => analysis?.metrics.find((metric) => metric.key === "revenuePerUnit") ?? null,
    [analysis]
  );

  const subjectFacts = subject
    ? [
        subject.units != null ? `${formatNumber(subject.units)} units` : null,
        subject.gsf != null ? `${formatNumber(subject.gsf)} SF` : null,
        subject.yearBuilt != null ? `Built ${subject.yearBuilt}` : null,
        subject.propertyType,
        subject.askingPrice != null ? `Ask ${formatCurrencyExact(subject.askingPrice)}` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Pipeline · Rent & expense comping"
        title="Market Comps"
        subtitle="Compare a subject deal's operating profile against the submarket, the borough, and every deal in NYC — with the variance and spread behind each number, not just a median."
      />

      <div className={styles.subjectBar} ref={searchRef}>
        <div className={styles.subjectSearchWrap}>
          <input
            type="search"
            className={styles.subjectSearch}
            placeholder={subject ? subject.address : "Search a subject property by address…"}
            value={subjectQuery}
            onFocus={() => setShowOptions(true)}
            onChange={(event) => {
              setSubjectQuery(event.target.value);
              setShowOptions(true);
            }}
            aria-label="Subject property"
          />
          {showOptions && subjectOptions.length > 0 ? (
            <div className={styles.subjectOptions}>
              {subjectOptions.map((option) => (
                <button
                  key={option.propertyId}
                  type="button"
                  className={styles.subjectOption}
                  onClick={() => selectSubject(option.propertyId)}
                >
                  <span className={styles.subjectOptionAddress}>{option.address}</span>
                  <span className={styles.subjectOptionMeta}>
                    {option.neighborhood ?? "—"}
                    {option.hasOmData ? " · OM data" : " · no OM yet"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <select
          className={styles.filterSelect}
          value={vintage}
          onChange={(event) => setVintage(Number(event.target.value))}
          aria-label="Vintage filter"
        >
          {VINTAGE_OPTIONS.map((option, index) => (
            <option key={option.label} value={index}>{option.label}</option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={unitsBand}
          onChange={(event) => setUnitsBand(Number(event.target.value))}
          aria-label="Unit count filter"
        >
          {UNIT_OPTIONS.map((option, index) => (
            <option key={option.label} value={index}>{option.label}</option>
          ))}
        </select>
      </div>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      {loading ? <div className={styles.loadingBanner}>Building comp analysis…</div> : null}

      {!propertyId && !loading ? (
        <EmptyState
          title="Pick a subject property"
          description="Search any pipeline property above. Deals with an analyzed OM compare across occupancy, revenue, expenses, NOI, and rents; others compare on pricing and yield."
        />
      ) : null}

      {analysis && subject && !loading ? (
        <>
          <section className={styles.subjectCard}>
            <div>
              <h2 className={styles.subjectAddress}>{subject.address}</h2>
              <div className={styles.subjectMeta}>
                {[subject.neighborhood, subject.borough].filter(Boolean).join(" · ") || "Location pending"}
              </div>
              <div className={styles.subjectFacts}>{subjectFacts.join("  ·  ")}</div>
              {!subject.hasOmData ? (
                <div className={styles.subjectWarning}>
                  No analyzed OM on this deal yet — operating rows show pricing/yield only. Upload an OM from the
                  pipeline to unlock revenue, expense, and rent comping.
                </div>
              ) : null}
            </div>
            <div className={styles.setChips}>
              {analysis.compSets.map((set) => (
                <div key={set.key} className={styles.setChip}>
                  <span className={styles.setChipLabel}>{set.label}</span>
                  <span className={styles.setChipCount}>
                    {set.propertyCount} {set.propertyCount === 1 ? "property" : "properties"}
                    {set.unitCount > 0 ? ` · ${formatNumber(set.unitCount)} units` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>Operating comparison</h3>
            <p className={styles.panelSub}>
              Set cells show the comp-set median, the subject's variance vs that median, and the p25–p75 spread with
              the observation count.
            </p>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Subject</th>
                    <th>Same Submarket</th>
                    <th>Borough</th>
                    <th>All NYC</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.metrics.map((metric) => (
                    <tr key={metric.key}>
                      <td className={styles.metricLabel}>{metric.label}</td>
                      <td className={styles.subjectValue}>{fmtMetric(metric.subject, metric.format)}</td>
                      {SET_KEYS.map((key) => (
                        <td key={key}>
                          <StatCellContent stat={metric.sets[key]} format={metric.format} metricKey={metric.key} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {revenueMetric ? (
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>Comp set distribution — Revenue / Unit</h3>
              <p className={styles.panelSub}>
                Range with the p25–p75 band; the dark tick is the set median, the teal marker is the subject.
              </p>
              <div className={styles.distGrid}>
                {analysis.compSets.map((set) => (
                  <div key={set.key} className={styles.distItem}>
                    <span className={styles.distLabel}>{set.label}</span>
                    <DistributionBar
                      stat={revenueMetric.sets[set.key]}
                      subject={revenueMetric.subject}
                      format="currency"
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {analysis.rentByUnitType.length > 0 ? (
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>Rent per unit (by unit type)</h3>
              <p className={styles.panelSub}>Median in-place monthly rents from extracted rent rolls.</p>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Unit type</th>
                      <th>Subject</th>
                      <th>Same Submarket</th>
                      <th>Borough</th>
                      <th>All NYC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.rentByUnitType.map((row) => (
                      <tr key={row.unitType}>
                        <td className={styles.metricLabel}>
                          {row.label}
                          {row.subjectUnitCount > 0 ? (
                            <span className={styles.metricSub}> · {row.subjectUnitCount} subject units</span>
                          ) : null}
                        </td>
                        <td className={styles.subjectValue}>
                          {fmtMetric(row.subjectMonthlyRent, "currency")}
                          {row.subjectRentPsf != null ? (
                            <span className={styles.metricSub}> · ${row.subjectRentPsf.toFixed(0)}/SF/yr</span>
                          ) : null}
                        </td>
                        {SET_KEYS.map((key) => (
                          <td key={key}>
                            <StatCellContent stat={row.sets[key]} format="currency" metricKey="avgMonthlyRentPerUnit" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {analysis.expenseCategories.length > 0 ? (
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>Expenses per unit (top categories)</h3>
              <p className={styles.panelSub}>Annual $ per unit from extracted expense tables.</p>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Subject</th>
                      <th>Same Submarket</th>
                      <th>Borough</th>
                      <th>All NYC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.expenseCategories.map((row) => (
                      <tr key={row.category}>
                        <td className={styles.metricLabel}>{row.label}</td>
                        <td className={styles.subjectValue}>{fmtMetric(row.subjectPerUnit, "currency")}</td>
                        {SET_KEYS.map((key) => (
                          <td key={key}>
                            <StatCellContent stat={row.sets[key]} format="currency" metricKey="expensePerUnit" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>Market evidence — research & broker comps</h3>
            <p className={styles.panelSub}>
              $/SF and cap rates from the ingested market-comp layer (closed sales called out separately from
              asking/in-contract records).
            </p>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Comp set</th>
                    <th>Comps</th>
                    <th>$/SF (all)</th>
                    <th>$/SF (closed)</th>
                    <th>Cap rate (all)</th>
                    <th>Cap rate (closed)</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.marketEvidence.map((row) => {
                    const setLabel = analysis.compSets.find((set) => set.key === row.set)?.label ?? row.set;
                    return (
                      <tr key={row.set}>
                        <td className={styles.metricLabel}>{setLabel}</td>
                        <td>
                          {row.compCount}
                          <span className={styles.metricSub}> · {row.closedCount} closed</span>
                        </td>
                        <td><StatCellContent stat={row.pricePsf} format="currency" metricKey="pricePsf" /></td>
                        <td><StatCellContent stat={row.closedPricePsf} format="currency" metricKey="pricePsf" /></td>
                        <td><StatCellContent stat={row.capRatePct} format="percent" metricKey="capRatePct" /></td>
                        <td><StatCellContent stat={row.closedCapRatePct} format="percent" metricKey="capRatePct" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <button type="button" className={styles.peerToggle} onClick={() => setShowPeers((open) => !open)}>
              {showPeers ? "Hide" : "Show"} comp details ({analysis.peerRows.length} peer deals)
            </button>
            {showPeers ? (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Deal</th>
                      <th>Set</th>
                      <th>Units</th>
                      <th>Built</th>
                      <th>Occ.</th>
                      <th>Rev/Unit</th>
                      <th>Exp/Unit</th>
                      <th>NOI/Unit</th>
                      <th>Cap rate</th>
                      <th>$/SF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.peerRows.map((row) => (
                      <tr key={row.propertyId}>
                        <td className={styles.metricLabel}>
                          {row.address.split(",")[0]}
                          <span className={styles.metricSub}>
                            {" "}
                            · {[row.neighborhood, row.borough].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </td>
                        <td>
                          {row.inSubmarket ? (
                            <span className={styles.submarketChip}>Submarket</span>
                          ) : (
                            <span className={styles.metricSub}>{row.borough ?? "NYC"}</span>
                          )}
                        </td>
                        <td>{row.units ?? EMPTY_VALUE}</td>
                        <td>{row.yearBuilt ?? EMPTY_VALUE}</td>
                        <td>{fmtMetric(row.occupancyPct, "percent")}</td>
                        <td>{fmtMetric(row.revenuePerUnit, "currency")}</td>
                        <td>{fmtMetric(row.expensePerUnit, "currency")}</td>
                        <td>{fmtMetric(row.noiPerUnit, "currency")}</td>
                        <td>{fmtMetric(row.capRatePct, "percent")}</td>
                        <td>{fmtMetric(row.pricePsf, "currency")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

export default function MarketCompsPage() {
  return (
    <Suspense fallback={<div />}>
      <MarketCompsPageInner />
    </Suspense>
  );
}
