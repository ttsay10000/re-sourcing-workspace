import type { ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

type PageHeaderProps = {
  /** Small uppercase kicker above the title, e.g. "Deal movement". */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One-line supporting copy under the title. */
  subtitle?: ReactNode;
  /** Right-aligned metadata block (timestamps, sources). */
  meta?: ReactNode;
  /** Right-aligned action buttons/links. */
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, subtitle, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.pageHeader, className)}>
      <div className={styles.pageHeaderCopy}>
        {eyebrow ? <span className={styles.pageHeaderEyebrow}>{eyebrow}</span> : null}
        <h1 className={styles.pageHeaderTitle}>{title}</h1>
        {subtitle ? <p className={styles.pageHeaderSubtitle}>{subtitle}</p> : null}
      </div>
      {meta || actions ? (
        <div className={styles.pageHeaderSide}>
          {meta ? <div className={styles.pageHeaderMeta}>{meta}</div> : null}
          {actions ? <div className={styles.pageHeaderActions}>{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
