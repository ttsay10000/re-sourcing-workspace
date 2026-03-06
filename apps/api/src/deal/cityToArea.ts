/**
 * Normalize listing city to borough/area for deal scoring location component.
 */

export function cityToArea(city: string | null | undefined): string {
  if (!city || typeof city !== "string") return "Other";
  const c = city.trim();
  if (!c) return "Other";
  const lower = c.toLowerCase();
  if (lower === "new york" || lower === "manhattan" || lower === "nyc") return "Manhattan";
  if (lower === "brooklyn") return "Brooklyn";
  if (lower === "queens") return "Queens";
  if (lower === "bronx") return "Bronx";
  if (lower === "staten island" || lower === "staten is") return "Staten Island";
  if (lower === "roosevelt island") return "Roosevelt Island";
  return "Other";
}

/** Parse area from canonical address "Address, City, State Zip". */
export function areaFromCanonicalAddress(canonicalAddress: string | null | undefined): string {
  if (!canonicalAddress || typeof canonicalAddress !== "string") return "Other";
  const parts = canonicalAddress.split(",").map((p) => p.trim());
  if (parts.length >= 2) return cityToArea(parts[1]);
  return "Other";
}
