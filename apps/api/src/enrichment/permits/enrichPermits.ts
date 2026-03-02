/**
 * Permit enrichment: given a canonical property, fetch DOB permits and upsert to property_permits,
 * update enrichment state, and write permits_summary to property.details.
 */

import type { Property } from "@re-sourcing/contracts";
import {
  getPool,
  PropertyRepo,
  MatchRepo,
  ListingRepo,
  PermitRepo,
  PropertyEnrichmentStateRepo,
} from "@re-sourcing/db";
import { normalizeBorough, normalizeHouseNo, normalizeStreetName, streetNameForPermitApi, parseDateToYyyyMmDd, parseEstimatedCost } from "./normalizers.js";
import { normalizeBblForQuery } from "../socrata/index.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { resolveBBLFromListing, normalizeAddressLineForDisplay } from "../resolvePropertyBBL.js";
import {
  buildSoQLParamsByBBL,
  buildSoQLParamsByAddress,
  buildSoQLParamsByAddressNoDate,
  buildSoQLParamsByBoroughAndHouseNo,
  buildSoQLParamsByBoroughAndHouseNoNoDate,
  fetchAllPermits,
  fetchPermitsPage,
} from "./socrataClient.js";
import type { SocrataPermitRow } from "./types.js";
import type { PermitsSummary } from "./types.js";

const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

function getCutoffDate(): string {
  const d = new Date(Date.now() - TEN_YEARS_MS);
  return d.toISOString().slice(0, 10);
}

/** Split "123 Main St" into house no and street name (first token vs rest). */
function splitAddress(address: string): { houseNo: string; streetName: string } {
  const parts = address.trim().split(/\s+/);
  if (parts.length === 0) return { houseNo: "", streetName: "" };
  if (parts.length === 1) return { houseNo: parts[0] ?? "", streetName: "" };
  const houseNo = parts[0] ?? "";
  const streetName = parts.slice(1).join(" ");
  return { houseNo, streetName };
}

function rowToNormalized(row: SocrataPermitRow): Record<string, unknown> {
  return {
    bbl: row.bbl ?? null,
    status: row.permit_status ?? null,
    issued_date: row.issued_date ?? null,
    approved_date: row.approved_date ?? null,
    expired_date: row.expired_date ?? null,
    work_type: row.work_type ?? null,
    applicant_first_name: row.applicant_first_name ?? null,
    applicant_last_name: row.applicant_last_name ?? null,
    applicant_business_name: row.applicant_business_name ?? null,
    owner_business_name: row.owner_business_name ?? null,
    owner_name: row.owner_name ?? null,
    job_description: row.job_description ?? null,
    estimated_job_costs: row.estimated_job_costs != null ? parseEstimatedCost(row.estimated_job_costs) : null,
  };
}

export interface EnrichPermitsOptions {
  appToken?: string | null;
}

/**
 * Enrich a single property with DOB permits: load property, resolve BBL or address from linked listing,
 * fetch permits, upsert rows, update state and property.details.enrichment.permits_summary.
 */
