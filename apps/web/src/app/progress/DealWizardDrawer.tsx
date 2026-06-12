"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Circle,
  Flag,
  Mail,
  MailPlus,
  MailWarning,
  X,
  XCircle,
} from "lucide-react";
import {
  UI_V2_REJECTION_REASON_OPTIONS,
  type DealFlowStageId,
  type UiV2DealPathDecision,
  type UiV2RejectionReasonCode,
} from "@re-sourcing/contracts";
import { AgingChip, Button, FileDropzone, StageChip } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import {
  dataCompleteness,
  deriveTimeline,
  formatDue,
  type ActionFlag,
  type FlagInputRow,
} from "./actionFlags";
import {
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatDaysAgo,
  formatPercent,
  formatShortDate,
  formatUnitLabel,
  formatWholeCurrency,
  labelFromKey,
  todayDateInput,
} from "./format";
import styles from "./progress.module.css";

/** Form state shared between the page (state owner) and the drawer (renderer). */
export type DealPathFormState = {
  tourScheduledAt: string;
  tourCompletedAt: string;
  tourBrokerName: string;
  tourNotes: string;
  postTourDecision: UiV2DealPathDecision;
  targetPrice: string;
  offerAmount: string;
  finalPrice: string;
  loiRecipientEmail: string;
  offerNotes: string;
  loiContingenciesText: string;
  loiContingencyNotes: string;
  rejectionReasonCode: UiV2RejectionReasonCode | "";
  rejectionNotes: string;
};

/** Which guided wizard the drawer opened for ("general" = full detail view). */
export type DealPathPromptMode = "general" | "tour_scheduled" | "tour_completed" | "loi_offered";

/** Display fields the drawer reads beyond the flag-engine row shape. */
export type DrawerRow = FlagInputRow & {
  source?: string | null;
  neighborhood?: string | null;
  borough?: string | null;
  firstImageUrl?: string | null;
  tags?: string[];
};

const PROMPT_TITLES: Record<DealPathPromptMode, string> = {
  general: "Deal workspace",
  tour_scheduled: "Schedule tour",
  tour_completed: "Complete tour",
  loi_offered: "LOI offered",
};

function flagIcon(item: ActionFlag) {
  if (item.email) return MailWarning;
  if (item.severity === "high") return AlertTriangle;
  return Flag;
}

/**
 * Right-side drawer: the single place a property opens from the board.
 * Top = recommended next action, then snapshot, data completeness, the
 * stage inputs form (tour / LOI / rejection), and a derived activity trail.
 */
