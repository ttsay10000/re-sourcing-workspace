"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./primitives.module.css";
import { cx } from "./utils";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Supporting copy under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Footer slot; ConfirmDialog provides a standard one. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClass = {
  sm: styles.dialogSm,
  md: undefined,
  lg: styles.dialogLg,
} as const;

export function Dialog({ open, onClose, title, description, children, footer, size = "md", className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.dialogOverlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx(styles.dialogPanel, sizeClass[size], className)}
      >
        <header className={styles.dialogHeader}>
          <div className={styles.dialogHeading}>
            <h2 className={styles.dialogTitle}>{title}</h2>
            {description ? <p className={styles.dialogDescription}>{description}</p> : null}
          </div>
          <IconButton size="sm" label="Close dialog" onClick={onClose}>
            <X size={15} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </header>
        {children ? <div className={styles.dialogBody}>{children}</div> : null}
        {footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for irreversible actions. */
  destructive?: boolean;
  busy?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    />
  );
}
