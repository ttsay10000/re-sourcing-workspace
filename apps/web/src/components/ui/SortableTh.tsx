"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortDirection } from "./useTableSort";
import styles from "./primitives.module.css";

/**
 * Sortable column header: renders a button that inherits the host table's th
 * typography, with an asc/desc caret on the active column and `aria-sort` for
 * screen readers. Pair with useTableSort.
 */
export function SortableTh<K extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onToggle,
  firstDir = "desc",
  title,
}: {
  label: string;
  sortKey: K;
  activeKey: K | null;
  direction: SortDirection;
  onToggle: (key: K, firstDir?: SortDirection) => void;
  /** Direction applied on the first click of this column (numbers usually "desc", text "asc"). */
  firstDir?: SortDirection;
  title?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} title={title}>
      <button
        type="button"
        className={`${styles.sortableTh} ${active ? styles.sortableThActive : ""}`}
        onClick={() => onToggle(sortKey, firstDir)}
      >
        {label}
        {active ? (
          direction === "asc" ? (
            <ArrowUp size={11} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <ArrowDown size={11} strokeWidth={2.2} aria-hidden="true" />
          )
        ) : (
          <ChevronsUpDown size={11} strokeWidth={1.8} aria-hidden="true" className={styles.sortableThIdle} />
        )}
      </button>
    </th>
  );
}
