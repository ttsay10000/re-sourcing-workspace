/**
 * Test enrichment for a property by BBL. Default BBL 1013820133 (location 40.768347, -73.967148).
 *
 * Uses a TEST-ONLY canonical address (prefix [TEST]) so it never matches real properties
 * created from listings. Does not interfere with actual system data.
 *
 * Run: DATABASE_URL=... [SOCRATA_APP_TOKEN=...] [TEST_BBL=3029200044] npx tsx apps/api/src/scripts/testEnrichmentBBL1013820133.ts
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
[join(__dirname, "../../.env"), join(__dirname, "../../../.env"), join(process.cwd(), "apps/api/.env"), join(process.cwd(), ".env")].forEach((p) => config({ path: p }));

import {
  getPool,
  PropertyRepo,
  PermitRepo,
  HpdViolationsRepo,
  DobComplaintsRepo,
} from "@re-sourcing/db";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";

const TEST_BBL = (process.env.TEST_BBL ?? "1013820133").trim();
const TEST_LAT = process.env.TEST_LAT != null ? Number(process.env.TEST_LAT) : 40.768347;
const TEST_LON = process.env.TEST_LON != null ? Number(process.env.TEST_LON) : -73.967148;
/** Test-only address; [TEST] prefix ensures we never match a real property from listings. */
const CANONICAL_ADDRESS = `[TEST] BBL ${TEST_BBL}`;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  console.log("Testing BBL:", TEST_BBL);
  console.log("");

  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });

  let property = await propertyRepo.byCanonicalAddress(CANONICAL_ADDRESS);
  if (!property) {
    property = await propertyRepo.create(CANONICAL_ADDRESS);
    console.log("Created property:", property.id);
  } else {
    console.log("Using existing property:", property.id);
  }

  const detailsMerge: Record<string, unknown> = { bbl: TEST_BBL, bblBase: TEST_BBL };
  if (!Number.isNaN(TEST_LAT) && !Number.isNaN(TEST_LON)) {
    detailsMerge.lat = TEST_LAT;
    detailsMerge.lon = TEST_LON;
  }
  await propertyRepo.mergeDetails(property.id, detailsMerge);
  console.log("Set details.bbl, bblBase" + (detailsMerge.lat != null ? ", lat, lon" : ""));
  console.log("");

  console.log("Running full enrichment...");
  const runResult = await runEnrichmentForProperty(property.id, undefined, {
    rateLimitDelayMs: 500,
    appToken: process.env.SOCRATA_APP_TOKEN ?? null,
  });
  console.log("Run ok:", runResult.ok);
  console.log("Per-module results:", JSON.stringify(runResult.results, null, 2));
  console.log("");

  property = (await propertyRepo.byId(property.id))!;
  const details = (property.details as Record<string, unknown>) ?? {};
  const enrichment = (details.enrichment as Record<string, unknown>) ?? {};

  if (process.env.ENRICHMENT_DEBUG) {
    console.log("[enrichment:debug] details.enrichment keys:", Object.keys(enrichment));
    console.log("[enrichment:debug] enrichment.zoning:", JSON.stringify(enrichment.zoning ?? null));
    console.log("[enrichment:debug] enrichment.hpdRegistration:", JSON.stringify(enrichment.hpdRegistration ?? null));
    console.log("[enrichment:debug] enrichment.certificateOfOccupancy:", JSON.stringify(enrichment.certificateOfOccupancy ?? null));
    console.log("");
  }

  const permitsSummary = (enrichment.permits_summary as Record<string, unknown>) ?? {};

  const permitRepo = new PermitRepo({ pool });
  const hpdViolRepo = new HpdViolationsRepo({ pool });
  const dobRepo = new DobComplaintsRepo({ pool });

  const permits = await permitRepo.listByPropertyId(property.id);
  const violations = await hpdViolRepo.listByPropertyId(property.id);
  const complaints = await dobRepo.listByPropertyId(property.id);

  console.log("--- Data points we care about ---");
  console.log("BBL (tax):", details.bbl ?? "—");
  console.log("BBL (base):", details.bblBase ?? details.bbl ?? "—");
  console.log("Location:", details.lat != null && details.lon != null ? `${details.lat}, ${details.lon}` : "—");
  console.log("Tax code:", details.taxCode != null && String(details.taxCode).trim() !== "" ? details.taxCode : "—");
  console.log("2010 Census Block:", details.censusBlock2010 != null && String(details.censusBlock2010).trim() !== "" ? details.censusBlock2010 : "—");
  const ownerInfo = details.ownerInfo ?? details.owner_info;
  console.log("Owner (Phase 1 / details.ownerInfo):", ownerInfo != null && String(ownerInfo).trim() !== "" ? String(ownerInfo).trim() : "—");
  console.log("Owner (name, permits_summary):", permitsSummary.owner_name ?? "—");
  console.log("Owner (business, permits_summary):", permitsSummary.owner_business_name ?? "—");

  const co = enrichment.certificateOfOccupancy as Record<string, unknown> | undefined;
  console.log("CO status:", co?.status ?? co?.c_of_o_status ?? "—");
  console.log("CO issuance date:", co?.issuanceDate ?? co?.c_of_o_issuance_date ?? co?.issuance_date ?? "—");
  console.log("CO job type:", co?.jobType ?? co?.job_type ?? "—");

  const zoning = enrichment.zoning as Record<string, unknown> | undefined;
  console.log("Zoning district 1:", zoning?.zoningDistrict1 ?? zoning?.zoning_district_1 ?? "—");
  console.log("Zoning district 2:", zoning?.zoningDistrict2 ?? zoning?.zoning_district_2 ?? "—");
  console.log("Zoning map number:", zoning?.zoningMapNumber ?? zoning?.zoning_map_number ?? "—");
  console.log("Zoning map code:", zoning?.zoningMapCode ?? zoning?.zoning_map_code ?? "—");

  const hpdReg = enrichment.hpdRegistration as Record<string, unknown> | undefined;
  console.log("HPD Registration ID:", hpdReg?.registrationId ?? hpdReg?.registration_id ?? "—");
  console.log("HPD Last Registration Date:", hpdReg?.lastRegistrationDate ?? hpdReg?.last_registration_date ?? "—");

  console.log("");
  console.log("--- Record counts ---");
  console.log("Permits: #", permits.length);
  console.log("HPD violations: #", violations.length);
  console.log("DOB complaints: #", complaints.length);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
