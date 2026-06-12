"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompReviewQueueItem, CompReviewQueueResponse } from "@re-sourcing/contracts";
import { Badge, Button, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { formatCurrencyExact, formatPercent, EMPTY_VALUE } from "@/lib/format";
import styles from "./compAnalysis.module.css";

/** Comparable from GET /api/comps/market: broker-package items + approved market-doc deals. */
interface MarketComp {
  itemId: string;
  packageId: string;
  packageType: string;
  packageCreatedAt: string | null;
  subjectPropertyId: string | null;
  subjectAddress: string | null;
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
  origin: "broker_package" | "market_doc";
  source: {
    kind: "broker_package" | "market_doc";
    label: string;
    title: string | null;
    publisher: string | null;
    period: string | null;
    documentId: string | null;
    packageId: string | null;
  };
  assetType: string | null;
  priceType: string | null;
  buyer: string | null;
  saleConditions: string[];
  cherryPickRisk: boolean;
  lat: number | null;
  lng: number | null;
}

function conditionLabel(value: string): string {
  return value.replace(/_/g, " ");
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
    originCounts?: { broker: number; marketDoc: number };
  };
}

type MetricFilter = "all" | "capRate" | "psfOnly";
type OriginFilter = "all" | "broker_package" | "market_doc";

