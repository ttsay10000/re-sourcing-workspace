/**
 * Run enrichment for a BBL/BIN locally: fetch from the same APIs as the real modules,
 * print results to stdout. No database reads or writes.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/runEnrichmentLocal.ts [BBL] [BIN]
 * Default: BBL=1004500031 (1 Avenue, Manhattan – has permits, zoning, HPD, litigations).
 * Use 1007167507 for Linea Condominium (often no rows in these datasets).
 *
 * Optional env: SOCRATA_APP_TOKEN for rate limits.
 */

import { resourceUrl, escapeSoQLString, fetchAllPages, bblToBoroughBlockLot, rowToBblFromBoroughBlockLot, normalizeBblForQuery } from "../enrichment/socrata/index.js";
import { resolveCondoBblForQuery } from "../enrichment/resolveCondoBbl.js";
import type { SoQLQueryParams } from "../enrichment/socrata/index.js";
import { buildSoQLParamsByBBL, fetchAllPermits } from "../enrichment/permits/socrataClient.js";

const DEFAULT_BBL = "1004500031";
const DEFAULT_BIN = "1000000";
const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

function getCutoffDate(): string {
  const d = new Date(Date.now() - TEN_YEARS_MS);
  return d.toISOString().slice(0, 10);
}

function opts() {
  return { appToken: process.env.SOCRATA_APP_TOKEN ?? null };
}

async function fetchPermits(bbl: string) {
  const cutoff = getCutoffDate();
  return fetchAllPermits(
    (limit, offset) => buildSoQLParamsByBBL(bbl, cutoff, limit, offset),
    { appToken: process.env.SOCRATA_APP_TOKEN ?? undefined }
  );
}

async function fetchZoning(bbl: string) {
  // Batches of 1000 until exhausted (no batch limit)
  const where = `bbl = '${escapeSoQLString(bbl)}'`;
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: "bbl, borough_code, tax_block, tax_lot, zoning_district_1, zoning_district_2, special_district_1, zoning_map_number, zoning_map_code",
    $where: where,
    $order: "1",
    $limit: limit,
    $offset: offset,
  });
  return fetchAllPages<Record<string, unknown>>(resourceUrl("fdkv-4t4z"), buildParams, opts());
}

async function fetchCertificateOfOccupancy(bbl: string | null) {
  if (!bbl) return [];
  // BBL only. Dataset pkdm-hqz6 has bbl column. Batches of 1000 until exhausted.
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: "bbl, bin, job_type, c_of_o_status, c_of_o_filing_type, c_of_o_issuance_date, number_of_dwelling_units",
    $where: `bbl = '${escapeSoQLString(bbl)}'`,
    $order: "c_of_o_issuance_date DESC",
    $limit: limit,
    $offset: offset,
  });
  return fetchAllPages<Record<string, unknown>>(resourceUrl("pkdm-hqz6"), buildParams, opts());
}

async function fetchHpdRegistration(bbl: string | null) {
  // BBL only. Dataset tesw-yqqr has no bbl column – uses boro, block, lot. Filter results by constructed BBL.
  if (!bbl) return [];
  const normalizedBbl = normalizeBblForQuery(bbl);
  if (!normalizedBbl) return [];
  const parts = bblToBoroughBlockLot(bbl);
  if (!parts) return [];
  const where = `boro = '${escapeSoQLString(parts.borough)}' AND block = '${escapeSoQLString(parts.block)}' AND lot = '${escapeSoQLString(parts.lot)}'`;
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: "registrationid, lastregistrationdate, bin, boroid, boro, block, lot",
    $where: where,
    $order: "lastregistrationdate DESC",
    $limit: limit,
    $offset: offset,
  });
  const raw = await fetchAllPages<Record<string, unknown>>(resourceUrl("tesw-yqqr"), buildParams, opts());
  return raw.filter((r) => rowToBblFromBoroughBlockLot(r) === normalizedBbl);
}

async function fetchHpdViolations(bbl: string | null) {
  // BBL only. Dataset wvxf-dwi5 has no bbl column – uses boro, block, lot. Filter results by constructed BBL.
  if (!bbl) return [];
  const normalizedBbl = normalizeBblForQuery(bbl);
  if (!normalizedBbl) return [];
  const parts = bblToBoroughBlockLot(bbl);
  if (!parts) return [];
  const where = `boro = '${escapeSoQLString(parts.borough)}' AND block = '${escapeSoQLString(parts.block)}' AND lot = '${escapeSoQLString(parts.lot)}'`;
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: "violationid, boroid, boro, block, lot, story, class, approveddate, novdescription, currentstatus, violationstatus, rentimpairing",
    $where: where,
    $order: "approveddate DESC",
    $limit: limit,
    $offset: offset,
  });
  const raw = await fetchAllPages<Record<string, unknown>>(resourceUrl("wvxf-dwi5"), buildParams, opts());
  return raw.filter((r) => rowToBblFromBoroughBlockLot(r) === normalizedBbl);
}

