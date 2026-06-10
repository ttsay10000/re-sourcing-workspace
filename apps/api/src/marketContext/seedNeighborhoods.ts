/**
 * Loads the canonical Manhattan neighborhood seed (polygons + aliases) by
 * parsing the 058 migration, so tests and offline scripts use exactly what
 * production gets from the neighborhoods table — one source of truth.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NeighborhoodRecord } from "@re-sourcing/contracts";

const MIGRATION_RELATIVE_PATH = "../../../../packages/db/migrations/058_market_context_v1.sql";

const TUPLE_PATTERN =
  /\('([^']+)',\s*'((?:[^']|'')+)',\s*'([^']+)',\s*'([^']+)',\s*\n?\s*ARRAY\[((?:[^\]]|\n)*?)\],\s*\n?\s*'(\[\[[\s\S]*?\]\])'::jsonb\)/g;

function unescapeSql(value: string): string {
  return value.replace(/''/g, "'");
}

export function loadSeedNeighborhoods(): NeighborhoodRecord[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, MIGRATION_RELATIVE_PATH), "utf-8");
  const records: NeighborhoodRecord[] = [];
  for (const match of sql.matchAll(TUPLE_PATTERN)) {
    const [, id, name, borough, submarketId, aliasBlob, polygonJson] = match;
    const aliases = [...aliasBlob.matchAll(/'((?:[^']|'')+)'/g)].map((m) => unescapeSql(m[1]));
    records.push({
      id,
      name: unescapeSql(name),
      borough,
      submarketId,
      aliases,
      polygon: JSON.parse(polygonJson) as [number, number][],
    });
  }
  if (records.length === 0) {
    throw new Error("loadSeedNeighborhoods: no neighborhood tuples parsed from 058 migration");
  }
  return records;
}
