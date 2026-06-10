/**
 * Neighborhood + submarket resolution (code, not LLM). Comp rows carry the
 * verbatim neighborhood_raw; this maps it to a polygon id via the alias map.
 * Unresolved names surface in the ingest report's review queue — comps are
 * never silently dropped (they persist with neighborhood_id = null).
 */
import type { MarketGeoLevel, NeighborhoodRecord } from "@re-sourcing/contracts";

/** Lowercase, strip diacritics/punctuation/whitespace: "NoLita" → "nolita", "Hell's Kitchen" → "hellskitchen". */
export function normalizeNeighborhoodName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type NeighborhoodIndex = Map<string, string>;

export function buildNeighborhoodIndex(neighborhoods: NeighborhoodRecord[]): NeighborhoodIndex {
  const index: NeighborhoodIndex = new Map();
  for (const hood of neighborhoods) {
    index.set(normalizeNeighborhoodName(hood.id), hood.id);
    index.set(normalizeNeighborhoodName(hood.name), hood.id);
    for (const alias of hood.aliases) {
      index.set(normalizeNeighborhoodName(alias), hood.id);
    }
  }
  return index;
}

export function resolveNeighborhoodId(raw: string | null, index: NeighborhoodIndex): string | null {
  if (!raw) return null;
  const direct = index.get(normalizeNeighborhoodName(raw));
  if (direct) return direct;
  // Compound labels like "SoHo/Nolita" or "Harlem - South": first segment that resolves wins.
  for (const part of raw.split(/[\/,&\-–]| and /i)) {
    const match = index.get(normalizeNeighborhoodName(part));
    if (match) return match;
  }
  return null;
}

/**
 * Map a stat's verbatim geo scope onto a submarket id used for fallback
 * matching. Publisher universes differ — "Manhattan below 96th Street"
 * (Ariel/AY) is NOT "Manhattan" (Alpha) — so scopes stay distinct.
 */
export function resolveSubmarketId(geoName: string, geoLevel: MarketGeoLevel): string | null {
  const name = geoName.toLowerCase();
  if (/(below|south of|under|<)\s*96/.test(name)) return "manhattan_below_96";
  if (/northern manhattan|(above|north of)\s*96/.test(name)) return "northern_manhattan";
  if (/new york city|nyc|citywide|five boroughs|5 boroughs/.test(name)) return "nyc";
  if (/brooklyn/.test(name)) return "brooklyn";
  if (/queens/.test(name)) return "queens";
  if (/bronx/.test(name)) return "bronx";
  if (/staten/.test(name)) return "staten_island";
  if (/manhattan/.test(name)) return "manhattan";
  if (geoLevel === "citywide") return "nyc";
  return null;
}

/** Submarket ids whose stats can back-fill a neighborhood, most specific first. */
export function fallbackSubmarketsFor(neighborhood: NeighborhoodRecord): string[] {
  return [neighborhood.submarketId, "manhattan", "nyc"];
}
