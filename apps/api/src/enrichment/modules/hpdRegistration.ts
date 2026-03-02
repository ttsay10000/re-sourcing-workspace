/**
 * HPD Multiple Dwelling Registrations tesw-yqqr – by BBL only.
 * Dataset has no bbl column; we query by boro + block + lot (from BBL), then filter
 * results by constructing BBL from each row (boroid + block + lot) to match Geoclient BBL.
 */

import {
  getPool,
  PropertyRepo,
  HpdRegistrationRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, normalizeBblForQuery, bblToBoroughBlockLot, rowToBblFromBoroughBlockLot, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";

const DATASET_ID = "tesw-yqqr";
const REFRESH_CADENCE_DAYS = 30;

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
  const regRepo = new HpdRegistrationRepo({ pool });
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const now = new Date();

  const property = await propertyRepo.byId(propertyId);
  if (!property) return { ok: false, error: "Property not found" };
  const resolved = await getBBLForProperty(propertyId);
  const bbl = normalizeBblForQuery(resolved?.bbl) ?? null;
  if (!bbl) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_registration",
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
      enrichmentName: "hpd_registration",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "invalid_bbl",
      statsJson: null,
    });
    return { ok: false, error: "invalid_bbl" };
  }

  const where = `boro = '${escapeSoQLString(parts.borough)}' AND block = '${escapeSoQLString(parts.block)}' AND lot = '${escapeSoQLString(parts.lot)}'`;
  const select = "registrationid, lastregistrationdate, bin, boroid, boro, block, lot";
  const buildParams = (limit: number, offset: number): SoQLQueryParams => ({
    $select: select,
    $where: where,
    $order: "lastregistrationdate DESC",
    $limit: limit,
    $offset: offset,
  });

  try {
    const baseUrl = resourceUrl(DATASET_ID);
    const rawRows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParams, {
      appToken: options.appToken,
    });
    const rows = rawRows.filter((r) => rowToBblFromBoroughBlockLot(r) === bblForQueries);

    const row = rows[0];
    const lastRegDate = row ? parseDateToYyyyMmDd(col(row, "lastregistrationdate", "last_registration_date")) : null;
    const normalized = row
      ? {
          registrationId: col(row, "registrationid", "registration_id"),
          lastRegistrationDate: lastRegDate,
        }
      : {};

    const sourceRowId = row ? String((row as Record<string, unknown>).id ?? row.registrationid ?? "0") : null;
    if (row) {
      await regRepo.upsert({
        propertyId,
        bbl,
        bin: (row.bin as string) ?? null,
        sourceRowId,
        normalizedJson: normalized,
        rawJson: row,
      });
    }

    const summary = {
      registrationId: normalized.registrationId ?? null,
      lastRegistrationDate: normalized.lastRegistrationDate ?? null,
      lastRefreshedAt: now.toISOString(),
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.hpdRegistration", summary as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_registration",
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: { rows_fetched: rawRows.length, rows_matching_bbl: rows.length },
    });
    return { ok: true, rowsFetched: rawRows.length, rowsUpserted: row ? 1 : 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_registration",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const hpdRegistrationModule: EnrichmentModule = {
  name: "hpd_registration",
  requiredKeys: ["bbl"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
