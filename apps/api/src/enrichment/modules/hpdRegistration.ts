/**
 * HPD Multiple Dwelling Registrations tesw-yqqr – single row per property by borough+block+lot or BIN.
 */

import {
  getPool,
  PropertyRepo,
  HpdRegistrationRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchSocrataQuery, type SoQLQueryParams } from "../socrata/index.js";
import { bblToBoroughBlockLot } from "../socrata/index.js";
import { getBblFromDetails, getBinFromDetails } from "../propertyKeys.js";
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
  const details = (property.details as Record<string, unknown>) ?? {};
  const bbl = getBblFromDetails(details);
  const bin = getBinFromDetails(details);
  if (!bbl && !bin) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "hpd_registration",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bbl_and_bin",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bbl_and_bin" };
  }

  let where: string;
  const select = "registrationid, lastregistrationdate";
  if (bbl) {
    const parts = bblToBoroughBlockLot(bbl);
    if (parts) {
      where = `borough = '${escapeSoQLString(parts.borough)}' AND block = '${escapeSoQLString(parts.block)}' AND lot = '${escapeSoQLString(parts.lot)}'`;
    } else {
      where = bin ? `bin = '${escapeSoQLString(bin)}'` : "1 = 0";
    }
  } else {
    where = `bin = '${escapeSoQLString(bin!)}'`;
  }

  const params: SoQLQueryParams = {
    $select: select,
    $where: where,
    $order: "lastregistrationdate DESC",
    $limit: 1,
    $offset: 0,
  };

  try {
    const baseUrl = resourceUrl(DATASET_ID);
    const rows = await fetchSocrataQuery<Record<string, unknown>>(baseUrl, params, {
      appToken: options.appToken,
    });

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
        bbl: bbl ?? null,
        bin: bin ?? null,
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
      statsJson: { rows_fetched: rows.length },
    });
    return { ok: true, rowsFetched: rows.length, rowsUpserted: row ? 1 : 0 };
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
