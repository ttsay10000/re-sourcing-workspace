/**
 * Test enrichment for 18 Christopher Street multifamily (Streeteasy building).
 * Uses canonical address only — no BBL set upfront — to verify Geoclient + base BBL flow.
 *
 * Uses a TEST-ONLY canonical address (prefix [TEST]) so it never matches real properties
 * created from listings. Does not interfere with actual system data.
 *
 * Run from repo root or apps/api:
 *   DATABASE_URL=... GEOCLIENT_SUBSCRIPTION_KEY=... [SOCRATA_APP_TOKEN=...] \
 *     npx tsx apps/api/src/scripts/testEnrichment18Christopher.ts
 *
 * Expect: BBL resolved via Geoclient, bblBase persisted, violations/complaints/permits
 * fetched using base BBL when applicable.
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

import { getPool, PropertyRepo, PermitRepo, PropertyEnrichmentStateRepo, HpdViolationsRepo, DobComplaintsRepo } from "@re-sourcing/db";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";

/** Test-only address; [TEST] prefix ensures we never match a real property from listings. */
const CANONICAL_ADDRESS = "[TEST] 18 Christopher Street, Manhattan, NY 10014";

async function main(): Promise<void> {
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

  // Do not set details.bbl — simulate "Add to canonical" without sale-details BBL.
  // Enrichment will use Geoclient (resolveBBLFromAddress) then persist bbl + bblBase.
  console.log("Running full enrichment (no BBL pre-set; Geoclient + base BBL)...\n");
  const runResult = await runEnrichmentForProperty(property.id, undefined, {
    rateLimitDelayMs: 400,
    appToken: process.env.SOCRATA_APP_TOKEN ?? null,
  });
  console.log("Run result:", JSON.stringify(runResult, null, 2));
  console.log("");

  property = (await propertyRepo.byId(property.id))!;
  const details = (property.details as Record<string, unknown>) ?? {};
  console.log("Property details.bbl (tax/billing):", details.bbl ?? "—");
  console.log("Property details.bblBase (used for datasets):", details.bblBase ?? "—");
  console.log("");

  const permitRepo = new PermitRepo({ pool });
  const violationsRepo = new HpdViolationsRepo({ pool });
  const complaintsRepo = new DobComplaintsRepo({ pool });
  const permits = await permitRepo.listByPropertyId(property.id);
  const violations = await violationsRepo.listByPropertyId(property.id);
  const complaints = await complaintsRepo.listByPropertyId(property.id);

  console.log("--- Totals (base BBL used for queries) ---");
  console.log("Permits:", permits.length);
  console.log("HPD Violations:", violations.length);
  console.log("DOB Complaints:", complaints.length);

  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const permitsState = await stateRepo.get(property.id, "permits");
  const violationsState = await stateRepo.get(property.id, "hpd_violations");
  if (permitsState?.lastError) console.log("Permits lastError:", permitsState.lastError);
  if (violationsState?.lastError) console.log("HPD violations lastError:", violationsState.lastError);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
