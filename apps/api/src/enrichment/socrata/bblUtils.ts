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

export interface BoroughBlockLot {
  borough: string;
  block: string;
  lot: string;
}

/**
 * Split a 10-digit BBL into borough name, block, and lot for SoQL filters.
 * Borough code: 1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island.
 */
export function bblToBoroughBlockLot(bbl: string): BoroughBlockLot | null {
  const trimmed = typeof bbl === "string" ? bbl.trim() : "";
  if (!/^\d{10}$/.test(trimmed)) return null;
  const boroughCode = trimmed.slice(0, 1);
  const block = trimmed.slice(1, 6);
  const lot = trimmed.slice(6, 10);
  const borough = BOROUGH_CODES[boroughCode] ?? boroughCode;
  return { borough, block, lot };
}
