/**
 * BBL (Borough-Block-Lot) utilities for NYC Open Data SoQL queries.
 * BBL format: 1 digit borough (1-5) + 5 digit block + 4 digit lot = 10 digits.
 */

export const BOROUGH_CODES: Record<string, string> = {
  "1": "MANHATTAN",
  "2": "BRONX",
  "3": "BROOKLYN",
  "4": "QUEENS",
  "5": "STATEN ISLAND",
};

/** Borough name (any case) to code 1–5. */
const BOROUGH_NAME_TO_CODE: Record<string, string> = {
  manhattan: "1",
  bronx: "2",
  brooklyn: "3",
  queens: "4",
  "staten island": "5",
};

export interface BoroughBlockLot {
  borough: string;
  block: string;
  lot: string;
}

/**
 * Normalize BBL for API queries: ensure 10-digit string (borough 1 + block 5 + lot 4).
 * Handles unpadded or string/numeric differences. Pads with leading zeros if needed.
 * Returns null if not parseable or borough not 1-5.
 */
export function normalizeBblForQuery(bbl: string | number | null | undefined): string | null {
  if (bbl == null) return null;
  const raw = String(bbl).replace(/\D/g, "").trim();
  if (raw.length === 0 || raw.length > 10) return null;
  const padded = raw.padStart(10, "0").slice(-10);
  if (!/^\d{10}$/.test(padded)) return null;
  const boroughCode = padded.slice(0, 1);
  if (boroughCode < "1" || boroughCode > "5") return null;
  return padded;
}

/**
 * Split a 10-digit BBL into borough name, block, and lot for SoQL filters.
 * Borough code: 1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island.
 */
export function bblToBoroughBlockLot(bbl: string): BoroughBlockLot | null {
  const normalized = normalizeBblForQuery(bbl);
  if (!normalized) return null;
  const boroughCode = normalized.slice(0, 1);
  const block = normalized.slice(1, 6);
  const lot = normalized.slice(6, 10);
  const borough = BOROUGH_CODES[boroughCode] ?? boroughCode;
  return { borough, block, lot };
}

/**
 * Build a 10-digit BBL from a row that has borough/block/lot (no bbl column).
 * Row may have: boroid or borough_code (1–5), or boro/borough (name); block; lot.
 * Use to filter API results so only rows matching the Geoclient BBL are kept.
 */
export function rowToBblFromBoroughBlockLot(row: Record<string, unknown>): string | null {
  let code: string | null = null;
  const boroid = row.boroid ?? row.borough_code;
  if (boroid != null) {
    const s = String(boroid).trim();
    if (/^[1-5]$/.test(s)) code = s;
  }
  if (!code) {
    const boro = row.boro ?? row.borough;
    if (boro != null && typeof boro === "string") {
      const key = boro.trim().toLowerCase();
      code = BOROUGH_NAME_TO_CODE[key] ?? null;
    }
  }
  const blockRaw = row.block ?? row.tax_block;
  const lotRaw = row.lot ?? row.tax_lot;
  if (!code || blockRaw == null || lotRaw == null) return null;
  const block = String(blockRaw).replace(/\D/g, "").padStart(5, "0").slice(-5);
  const lot = String(lotRaw).replace(/\D/g, "").padStart(4, "0").slice(-4);
  if (block.length !== 5 || lot.length !== 4) return null;
  return code + block + lot;
}
