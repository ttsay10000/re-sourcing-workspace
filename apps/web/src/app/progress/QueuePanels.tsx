"use client";

import { useMemo, useState } from "react";
import { AlarmClock, BellOff, Flag, MailPlus, MailWarning, PenLine } from "lucide-react";
import { StageChip } from "@/components/ui";
import { DEAL_FLOW_STAGES, type DealFlowStageId } from "@re-sourcing/contracts";
import { formatDue, severityRank, STAGE_LABEL_BY_ID, type ActionFlag, type EmailQueueItem } from "./actionFlags";
import { formatDaysAgo, streetAddressOnly } from "./format";
import styles from "./progress.module.css";

/* ── Shared sort/filter toolbar for both queues ──────────────────────────── */

const STAGE_ORDER: ReadonlyMap<string, number> = new Map(DEAL_FLOW_STAGES.map((stage, index) => [stage.id, index]));

function stageRank(stageId: string): number {
  return STAGE_ORDER.get(stageId) ?? 99;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

type QueueFilterOption = { value: string; label: string };

function QueueFilterBar({
  search,
  onSearch,
  selects,
  sort,
  sortOptions,
  onSort,
  visibleCount,
  totalCount,
  filtered,
  onClear,
}: {
  search: string;
  onSearch: (value: string) => void;
  selects: Array<{
    id: string;
    label: string;
    value: string;
    options: QueueFilterOption[];
    onChange: (value: string) => void;
  }>;
  sort: string;
  sortOptions: QueueFilterOption[];
  onSort: (value: string) => void;
  visibleCount: number;
  totalCount: number;
  filtered: boolean;
  onClear: () => void;
}) {
  return (
    <div className={styles.queueFilterBar} role="search">
      <input
        type="search"
        className={styles.queueFilterInput}
        placeholder="Filter by address…"
        aria-label="Filter queue by address"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      {selects.map((select) => (
        <label key={select.id} className={styles.queueFilterLabel}>
          {select.label}
          <select
            className={styles.queueFilterSelect}
            value={select.value}
            onChange={(event) => select.onChange(event.target.value)}
          >
            <option value="">All</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className={styles.queueFilterLabel}>
        Sort
        <select className={styles.queueFilterSelect} value={sort} onChange={(event) => onSort(event.target.value)}>
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.queueFilterMeta}>
        {visibleCount} of {totalCount}
        {filtered ? (
          <>
            {" · "}
            <button type="button" className={styles.queueFilterClear} onClick={onClear}>
              Clear filters
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}

function stageOptionsFrom(stageIds: Iterable<string>): QueueFilterOption[] {
  return [...new Set(stageIds)]
    .sort((left, right) => stageRank(left) - stageRank(right))
    .map((stageId) => ({ value: stageId, label: STAGE_LABEL_BY_ID.get(stageId) ?? stageId }));
}

/* ── Email Queue (§8): every email-needed property across all stages ─────── */

type EmailQueueSort = "urgency" | "due" | "last_touch" | "address" | "stage";

const EMAIL_QUEUE_SORTS: QueueFilterOption[] = [
  { value: "urgency", label: "Urgency" },
  { value: "due", label: "Due date" },
  { value: "last_touch", label: "Quietest first" },
  { value: "address", label: "Address A–Z" },
  { value: "stage", label: "Stage order" },
];

function compareEmailItems(left: EmailQueueItem, right: EmailQueueItem, sort: EmailQueueSort): number {
  // Snoozed rows always sink so the actionable queue stays on top.
  const snoozed = Number(left.snoozed) - Number(right.snoozed);
  if (snoozed !== 0) return snoozed;
  switch (sort) {
    case "due":
      return (left.flag.dueInDays ?? 99) - (right.flag.dueInDays ?? 99) || compareText(left.address, right.address);
    case "last_touch": {
      const leftTouch = left.lastTouchAt ? new Date(left.lastTouchAt).getTime() : 0;
      const rightTouch = right.lastTouchAt ? new Date(right.lastTouchAt).getTime() : 0;
      return leftTouch - rightTouch || compareText(left.address, right.address);
    }
    case "address":
      return compareText(left.address, right.address);
    case "stage":
      return stageRank(left.stageId) - stageRank(right.stageId) || compareText(left.address, right.address);
    case "urgency":
    default:
      return (
        severityRank(left.flag.severity) - severityRank(right.flag.severity) ||
        (left.flag.dueInDays ?? 99) - (right.flag.dueInDays ?? 99) ||
        compareText(left.address, right.address)
      );
  }
}

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
  /** Toggles selection across the currently visible (filtered) selectable items. */
  onToggleAll: (visibleSelectable: EmailQueueItem[]) => void;
  onDraft: (item: EmailQueueItem) => void;
  onAddBroker: (item: EmailQueueItem) => void;
  onSnooze: (item: EmailQueueItem) => void;
  onUnsnooze: (propertyId: string) => void;
  onOpen: (item: EmailQueueItem) => void;
  onBatchDraft: (items: EmailQueueItem[]) => void;
  onBatchBroker: (items: EmailQueueItem[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [brokerFilter, setBrokerFilter] = useState("");
  const [sort, setSort] = useState<EmailQueueSort>("urgency");

  const stageOptions = useMemo(() => stageOptionsFrom(items.map((item) => item.stageId)), [items]);
  const typeOptions = useMemo(
    () => [...new Set(items.map((item) => item.emailTypeLabel))].sort(compareText).map((label) => ({ value: label, label })),
    [items]
  );

  const filtered = Boolean(search.trim() || stageFilter || typeFilter || brokerFilter);
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => !query || item.address.toLowerCase().includes(query))
      .filter((item) => !stageFilter || item.stageId === stageFilter)
      .filter((item) => !typeFilter || item.emailTypeLabel === typeFilter)
      .filter((item) =>
        !brokerFilter || (brokerFilter === "has_email" ? Boolean(item.brokerEmail) : !item.brokerEmail)
      )
      .sort((left, right) => compareEmailItems(left, right, sort));
  }, [items, search, stageFilter, typeFilter, brokerFilter, sort]);

  const selectable = visibleItems.filter((item) => !item.snoozed);
  const selected = selectable.filter((item) => selectedIds.has(item.propertyId));
  const selectedDraftable = selected.filter((item) => item.brokerEmail);
  const selectedMissingBroker = selected.filter((item) => !item.brokerEmail);
  const allSelected = selectable.length > 0 && selectable.every((item) => selectedIds.has(item.propertyId));

  const clearFilters = () => {
    setSearch("");
    setStageFilter("");
    setTypeFilter("");
    setBrokerFilter("");
  };

  return (
    <div className={styles.queuePanel} aria-label="Email queue">
      <QueueFilterBar
        search={search}
        onSearch={setSearch}
        selects={[
          { id: "stage", label: "Stage", value: stageFilter, options: stageOptions, onChange: setStageFilter },
          { id: "type", label: "Type", value: typeFilter, options: typeOptions, onChange: setTypeFilter },
          {
            id: "broker",
            label: "Broker",
            value: brokerFilter,
            options: [
              { value: "has_email", label: "Has email" },
              { value: "missing_email", label: "Missing email" },
            ],
            onChange: setBrokerFilter,
          },
        ]}
        sort={sort}
        sortOptions={EMAIL_QUEUE_SORTS}
        onSort={(value) => setSort(value as EmailQueueSort)}
        visibleCount={visibleItems.length}
        totalCount={items.length}
        filtered={filtered}
        onClear={clearFilters}
      />
      <div className={styles.queueToolbar}>
        <label className={styles.bulkCheck}>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={selectable.length === 0 || busy}
            onChange={() => onToggleAll(selectable)}
          />
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
      {visibleItems.length === 0 ? (
        <div className={styles.emptyState}>
          {items.length === 0
            ? `No email actions due. ${snoozedCount > 0 ? `${snoozedCount} snoozed.` : "Inbox zero for the pipeline."}`
            : "No emails match the current filters."}
        </div>
      ) : (
        <ul className={styles.queueList}>
          {visibleItems.map((item) => (
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

/* ── Needs Action queue: every flagged property, most urgent first ───────── */

export type NeedsActionRow = {
  propertyId: string;
  address: string;
  stageId: string;
  flag: ActionFlag;
  flagCount: number;
  ageDays: number | null;
};

type NeedsActionSort = "urgency" | "due" | "age" | "address" | "stage";

const NEEDS_ACTION_SORTS: QueueFilterOption[] = [
  { value: "urgency", label: "Urgency" },
  { value: "due", label: "Due date" },
  { value: "age", label: "Longest in stage" },
  { value: "address", label: "Address A–Z" },
  { value: "stage", label: "Stage order" },
];

function compareNeedsActionRows(left: NeedsActionRow, right: NeedsActionRow, sort: NeedsActionSort): number {
  switch (sort) {
    case "due":
      return (left.flag.dueInDays ?? 99) - (right.flag.dueInDays ?? 99) || compareText(left.address, right.address);
    case "age":
      return (right.ageDays ?? -1) - (left.ageDays ?? -1) || compareText(left.address, right.address);
    case "address":
      return compareText(left.address, right.address);
    case "stage":
      return stageRank(left.stageId) - stageRank(right.stageId) || compareText(left.address, right.address);
    case "urgency":
    default:
      return (
        severityRank(left.flag.severity) - severityRank(right.flag.severity) ||
        (left.flag.dueInDays ?? 99) - (right.flag.dueInDays ?? 99) ||
        (right.ageDays ?? 0) - (left.ageDays ?? 0)
      );
  }
}

const SEVERITY_OPTIONS: QueueFilterOption[] = [
  { value: "high", label: "Critical" },
  { value: "medium", label: "Important" },
  { value: "low", label: "Suggested" },
];

export function NeedsActionPanel({
  rows,
  onOpen,
  onAction,
}: {
  rows: NeedsActionRow[];
  onOpen: (row: NeedsActionRow) => void;
  onAction: (row: NeedsActionRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState<NeedsActionSort>("urgency");

  const stageOptions = useMemo(() => stageOptionsFrom(rows.map((row) => row.stageId)), [rows]);
  const typeOptions = useMemo(() => {
    const labelByType = new Map<string, string>();
    for (const row of rows) {
      if (!labelByType.has(row.flag.type)) labelByType.set(row.flag.type, row.flag.label);
    }
    return [...labelByType.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => compareText(left.label, right.label));
  }, [rows]);

  const filtered = Boolean(search.trim() || stageFilter || severityFilter || typeFilter);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => !query || row.address.toLowerCase().includes(query))
      .filter((row) => !stageFilter || row.stageId === stageFilter)
      .filter((row) => !severityFilter || row.flag.severity === severityFilter)
      .filter((row) => !typeFilter || row.flag.type === typeFilter)
      .sort((left, right) => compareNeedsActionRows(left, right, sort));
  }, [rows, search, stageFilter, severityFilter, typeFilter, sort]);

  const clearFilters = () => {
    setSearch("");
    setStageFilter("");
    setSeverityFilter("");
    setTypeFilter("");
  };

  if (rows.length === 0) {
    return <div className={styles.emptyState}>Nothing needs action right now — the board is current.</div>;
  }

  // Severity grouping only makes sense for the default urgency ordering; any
  // other sort renders one flat list in the chosen order.
  const groups: Array<{ id: string; label: string; rows: NeedsActionRow[] }> =
    sort === "urgency"
      ? [
          { id: "high", label: "Critical", rows: visibleRows.filter((row) => row.flag.severity === "high") },
          { id: "medium", label: "Important", rows: visibleRows.filter((row) => row.flag.severity === "medium") },
          { id: "low", label: "Suggested", rows: visibleRows.filter((row) => row.flag.severity === "low") },
        ].filter((group) => group.rows.length > 0)
      : [{ id: "all", label: "All flagged deals", rows: visibleRows }];

  return (
    <div className={styles.queuePanel} aria-label="Needs action queue">
      <QueueFilterBar
        search={search}
        onSearch={setSearch}
        selects={[
          { id: "stage", label: "Stage", value: stageFilter, options: stageOptions, onChange: setStageFilter },
          { id: "severity", label: "Severity", value: severityFilter, options: SEVERITY_OPTIONS, onChange: setSeverityFilter },
          { id: "type", label: "Action", value: typeFilter, options: typeOptions, onChange: setTypeFilter },
        ]}
        sort={sort}
        sortOptions={NEEDS_ACTION_SORTS}
        onSort={(value) => setSort(value as NeedsActionSort)}
        visibleCount={visibleRows.length}
        totalCount={rows.length}
        filtered={filtered}
        onClear={clearFilters}
      />
      {visibleRows.length === 0 ? (
        <div className={styles.emptyState}>No flagged deals match the current filters.</div>
      ) : (
        groups.map((group) => (
          <section key={group.id} className={styles.needsGroup}>
            <h3 className={`${styles.needsGroupTitle} ${group.id === "all" ? "" : styles[`severity_${group.id}`]}`}>
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
        ))
      )}
    </div>
  );
}