async function fetchDobComplaints(bin: string | null) {
  if (!bin) return [];
  const where = `bin = '${escapeSoQLString(bin)}'`;
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: "bin, date_entered, status, unit, disposition_date, complaint_category",
    $where: where,
    $order: "date_entered DESC",
    $limit: limit,
    $offset: offset,
  });
  return fetchAllPages<Record<string, unknown>>(resourceUrl("eabe-havv"), buildParams, opts());
}

async function fetchHousingLitigations(bbl: string | null) {
  if (!bbl) return [];
  // BBL only. Dataset 59kj-x8nc has bbl column.
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: "bbl, bin, casetype, casestatus, casejudgement, caseopendate, respondent",
    $where: `bbl = '${escapeSoQLString(bbl)}'`,
    $order: "caseopendate DESC",
    $limit: limit,
    $offset: offset,
  });
  return fetchAllPages<Record<string, unknown>>(resourceUrl("59kj-x8nc"), buildParams, opts());
}

async function fetchAffordableHousing(bbl: string | null) {
  if (!bbl) return [];
  // BBL only. Dataset hg8x-zxpr has bbl column.
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: "bbl, bin, project_name, project_start_date, project_completion_date, reporting_construction_type, extremely_low_income_units, very_low_income_units, low_income_units, moderate_income_units, middle_income_units, other_income_units, studio_units, total_units",
    $where: `bbl = '${escapeSoQLString(bbl)}'`,
    $order: "project_completion_date DESC",
    $limit: limit,
    $offset: offset,
  });
  return fetchAllPages<Record<string, unknown>>(resourceUrl("hg8x-zxpr"), buildParams, opts());
}

async function main(): Promise<void> {
  const bblArg = process.argv[2]?.trim() || DEFAULT_BBL;
  const bin = process.argv[3]?.trim() || DEFAULT_BIN;
  const bbl = normalizeBblForQuery(bblArg) ?? bblArg;
  const queryBbl = await resolveCondoBblForQuery(bbl, { appToken: process.env.SOCRATA_APP_TOKEN ?? undefined });
  const bblForQueries = queryBbl ?? bbl;

  console.log("Enrichment (local, no DB) for BBL=%s BIN=%s", bbl, bin);
  if (queryBbl && queryBbl !== bbl) {
    console.log("(Condo billing BBL resolved to base BBL for queries: %s)\n", bblForQueries);
  } else {
    console.log("");
  }

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const results: Record<string, unknown> = { bbl, bin, queryBblUsed: bblForQueries };

  try {
    console.log("Fetching permits...");
    results.permits = await fetchPermits(bblForQueries);
    console.log("  permits: %d rows", (results.permits as unknown[]).length);
    await delay(400);

    console.log("Fetching zoning (ZTL)...");
    results.zoning_ztl = await fetchZoning(bblForQueries);
    console.log("  zoning_ztl: %d rows", (results.zoning_ztl as unknown[]).length);
    await delay(400);

    console.log("Fetching certificate of occupancy (BBL only)...");
    results.certificate_of_occupancy = await fetchCertificateOfOccupancy(bblForQueries);
    console.log("  certificate_of_occupancy: %d rows", (results.certificate_of_occupancy as unknown[]).length);
    await delay(400);

    console.log("Fetching HPD registration (BBL only)...");
    results.hpd_registration = await fetchHpdRegistration(bblForQueries);
    console.log("  hpd_registration: %d rows", (results.hpd_registration as unknown[]).length);
    await delay(400);

    console.log("Fetching HPD violations (BBL only)...");
    results.hpd_violations = await fetchHpdViolations(bblForQueries);
    console.log("  hpd_violations: %d rows", (results.hpd_violations as unknown[]).length);
    await delay(400);

    console.log("Fetching DOB complaints...");
    results.dob_complaints = await fetchDobComplaints(bin);
    console.log("  dob_complaints: %d rows", (results.dob_complaints as unknown[]).length);
    await delay(400);

    console.log("Fetching housing litigations (BBL only)...");
    results.housing_litigations = await fetchHousingLitigations(bblForQueries);
    console.log("  housing_litigations: %d rows", (results.housing_litigations as unknown[]).length);
    await delay(400);

    console.log("Fetching affordable housing (BBL only)...");
    results.affordable_housing = await fetchAffordableHousing(bblForQueries);
    console.log("  affordable_housing: %d rows", (results.affordable_housing as unknown[]).length);
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const MAX_ROWS_PER_MODULE = 15;
  const truncated: Record<string, unknown> = { bbl: results.bbl, bin: results.bin };
  for (const [key, val] of Object.entries(results)) {
    if (key === "bbl" || key === "bin") continue;
    const arr = val as unknown[];
    if (Array.isArray(arr) && arr.length > MAX_ROWS_PER_MODULE) {
      truncated[key] = { _count: arr.length, _preview: arr.slice(0, MAX_ROWS_PER_MODULE) };
    } else {
      truncated[key] = val;
    }
  }

  console.log("\n--- Full results (all modules) ---\n");
  console.log(JSON.stringify(truncated, null, 2));
}

main();
