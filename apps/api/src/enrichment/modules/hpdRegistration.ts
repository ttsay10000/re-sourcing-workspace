/**
 * HPD Multiple Dwelling Registrations tesw-yqqr – by BBL (boro+block+lot) first, then by address (housenumber+streetname+zip) if 0 rows.
 * Dataset has no bbl column; we query by boro + block + lot (from BBL), then filter
 * results by constructing BBL from each row. If 0 rows, second check: housenumber + streetname + zip.
 */

import {
  getPool,
  PropertyRepo,
  MatchRepo,
  ListingRepo,
  HpdRegistrationRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { resourceUrl, escapeSoQLString, fetchAllPages, fetchSocrataQuery, normalizeBblForQuery, bblToBoroughBlockLot, rowToBblFromBoroughBlockLot, type SoQLQueryParams } from "../socrata/index.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { getBblBaseFromDetails } from "../propertyKeys.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import { normalizeHouseNo, normalizeStreetName } from "../permits/normalizers.js";
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

/** Split "123 Main St" into house no and street name. */
function splitAddress(address: string): { houseNo: string; streetName: string } {
  const parts = address.trim().split(/\s+/);
  if (parts.length === 0) return { houseNo: "", streetName: "" };
  if (parts.length === 1) return { houseNo: parts[0] ?? "", streetName: "" };
  const houseNo = parts[0] ?? "";
  const streetName = parts.slice(1).join(" ");
  return { houseNo, streetName };
}

/** Resolve housenumber, streetname, zip for HPD address fallback. Uses linked listing or canonicalAddress. */
async function resolveAddressForHpd(
  propertyId: string,
  propertyRepo: PropertyRepo,
  matchRepo: MatchRepo,
  listingRepo: ListingRepo
): Promise<{ houseNo: string; streetName: string; zip: string } | null> {
  const property = await propertyRepo.byId(propertyId);
  if (!property) return null;
  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  const match = matches[0];
  const listing = match ? await listingRepo.byId(match.listingId) : null;
  const addressLine = listing?.address?.trim() ?? (property.canonicalAddress ?? "").split(",")[0]?.trim() ?? "";
  const { houseNo: h, streetName: s } = splitAddress(addressLine);
  const houseNo = normalizeHouseNo(h);
  const streetName = normalizeStreetName(s);
  let zip = listing?.zip?.trim() ?? "";
  if (!zip && property.canonicalAddress) {
    const parts = property.canonicalAddress.split(",").map((p) => p.trim());
    const last = parts[parts.length - 1] ?? "";
    const zipMatch = last.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zipMatch) zip = zipMatch[1];
  }
  if (!houseNo || !streetName || !zip) return null;
  return { houseNo, streetName, zip };
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const regRepo = new HpdRegistrationRepo({ pool });
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
        enrichmentName: "hpd_registration",
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
      enrichmentName: "hpd_registration",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: "missing_bbl",
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: "missing_bbl" };
  }

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

  // HPD dataset tesw-yqqr has block/lot as text; use quoted string in $where so SoQL matches.
  // Use unpadded block/lot (e.g. 1382, 133) to match how the API returns values (e.g. "450", "31").
  const blockNum = parseInt(parts.block, 10);
  const lotNum = parseInt(parts.lot, 10);
  if (Number.isNaN(blockNum) || Number.isNaN(lotNum)) {
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
  const where = `boro = '${escapeSoQLString(parts.borough)}' AND block = '${escapeSoQLString(String(blockNum))}' AND lot = '${escapeSoQLString(String(lotNum))}'`;
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
    let rawRows = await fetchAllPages<Record<string, unknown>>(baseUrl, buildParams, {
      appToken: options.appToken,
    });
    let rows = rawRows.filter((r) => rowToBblFromBoroughBlockLot(r) === bblForQueries);

    if (process.env.ENRICHMENT_DEBUG) {
      const first = rawRows[0] as Record<string, unknown> | undefined;
      const rowBbl = first ? rowToBblFromBoroughBlockLot(first) : null;
      console.log(`[enrichment:hpd_reg] boro=${parts.borough} block=${parts.block} lot=${parts.lot} raw_rows=${rawRows.length} matching_bbl=${rows.length} first_row.bbl=${rowBbl ?? "—"}`);
    }

    // Second check: if 0 rows from boro/block/lot, query by housenumber + streetname + zip.
    if (rows.length === 0) {
      const addr = await resolveAddressForHpd(propertyId, propertyRepo, matchRepo, listingRepo);
      if (addr) {
        const whereAddr =
          `housenumber = '${escapeSoQLString(addr.houseNo)}' AND streetname = '${escapeSoQLString(addr.streetName)}' AND zip = '${escapeSoQLString(addr.zip)}'`;
        const paramsAddr: SoQLQueryParams = {
          $select: select,
          $where: whereAddr,
          $order: "lastregistrationdate DESC",
          $limit: 10,
          $offset: 0,
        };
        const addressRows = await fetchSocrataQuery<Record<string, unknown>>(baseUrl, paramsAddr, {
          appToken: options.appToken,
        });
        if (addressRows.length > 0) {
          const matching = addressRows.filter((r) => rowToBblFromBoroughBlockLot(r) === bblForQueries);
          rows = matching.length > 0 ? matching : addressRows;
          rawRows = addressRows;
        }
      }
    }

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
