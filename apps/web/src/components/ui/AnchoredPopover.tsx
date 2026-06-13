"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./primitives.module.css";
import { cx } from "./utils";

export type AnchoredPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

type ResolvedPosition = {
  top: number;
  left: number;
  width: number | undefined;
  maxHeight: number;
  transformOrigin: string;
};

function centeredPosition(panel: HTMLElement): ResolvedPosition {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const maxHeight = Math.min(Math.round(viewportH * 0.7), viewportH - GUTTER * 2);
  const panelW = panel.offsetWidth;
  const panelH = Math.min(panel.offsetHeight, maxHeight);
  return {
    top: Math.max(GUTTER, (viewportH - panelH) / 2),
    left: Math.max(GUTTER, (viewportW - panelW) / 2),
    width: undefined,
    maxHeight,
    transformOrigin: "center",
  };
}

type AnchoredPopoverProps = {
  open: boolean;
  /** Element the panel attaches to; null falls back to viewport center. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  placement?: AnchoredPlacement;
  /** Gap between anchor and panel in px. */
  offset?: number;
  matchAnchorWidth?: boolean;
  /** "menu" for action lists, "dialog" for small forms (focuses first field). */
  role?: "menu" | "dialog";
  ariaLabel?: string;
  id?: string;
  className?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
};

const GUTTER = 8;

function computePosition(
  anchorEl: HTMLElement | null,
  panel: HTMLElement,
  placement: AnchoredPlacement,
  offset: number,
  matchAnchorWidth: boolean
): ResolvedPosition | "no-anchor" | "offscreen" {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const maxHeight = Math.min(Math.round(viewportH * 0.7), viewportH - GUTTER * 2);
  const panelW = panel.offsetWidth;
  const panelH = Math.min(panel.offsetHeight, maxHeight);

  if (!anchorEl || !anchorEl.isConnected) return "no-anchor";

  const rect = anchorEl.getBoundingClientRect();
  // The anchor is fully outside its viewport — there is nothing to point at.
  if (rect.bottom < 0 || rect.top > viewportH || rect.right < 0 || rect.left > viewportW) {
    return "offscreen";
  }

  let vertical: "top" | "bottom" = placement.startsWith("top") ? "top" : "bottom";
  const fitsBelow = rect.bottom + offset + panelH <= viewportH - GUTTER;
  const fitsAbove = rect.top - offset - panelH >= GUTTER;
  if (vertical === "bottom" && !fitsBelow && fitsAbove) vertical = "top";
  if (vertical === "top" && !fitsAbove && fitsBelow) vertical = "bottom";

  const rawTop = vertical === "bottom" ? rect.bottom + offset : rect.top - offset - panelH;
  const top = Math.min(Math.max(rawTop, GUTTER), Math.max(GUTTER, viewportH - panelH - GUTTER));

  const horizontal: "start" | "end" = placement.endsWith("end") ? "end" : "start";
  const rawLeft = horizontal === "end" ? rect.right - panelW : rect.left;
  const left = Math.min(Math.max(rawLeft, GUTTER), Math.max(GUTTER, viewportW - panelW - GUTTER));

  return {
    top,
    left,
    width: matchAnchorWidth ? rect.width : undefined,
    maxHeight,
    transformOrigin: `${vertical === "bottom" ? "top" : "bottom"} ${horizontal === "end" ? "right" : "left"}`,
  };
}

/**
 * Floating panel pinned to its trigger: portals to <body>, flips when it
 * would leave the viewport, clamps to the edges, follows the anchor through
 * nested scrolling, and scales in from the trigger's corner. Closes on
 * Escape, outside pointerdown, or the anchor leaving the viewport; restores
 * focus to the anchor on close.
 */
export function AnchoredPopover({
  open,
  anchorEl,
  onClose,
  placement = "bottom-end",
  offset = 6,
  matchAnchorWidth = false,
  role = "menu",
  ariaLabel,
  id,
  className,
  children,
}: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ResolvedPosition | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Whether the panel was ever pinned to a visible anchor this open cycle:
  // an anchor that is offscreen from the start gets a centered fallback,
  // while one that scrolls away mid-interaction closes the panel.
  const anchoredOnceRef = useRef(false);

  const reposition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const next = computePosition(anchorEl, panel, placement, offset, matchAnchorWidth);
    if (next === "no-anchor") {
      setPosition(centeredPosition(panel));
      return;
    }
    if (next === "offscreen") {
      if (anchoredOnceRef.current) onCloseRef.current();
      else setPosition(centeredPosition(panel));
      return;
    }
    anchoredOnceRef.current = true;
    setPosition(next);
  }, [anchorEl, placement, offset, matchAnchorWidth]);

  // Measure and place before paint, then keep following the anchor.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      anchoredOnceRef.current = false;
      return;
    }
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const queueReposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reposition);
    };
    // Capture-phase scroll catches inner containers (.tableShell, .app-main).
    document.addEventListener("scroll", queueReposition, { capture: true, passive: true });
    window.addEventListener("resize", queueReposition);
    const observer = panelRef.current ? new ResizeObserver(queueReposition) : null;
    if (observer && panelRef.current) observer.observe(panelRef.current);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", queueReposition, { capture: true });
      window.removeEventListener("resize", queueReposition);
      observer?.disconnect();
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, anchorEl]);

  // Dialogs focus their first field; menus keep focus on the trigger so
  // arrow/Enter keep working. Either way the anchor regains focus on close.
  useEffect(() => {
    if (!open) return;
    if (role === "dialog") {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>(
        "input, select, textarea, button:not([data-popover-close])"
      );
      (target ?? panel)?.focus?.();
    }
    return () => {
      if (!anchorEl) return;
      if (anchorEl.tabIndex >= 0 || /^(button|a|input|select|textarea)$/i.test(anchorEl.tagName)) {
        anchorEl.focus?.();
      } else {
        anchorEl.querySelector<HTMLElement>("button, a, input, select, textarea, [tabindex]")?.focus?.();
      }
    };
  }, [open, role, anchorEl]);

  if (!open || typeof document === "undefined") return null;

  const style: CSSProperties = position
    ? {
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        transformOrigin: position.transformOrigin,
      }
    : { top: 0, left: 0, visibility: "hidden" };

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
      className={cx(styles.anchoredPanel, className)}
      style={style}
    >
      {typeof children === "function" ? children(onClose) : children}
    </div>,
    document.body
  );
}
