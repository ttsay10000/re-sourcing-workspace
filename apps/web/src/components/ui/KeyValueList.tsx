import type { ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

export type KeyValueItem = {
  label: ReactNode;
  /** Missing values (null/undefined/"") render as a muted em dash. */
  value: ReactNode | null | undefined;
  /** Inline affordance shown instead of the dash when the value is missing, e.g. an "Add" button. */
  emptyAction?: ReactNode;
  /** Hide the row entirely when the value is missing. */
  hideWhenEmpty?: boolean;
};

type KeyValueListProps = {
  items: KeyValueItem[];
  /** Number of label/value columns the grid flows into. */
  columns?: 1 | 2 | 3;
  /** Hide all empty rows (overrides per-item hideWhenEmpty). */
  hideEmpty?: boolean;
  className?: string;
};

function isEmptyValue(value: ReactNode | null | undefined): boolean {
  return value == null || value === "" || value === "—" || value === "-";
}

export function KeyValueList({ items, columns = 2, hideEmpty = false, className }: KeyValueListProps) {
  const visible = items.filter((item) => {
    if (!isEmptyValue(item.value)) return true;
    if (item.emptyAction) return true;
    return !(hideEmpty || item.hideWhenEmpty);
  });
  if (visible.length === 0) return null;

  return (
    <dl
      className={cx(
        styles.keyValueList,
        columns === 1 && styles.keyValueCols1,
        columns === 3 && styles.keyValueCols3,
        className
      )}
    >
      {visible.map((item, index) => {
        const empty = isEmptyValue(item.value);
        return (
          <div key={index} className={styles.keyValueRow}>
            <dt className={styles.keyValueLabel}>{item.label}</dt>
            <dd className={cx(styles.keyValueValue, empty && !item.emptyAction && styles.keyValueEmpty)}>
              {empty ? (item.emptyAction ?? "—") : item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
