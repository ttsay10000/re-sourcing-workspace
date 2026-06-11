"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, PageHeader, SortableTh, StatCard, useTableSort } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { formatPercent, labelFromKey, scoreTone } from "@/lib/format";
import styles from "./saved.module.css";

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

type ViewMode = "grid" | "table";

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

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  if (
    status === "saved" ||
    status === "om_received" ||
    status === "dossier_generated" ||
    status === "contract_signed" ||
    status === "deal_closed"
  ) {
    return `${styles.statusPill} ${styles.statusSuccess}`;
  }
  if (status === "underwriting" || status === "offer_review" || status === "negotiation" || status === "awaiting_broker") {
    return `${styles.statusPill} ${styles.statusWarning}`;
  }
  if (status === "outreach" || status === "screening") return `${styles.statusPill} ${styles.statusInfo}`;
  return `${styles.statusPill} ${styles.statusNeutral}`;
}

/** Shared 70/50 banding from lib/format, mapped onto this page's pill classes. */
function scoreClass(score: number | null | undefined): string {
  const toneClass = {
    strong: styles.scoreStrong,
    watch: styles.scoreWatch,
    weak: styles.scoreWeak,
    empty: styles.scoreEmpty,
  }[scoreTone(score)];
  return `${styles.scorePill} ${toneClass}`;
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

function SavedPageContent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [rows, setRows] = useState<SavedDealRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [includeRejected, setIncludeRejected] = useState(false);
  const [unsavingIds, setUnsavingIds] = useState<Set<string>>(new Set());

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

  const handleUnsave = useCallback(async (propertyId: string, address: string) => {
    if (!window.confirm(`Remove ${address} from saved deals? The property itself stays in the pipeline.`)) return;
    setNotice(null);
    setError(null);
    setUnsavingIds((prev) => new Set([...prev, propertyId]));
    try {
      const response = await fetch(`${API_BASE}/api/profile/saved-deals/${encodeURIComponent(propertyId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Failed to remove ${address} from saved deals`);
      setRows((prev) => prev.filter((row) => row.propertyId !== propertyId));
      setNotice(`Removed ${address} from saved deals.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove the saved deal");
    } finally {
      setUnsavingIds((prev) => {
        const next = new Set(prev);
        next.delete(propertyId);
        return next;
      });
    }
  }, []);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (!includeRejected) {
      result = result.filter((row) => !isRejected(row));
    }
    if (!query) return result;
    return result.filter((row) => searchableText(row).includes(query));
  }, [query, rows, includeRejected]);

  const rejectedCount = useMemo(() => rows.filter(isRejected).length, [rows]);

  const sortAccessors = useMemo(
    () => ({
      property: (row: SavedDealRow) => row.displayAddress || row.canonicalAddress || row.propertyId,
      status: (row: SavedDealRow) => (isRejected(row) ? "rejected" : row.status || row.savedDeal?.dealStatus || "saved"),
      score: (row: SavedDealRow) => row.dealScore,
      price: (row: SavedDealRow) => row.price,
      updated: (row: SavedDealRow) => row.updatedAt,
    }),
    []
  );
  const { sorted: sortedRows, sortKey, sortDir, toggle: toggleSort } = useTableSort(filteredRows, sortAccessors);

  const metrics = useMemo(() => {
    const scored = rows.map((row) => row.dealScore).filter((score): score is number => typeof score === "number");
    const averageScore = scored.length > 0 ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null;
    const withDocs = rows.filter((row) => (row.documentCount ?? 0) > 0).length;
    return {
      activeCount: Math.max(0, rows.length - rejectedCount),
      rejectedCount,
      averageScore,
      withDocs,
    };
  }, [rows, rejectedCount]);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Workspace"
        title="Saved Deals"
        subtitle="Saved opportunities stay visible here through active review, underwriting, and rejection."
        actions={
          <>
            <Link href="/pipeline" className={styles.secondaryLink}>Pipeline</Link>
            <Link href="/progress" className={styles.primaryLink}>Progress</Link>
          </>
        }
      />

      {query ? (
        <div className={styles.filterNotice}>
          <span>Filtered by global search</span>
          <strong>{searchParams.get("q")}</strong>
          <span>{filteredRows.length} of {rows.length} saved deal{rows.length === 1 ? "" : "s"}</span>
        </div>
      ) : null}

      <section className={styles.metrics} aria-label="Saved deal summary">
        <StatCard label="Total Saved" value={total || rows.length} tone="neutral" />
        <StatCard label="Active" value={metrics.activeCount} tone="neutral" />
        <StatCard
          label="Rejected"
          value={metrics.rejectedCount}
          tone={metrics.rejectedCount > 0 ? "danger" : "neutral"}
        />
        <StatCard
          label="Avg Score"
          value={metrics.averageScore == null ? "—" : Math.round(metrics.averageScore)}
          tone="neutral"
        />
        <StatCard label="With Docs" value={metrics.withDocs} tone="neutral" />
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{viewMode === "grid" ? "Saved Pipeline" : "Saved Pipeline — Table"}</h2>
            <p>{filteredRows.length} visible row{filteredRows.length === 1 ? "" : "s"}</p>
          </div>
          <div className={styles.panelHeaderActions}>
            {rejectedCount > 0 && (
              <button
                type="button"
                className={`${styles.toggleButton} ${includeRejected ? styles.toggleButtonActive : ""}`}
                onClick={() => setIncludeRejected((v) => !v)}
              >
                {includeRejected ? `Hide rejected (${rejectedCount})` : `Include rejected (${rejectedCount})`}
              </button>
            )}
            <div className={styles.viewToggle} role="group" aria-label="View mode">
              <button
                type="button"
                className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
                onClick={() => setViewMode("grid")}
                aria-pressed={viewMode === "grid"}
              >
                Grid
              </button>
              <button
                type="button"
                className={`${styles.viewToggleBtn} ${viewMode === "table" ? styles.viewToggleBtnActive : ""}`}
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
              >
                Table
              </button>
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
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}

        {loading ? (
          <EmptyState title="Loading saved deals…" />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? "No saved deals yet." : "No saved deals match the current search."}
            description={rows.length === 0 ? "Save a deal from the pipeline to see it here." : undefined}
          />
        ) : viewMode === "grid" ? (
          <div className={styles.cardGrid}>
            {filteredRows.map((row) => {
              const rejected = isRejected(row);
              const displayStatus = rejected ? "rejected" : row.status || row.savedDeal?.dealStatus || "saved";
              const savedDate = row.savedDeal?.createdAt ?? row.updatedAt;
              const address = row.displayAddress || row.canonicalAddress || row.propertyId;
              const propertyId = row.propertyId;
              const isUnsaving = unsavingIds.has(propertyId);

              return (
                <article
                  key={`${row.savedDeal?.id ?? propertyId}-${propertyId}`}
                  className={`${styles.dealCard} ${rejected ? styles.dealCardRejected : ""}`}
                >
                  {/* Photo */}
                  <div className={styles.dealCardPhoto} aria-hidden="true">
                    {row.firstImageUrl ? (
                      <img src={row.firstImageUrl} alt="" loading="lazy" />
                    ) : (
                      <span className={styles.dealCardPhotoInitial}>
                        {address.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Body */}
                  <div className={styles.dealCardBody}>
                    {/* Title + meta */}
                    <div className={styles.dealCardHead}>
                      <h3 className={styles.dealCardAddress}>
                        <Link href={`/pipeline?propertyId=${encodeURIComponent(propertyId)}`} className={styles.dealCardAddressLink}>
                          {address}
                        </Link>
                      </h3>
                      <div className={styles.dealCardMeta}>
                        <span className={statusClass(displayStatus)}>{labelFromKey(displayStatus)}</span>
                        {savedDate ? <small>Saved {formatDate(savedDate)}</small> : null}
                      </div>
                    </div>

                    {/* Financials band — prominent hero */}
                    <div className={styles.financialsBand}>
                      <div className={styles.financialStat}>
                        <span className={styles.financialLabel}>Cap Rate</span>
                        <strong className={styles.financialValue}>
                          {row.capRate != null ? formatPercent(row.capRate) : "—"}
                        </strong>
                      </div>
                      <div className={styles.financialStat}>
                        <span className={styles.financialLabel}>Upside</span>
                        <strong className={styles.financialValue}>
                          {row.rentUpside != null ? formatPercent(row.rentUpside) : "—"}
                        </strong>
                      </div>
                      <div className={styles.financialStat}>
                        <span className={styles.financialLabel}>IRR</span>
                        <strong className={styles.financialValue}>
                          {row.irrPct != null ? formatPercent(row.irrPct) : "—"}
                        </strong>
                      </div>
                      {row.cocPct != null && (
                        <div className={styles.financialStat}>
                          <span className={styles.financialLabel}>CoC</span>
                          <strong className={styles.financialValue}>
                            {formatPercent(row.cocPct)}
                          </strong>
                        </div>
                      )}
                    </div>

                    {/* Secondary line: price / units / $SF / score */}
                    <div className={styles.dealCardStats}>
                      <div className={styles.dealCardStat}>
                        <span>Price</span>
                        <strong>{formatCurrency(row.price)}</strong>
                      </div>
                      <div className={styles.dealCardStat}>
                        <span>Units</span>
                        <strong>{row.units != null ? String(row.units) : "—"}</strong>
                      </div>
                      <div className={styles.dealCardStat}>
                        <span>$/SF</span>
                        <strong>{row.pricePerSqft != null ? formatPerCurrency(row.pricePerSqft) : "—"}</strong>
                      </div>
                      <div className={styles.dealCardStat}>
                        <span>Score</span>
                        <strong>
                          <span className={scoreClass(row.dealScore)}>
                            {row.dealScore != null ? `${Math.round(row.dealScore)}` : "—"}
                          </span>
                        </strong>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className={styles.dealCardActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { window.location.href = `/pipeline?propertyId=${encodeURIComponent(propertyId)}`; }}
                      >
                        View property
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { window.location.href = `/pipeline?propertyId=${encodeURIComponent(propertyId)}&tab=underwriting`; }}
                      >
                        View docs
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleUnsave(propertyId, address)}
                        disabled={isUnsaving}
                      >
                        {isUnsaving ? "Removing…" : "Unsave"}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableTh label="Property" sortKey="property" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} firstDir="asc" />
                  <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} firstDir="asc" />
                  <SortableTh label="Score" sortKey="score" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} />
                  <SortableTh label="Economics" sortKey="price" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} title="Sorts by price" />
                  <SortableTh label="Activity" sortKey="updated" activeKey={sortKey} direction={sortDir} onToggle={toggleSort} title="Sorts by last update" />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
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
                            <div className={styles.thumbnailFallback} aria-hidden="true"><Building2 size={15} strokeWidth={1.7} /></div>
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
                      <td className={styles.numericCell}>
                        <span className={scoreClass(row.dealScore)}>
                          {row.dealScore == null ? "—" : `${Math.round(row.dealScore)} / 100`}
                        </span>
                      </td>
                      <td className={styles.numericCell}>
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
                          <Link href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`} className={styles.actionPrimary}>
                            Open
                          </Link>
                          <Link
                            href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}&tab=underwriting`}
                            className={styles.actionSecondary}
                          >
                            Underwrite
                          </Link>
                          {row.listingUrl ? (
                            <a href={row.listingUrl} target="_blank" rel="noreferrer" className={styles.actionGhost}>
                              Listing
                            </a>
                          ) : null}
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

export default function SavedPage() {
  return (
    <Suspense fallback={<div className={styles.page}><EmptyState title="Loading saved deals…" /></div>}>
      <SavedPageContent />
    </Suspense>
  );
}
