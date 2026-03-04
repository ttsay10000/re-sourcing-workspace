/**
 * Housing Litigations 59kj-x8nc – multi-row by BBL only.
 * Dataset has bbl column; we do not use BIN (Geoclient BIN unreliable).
 */

import {
  getPool,
  PropertyRepo,
  HousingLitigationsRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, normalizeBblForQuery, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { getBblBaseFromDetails } from "../propertyKeys.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DATASET_ID = "59kj-x8nc";
const REFRESH_CADENCE_DAYS = 7;

function col(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
    if (v != null && typeof v === "number") return String(v);
  }
  return null;
}

function num(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  const n = parseFloat(String(val).replace(/[$,]/g, ""));
  return Number.isNaN(n) ? null : n;
}

function rowId(row: Record<string, unknown>): string {
  const id = row.caseid ?? row.case_id ?? row.id ?? row.unique_id;
  if (id != null) return String(id);
  return JSON.stringify({
    t: row.casetype,
    d: row.findingdate,
    r: row.respondent,
  });
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const litRepo = new HousingLitigationsRepo({ pool });
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
        enrichmentName: "housing_litigations",
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
      enrichmentName: "housing_litigations",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bbl",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bbl" };
  }

  const where = `bbl = '${escapeSoQLString(bblForQueries)}'`;
  const select =
    "bbl, bin, casetype, casestatus, casejudgement, caseopendate, respondent";
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: where,
    $order: "caseopendate DESC",
    $limit: limit,
    $offset: offset,
  });

  try {
    const baseUrl = resourceUrl(DATASET_ID);
    const rows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParams, {
      appToken: options.appToken,
    });

    let upserted = 0;
    for (const row of rows) {
      const caseOpenDate = parseDateToYyyyMmDd(col(row, "caseopendate", "case_open_date"));
      const normalized = {
        caseType: col(row, "casetype", "case_type"),
        caseStatus: col(row, "casestatus", "case_status"),
        openJudgement: row.casejudgement ?? row.case_judgement ?? row.openjudgement ?? row.open_judgement,
        findingDate: caseOpenDate,
        penalty: num(row.penalty),
        respondent: col(row, "respondent"),
      };
      await litRepo.upsert({
        propertyId,
        sourceRowId: rowId(row),
        bbl: bbl ?? null,
        bin: col(row, "bin") ?? null,
        normalizedJson: normalized,
        rawJson: row,
      });
      upserted++;
    }

    let openCount = 0;
    let lastFindingDate: string | null = null;
    let totalPenalty = 0;
    const byCaseType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const row of rows) {
      const status = (col(row, "casestatus", "case_status") ?? "").toLowerCase();
      if (status.includes("open")) openCount++;
      byStatus[status || "unknown"] = (byStatus[status || "unknown"] ?? 0) + 1;
      const ct = col(row, "casetype", "case_type") ?? "unknown";
      byCaseType[ct] = (byCaseType[ct] ?? 0) + 1;
      const d = parseDateToYyyyMmDd(col(row, "findingdate", "finding_date"));
      if (d && (!lastFindingDate || d > lastFindingDate)) lastFindingDate = d;
      const p = num(row.penalty);
      if (p != null) totalPenalty += p;
    }

    const summary = {
      total: rows.length,
      openCount,
      lastFindingDate,
      totalPenalty,
      byCaseType,
      byStatus,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.housing_litigations_summary", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "housing_litigations",
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: { rows_fetched: rows.length, rows_upserted: upserted },
    });
    return { ok: true, rowsFetched: rows.length, rowsUpserted: upserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "housing_litigations",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const housingLitigationsModule: EnrichmentModule = {
  name: "housing_litigations",
  requiredKeys: ["bbl"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
