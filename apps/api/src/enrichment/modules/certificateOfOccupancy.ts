/**
 * DOB NOW Certificate of Occupancy pkdm-hqz6 – single row per property by BBL or BIN.
 */

import {
  getPool,
  PropertyRepo,
  CertificateOfOccupancyRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchSocrataQuery, type SoQLQueryParams } from "../socrata/index.js";
import { getBblFromDetails, getBinFromDetails } from "../propertyKeys.js";
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

  const property = await propertyRepo.byId(propertyId);
  if (!property) return { ok: false, error: "Property not found" };
  const details = (property.details as Record<string, unknown>) ?? {};
  const bbl = getBblFromDetails(details);
  const bin = getBinFromDetails(details);
  if (!bbl && !bin) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "certificate_of_occupancy",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bbl_and_bin",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bbl_and_bin" };
  }

  const conditions: string[] = [];
  if (bbl) conditions.push(`bbl = '${escapeSoQLString(bbl)}'`);
  if (bin) conditions.push(`bin = '${escapeSoQLString(bin)}'`);
  const where = conditions.join(" OR ");
  const select =
    "bbl, bin, job_type, co_status, co_filing_type, co_issuance_date, number_of_dwelling_units";
  const params: SoQLQueryParams = {
    $select: select,
    $where: where,
    $order: "co_issuance_date DESC",
    $limit: 1,
    $offset: 0,
  };

  try {
    const baseUrl = resourceUrl(DATASET_ID);
    const rows = await fetchSocrataQuery<Record<string, unknown>>(baseUrl, params, {
      appToken: options.appToken,
    });

    const row = rows[0];
    const issuanceDate = row ? parseDateToYyyyMmDd(col(row, "co_issuance_date", "co_issuance_date")) : null;
    const normalized = row
      ? {
          jobType: col(row, "job_type", "job_type"),
          status: col(row, "co_status", "co_status"),
          filingType: col(row, "co_filing_type", "co_filing_type"),
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
        bin: bin ?? null,
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
