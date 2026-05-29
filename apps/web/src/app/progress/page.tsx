"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./progress.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Summary = {
  savedCount?: number;
  underwritingCount?: number;
  outreachCount?: number;
  awaitingBrokerCount?: number;
  omReceivedCount?: number;
  rejectedCount?: number;
  updatedAt?: string | null;
};

type ProgressRow = {
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  source?: string | null;
  price?: number | null;
  units?: number | null;
  dealScore?: number | null;
  status?: string | null;
  savedDealStatus?: string | null;
  tags?: string[];
  omStatus?: string | null;
  openActionItemCount?: number | null;
  updatedAt?: string | null;
};

type ProgressSection = {
  id: "saved" | "underwriting" | "outreach" | "awaiting_broker" | "om_received" | "rejected" | string;
  label?: string;
  count?: number;
  rows?: ProgressRow[];
};

type DealProgressResponse = {
  summary?: Summary;
  sections?: ProgressSection[];
  rejectionReasons?: Array<{ reasonCode?: string; count?: number }>;
  error?: string;
  details?: string;
};

const SECTION_ORDER: ProgressSection[] = [
  { id: "saved", label: "Saved Deals", count: 0, rows: [] },
  { id: "underwriting", label: "Underwriting", count: 0, rows: [] },
  { id: "outreach", label: "Outreach", count: 0, rows: [] },
  { id: "awaiting_broker", label: "Awaiting Broker", count: 0, rows: [] },
  { id: "om_received", label: "OM Received", count: 0, rows: [] },
  { id: "rejected", label: "Rejected", count: 0, rows: [] },
];

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function labelFromKey(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sectionCount(summary: Summary | null, sectionId: string, fallback: number): number {
  if (!summary) return fallback;
  switch (sectionId) {
    case "saved":
      return summary.savedCount ?? fallback;
    case "underwriting":
      return summary.underwritingCount ?? fallback;
    case "outreach":
      return summary.outreachCount ?? fallback;
    case "awaiting_broker":
      return summary.awaitingBrokerCount ?? fallback;
    case "om_received":
      return summary.omReceivedCount ?? fallback;
    case "rejected":
      return summary.rejectedCount ?? fallback;
    default:
      return fallback;
  }
}

function normalizeSections(data: DealProgressResponse): ProgressSection[] {
  const byId = new Map((data.sections ?? []).map((section) => [section.id, section]));
  const known = SECTION_ORDER.map((base) => {
    const incoming = byId.get(base.id);
    const rows = Array.isArray(incoming?.rows) ? incoming.rows : [];
    const count = sectionCount(data.summary ?? null, base.id, incoming?.count ?? rows.length);
    return {
      ...base,
      ...incoming,
      label: incoming?.label || base.label,
      count,
      rows,
    };
  });
  const extras = (data.sections ?? []).filter((section) => !SECTION_ORDER.some((base) => base.id === section.id));
  return [...known, ...extras];
}

function searchableText(row: ProgressRow): string {
  return [
    row.propertyId,
    row.canonicalAddress,
    row.displayAddress,
    row.source,
    row.status,
    row.savedDealStatus,
    row.omStatus,
    ...(row.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function statusClass(status: string | null | undefined): string {
  if (status === "rejected") return `${styles.statusPill} ${styles.statusDanger}`;
  if (status === "saved" || status === "om_received" || status === "dossier_generated") {
    return `${styles.statusPill} ${styles.statusSuccess}`;
  }
  if (status === "underwriting" || status === "offer_review" || status === "awaiting_broker") {
    return `${styles.statusPill} ${styles.statusWarning}`;
  }
  if (status === "outreach" || status === "screening") return `${styles.statusPill} ${styles.statusInfo}`;
  return `${styles.statusPill} ${styles.statusNeutral}`;
}

export default function ProgressPage() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sections, setSections] = useState<ProgressSection[]>(SECTION_ORDER);
  const [rejectionReasons, setRejectionReasons] = useState<Array<{ reasonCode?: string; count?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProgress = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/ui-v2/deal-progress`);
      const data = (await response.json().catch(() => ({}))) as DealProgressResponse;
      if (!response.ok) throw new Error(data.error || data.details || "Failed to load deal progress");
      setSummary(data.summary ?? null);
      setSections(normalizeSections(data));
      setRejectionReasons(Array.isArray(data.rejectionReasons) ? data.rejectionReasons : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deal progress");
      setSummary(null);
      setSections(SECTION_ORDER);
      setRejectionReasons([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const filteredSections = useMemo(() => {
    if (!query) return sections;
    return sections.map((section) => ({
      ...section,
      rows: (section.rows ?? []).filter((row) => searchableText(row).includes(query)),
    }));
  }, [query, sections]);

  const visibleRowCount = useMemo(
    () => filteredSections.reduce((sum, section) => sum + (section.rows?.length ?? 0), 0),
    [filteredSections]
  );

  const totalCount =
    (summary?.savedCount ?? 0) +
    (summary?.underwritingCount ?? 0) +
    (summary?.outreachCount ?? 0) +
    (summary?.awaitingBrokerCount ?? 0) +
    (summary?.omReceivedCount ?? 0) +
    (summary?.rejectedCount ?? 0);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Deal movement</p>
          <h1 className={styles.title}>Progress</h1>
          <p className={styles.subtitle}>
            Follow saved properties from review into underwriting, outreach, broker follow-up, OM receipt, and rejection.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/saved" className={styles.secondaryLink}>Saved Deals</Link>
          <Link href="/pipeline" className={styles.primaryLink}>Pipeline</Link>
        </div>
      </header>

      {query ? (
        <div className={styles.filterNotice}>
          <span>Filtered by global search</span>
          <strong>{searchParams.get("q")}</strong>
          <span>{visibleRowCount} visible loaded row{visibleRowCount === 1 ? "" : "s"}</span>
        </div>
      ) : null}

      <section className={styles.metrics} aria-label="Deal progress summary">
        <article className={styles.metric}>
          <span>Saved</span>
          <strong>{summary?.savedCount ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Underwriting</span>
          <strong>{summary?.underwritingCount ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Outreach</span>
          <strong>{summary?.outreachCount ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Awaiting Broker</span>
          <strong>{summary?.awaitingBrokerCount ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>OM Received</span>
          <strong>{summary?.omReceivedCount ?? 0}</strong>
        </article>
        <article className={`${styles.metric} ${(summary?.rejectedCount ?? 0) > 0 ? styles.metricDanger : ""}`}>
          <span>Rejected</span>
          <strong>{summary?.rejectedCount ?? 0}</strong>
        </article>
      </section>

      <section className={styles.boardHeader}>
        <div>
          <h2>Progress Tables</h2>
          <p>
            {totalCount} total counted row{totalCount === 1 ? "" : "s"} · Updated {formatDate(summary?.updatedAt)}
          </p>
        </div>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => void loadProgress("refresh")}
          disabled={loading || refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      {rejectionReasons.length > 0 ? (
        <section className={styles.reasonStrip} aria-label="Rejection reason counts">
          {rejectionReasons.slice(0, 8).map((reason) => (
            <span key={reason.reasonCode || "unknown"}>
              {labelFromKey(reason.reasonCode)} <strong>{reason.count ?? 0}</strong>
            </span>
          ))}
        </section>
      ) : null}

      <div className={styles.sections}>
        {filteredSections.map((section) => {
          const rows = section.rows ?? [];
          return (
            <section key={section.id} className={styles.sectionPanel}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3>{section.label || labelFromKey(section.id)}</h3>
                  <p>
                    {section.count ?? rows.length} counted · {rows.length} loaded row{rows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <span className={section.id === "rejected" ? styles.sectionCountDanger : styles.sectionCount}>
                  {section.count ?? rows.length}
                </span>
              </div>

              {loading ? (
                <div className={styles.emptyState}>Loading rows...</div>
              ) : rows.length === 0 ? (
                <div className={styles.emptyState}>
                  {(section.count ?? 0) > 0 && !query
                    ? "Count is available; detailed rows are pending."
                    : query
                      ? "No loaded rows match the current search."
                      : "No rows in this stage."}
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th>Status</th>
                        <th>Score</th>
                        <th>Price / Units</th>
                        <th>OM / Items</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${section.id}-${row.propertyId}`}>
                          <td>
                            <div className={styles.propertyCell}>
                              <Link href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`}>
                                {row.displayAddress || row.canonicalAddress || row.propertyId}
                              </Link>
                              <span>
                                {[row.source ? labelFromKey(row.source) : null, ...(row.tags ?? []).slice(0, 2).map(labelFromKey)]
                                  .filter(Boolean)
                                  .join(" · ") || "No source context"}
                              </span>
                            </div>
                          </td>
                          <td><span className={statusClass(row.status)}>{labelFromKey(row.status)}</span></td>
                          <td className={styles.score}>{row.dealScore == null ? "—" : Math.round(row.dealScore)}</td>
                          <td>
                            <div className={styles.stack}>
                              <span>{formatCurrency(row.price)}</span>
                              <small>{formatNumber(row.units)} units</small>
                            </div>
                          </td>
                          <td>
                            <div className={styles.stack}>
                              <span>{labelFromKey(row.omStatus || "none")}</span>
                              <small>{formatNumber(row.openActionItemCount)} open action item{row.openActionItemCount === 1 ? "" : "s"}</small>
                            </div>
                          </td>
                          <td>{formatDate(row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
