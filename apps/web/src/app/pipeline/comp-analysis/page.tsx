"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { formatCurrencyExact, formatPercent, EMPTY_VALUE } from "@/lib/format";
import styles from "./compAnalysis.module.css";

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

type MetricFilter = "all" | "capRate" | "psfOnly";

type CompSortField =
  | "name"
  | "capRate"
  | "psf"
  | "salePrice"
  | "perUnit"
  | "units"
  | "noi"
  | "year"
  | "sold"
  | "subject"
  | "package";
type SortDirection = "asc" | "desc";

/** Text columns open A→Z; every numeric/date column opens high/new-to-low. */
const TEXT_SORT_FIELDS: ReadonlySet<CompSortField> = new Set(["name", "subject", "package"]);

const COMP_SORT_VALUES: Record<CompSortField, (comp: MarketComp) => string | number | null> = {
  name: (comp) => compName(comp).toLowerCase(),
  capRate: (comp) => comp.capRatePct,
  psf: (comp) => comp.pricePsf,
  salePrice: (comp) => comp.salePrice,
  perUnit: (comp) => comp.pricePerUnit,
  units: (comp) => comp.units,
  noi: (comp) => comp.noi,
  year: (comp) => comp.yearCompleted,
  sold: (comp) => comp.saleDate,
  subject: (comp) => comp.subjectAddress.toLowerCase(),
  package: (comp) => comp.packageType,
};

