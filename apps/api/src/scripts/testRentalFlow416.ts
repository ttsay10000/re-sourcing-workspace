/**
 * One-off test: full rental flow for 416 West 20th Street (all unit probes).
 * Run: RAPIDAPI_KEY=xxx npx tsx apps/api/src/scripts/testRentalFlow416.ts
 */

import { runRentalApiStep } from "../rental/rentalApiClient.js";
import { addressToStreeteasyBuildingSlug, buildStreeteasyBuildingUrl } from "../rental/addressToSlug.js";

const ADDRESS = "416 West 20th Street, New York, NY";

async function main() {
  console.log("Full rental flow for:", ADDRESS);
  const slug = addressToStreeteasyBuildingSlug(ADDRESS.split(",")[0]?.trim() ?? ADDRESS);
  console.log("StreetEasy slug:", slug);
  console.log("Sample URL (unit 2):", buildStreeteasyBuildingUrl(slug, "2"));
  console.log("\nProbing all units (1-10, 1A-6C, A-L)...\n");

  const start = Date.now();
  const result = await runRentalApiStep(ADDRESS);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  const units = result.rentalUnits ?? [];
  console.log("--- Summary ---");
  console.log("Total units with data:", units.length);
  console.log("Time:", elapsed, "s");

  if (units.length > 0) {
    console.log("\n--- Per-unit data ---");
    units.forEach((u, i) => {
      console.log(
        `${i + 1}. Unit ${u.unit ?? "—"} | Rent: ${u.rentalPrice != null ? `$${u.rentalPrice}` : "—"} | Beds: ${u.beds ?? "—"} | Baths: ${u.baths ?? "—"} | Sqft: ${u.sqft ?? "—"} | Listed: ${u.listedDate ?? "—"} | Last rented: ${u.lastRentedDate ?? "—"}`
      );
    });
  }

  console.log("\n--- Full JSON ---");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
