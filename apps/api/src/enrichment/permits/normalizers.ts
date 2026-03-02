/**
 * Normalization utilities for permit enrichment: borough, address, dates, costs.
 * Used when building Socrata queries and when persisting permit rows.
 */

export const BOROUGHS = [
  "MANHATTAN",
  "BRONX",
  "BROOKLYN",
  "QUEENS",
  "STATEN ISLAND",
] as const;

export type Borough = (typeof BOROUGHS)[number];

const BOROUGH_ALIASES: Record<string, Borough> = {
  manhattan: "MANHATTAN",
  mn: "MANHATTAN",
  "new york": "MANHATTAN",
  "1": "MANHATTAN",
  bronx: "BRONX",
  bx: "BRONX",
  "2": "BRONX",
  brooklyn: "BROOKLYN",
  bk: "BROOKLYN",
  bklyn: "BROOKLYN",
  "3": "BROOKLYN",
  queens: "QUEENS",
  qn: "QUEENS",
  "4": "QUEENS",
  "staten island": "STATEN ISLAND",
  si: "STATEN ISLAND",
  staten: "STATEN ISLAND",
  "5": "STATEN ISLAND",
};

/**
 * Map common inputs (e.g. "Manhattan", "NY", "1") to canonical borough.
 * Returns uppercase canonical name or empty string if unknown.
 */
export function normalizeBorough(str: string | null | undefined): string {
  if (str == null || typeof str !== "string") return "";
  const key = str.trim().toLowerCase().replace(/-/g, " ");
  if (!key) return "";
  return BOROUGH_ALIASES[key] ?? "";
}

/**
 * Trim and preserve Queens-style hyphen (e.g. "28-20").
 */
export function normalizeHouseNo(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str).trim();
}

/** Common street suffixes to standardize (uppercase, no period). */
const SUFFIX_MAP: Record<string, string> = {
  street: "ST",
  st: "ST",
  avenue: "AVE",
  ave: "AVE",
  av: "AVE",
  boulevard: "BLVD",
  blvd: "BLVD",
  road: "RD",
  rd: "RD",
  place: "PL",
  pl: "PL",
  drive: "DR",
  dr: "DR",
  lane: "LN",
  ln: "LN",
  court: "CT",
  ct: "CT",
  circle: "CIR",
  cir: "CIR",
  way: "WAY",
  terrace: "TER",
  ter: "TER",
  parkway: "PKWY",
  pkwy: "PKWY",
  highway: "HWY",
  hwy: "HWY",
  broadway: "BROADWAY",
  "st.": "ST",
  "ave.": "AVE",
  "blvd.": "BLVD",
  "rd.": "RD",
  "dr.": "DR",
  "ln.": "LN",
  "pl.": "PL",
  "ct.": "CT",
};

/** Strip unit/apt/suite patterns from the end of a string. */
function stripUnitPatterns(s: string): string {
  return s
    .replace(/\s*(?:apt|apartment|unit|suite|ste|#|no\.?)\s*[\dA-Za-z-]+\s*$/i, "")
    .replace(/\s*,\s*unit\s+[\dA-Za-z-]+\s*$/i, "")
    .trim();
}

/**
 * Uppercase, remove punctuation (except hyphen in numbers), standardize suffixes, drop unit/apt.
 */
export function normalizeStreetName(str: string | null | undefined): string {
  if (str == null || typeof str !== "string") return "";
  let s = str.trim();
  if (!s) return "";
  s = stripUnitPatterns(s);
  s = s.toUpperCase().replace(/[.,]/g, " ");
  const parts = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();
    out.push(SUFFIX_MAP[lower] ?? part);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Ordinal suffix to number for permit API (dataset uses "22" not "22ND"). */
const ORDINAL_SUFFIX = /^(\d+)(ST|ND|RD|TH)$/i;
function ordinalToNumber(word: string): string {
  const m = word.match(ORDINAL_SUFFIX);
  return m ? m[1] ?? word : word;
}

/**
 * Normalize street name to match NYC permit API format (rbx6-tga4).
 * API uses e.g. "WEST   22 STREET" (full "STREET", ordinals as numbers, variable spaces).
 * Returns one or more variants to try (exact single-space, then multi-space).
 */
export function streetNameForPermitApi(str: string | null | undefined): string[] {
  if (str == null || typeof str !== "string") return [];
  let s = normalizeStreetName(str);
  if (!s) return [];
  const parts = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(ordinalToNumber(parts[i]!));
  }
  let base = out.join(" ");
  if (/\s+ST\s*$/.test(base) || base === "ST") {
    base = base.replace(/\s+ST\s*$/, " STREET").trim();
  }
  if (/\s+AVE\s*$/.test(base) || base === "AVE") {
    base = base.replace(/\s+AVE\s*$/, " AVENUE").trim();
  }
  const variants: string[] = [base];
  const withTwoSpaces = out.join("  ");
  if (withTwoSpaces !== base) variants.push(withTwoSpaces);
  const withThreeSpaces = out.join("   ");
  if (withThreeSpaces !== base && withThreeSpaces !== withTwoSpaces) variants.push(withThreeSpaces);
  return variants;
}

/**
 * Parse common date formats to YYYY-MM-DD or null.
 */
export function parseDateToYyyyMmDd(str: string | null | undefined): string | null {
  if (str == null || typeof str !== "string") return null;
  const s = str.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Strip $ and commas; return number (dollars). Returns 0 if invalid.
 */
export function parseEstimatedCost(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") {
    return Number.isNaN(value) ? 0 : Math.round(value);
  }
  const s = String(value).replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : Math.round(n);
}
