"use client";

/**
 * Global long-running-process banner.
 *
 * Pages register a process via useProcessBanner().start(label) and the banner
 * renders across the top of the workspace (under the topbar) until the user
 * dismisses it with ✕ — completed and failed banners stay put through
 * navigation AND full page reloads (state persists to localStorage).
 * Dismissing only hides the banner — the underlying request keeps running.
 *
 * Running banners show a spinner plus a ticking time-to-completion countdown.
 * Estimates start from per-kind seeds, then learn: every successful run's
 * duration (per item) is recorded to localStorage and the median drives the
 * next countdown. When server step progress is available it projects the real
 * pace instead. Past the estimate, the chip reads "wrapping up…".
 *
 * Refresh semantics: a banner backed by a server workflow run (workflowRunId)
 * resumes polling after a reload and picks up the real outcome. A banner owned
 * by an in-page fetch can't recover its promise after a reload, so it flips to
 * an "interrupted" state — the server usually kept working; the banner says so
 * and stays until the user confirms and ✕'s it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2, X, CheckCircle2, AlertTriangle, Info, Timer } from "lucide-react";
import { API_BASE } from "@/lib/api";
import styles from "./ProcessBanner.module.css";

export type ProcessStatus = "running" | "success" | "error" | "interrupted";

export interface ProcessEntry {
  id: string;
  label: string;
  message: string | null;
  status: ProcessStatus;
  startedAt: number;
  /** Last time the owning page reported progress (drives the stalled check). */
  updatedAt: number;
  /** When the entry reached a terminal state; null while running. */
  finishedAt: number | null;
  workflowRunId: string | null;
  /** 0-100 when a step total is known, otherwise null (indeterminate). */
  progressPct: number | null;
  /** Estimated total duration in ms driving the countdown; null hides it. */
  etaMs: number | null;
  /** Key under which finished durations are learned (defaults to a slug of the label). */
  estimateKind: string | null;
  /** Unit count (files, URLs, properties) scaling the per-item estimate. */
  estimateItems: number;
}

export interface ProcessHandle {
  id: string;
  /** Update the live message (and optional 0-100 progress) while running. */
  update: (message: string, progressPct?: number | null) => void;
  /** Attach a server workflow run so the banner polls step progress (and survives reloads). */
  attachWorkflowRun: (runId: string) => void;
  succeed: (message?: string) => void;
  fail: (message?: string) => void;
}

export interface ProcessStartOptions {
  message?: string;
  workflowRunId?: string | null;
  /** Stable history key for the countdown estimate; defaults to a slug of the label. */
  estimateKind?: string;
  /** How many units this run processes (files, URLs, properties) — scales the estimate. */
  estimateItems?: number;
  /** Explicit total-duration estimate in ms; pass null to disable the countdown. */
  estimatedMs?: number | null;
}

interface ProcessBannerContextValue {
  start: (label: string, options?: ProcessStartOptions) => ProcessHandle;
  entries: ProcessEntry[];
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** Hovering a banner pauses its auto-dismiss countdown. */
  markHovered: (id: string, hovered: boolean) => void;
}

const ProcessBannerContext = createContext<ProcessBannerContextValue | null>(null);

const STORAGE_KEY = "sourcing-os.process-banners.v1";
const MAX_ENTRIES = 10;
const WORKFLOW_POLL_INTERVAL_MS = 4_000;
/** A running fetch-owned entry that hasn't reported progress for this long is presumed orphaned. */
const RUNNING_STALL_MS = 30 * 60 * 1000;
/** Success banners fade out on their own; errors stay until dismissed. */
const SUCCESS_AUTO_DISMISS_MS = 10_000;

/** Finished durations per estimate kind, persisted so countdowns learn from real runs. */
const DURATION_HISTORY_KEY = "sourcing-os.process-durations.v1";
const DURATION_HISTORY_LIMIT = 8;
/** Durations outside this window are treated as noise (instant failures, abandoned tabs). */
const MIN_RECORDED_MS = 2_000;
const MAX_RECORDED_MS = 4 * 60 * 60 * 1000;

/**
 * First-run countdown seeds (ms per item) used until learned history exists for
 * a kind. Keys match the explicit `estimateKind` passed by pages or the slug of
 * the banner label; dynamic labels ("Saved-search run: Foo") hit the prefix match.
 */
