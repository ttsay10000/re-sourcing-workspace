import type { ReactNode } from "react";
import styles from "./primitives.module.css";

type EmptyStateProps = {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ action, description, icon, title }: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      {icon ? <span className={styles.emptyStateIcon}>{icon}</span> : null}
      <p className={styles.emptyStateTitle}>{title}</p>
      {description ? <p className={styles.emptyStateDescription}>{description}</p> : null}
      {action}
    </div>
  );
}