export async function enrichPropertyWithPermits(
  propertyId: string,
  options: EnrichPermitsOptions = {}
): Promise<{ ok: boolean; permitsFetched: number; permitsUpserted: number; error?: string }> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const permitRepo = new PermitRepo({ pool });
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });

  const now = new Date();
  const cutoffDate = getCutoffDate();

  try {
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      return { ok: false, permitsFetched: 0, permitsUpserted: 0, error: "Property not found" };
    }

    let rows: SocrataPermitRow[] = [];
    const details = property.details as Record<string, unknown> | null | undefined;
    let bblStr = (typeof details?.bbl === "string" ? details.bbl.trim() : "") ||
      (typeof details?.buildingLotBlock === "string" && /^\d{10}$/.test(String(details.buildingLotBlock).trim()) ? String(details.buildingLotBlock).trim() : "");

    // If no BBL on property, try: (1) linked listing extra.bbl/bin, (2) address-based permit lookup (exact then fuzzy).
    if (!bblStr) {
      const fromListing = await resolveBBLFromListing(matchRepo, listingRepo, property.id);
      if (fromListing?.bbl) {
        bblStr = fromListing.bbl;
        const merge: Record<string, unknown> = { bbl: fromListing.bbl };
        if (fromListing.bin) merge.bin = fromListing.bin;
        if (fromListing.lat != null) merge.lat = fromListing.lat;
        if (fromListing.lon != null) merge.lon = fromListing.lon;
        await propertyRepo.mergeDetails(propertyId, merge);
      }
    }

    // Address-based lookup: try exact then fuzzy (with 10-year date); if no rows, retry without date filter so older permits can supply BBL.
    if (!bblStr) {
      const resolved = await resolveBBLFromPermitAddress(
        property,
        propertyRepo,
        matchRepo,
        listingRepo,
        cutoffDate,
        (borough, houseNo, streetName) =>
          fetchPermitsPage(buildSoQLParamsByAddress(borough, houseNo, streetName, cutoffDate, 1, 0), { appToken: options.appToken }),
        (borough, houseNo, limit, offset) =>
          fetchPermitsPage(buildSoQLParamsByBoroughAndHouseNo(borough, houseNo, cutoffDate, limit, offset), { appToken: options.appToken }),
        (borough, houseNo, streetName) =>
          fetchPermitsPage(buildSoQLParamsByAddressNoDate(borough, houseNo, streetName, 1, 0), { appToken: options.appToken }),
        (borough, houseNo, limit, offset) =>
          fetchPermitsPage(buildSoQLParamsByBoroughAndHouseNoNoDate(borough, houseNo, limit, offset), { appToken: options.appToken })
      );
      if (resolved?.bbl) {
        bblStr = resolved.bbl;
        await propertyRepo.mergeDetails(propertyId, { bbl: resolved.bbl, ...(resolved.bin && { bin: resolved.bin }) });
      }
    }

    if (bblStr) {
      const bblNormalized = normalizeBblForQuery(bblStr);
      if (bblNormalized) bblStr = bblNormalized;
      const bblForQueries = (await resolveCondoBblForQuery(bblStr, { appToken: options.appToken })) ?? bblStr;
      await propertyRepo.mergeDetails(propertyId, { bblBase: bblForQueries });
      rows = await fetchAllPermits(
        (limit, offset) => buildSoQLParamsByBBL(bblForQueries, cutoffDate, limit, offset),
        { appToken: options.appToken }
      );
    } else {
      const { borough, houseNo, streetName } = await resolveAddressFromListing(
        property,
        propertyRepo,
        matchRepo,
        listingRepo
      );
      if (!borough || !houseNo || !streetName) {
        await stateRepo.upsert({
          propertyId,
          enrichmentName: "permits",
          lastRefreshedAt: now,
          lastSuccessAt: null,
          lastError: "No BBL and could not resolve address from listing or canonical_address",
          statsJson: { permits_fetched: 0, permits_upserted: 0 },
        });
        return { ok: false, permitsFetched: 0, permitsUpserted: 0, error: "No BBL or address" };
      }
      const variants = streetNameForPermitApi(streetName);
      const streetToUse = variants[0] ?? streetName;
      rows = await fetchAllPermits(
        (limit, offset) =>
          buildSoQLParamsByAddress(borough, houseNo, streetToUse, cutoffDate, limit, offset),
        { appToken: options.appToken }
      );
    }

    let upserted = 0;
    for (const row of rows) {
      const workPermit = row.work_permit ?? row.job_filing_number ?? "";
      if (!workPermit) continue;
      await permitRepo.upsert({
        propertyId,
        source: "dob_build_rbx6_tga4",
        workPermit: String(workPermit),
        sequenceNumber: row.sequence_number != null ? Number(row.sequence_number) : null,
        trackingNumber: row.tracking_number ?? null,
        bbl: row.bbl ?? null,
        status: row.permit_status ?? null,
        issuedDate: parseDateToYyyyMmDd(row.issued_date) ?? null,
        approvedDate: parseDateToYyyyMmDd(row.approved_date) ?? null,
        expiredDate: parseDateToYyyyMmDd(row.expired_date) ?? null,
        normalizedJson: rowToNormalized(row),
        rawJson: row as Record<string, unknown>,
      });
      upserted++;
    }

    const summary = buildPermitsSummary(rows);
    // Don't overwrite existing owner: many rows may match BBL/address; we want the first (most recent) only and to keep it once set.
    const current = await propertyRepo.byId(propertyId);
    const currentDetails = current?.details as Record<string, unknown> | null | undefined;
    const existingPs = currentDetails?.enrichment as Record<string, unknown> | undefined;
    const existingSummary = existingPs?.permits_summary as Record<string, unknown> | undefined;
    const existingOwnerName = existingSummary?.owner_name;
    const existingOwnerBusiness = existingSummary?.owner_business_name;
    const mergedSummary: Record<string, unknown> = {
      ...summary,
      owner_name: existingOwnerName != null && String(existingOwnerName).trim() !== "" ? existingOwnerName : (summary as Record<string, unknown>).owner_name,
      owner_business_name: existingOwnerBusiness != null && String(existingOwnerBusiness).trim() !== "" ? existingOwnerBusiness : (summary as Record<string, unknown>).owner_business_name,
    };
    await propertyRepo.updateDetails(propertyId, "enrichment.permits_summary", mergedSummary);

    await stateRepo.upsert({
      propertyId,
      enrichmentName: "permits",
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: { permits_fetched: rows.length, permits_upserted: upserted },
    });

    return { ok: true, permitsFetched: rows.length, permitsUpserted: upserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: "permits",
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, permitsFetched: 0, permitsUpserted: 0, error: message };
  }
}

