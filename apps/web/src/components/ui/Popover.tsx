"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

type PopoverProps = {
  /** Trigger element; receives toggle handler + expanded state. */
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": true; "aria-controls": string }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Horizontal alignment of the panel relative to the trigger. */
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
};

/**
 * Lightweight anchored popover: closes on outside click and Escape.
 * Use for quick in-place actions instead of navigating away.
 */
export function Popover({ trigger, children, align = "start", className, panelClassName }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cx(styles.popoverRoot, className)}>
      {trigger({
        onClick: () => setOpen((current) => !current),
        "aria-expanded": open,
        "aria-haspopup": true,
        "aria-controls": panelId,
      })}
      {open ? (
        <div id={panelId} className={cx(styles.popoverPanel, align === "end" && styles.popoverPanelEnd, panelClassName)}>
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </span>
  );
}

export type PromptMenuItem = {
  label: ReactNode;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Secondary line under the label. */
  hint?: ReactNode;
};

type PromptMenuProps = {
  trigger: PopoverProps["trigger"];
  items: PromptMenuItem[];
  /** Optional heading above the items. */
  heading?: ReactNode;
  align?: "start" | "end";
  className?: string;
};

/** Anchored action menu for high-velocity flows (move stage, email broker, …). */
export function PromptMenu({ trigger, items, heading, align = "end", className }: PromptMenuProps) {
  return (
    <Popover trigger={trigger} align={align} className={className} panelClassName={styles.promptMenuPanel}>
      {(close) => (
        <div role="menu" className={styles.promptMenu}>
          {heading ? <div className={styles.promptMenuHeading}>{heading}</div> : null}
          {items.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={index}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={cx(styles.promptMenuItem, item.tone === "danger" && styles.promptMenuItemDanger)}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {ItemIcon ? <ItemIcon size={14} strokeWidth={1.9} aria-hidden="true" /> : null}
                <span className={styles.promptMenuItemBody}>
                  <span>{item.label}</span>
                  {item.hint ? <small>{item.hint}</small> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
