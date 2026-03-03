/**
 * General city/area options for Property Data filters (aligned with Runs area concept).
 * Used to filter and sort raw listings and canonical properties by location.
 */
export const AREA_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All areas" },
  { value: "Manhattan", label: "Manhattan" },
  { value: "Brooklyn", label: "Brooklyn" },
  { value: "Queens", label: "Queens" },
  { value: "Bronx", label: "Bronx" },
  { value: "Staten Island", label: "Staten Island" },
  { value: "Roosevelt Island", label: "Roosevelt Island" },
  { value: "Other", label: "Other" },
];

/** Normalize listing city string to a general area for filter/sort. */
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

/** Parse city from canonical address "Address, City, State Zip". */
export function cityFromCanonicalAddress(canonicalAddress: string | null | undefined): string {
  if (!canonicalAddress || typeof canonicalAddress !== "string") return "Other";
  const parts = canonicalAddress.split(",").map((p) => p.trim());
  if (parts.length >= 2) return cityToArea(parts[1]);
  return "Other";
}
