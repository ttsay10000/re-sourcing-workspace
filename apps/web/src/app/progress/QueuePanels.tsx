"use client";

import { AlarmClock, BellOff, Flag, MailPlus, MailWarning, PenLine } from "lucide-react";
import { StageChip } from "@/components/ui";
import type { DealFlowStageId } from "@re-sourcing/contracts";
import { formatDue, type ActionFlag, type EmailQueueItem, type FlaggedContactItem } from "./actionFlags";
import { formatDaysAgo, streetAddressOnly } from "./format";
import styles from "./progress.module.css";

/* ── Email Queue (§8): every email-needed property across all stages ─────── */

export function EmailQueuePanel({
  items,
  snoozedCount,
  showSnoozed,
  selectedIds,
  busy,
  onToggleShowSnoozed,
  onToggleSelected,
  onToggleAll,
  onDraft,
  onAddBroker,
  onSnooze,
  onUnsnooze,
  onOpen,
  onBatchDraft,
  onBatchBroker,
}: {
  items: EmailQueueItem[];
  snoozedCount: number;
  showSnoozed: boolean;
  selectedIds: Set<string>;
  busy: boolean;
  onToggleShowSnoozed: () => void;
  onToggleSelected: (propertyId: string, selected: boolean) => void;
  onToggleAll: () => void;
  onDraft: (item: EmailQueueItem) => void;
  onAddBroker: (item: EmailQueueItem) => void;
  onSnooze: (item: EmailQueueItem) => void;
  onUnsnooze: (propertyId: string) => void;
  onOpen: (item: EmailQueueItem) => void;
  onBatchDraft: (items: EmailQueueItem[]) => void;
  onBatchBroker: (items: EmailQueueItem[]) => void;
}) {
  const selectable = items.filter((item) => !item.snoozed);
  const selected = selectable.filter((item) => selectedIds.has(item.propertyId));
  const selectedDraftable = selected.filter((item) => item.brokerEmail);
  const selectedMissingBroker = selected.filter((item) => !item.brokerEmail);
  const allSelected = selectable.length > 0 && selectable.every((item) => selectedIds.has(item.propertyId));

  return (
    <div className={styles.queuePanel} aria-label="Email queue">
      <div className={styles.queueToolbar}>
        <label className={styles.bulkCheck}>
          <input type="checkbox" checked={allSelected} disabled={selectable.length === 0 || busy} onChange={onToggleAll} />
          <span>{allSelected ? "Unselect all" : "Select all"}</span>
        </label>
        <strong>{selected.length} selected</strong>
        <div className={styles.queueToolbarActions}>
          <button
            type="button"
            className={styles.queuePrimaryButton}
            disabled={selectedDraftable.length === 0 || busy}
            title={selectedDraftable.length === 0 ? "Select queue items that already have a broker email." : `Step through ${selectedDraftable.length} drafts, edit each, and queue them.`}
            onClick={() => onBatchDraft(selectedDraftable)}
          >
            Draft {selectedDraftable.length > 0 ? selectedDraftable.length : ""} selected
          </button>
          <button
            type="button"
            className={styles.queueGhostButton}
            disabled={selectedMissingBroker.length === 0 || busy}
            title="Add broker emails for the selected items that are missing one."
            onClick={() => onBatchBroker(selectedMissingBroker)}
          >
            Add {selectedMissingBroker.length > 0 ? selectedMissingBroker.length : ""} broker emails
          </button>
          {snoozedCount > 0 ? (
            <button type="button" className={styles.queueGhostButton} onClick={onToggleShowSnoozed}>
              {showSnoozed ? "Hide snoozed" : `Show ${snoozedCount} snoozed`}
            </button>
          ) : null}
        </div>
      </div>
      {items.length === 0 ? (
        <div className={styles.emptyState}>
          No email actions due. {snoozedCount > 0 ? `${snoozedCount} snoozed.` : "Inbox zero for the pipeline."}
        </div>
      ) : (
        <ul className={styles.queueList}>
          {items.map((item) => (
            <li key={item.propertyId} className={`${styles.queueRow} ${item.snoozed ? styles.queueRowSnoozed : ""}`}>
              <input
                type="checkbox"
                className={styles.miniSelect}
                aria-label={`Select ${item.address}`}
                checked={selectedIds.has(item.propertyId)}
                disabled={busy || item.snoozed}
                onChange={(event) => onToggleSelected(item.propertyId, event.target.checked)}
              />
              <span className={`${styles.queueIcon} ${styles[`severity_${item.flag.severity}`]}`} aria-hidden="true">
                <MailWarning size={14} strokeWidth={2} />
              </span>
              <div className={styles.queueMain}>
                <button type="button" className={styles.queueAddress} title={item.address} onClick={() => onOpen(item)}>
                  {streetAddressOnly(item.address)}
                </button>
                <div className={styles.queueMetaLine}>
                  <StageChip stage={item.stageId as DealFlowStageId} />
                  <span className={styles.queueType}>{item.emailTypeLabel}</span>
                  {formatDue(item.flag.dueInDays) ? (
                    <span className={`${styles.dueTag} ${((item.flag.dueInDays ?? 0) <= 0) ? styles.dueTagOverdue : ""}`}>
                      {formatDue(item.flag.dueInDays)}
                    </span>
                  ) : null}
                </div>
                <div className={styles.queueSubject} title={item.suggestedSubject}>“{item.suggestedSubject}”</div>
              </div>
              <div className={styles.queueContact}>
                {item.brokerEmail ? (
                  <span title={item.brokerEmail}>{item.brokerName || item.brokerEmail}</span>
                ) : (
                  <span className={styles.queueMissingBroker}>No broker email</span>
                )}
                <small>Last touch {formatDaysAgo(item.lastTouchAt)}</small>
              </div>
              <div className={styles.queueActions}>
                {item.snoozed ? (
                  <button type="button" className={styles.queueGhostButton} onClick={() => onUnsnooze(item.propertyId)}>
                    Unsnooze
                  </button>
                ) : item.brokerEmail ? (
                  <button type="button" className={styles.queuePrimaryButton} disabled={busy} onClick={() => onDraft(item)}>
                    Draft
                  </button>
                ) : (
                  <button type="button" className={styles.queuePrimaryButton} disabled={busy} onClick={() => onAddBroker(item)}>
                    <MailPlus size={12} strokeWidth={2} aria-hidden="true" /> Add email
                  </button>
                )}
                {!item.snoozed ? (
                  <button
                    type="button"
                    className={styles.queueIconButton}
                    title="Snooze for 7 days"
                    disabled={busy}
                    onClick={() => onSnooze(item)}
                  >
                    <BellOff size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Flags queue: every property without a broker email attached ─────────── */

export function FlagsPanel({
  items,
  busy,
  onOpen,
  onAddBroker,
  onBatchBroker,
}: {
  items: FlaggedContactItem[];
  busy: boolean;
  onOpen: (item: FlaggedContactItem) => void;
  onAddBroker: (item: FlaggedContactItem) => void;
  onBatchBroker: (items: FlaggedContactItem[]) => void;
}) {
  if (items.length === 0) {
    return <div className={styles.emptyState}>Every property on the board has a broker email attached.</div>;
  }
  return (
    <div className={styles.queuePanel} aria-label="Flags queue">
      <div className={styles.queueToolbar}>
        <strong>
          {items.length} propert{items.length === 1 ? "y" : "ies"} without a broker email
        </strong>
        <div className={styles.queueToolbarActions}>
          <button
            type="button"
            className={styles.queuePrimaryButton}
            disabled={busy}
            title="Step through every flagged property and attach a broker email."
            onClick={() => onBatchBroker(items)}
          >
            Add {items.length} broker emails
          </button>
        </div>
      </div>
      <ul className={styles.queueList}>
        {items.map((item) => (
          <li key={item.propertyId} className={styles.queueRow}>
            <span className={`${styles.queueIcon} ${styles[`severity_${item.flag?.severity ?? "medium"}`]}`} aria-hidden="true">
              <Flag size={14} strokeWidth={2} />
            </span>
            <div className={styles.queueMain}>
              <button type="button" className={styles.queueAddress} title={item.address} onClick={() => onOpen(item)}>
                {streetAddressOnly(item.address)}
              </button>
              <div className={styles.queueMetaLine}>
                <StageChip stage={item.stageId as DealFlowStageId} />
                {item.ageDays != null && item.ageDays >= 1 ? (
                  <span className={styles.queueAge}>
                    <AlarmClock size={11} strokeWidth={2} aria-hidden="true" /> {item.ageDays}d in stage
                  </span>
                ) : null}
              </div>
              <div className={styles.queueSubject}>
                {item.flag?.reason ?? "No broker email attached — outreach and OM requests are blocked."}
              </div>
            </div>
            <div className={styles.queueContact}>
              <span className={styles.queueMissingBroker}>No broker email</span>
            </div>
            <div className={styles.queueActions}>
              <button type="button" className={styles.queuePrimaryButton} disabled={busy} onClick={() => onAddBroker(item)}>
                <MailPlus size={12} strokeWidth={2} aria-hidden="true" /> Add email
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Needs Action queue: every flagged property, most urgent first ───────── */

export type NeedsActionRow = {
  propertyId: string;
  address: string;
  stageId: string;
  flag: ActionFlag;
  flagCount: number;
  ageDays: number | null;
};

export function NeedsActionPanel({
  rows,
  onOpen,
  onAction,
}: {
  rows: NeedsActionRow[];
  onOpen: (row: NeedsActionRow) => void;
  onAction: (row: NeedsActionRow) => void;
}) {
  if (rows.length === 0) {
    return <div className={styles.emptyState}>Nothing needs action right now — the board is current.</div>;
  }
  const groups: Array<{ id: string; label: string; rows: NeedsActionRow[] }> = [
    { id: "high", label: "Critical", rows: rows.filter((row) => row.flag.severity === "high") },
    { id: "medium", label: "Important", rows: rows.filter((row) => row.flag.severity === "medium") },
    { id: "low", label: "Suggested", rows: rows.filter((row) => row.flag.severity === "low") },
  ].filter((group) => group.rows.length > 0);

  return (
    <div className={styles.queuePanel} aria-label="Needs action queue">
      {groups.map((group) => (
        <section key={group.id} className={styles.needsGroup}>
          <h3 className={`${styles.needsGroupTitle} ${styles[`severity_${group.id}`]}`}>
            {group.label}
            <span>{group.rows.length}</span>
          </h3>
          <ul className={styles.queueList}>
            {group.rows.map((row) => (
              <li key={`${row.propertyId}-${row.flag.type}`} className={styles.queueRow}>
                <span className={`${styles.queueIcon} ${styles[`severity_${row.flag.severity}`]}`} aria-hidden="true">
                  {row.flag.email ? <MailWarning size={14} strokeWidth={2} /> : <Flag size={14} strokeWidth={2} />}
                </span>
                <div className={styles.queueMain}>
                  <button type="button" className={styles.queueAddress} title={row.address} onClick={() => onOpen(row)}>
                    {streetAddressOnly(row.address)}
                  </button>
                  <div className={styles.queueMetaLine}>
                    <StageChip stage={row.stageId as DealFlowStageId} />
                    <strong className={styles.queueFlagLabel}>{row.flag.label}</strong>
                    {formatDue(row.flag.dueInDays) ? (
                      <span className={`${styles.dueTag} ${((row.flag.dueInDays ?? 0) <= 0) ? styles.dueTagOverdue : ""}`}>
                        {formatDue(row.flag.dueInDays)}
                      </span>
                    ) : null}
                    {row.ageDays != null && row.ageDays >= 1 ? (
                      <span className={styles.queueAge}>
                        <AlarmClock size={11} strokeWidth={2} aria-hidden="true" /> {row.ageDays}d in stage
                      </span>
                    ) : null}
                    {row.flagCount > 1 ? <span className={styles.queueMoreFlags}>+{row.flagCount - 1} more</span> : null}
                  </div>
                  <div className={styles.queueSubject}>{row.flag.reason}</div>
                </div>
                <div className={styles.queueActions}>
                  <button type="button" className={styles.queuePrimaryButton} onClick={() => onAction(row)}>
                    {row.flag.recommendedAction}
                  </button>
                  <button type="button" className={styles.queueIconButton} title="Open deal workspace" onClick={() => onOpen(row)}>
                    <PenLine size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
