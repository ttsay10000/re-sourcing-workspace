"use client";

/**
 * Global long-running-process banner.
 *
 * Pages register a process via useProcessBanner().start(label) and the banner
 * renders across the top of the workspace (under the topbar) until the process
 * finishes or the user dismisses it with ✕. Dismissing only hides the banner —
 * the underlying request keeps running. Handles live on the provider, so a
 * process started from a page keeps reporting even if the user navigates away.
 *
 * Entries with a workflowRunId are polled against GET /api/workflow/runs?ids=
 * so server-side step progress (e.g. inbox processing) streams into the label.
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
import { Loader2, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/api";
import styles from "./ProcessBanner.module.css";

export type ProcessStatus = "running" | "success" | "error";

export interface ProcessEntry {
  id: string;
  label: string;
  message: string | null;
  status: ProcessStatus;
  startedAt: number;
  workflowRunId: string | null;
  /** 0-100 when a step total is known, otherwise null (indeterminate). */
  progressPct: number | null;
}

export interface ProcessHandle {
  id: string;
  /** Update the live message (and optional 0-100 progress) while running. */
  update: (message: string, progressPct?: number | null) => void;
  /** Attach a server workflow run so the banner polls step progress. */
  attachWorkflowRun: (runId: string) => void;
  succeed: (message?: string) => void;
  fail: (message?: string) => void;
}

interface ProcessBannerContextValue {
  start: (label: string, options?: { message?: string; workflowRunId?: string | null }) => ProcessHandle;
}

const ProcessBannerContext = createContext<ProcessBannerContextValue | null>(null);

const SUCCESS_AUTO_DISMISS_MS = 6_000;
const STALE_RUNNING_EXPIRE_MS = 30 * 60 * 1000;
const WORKFLOW_POLL_INTERVAL_MS = 4_000;

function makeId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  const patchEntry = useCallback((id: string, patch: Partial<ProcessEntry>) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const start = useCallback<ProcessBannerContextValue["start"]>(
    (label, options) => {
      const id = makeId();
      const entry: ProcessEntry = {
        id,
        label,
        message: options?.message ?? null,
        status: "running",
        startedAt: Date.now(),
        workflowRunId: options?.workflowRunId ?? null,
        progressPct: null,
      };
      // Keep at most 4 banners; oldest drop off first.
      setEntries((current) => [...current.slice(-3), entry]);
      return {
        id,
        update: (message, progressPct) =>
          patchEntry(id, { message, ...(progressPct !== undefined ? { progressPct } : {}) }),
        attachWorkflowRun: (runId) => patchEntry(id, { workflowRunId: runId }),
        succeed: (message) => patchEntry(id, { status: "success", message: message ?? null, progressPct: 100 }),
        fail: (message) => patchEntry(id, { status: "error", message: message ?? null }),
      };
    },
    [patchEntry]
  );

  // Track when an entry flipped to success so auto-dismiss is relative to completion.
  const successAtRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    for (const entry of entries) {
      if (entry.status === "success" && !successAtRef.current.has(entry.id)) {
        successAtRef.current.set(entry.id, Date.now());
      }
    }
    for (const id of [...successAtRef.current.keys()]) {
      if (!entries.some((entry) => entry.id === id)) successAtRef.current.delete(id);
    }
  }, [entries]);

  // Auto-dismiss successes after a few seconds; expire stale running entries.
  useEffect(() => {
    if (entries.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setEntries((current) =>
        current.filter((entry) => {
          if (entry.status === "error") return true; // errors persist until dismissed
          if (entry.status === "success") {
            const completedAt = successAtRef.current.get(entry.id) ?? now;
            return now - completedAt < SUCCESS_AUTO_DISMISS_MS;
          }
          return now - entry.startedAt < STALE_RUNNING_EXPIRE_MS;
        })
      );
    }, 2_000);
    return () => clearInterval(timer);
  }, [entries.length]);

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
            patchEntry(entry.id, { status: "success", message, progressPct: 100 });
          } else if (run.status === "failed") {
            patchEntry(entry.id, { status: "error", message: message ?? "Run failed." });
          } else if (run.status === "partial") {
            patchEntry(entry.id, { status: "success", message: message ?? "Completed with some issues." });
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

  const contextValue = useMemo(() => ({ start }), [start]);

  return (
    <ProcessBannerContext.Provider value={contextValue}>
      {entries.length > 0 ? (
        <div className={styles.viewport} role="status" aria-live="polite">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`${styles.banner} ${
                entry.status === "success" ? styles.bannerSuccess : entry.status === "error" ? styles.bannerError : styles.bannerRunning
              }`}
            >
              <span className={styles.icon} aria-hidden="true">
                {entry.status === "running" ? (
                  <Loader2 size={15} strokeWidth={2.2} className={styles.spinner} />
                ) : entry.status === "success" ? (
                  <CheckCircle2 size={15} strokeWidth={2.2} />
                ) : (
                  <AlertTriangle size={15} strokeWidth={2.2} />
                )}
              </span>
              <span className={styles.label}>{entry.label}</span>
              {entry.message ? <span className={styles.message}>{entry.message}</span> : null}
              {entry.status === "running" && entry.progressPct != null ? (
                <span className={styles.progress}>
                  <span className={styles.progressTrack}>
                    <span className={styles.progressFill} style={{ width: `${entry.progressPct}%` }} />
                  </span>
                  <span className={styles.progressPct}>{entry.progressPct}%</span>
                </span>
              ) : null}
              <button
                type="button"
                className={styles.dismiss}
                onClick={() => removeEntry(entry.id)}
                aria-label={`Dismiss ${entry.label} notification`}
                title={entry.status === "running" ? "Hide — the process keeps running" : "Dismiss"}
              >
                <X size={13} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {children}
    </ProcessBannerContext.Provider>
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

export function useProcessBanner(): ProcessBannerContextValue {
  const context = useContext(ProcessBannerContext);
  return context ?? { start: () => NOOP_HANDLE };
}
