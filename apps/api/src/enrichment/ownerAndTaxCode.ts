/**
 * Phase 1 owner cascade + tax code: PLUTO → valuations (tax code) → HPD (owner if col).
 * Writes owner to details.ownerInfo when we get it (so we don't rely on permits to persist it).
 * Also returns cascade owner for the permits step so permits_summary can merge for backward compat.
 */

import { getPool, PropertyRepo } from "@re-sourcing/db";
import { fetchPlutoOwnerByBbl } from "./plutoOwner.js";
import { resourceUrl, fetchSocrataQuery, escapeSoQLString, normalizeBblForQuery } from "./socrata/index.js";

const VALUATIONS_DATASET_ID = "8y4t-faws";

export interface OwnerAndTaxCodeResult {
  /** Owner from cascade (PLUTO, then valuations if col, then HPD if col); null if none. */
  owner: string | null;
  /** Whether tax code was written to details.taxCode. */
  taxCodeWritten: boolean;
}

export interface RunOwnerAndTaxCodeOptions {
  appToken?: string | null;
}

/**
 * Run owner cascade (PLUTO → valuations → HPD) and write tax code from valuations.
 * Writes owner to details.ownerInfo when we have one so the UI and downstream steps see it
 * even when permits returns no rows. Uses bblForQueries (base BBL for condos) for lookups.
 */
export async function runOwnerAndTaxCodeStep(
  propertyId: string,
  bbl: string,
  bblForQueries: string,
  options: RunOwnerAndTaxCodeOptions = {}
): Promise<OwnerAndTaxCodeResult> {
  let owner: string | null = null;
  let taxCodeWritten = false;
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });

  const normalizedBbl = normalizeBblForQuery(bbl);
  if (!normalizedBbl) return { owner: null, taxCodeWritten: false };

  // 1. PLUTO
  try {
    const pluto = await fetchPlutoOwnerByBbl(bblForQueries, { appToken: options.appToken });
    if (pluto?.ownername && pluto.ownername.trim()) {
      owner = pluto.ownername.trim();
    }
    if (pluto?.censusBlock2010 && pluto.censusBlock2010.trim()) {
      await propertyRepo.mergeDetails(propertyId, { censusBlock2010: pluto.censusBlock2010.trim() });
    }
  } catch (e) {
    console.warn("[ownerAndTaxCode] PLUTO fetch failed for BBL", bblForQueries, e);
  }

  // 2. Valuations: always fetch for tax code; optionally use owner if dataset has column (8y4t-faws does not)
  try {
    const url = resourceUrl(VALUATIONS_DATASET_ID);
    const params = {
      $select: "parid,curtaxclass",
      $where: `parid = '${escapeSoQLString(bblForQueries)}'`,
      $order: "1",
      $limit: 1,
      $offset: 0,
    };
    const rows = await fetchSocrataQuery<{ parid?: string | null; curtaxclass?: string | null }>(url, params, {
      appToken: options.appToken,
    });
    const row = rows[0];
    if (row?.curtaxclass != null && String(row.curtaxclass).trim() !== "") {
      await propertyRepo.mergeDetails(propertyId, { taxCode: String(row.curtaxclass).trim() });
      taxCodeWritten = true;
    }
    if (!owner && row && (row as Record<string, unknown>).owner != null) {
      const ownerVal = (row as Record<string, unknown>).owner;
      if (typeof ownerVal === "string" && ownerVal.trim()) owner = ownerVal.trim();
    }
  } catch (e) {
    console.warn("[ownerAndTaxCode] Valuations fetch failed for BBL", bblForQueries, e);
  }

  // 3. HPD registration: tesw-yqqr has no owner/registrant column in schema; skip owner from HPD for now

  // Persist owner from Phase 1 so UI can show "Owner module: name, business" (PLUTO has one field → name).
  if (owner) {
    await propertyRepo.mergeDetails(propertyId, {
      ownerInfo: owner,
      ownerModuleName: owner,
      ownerModuleBusiness: null,
    });
  }

  return { owner, taxCodeWritten };
}
