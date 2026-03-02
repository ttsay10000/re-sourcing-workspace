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
import { normalizeBorough, normalizeHouseNo, normalizeStreetName, parseDateToYyyyMmDd, parseEstimatedCost } from "./normalizers.js";
import { resolveBBLFromLatLon } from "../geoclient.js";
import {
  buildSoQLParamsByBBL,
  buildSoQLParamsByAddress,
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

    // If no BBL on property, try linked listing: extra (bbl/bin), then lat/lon reverse geocode, then address-based lookup.
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

    // If still no BBL, do one address-based lookup to permit dataset; take first row's BBL/BIN and persist, then use BBL for main fetch.
    if (!bblStr) {
      const { borough, houseNo, streetName } = await resolveAddressFromListing(
        property,
        propertyRepo,
        matchRepo,
        listingRepo
      );
      if (borough && houseNo && streetName) {
        const oneRow = await fetchPermitsPage(
          buildSoQLParamsByAddress(borough, houseNo, streetName, cutoffDate, 1, 0),
          { appToken: options.appToken }
        );
        const first = oneRow[0];
        if (first?.bbl?.trim()) {
          bblStr = first.bbl.trim();
          await propertyRepo.mergeDetails(propertyId, { bbl: bblStr, ...(first.bin?.trim() && { bin: first.bin.trim() }) });
        }
      }
    }

    if (bblStr) {
      rows = await fetchAllPermits(
        (limit, offset) => buildSoQLParamsByBBL(bblStr, cutoffDate, limit, offset),
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
      rows = await fetchAllPermits(
        (limit, offset) =>
          buildSoQLParamsByAddress(borough, houseNo, streetName, cutoffDate, limit, offset),
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
    await propertyRepo.updateDetails(propertyId, "enrichment.permits_summary", summary as Record<string, unknown>);

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
 * Try to get BBL/BIN from the linked listing: first extra (GET sale details),
 * then lat/lon reverse geocode (Geoclient), then caller falls back to address-based lookup.
 */
async function resolveBBLFromListing(
  matchRepo: MatchRepo,
  listingRepo: ListingRepo,
  propertyId: string
): Promise<{ bbl: string; bin?: string; lat?: number; lon?: number } | null> {
  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  const match = matches[0];
  if (!match) return null;
  const listing = await listingRepo.byId(match.listingId);
  if (!listing) return null;

  const extra = listing.extra && typeof listing.extra === "object" ? (listing.extra as Record<string, unknown>) : null;
  if (extra) {
    const bbl = extra.bbl ?? extra.BBL ?? extra.borough_block_lot;
    const bin = extra.bin ?? extra.BIN ?? extra.building_identification_number;
    const bblStr = typeof bbl === "string" && /^\d{10}$/.test(bbl.trim()) ? bbl.trim() : null;
    if (bblStr) {
      return { bbl: bblStr, bin: typeof bin === "string" ? bin.trim() : undefined };
    }
  }

  const lat = listing.lat != null && typeof listing.lat === "number" && !Number.isNaN(listing.lat) ? listing.lat : null;
  const lon = listing.lon != null && typeof listing.lon === "number" && !Number.isNaN(listing.lon) ? listing.lon : null;
  if (lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
    const fromGeo = await resolveBBLFromLatLon(lat, lon);
    if (fromGeo?.bbl) {
      return { ...fromGeo, lat, lon };
    }
  }

  return null;
}

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
      const { houseNo, streetName } = splitAddress(listing.address);
      const h = normalizeHouseNo(houseNo);
      const s = normalizeStreetName(streetName);
      if (borough && h && s) return { borough, houseNo: h, streetName: s };
    }
  }

  const addr = property.canonicalAddress || "";
  const commaIdx = addr.indexOf(",");
  const addressPart = commaIdx >= 0 ? addr.slice(0, commaIdx).trim() : addr.trim();
  const rest = commaIdx >= 0 ? addr.slice(commaIdx + 1).trim() : "";
  const borough = normalizeBorough(rest.split(",")[0]?.trim() ?? "");
  const { houseNo, streetName } = splitAddress(addressPart);
  return {
    borough,
    houseNo: normalizeHouseNo(houseNo),
    streetName: normalizeStreetName(streetName),
  };
}

function buildPermitsSummary(rows: SocrataPermitRow[]): PermitsSummary {
  let lastIssuedDate: string | undefined;
  let ownerBusinessName: string | undefined;
  let ownerName: string | undefined;

  for (const row of rows) {
    const d = parseDateToYyyyMmDd(row.issued_date) ?? parseDateToYyyyMmDd(row.approved_date);
    if (d && (!lastIssuedDate || d > lastIssuedDate)) lastIssuedDate = d;
    if (row.owner_business_name?.trim()) ownerBusinessName = row.owner_business_name.trim();
    if (row.owner_name?.trim()) ownerName = row.owner_name.trim();
  }

  return {
    count: rows.length,
    last_issued_date: lastIssuedDate,
    owner_business_name: ownerBusinessName,
    owner_name: ownerName,
  };
}
