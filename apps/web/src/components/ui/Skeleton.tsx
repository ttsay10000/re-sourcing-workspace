import styles from "./primitives.module.css";
import { cx } from "./utils";

type SkeletonProps = {
  variant?: "text" | "title" | "card" | "row";
  /** Inline width override, e.g. "12rem" or "40%". */
  width?: string;
  className?: string;
};

const variantClass = {
  text: styles.skeletonText,
  title: styles.skeletonTitle,
  card: styles.skeletonCard,
  row: styles.skeletonRow,
} as const;

/** Shimmering placeholder block; replaces bare "Loading…" strings. */
export function Skeleton({ variant = "text", width, className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx(styles.skeleton, variantClass[variant], className)} style={width ? { width } : undefined} />;
}

/** Stack of row placeholders for lists/tables. */
export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={cx(styles.skeletonStack, className)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} variant="row" />
      ))}
    </span>
  );
}
