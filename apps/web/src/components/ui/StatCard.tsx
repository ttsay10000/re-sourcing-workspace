import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

export type StatCardTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

type StatCardProps = {
  /** Uppercase micro label, e.g. "OM Requested". */
  label: ReactNode;
  /** The big numeral / value. */
  value: ReactNode;
  /** Optional small line under the value (delta, sub-count, unit). */
  sub?: ReactNode;
  /** Accent color of the top border. */
  tone?: StatCardTone;
  /** Renders the card as a link when provided. */
  href?: string;
  /** Marks the card as the currently selected one in a strip. */
  active?: boolean;
  className?: string;
  onClick?: () => void;
  title?: string;
};

const toneClass: Record<StatCardTone, string | undefined> = {
  neutral: undefined,
  brand: styles.statCardBrand,
  success: styles.statCardSuccess,
  warning: styles.statCardWarning,
  danger: styles.statCardDanger,
  info: styles.statCardInfo,
};

export function StatCard({ label, value, sub, tone = "neutral", href, active, className, onClick, title }: StatCardProps) {
  const content = (
    <>
      <span className={styles.statCardLabel}>{label}</span>
      <strong className={styles.statCardValue}>{value}</strong>
      {sub ? <small className={styles.statCardSub}>{sub}</small> : null}
    </>
  );
  const cardClass = cx(styles.statCard, toneClass[tone], active && styles.statCardActive, className);

  if (href) {
    return (
      <Link href={href} className={cardClass} title={title} onClick={onClick}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={cardClass} title={title} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className={cardClass} title={title}>
      {content}
    </div>
  );
}
