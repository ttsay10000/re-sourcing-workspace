/**
 * Fetch property owner from NYC PLUTO (Primary Land Use Tax Lot Output).
 * Dataset: 64uk-42ks. Use when DOB permits have no owner (e.g. no permits or owner fields empty).
 * PLUTO has one field: ownername (current owner on the tax lot).
 */

import { resourceUrl, fetchSocrataQuery, normalizeBblForQuery } from "./socrata/index.js";

const PLUTO_DATASET_ID = "64uk-42ks";

export interface PlutoOwnerResult {
  ownername: string | null;
  /** 2010 Census Block (cb2010 column from PLUTO). */
  censusBlock2010: string | null;
}

/**
 * Fetch owner name for a BBL from PLUTO. Returns null if BBL invalid or no row found.
 * PLUTO accepts BBL as integer in $where (e.g. bbl=1006150061).
 */
export async function fetchPlutoOwnerByBbl(
  bbl: string,
  options: { appToken?: string | null; timeoutMs?: number } = {}
): Promise<PlutoOwnerResult | null> {
  const normalized = normalizeBblForQuery(bbl);
  if (!normalized) return null;

  const bblNum = parseInt(normalized, 10);
  if (Number.isNaN(bblNum)) return null;

  const url = resourceUrl(PLUTO_DATASET_ID);
  const params = {
    $select: "ownername,cb2010",
    $where: `bbl = ${bblNum}`,
    $order: "1",
    $limit: 1,
    $offset: 0,
  };

  const rows = await fetchSocrataQuery<{ ownername?: string | null; cb2010?: string | number | null }>(url, params, options);
  const row = rows[0];
  if (!row) return null;

  let censusBlock2010: string | null = null;
  const cb = row.cb2010;
  if (cb != null) {
    const s = typeof cb === "number" ? String(cb) : String(cb).trim();
    if (s !== "") censusBlock2010 = s;
  }

  const ownername =
    row.ownername != null && String(row.ownername).trim() !== "" ? String(row.ownername).trim() : null;
  return { ownername, censusBlock2010 };
}
