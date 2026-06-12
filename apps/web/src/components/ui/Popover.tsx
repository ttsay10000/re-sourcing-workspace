"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 6;

/**
 * Lightweight anchored popover: closes on outside click and Escape.
 * The panel renders in a body portal with fixed positioning so it never
 * gets clipped by overflow-hidden ancestors (e.g. board cards/columns);
 * it opens below the trigger and flips above when there's no room.
 */
export function Popover({ trigger, children, align = "start", className, panelClassName }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ top: 0, left: 0, visibility: "hidden" });
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  const reposition = useCallback(() => {
    const anchor = rootRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    let left = align === "end" ? anchorRect.right - panelRect.width : anchorRect.left;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - panelRect.width - VIEWPORT_MARGIN));

    const belowTop = anchorRect.bottom + TRIGGER_GAP;
    const aboveTop = anchorRect.top - TRIGGER_GAP - panelRect.height;
    const fitsBelow = belowTop + panelRect.height <= window.innerHeight - VIEWPORT_MARGIN;
    const fitsAbove = aboveTop >= VIEWPORT_MARGIN;
    const top = fitsBelow || !fitsAbove ? belowTop : aboveTop;

    setPanelStyle({
      top: Math.round(Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - panelRect.height - VIEWPORT_MARGIN))),
      left: Math.round(left),
    });
  }, [align]);

  // Position on open (before paint, so the panel never flashes at 0,0) and
  // keep the panel glued to its trigger through scrolling and resizes.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) {
      setPanelStyle({ top: 0, left: 0, visibility: "hidden" });
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
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
      {open
        ? createPortal(
            <div
              id={panelId}
              ref={panelRef}
              className={cx(styles.popoverPanel, panelClassName)}
              style={panelStyle}
              // The panel lives in a body portal, but React still bubbles its
              // events through the trigger's tree — don't let panel clicks
              // reach card-level handlers (open drawer, drag, …).
              onClick={(event) => event.stopPropagation()}
            >
              {typeof children === "function" ? children(close) : children}
            </div>,
            document.body
          )
        : null}
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
