"use client";

/**
 * Activity Log: filterable record keeper of user actions and system jobs —
 * OM uploads, properties created, dossier generations, imports, and
 * refresh/workflow runs. Backed by GET /api/ui-v2/activity.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, History, RefreshCcw, Building2, FileCheck2, Upload } from "lucide-react";
import { Badge, type BadgeTone, Button, EmptyState, PageHeader, SkeletonRows } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import styles from "./activity.module.css";

type ActivityItem = {
  kind: "event" | "run";
  id: string;
  type: string;
  title: string;
  body: string | null;
  actor: string | null;
  source: string | null;
  status: string | null;
  propertyId: string | null;
  address: string | null;
  createdAt: string;
  runSteps?: Array<{
    label: string;
    status: string | null;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    skippedItems: number;
  }>;
};

type ActivityResponse = {
  items?: ActivityItem[];
  nextBefore?: string | null;
  error?: string;
};

type FilterDef = {
  key: string;
  label: string;
  icon: typeof History;
  /** Query params applied when this chip is active. */
  params: { types?: string[]; kinds?: string[] };
};

const FILTERS: FilterDef[] = [
  { key: "all", label: "All activity", icon: History, params: {} },
  { key: "om_uploads", label: "OM uploads", icon: Upload, params: { types: ["om_uploaded"] } },
  { key: "properties", label: "Properties created", icon: Building2, params: { types: ["property_created"] } },
  { key: "dossiers", label: "Dossiers", icon: FileCheck2, params: { types: ["dossier_generated"] } },
  { key: "imports", label: "Imports", icon: FileText, params: { types: ["import_started", "import_completed"] } },
  { key: "runs", label: "Refresh runs", icon: RefreshCcw, params: { kinds: ["run"] } },
];

const PAGE_LIMIT = 80;

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function typeLabel(item: ActivityItem): string {
  if (item.kind === "run") return item.type.replace(/_/g, " ");
  switch (item.type) {
    case "om_uploaded":
      return "OM upload";
    case "property_created":
      return "Property created";
    case "dossier_generated":
      return "Dossier";
    case "import_started":
    case "import_completed":
      return "Import";
    default:
      return item.type.replace(/_/g, " ");
  }
}

function statusBadgeTone(status: string | null): BadgeTone {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "partial":
      return "warning";
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

function runStepCounter(step: NonNullable<ActivityItem["runSteps"]>[number]): string {
  const done = step.completedItems + step.failedItems + step.skippedItems;
  const parts = [`${done}/${step.totalItems || done} processed`];
  if (step.completedItems) parts.push(`${step.completedItems} ok`);
  if (step.failedItems) parts.push(`${step.failedItems} failed`);
  if (step.skippedItems) parts.push(`${step.skippedItems} skipped`);
  return parts.join(" · ");
}

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [filterKey, setFilterKey] = useState("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter = useMemo(() => FILTERS.find((entry) => entry.key === filterKey) ?? FILTERS[0]!, [filterKey]);

  const buildUrl = useCallback(
    (before?: string | null) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_LIMIT));
      if (filter.params.types?.length) params.set("types", filter.params.types.join(","));
      if (filter.params.kinds?.length) params.set("kinds", filter.params.kinds.join(","));
      if (appliedSearch.trim()) params.set("q", appliedSearch.trim());
      if (before) params.set("before", before);
      return `${API_BASE}/api/ui-v2/activity?${params.toString()}`;
    },
    [filter, appliedSearch]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as ActivityResponse;
      if (!res.ok || data.error) throw new Error(data.error || "Failed to load the activity feed.");
      setItems(data.items ?? []);
      setNextBefore(data.nextBefore ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the activity feed.");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  const loadMore = useCallback(async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(nextBefore), { credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as ActivityResponse;
      if (!res.ok || data.error) throw new Error(data.error || "Failed to load more activity.");
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setNextBefore(data.nextBefore ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more activity.");
    } finally {
      setLoadingMore(false);
    }
  }, [buildUrl, nextBefore, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  // New uploads/refreshes land asynchronously; keep the feed current like the
  // home page does (60s while visible).
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !loadingMore) void load();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [load, loadingMore]);

  const grouped = useMemo(() => {
    const groups: Array<{ day: string; items: ActivityItem[] }> = [];
    for (const item of items) {
      const day = dayLabel(item.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.day === day) lastGroup.items.push(item);
      else groups.push({ day, items: [item] });
    }
    return groups;
  }, [items]);

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Deal Progress · Record Keeper"
        title="Activity Log"
        subtitle="Everything that changed the workspace — OM uploads, new properties, dossier generations, imports, and refresh runs — newest first. Filter by type or search by address and file name."
      />

      <div className={styles.filterRow}>
        {FILTERS.map((entry) => {
          const ChipIcon = entry.icon;
          const active = entry.key === filterKey;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setFilterKey(entry.key)}
              className={active ? `${styles.filterChip} ${styles.filterChipActive}` : styles.filterChip}
            >
              <ChipIcon size={13} strokeWidth={2} aria-hidden="true" />
              {entry.label}
            </button>
          );
        })}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedSearch(search);
          }}
          className={styles.searchForm}
        >
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (!event.target.value.trim() && appliedSearch) setAppliedSearch("");
            }}
            placeholder="Search address, file, action"
            aria-label="Search activity"
            className={styles.searchInput}
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {loading ? (
        <SkeletonRows count={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History size={16} strokeWidth={2} aria-hidden="true" />}
          title="No activity recorded for this filter yet."
          description="New OM uploads, property creates, dossier generations, and refresh runs will appear here as they happen."
        />
      ) : (
        <div className={styles.eventGroups}>
          {grouped.map((group) => (
            <section key={group.day} className={styles.dayGroup}>
              <h2 className={styles.dayHeading}>{group.day}</h2>
              <div className={styles.eventList}>
                {group.items.map((item) => (
                  <article key={`${item.kind}-${item.id}`} className={styles.eventRow}>
                    <span className={styles.eventTime}>{formatTime(item.createdAt)}</span>
                    <div className={styles.eventBody}>
                      <div className={styles.eventTitleLine}>
                        <strong className={styles.eventTitle}>{item.title}</strong>
                        <Badge tone="neutral" className={styles.eventBadge}>
                          {typeLabel(item)}
                        </Badge>
                        {item.kind === "run" && item.status ? (
                          <Badge tone={statusBadgeTone(item.status)} className={styles.eventBadge}>
                            {item.status}
                          </Badge>
                        ) : null}
                      </div>
                      {item.body ? <span className={styles.eventBodyText}>{item.body}</span> : null}
                      {item.kind === "run" && item.runSteps?.length ? (
                        <div className={styles.runStepList} aria-label="Run stage counters">
                          {item.runSteps.map((step) => (
                            <span
                              key={`${item.id}-${step.label}`}
                              className={`${styles.runStepChip} ${step.failedItems > 0 ? styles.runStepChipWarn : ""}`}
                              title={runStepCounter(step)}
                            >
                              <strong>{step.label}</strong>
                              <span>{runStepCounter(step)}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {item.propertyId ? (
                        <Link
                          href={`/pipeline?propertyId=${encodeURIComponent(item.propertyId)}`}
                          className={styles.eventLink}
                        >
                          {item.address || "Open property"}
                        </Link>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {nextBefore ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className={styles.loadMoreButton}
            >
              {loadingMore ? "Loading…" : "Load older activity"}
            </Button>
          ) : null}
        </div>
      )}
    </main>
  );
}