/**
 * Resolve borough, houseNo, streetName for permit/address lookups. Uses same normalization as
 * test flow and getBBLForProperty: strip listing-type suffixes (MULTIFAMILY, CONDO, etc.) so
 * permit API and Geoclient see the same clean address.
 */
async function resolveAddressFromListing(
  property: Property,
  _propertyRepo: PropertyRepo,
  matchRepo: MatchRepo,
  listingRepo: ListingRepo
): Promise<{ borough: string; houseNo: string; streetName: string }> {
  const { matches } = await matchRepo.list({ propertyId: property.id, limit: 1 });
  const match = matches[0];
  if (match) {
    const listing = await listingRepo.byId(match.listingId);
    if (listing) {
      const borough = normalizeBorough(listing.city);
      const addressLine = normalizeAddressLineForDisplay(listing.address?.trim() ?? "");
      const { houseNo, streetName } = splitAddress(addressLine);
      const h = normalizeHouseNo(houseNo);
      const s = normalizeStreetName(streetName);
      if (borough && h && s) return { borough, houseNo: h, streetName: s };
    }
  }

  const addr = property.canonicalAddress || "";
  const commaIdx = addr.indexOf(",");
  const addressPart = normalizeAddressLineForDisplay(commaIdx >= 0 ? addr.slice(0, commaIdx).trim() : addr.trim());
  const rest = commaIdx >= 0 ? addr.slice(commaIdx + 1).trim() : "";
  const borough = normalizeBorough(rest.split(",")[0]?.trim() ?? "");
  const { houseNo, streetName } = splitAddress(addressPart);
  return {
    borough,
    houseNo: normalizeHouseNo(houseNo),
    streetName: normalizeStreetName(streetName),
  };
}

/** Normalize for fuzzy compare: single space, uppercase. */
function norm(s: string): string {
  return String(s).toUpperCase().replace(/\s+/g, " ").trim();
}

