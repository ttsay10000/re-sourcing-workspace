"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

type FileDropzoneProps = {
  /** Current selection — the parent owns the list. */
  files: File[];
  onChange: (files: File[]) => void;
  /** Same syntax as input[accept], e.g. ".pdf,.xlsx,.csv". */
  accept?: string;
  maxFiles?: number;
  /** Per-file size cap in bytes. */
  maxBytes?: number;
  disabled?: boolean;
  /** Main prompt line; defaults to "Drag & drop files here". */
  label?: ReactNode;
  /** Secondary hint line (formats, limits). */
  hint?: ReactNode;
  className?: string;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Drag-and-drop multi-file picker that ACCUMULATES across selections
 * (re-opening the browser or dropping more files adds to the list instead of
 * replacing it). Dedupes by name+size+mtime; per-file remove; inline
 * validation for max-files and per-file size.
 */
export function FileDropzone({
  files,
  onChange,
  accept,
  maxFiles,
  maxBytes,
  disabled = false,
  label,
  hint,
  className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const [dragActive, setDragActive] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  function addFiles(incoming: File[]) {
    if (disabled || incoming.length === 0) return;
    const problems: string[] = [];

    const oversized = maxBytes != null ? incoming.filter((file) => file.size > maxBytes) : [];
    if (oversized.length > 0) {
      problems.push(
        `${oversized.length === 1 ? `"${oversized[0]!.name}" is` : `${oversized.length} files are`} over ${formatBytes(maxBytes!)} and ${oversized.length === 1 ? "was" : "were"} skipped.`
      );
    }
    const usable = maxBytes != null ? incoming.filter((file) => file.size <= maxBytes) : incoming;

    const existingKeys = new Set(files.map(fileKey));
    const fresh = usable.filter((file) => !existingKeys.has(fileKey(file)));
    let next = [...files, ...fresh];
    if (maxFiles != null && next.length > maxFiles) {
      problems.push(`Up to ${maxFiles} files — kept the first ${maxFiles}.`);
      next = next.slice(0, maxFiles);
    }

    setIssue(problems.length > 0 ? problems.join(" ") : null);
    if (next.length !== files.length) onChange(next);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  return (
    <div className={cx(styles.dropzoneRoot, className)}>
      <div
        className={cx(styles.dropzone, dragActive && styles.dropzoneActive, disabled && styles.dropzoneDisabled)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragActive(false);
        }}
        onDrop={onDrop}
      >
        <span className={styles.dropzoneIcon} aria-hidden="true">
          <UploadCloud size={20} strokeWidth={1.7} />
        </span>
        <div className={styles.dropzoneCopy}>
          <strong>{label ?? "Drag & drop files here"}</strong>
          {hint ? <small>{hint}</small> : null}
        </div>
        <label htmlFor={inputId} className={styles.dropzoneBrowse}>
          Browse files
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            disabled={disabled}
            className={styles.dropzoneInput}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              // Allow re-selecting the same file later.
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {issue ? <p className={styles.dropzoneIssue}>{issue}</p> : null}

      {files.length > 0 ? (
        <ul className={styles.dropzoneList}>
          {files.map((file) => (
            <li key={fileKey(file)} className={styles.dropzoneItem}>
              <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
              <span className={styles.dropzoneItemName}>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
              <button
                type="button"
                className={styles.dropzoneRemove}
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => {
                  setIssue(null);
                  onChange(files.filter((candidate) => fileKey(candidate) !== fileKey(file)));
                }}
              >
                <X size={13} strokeWidth={2.1} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
