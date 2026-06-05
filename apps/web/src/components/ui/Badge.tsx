import type { HTMLAttributes, ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: BadgeTone;
};

const toneClass: Record<BadgeTone, string> = {
  neutral: styles.badgeNeutral,
  brand: styles.badgeBrand,
  success: styles.badgeSuccess,
  warning: styles.badgeWarning,
  danger: styles.badgeDanger,
  info: styles.badgeInfo,
};

export function Badge({ children, className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span {...props} className={cx(styles.badge, toneClass[tone], className)}>
      {children}
    </span>
  );
}
