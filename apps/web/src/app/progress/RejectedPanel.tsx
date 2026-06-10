"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw, Search } from "lucide-react";
import { API_BASE, apiFetch } from "@/lib/api";
import { formatCurrency, formatShortDate, labelFromKey, streetAddressOnly } from "./format";
import styles from "./progress.module.css";

type RejectedRow = {
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  price?: number | null;
  units?: number | null;
  neighborhood?: string | null;
  rejection?: {
    reasonCode?: string | null;
    reasonLabel?: string | null;
    note?: string | null;
    rejectedAt?: string | null;
  } | null;
};

type RejectedListResponse = {
  savedDeals?: { rows?: RejectedRow[] };
  error?: string;
  details?: string;
};

/**
 * Rejected deals as sourcing memory (§19): collapsible, counted and
 * filterable by reason, searchable, and restorable back onto the board.
 */
export function RejectedPanel({
  reasons,
  onRestored,
}: {
  reasons: Array<{ reasonCode?: string; count?: number }>;
  onRestored: (address: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RejectedRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const total = reasons.reduce((sum, reason) => sum + (reason.count ?? 0), 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<RejectedListResponse>("/api/ui-v2/saved-deals?status=rejected&limit=250");
      setRows(Array.isArray(data.savedDeals?.rows) ? data.savedDeals.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rejected deals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && rows == null && !loading) void load();
  }, [open, rows, loading, load]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (reasonFilter && (row.rejection?.reasonCode ?? "other") !== reasonFilter) return false;
      if (!query) return true;
      return [row.displayAddress, row.canonicalAddress, row.rejection?.note, row.rejection?.reasonLabel, row.neighborhood]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [rows, reasonFilter, search]);

  const restore = useCallback(
    async (row: RejectedRow) => {
      const address = row.displayAddress || row.canonicalAddress || row.propertyId;
      setRestoringId(row.propertyId);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/ui-v2/properties/${encodeURIComponent(row.propertyId)}/status`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "saved", source: "progress_rejected_panel" }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
        if (!response.ok) throw new Error(data.error || data.details || "Failed to restore deal.");
        setRows((current) => (current ?? []).filter((candidate) => candidate.propertyId !== row.propertyId));
        onRestored(address);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to restore deal.");
      } finally {
        setRestoringId(null);
      }
    },
    [onRestored]
  );

  if (total === 0 && (rows == null || rows.length === 0)) return null;

  return (
    <section className={styles.rejectedPanel} aria-label="Rejected properties">
      <button type="button" className={styles.rejectedHeader} onClick={() => setOpen((current) => !current)}>
        <strong>Rejected properties</strong>
        <span className={styles.rejectedCount}>{total}</span>
        <span className={styles.rejectedHeaderHint}>
          {open ? "Hide" : "Review, filter by reason, restore"}
        </span>
        {open ? <ChevronUp size={15} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />}
      </button>
      {open ? (
        <div className={styles.rejectedBody}>
          <div className={styles.rejectedFilters}>
            <span className={styles.rejectedSearch}>
              <Search size={13} strokeWidth={2} aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder="Search rejected deals…"
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
            <div className={styles.rejectedReasonChips}>
              {reasons.slice(0, 10).map((reason) => {
                const code = reason.reasonCode || "other";
                const active = reasonFilter === code;
                return (
                  <button
                    key={code}
                    type="button"
                    className={`${styles.rejectedReasonChip} ${active ? styles.rejectedReasonChipActive : ""}`}
                    onClick={() => setReasonFilter(active ? null : code)}
                  >
                    {labelFromKey(code)} <strong>{reason.count ?? 0}</strong>
                  </button>
                );
              })}
            </div>
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
          {loading ? (
            <div className={styles.emptyState}>Loading rejected deals…</div>
          ) : filteredRows.length === 0 ? (
            <div className={styles.emptyState}>No rejected deals match.</div>
          ) : (
            <ul className={styles.rejectedList}>
              {filteredRows.map((row) => {
                const address = row.displayAddress || row.canonicalAddress || row.propertyId;
                return (
                  <li key={row.propertyId} className={styles.rejectedRow}>
                    <div className={styles.rejectedRowMain}>
                      <strong title={address}>{streetAddressOnly(address)}</strong>
                      <span>
                        {[
                          row.rejection?.reasonLabel || labelFromKey(row.rejection?.reasonCode ?? "other"),
                          row.price != null ? formatCurrency(row.price) : null,
                          row.rejection?.rejectedAt ? `rejected ${formatShortDate(row.rejection.rejectedAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {row.rejection?.note ? <small title={row.rejection.note}>{row.rejection.note}</small> : null}
                    </div>
                    <button
                      type="button"
                      className={styles.queueGhostButton}
                      disabled={restoringId === row.propertyId}
                      title="Restore to the board (Underwriting · Awaiting Review pool)"
                      onClick={() => void restore(row)}
                    >
                      <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
                      {restoringId === row.propertyId ? "Restoring…" : "Restore"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