/** Extract digit sequences from street name (e.g. "22" from "WEST 22ND ST"). Used to require street number match in fuzzy fallback. */
function streetNumbersIn(streetName: string): string[] {
  const matches = String(streetName).match(/\d+/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Resolve BBL/BIN from permit API by address: try exact match with permit-style street variants,
 * then fallback to borough+house_no fetch and pick row with best street name match.
 * Both conditions required: (1) linked raw listing has lat/lon (from GET sale details), and
 * (2) we find a matching permit row by address (exact or fuzzy). Only then do we assign BBL/BIN.
 * Fuzzy match requires street number to match: if our street has a number (e.g. 22 in "West 22nd St"),
 * the permit row's street_name must contain that number (so we don't match 485 Lexington when we want 485 West 22nd).
 */
async function resolveBBLFromPermitAddress(
  property: Property,
  propertyRepo: PropertyRepo,
  matchRepo: MatchRepo,
  listingRepo: ListingRepo,
  _cutoffDate: string,
  fetchByAddress: (borough: string, houseNo: string, streetName: string) => Promise<SocrataPermitRow[]>,
  fetchByBoroughHouseNo: (borough: string, houseNo: string, limit: number, offset: number) => Promise<SocrataPermitRow[]>,
  fetchByAddressNoDate: (borough: string, houseNo: string, streetName: string) => Promise<SocrataPermitRow[]>,
  fetchByBoroughHouseNoNoDate: (borough: string, houseNo: string, limit: number, offset: number) => Promise<SocrataPermitRow[]>
): Promise<{ bbl: string; bin?: string } | null> {
  const { matches } = await matchRepo.list({ propertyId: property.id, limit: 1 });
  const match = matches[0];
  if (!match) return null;
  const listing = await listingRepo.byId(match.listingId);
  if (!listing) return null;
  const latVal = listing.lat != null ? (typeof listing.lat === "number" ? listing.lat : parseFloat(String(listing.lat))) : NaN;
  const lonVal = listing.lon != null ? (typeof listing.lon === "number" ? listing.lon : parseFloat(String(listing.lon))) : NaN;
  const hasLatLon =
    !Number.isNaN(latVal) && latVal >= -90 && latVal <= 90 &&
    !Number.isNaN(lonVal) && lonVal >= -180 && lonVal <= 180;
  if (!hasLatLon) return null;

  const { borough, houseNo, streetName } = await resolveAddressFromListing(
    property,
    propertyRepo,
    matchRepo,
    listingRepo
  );
  if (!borough || !houseNo || !streetName) return null;

  const variants = streetNameForPermitApi(streetName);

  const tryExact = async (fetchAddr: (b: string, h: string, s: string) => Promise<SocrataPermitRow[]>): Promise<{ bbl: string; bin?: string } | null> => {
    for (const variant of variants) {
      const rows = await fetchAddr(borough, houseNo, variant);
      const first = rows[0];
      if (first?.bbl?.trim()) return { bbl: first.bbl.trim(), bin: first.bin?.trim() || undefined };
    }
    return null;
  };

  /** Batch size and max batches for fuzzy street match (borough+house_no). We paginate until we find a match or run out. */
  const FUZZY_BATCH_SIZE = 1000;
  const FUZZY_MAX_BATCHES = 20; // cap at 20k rows per fuzzy attempt to avoid runaway
  const tryFuzzy = async (
    fetchBoroughHouse: (b: string, h: string, limit: number, offset: number) => Promise<SocrataPermitRow[]>
  ): Promise<{ bbl: string; bin?: string } | null> => {
    const permitStyleVariants = streetNameForPermitApi(streetName);
    const targetNorm = permitStyleVariants[0] ? norm(permitStyleVariants[0]) : norm(streetName);
    const requiredNumbers = streetNumbersIn(streetName);
    let best: SocrataPermitRow | null = null;
    let bestScore = 0;
    let offset = 0;
    for (let batch = 0; batch < FUZZY_MAX_BATCHES; batch++) {
      const page = await fetchBoroughHouse(borough, houseNo, FUZZY_BATCH_SIZE, offset);
      if (page.length === 0) break;
      for (const row of page) {
        const rowStreet = (row.street_name ?? "").trim();
        if (!rowStreet) continue;
        const rowNorm = norm(rowStreet);
        if (requiredNumbers.length > 0) {
          const allPresent = requiredNumbers.every((num) => rowNorm.includes(num));
          if (!allPresent) continue;
        }
        const score = rowNorm === targetNorm ? 100 : (rowNorm.includes(targetNorm) || targetNorm.includes(rowNorm) ? 50 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = row;
        }
      }
      if (best?.bbl?.trim()) return { bbl: best.bbl.trim(), bin: best.bin?.trim() || undefined };
      if (page.length < FUZZY_BATCH_SIZE) break;
      offset += FUZZY_BATCH_SIZE;
    }
    if (best?.bbl?.trim()) return { bbl: best.bbl.trim(), bin: best.bin?.trim() || undefined };
    return null;
  };

  let out = await tryExact(fetchByAddress);
  if (out) return out;
  out = await tryFuzzy(fetchByBoroughHouseNo);
  if (out) return out;
  out = await tryExact(fetchByAddressNoDate);
  if (out) return out;
  out = await tryFuzzy(fetchByBoroughHouseNoNoDate);
  return out;
}

/**
 * Build permits summary for property.details.enrichment.permits_summary.
 * Owner is taken from the most recent permit only (first row with owner data; rows are issued_date DESC).
 * Stop once we have owner so we don't overwrite with other matching rows.
 * Source: DOB NOW Build (rbx6-tga4) columns owner_business_name, owner_name.
 */
function buildPermitsSummary(rows: SocrataPermitRow[]): PermitsSummary {
  let lastIssuedDate: string | undefined;
  let ownerBusinessName: string | undefined;
  let ownerName: string | undefined;

  for (const row of rows) {
    const d = parseDateToYyyyMmDd(row.issued_date) ?? parseDateToYyyyMmDd(row.approved_date);
    if (d && (!lastIssuedDate || d > lastIssuedDate)) lastIssuedDate = d;
    // Take owner only from the first (most recent) row that has it; then stop so we don't overwrite.
    const hasOwner = (row.owner_business_name?.trim() || row.owner_name?.trim());
    if (hasOwner) {
      if (ownerBusinessName == null && row.owner_business_name?.trim()) ownerBusinessName = row.owner_business_name.trim();
      if (ownerName == null && row.owner_name?.trim()) ownerName = row.owner_name.trim();
      break;
    }
  }

  return {
    count: rows.length,
    last_issued_date: lastIssuedDate,
    owner_business_name: ownerBusinessName,
    owner_name: ownerName,
  };
}
