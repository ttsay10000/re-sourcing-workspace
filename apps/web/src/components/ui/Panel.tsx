import type { HTMLAttributes, ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

type PanelPadding = "sm" | "md" | "lg";

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  interactive?: boolean;
  padding?: PanelPadding;
  subtle?: boolean;
};

const paddingClass: Record<PanelPadding, string> = {
  sm: styles.panelPadSm,
  md: styles.panelPadMd,
  lg: styles.panelPadLg,
};

export function Panel({
  children,
  className,
  interactive = false,
  padding = "md",
  subtle = false,
  ...props
}: PanelProps) {
  return (
    <div
      {...props}
      className={cx(
        styles.panel,
        paddingClass[padding],
        subtle && styles.panelSubtle,
        interactive && styles.panelInteractive,
        className
      )}
    >
      {children}
    </div>
  );
}
