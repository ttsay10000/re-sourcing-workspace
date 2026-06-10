"use client";

/**
 * Activity Log: filterable record keeper of user actions and system jobs —
 * OM uploads, properties created, dossier generations, imports, and
 * refresh/workflow runs. Backed by GET /api/ui-v2/activity.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, History, RefreshCcw, Building2, FileCheck2, Upload } from "lucide-react";
import { API_BASE } from "@/lib/api";

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

function statusTone(status: string | null): { background: string; color: string; border: string } {
  switch (status) {
    case "completed":
      return { background: "#ecfdf5", color: "#047857", border: "#a7f3d0" };
    case "failed":
      return { background: "#fef2f2", color: "#b91c1c", border: "#fecaca" };
    case "partial":
      return { background: "#fffbeb", color: "#b45309", border: "#fde68a" };
    case "running":
      return { background: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" };
    default:
      return { background: "#f4f4f3", color: "#52525b", border: "#e4e4e7" };
  }
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
    <main style={{ padding: "1.4rem 1.6rem", maxWidth: "980px", margin: "0 auto", display: "grid", gap: "1rem" }}>
      <header style={{ display: "grid", gap: "0.3rem" }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.08em", color: "var(--brand-strong, #2f6f52)", textTransform: "uppercase" }}>
          Deal Progress · Record Keeper
        </span>
        <h1 style={{ margin: 0, fontSize: "1.45rem", color: "var(--app-ink, #18231e)" }}>Activity Log</h1>
        <p style={{ margin: 0, color: "var(--app-ink-secondary, #68736d)", fontSize: "0.88rem", maxWidth: "62ch" }}>
          Everything that changed the workspace — OM uploads, new properties, dossier generations, imports, and
          refresh runs — newest first. Filter by type or search by address and file name.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center" }}>
        {FILTERS.map((entry) => {
          const ChipIcon = entry.icon;
          const active = entry.key === filterKey;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setFilterKey(entry.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.38rem 0.7rem",
                borderRadius: "999px",
                border: active ? "1px solid var(--brand-strong, #2f6f52)" : "1px solid rgba(38, 47, 44, 0.16)",
                background: active ? "var(--brand-strong, #2f6f52)" : "#ffffff",
                color: active ? "#ffffff" : "var(--app-ink, #18231e)",
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
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
          style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}
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
            style={{
              padding: "0.4rem 0.65rem",
              borderRadius: "8px",
              border: "1px solid rgba(38, 47, 44, 0.18)",
              fontSize: "0.82rem",
              minWidth: "220px",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid rgba(38, 47, 44, 0.18)",
              background: "#ffffff",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Search
          </button>
        </form>
      </div>

      {error ? (
        <div style={{ padding: "0.7rem 0.9rem", borderRadius: "8px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: "0.84rem" }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: "var(--app-ink-secondary, #68736d)", fontSize: "0.88rem" }}>Loading activity…</div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: "1.6rem",
            borderRadius: "10px",
            border: "1px dashed rgba(38, 47, 44, 0.2)",
            color: "var(--app-ink-secondary, #68736d)",
            fontSize: "0.88rem",
            textAlign: "center",
          }}
        >
          No activity recorded for this filter yet. New OM uploads, property creates, dossier generations, and
          refresh runs will appear here as they happen.
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1.1rem" }}>
          {grouped.map((group) => (
            <section key={group.day} style={{ display: "grid", gap: "0.45rem" }}>
              <h2 style={{ margin: 0, fontSize: "0.78rem", fontWeight: 800, color: "var(--app-ink-secondary, #68736d)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {group.day}
              </h2>
              <div style={{ display: "grid", gap: "0.45rem" }}>
                {group.items.map((item) => {
                  const tone = statusTone(item.status);
                  return (
                    <article
                      key={`${item.kind}-${item.id}`}
                      style={{
                        display: "flex",
                        gap: "0.8rem",
                        alignItems: "baseline",
                        padding: "0.6rem 0.8rem",
                        borderRadius: "10px",
                        border: "1px solid rgba(38, 47, 44, 0.12)",
                        background: "#ffffff",
                      }}
                    >
                      <span style={{ fontSize: "0.74rem", color: "var(--app-ink-secondary, #68736d)", minWidth: "4.2rem" }}>
                        {formatTime(item.createdAt)}
                      </span>
                      <div style={{ display: "grid", gap: "0.18rem", minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                          <strong style={{ fontSize: "0.86rem", color: "var(--app-ink, #18231e)" }}>{item.title}</strong>
                          <span
                            style={{
                              fontSize: "0.68rem",
                              fontWeight: 800,
                              padding: "0.08rem 0.45rem",
                              borderRadius: "999px",
                              background: "#f4f4f3",
                              border: "1px solid #e4e4e7",
                              color: "#52525b",
                              textTransform: "capitalize",
                            }}
                          >
                            {typeLabel(item)}
                          </span>
                          {item.kind === "run" && item.status ? (
                            <span
                              style={{
                                fontSize: "0.68rem",
                                fontWeight: 800,
                                padding: "0.08rem 0.45rem",
                                borderRadius: "999px",
                                background: tone.background,
                                border: `1px solid ${tone.border}`,
                                color: tone.color,
                                textTransform: "capitalize",
                              }}
                            >
                              {item.status}
                            </span>
                          ) : null}
                        </div>
                        {item.body ? (
                          <span style={{ fontSize: "0.78rem", color: "var(--app-ink-secondary, #68736d)", overflowWrap: "anywhere" }}>
                            {item.body}
                          </span>
                        ) : null}
                        {item.propertyId ? (
                          <Link
                            href={`/pipeline?propertyId=${encodeURIComponent(item.propertyId)}`}
                            style={{ fontSize: "0.76rem", fontWeight: 700, color: "#1d4ed8", textDecoration: "none", justifySelf: "start" }}
                          >
                            {item.address || "Open property"}
                          </Link>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {nextBefore ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              style={{
                justifySelf: "center",
                padding: "0.5rem 1.1rem",
                borderRadius: "999px",
                border: "1px solid rgba(38, 47, 44, 0.18)",
                background: "#ffffff",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: loadingMore ? "wait" : "pointer",
              }}
            >
              {loadingMore ? "Loading…" : "Load older activity"}
            </button>
          ) : null}
        </div>
      )}
    </main>
  );
}
