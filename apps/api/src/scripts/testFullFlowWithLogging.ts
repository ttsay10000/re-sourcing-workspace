/**
 * Full flow for 485 West 22nd Street (building slug 485-west-22-street-new_york).
 * Run: RAPIDAPI_KEY=xxx npx tsx apps/api/src/scripts/testFullFlowWithLogging.ts
 * Or from repo root with .env in apps/api: npx tsx apps/api/src/scripts/testFullFlowWithLogging.ts
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") }); // apps/api/.env
config({ path: resolve(process.cwd(), ".env") });

import { addressToStreeteasyBuildingSlug, buildStreeteasyBuildingUrl } from "../rental/addressToSlug.js";
import { fetchRentalByUrl } from "../rental/rentalApiClient.js";
import { runRentalApiStep } from "../rental/rentalApiClient.js";

const ADDRESS = "485 West 22nd Street, New York, NY";

// Same unit list as client (subset for clearer log: 1-5 plus 2,3,4 highlighted)
const UNITS_TO_LOG = ["1", "2", "3", "4", "5"];

async function main() {
  const addressLine = ADDRESS.split(",")[0]?.trim() ?? ADDRESS;
  const slug = addressToStreeteasyBuildingSlug(addressLine);
  console.log("Address:", ADDRESS);
  console.log("Slug:", slug);
  console.log("\n--- URLs we create for units 1-5 (units 2 and 4 included) ---\n");

  let firstRawWithData: Record<string, unknown> | null = null;
  for (const unit of UNITS_TO_LOG) {
    const url = buildStreeteasyBuildingUrl(slug, unit);
    console.log(`  Unit ${unit}: ${url}`);
    const raw = await fetchRentalByUrl(url);
    const hasData = raw != null && Object.keys(raw).length > 0;
    const price = raw && (raw.price ?? raw.rent) != null ? raw.price ?? raw.rent : null;
    console.log(`           → hasData: ${hasData}${price != null ? `, price: ${price}` : ""}\n`);
    if (hasData && raw && !firstRawWithData) firstRawWithData = raw;
  }

  if (firstRawWithData) {
    console.log("--- Raw API keys/values for one unit (to wire listed/last rented) ---\n");
    for (const [k, v] of Object.entries(firstRawWithData)) {
      const val = v == null ? String(v) : typeof v === "object" ? JSON.stringify(v) : String(v);
      console.log(`  ${k}: ${val.slice(0, 120)}${val.length > 120 ? "…" : ""}`);
    }
    console.log("");
  }

  console.log("--- Full flow (runRentalApiStep) ---\n");
  const result = await runRentalApiStep(ADDRESS);
  const units = result.rentalUnits ?? [];
  console.log("Total units with data:", units.length);
  units.forEach((u) => {
    const statusNote = u.status === "sold" ? " (last rent)" : u.status === "open" ? " (ask)" : "";
    console.log(
      `  Unit ${u.unit ?? "—"} | Rent: ${u.rentalPrice != null ? `$${u.rentalPrice}` : "—"}${statusNote} | Status: ${u.status ?? "—"} | Beds: ${u.beds ?? "—"} | Baths: ${u.baths ?? "—"} | Listed: ${u.listedDate ?? "—"} | Last rented: ${u.lastRentedDate ?? "—"}`
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
