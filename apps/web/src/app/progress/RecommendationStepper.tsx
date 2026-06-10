"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import styles from "./progress.module.css";

export type StepperKind = "missing_broker_email" | "request_oms" | "om_request_stale";

export type StepperRow = {
  propertyId: string;
  address: string;
  brokerName: string | null;
  brokerEmail: string | null;
};

type ComposerDraft = { toAddress: string; subject: string; body: string };

type StepState = {
  index: number;
  completed: number;
  skipped: number;
  /** broker fields (missing_broker_email) */
  name: string;
  email: string;
  /** composer fields (request_oms) */
  draft: ComposerDraft;
  loading: boolean;
  saving: boolean;
  error: string | null;
  finished: boolean;
};

const INITIAL_DRAFT: ComposerDraft = { toAddress: "", subject: "", body: "" };

/**
 * Walks the properties behind a "What to do next" chip one at a time —
 * add broker emails or queue OM requests without leaving the board.
 * Calls onClose(didWork) once; the parent refreshes the board after.
 */
export function RecommendationStepper({
  kind,
  rows,
  onClose,
}: {
  kind: StepperKind;
  rows: StepperRow[];
  onClose: (didWork: boolean) => void;
}) {
  const [step, setStep] = useState<StepState>({
    index: 0,
    completed: 0,
    skipped: 0,
    name: "",
    email: "",
    draft: INITIAL_DRAFT,
    loading: false,
    saving: false,
    error: null,
    finished: rows.length === 0,
  });

  const current = rows[step.index] ?? null;
  const didWork = step.completed > 0;

  const loadStep = useCallback(
    async (row: StepperRow) => {
      if (kind === "missing_broker_email") {
        setStep((state) => ({ ...state, name: row.brokerName ?? "", email: row.brokerEmail ?? "", error: null }));
        return;
      }
      setStep((state) => ({ ...state, loading: true, draft: INITIAL_DRAFT, error: null }));
      try {
        const response = await apiFetch<{ composer?: { to?: string | null; subject?: string | null; body?: string | null; broker?: { email?: string | null } | null } }>(
          `/api/ui-v2/properties/${encodeURIComponent(row.propertyId)}/outreach-composer`
        );
        const composer = response.composer ?? {};
        setStep((state) => ({
          ...state,
          loading: false,
          draft: {
            toAddress: row.brokerEmail ?? composer.broker?.email ?? composer.to ?? "",
            subject: composer.subject ?? "",
            body: composer.body ?? "",
          },
        }));
      } catch (err) {
        setStep((state) => ({
          ...state,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load the email draft.",
        }));
      }
    },
    [kind]
  );

  useEffect(() => {
    if (current) void loadStep(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per step
  }, [step.index, current?.propertyId]);

  function advance(patch: Partial<Pick<StepState, "completed" | "skipped">>) {
    setStep((state) => {
      const nextIndex = state.index + 1;
      return {
        ...state,
        ...{
          completed: state.completed + (patch.completed ?? 0),
          skipped: state.skipped + (patch.skipped ?? 0),
        },
        index: nextIndex,
        saving: false,
        error: null,
        finished: nextIndex >= rows.length,
      };
    });
  }

  async function saveAndNext() {
    if (!current || step.saving) return;
    setStep((state) => ({ ...state, saving: true, error: null }));
    try {
      if (kind === "missing_broker_email") {
        await apiFetch(`/api/ui-v2/properties/${encodeURIComponent(current.propertyId)}/broker`, {
          method: "PUT",
          body: JSON.stringify({
            email: step.email.trim(),
            name: step.name.trim() || null,
            actorName: "progress_stepper",
          }),
        });
      } else {
        await apiFetch(`/api/ui-v2/outreach-drafts`, {
          method: "POST",
          body: JSON.stringify({
            propertyId: current.propertyId,
            toAddress: step.draft.toAddress,
            subject: step.draft.subject,
            body: step.draft.body,
          }),
        });
      }
      advance({ completed: 1 });
    } catch (err) {
      setStep((state) => ({
        ...state,
        saving: false,
        error: err instanceof Error ? err.message : "Failed to save this step.",
      }));
    }
  }

  const canSave =
    kind === "missing_broker_email"
      ? step.email.trim().length > 3
      : Boolean(step.draft.toAddress.trim() && step.draft.subject.trim() && step.draft.body.trim());

  const title =
    kind === "missing_broker_email" ? "Add broker emails" : kind === "om_request_stale" ? "Send follow-ups" : "Request OMs";

  return (
    <Dialog
      open
      onClose={() => onClose(didWork)}
      title={title}
      description={
        step.finished
          ? `Done — ${step.completed} saved, ${step.skipped} skipped.`
          : `${step.index + 1} of ${rows.length} · ${current?.address ?? ""}`
      }
      size={kind === "missing_broker_email" ? "sm" : "lg"}
      footer={
        step.finished ? (
          <Button variant="primary" size="sm" onClick={() => onClose(didWork)}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => onClose(didWork)} disabled={step.saving}>
              Stop here
            </Button>
            <Button variant="ghost" size="sm" onClick={() => advance({ skipped: 1 })} disabled={step.saving}>
              Skip
            </Button>
            <Button variant="primary" size="sm" onClick={() => void saveAndNext()} disabled={!canSave || step.saving || step.loading}>
              {step.saving ? "Saving…" : kind === "missing_broker_email" ? "Save & next" : "Queue & next"}
            </Button>
          </>
        )
      }
    >
      {step.finished ? (
        <p className={styles.dialogHint}>
          {didWork
            ? "The board will refresh with the new state when you close this."
            : "Nothing changed."}
        </p>
      ) : step.loading ? (
        <p className={styles.dialogHint}>Preparing…</p>
      ) : (
        <div className={styles.dialogForm}>
          {step.error ? <p className={styles.dialogWarning}>{step.error}</p> : null}
          {kind === "missing_broker_email" ? (
            <>
              <label className={styles.dialogField}>
                <span>Broker name</span>
                <input
                  type="text"
                  value={step.name}
                  placeholder="Optional"
                  onChange={(event) => setStep((state) => ({ ...state, name: event.target.value }))}
                />
              </label>
              <label className={styles.dialogField}>
                <span>Broker email</span>
                <input
                  type="email"
                  value={step.email}
                  placeholder="broker@firm.com"
                  autoFocus
                  onChange={(event) => setStep((state) => ({ ...state, email: event.target.value }))}
                />
              </label>
            </>
          ) : (
            <>
              <label className={styles.dialogField}>
                <span>To</span>
                <input
                  type="email"
                  value={step.draft.toAddress}
                  onChange={(event) => setStep((state) => ({ ...state, draft: { ...state.draft, toAddress: event.target.value } }))}
                />
              </label>
              <label className={styles.dialogField}>
                <span>Subject</span>
                <input
                  type="text"
                  value={step.draft.subject}
                  onChange={(event) => setStep((state) => ({ ...state, draft: { ...state.draft, subject: event.target.value } }))}
                />
              </label>
              <label className={styles.dialogField}>
                <span>Message</span>
                <textarea
                  rows={8}
                  value={step.draft.body}
                  onChange={(event) => setStep((state) => ({ ...state, draft: { ...state.draft, body: event.target.value } }))}
                />
              </label>
              <p className={styles.dialogHint}>
                Queued emails go through the outreach review queue; each deal moves to OM Requested automatically.
              </p>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
