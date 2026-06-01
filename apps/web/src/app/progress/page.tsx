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

type SavedDealRow = {
  savedDeal?: {
    id?: string;
    propertyId?: string;
    dealStatus?: string;
    createdAt?: string;
  };
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  source?: string | null;
  price?: number | null;
  units?: number | null;
  dealScore?: number | null;
  status?: string | null;
  tags?: string[];
  omStatus?: string | null;
  openActionItemCount?: number | null;
  updatedAt?: string | null;
};

type DealProgressResponse = {
  summary?: Summary;
  sections?: ProgressSection[];
  rejectionReasons?: Array<{ reasonCode?: string; count?: number }>;
  error?: string;
  details?: string;
};

type SavedDealsResponse = {
  savedDeals?: {
    rows?: SavedDealRow[];
    deals?: Array<{ id?: string; propertyId?: string; dealStatus?: string; createdAt?: string }>;
    total?: number;
  };
  error?: string;
  details?: string;
};

type SavedDealSection = {
  id: string;
  label: string;
  description?: string;
  rows: SavedDealRow[];
};

const SECTION_ORDER: ProgressSection[] = [
  { id: "saved", label: "Saved Deals", count: 0, rows: [] },
  { id: "underwriting", label: "Underwriting", count: 0, rows: [] },
  { id: "outreach", label: "Outreach", count: 0, rows: [] },
  { id: "awaiting_broker", label: "Awaiting Broker", count: 0, rows: [] },
  { id: "om_received", label: "OM Received", count: 0, rows: [] },
  { id: "rejected", label: "Rejected", count: 0, rows: [] },
];

