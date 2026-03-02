/**
 * Test script: resolve BBL/BIN (and lat/lon) via Geoclient v2 address endpoint.
 * Uses GEOCLIENT_SUBSCRIPTION_KEY (NYC API Developers Portal, api-portal.nyc.gov).
 *
 * Run from repo root or apps/api:
 *   GEOCLIENT_SUBSCRIPTION_KEY=xxx npx tsx apps/api/src/scripts/testGeoclientAddress.ts
 *
 * Optional args: houseNumber street boroughOrZip
 *   e.g. 428 "West 19th Street" Manhattan
 * Default: Linea Condominium, 428 West 19th Street, Manhattan (from StreetEasy building page).
 */

import { resolveBBLFromAddress } from "../enrichment/geoclient.js";

const DEFAULT_HOUSE = "428";
const DEFAULT_STREET = "West 19th Street";
const DEFAULT_BOROUGH = "Manhattan";

async function main(): Promise<void> {
  const house = process.argv[2]?.trim() || DEFAULT_HOUSE;
  const street = process.argv[3]?.trim() || DEFAULT_STREET;
  const boroughOrZip = process.argv[4]?.trim() || DEFAULT_BOROUGH;

  if (!process.env.GEOCLIENT_SUBSCRIPTION_KEY) {
    console.error("GEOCLIENT_SUBSCRIPTION_KEY is required. Get it from https://api-portal.nyc.gov (geoclient-current-v2).");
    process.exit(1);
  }

  console.log("Geoclient v2 address → BBL/BIN");
  console.log("  houseNumber:", house);
  console.log("  street:", street);
  console.log("  borough/zip:", boroughOrZip);
  console.log("");

  const boroughParam = /^\d{5}$/.test(boroughOrZip.replace(/\D/g, ""))
    ? { zip: boroughOrZip }
    : { borough: boroughOrZip };

  const result = await resolveBBLFromAddress(house, street, boroughParam);

  if (result) {
    console.log("Result:");
    console.log("  BBL:", result.bbl);
    console.log("  BIN:", result.bin ?? "(not returned)");
    if (result.lat != null && result.lon != null) {
      console.log("  lat:", result.lat, "lon:", result.lon);
    }
  } else {
    console.log("No result (null). Check address or API key.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
