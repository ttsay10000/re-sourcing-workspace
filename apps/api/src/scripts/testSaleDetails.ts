/**
 * Test script: fetch GET sale details for a single StreetEasy URL and inspect
 * the response for BBL, BIN, lat/lon (used by permit enrichment and from-listings).
 *
 * Run from repo root or apps/api:
 *   RAPIDAPI_KEY=xxx npx tsx apps/api/src/scripts/testSaleDetails.ts "https://streeteasy.com/sale/1795579"
 *
 * Or after build:
 *   RAPIDAPI_KEY=xxx node apps/api/dist/scripts/testSaleDetails.js "https://streeteasy.com/sale/1795579"
 */

import { fetchSaleDetailsByUrl } from "../nycRealEstateApi.js";

const SAMPLE_URL = "https://streeteasy.com/sale/1795579";

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.argv[2]?.trim() || SAMPLE_URL;
  if (!process.env.RAPIDAPI_KEY) {
    console.error("RAPIDAPI_KEY is required. Set it in the environment.");
    process.exit(1);
  }

  console.log("Fetching sale details for:", url);
  console.log("");

  let raw: Record<string, unknown>;
  try {
    raw = await fetchSaleDetailsByUrl(url);
  } catch (err) {
    console.error("API error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Keys we use for BBL/BIN and lat/lon (in resolveBBLFromListing, from-listings, parseLatLonFromRaw)
  const bblKeys = ["bbl", "BBL", "borough_block_lot", "buildingLotBlock"];
  const binKeys = ["bin", "BIN", "building_identification_number"];
  const latKeys = ["latitude", "lat", "coordinates", "location", "geo", "geometry"];
  const addressKeys = ["address", "street_address", "formatted_address", "borough", "city", "zip", "zipcode"];
  // Keys used by send-to-property-data → runPropertyToNormalized for broker/agent LLM enrichment
  const agentKeys = ["agents", "agent_names", "listing_agents", "broker_name", "broker", "listing_agent", "agent_name", "agent", "listing_agent_name"];

  const has = (keys: string[], label: string): void => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null) {
        console.log(`  ${label} ${k}:`, typeof v === "object" ? JSON.stringify(v) : v);
      }
    }
    const coords = raw.coordinates as Record<string, unknown> | undefined;
    const loc = raw.location as Record<string, unknown> | undefined;
    const geo = raw.geo as Record<string, unknown> | undefined;
    if (coords && typeof coords === "object") {
      console.log("  coordinates:", JSON.stringify(coords));
    }
    if (loc && typeof loc === "object") {
      console.log("  location:", JSON.stringify(loc));
    }
    if (geo && typeof geo === "object") {
      console.log("  geo:", JSON.stringify(geo));
    }
  };

  console.log("--- Summary: keys used by enrichment ---");
  console.log("BBL/BIN (listing.extra; permit enrichment):");
  has(bblKeys, "bbl");
  has(binKeys, "bin");
  console.log("");
  console.log("Lat/lon (Geoclient fallback):");
  has(latKeys, "lat");
  console.log("");
  console.log("Address (address-based permit lookup):");
  const addr = pick(raw, addressKeys);
  if (Object.keys(addr).length) console.log("  ", addr);
  console.log("");
  console.log("Agent/broker (send-to-property-data → broker LLM enrichment):");
  const agentPayload = pick(raw, agentKeys);
  if (Object.keys(agentPayload).length) {
    console.log("  ", JSON.stringify(agentPayload, null, 2));
  } else {
    console.log("  (none of the expected keys found)");
  }
  console.log("");

  console.log("--- All top-level keys in response ---");
  console.log(Object.keys(raw).sort().join(", "));
  console.log("");

  console.log("--- Full response (truncated if large) ---");
  const str = JSON.stringify(raw, null, 2);
  if (str.length > 8000) {
    console.log(str.slice(0, 8000));
    console.log("\n... [truncated, total", str.length, "chars]");
  } else {
    console.log(str);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
