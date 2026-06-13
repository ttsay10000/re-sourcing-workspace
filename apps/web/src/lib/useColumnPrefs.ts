"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PersistedIdSet {
  ids: ReadonlySet<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** False until the localStorage value has been applied (first client effect). */
  hydrated: boolean;
}

/**
 * A set of string ids persisted to localStorage (versioned JSON payload).
 * Renders empty on the server and first client paint, then hydrates in an
 * effect — callers should treat `hydrated === false` as "use defaults" so
 * SSR markup never depends on storage.
 */
export function usePersistedIdSet(storageKey: string): PersistedIdSet {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { v?: number; ids?: unknown };
        if (parsed && Array.isArray(parsed.ids)) {
          setIds(new Set(parsed.ids.filter((id): id is string => typeof id === "string")));
        }
      }
    } catch {
      // unreadable/corrupt payload — fall back to defaults
    }
    hydratedRef.current = true;
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ v: 1, ids: [...ids] }));
    } catch {
      // storage full/blocked — prefs simply won't survive a reload
    }
  }, [ids, storageKey]);

  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((nextIds: string[]) => {
    setIds(new Set(nextIds));
  }, []);

  const remove = useCallback((id: string) => {
    setIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setIds(new Set());
  }, []);

  return { ids, toggle, setMany, remove, clear, hydrated };
}
