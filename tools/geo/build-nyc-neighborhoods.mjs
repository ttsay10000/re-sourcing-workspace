#!/usr/bin/env node
/**
 * Builds apps/web/public/data/nyc-neighborhoods.geojson — the neighborhood
 * delineation overlay for the Yield Map.
 *
 * Source: NYC Neighborhood Tabulation Areas (NTA, 2010 vintage), pre-simplified
 * by the NYC DOHMH geography repo (github.com/nycehs/NYC_geography). ~195
 * features, ~5.6k vertices total, so the bundled file stays under 200 KB.
 *
 * Output feature properties:
 *   code    NTA code (e.g. "MN17") — stable join key for map layers
 *   name    NTA name (e.g. "Midtown-Midtown South")
 *   borough Borough name
 *   park    true for park/cemetery/airport catch-all areas (drawn but
 *           excluded from yield aggregation and labels)
 *
 * Usage: node tools/geo/build-nyc-neighborhoods.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://raw.githubusercontent.com/nycehs/NYC_geography/master/NTA.geo.json";
const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/web/public/data/nyc-neighborhoods.geojson"
);

const PARK_PATTERN = /park-cemetery-etc|^Airport$/i;

/** Round to 6 decimals (~10 cm) so the file stays diff-friendly and compact. */
function roundCoords(coords) {
  if (typeof coords[0] === "number") {
    return [Math.round(coords[0] * 1e6) / 1e6, Math.round(coords[1] * 1e6) / 1e6];
  }
  return coords.map(roundCoords);
}

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${SOURCE_URL}`);
const source = await res.json();

const features = source.features.map((feature) => {
  const { NTACode, NTAName, BoroName } = feature.properties;
  return {
    type: "Feature",
    properties: {
      code: NTACode,
      name: NTAName,
      borough: BoroName,
      park: PARK_PATTERN.test(NTAName),
    },
    geometry: {
      type: feature.geometry.type,
      coordinates: roundCoords(feature.geometry.coordinates),
    },
  };
});

const out = {
  type: "FeatureCollection",
  // Attribution kept with the data so the provenance survives the copy.
  attribution: "NYC Neighborhood Tabulation Areas (2010) via NYC DOHMH github.com/nycehs/NYC_geography",
  features,
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(out));
console.log(`Wrote ${features.length} neighborhoods → ${path.relative(process.cwd(), OUT_PATH)}`);