export function DealWizardDrawer({
  row,
  sectionId,
  form,
  promptMode,
  flags,
  loiFile,
  saving,
  autoMovedTourPassed,
  onUpdate,
  onLoiFileChange,
  onCancel,
  onSave,
  onFlagAction,
  onEmailBroker,
  onAddBrokerEmail,
  onStartReject,
  onMoveStage,
}: {
  row: DrawerRow;
  sectionId: string;
  form: DealPathFormState;
  promptMode: DealPathPromptMode;
  flags: ActionFlag[];
  loiFile?: File | null;
  saving: boolean;
  autoMovedTourPassed?: boolean;
  onUpdate: <K extends keyof DealPathFormState>(propertyId: string, field: K, value: DealPathFormState[K]) => void;
  onLoiFileChange: (file: File | null) => void;
  onCancel: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onFlagAction: (flag: ActionFlag) => void;
  onEmailBroker: () => void;
  onAddBrokerEmail: () => void;
  onStartReject: () => void;
  onMoveStage: () => void;
}) {
  const address = row.displayAddress || row.canonicalAddress || row.propertyId;
  const completeness = dataCompleteness(sectionId, row);
  const timeline = deriveTimeline(row);
  const top = flags[0] ?? null;
  const restFlags = flags.slice(1);

  // Closing must never silently discard typed inputs ("entered a tour date,
  // clicked outside, nothing happened"). Track dirtiness against the form the
  // drawer opened with and confirm before any non-save close path.
  const initialFormRef = useRef(form);
  const initialLoiRef = useRef(loiFile ?? null);
  const dirtyRef = useRef(false);
  dirtyRef.current =
    JSON.stringify(form) !== JSON.stringify(initialFormRef.current) || (loiFile ?? null) !== initialLoiRef.current;
  const requestClose = useCallback(() => {
    if (dirtyRef.current && !window.confirm("Discard unsaved deal inputs? Use the save button to keep them.")) return;
    onCancel();
  }, [onCancel]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // A dialog stacked on top of the drawer (composer, reject, move…) owns
      // this Escape; the drawer only closes when it is the topmost layer.
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [requestClose]);

  const isTourScheduledPrompt = promptMode === "tour_scheduled";
  const isTourCompletedPrompt = promptMode === "tour_completed";
  const isLoiPrompt = promptMode === "loi_offered";
  const showGeneralTourFields = promptMode === "general";
  const submitLabel = saving
    ? "Saving..."
    : form.postTourDecision === "reject"
      ? "Save rejection"
      : isTourScheduledPrompt
        ? "Save tour date"
        : isTourCompletedPrompt
          ? "Save tour notes"
          : isLoiPrompt
            ? "Save LOI details"
            : "Save inputs";

  const locationLine = [
    row.neighborhood ? labelFromKey(row.neighborhood) : null,
    formatUnitLabel(row.units),
    row.source ? labelFromKey(row.source) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.drawerOverlay} role="presentation" onMouseDown={requestClose}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={`${PROMPT_TITLES[promptMode]} — ${address}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <div className={styles.drawerHeading}>
            <div className={styles.drawerKicker}>
              <span className={styles.drawerKickerLabel}>{PROMPT_TITLES[promptMode]}</span>
              <StageChip stage={sectionId as DealFlowStageId} full />
              <AgingChip since={row.stageEnteredAt} />
            </div>
            <h2 title={address}>{address}</h2>
            {locationLine ? <p>{locationLine}</p> : null}
          </div>
          <button type="button" className={styles.drawerClose} onClick={requestClose} aria-label="Close deal workspace">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.drawerBody}>
          {/* A. Next action */}
          {top ? (
            <section className={`${styles.drawerNextAction} ${styles[`severity_${top.severity}`]}`} aria-label="Recommended next action">
              <div className={styles.drawerNextActionHead}>
                {(() => {
                  const Icon = flagIcon(top);
                  return <Icon size={15} strokeWidth={2} aria-hidden="true" />;
                })()}
                <strong>{top.label}</strong>
                {formatDue(top.dueInDays) ? <span className={styles.dueTag}>{formatDue(top.dueInDays)}</span> : null}
              </div>
              <p>{top.reason}</p>
              <div className={styles.drawerNextActionCtas}>
                <Button variant="primary" size="sm" onClick={() => onFlagAction(top)}>
                  {top.recommendedAction}
                </Button>
              </div>
            </section>
          ) : (
            <section className={`${styles.drawerNextAction} ${styles.severityNone}`} aria-label="Recommended next action">
              <div className={styles.drawerNextActionHead}>
                <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" />
                <strong>No pending action</strong>
              </div>
              <p>This deal is current for its stage. Move it forward or update inputs below.</p>
            </section>
          )}
          {restFlags.length > 0 ? (
            <ul className={styles.drawerFlagList}>
              {restFlags.map((item) => (
                <li key={item.type + item.label}>
                  <span className={`${styles.flagDot} ${styles[`severity_${item.severity}`]}`} aria-hidden="true" />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.reason}</span>
                  </div>
                  <button type="button" onClick={() => onFlagAction(item)}>{item.recommendedAction}</button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* B. Snapshot */}
          <section className={styles.drawerSection} aria-label="Deal snapshot">
            <h3>Snapshot</h3>
            <div className={styles.drawerSnapshot}>
              <div><small>Ask</small><strong>{formatCurrency(row.price)}</strong></div>
              <div><small>$/SF</small><strong>{formatWholeCurrency(row.pricePerSqft)}</strong></div>
              <div><small>Units</small><strong>{formatCompactNumber(row.units)}</strong></div>
              <div><small>SF</small><strong>{formatCompactNumber(row.sqft)}</strong></div>
              <div><small>LTR yield</small><strong>{formatPercent(row.ltrYocPct)}</strong></div>
              <div><small>MTR yield</small><strong>{formatPercent(row.mtrYocPct)}</strong></div>
              <div><small>Score</small><strong>{row.dealScore == null ? "—" : Math.round(row.dealScore)}</strong></div>
              <div><small>Last outreach</small><strong>{formatDaysAgo(row.latestOutreachAt)}</strong></div>
            </div>
            <div className={styles.drawerBrokerRow}>
              {row.brokerEmail ? (
                <>
                  <Mail size={13} strokeWidth={2} aria-hidden="true" />
                  <span title={row.brokerEmail}>
                    {row.brokerName ? `${row.brokerName} · ` : ""}
                    {row.brokerEmail}
                  </span>
                  <button type="button" onClick={onEmailBroker}>Email broker</button>
                </>
              ) : (
                <>
                  <MailPlus size={13} strokeWidth={2} aria-hidden="true" />
                  <span>No broker email on file</span>
                  <button type="button" onClick={onAddBrokerEmail}>Add broker email</button>
                </>
              )}
            </div>
          </section>

          {/* C. Data completeness */}
          <section className={styles.drawerSection} aria-label="Data completeness">
            <h3>
              Data completeness
              <span className={styles.completenessScore}>{completeness.done}/{completeness.total}</span>
            </h3>
            <ul className={styles.completenessList}>
              {completeness.items.map((item) => (
                <li key={item.key} className={item.done ? styles.completenessDone : styles.completenessMissing}>
                  {item.done ? (
                    <CheckCircle2 size={13} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Circle size={13} strokeWidth={2} aria-hidden="true" />
                  )}
                  {item.label}
                </li>
              ))}
            </ul>
          </section>

          {/* D. Stage inputs (the former deal-path modal form) */}
          <section className={styles.drawerSection} aria-label="Deal inputs">
            <h3>{isLoiPrompt ? "LOI inputs" : isTourScheduledPrompt || isTourCompletedPrompt ? "Tour inputs" : "Deal inputs"}</h3>
            {promptMode !== "general" ? (
              <p className={styles.drawerPromptHint}>
                {isTourScheduledPrompt
                  ? "Add the confirmed tour date. The deal stays in Tour Scheduled either way — a missing date is flagged in Needs Action until it lands."
                  : isTourCompletedPrompt
                    ? "Add the completed date, notes, and a decision. The deal stays in Tour Completed either way — missing outcomes are flagged in Needs Action."
                    : "Add offer terms or upload the LOI. The deal stays in LOI Offered either way — missing terms are flagged in Needs Action."}
              </p>
            ) : null}
            {autoMovedTourPassed ? (
              <p className={styles.drawerDateWarning}>
                This deal moved here automatically — its scheduled tour date passed. Log the outcome below.
              </p>
            ) : null}
            <form id="deal-wizard-form" className={styles.drawerFormGrid} onSubmit={onSave}>
              {isTourScheduledPrompt || showGeneralTourFields ? (
                <label>
                  <span>Tour date</span>
                  <input
                    type="date"
                    value={form.tourScheduledAt}
                    onChange={(event) => onUpdate(row.propertyId, "tourScheduledAt", event.target.value)}
                  />
                  {isTourScheduledPrompt && !form.tourScheduledAt ? (
                    <span className={styles.drawerDateWarning}>
                      No date yet — the deal stays flagged “Tour date missing” until one is added.
                    </span>
                  ) : null}
                  {form.tourScheduledAt && form.tourScheduledAt <= todayDateInput() && !form.tourCompletedAt ? (
                    <span className={styles.drawerDateWarning}>
                      This date is today or in the past — the property will move to Tour Completed – Awaiting Inputs.
                    </span>
                  ) : null}
                </label>
              ) : null}
              {showGeneralTourFields ? (
                <label>
                  <span>Tour broker</span>
                  <input
                    value={form.tourBrokerName}
                    onChange={(event) => onUpdate(row.propertyId, "tourBrokerName", event.target.value)}
                    placeholder="Broker or agent name"
                  />
                </label>
              ) : null}
              {isTourCompletedPrompt || showGeneralTourFields ? (
                <label>
                  <span>Tour completed date</span>
                  <input
                    type="date"
                    value={form.tourCompletedAt}
                    onChange={(event) => onUpdate(row.propertyId, "tourCompletedAt", event.target.value)}
                  />
                  {isTourCompletedPrompt && !form.tourCompletedAt ? (
                    <span className={styles.drawerDateWarning}>
                      No completed date yet — the deal stays flagged until the outcome is logged.
                    </span>
                  ) : null}
                </label>
              ) : null}
              {isTourCompletedPrompt || showGeneralTourFields ? (
                <label>
                  <span>Post-tour decision</span>
                  <select
                    value={form.postTourDecision}
                    onChange={(event) => onUpdate(row.propertyId, "postTourDecision", event.target.value as UiV2DealPathDecision)}
                  >
                    <option value="pending">Pending inputs</option>
                    <option value="move_forward">Move forward with offer</option>
                    <option value="need_more_info">Need more information</option>
                    <option value="reject">Reject after tour</option>
                  </select>
                </label>
              ) : null}
              {isLoiPrompt || isTourCompletedPrompt || showGeneralTourFields ? (
                <label>
                  <span>Target price</span>
                  <input
                    inputMode="numeric"
                    value={form.targetPrice}
                    onChange={(event) => onUpdate(row.propertyId, "targetPrice", event.target.value)}
                    placeholder="Target pricing"
                  />
                </label>
              ) : null}
              {isLoiPrompt || isTourCompletedPrompt || showGeneralTourFields ? (
                <label>
                  <span>Offer amount</span>
                  <input
                    inputMode="numeric"
                    value={form.offerAmount}
                    onChange={(event) => onUpdate(row.propertyId, "offerAmount", event.target.value)}
                    placeholder="LOI offer"
                  />
                </label>
              ) : null}
              {showGeneralTourFields ? (
                <label>
                  <span>Final price</span>
                  <input
                    inputMode="numeric"
                    value={form.finalPrice}
                    onChange={(event) => onUpdate(row.propertyId, "finalPrice", event.target.value)}
                    placeholder="Agreed / closing price"
                  />
                </label>
              ) : null}
              {isTourCompletedPrompt || showGeneralTourFields ? (
                <label className={styles.drawerWideField}>
                  <span>Tour notes</span>
                  <textarea
                    value={form.tourNotes}
                    onChange={(event) => onUpdate(row.propertyId, "tourNotes", event.target.value)}
                    placeholder="Tour takeaways, condition, broker comments, follow-up questions"
                  />
                </label>
              ) : null}
              {isLoiPrompt ? (
                <>
                  <label>
                    <span>LOI recipient / email</span>
                    <input
                      value={form.loiRecipientEmail}
                      onChange={(event) => onUpdate(row.propertyId, "loiRecipientEmail", event.target.value)}
                      placeholder="Broker, seller, or recipient email"
                    />
                  </label>
                  <div>
                    <span className={styles.drawerFieldLabel}>Upload LOI PDF</span>
                    <FileDropzone
                      files={loiFile ? [loiFile] : []}
                      onChange={(files) => onLoiFileChange(files[0] ?? null)}
                      accept=".pdf,.doc,.docx"
                      maxFiles={1}
                    />
                  </div>
                  <GenerateLoiButton
                    propertyId={row.propertyId}
                    offerAmount={form.offerAmount}
                    targetPrice={form.targetPrice}
                    contingenciesText={form.loiContingenciesText}
                    notes={form.offerNotes}
                  />
                </>
              ) : null}
              {isLoiPrompt || isTourCompletedPrompt || showGeneralTourFields ? (
                <label className={styles.drawerWideField}>
                  <span>{isLoiPrompt ? "LOI offer notes" : "Offer notes"}</span>
                  <textarea
                    value={form.offerNotes}
                    onChange={(event) => onUpdate(row.propertyId, "offerNotes", event.target.value)}
                    placeholder="Rationale for offer, pricing read, partner feedback"
                  />
                </label>
              ) : null}
              {isLoiPrompt || showGeneralTourFields ? (
                <label className={styles.drawerWideField}>
                  <span>LOI contingencies</span>
                  <textarea
                    value={form.loiContingenciesText}
                    onChange={(event) => onUpdate(row.propertyId, "loiContingenciesText", event.target.value)}
                    placeholder="Financing contingency, diligence period, rent roll verification"
                  />
                </label>
              ) : null}
              {isLoiPrompt || showGeneralTourFields ? (
                <label className={styles.drawerWideField}>
                  <span>LOI contingency notes</span>
                  <textarea
                    value={form.loiContingencyNotes}
                    onChange={(event) => onUpdate(row.propertyId, "loiContingencyNotes", event.target.value)}
                    placeholder="Timing, diligence needs, third-party reports, deposit terms"
                  />
                </label>
              ) : null}
              {form.postTourDecision === "reject" ? (
                <>
                  <label>
                    <span>Reject reason</span>
                    <select
                      value={form.rejectionReasonCode}
                      onChange={(event) => onUpdate(row.propertyId, "rejectionReasonCode", event.target.value as UiV2RejectionReasonCode | "")}
                      required
                    >
                      <option value="">Choose reason</option>
                      {UI_V2_REJECTION_REASON_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.drawerWideField}>
                    <span>Reject notes</span>
                    <textarea
                      value={form.rejectionNotes}
                      onChange={(event) => onUpdate(row.propertyId, "rejectionNotes", event.target.value)}
                      placeholder="Why we are passing after the tour"
                    />
                  </label>
                </>
              ) : null}
            </form>
          </section>

          {/* E. Activity */}
          {timeline.length > 0 ? (
            <section className={styles.drawerSection} aria-label="Activity">
              <h3>Activity</h3>
              <ul className={styles.drawerTimeline}>
                {timeline.map((event) => (
                  <li key={`${event.label}-${event.at}`}>
                    <span>{event.label}</span>
                    <time dateTime={event.at} title={formatDate(event.at)}>{formatShortDate(event.at)}</time>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <footer className={styles.drawerFooter}>
          <div className={styles.drawerFooterLeft}>
            <button type="button" className={styles.drawerDangerButton} onClick={onStartReject} disabled={saving}>
              <XCircle size={13} strokeWidth={2} aria-hidden="true" />
              Reject
            </button>
            <button type="button" className={styles.drawerGhostButton} onClick={onMoveStage} disabled={saving}>
              <ArrowRightLeft size={13} strokeWidth={2} aria-hidden="true" />
              Move…
            </button>
          </div>
          <div className={styles.drawerFooterRight}>
            <Button variant="ghost" size="sm" onClick={requestClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" form="deal-wizard-form" disabled={saving}>
              {submitLabel}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function GenerateLoiButton({ propertyId, offerAmount, targetPrice, contingenciesText, notes }: {
  propertyId: string;
  offerAmount: string;
  targetPrice: string;
  contingenciesText: string;
  notes: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ fileName: string; downloadPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effectiveOffer = Number((offerAmount || targetPrice).replace(/[$,\s]/g, ""));
  const canGenerate = Number.isFinite(effectiveOffer) && effectiveOffer > 0;

  async function generate() {
    if (!canGenerate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/ui-v2/properties/${encodeURIComponent(propertyId)}/loi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          offerAmount: effectiveOffer,
          contingencies: contingenciesText
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean),
          notes: notes.trim() || undefined,
          actorName: "progress_board",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        fileName?: string;
        downloadPath?: string;
        error?: string;
        details?: string;
      };
      if (!response.ok || data.error || !data.downloadPath) {
        throw new Error(data.details || data.error || "Failed to generate LOI.");
      }
      setResult({ fileName: data.fileName ?? "LOI.pdf", downloadPath: data.downloadPath });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate LOI.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.loiGenerate}>
      <button
        type="button"
        className={styles.loiGenerateButton}
        onClick={generate}
        disabled={!canGenerate || busy}
        title={canGenerate ? "Generate a standard LOI PDF at this offer" : "Enter an offer amount or target price first"}
      >
        {busy ? "Generating LOI..." : "Generate LOI PDF"}
      </button>
      {result ? (
        <a href={`${API_BASE}${result.downloadPath}`} target="_blank" rel="noreferrer" className={styles.loiGenerateLink}>
          Download {result.fileName}
        </a>
      ) : null}
      {error ? <span className={styles.loiGenerateError}>{error}</span> : null}
    </div>
  );
}
