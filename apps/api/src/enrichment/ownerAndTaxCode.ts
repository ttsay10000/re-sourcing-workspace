/**
 * Phase 1 owner cascade + tax code: PLUTO → valuations (tax code) → HPD (owner if col).
 * Writes owner to details.ownerInfo when we get it (so we don't rely on permits to persist it).
 * Also returns cascade owner for the permits step so permits_summary can merge for backward compat.
 * From valuations (8y4t-faws) also persists: owner (as ownerValuations), curmkttot/curacttot/curtxbtot,
 * gross_sqft, land_area, residential/office/retail_area_gross, appt_date, extracrdt.
 */

import { getPool, PropertyRepo } from "@re-sourcing/db";
import { fetchPlutoOwnerByBbl } from "./plutoOwner.js";
import { resourceUrl, fetchSocrataQuery, escapeSoQLString, normalizeBblForQuery } from "./socrata/index.js";

const VALUATIONS_DATASET_ID = "8y4t-faws";

const VALUATIONS_SELECT =
  "parid,curtaxclass,owner,curmkttot,curacttot,curtxbtot,gross_sqft,land_area,residential_area_gross,office_area_gross,retail_area_gross,appt_date,extracrdt";

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isNaN(n) ? null : n;
}

function parseDate(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v.trim() : String(v);
  return s === "" ? null : s;
}

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

  // 2. Valuations: tax code, owner (cascade), and assessment data (valuation $, sqft, dates)
  try {
    const url = resourceUrl(VALUATIONS_DATASET_ID);
    const params = {
      $select: VALUATIONS_SELECT,
      $where: `parid = '${escapeSoQLString(bblForQueries)}'`,
      $order: "1",
      $limit: 1,
      $offset: 0,
    };
    type ValuationsRow = {
      parid?: string | null;
      curtaxclass?: string | null;
      owner?: string | null;
      curmkttot?: number | string | null;
      curacttot?: number | string | null;
      curtxbtot?: number | string | null;
      gross_sqft?: number | string | null;
      land_area?: number | string | null;
      residential_area_gross?: number | string | null;
      office_area_gross?: number | string | null;
      retail_area_gross?: number | string | null;
      appt_date?: string | null;
      extracrdt?: string | null;
    };
    const rows = await fetchSocrataQuery<ValuationsRow>(url, params, {
      appToken: options.appToken,
    });
    const row = rows[0];
    if (row?.curtaxclass != null && String(row.curtaxclass).trim() !== "") {
      await propertyRepo.mergeDetails(propertyId, { taxCode: String(row.curtaxclass).trim() });
      taxCodeWritten = true;
    }
    if (!owner && row?.owner != null && String(row.owner).trim() !== "") {
      owner = String(row.owner).trim();
    }
    // Persist valuations-only owner for UI "Owner (Valuations module): XXXX" and all assessment fields
    const ownerValuations =
      row?.owner != null && String(row.owner).trim() !== "" ? String(row.owner).trim() : null;
    const merge: Record<string, unknown> = {};
    if (ownerValuations != null) merge.ownerValuations = ownerValuations;
    const curmkttot = parseNum(row?.curmkttot);
    const curacttot = parseNum(row?.curacttot);
    const curtxbtot = parseNum(row?.curtxbtot);
    if (curmkttot != null) merge.assessedMarketValue = curmkttot;
    if (curacttot != null) merge.assessedActualValue = curacttot;
    if (curtxbtot != null) merge.assessedTaxBeforeTotal = curtxbtot;
    const grossSqft = parseNum(row?.gross_sqft);
    const landArea = parseNum(row?.land_area);
    const resArea = parseNum(row?.residential_area_gross);
    const offArea = parseNum(row?.office_area_gross);
    const retArea = parseNum(row?.retail_area_gross);
    if (grossSqft != null) merge.assessedGrossSqft = grossSqft;
    if (landArea != null) merge.assessedLandArea = landArea;
    if (resArea != null) merge.assessedResidentialAreaGross = resArea;
    if (offArea != null) merge.assessedOfficeAreaGross = offArea;
    if (retArea != null) merge.assessedRetailAreaGross = retArea;
    const apptDate = parseDate(row?.appt_date);
    const extractDate = parseDate(row?.extracrdt);
    if (apptDate != null) merge.assessedApptDate = apptDate;
    if (extractDate != null) merge.assessedExtractDate = extractDate;
    if (Object.keys(merge).length > 0) {
      await propertyRepo.mergeDetails(propertyId, merge);
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
