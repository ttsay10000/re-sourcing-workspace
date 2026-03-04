/**
 * Debug: try both API hosts and verify exact URLs we send.
 * Run: RAPIDAPI_KEY=xxx npx tsx apps/api/src/scripts/debugRentalApiResponse.ts
 */

import { buildStreeteasyBuildingUrl, addressToStreeteasyBuildingSlug } from "../rental/addressToSlug.js";

const UNITS = ["2", "3", "4"];
const HOSTS = [
  { name: "nyc-real-estate-api", base: "https://nyc-real-estate-api.p.rapidapi.com", host: "nyc-real-estate-api.p.rapidapi.com" },
  { name: "streeteasy-api", base: "https://streeteasy-api.p.rapidapi.com", host: "streeteasy-api.p.rapidapi.com" },
];

async function fetchRaw(apiBase: string, host: string, buildingUrl: string): Promise<{ status: number; body: string }> {
  const apiUrl = `${apiBase}/rentals/url?url=${encodeURIComponent(buildingUrl)}`;
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("RAPIDAPI_KEY required");
  const res = await fetch(apiUrl, {
    headers: { "x-rapidapi-host": host, "x-rapidapi-key": key },
    redirect: "follow",
  });
  const body = await res.text();
  return { status: res.status, body };
}

async function main() {
  const slug = addressToStreeteasyBuildingSlug("416 West 20th Street");
  console.log("Slug from address:", slug);
  console.log("URLs we build (must match StreetEasy):");
  UNITS.forEach((u) => console.log(" ", buildStreeteasyBuildingUrl(slug, u)));
  console.log("");

  for (const { name, base, host } of HOSTS) {
    console.log("\n========== HOST:", name, "==========");
    for (const unit of UNITS) {
      const buildingUrl = buildStreeteasyBuildingUrl(slug, unit);
      const { status, body } = await fetchRaw(base, host, buildingUrl);
      let preview = body.slice(0, 120);
      if (body.length > 120) preview += "...";
      try {
        const parsed = JSON.parse(body);
        if (parsed.price != null || parsed.id != null) {
          console.log(`  Unit ${unit}: ${status} — has data (id/price)`);
        } else {
          console.log(`  Unit ${unit}: ${status} — ${preview}`);
        }
      } catch {
        console.log(`  Unit ${unit}: ${status} — ${preview}`);
      }
    }
  }
}

main();
