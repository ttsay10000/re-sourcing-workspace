/**
 * Convert a property address line to StreetEasy building URL slug.
 * Example: "416 West 20th Street" -> "416-west-20-street-new_york"
 * Used for GET rentals/url: https://streeteasy.com/building/{slug}/{unit}
 */

/** Strip ordinal suffixes (20th -> 20, 1st -> 1) for StreetEasy URL compatibility. */
function stripOrdinals(s: string): string {
  return s.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
}

export function addressToStreeteasyBuildingSlug(addressLine: string): string {
  const t = stripOrdinals((addressLine ?? "").trim());
  if (!t) return "";
  // Lowercase, replace spaces and punctuation with dashes, collapse multiple dashes
  const slug = t
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[,.]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `${slug}-new_york` : "new_york";
}

export function buildStreeteasyBuildingUrl(slug: string, unit?: string): string {
  const base = `https://streeteasy.com/building/${slug}`;
  return unit != null && unit !== "" ? `${base}/${encodeURIComponent(unit)}` : base;
}
