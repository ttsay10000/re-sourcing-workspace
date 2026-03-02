/**
 * NYC Zoning Tax Lot Database (ZTL) fdkv-4t4z – lookup by BBL.
 * Fetches in batches of 1000 until result found or dataset exhausted (no batch limit).
 */

import {
  getPool,
  PropertyRepo,
  ZoningZtlRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, normalizeBblForQuery, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { getBblBaseFromDetails } from "../propertyKeys.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DATASET_ID = "fdkv-4t4z";
const REFRESH_CADENCE_DAYS = 30;

function col(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const zoningRepo = new ZoningZtlRepo({ pool });
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const now = new Date();

  let property = await propertyRepo.byId(propertyId);
  if (!property) return { ok: false, error: "Property not found" };
  const resolved = await getBBLForProperty(propertyId, { appToken: options.appToken });
  const bbl = normalizeBblForQuery(resolved?.bbl) ?? null;
  if (!bbl) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "zoning_ztl",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bbl",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bbl" };
  }
  property = (await propertyRepo.byId(propertyId)) ?? property;
  const bblBase = getBblBaseFromDetails(property.details as Record<string, unknown>);
  const bblForQueries = bblBase ?? (await resolveCondoBblForQuery(bbl, { appToken: options.appToken })) ?? bbl;

  const where = `bbl = '${escapeSoQLString(bblForQueries)}'`;
  const select =
    "bbl, borough_code, tax_block, tax_lot, zoning_district_1, zoning_district_2, special_district_1, zoning_map_number, zoning_map_code";
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: where,
    $order: "1",
    $limit: limit,
    $offset: offset,
  });

  try {
    const baseUrl = resourceUrl(DATASET_ID);
    const rows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParams, {
      appToken: options.appToken,
    });

    const row = rows[0];
    const normalized = row
      ? {
          zoningDistrict1: col(row, "zoningdistrict1", "zoning_district_1"),
          zoningDistrict2: col(row, "zoningdistrict2", "zoning_district_2"),
          specialDistrict1: col(row, "specialdistrict1", "special_district_1"),
          zoningMapNumber: col(row, "zoningmapnumber", "zoning_map_number"),
          zoningMapCode: col(row, "zoningmapcode", "zoning_map_code"),
        }
      : {};

    const rid = row && (row.id ?? (row.bbl ?? (row.borough_code != null && row.tax_block != null && row.tax_lot != null ? `${row.borough_code}-${row.tax_block}-${row.tax_lot}` : null)));
    const sourceRowId = rid != null ? String(rid) : null;
    await zoningRepo.upsert({
      propertyId,
      bbl,
      sourceRowId,
      normalizedJson: normalized,
      rawJson: row ?? {},
    });

    const summary = {
      zoningDistrict1: normalized.zoningDistrict1 ?? null,
      zoningDistrict2: normalized.zoningDistrict2 ?? null,
      specialDistrict1: normalized.specialDistrict1 ?? null,
      zoningMapNumber: normalized.zoningMapNumber ?? null,
      zoningMapCode: normalized.zoningMapCode ?? null,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.zoning", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "zoning_ztl",
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: { rows_fetched: rows.length, duration_ms: 0 },
    });
    return { ok: true, rowsFetched: rows.length, rowsUpserted: rows.length ? 1 : 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "zoning_ztl",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const zoningZtlModule: EnrichmentModule = {
  name: "zoning_ztl",
  requiredKeys: ["bbl"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
