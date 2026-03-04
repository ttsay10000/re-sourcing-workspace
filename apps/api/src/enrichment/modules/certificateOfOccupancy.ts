/**
 * Certificate of Occupancy: DOB NOW (pkdm-hqz6) first, then historical (bs8b-p36w) if 0 rows.
 * DOB NOW has bbl/bin, c_of_o_issuance_date, c_of_o_status. Historical has bbl/bin, c_o_issue_date, job_type.
 */

import {
  getPool,
  PropertyRepo,
  CertificateOfOccupancyRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, fetchSocrataQuery, normalizeBblForQuery, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { getBblBaseFromDetails } from "../propertyKeys.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DOB_NOW_DATASET_ID = "pkdm-hqz6";
const HISTORICAL_CO_DATASET_ID = "bs8b-p36w";
const REFRESH_CADENCE_DAYS = 7;

function col(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
    if (v != null && typeof v === "number") return String(v);
  }
  return null;
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const coRepo = new CertificateOfOccupancyRepo({ pool });
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const now = new Date();

  let bbl: string | null = null;
  let bblForQueries: string | null = null;

  if (options.resolvedContext?.bbl && options.resolvedContext?.bblForQueries) {
    bbl = normalizeBblForQuery(options.resolvedContext.bbl) ?? options.resolvedContext.bbl;
    bblForQueries = options.resolvedContext.bblForQueries;
  } else {
    const property = await propertyRepo.byId(propertyId);
    if (!property) return { ok: false, error: "Property not found" };
    const resolved = await getBBLForProperty(propertyId, { appToken: options.appToken });
    bbl = normalizeBblForQuery(resolved?.bbl) ?? null;
    if (!bbl) {
      await stateRepo.upsert({
        propertyId,
        enrichmentName: "certificate_of_occupancy",
        lastRefreshedAt: now,
        lastSuccessAt: null,
        lastError: "missing_bbl",
        statsJson: { rows_fetched: 0 },
      });
      return { ok: false, error: "missing_bbl" };
    }
    const bblBase = getBblBaseFromDetails(property.details as Record<string, unknown>);
    bblForQueries = bblBase ?? (await resolveCondoBblForQuery(bbl, { appToken: options.appToken })) ?? bbl;
  }

  if (!bbl || !bblForQueries) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "certificate_of_occupancy",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bbl",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bbl" };
  }

  // CO dataset pkdm-hqz6: job_filing_name / c_of_o_number = job number (CO ID), c_of_o_issuance_date = CO issue date.
  const select =
    "bbl, bin, job_type, job_filing_name, c_of_o_number, c_of_o_status, c_of_o_filing_type, c_of_o_issuance_date, number_of_dwelling_units";
  const buildParamsByBbl = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: `bbl = '${escapeSoQLString(bblForQueries)}'`,
    $order: "c_of_o_issuance_date DESC",
    $limit: limit,
    $offset: offset,
  });

  try {
    const baseUrl = resourceUrl(DOB_NOW_DATASET_ID);
    let rows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParamsByBbl, {
      appToken: options.appToken,
    });

    // Fallback 1: if BBL returns 0 rows and we have BIN, try DOB NOW by BIN.
    if (rows.length === 0) {
      let binForFallback: string | null = options.resolvedContext?.bin ?? null;
      if (!binForFallback) {
        const prop = await propertyRepo.byId(propertyId);
        const det = (prop?.details as Record<string, unknown>) ?? {};
        const binVal = det.bin;
        if (typeof binVal === "string" && binVal.trim()) binForFallback = binVal.trim();
      }
      if (binForFallback) {
        const buildParamsByBin = (limit: number, offset: number): SoQLQueryParams => ({
          $select: select,
          $where: `bin = '${escapeSoQLString(binForFallback)}'`,
          $order: "c_of_o_issuance_date DESC",
          $limit: limit,
          $offset: offset,
        });
        rows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParamsByBin, {
          appToken: options.appToken,
        });
      }
    }

    // Fallback 2: if still 0 rows, try historical CO dataset (bs8b-p36w): job_number (CO ID), job_type, c_o_issue_date, bbl, bin.
    let source: "dob_now" | "historical" = "dob_now";
    if (rows.length === 0) {
      const histUrl = resourceUrl(HISTORICAL_CO_DATASET_ID);
      const histParams: SoQLQueryParams = {
        $select: "bbl, bin, job_number, job_type, c_o_issue_date",
        $where: `bbl = '${escapeSoQLString(bblForQueries)}'`,
        $order: "c_o_issue_date DESC",
        $limit: 1,
        $offset: 0,
      };
      const histRows = await fetchSocrataQuery<Record<string, unknown>>(histUrl, histParams, {
        appToken: options.appToken,
      });
      if (histRows.length > 0) {
        rows = histRows;
        source = "historical";
      }
    }
    if (rows.length === 0 && source === "dob_now") {
      let binForHist: string | null = options.resolvedContext?.bin ?? null;
      if (!binForHist) {
        const prop = await propertyRepo.byId(propertyId);
        const det = (prop?.details as Record<string, unknown>) ?? {};
        if (typeof det.bin === "string" && det.bin.trim()) binForHist = det.bin.trim();
      }
      if (binForHist) {
        const histUrl = resourceUrl(HISTORICAL_CO_DATASET_ID);
        const histParamsBin: SoQLQueryParams = {
          $select: "bbl, bin, job_number, job_type, c_o_issue_date",
          $where: `bin = '${escapeSoQLString(binForHist)}'`,
          $order: "c_o_issue_date DESC",
          $limit: 1,
          $offset: 0,
        };
        const histRowsBin = await fetchSocrataQuery<Record<string, unknown>>(histUrl, histParamsBin, {
          appToken: options.appToken,
        });
        if (histRowsBin.length > 0) {
          rows = histRowsBin;
          source = "historical";
        }
      }
    }

    if (process.env.ENRICHMENT_DEBUG) {
      const first = rows[0] as Record<string, unknown> | undefined;
      const firstBbl = first?.bbl ?? null;
      const firstBin = first?.bin ?? null;
      console.log(`[enrichment:co] BBL=${bblForQueries} source=${source} rows=${rows.length} first_row.bbl=${firstBbl ?? "—"} first_row.bin=${firstBin ?? "—"}`);
    }

    const row = rows[0];
    const isHistorical = source === "historical";
    const issuanceDate = row
      ? parseDateToYyyyMmDd(
          col(row, "c_of_o_issuance_date", "co_issuance_date", "c_o_issue_date")
        )
      : null;
    // jobNumber = CO ID: DOB NOW has c_of_o_number, job_filing_name; historical has job_number.
    const jobNumber = col(row, "c_of_o_number", "job_filing_name", "job_number");
    const normalized = row
      ? {
          jobNumber: jobNumber ?? null,
          jobType: col(row, "job_type", "job_type"),
          status: isHistorical ? "Historical" : col(row, "c_of_o_status", "co_status"),
          filingType: isHistorical ? null : col(row, "c_of_o_filing_type", "co_filing_type"),
          issuanceDate,
          dwellingUnits: row.number_of_dwelling_units != null ? Number(row.number_of_dwelling_units) : null,
        }
      : {};

    const sourceRowId = row ? String((row as Record<string, unknown>).id ?? row.bbl ?? row.bin ?? "0") : "0";
    if (row) {
      await coRepo.upsert({
        propertyId,
        sourceRowId,
        bbl: bbl ?? null,
        bin: col(row, "bin") ?? null,
        normalizedJson: normalized,
        rawJson: row,
      });
    }

    const summary = {
      jobNumber: normalized.jobNumber ?? null,
      jobType: normalized.jobType ?? null,
      status: normalized.status ?? null,
      filingType: normalized.filingType ?? null,
      issuanceDate: normalized.issuanceDate ?? null,
      dwellingUnits: normalized.dwellingUnits ?? null,
      source: row ? source : null,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.certificateOfOccupancy", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "certificate_of_occupancy",
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: { rows_fetched: rows.length, source },
    });
    return { ok: true, rowsFetched: rows.length, rowsUpserted: row ? 1 : 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "certificate_of_occupancy",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const certificateOfOccupancyModule: EnrichmentModule = {
  name: "certificate_of_occupancy",
  requiredKeys: ["bbl"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