const ESTIMATE_SEEDS_MS: Record<string, number> = {
  // OM / deal analysis
  "om-analysis": 75_000,
  "om-analysis-batch": 90_000,
  "om-analysis-link": 75_000,
  "om-analysis-refresh": 75_000,
  "om-financials-refresh": 75_000,
  "om-review-run": 75_000,
  "om-pdf-upload": 75_000,
  "broker-notes-analysis": 45_000,
  "analysis-refresh": 30_000,
  // market knowledge ingestion
  "market-docs-ingest": 75_000,
  "comp-package-upload": 75_000,
  // property imports
  "manual-property-import": 20_000,
  "manual-property-add": 60_000,
  "streeteasy-import": 45_000,
  "full-streeteasy-pull": 60_000,
  "saved-search-run": 180_000,
  "send-to-property-data": 180_000,
  "send-to-canonical": 20_000,
  // pipeline refreshes
  "enrichment-refresh": 20_000,
  "rental-flow-refresh": 45_000,
  // generated outputs
  "dossier-generation": 95_000,
  "dossier-rerun": 120_000,
  "excel-workbook-generation": 60_000,
  "property-creation": 45_000,
};
const FALLBACK_ESTIMATE_MS = 60_000;

function slugifyKind(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadDurationHistory(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DURATION_HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const history: Record<string, number[]> = {};
    for (const [kind, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(values)) continue;
      const numbers = values.filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
      );
      if (numbers.length > 0) history[kind] = numbers.slice(-DURATION_HISTORY_LIMIT);
    }
    return history;
  } catch {
    return {};
  }
}

