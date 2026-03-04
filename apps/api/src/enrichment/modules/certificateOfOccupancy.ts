/**
 * DOB NOW Certificate of Occupancy pkdm-hqz6 – by BBL only.
 * Dataset has bbl column. Fetches in batches of 1000 until exhausted (no batch limit).
 */

import {
  getPool,
  PropertyRepo,
  CertificateOfOccupancyRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, normalizeBblForQuery, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { getBblBaseFromDetails } from "../propertyKeys.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DATASET_ID = "pkdm-hqz6";
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

  const where = `bbl = '${escapeSoQLString(bblForQueries)}'`;
  const select =
    "bbl, bin, job_type, c_of_o_status, c_of_o_filing_type, c_of_o_issuance_date, number_of_dwelling_units";
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: where,
    $order: "c_of_o_issuance_date DESC",
    $limit: limit,
    $offset: offset,
  });

  try {
    const baseUrl = resourceUrl(DATASET_ID);
    const rows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParams, {
      appToken: options.appToken,
    });

    const row = rows[0];
    const issuanceDate = row ? parseDateToYyyyMmDd(col(row, "c_of_o_issuance_date", "co_issuance_date")) : null;
    const normalized = row
      ? {
          jobType: col(row, "job_type", "job_type"),
          status: col(row, "c_of_o_status", "co_status"),
          filingType: col(row, "c_of_o_filing_type", "co_filing_type"),
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
      jobType: normalized.jobType ?? null,
      status: normalized.status ?? null,
      filingType: normalized.filingType ?? null,
      issuanceDate: normalized.issuanceDate ?? null,
      dwellingUnits: normalized.dwellingUnits ?? null,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.certificateOfOccupancy", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "certificate_of_occupancy",
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: { rows_fetched: rows.length },
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