const SAVED_STATUS_GROUPS: Array<{
  id: string;
  label: string;
  description: string;
  statuses: string[];
}> = [
  {
    id: "watchlist",
    label: "Watchlist",
    description: "Saved and early-review deals.",
    statuses: ["saved", "interesting", "screening", "new"],
  },
  {
    id: "underwriting",
    label: "Underwriting",
    description: "Deals in underwriting or dossier work.",
    statuses: ["underwriting", "dossier_generated"],
  },
  {
    id: "loi_negotiation",
    label: "LOI / Negotiation",
    description: "Broker outreach, LOI, and offer-review stages.",
    statuses: ["outreach", "awaiting_broker", "offer_review"],
  },
  {
    id: "contract_diligence",
    label: "Contract / Diligence",
    description: "OM received and deeper diligence stages.",
    statuses: ["om_received"],
  },
  {
    id: "rejected_removed",
    label: "Rejected / Removed",
    description: "Rejected or archived saved deals.",
    statuses: ["rejected", "archived"],
  },
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
  const normalized = value.trim().toLowerCase();
  const specialLabels: Record<string, string> = {
    loopnet: "LoopNet",
    streeteasy: "StreetEasy",
  };
  if (specialLabels[normalized]) return specialLabels[normalized];
  return normalized
    .split("_")
    .flatMap((part) => part.split("-"))
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function tagClass(tag: string): string {
  const normalized = normalizeTag(tag);
  if (["high_priority", "mtr_candidate", "tax_advantage", "below_replacement"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagOpportunity}`;
  }
  if (["broker_relationship", "follow_up", "partner_review", "toured"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagRelationship}`;
  }
  if (["needs_om", "needs_rent_roll", "needs_city_data", "om_requested"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagAction}`;
  }
  if (["distressed_seller", "rent_stab_risk", "duplicate", "rejected"].includes(normalized)) {
    return `${styles.tagChip} ${styles.tagRisk}`;
  }
  return `${styles.tagChip} ${styles.tagNeutral}`;
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

function normalizeSavedDeals(data: SavedDealsResponse): SavedDealRow[] {
  const rows = data.savedDeals?.rows;
  if (Array.isArray(rows)) return rows;
  return (data.savedDeals?.deals ?? [])
    .filter((deal) => typeof deal.propertyId === "string")
    .map((deal) => ({
      propertyId: deal.propertyId as string,
      savedDeal: deal,
      status: deal.dealStatus ?? "saved",
      updatedAt: deal.createdAt ?? null,
    }));
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

function searchableSavedDealText(row: SavedDealRow): string {
  return [
    row.propertyId,
    row.canonicalAddress,
    row.displayAddress,
    row.source,
    row.status,
    row.savedDeal?.dealStatus,
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

function scoreClass(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return `${styles.scorePill} ${styles.scoreEmpty}`;
  if (score >= 70) return `${styles.scorePill} ${styles.scoreStrong}`;
  if (score >= 50) return `${styles.scorePill} ${styles.scoreWatch}`;
  return `${styles.scorePill} ${styles.scoreWeak}`;
}

function rowStatus(row: SavedDealRow): string {
  return row.status || row.savedDeal?.dealStatus || "saved";
}

function buildSavedStatusSections(rows: SavedDealRow[]): SavedDealSection[] {
  const claimed = new Set<string>();
  const sections = SAVED_STATUS_GROUPS.map((group) => {
    const matches = rows.filter((row) => group.statuses.includes(rowStatus(row)));
    matches.forEach((row) => claimed.add(row.propertyId));
    return { id: group.id, label: group.label, description: group.description, rows: matches };
  });
  const otherRows = rows.filter((row) => !claimed.has(row.propertyId));
  return otherRows.length > 0
    ? [...sections, { id: "other", label: "Other Saved", description: "Saved deals outside the standard stages.", rows: otherRows }]
    : sections;
}

function buildSavedTagSections(rows: SavedDealRow[]): SavedDealSection[] {
  const byTag = new Map<string, SavedDealRow[]>();
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      const trimmed = tag.trim();
      if (!trimmed) continue;
      const current = byTag.get(trimmed) ?? [];
      current.push(row);
      byTag.set(trimmed, current);
    }
  }
  return [...byTag.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([tag, tagRows]) => ({
      id: tag,
      label: labelFromKey(tag),
      rows: tagRows,
    }));
}

export default function ProgressPage() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sections, setSections] = useState<ProgressSection[]>(SECTION_ORDER);
  const [savedDealRows, setSavedDealRows] = useState<SavedDealRow[]>([]);
  const [rejectionReasons, setRejectionReasons] = useState<Array<{ reasonCode?: string; count?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProgress = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [progressResponse, savedResponse] = await Promise.all([
        fetch(`${API_BASE}/api/ui-v2/deal-progress`),
        fetch(`${API_BASE}/api/ui-v2/saved-deals?${new URLSearchParams({ limit: "250" })}`),
      ]);
      const progressData = (await progressResponse.json().catch(() => ({}))) as DealProgressResponse;
      const savedData = (await savedResponse.json().catch(() => ({}))) as SavedDealsResponse;
      if (!progressResponse.ok) throw new Error(progressData.error || progressData.details || "Failed to load deal progress");
      if (!savedResponse.ok) throw new Error(savedData.error || savedData.details || "Failed to load saved deal sections");
      setSummary(progressData.summary ?? null);
      setSections(normalizeSections(progressData));
      setSavedDealRows(normalizeSavedDeals(savedData));
      setRejectionReasons(Array.isArray(progressData.rejectionReasons) ? progressData.rejectionReasons : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deal progress");
      setSummary(null);
      setSections(SECTION_ORDER);
      setSavedDealRows([]);
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

  const filteredSavedDealRows = useMemo(() => {
    if (!query) return savedDealRows;
    return savedDealRows.filter((row) => searchableSavedDealText(row).includes(query));
  }, [query, savedDealRows]);

  const savedStatusSections = useMemo(() => buildSavedStatusSections(filteredSavedDealRows), [filteredSavedDealRows]);
  const savedTagSections = useMemo(() => buildSavedTagSections(filteredSavedDealRows), [filteredSavedDealRows]);

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

      <section className={styles.savedFlowPanel} aria-label="Saved deals by status">
        <div className={styles.savedFlowHeader}>
          <div>
            <h2>Saved Deals by Status</h2>
            <p>{filteredSavedDealRows.length} saved deal{filteredSavedDealRows.length === 1 ? "" : "s"} grouped into deal-flow stages</p>
          </div>
          <Link href="/saved" className={styles.secondaryLink}>Open Saved Deals</Link>
        </div>
        <div className={styles.flowSections}>
          {savedStatusSections.map((section) => (
            <SavedDealMiniSection key={section.id} section={section} loading={loading} />
          ))}
        </div>
      </section>

      <section className={styles.savedFlowPanel} aria-label="Saved deals by tag">
        <div className={styles.savedFlowHeader}>
          <div>
            <h2>Saved Deals by Tag</h2>
            <p>Same saved deal set grouped by active tags for faster review.</p>
          </div>
        </div>
        {loading ? (
          <div className={styles.emptyState}>Loading saved deal tags...</div>
        ) : savedTagSections.length === 0 ? (
          <div className={styles.emptyState}>
            {filteredSavedDealRows.length === 0 ? "No saved deals available for tag grouping." : "No tags found on saved deals yet."}
          </div>
        ) : (
          <div className={styles.tagSections}>
            {savedTagSections.slice(0, 12).map((section) => (
              <SavedDealMiniSection key={section.id} section={section} loading={loading} compact />
            ))}
          </div>
        )}
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
                              <span>{row.source ? labelFromKey(row.source) : "No source context"}</span>
                              {row.tags && row.tags.length > 0 ? (
                                <div className={styles.tagLine}>
                                  {row.tags.slice(0, 3).map((tag) => (
                                    <span className={tagClass(tag)} key={tag}>{labelFromKey(tag)}</span>
                                  ))}
                                  {row.tags.length > 3 ? <span className={styles.tagChip}>+{row.tags.length - 3}</span> : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td><span className={statusClass(row.status)}>{labelFromKey(row.status)}</span></td>
                          <td>
                            <span className={scoreClass(row.dealScore)}>
                              {row.dealScore == null ? "—" : `${Math.round(row.dealScore)} / 100`}
                            </span>
                          </td>
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

function SavedDealMiniSection({
  section,
  loading,
  compact = false,
}: {
  section: SavedDealSection;
  loading: boolean;
  compact?: boolean;
}) {
  const visibleRows = compact ? section.rows.slice(0, 5) : section.rows;
  return (
    <section className={styles.miniSection}>
      <div className={styles.miniSectionHeader}>
        <div>
          <h3>{section.label}</h3>
          {section.description ? <p>{section.description}</p> : null}
        </div>
        <span>{section.rows.length}</span>
      </div>
      {loading ? (
        <div className={styles.emptyState}>Loading saved deals...</div>
      ) : visibleRows.length === 0 ? (
        <div className={styles.emptyState}>No saved deals in this section.</div>
      ) : (
        <div className={styles.miniRows}>
          {visibleRows.map((row) => (
            <Link
              key={`${section.id}-${row.propertyId}`}
              href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`}
              className={styles.miniRow}
            >
              <div>
                <strong>{row.displayAddress || row.canonicalAddress || row.propertyId}</strong>
                <span>
                  {[row.source ? labelFromKey(row.source) : null, formatNumber(row.units) === "—" ? null : `${formatNumber(row.units)}u`]
                    .filter(Boolean)
                    .join(" · ") || "No context"}
                </span>
              </div>
              <div className={styles.miniMeta}>
                <span className={statusClass(rowStatus(row))}>{labelFromKey(rowStatus(row))}</span>
                <small className={scoreClass(row.dealScore)}>
                  {row.dealScore == null ? "—" : `${Math.round(row.dealScore)} / 100`}
                </small>
              </div>
            </Link>
          ))}
          {compact && section.rows.length > visibleRows.length ? (
            <div className={styles.moreRows}>+{section.rows.length - visibleRows.length} more</div>
          ) : null}
        </div>
      )}
    </section>
  );
}
