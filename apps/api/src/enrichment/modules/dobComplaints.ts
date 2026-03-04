/**
 * DOB Complaints Received eabe-havv – multi-row by BIN only.
 * Dataset has no BBL column; only BIN is available for filtering.
 */

import {
  getPool,
  PropertyRepo,
  DobComplaintsRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DATASET_ID = "eabe-havv";
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
  const id = row.unique_key ?? row.uniquekey ?? row.id ?? row.complaint_number;
  if (id != null) return String(id);
  return JSON.stringify({
    d: row.dateentered ?? row.date_entered,
    u: row.unit,
    s: row.status,
  });
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const complaintsRepo = new DobComplaintsRepo({ pool });
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const now = new Date();

  let bin: string | null = null;
  if (options.resolvedContext?.bin != null && String(options.resolvedContext.bin).trim() !== "") {
    bin = String(options.resolvedContext.bin).trim();
  } else {
    const property = await propertyRepo.byId(propertyId);
    if (!property) return { ok: false, error: "Property not found" };
    const resolved = await getBBLForProperty(propertyId, { appToken: options.appToken });
    bin = resolved?.bin ?? null;
  }
  if (!bin) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "dob_complaints",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bin",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bin" };
  }

  const where = `bin = '${escapeSoQLString(bin)}'`;
  const select =
    "bin, date_entered, status, unit, disposition_date, complaint_category";
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: where,
    $order: "date_entered DESC",
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
      const dateEntered = parseDateToYyyyMmDd(col(row, "date_entered", "dateentered"));
      const dispositionDate = parseDateToYyyyMmDd(col(row, "disposition_date", "dispositiondate"));
      const normalized = {
        dateEntered,
        status: col(row, "status"),
        unit: col(row, "unit"),
        dispositionDate,
        complaintCategory: col(row, "complaint_category", "complaintcategory"),
      };
      await complaintsRepo.upsert({
        propertyId,
        sourceRowId: rowId(row),
        bin,
        normalizedJson: normalized,
        rawJson: row,
      });
      upserted++;
    }

    const nowMs = Date.now();
    const oneDay = 86400 * 1000;
    const count30 = rows.filter((r: Record<string, unknown>) => {
      const d = parseDateToYyyyMmDd(col(r, "dateentered", "date_entered"));
      if (!d) return false;
      const t = new Date(d).getTime();
      return nowMs - t <= 30 * oneDay;
    }).length;
    const count90 = rows.filter((r: Record<string, unknown>) => {
      const d = parseDateToYyyyMmDd(col(r, "dateentered", "date_entered"));
      if (!d) return false;
      const t = new Date(d).getTime();
      return nowMs - t <= 90 * oneDay;
    }).length;
    const count365 = rows.filter((r: Record<string, unknown>) => {
      const d = parseDateToYyyyMmDd(col(r, "dateentered", "date_entered"));
      if (!d) return false;
      const t = new Date(d).getTime();
      return nowMs - t <= 365 * oneDay;
    }).length;
    let openCount = 0;
    let closedCount = 0;
    const categoryCounts: Record<string, number> = {};
    for (const row of rows) {
      const status = (col(row, "status") ?? "").toLowerCase();
      if (status.includes("open")) openCount++;
      else closedCount++;
      const cat = col(row, "complaintcategory", "complaint_category") ?? "Other";
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }
    const topCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const summary = {
      count30,
      count90,
      count365,
      openCount,
      closedCount,
      topCategories,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.dob_complaints_summary", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "dob_complaints",
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
      enrichmentName: "dob_complaints",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const dobComplaintsModule: EnrichmentModule = {
  name: "dob_complaints",
  requiredKeys: ["bin"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
