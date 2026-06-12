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
import { Loader2, X, CheckCircle2, AlertTriangle, Info } from "lucide-react";
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

interface ProcessBannerContextValue {
  start: (label: string, options?: { message?: string; workflowRunId?: string | null }) => ProcessHandle;
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

  const start = useCallback<ProcessBannerContextValue["start"]>(
    (label, options) => {
      const id = makeId();
      const now = Date.now();
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
      };
      setEntries((current) => [...current.slice(-(MAX_ENTRIES - 1)), entry]);
      return {
        id,
        update: (message, progressPct) =>
          patchEntry(id, { message, ...(progressPct !== undefined ? { progressPct } : {}) }),
        attachWorkflowRun: (runId) => patchEntry(id, { workflowRunId: runId }),
        succeed: (message) =>
          patchEntry(id, { status: "success", message: message ?? null, progressPct: 100, finishedAt: Date.now() }),
        fail: (message) => patchEntry(id, { status: "error", message: message ?? null, finishedAt: Date.now() }),
      };
    },
    [patchEntry]
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
            patchEntry(entry.id, { status: "success", message, progressPct: 100, finishedAt: Date.now() });
          } else if (run.status === "failed") {
            patchEntry(entry.id, { status: "error", message: message ?? "Run failed.", finishedAt: Date.now() });
          } else if (run.status === "partial") {
            patchEntry(entry.id, {
              status: "success",
              message: message ?? "Completed with some issues.",
              finishedAt: Date.now(),
            });
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
  }, [entries, patchEntry]);

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

/** Slim banner stack — place directly under the app topbar. */
export function ProcessBannerViewport() {
  const context = useContext(ProcessBannerContext);
  if (!context || context.entries.length === 0) return null;
  const { entries, dismiss, dismissAll, markHovered } = context;
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

export function useProcessBanner(): Pick<ProcessBannerContextValue, "start"> {
  const context = useContext(ProcessBannerContext);
  return context ?? { start: () => NOOP_HANDLE };
}

/** Read access to the live entries (e.g. the topbar activity indicator). */
export function useProcessEntries(): Pick<ProcessBannerContextValue, "entries" | "dismiss"> {
  const context = useContext(ProcessBannerContext);
  return context ?? { entries: [], dismiss: () => {} };
}
