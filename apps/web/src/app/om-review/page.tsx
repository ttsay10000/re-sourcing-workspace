"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Dialog, EmptyState, PageHeader, SkeletonRows } from "@/components/ui";
import { API_BASE, apiFetch } from "@/lib/api";
import { EMPTY_VALUE, formatCurrencyExact, formatDateShort, formatNumber } from "@/lib/format";
import styles from "./omReview.module.css";

interface ReviewAttachmentCandidate {
  id?: string | null;
  filename?: string | null;
  category?: string | null;
  classificationLabel?: string | null;
  classificationConfidence?: string | null;
  reviewRole?: string | null;
}

interface ReviewQueueItem {
  id: string;
  propertyId: string;
  canonicalAddress: string;
  priority: string;
  summary?: string | null;
  details: {
    subject?: string | null;
    fromAddress?: string | null;
    matchedBatchIds?: string[];
    attachmentCandidates?: ReviewAttachmentCandidate[];
  };
  createdAt: string;
}

interface ReviewQueueGroup {
  groupKey: string;
  isAmbiguous: boolean;
  items: ReviewQueueItem[];
}

interface ExtractionRunFlag {
  field: string | null;
  severity: string;
  message: string;
}

interface ExtractionRun {
  runId: string;
  propertyId: string;
  address: string;
  status: string;
  sourceType: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  hasSnapshot: boolean;
  fields: {
    askingPrice: number | null;
    totalUnits: number | null;
    noi: number | null;
    grossRentalIncome: number | null;
    operatingExpenses: number | null;
    rentRollCount: number;
  };
  validationFlags: ExtractionRunFlag[];
}

type PromoteDialogState = {
  run: ExtractionRun;
  askingPrice: string;
  totalUnits: string;
  noi: string;
  grossRentalIncome: string;
  operatingExpenses: string;
  note: string;
  saving: boolean;
};

type RejectDialogState = { run: ExtractionRun; reason: string; saving: boolean };

const TEAR_SHEET_FIELDS = [
  { key: "askingPrice", label: "Asking price", kind: "currency" },
  { key: "totalUnits", label: "Units", kind: "number" },
  { key: "noi", label: "NOI", kind: "currency" },
  { key: "grossRentalIncome", label: "Gross rental income", kind: "currency" },
  { key: "operatingExpenses", label: "Operating expenses", kind: "currency" },
] as const;

function runStatusTone(status: string) {
  if (status === "failed") return "danger" as const;
  if (status === "needs_review") return "warning" as const;
  if (status === "promoted") return "success" as const;
  return "neutral" as const;
}

