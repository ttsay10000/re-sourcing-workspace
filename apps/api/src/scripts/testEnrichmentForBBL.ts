/**
 * Test script: run full enrichment (permits + 7 modules) for a property with given BBL/BIN,
 * then print the combined output from all modules.
 *
 * Creates or reuses a property with canonical_address "428 West 19th Street, Manhattan, NY"
 * and details.bbl/details.bin set, then runs runEnrichmentForProperty and dumps results.
 *
 * Run from repo root or apps/api:
 *   DATABASE_URL=... GEOCLIENT_SUBSCRIPTION_KEY=... [SOCRATA_APP_TOKEN=...] \
 *     npx tsx apps/api/src/scripts/testEnrichmentForBBL.ts [BBL] [BIN]
 *
 * Default BBL/BIN: Linea Condominium (1007167507, 1000000).
 */

import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  loadEnvFile(join(__dirname, "../../.env"));
} catch {
  // .env optional
}

import {
  getPool,
  PropertyRepo,
  PermitRepo,
  PropertyEnrichmentStateRepo,
  ZoningZtlRepo,
  CertificateOfOccupancyRepo,
  HpdRegistrationRepo,
  HpdViolationsRepo,
  DobComplaintsRepo,
  HousingLitigationsRepo,
  AffordableHousingRepo,
} from "@re-sourcing/db";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";

const CANONICAL_ADDRESS = "428 West 19th Street, Manhattan, NY";
const DEFAULT_BBL = "1007167507";
const DEFAULT_BIN = "1000000";
const DEFAULT_LAT = 40.744571;
const DEFAULT_LON = -74.004417;

const ENRICHMENT_NAMES = [
  "permits",
  "zoning_ztl",
  "certificate_of_occupancy",
  "hpd_registration",
  "hpd_violations",
  "dob_complaints",
  "housing_litigations",
  "affordable_housing",
];

async function main(): Promise<void> {
  const bbl = process.argv[2]?.trim() || DEFAULT_BBL;
  const bin = process.argv[3]?.trim() || DEFAULT_BIN;

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });

  let property = await propertyRepo.byCanonicalAddress(CANONICAL_ADDRESS);
  if (!property) {
    property = await propertyRepo.create(CANONICAL_ADDRESS);
    console.log("Created property:", property.id);
  } else {
    console.log("Using existing property:", property.id);
  }

  await propertyRepo.mergeDetails(property.id, {
    bbl,
    bin,
    lat: DEFAULT_LAT,
    lon: DEFAULT_LON,
  });
  console.log("Set details.bbl/bin/lat/lon for", property.id);
  console.log("");

  console.log("Running full enrichment (permits + 7 modules)...");
  const runResult = await runEnrichmentForProperty(property.id, undefined, {
    rateLimitDelayMs: 400,
    appToken: process.env.SOCRATA_APP_TOKEN ?? null,
  });
  console.log("Run result:", JSON.stringify(runResult, null, 2));
  console.log("");

  property = (await propertyRepo.byId(property.id))!;
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const permitRepo = new PermitRepo({ pool });
  const zoningRepo = new ZoningZtlRepo({ pool });
  const coRepo = new CertificateOfOccupancyRepo({ pool });
  const hpdRegRepo = new HpdRegistrationRepo({ pool });
  const hpdViolRepo = new HpdViolationsRepo({ pool });
  const dobRepo = new DobComplaintsRepo({ pool });
  const litRepo = new HousingLitigationsRepo({ pool });
  const affRepo = new AffordableHousingRepo({ pool });

  const permits = await permitRepo.listByPropertyId(property.id);
  const zoning = await zoningRepo.listByPropertyId(property.id);
  const co = await coRepo.listByPropertyId(property.id);
  const hpdReg = await hpdRegRepo.listByPropertyId(property.id);
  const hpdViol = await hpdViolRepo.listByPropertyId(property.id);
  const dobComplaints = await dobRepo.listByPropertyId(property.id);
  const litigations = await litRepo.listByPropertyId(property.id);
  const affordable = await affRepo.listByPropertyId(property.id);

  const state: Record<string, unknown> = {};
  for (const name of ENRICHMENT_NAMES) {
    const s = await stateRepo.get(property.id, name);
    if (s) state[name] = { lastSuccessAt: s.lastSuccessAt, lastError: s.lastError, statsJson: s.statsJson };
  }

  const output = {
    propertyId: property.id,
    canonicalAddress: property.canonicalAddress,
    details: property.details,
    enrichmentState: state,
    runResult: runResult.results,
    modules: {
      permits: { count: permits.length, rows: permits.map((p) => ({ id: p.id, workPermit: p.workPermit, status: p.status, issuedDate: p.issuedDate, approvedDate: p.approvedDate })) },
      zoning_ztl: { count: zoning.length, rows: zoning.map((z) => ({ normalizedJson: z.normalizedJson })) },
      certificate_of_occupancy: { count: co.length, rows: co.map((c) => ({ normalizedJson: c.normalizedJson })) },
      hpd_registration: { count: hpdReg.length, rows: hpdReg.map((r) => ({ normalizedJson: r.normalizedJson })) },
      hpd_violations: { count: hpdViol.length, rows: hpdViol.map((v) => ({ normalizedJson: v.normalizedJson })) },
      dob_complaints: { count: dobComplaints.length, rows: dobComplaints.map((d) => ({ normalizedJson: d.normalizedJson })) },
      housing_litigations: { count: litigations.length, rows: litigations.map((l) => ({ normalizedJson: l.normalizedJson })) },
      affordable_housing: { count: affordable.length, rows: affordable.map((a) => ({ normalizedJson: a.normalizedJson })) },
    },
  };

  console.log("--- Final output (all modules) ---");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
