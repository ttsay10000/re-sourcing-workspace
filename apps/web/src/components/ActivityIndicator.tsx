"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { AnchoredPopover } from "@/components/ui";
import { useProcessEntries, type ProcessStatus } from "./ProcessBanner";
import { API_BASE } from "@/lib/api";
import styles from "./ActivityIndicator.module.css";

interface WorkflowRunStep {
  label?: string;
  status?: string;
  totalItems?: number;
  completedItems?: number;
  failedItems?: number;
  skippedItems?: number;
  lastMessage?: string | null;
}

interface WorkflowRun {
  id: string;
  runNumber?: number;
  displayName?: string;
  scopeLabel?: string | null;
  status?: string;
  startedAt?: string;
  finishedAt?: string | null;
  steps?: WorkflowRunStep[];
}

const RECENT_POLL_MS = 5_000;

function entryIcon(status: ProcessStatus) {
  if (status === "running") return <Loader2 size={13} strokeWidth={2.2} className={styles.spin} />;
  if (status === "success") return <CheckCircle2 size={13} strokeWidth={2.2} className={styles.okIcon} />;
  if (status === "interrupted") return <Info size={13} strokeWidth={2.2} className={styles.infoIcon} />;
  return <AlertTriangle size={13} strokeWidth={2.2} className={styles.errIcon} />;
}

function runIcon(status: string | undefined) {
  if (status === "completed") return <CheckCircle2 size={13} strokeWidth={2.2} className={styles.okIcon} />;
  if (status === "failed") return <AlertTriangle size={13} strokeWidth={2.2} className={styles.errIcon} />;
  if (status === "partial") return <Info size={13} strokeWidth={2.2} className={styles.infoIcon} />;
  return <Loader2 size={13} strokeWidth={2.2} className={styles.spin} />;
}

function runProgress(run: WorkflowRun): string | null {
  const step = run.steps?.[0];
  if (!step) return null;
  const total = step.totalItems ?? 0;
  if (total <= 0) return null;
  const done = (step.completedItems ?? 0) + (step.failedItems ?? 0) + (step.skippedItems ?? 0);
  return `${done}/${total}`;
}

function timeStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Topbar status hub: a pulsing dot while anything is running, with an
 * anchored panel listing live client processes and the recent server
 * workflow runs — so "what is the app doing right now?" is one click
 * away from every page.
 */
export function ActivityIndicator() {
  const { entries, dismiss } = useProcessEntries();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [recent, setRecent] = useState<WorkflowRun[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const open = anchorEl != null;
  const runningCount = entries.filter((entry) => entry.status === "running").length;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/workflow/runs?limit=20`, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json().catch(() => ({}))) as { runs?: WorkflowRun[] };
        if (cancelled) return;
        setRecent(payload.runs ?? []);
        setRecentError(null);
      } catch {
        if (!cancelled) setRecentError("Couldn't load recent runs.");
      }
    };
    void load();
    const timer = setInterval(load, RECENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`${styles.trigger} ${runningCount > 0 ? styles.triggerActive : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={runningCount > 0 ? `${runningCount} task${runningCount === 1 ? "" : "s"} running` : "Activity"}
        onClick={(event) => {
          const target = event.currentTarget;
          setAnchorEl((current) => (current ? null : target));
        }}
      >
        <Activity size={16} strokeWidth={1.9} aria-hidden="true" />
        {runningCount > 0 ? (
          <>
            <span className={styles.pulseDot} aria-hidden="true" />
            <span className={styles.count}>{runningCount}</span>
          </>
        ) : null}
        <span className={styles.srOnly}>Activity</span>
      </button>
      <AnchoredPopover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        placement="bottom-end"
        role="dialog"
        ariaLabel="Activity"
        className={styles.panel}
      >
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Now running</span>
          {entries.length === 0 ? (
            <p className={styles.empty}>Nothing is running right now.</p>
          ) : (
            <ul className={styles.list}>
              {entries.map((entry) => (
                <li key={entry.id} className={styles.item}>
                  <span className={styles.itemIcon} aria-hidden="true">
                    {entryIcon(entry.status)}
                  </span>
                  <span className={styles.itemBody}>
                    <span className={styles.itemLabel}>{entry.label}</span>
                    {entry.message ? <span className={styles.itemMessage}>{entry.message}</span> : null}
                    {entry.status === "running" && entry.progressPct != null ? (
                      <span className={styles.itemTrack}>
                        <span className={styles.itemFill} style={{ width: `${entry.progressPct}%` }} />
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className={styles.itemDismiss}
                    data-popover-close
                    aria-label={`Dismiss ${entry.label}`}
                    title={entry.status === "running" ? "Hide — the process keeps running" : "Dismiss"}
                    onClick={() => dismiss(entry.id)}
                  >
                    <X size={12} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Recent runs</span>
          {recentError ? <p className={styles.empty}>{recentError}</p> : null}
          {!recentError && recent == null ? <p className={styles.empty}>Loading…</p> : null}
          {!recentError && recent != null && recent.length === 0 ? (
            <p className={styles.empty}>No workflow runs recorded yet.</p>
          ) : null}
          {!recentError && recent != null && recent.length > 0 ? (
            <ul className={styles.list}>
              {recent.map((run) => {
                const progress = runProgress(run);
                const stamp = timeStamp(run.finishedAt) ?? timeStamp(run.startedAt);
                return (
                  <li key={run.id} className={styles.item}>
                    <span className={styles.itemIcon} aria-hidden="true">
                      {runIcon(run.status)}
                    </span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemLabel}>{run.displayName ?? "Workflow run"}</span>
                      <span className={styles.itemMessage}>
                        {[run.scopeLabel, progress, stamp].filter(Boolean).join(" · ") || run.status}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </AnchoredPopover>
    </>
  );
}