function fmtPct(value: number | null | undefined, digits = 2): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(digits)}%` : EMPTY_VALUE;
}

function fmtPsf(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${Math.round(value).toLocaleString("en-US")}` : EMPTY_VALUE;
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
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  // Review queue: extracted comps awaiting approval before they join the table.
  const [queue, setQueue] = useState<CompReviewQueueResponse | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decisionBusy, setDecisionBusy] = useState(false);

  const loadComps = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    fetch(`${API_BASE}/api/comps/market`, { credentials: "include", signal })
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
  }, []);

  const loadQueue = useCallback((signal?: AbortSignal) => {
    fetch(`${API_BASE}/api/comps/review-queue`, { credentials: "include", signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as CompReviewQueueResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setQueue(payload);
        setQueueError(null);
        setSelected(new Set());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setQueueError(err instanceof Error ? err.message : "Failed to load the review queue.");
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadComps(controller.signal);
    loadQueue(controller.signal);
    return () => controller.abort();
  }, [loadComps, loadQueue]);

  async function applyDecisions(items: CompReviewQueueItem[], action: "approve" | "reject") {
    if (items.length === 0 || decisionBusy) return;
    setDecisionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/comps/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisions: items.map((item) => ({ id: item.id, source: item.source, action })),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
      loadQueue();
      loadComps();
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Failed to apply review decisions.");
    } finally {
      setDecisionBusy(false);
    }
  }

  const queueItems = queue?.items ?? [];
  const selectedItems = queueItems.filter((item) => selected.has(item.id));

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const typeOptions = useMemo(
    () => [...new Set((data?.comps ?? []).map((comp) => comp.packageType))].sort(),
    [data]
  );

  const rows = useMemo(() => {
    let all = data?.comps ?? [];
    if (metricFilter === "capRate") all = all.filter((comp) => comp.capRatePct != null);
    if (metricFilter === "psfOnly") all = all.filter((comp) => comp.psfOnly);
    if (originFilter !== "all") all = all.filter((comp) => comp.origin === originFilter);
    if (typeFilter) all = all.filter((comp) => comp.packageType === typeFilter);
    const query = search.trim().toLowerCase();
    if (query) {
      all = all.filter((comp) =>
        [comp.propertyName, comp.address, comp.neighborhood, comp.subjectAddress, comp.source.label, comp.source.period]
          .filter(Boolean)
          .some((value) => (value as string).toLowerCase().includes(query))
      );
    }
    // Cap-rate-bearing comps first (highest cap rate leading), PSF-only after.
    return [...all].sort((a, b) => {
      if (a.capRatePct != null && b.capRatePct != null) return b.capRatePct - a.capRatePct;
      if (a.capRatePct != null) return -1;
      if (b.capRatePct != null) return 1;
      return (b.pricePsf ?? -Infinity) - (a.pricePsf ?? -Infinity);
    });
  }, [data, metricFilter, originFilter, typeFilter, search]);

  const summary = data?.summary;
  const capRateShare =
    summary && summary.count > 0 ? Math.round((summary.withCapRate / summary.count) * 100) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Pipeline · Living comps"
        title="Comp Analysis"
        subtitle="Every approved comparable from broker comp packages AND deals extracted out of market documents (research reports, OMs, comp lists) — each row carries its source. New extractions wait in the review queue below until you approve them onto this table and the yield map layer."
        actions={
          <Link href="/pipeline/yield-map" className={styles.mapLink}>
            View on yield map →
          </Link>
        }
      />

      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      {loading ? <div className={styles.loadingBanner}>Loading comps…</div> : null}

      {/* ---- Review queue: approve extracted deals before they count ---- */}
      {queueError ? <div className={styles.errorBanner}>{queueError}</div> : null}
      {queueItems.length > 0 ? (
        <div className={styles.queuePanel}>
          <div className={styles.queueHeader}>
            <span className={styles.queueTitle}>
              Review queue — {queueItems.length} extracted comp{queueItems.length === 1 ? "" : "s"} awaiting approval
            </span>
            <span className={styles.queueCounts}>
              {queue?.counts.marketDoc ?? 0} from market docs · {queue?.counts.broker ?? 0} from broker packages
            </span>
            <span className={styles.queueBulk}>
              <Button
                size="sm"
                onClick={() => void applyDecisions(selectedItems.length > 0 ? selectedItems : queueItems, "approve")}
                disabled={decisionBusy}
              >
                {decisionBusy ? "Applying…" : selectedItems.length > 0 ? `Approve ${selectedItems.length}` : "Approve all"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void applyDecisions(selectedItems, "reject")}
                disabled={decisionBusy || selectedItems.length === 0}
              >
                Reject {selectedItems.length > 0 ? selectedItems.length : ""}
              </Button>
            </span>
          </div>
          <p className={styles.queueHint}>
            Check the extracted fields against the source document — approving adds the comp to this table, the medians,
            and the yield map comp layer; rejecting drops it from every surface.
          </p>
          <div className={styles.queueTableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.checkCell}>
                    <input
                      type="checkbox"
                      aria-label="Select all pending comps"
                      checked={selected.size === queueItems.length && queueItems.length > 0}
                      onChange={(event) =>
                        setSelected(event.target.checked ? new Set(queueItems.map((item) => item.id)) : new Set())
                      }
                    />
                  </th>
                  <th>Comp</th>
                  <th>Cap rate</th>
                  <th>$/PSF</th>
                  <th>Sale price</th>
                  <th>Units</th>
                  <th>Sold</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Confidence</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {queueItems.map((item) => (
                  <tr key={item.id}>
                    <td className={styles.checkCell}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.address ?? "comp"}`}
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                      />
                    </td>
                    <td className={styles.nameCell}>
                      <span className={styles.compName}>{item.propertyName ?? item.address?.split(",")[0] ?? "Unnamed comp"}</span>
                      <div className={styles.compSub}>
                        {[item.neighborhood ?? item.borough, item.priceType && item.priceType !== "closed" ? item.priceType : null]
                          .filter(Boolean)
                          .join(" · ")}
                        {item.cherryPickRisk ? " · ⚠ broker-picked set" : ""}
                      </div>
                      {item.buyer ? <div className={styles.compSub}>buyer: {item.buyer}</div> : null}
                      {item.saleConditions.length > 0 ? (
                        <div className={styles.flagRow}>
                          {item.saleConditions.map((condition) => (
                            <span key={condition} className={styles.flagChip} title="Printed sale condition — verify before approving.">
                              {conditionLabel(condition)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {item.notes ? <div className={styles.compSub}>{item.notes}</div> : null}
                    </td>
                    <td style={{ color: capRateColor(item.capRatePct) }}>
                      {item.capRatePct != null ? (
                        fmtPct(item.capRatePct)
                      ) : item.grm != null ? (
                        <span className={styles.compSub} title="No cap rate printed — gross rent multiplier as printed.">
                          {item.grm}x GRM
                        </span>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </td>
                    <td>{fmtPsf(item.pricePsf)}</td>
                    <td>{formatCurrencyExact(item.salePrice)}</td>
                    <td>{item.units ?? EMPTY_VALUE}</td>
                    <td className={styles.soldCell}>{item.saleDate ?? EMPTY_VALUE}</td>
                    <td>{item.assetType ? packageTypeLabel(item.assetType) : EMPTY_VALUE}</td>
                    <td className={styles.packageCell}>
                      {item.sourceLabel}
                      {item.sourceDetail ? <div className={styles.compSub}>{item.sourceDetail}</div> : null}
                    </td>
                    <td>
                      {item.confidence ? (
                        <Badge tone={item.confidence === "high" ? "success" : item.confidence === "medium" ? "neutral" : "warning"}>
                          {item.confidence}
                        </Badge>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </td>
                    <td>
                      <span className={styles.decisionCell}>
                        <Button size="sm" onClick={() => void applyDecisions([item], "approve")} disabled={decisionBusy}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void applyDecisions([item], "reject")}
                          disabled={decisionBusy}
                        >
                          Reject
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && data && summary ? (
        <>
          <div className={styles.kpiStrip}>
            <StatCard tone="neutral" label="Comps approved" value={summary.count} sub={`${summary.withCoordinates} mapped`} />
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
            <StatCard
              tone={queueItems.length > 0 ? "warning" : "success"}
              label="Awaiting review"
              value={queueItems.length}
              sub={queueItems.length > 0 ? "approve or reject above" : "queue is clear"}
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
            <div className={styles.segmented} role="group" aria-label="Comp origin">
              <button
                type="button"
                className={originFilter === "all" ? styles.segmentedActive : undefined}
                onClick={() => setOriginFilter("all")}
              >
                All sources
              </button>
              <button
                type="button"
                className={originFilter === "broker_package" ? styles.segmentedActive : undefined}
                onClick={() => setOriginFilter("broker_package")}
                title={`${summary.originCounts?.broker ?? 0} comps from broker packages`}
              >
                Broker packages
              </button>
              <button
                type="button"
                className={originFilter === "market_doc" ? styles.segmentedActive : undefined}
                onClick={() => setOriginFilter("market_doc")}
                title={`${summary.originCounts?.marketDoc ?? 0} comps from market documents`}
              >
                Market docs
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
              placeholder="Search comp, neighborhood, source…"
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
                    <th>Comp</th>
                    <th>Cap rate</th>
                    <th>$/PSF</th>
                    <th>Sale price</th>
                    <th>$/Unit</th>
                    <th>Units</th>
                    <th>NOI</th>
                    <th>Year</th>
                    <th>Sold</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((comp) => (
                    <tr key={comp.itemId}>
                      <td className={styles.nameCell}>
                        <span className={styles.compName}>{compName(comp)}</span>
                        <div className={styles.compSub}>
                          {[
                            comp.address && comp.propertyName ? comp.address.split(",")[0] : null,
                            comp.neighborhood ?? comp.borough,
                            comp.assetType ? packageTypeLabel(comp.assetType) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {comp.buyer ? <div className={styles.compSub}>buyer: {comp.buyer}</div> : null}
                        {comp.cherryPickRisk || comp.saleConditions.length > 0 || (comp.priceType && comp.priceType !== "closed") ? (
                          <div className={styles.flagRow}>
                            {comp.cherryPickRisk ? (
                              <span className={styles.flagChip} title="Comp table inside an OM/BOV — broker-selected set.">
                                ⚠ broker-picked
                              </span>
                            ) : null}
                            {comp.saleConditions.map((condition) => (
                              <span key={condition} className={styles.flagChip} title="Printed sale condition.">
                                {conditionLabel(condition)}
                              </span>
                            ))}
                            {comp.priceType && comp.priceType !== "closed" ? (
                              <span className={styles.flagChip} title="Not a closed sale.">
                                {comp.priceType.replace(/_/g, " ")}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td className={styles.capCell} style={{ color: capRateColor(comp.capRatePct) }}>
                        {comp.capRatePct != null ? (
                          fmtPct(comp.capRatePct)
                        ) : (
                          <span
                            className={styles.psfOnlyChip}
                            title="No cap rate in the source — $/PSF only."
                          >
                            $/PSF only
                          </span>
                        )}
                      </td>
                      <td>{fmtPsf(comp.pricePsf)}</td>
                      <td>{formatCurrencyExact(comp.salePrice)}</td>
                      <td>{formatCurrencyExact(comp.pricePerUnit)}</td>
                      <td>{comp.units ?? EMPTY_VALUE}</td>
                      <td>{formatCurrencyExact(comp.noi)}</td>
                      <td>{comp.yearCompleted ?? EMPTY_VALUE}</td>
                      <td className={styles.soldCell}>{comp.saleDate ?? EMPTY_VALUE}</td>
                      <td className={styles.packageCell}>
                        {comp.origin === "market_doc" ? (
                          <>
                            <span className={styles.sourceKind}>{comp.source.label}</span>
                            <div className={styles.compSub}>
                              {[comp.source.period, packageTypeLabel(comp.packageType)].filter(Boolean).join(" · ")}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className={styles.sourceKind}>{packageTypeLabel(comp.packageType)} package</span>
                            <div className={styles.compSub}>
                              {comp.subjectPropertyId && comp.subjectAddress ? (
                                <Link
                                  href={`/pipeline?propertyId=${encodeURIComponent(comp.subjectPropertyId)}`}
                                  className={styles.subjectLink}
                                  title={comp.subjectAddress}
                                >
                                  {comp.subjectAddress.split(",")[0]}
                                </Link>
                              ) : null}
                              {comp.packageCreatedAt
                                ? ` · ${new Date(comp.packageCreatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                                : null}
                            </div>
                          </>
                        )}
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
                    ? "Upload a broker comp package (Import → Comp package) or a market report (Market Docs) — extracted deals land in the review queue, and approved ones appear here."
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