function SortHeader({
  label,
  field,
  activeField,
  direction,
  onSort,
}: {
  label: string;
  field: CompSortField;
  activeField: CompSortField;
  direction: SortDirection;
  onSort: (field: CompSortField) => void;
}) {
  const active = activeField === field;
  return (
    <button type="button" className={styles.sortHeader} onClick={() => onSort(field)} title={`Sort by ${label}`}>
      <span>{label}</span>
      <span className={styles.sortIndicator} aria-hidden="true">
        {active ? (direction === "asc" ? "▲" : "▼") : ""}
      </span>
    </button>
  );
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(digits)}%` : EMPTY_VALUE;
}

function packageTypeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compName(comp: MarketComp): string {
  return comp.propertyName ?? comp.address?.split(",")[0] ?? "Unnamed comp";
}

function capRateColor(value: number | null): string | undefined {
  if (value == null) return undefined;
  if (value >= 6.5) return "#0f766e";
  if (value >= 5.5) return "#16a34a";
  if (value >= 4.5) return "#d97706";
  return "#94a3b8";
}

export default function CompAnalysisPage() {
  const [data, setData] = useState<MarketCompsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricFilter, setMetricFilter] = useState<MetricFilter>("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<CompSortField>("capRate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const requestSort = (field: CompSortField) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return currentField;
      }
      setSortDirection(TEXT_SORT_FIELDS.has(field) ? "asc" : "desc");
      return field;
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${API_BASE}/api/comps/market`, { credentials: "include", signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as MarketCompsResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setData(payload);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load comp analysis.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const typeOptions = useMemo(
    () => [...new Set((data?.comps ?? []).map((comp) => comp.packageType))].sort(),
    [data]
  );

  const rows = useMemo(() => {
    let all = data?.comps ?? [];
    if (metricFilter === "capRate") all = all.filter((comp) => comp.capRatePct != null);
    if (metricFilter === "psfOnly") all = all.filter((comp) => comp.psfOnly);
    if (typeFilter) all = all.filter((comp) => comp.packageType === typeFilter);
    const query = search.trim().toLowerCase();
    if (query) {
      all = all.filter((comp) =>
        [comp.propertyName, comp.address, comp.neighborhood, comp.subjectAddress]
          .filter(Boolean)
          .some((value) => (value as string).toLowerCase().includes(query))
      );
    }
    // Sort by the active header; comps missing the value always sink to the
    // bottom (default: cap rate high→low, so PSF-only comps trail).
    const valueOf = COMP_SORT_VALUES[sortField];
    const factor = sortDirection === "asc" ? 1 : -1;
    return [...all].sort((a, b) => {
      const aValue = valueOf(a);
      const bValue = valueOf(b);
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === "string" || typeof bValue === "string") {
        return String(aValue).localeCompare(String(bValue)) * factor;
      }
      return (aValue - bValue) * factor;
    });
  }, [data, metricFilter, typeFilter, search, sortField, sortDirection]);

  const summary = data?.summary;
  const capRateShare =
    summary && summary.count > 0 ? Math.round((summary.withCapRate / summary.count) * 100) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Pipeline · Living comps"
        title="Comp Analysis"
        subtitle="Every comparable pulled out of uploaded broker comp packages, with the financials extracted — cap rates first. Upload packages from Import → Comp package, or per-property from the pipeline's Market/Comps tab."
        actions={
          <Link href="/pipeline/yield-map" className={styles.mapLink}>
            View on yield map →
          </Link>
        }
      />

      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      {loading ? <div className={styles.loadingBanner}>Loading comps…</div> : null}

      {!loading && data && summary ? (
        <>
          <div className={styles.kpiStrip}>
            <StatCard tone="neutral" label="Comps extracted" value={summary.count} sub={`${summary.withCoordinates} mapped`} />
            <StatCard tone="brand" label="Median cap rate" value={formatPercent(summary.medianCapRatePct, 2)} sub={`${summary.withCapRate} comps with cap rate`} />
            <StatCard
              tone="neutral"
              label="Median $/PSF"
              value={summary.medianPricePsf != null ? `$${Math.round(summary.medianPricePsf).toLocaleString("en-US")}` : EMPTY_VALUE}
              sub="across all comps"
            />
            <StatCard
              tone={summary.psfOnly > 0 ? "warning" : "success"}
              label="Cap-rate coverage"
              value={capRateShare != null ? `${capRateShare}%` : EMPTY_VALUE}
              sub={`${summary.psfOnly} $/PSF-only comp${summary.psfOnly === 1 ? "" : "s"}`}
              title="Share of comps with an extracted cap rate. $/PSF-only comps can't anchor yield underwriting — request investment-sale comps from the broker."
            />
          </div>

          {summary.psfOnly > 0 ? (
            <div className={styles.psfCallout}>
              <strong>{summary.psfOnly} comp{summary.psfOnly === 1 ? " is" : "s are"} $/PSF-only.</strong>{" "}
              These packages had no cap rate / NOI to extract — useful for pricing, but they can't anchor
              yield comparisons. Ask the broker for investment-sale comps with cap rates.
            </div>
          ) : null}

          <div className={styles.filterRow}>
            <div className={styles.segmented} role="group" aria-label="Metric availability">
              <button
                type="button"
                className={metricFilter === "all" ? styles.segmentedActive : undefined}
                onClick={() => setMetricFilter("all")}
              >
                All comps
              </button>
              <button
                type="button"
                className={metricFilter === "capRate" ? styles.segmentedActive : undefined}
                onClick={() => setMetricFilter("capRate")}
              >
                Has cap rate
              </button>
              <button
                type="button"
                className={metricFilter === "psfOnly" ? styles.segmentedActive : undefined}
                onClick={() => setMetricFilter("psfOnly")}
              >
                $/PSF only
              </button>
            </div>
            <select
              className={styles.typeSelect}
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              aria-label="Package type"
            >
              <option value="">All package types</option>
              {typeOptions.map((value) => (
                <option key={value} value={value}>{packageTypeLabel(value)}</option>
              ))}
            </select>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search comp, neighborhood, or subject…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search comps"
            />
            <span className={styles.resultCount}>
              {rows.length} of {summary.count}
            </span>
          </div>

          <div className={styles.tablePanel}>
            {rows.length > 0 ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th><SortHeader label="Comp" field="name" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="Cap rate" field="capRate" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="$/PSF" field="psf" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="Sale price" field="salePrice" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="$/Unit" field="perUnit" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="Units" field="units" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="NOI" field="noi" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="Year" field="year" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="Sold" field="sold" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="Subject deal" field="subject" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                    <th><SortHeader label="Package" field="package" activeField={sortField} direction={sortDirection} onSort={requestSort} /></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((comp) => (
                    <tr key={comp.itemId}>
                      <td className={styles.nameCell}>
                        <span className={styles.compName}>{compName(comp)}</span>
                        <div className={styles.compSub}>
                          {[comp.address && comp.propertyName ? comp.address.split(",")[0] : null, comp.neighborhood ?? comp.borough]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className={styles.capCell} style={{ color: capRateColor(comp.capRatePct) }}>
                        {comp.capRatePct != null ? (
                          fmtPct(comp.capRatePct)
                        ) : (
                          <span
                            className={styles.psfOnlyChip}
                            title="No cap rate in the package — $/PSF only."
                          >
                            $/PSF only
                          </span>
                        )}
                      </td>
                      <td>{comp.pricePsf != null ? `$${Math.round(comp.pricePsf).toLocaleString("en-US")}` : EMPTY_VALUE}</td>
                      <td>{formatCurrencyExact(comp.salePrice)}</td>
                      <td>{formatCurrencyExact(comp.pricePerUnit)}</td>
                      <td>{comp.units ?? EMPTY_VALUE}</td>
                      <td>{formatCurrencyExact(comp.noi)}</td>
                      <td>{comp.yearCompleted ?? EMPTY_VALUE}</td>
                      <td className={styles.soldCell}>{comp.saleDate ?? EMPTY_VALUE}</td>
                      <td>
                        <Link
                          href={`/pipeline?propertyId=${encodeURIComponent(comp.subjectPropertyId)}`}
                          className={styles.subjectLink}
                          title={comp.subjectAddress}
                        >
                          {comp.subjectAddress.split(",")[0]}
                        </Link>
                      </td>
                      <td className={styles.packageCell}>
                        {packageTypeLabel(comp.packageType)}
                        {comp.packageCreatedAt ? (
                          <div className={styles.compSub}>
                            {new Date(comp.packageCreatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No comps match"
                description={
                  summary.count === 0
                    ? "Upload a broker comp package from Import → Comp package (or a property's Market/Comps tab) and extracted comparables appear here."
                    : "Adjust the filters or search to see more comps."
                }
              />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
