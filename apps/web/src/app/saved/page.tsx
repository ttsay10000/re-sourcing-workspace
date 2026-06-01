"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./saved.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  pricePerUnit?: number | null;
  pricePerSqft?: number | null;
  capRate?: number | null;
  rentUpside?: number | null;
  irrPct?: number | null;
  cocPct?: number | null;
  dealScore?: number | null;
  status?: string | null;
  tags?: string[];
  neighborhood?: string | null;
  borough?: string | null;
  firstImageUrl?: string | null;
  listingUrl?: string | null;
  omStatus?: string | null;
  documentCount?: number | null;
  openActionItemCount?: number | null;
  latestOutreachAt?: string | null;
  rejection?: {
    reasonCode?: string | null;
    reasonLabel?: string | null;
    note?: string | null;
    rejectedAt?: string | null;
  } | null;
  updatedAt?: string | null;
};

type SavedDealsResponse = {
  savedDeals?: {
    rows?: SavedDealRow[];
    deals?: Array<{ id?: string; propertyId?: string; dealStatus?: string; createdAt?: string }>;
    total?: number;
    limit?: number;
    offset?: number;
  };
  error?: string;
  details?: string;
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatPerCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number | null | undefined, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}${suffix}`;
}

function formatWholeNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function availableFacts(row: SavedDealRow): string[] {
  return [
    row.units != null ? `${formatWholeNumber(row.units)} units` : null,
    row.beds != null || row.baths != null
      ? `${row.beds != null ? formatNumber(row.beds) : "—"} bed / ${row.baths != null ? formatNumber(row.baths) : "—"} bath`
      : null,
    row.sqft != null ? `${formatWholeNumber(row.sqft)} SF` : null,
  ].filter((value): value is string => Boolean(value));
}

function availableEconomics(row: SavedDealRow): string[] {
  return [
    row.pricePerUnit != null ? `${formatPerCurrency(row.pricePerUnit)} / unit` : null,
    row.pricePerSqft != null ? `${formatPerCurrency(row.pricePerSqft)} / SF` : null,
    row.capRate != null ? `Cap ${formatPercent(row.capRate)}` : null,
    row.rentUpside != null ? `Upside ${formatPercent(row.rentUpside)}` : null,
  ].filter((value): value is string => Boolean(value));
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
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
    .flatMap((part) => part.split("-"))
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const AREA_LABELS: Record<string, string> = {
  fultonseaport: "Fulton Seaport",
  "fulton-seaport": "Fulton Seaport",
  "hells-kitchen": "Hell's Kitchen",
  nomad: "NoMad",
  noho: "NoHo",
  "sutton-place": "Sutton Place",
  soho: "SoHo",
  tribeca: "TriBeCa",
};

const SOURCE_LABELS: Record<string, string> = {
  loopnet: "LoopNet",
  manual: "Manual",
  other: "Other",
  streeteasy: "StreetEasy",
};

function areaLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return AREA_LABELS[normalized] ?? labelFromKey(normalized);
}

function locationLine(row: Pick<SavedDealRow, "neighborhood" | "borough" | "source">): string {
  const seen = new Set<string>();
  const locationParts = [row.neighborhood, row.borough]
    .flatMap((value) => String(value ?? "").split(/[·/,]/g))
    .map((value) => areaLabel(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const sourceKey = row.source?.trim().toLowerCase();
  const source = sourceKey ? SOURCE_LABELS[sourceKey] ?? labelFromKey(sourceKey) : null;
  return [...locationParts, source].filter(Boolean).join(" · ") || "No market context";
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

function isRejected(row: SavedDealRow): boolean {
  return row.status === "rejected" || row.savedDeal?.dealStatus === "rejected" || row.rejection != null;
}

function searchableText(row: SavedDealRow): string {
  const rejection = row.rejection;
  return [
    row.propertyId,
    row.canonicalAddress,
    row.displayAddress,
    row.source,
    row.status,
    row.savedDeal?.dealStatus,
    row.neighborhood,
    row.borough,
    row.omStatus,
    ...(row.tags ?? []),
    rejection?.reasonCode,
    rejection?.reasonLabel,
    rejection?.note,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeRows(data: SavedDealsResponse): SavedDealRow[] {
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

export default function SavedPage() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [rows, setRows] = useState<SavedDealRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSavedDeals = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "250" });
      const response = await fetch(`${API_BASE}/api/ui-v2/saved-deals?${params}`);
      const data = (await response.json().catch(() => ({}))) as SavedDealsResponse;
      if (!response.ok) throw new Error(data.error || data.details || "Failed to load saved deals");
      setRows(normalizeRows(data));
      setTotal(data.savedDeals?.total ?? normalizeRows(data).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved deals");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedDeals();
  }, [loadSavedDeals]);

  const filteredRows = useMemo(() => {
    if (!query) return rows;
    return rows.filter((row) => searchableText(row).includes(query));
  }, [query, rows]);

  const metrics = useMemo(() => {
    const rejectedCount = rows.filter(isRejected).length;
    const scored = rows.map((row) => row.dealScore).filter((score): score is number => typeof score === "number");
    const averageScore = scored.length > 0 ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null;
    const withDocs = rows.filter((row) => (row.documentCount ?? 0) > 0).length;
    return {
      activeCount: Math.max(0, rows.length - rejectedCount),
      rejectedCount,
      averageScore,
      withDocs,
    };
  }, [rows]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Saved desk</p>
          <h1 className={styles.title}>Saved Deals</h1>
          <p className={styles.subtitle}>
            Saved opportunities stay visible here through active review, underwriting, and rejection.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/pipeline" className={styles.secondaryLink}>Pipeline</Link>
          <Link href="/progress" className={styles.primaryLink}>Progress</Link>
        </div>
      </header>

      {query ? (
        <div className={styles.filterNotice}>
          <span>Filtered by global search</span>
          <strong>{searchParams.get("q")}</strong>
          <span>{filteredRows.length} of {rows.length} saved deal{rows.length === 1 ? "" : "s"}</span>
        </div>
      ) : null}

      <section className={styles.metrics} aria-label="Saved deal summary">
        <article className={styles.metric}>
          <span>Total Saved</span>
          <strong>{total || rows.length}</strong>
        </article>
        <article className={styles.metric}>
          <span>Active</span>
          <strong>{metrics.activeCount}</strong>
        </article>
        <article className={`${styles.metric} ${metrics.rejectedCount > 0 ? styles.metricDanger : ""}`}>
          <span>Rejected</span>
          <strong>{metrics.rejectedCount}</strong>
        </article>
        <article className={styles.metric}>
          <span>Avg Score</span>
          <strong>{metrics.averageScore == null ? "—" : Math.round(metrics.averageScore)}</strong>
        </article>
        <article className={styles.metric}>
          <span>With Docs</span>
          <strong>{metrics.withDocs}</strong>
        </article>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Saved Pipeline</h2>
            <p>{filteredRows.length} visible row{filteredRows.length === 1 ? "" : "s"}</p>
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void loadSavedDeals("refresh")}
            disabled={loading || refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        {loading ? (
          <div className={styles.emptyState}>Loading saved deals...</div>
        ) : filteredRows.length === 0 ? (
          <div className={styles.emptyState}>
            {rows.length === 0 ? "No saved deals yet." : "No saved deals match the current search."}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Economics</th>
                  <th>Activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const rejected = isRejected(row);
                  const displayStatus = rejected ? "rejected" : row.status || row.savedDeal?.dealStatus || "saved";
                  const rejectionLabel = row.rejection?.reasonLabel || labelFromKey(row.rejection?.reasonCode);
                  const facts = availableFacts(row);
                  const economics = availableEconomics(row);
                  return (
                    <tr key={`${row.savedDeal?.id ?? row.propertyId}-${row.propertyId}`} className={rejected ? styles.rejectedRow : undefined}>
                      <td>
                        <div className={styles.propertyCell}>
                          {row.firstImageUrl ? (
                            <img src={row.firstImageUrl} alt="" className={styles.thumbnail} />
                          ) : (
                            <div className={styles.thumbnailFallback}>{(row.displayAddress || row.canonicalAddress || "?").charAt(0)}</div>
                          )}
                          <div className={styles.propertyText}>
                            <Link href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`} className={styles.addressLink}>
                              {row.displayAddress || row.canonicalAddress || row.propertyId}
                            </Link>
                            <span>{locationLine(row)}</span>
                            {row.tags && row.tags.length > 0 ? (
                              <div className={styles.tags}>
                                {row.tags.slice(0, 3).map((tag) => (
                                  <span className={tagClass(tag)} key={tag}>{labelFromKey(tag)}</span>
                                ))}
                                {row.tags.length > 3 ? <span className={styles.tagChip}>+{row.tags.length - 3}</span> : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.statusStack}>
                          <span className={statusClass(displayStatus)}>{labelFromKey(displayStatus)}</span>
                          {rejected ? (
                            <div className={styles.rejectionBlock}>
                              <strong>{rejectionLabel}</strong>
                              {row.rejection?.note ? <span>{row.rejection.note}</span> : null}
                              {row.rejection?.rejectedAt ? <small>{formatDate(row.rejection.rejectedAt)}</small> : null}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className={scoreClass(row.dealScore)}>
                          {row.dealScore == null ? "—" : `${Math.round(row.dealScore)} / 100`}
                        </span>
                      </td>
                      <td>
                        <div className={styles.stack}>
                          <span>{formatCurrency(row.price)}</span>
                          {facts.length > 0 ? (
                            <div className={styles.factLine}>
                              {facts.map((fact) => <small key={fact}>{fact}</small>)}
                            </div>
                          ) : (
                            <small>No source facts yet</small>
                          )}
                          {economics.length > 0 ? <small>{economics.join(" · ")}</small> : null}
                        </div>
                      </td>
                      <td>
                        <div className={styles.stack}>
                          <span>{labelFromKey(row.omStatus || "no_om")}</span>
                          <small>{formatNumber(row.documentCount)} docs · {formatNumber(row.openActionItemCount)} open items</small>
                          <small>Updated {formatDate(row.updatedAt)}</small>
                        </div>
                      </td>
                      <td>
                        <div className={styles.actionStack}>
                          <Link href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`}>Open</Link>
                          <Link href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}&tab=underwriting`}>
                            Underwrite
                          </Link>
                          {row.listingUrl ? <a href={row.listingUrl} target="_blank" rel="noreferrer">Listing</a> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
