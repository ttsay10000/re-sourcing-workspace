/**
 * HPD Housing Maintenance Code Violations wvxf-dwi5 – by BBL only.
 * Dataset has no bbl column; we query by boro + block + lot (from BBL), then filter
 * results by constructing BBL from each row (boroid + block + lot) to match Geoclient BBL.
 */

import {
  getPool,
  PropertyRepo,
  HpdViolationsRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, normalizeBblForQuery, bblToBoroughBlockLot, rowToBblFromBoroughBlockLot, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DATASET_ID = "wvxf-dwi5";
const REFRESH_CADENCE_DAYS = 7;

function col(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
    if (v != null && typeof v === "number") return String(v);
  }
  return null;
}

function rowId(row: Record<string, unknown>): string {
  const id = row.violationid ?? row.violation_id ?? row.id;
  if (id != null) return String(id);
  return JSON.stringify({
    b: rowToBblFromBoroughBlockLot(row) ?? row.boroid,
    s: row.story,
    c: row.class,
    d: row.approveddate ?? row.approved_date,
  });
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const violationsRepo = new HpdViolationsRepo({ pool });
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const now = new Date();

  const property = await propertyRepo.byId(propertyId);
  if (!property) return { ok: false, error: "Property not found" };
  const resolved = await getBBLForProperty(propertyId);
  const bbl = normalizeBblForQuery(resolved?.bbl) ?? null;
  if (!bbl) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_violations",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bbl",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bbl" };
  }
  const bblForQueries = (await resolveCondoBblForQuery(bbl, { appToken: options.appToken })) ?? bbl;

  const parts = bblToBoroughBlockLot(bblForQueries);
  if (!parts) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_violations",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "invalid_bbl",
      statsJson: null,
    });
    return { ok: false, error: "invalid_bbl" };
  }

  const where = `boro = '${escapeSoQLString(parts.borough)}' AND block = '${escapeSoQLString(parts.block)}' AND lot = '${escapeSoQLString(parts.lot)}'`;
  const select =
    "violationid, boroid, boro, block, lot, story, class, approveddate, novdescription, currentstatus, violationstatus, rentimpairing";
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: where,
    $order: "approveddate DESC",
    $limit: limit,
    $offset: offset,
  });

  try {
    const baseUrl = resourceUrl(DATASET_ID);
    const rawRows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParams, {
      appToken: options.appToken,
    });
    const rows = rawRows.filter((r) => rowToBblFromBoroughBlockLot(r) === bblForQueries);

    let upserted = 0;
    for (const row of rows) {
      const approvedDate = parseDateToYyyyMmDd(col(row, "approveddate", "approved_date"));
      const normalized = {
        violationId: col(row, "violationid", "violation_id"),
        story: col(row, "story"),
        class: col(row, "class"),
        approvedDate,
        novDescription: col(row, "novdescription", "nov_description"),
        currentStatus: col(row, "currentstatus", "current_status"),
        violationStatus: col(row, "violationstatus", "violation_status"),
        rentImpairing: row.rentimpairing ?? row.rent_impairing,
      };
      await violationsRepo.upsert({
        propertyId,
        sourceRowId: rowId(row),
        bbl,
        bin: col(row, "bin") ?? null,
        normalizedJson: normalized,
        rawJson: row,
      });
      upserted++;
    }

    const byClass: Record<string, number> = {};
    let rentImpairingOpen = 0;
    let openCount = 0;
    let closedCount = 0;
    let mostRecentApprovedDate: string | null = null;
    for (const row of rows) {
      const c = col(row, "class", "class") ?? "unknown";
      byClass[c] = (byClass[c] ?? 0) + 1;
      const status = (col(row, "currentstatus", "current_status") ?? "").toLowerCase();
      if (status.includes("open")) openCount++;
      else closedCount++;
      const impairing = row.rentimpairing ?? row.rent_impairing;
      if (impairing === true || impairing === "Y" || impairing === "Yes") {
        if (status.includes("open")) rentImpairingOpen++;
      }
      const d = parseDateToYyyyMmDd(col(row, "approveddate", "approved_date"));
      if (d && (!mostRecentApprovedDate || d > mostRecentApprovedDate)) mostRecentApprovedDate = d;
    }

    const summary = {
      total: rows.length,
      byClass,
      rentImpairingOpen,
      openCount,
      closedCount,
      mostRecentApprovedDate,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.hpd_violations_summary", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_violations",
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: { rows_fetched: rawRows.length, rows_matching_bbl: rows.length, rows_upserted: upserted },
    });
    return { ok: true, rowsFetched: rows.length, rowsUpserted: upserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_violations",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const hpdViolationsModule: EnrichmentModule = {
  name: "hpd_violations",
  requiredKeys: ["bbl"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