function fieldFlag(run: ExtractionRun, field: string): ExtractionRunFlag | null {
  return run.validationFlags.find((flag) => flag.field === field && flag.severity !== "info") ?? null;
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.replace(/[$,\s]/g, "");
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function attachmentLabel(candidate: ReviewAttachmentCandidate): string {
  const category = candidate.category ?? candidate.classificationLabel ?? "Document";
  const confidence = candidate.classificationConfidence ? `, ${candidate.classificationConfidence}` : "";
  const role = candidate.reviewRole === "supporting" ? ", supporting" : "";
  return `${category}${confidence}${role}`;
}

function priorityTone(priority: string) {
  if (priority === "high") return "warning" as const;
  if (priority === "urgent") return "danger" as const;
  return "neutral" as const;
}

export default function OmReviewPage() {
  const [groups, setGroups] = useState<ReviewQueueGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [promoteState, setPromoteState] = useState<PromoteDialogState | null>(null);
  const [rejectState, setRejectState] = useState<RejectDialogState | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await apiFetch<{ runs?: ExtractionRun[] }>(`/api/om-review/extraction-runs?statuses=needs_review,failed`);
      setRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load extraction runs");
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const openPromote = (run: ExtractionRun) => {
    setPromoteState({
      run,
      askingPrice: run.fields.askingPrice != null ? String(run.fields.askingPrice) : "",
      totalUnits: run.fields.totalUnits != null ? String(run.fields.totalUnits) : "",
      noi: run.fields.noi != null ? String(run.fields.noi) : "",
      grossRentalIncome: run.fields.grossRentalIncome != null ? String(run.fields.grossRentalIncome) : "",
      operatingExpenses: run.fields.operatingExpenses != null ? String(run.fields.operatingExpenses) : "",
      note: "",
      saving: false,
    });
  };

  const submitPromote = async () => {
    if (!promoteState || promoteState.saving) return;
    const { run } = promoteState;
    const corrections: Record<string, number> = {};
    const maybe = (key: keyof ExtractionRun["fields"], raw: string) => {
      const next = numberOrUndefined(raw);
      const original = run.fields[key];
      if (next != null && next !== original) corrections[key] = next;
    };
    maybe("askingPrice", promoteState.askingPrice);
    maybe("totalUnits", promoteState.totalUnits);
    maybe("noi", promoteState.noi);
    maybe("grossRentalIncome", promoteState.grossRentalIncome);
    maybe("operatingExpenses", promoteState.operatingExpenses);

    setPromoteState({ ...promoteState, saving: true });
    setError(null);
    try {
      await apiFetch(
        `/api/properties/${encodeURIComponent(run.propertyId)}/om-review-runs/${encodeURIComponent(run.runId)}/promote`,
        {
          method: "POST",
          body: JSON.stringify({
            corrections: Object.keys(corrections).length > 0 ? corrections : undefined,
            note: promoteState.note.trim() || undefined,
          }),
        }
      );
      setPromoteState(null);
      setNotice(
        Object.keys(corrections).length > 0
          ? `Promoted ${run.address} with ${Object.keys(corrections).length} correction${Object.keys(corrections).length === 1 ? "" : "s"}.`
          : `Promoted ${run.address}.`
      );
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote the extraction.");
      setPromoteState((current) => (current ? { ...current, saving: false } : current));
    }
  };

  const submitReject = async () => {
    if (!rejectState || rejectState.saving) return;
    setRejectState({ ...rejectState, saving: true });
    setError(null);
    try {
      await apiFetch(
        `/api/properties/${encodeURIComponent(rejectState.run.propertyId)}/om-review-runs/${encodeURIComponent(rejectState.run.runId)}/reject`,
        { method: "POST", body: JSON.stringify({ reason: rejectState.reason.trim() || undefined }) }
      );
      setRejectState(null);
      setNotice(`Rejected the extraction for ${rejectState.run.address}.`);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject the extraction.");
      setRejectState((current) => (current ? { ...current, saving: false } : current));
    }
  };

  const retryRun = async (run: ExtractionRun) => {
    setBusyRunId(run.runId);
    setError(null);
    try {
      await apiFetch(`/api/properties/${encodeURIComponent(run.propertyId)}/refresh-om-financials`, {
        method: "POST",
        body: JSON.stringify({ autoPromote: false }),
      });
      setNotice(`Re-extraction queued for ${run.address} — it will reappear here when ready.`);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue the re-extraction.");
    } finally {
      setBusyRunId(null);
    }
  };

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/om-attachment-review-queue`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load review queue");
      setGroups(data.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const createReviewRun = async (item: ReviewQueueItem) => {
    setRunningActionId(item.id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/properties/${encodeURIComponent(item.propertyId)}/action-items/${encodeURIComponent(item.id)}/create-om-review-run`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
      );
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.details || "Failed to create review run");
      setNotice(`Review run created for ${item.canonicalAddress}.`);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create review run");
    } finally {
      setRunningActionId(null);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Broker OM"
        title="Review Queue"
        subtitle="Tear sheets for extracted OMs awaiting review, plus broker email attachments to triage. Edit numbers before promoting; rejected and failed runs can be retried."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void loadQueue();
                void loadRuns();
              }}
            >
              Refresh
            </Button>
            <Link href="/property-data">
              <Button variant="secondary" size="sm">Property Data</Button>
            </Link>
            <Link href="/broker-om/email-search">
              <Button variant="secondary" size="sm">Manual Gmail Pull</Button>
            </Link>
          </>
        }
      />

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionHeadingCopy}>
            <h2>OM extraction runs</h2>
            <p>Extractions awaiting your review. Check the numbers, correct anything wrong, then promote.</p>
          </div>
        </div>

        {runsLoading ? (
          <SkeletonRows count={3} />
        ) : runs.length === 0 ? (
          <EmptyState title="No extractions waiting" description="New OM uploads and re-runs land here when they need review." />
        ) : (
          <div className={styles.runList}>
            {runs.map((run) => (
              <article key={run.runId} className={styles.runCard}>
                <div className={styles.runHeader}>
                  <div className={styles.runHeading}>
                    <h3>{run.address}</h3>
                    <p>
                      {run.sourceType ? `${run.sourceType} · ` : ""}
                      Started {formatDateShort(run.startedAt)}
                    </p>
                  </div>
                  <Badge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, " ")}</Badge>
                </div>

                {run.status === "failed" && run.lastError ? (
                  <p className={styles.runError}>{run.lastError}</p>
                ) : null}

                {run.hasSnapshot ? (
                  <div className={styles.runFields}>
                    {TEAR_SHEET_FIELDS.map((field) => {
                      const value = run.fields[field.key];
                      const flag = fieldFlag(run, field.key);
                      return (
                        <div key={field.key} className={flag ? styles.runFieldFlagged : styles.runField} title={flag?.message}>
                          <span>{field.label}</span>
                          <strong>
                            {value == null
                              ? EMPTY_VALUE
                              : field.kind === "currency"
                                ? formatCurrencyExact(value)
                                : formatNumber(value)}
                          </strong>
                        </div>
                      );
                    })}
                    <div className={run.fields.rentRollCount === 0 ? styles.runFieldFlagged : styles.runField}>
                      <span>Rent roll rows</span>
                      <strong>{run.fields.rentRollCount}</strong>
                    </div>
                  </div>
                ) : (
                  <p className={styles.runError}>No extracted snapshot is attached to this run.</p>
                )}

                <div className={styles.itemActions}>
                  {run.status === "needs_review" && run.hasSnapshot ? (
                    <Button variant="primary" size="sm" onClick={() => openPromote(run)} disabled={busyRunId === run.runId}>
                      Review &amp; promote
                    </Button>
                  ) : null}
                  {run.status === "failed" ? (
                    <Button variant="secondary" size="sm" onClick={() => void retryRun(run)} disabled={busyRunId === run.runId}>
                      {busyRunId === run.runId ? "Queueing…" : "Retry extraction"}
                    </Button>
                  ) : null}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setRejectState({ run, reason: "", saving: false })}
                    disabled={busyRunId === run.runId}
                  >
                    Reject
                  </Button>
                  <Link href={`/pipeline?propertyId=${encodeURIComponent(run.propertyId)}`}>
                    <Button variant="ghost" size="sm">Open property</Button>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionHeadingCopy}>
            <h2>Broker attachments</h2>
            <p>Each action creates a needs-review extraction run only. Promotion remains separate.</p>
          </div>
        </div>

        {loading ? (
          <SkeletonRows count={4} />
        ) : groups.length === 0 ? (
          <EmptyState
            title="Queue is clear"
            description="No broker attachment review actions are open."
          />
        ) : (
          <div className={styles.groupList}>
            {groups.map((group) => (
              <section key={group.groupKey} className={styles.group}>
                <div className={styles.groupHeader}>
                  <div>
                    <h3>{group.isAmbiguous ? "Batch review" : "Single-property review"}</h3>
                    <p>{group.items.length} propert{group.items.length === 1 ? "y" : "ies"} linked to this broker reply.</p>
                  </div>
                  {group.isAmbiguous && <Badge tone="warning">Ambiguous</Badge>}
                </div>
                <div className={styles.groupItems}>
                  {group.items.map((item) => {
                    const attachments = item.details.attachmentCandidates ?? [];
                    return (
                      <article key={item.id} className={styles.item}>
                        <div className={styles.itemMain}>
                          <h4 className={styles.itemAddress}>{item.canonicalAddress}</h4>
                          <p className={styles.itemSummary}>
                            {item.summary ?? "Create document review run"}
                          </p>
                          <p className={styles.itemMeta}>
                            {item.details.fromAddress ?? "Unknown sender"}
                            {item.details.subject ? ` | ${item.details.subject}` : ""}
                          </p>
                          {attachments.length > 0 && (
                            <div className={styles.attachmentList}>
                              {attachments.map((attachment, index) => (
                                <div key={`${attachment.id ?? attachment.filename ?? index}`} className={styles.attachment}>
                                  <span className={styles.attachmentName}>{attachment.filename ?? "Attachment"}</span>
                                  <Badge tone={priorityTone(item.priority)}>{attachmentLabel(attachment)}</Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className={styles.itemActions}>
                          <Link href={`/property-data?expand=${item.propertyId}`}>
                            <Button variant="secondary" size="sm">View property</Button>
                          </Link>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void createReviewRun(item)}
                            disabled={runningActionId === item.id}
                          >
                            {runningActionId === item.id ? "Creating…" : "Create review run"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={promoteState != null}
        onClose={() => setPromoteState(null)}
        title="Review & promote extraction"
        description={promoteState ? promoteState.run.address : undefined}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPromoteState(null)} disabled={promoteState?.saving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submitPromote()} disabled={promoteState == null || promoteState.saving}>
              {promoteState?.saving ? "Promoting…" : "Promote"}
            </Button>
          </>
        }
      >
        {promoteState ? (
          <div className={styles.promoteForm}>
            <p className={styles.promoteHint}>
              Edits below are recorded as review corrections on the promoted snapshot. Leave a field as-is to keep the
              extracted value.
            </p>
            {(
              [
                ["askingPrice", "Asking price"],
                ["totalUnits", "Units"],
                ["noi", "NOI"],
                ["grossRentalIncome", "Gross rental income"],
                ["operatingExpenses", "Operating expenses"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className={styles.promoteField}>
                <span>{label}</span>
                <input
                  inputMode="decimal"
                  value={promoteState[key]}
                  placeholder={EMPTY_VALUE}
                  onChange={(event) =>
                    setPromoteState((current) => (current ? { ...current, [key]: event.target.value } : current))
                  }
                />
              </label>
            ))}
            <label className={styles.promoteField}>
              <span>Correction note (optional)</span>
              <input
                type="text"
                value={promoteState.note}
                placeholder="e.g. NOI per broker email 6/9"
                onChange={(event) => setPromoteState((current) => (current ? { ...current, note: event.target.value } : current))}
              />
            </label>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={rejectState != null}
        onClose={() => setRejectState(null)}
        title="Reject extraction"
        description={rejectState?.run.address}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRejectState(null)} disabled={rejectState?.saving}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void submitReject()} disabled={rejectState == null || rejectState.saving}>
              {rejectState?.saving ? "Rejecting…" : "Reject run"}
            </Button>
          </>
        }
      >
        {rejectState ? (
          <label className={styles.promoteField}>
            <span>Reason (optional)</span>
            <input
              type="text"
              value={rejectState.reason}
              placeholder="e.g. wrong property, unreadable scan"
              autoFocus
              onChange={(event) => setRejectState((current) => (current ? { ...current, reason: event.target.value } : current))}
            />
          </label>
        ) : null}
      </Dialog>
    </div>
  );
}
