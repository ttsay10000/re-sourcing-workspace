"use client";

import { useCallback, useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

/**
 * Click-to-sort state for data tables. Null/undefined/empty values always sort
 * last regardless of direction; numbers compare numerically, everything else
 * via locale-aware string comparison.
 *
 * Pass a stable `accessors` map (wrap in useMemo at the call site). When no
 * column has been clicked (`sortKey` null) the input order is preserved, so
 * each table keeps its existing default ordering until the user sorts.
 */
export function useTableSort<T, K extends string = string>(
  rows: T[],
  accessors: Record<K, (row: T) => number | string | null | undefined>
): {
  sorted: T[];
  sortKey: K | null;
  sortDir: SortDirection;
  toggle: (key: K, firstDir?: SortDirection) => void;
  clear: () => void;
} {
  const [sortKey, setSortKey] = useState<K | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const toggle = useCallback((key: K, firstDir: SortDirection = "desc") => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDir((currentDir) => (currentDir === "asc" ? "desc" : "asc"));
        return currentKey;
      }
      setSortDir(firstDir);
      return key;
    });
  }, []);

  const clear = useCallback(() => setSortKey(null), []);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const accessor = accessors[sortKey];
    if (!accessor) return rows;
    return [...rows].sort((a, b) => {
      const aValue = accessor(a);
      const bValue = accessor(b);
      const aEmpty = aValue == null || aValue === "";
      const bEmpty = bValue == null || bValue === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const compared =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? compared : -compared;
    });
  }, [rows, accessors, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle, clear };
}
