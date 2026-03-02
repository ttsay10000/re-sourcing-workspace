/**
 * Affordable Housing Production by Building hg8x-zxpr – multi-row by BBL or BIN; summary from latest by completion date.
 */

import {
  getPool,
  PropertyRepo,
  AffordableHousingRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, type SoQLQueryParams } from "../socrata/index.js";
import { getBblFromDetails, getBinFromDetails } from "../propertyKeys.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DATASET_ID = "hg8x-zxpr";
const REFRESH_CADENCE_DAYS = 30;

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
  const id = row.project_id ?? row.projectid ?? row.bbl ?? row.bin ?? row.id;
  if (id != null) return String(id);
  const name = col(row, "projectname", "project_name");
  const start = col(row, "projectstartdate", "project_start_date");
  return `${name ?? "p"}-${start ?? "0"}`;
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const ahRepo = new AffordableHousingRepo({ pool });
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
      enrichmentName: "affordable_housing",
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
    "bbl, bin, projectname, projectstartdate, projectcompletiondate, reportingconstructiontype, " +
    "extremelylowincomeunits, verylowincomeunits, lowincomeunits, moderateincomeunits, middleincomeunits, otherincomeunits, " +
    "studiounits, onebr, twobr, threebr, fourbr, fivebr, sixbrplus, " +
    "countedrentalunits, countedhomeownershipunits, totalunits";
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: where,
    $order: "projectcompletiondate DESC",
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
      const startDate = parseDateToYyyyMmDd(col(row, "projectstartdate", "project_start_date"));
      const completionDate = parseDateToYyyyMmDd(col(row, "projectcompletiondate", "project_completion_date"));
      const normalized = {
        projectName: col(row, "projectname", "project_name"),
        projectStartDate: startDate,
        projectCompletionDate: completionDate,
        reportingConstructionType: col(row, "reportingconstructiontype", "reporting_construction_type"),
        extremelyLowIncomeUnits: num(row.extremelylowincomeunits ?? row.extremely_low_income_units),
        veryLowIncomeUnits: num(row.verylowincomeunits ?? row.very_low_income_units),
        lowIncomeUnits: num(row.lowincomeunits ?? row.low_income_units),
        moderateIncomeUnits: num(row.moderateincomeunits ?? row.moderate_income_units),
        middleIncomeUnits: num(row.middleincomeunits ?? row.middle_income_units),
        otherIncomeUnits: num(row.otherincomeunits ?? row.other_income_units),
        studioUnits: num(row.studiounits ?? row.studio_units),
        oneBr: num(row.onebr ?? row.one_br),
        twoBr: num(row.twobr ?? row.two_br),
        threeBr: num(row.threebr ?? row.three_br),
        fourBr: num(row.fourbr ?? row.four_br),
        fiveBr: num(row.fivebr ?? row.five_br),
        sixBrPlus: num(row.sixbrplus ?? row.six_br_plus),
        countedRentalUnits: num(row.countedrentalunits ?? row.counted_rental_units),
        countedHomeownershipUnits: num(row.countedhomeownershipunits ?? row.counted_homeownership_units),
        totalUnits: num(row.totalunits ?? row.total_units),
      };
      await ahRepo.upsert({
        propertyId,
        sourceRowId: rowId(row),
        bbl: bbl ?? null,
        bin: bin ?? null,
        normalizedJson: normalized,
        rawJson: row,
      });
      upserted++;
    }

    const sorted = [...rows].sort((a, b) => {
      const da = parseDateToYyyyMmDd(col(a, "projectcompletiondate", "project_completion_date")) ?? "";
      const db = parseDateToYyyyMmDd(col(b, "projectcompletiondate", "project_completion_date")) ?? "";
      return db.localeCompare(da);
    });
    const latest = sorted[0];
    let totalAffordableByBand: Record<string, number> = {};
    let totalUnits = 0;
    for (const row of rows) {
      totalUnits += num(row.totalunits ?? row.total_units) ?? 0;
      const keys = [
        "extremelylowincomeunits", "verylowincomeunits", "lowincomeunits",
        "moderateincomeunits", "middleincomeunits", "otherincomeunits",
      ];
      for (const k of keys) {
        const v = num(row[k] ?? row[k.replace(/([A-Z])/g, "_$1").toLowerCase()]);
        if (v != null) {
          const band = k.replace(/units?$/i, "").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
          totalAffordableByBand[band] = (totalAffordableByBand[band] ?? 0) + v;
        }
      }
    }

    const summary = {
      latestProjectName: latest ? col(latest, "projectname", "project_name") : null,
      latestProjectStartDate: latest ? parseDateToYyyyMmDd(col(latest, "projectstartdate", "project_start_date")) : null,
      latestProjectCompletionDate: latest ? parseDateToYyyyMmDd(col(latest, "projectcompletiondate", "project_completion_date")) : null,
      totalAffordableByBand,
      totalUnits,
      projectCount: rows.length,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.affordable_housing_summary", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "affordable_housing",
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
      enrichmentName: "affordable_housing",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const affordableHousingModule: EnrichmentModule = {
  name: "affordable_housing",
  requiredKeys: ["bbl"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