function recordDuration(kind: string, perItemMs: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(perItemMs) || perItemMs < MIN_RECORDED_MS || perItemMs > MAX_RECORDED_MS) return;
  try {
    const history = loadDurationHistory();
    history[kind] = [...(history[kind] ?? []), Math.round(perItemMs)].slice(-DURATION_HISTORY_LIMIT);
    window.localStorage.setItem(DURATION_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // storage full/blocked — future countdowns just stay on seeds
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function seedEstimateMs(kind: string): number {
  const exact = ESTIMATE_SEEDS_MS[kind];
  if (exact != null) return exact;
  for (const [prefix, value] of Object.entries(ESTIMATE_SEEDS_MS)) {
    if (kind.startsWith(`${prefix}-`)) return value;
  }
  return FALLBACK_ESTIMATE_MS;
}

/** Median of learned runs for this kind (falling back to the seed table), scaled by item count. */
function estimateDurationMs(kind: string, items: number): number {
  const learned = loadDurationHistory()[kind];
  const perItem = learned && learned.length > 0 ? median(learned) : seedEstimateMs(kind);
  return Math.max(3_000, Math.round(perItem * Math.max(1, items)));
}

const INTERRUPTED_MESSAGE =
  "The page reloaded while this was running. The server usually finishes anyway — check the results (or re-run), then dismiss.";

function makeId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isProcessStatus(value: unknown): value is ProcessStatus {
  return value === "running" || value === "success" || value === "error" || value === "interrupted";
}

/** Rehydrate persisted entries; fetch-owned "running" entries become "interrupted". */
function loadPersistedEntries(): ProcessEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === "object")
      .map((entry): ProcessEntry | null => {
        const id = typeof entry.id === "string" ? entry.id : null;
        const label = typeof entry.label === "string" ? entry.label : null;
        if (!id || !label || !isProcessStatus(entry.status)) return null;
        const workflowRunId = typeof entry.workflowRunId === "string" ? entry.workflowRunId : null;
        const wasRunning = entry.status === "running";
        // Successes auto-dismiss now and history lives in the activity
        // indicator, so a pre-reload success doesn't come back as a banner.
        if (entry.status === "success") return null;
        // Pollable runs resume; fetch-owned runs lost their promise in the reload.
        const status: ProcessStatus = wasRunning && !workflowRunId ? "interrupted" : entry.status;
        return {
          id,
          label,
          message:
            status === "interrupted" && wasRunning
              ? INTERRUPTED_MESSAGE
              : typeof entry.message === "string"
                ? entry.message
                : null,
          status,
          startedAt: typeof entry.startedAt === "number" ? entry.startedAt : now,
          updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : now,
          finishedAt:
            typeof entry.finishedAt === "number"
              ? entry.finishedAt
              : status === "interrupted"
                ? now
                : null,
          workflowRunId,
          progressPct: typeof entry.progressPct === "number" ? entry.progressPct : null,
          etaMs: typeof entry.etaMs === "number" && Number.isFinite(entry.etaMs) ? entry.etaMs : null,
          estimateKind: typeof entry.estimateKind === "string" ? entry.estimateKind : null,
          estimateItems:
            typeof entry.estimateItems === "number" && entry.estimateItems >= 1
              ? Math.round(entry.estimateItems)
              : 1,
        };
      })
      .filter((entry): entry is ProcessEntry => entry != null)
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

interface WorkflowRunStepLike {
  status?: string;
  totalItems?: number;
  completedItems?: number;
  failedItems?: number;
  skippedItems?: number;
  lastMessage?: string | null;
}

interface WorkflowRunLike {
  id: string;
  status?: string;
  steps?: WorkflowRunStepLike[];
}

export function ProcessBannerProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ProcessEntry[]>([]);
  const entriesRef = useRef<ProcessEntry[]>([]);
  entriesRef.current = entries;
  const hydratedRef = useRef(false);

  // Rehydrate persisted banners once on mount (client only — no SSR markup drift).
  useEffect(() => {
    hydratedRef.current = true;
    const persisted = loadPersistedEntries();
    if (persisted.length > 0) {
      setEntries((current) => {
        const currentIds = new Set(current.map((entry) => entry.id));
        return [...persisted.filter((entry) => !currentIds.has(entry.id)), ...current].slice(-MAX_ENTRIES);
      });
    }
  }, []);

  // Persist on every change so navigation/refresh can't lose a banner.
  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // storage full/blocked — banners simply won't survive a reload
    }
  }, [entries]);

  const patchEntry = useCallback((id: string, patch: Partial<ProcessEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch, updatedAt: Date.now() } : entry))
    );
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    // Keep live (still-running) work visible; clear everything terminal.
    setEntries((current) => current.filter((entry) => entry.status === "running"));
  }, []);

  /** Feed the finished run back into the per-kind history so the next countdown is accurate. */
  const recordEntryDuration = useCallback((entry: ProcessEntry) => {
    if (!entry.estimateKind || entry.status !== "running") return;
    const elapsed = Date.now() - entry.startedAt;
    recordDuration(entry.estimateKind, elapsed / Math.max(1, entry.estimateItems));
  }, []);

  const succeedEntry = useCallback(
    (id: string, message: string | null) => {
      const entry = entriesRef.current.find((candidate) => candidate.id === id);
      if (entry) recordEntryDuration(entry);
      patchEntry(id, { status: "success", message, progressPct: 100, finishedAt: Date.now() });
    },
    [patchEntry, recordEntryDuration]
  );

  const start = useCallback<ProcessBannerContextValue["start"]>(
    (label, options) => {
      const id = makeId();
      const now = Date.now();
      const estimateKind = options?.estimateKind?.trim() || slugifyKind(label) || null;
      const estimateItems = Math.max(1, Math.round(options?.estimateItems ?? 1));
      const etaMs =
        options?.estimatedMs !== undefined
          ? options.estimatedMs
          : estimateKind
            ? estimateDurationMs(estimateKind, estimateItems)
            : null;
      const entry: ProcessEntry = {
        id,
        label,
        message: options?.message ?? null,
        status: "running",
        startedAt: now,
        updatedAt: now,
        finishedAt: null,
        workflowRunId: options?.workflowRunId ?? null,
        progressPct: null,
        etaMs,
        estimateKind,
        estimateItems,
      };
      setEntries((current) => [...current.slice(-(MAX_ENTRIES - 1)), entry]);
      return {
        id,
        update: (message, progressPct) =>
          patchEntry(id, { message, ...(progressPct !== undefined ? { progressPct } : {}) }),
        attachWorkflowRun: (runId) => patchEntry(id, { workflowRunId: runId }),
        succeed: (message) => succeedEntry(id, message ?? null),
        fail: (message) => patchEntry(id, { status: "error", message: message ?? null, finishedAt: Date.now() }),
      };
    },
    [patchEntry, succeedEntry]
  );

  // Success banners are the "it's done" alert: they linger ~10s, then fade
  // away on their own (hover pauses the countdown). Errors and interruptions
  // stay until the user dismisses them.
  const hoveredIdsRef = useRef<Set<string>>(new Set());
  const markHovered = useCallback((id: string, hovered: boolean) => {
    if (hovered) hoveredIdsRef.current.add(id);
    else hoveredIdsRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!entries.some((entry) => entry.status === "success" && entry.finishedAt != null)) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setEntries((current) =>
        current.filter(
          (entry) =>
            !(
              entry.status === "success" &&
              entry.finishedAt != null &&
              now - entry.finishedAt > SUCCESS_AUTO_DISMISS_MS &&
              !hoveredIdsRef.current.has(entry.id)
            )
        )
      );
    }, 1_000);
    return () => clearInterval(timer);
  }, [entries]);

  // Safety net: a fetch-owned entry that stopped reporting (e.g. its page
  // unmounted and the closure died) flips to "interrupted" instead of
  // spinning forever. Errors are never auto-removed — only ✕ does that.
  useEffect(() => {
    if (!entries.some((entry) => entry.status === "running" && !entry.workflowRunId)) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setEntries((current) =>
        current.map((entry) =>
          entry.status === "running" && !entry.workflowRunId && now - entry.updatedAt > RUNNING_STALL_MS
            ? {
                ...entry,
                status: "interrupted" as const,
                message: "No progress reported for 30 minutes — verify the result, then dismiss.",
                finishedAt: now,
              }
            : entry
        )
      );
    }, 60_000);
    return () => clearInterval(timer);
  }, [entries]);

  // Poll server workflow runs for entries that have one attached.
  useEffect(() => {
    const watched = entries.filter((entry) => entry.status === "running" && entry.workflowRunId);
    if (watched.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const ids = [...new Set(watched.map((entry) => entry.workflowRunId as string))];
      try {
        const response = await fetch(`${API_BASE}/api/workflow/runs?ids=${ids.map(encodeURIComponent).join(",")}`, {
          credentials: "include",
        });
        if (!response.ok || cancelled) return;
        const payload = (await response.json().catch(() => ({}))) as { runs?: WorkflowRunLike[] };
        for (const run of payload.runs ?? []) {
          const entry = entriesRef.current.find((e) => e.workflowRunId === run.id && e.status === "running");
          if (!entry) continue;
          const step = run.steps?.[0];
          const total = step?.totalItems ?? 0;
          const done = (step?.completedItems ?? 0) + (step?.failedItems ?? 0) + (step?.skippedItems ?? 0);
          const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
          const message = step?.lastMessage ?? entry.message;
          if (run.status === "completed") {
            succeedEntry(entry.id, message ?? null);
          } else if (run.status === "failed") {
            patchEntry(entry.id, { status: "error", message: message ?? "Run failed.", finishedAt: Date.now() });
          } else if (run.status === "partial") {
            succeedEntry(entry.id, message ?? "Completed with some issues.");
          } else {
            patchEntry(entry.id, { message, progressPct });
          }
        }
      } catch {
        // transient poll failure — keep the banner as-is
      }
    };
    void poll();
    const timer = setInterval(poll, WORKFLOW_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [entries, patchEntry, succeedEntry]);

  const contextValue = useMemo(
    () => ({ start, entries, dismiss: removeEntry, dismissAll, markHovered }),
    [start, entries, removeEntry, dismissAll, markHovered]
  );

  return <ProcessBannerContext.Provider value={contextValue}>{children}</ProcessBannerContext.Provider>;
}

function statusIcon(status: ProcessStatus) {
  if (status === "running") return <Loader2 size={15} strokeWidth={2.2} className={styles.spinner} />;
  if (status === "success") return <CheckCircle2 size={15} strokeWidth={2.2} />;
  if (status === "interrupted") return <Info size={15} strokeWidth={2.2} />;
  return <AlertTriangle size={15} strokeWidth={2.2} />;
}

function statusClass(status: ProcessStatus): string {
  if (status === "success") return styles.bannerSuccess;
  if (status === "error") return styles.bannerError;
  if (status === "interrupted") return styles.bannerInterrupted;
  return styles.bannerRunning;
}

function finishedStamp(entry: ProcessEntry): string | null {
  if (!entry.finishedAt) return null;
  return new Date(entry.finishedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Remaining ms for a running entry. Live step progress (when meaningful)
 * projects the real pace; otherwise the static estimate counts down.
 */
function countdownMs(entry: ProcessEntry, now: number): number | null {
  const elapsed = Math.max(0, now - entry.startedAt);
  if (entry.progressPct != null && entry.progressPct >= 8 && elapsed >= 5_000) {
    return Math.round((elapsed * 100) / entry.progressPct - elapsed);
  }
  if (entry.etaMs != null && entry.etaMs > 0) return entry.etaMs - elapsed;
  return null;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** Ticking time-to-completion chip; aria-hidden so the 1s tick doesn't spam screen readers. */
function CountdownChip({ entry, now }: { entry: ProcessEntry; now: number }) {
  const remaining = countdownMs(entry, now);
  if (remaining == null) return null;
  return (
    <span
      className={styles.eta}
      aria-hidden="true"
      title="Estimated time to completion — learned from previous runs"
    >
      <Timer size={12} strokeWidth={2.4} />
      {remaining > 1_000 ? `~${formatCountdown(remaining)} left` : "wrapping up…"}
    </span>
  );
}

/** Slim banner stack — place directly under the app topbar. */
export function ProcessBannerViewport() {
  const context = useContext(ProcessBannerContext);
  const entries = context?.entries ?? [];
  const hasRunning = entries.some((entry) => entry.status === "running");
  const [now, setNow] = useState(() => Date.now());
  // Drive the countdown while anything is running; idle banners don't tick.
  useEffect(() => {
    if (!hasRunning) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [hasRunning]);
  if (!context || entries.length === 0) return null;
  const { dismiss, dismissAll, markHovered } = context;
  const terminalCount = entries.filter((entry) => entry.status !== "running").length;
  return (
    <div className={styles.viewport} role="status" aria-live="polite">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`${styles.banner} ${statusClass(entry.status)}`}
          onMouseEnter={() => markHovered(entry.id, true)}
          onMouseLeave={() => markHovered(entry.id, false)}
        >
          <span className={styles.icon} aria-hidden="true">
            {statusIcon(entry.status)}
          </span>
          <span className={styles.label}>{entry.label}</span>
          {entry.status !== "running" && finishedStamp(entry) ? (
            <span className={styles.stamp}>
              {entry.status === "success" ? "done" : entry.status === "error" ? "failed" : "interrupted"} at{" "}
              {finishedStamp(entry)}
            </span>
          ) : null}
          {entry.message ? <span className={styles.message}>{entry.message}</span> : null}
          {entry.status === "running" ? <CountdownChip entry={entry} now={now} /> : null}
          {entry.status === "running" ? (
            entry.progressPct != null ? (
              <span className={styles.progress}>
                <span className={styles.progressTrack}>
                  <span className={styles.progressFill} style={{ width: `${entry.progressPct}%` }} />
                </span>
                <span className={styles.progressPct}>{entry.progressPct}%</span>
              </span>
            ) : (
              <span className={styles.progress}>
                <span className={`${styles.progressTrack} ${styles.progressIndeterminate}`}>
                  <span className={styles.progressShimmer} />
                </span>
              </span>
            )
          ) : null}
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismiss(entry.id)}
            aria-label={`Dismiss ${entry.label} notification`}
            title={entry.status === "running" ? "Hide — the process keeps running" : "Dismiss"}
          >
            <X size={13} strokeWidth={2.4} />
          </button>
        </div>
      ))}
      {terminalCount >= 3 ? (
        <div className={styles.clearAllRow}>
          <button type="button" className={styles.clearAll} onClick={dismissAll}>
            Clear {terminalCount} finished
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** No-op fallback so pages work even if the provider is missing (e.g. tests). */
const NOOP_HANDLE: ProcessHandle = {
  id: "noop",
  update: () => {},
  attachWorkflowRun: () => {},
  succeed: () => {},
  fail: () => {},
};

const NOOP_BANNER: Pick<ProcessBannerContextValue, "start"> = { start: () => NOOP_HANDLE };
const NOOP_ENTRIES: Pick<ProcessBannerContextValue, "entries" | "dismiss"> = {
  entries: [],
  dismiss: () => {},
};

export function useProcessBanner(): Pick<ProcessBannerContextValue, "start"> {
  const context = useContext(ProcessBannerContext);
  return context ?? NOOP_BANNER;
}

/** Read access to the live entries (e.g. the topbar activity indicator). */
export function useProcessEntries(): Pick<ProcessBannerContextValue, "entries" | "dismiss"> {
  const context = useContext(ProcessBannerContext);
  return context ?? NOOP_ENTRIES;
}
