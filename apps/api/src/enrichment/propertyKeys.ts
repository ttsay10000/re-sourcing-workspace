/**
 * Get BBL and BIN from property details (from enrichment flow).
 */
export function getBblFromDetails(details: Record<string, unknown> | null | undefined): string | null {
  if (!details || typeof details !== "object") return null;
  const bbl = details.bbl ?? details.buildingLotBlock;
  const str = typeof bbl === "string" ? bbl.trim() : "";
  return /^\d{10}$/.test(str) ? str : null;
}

/** Base BBL used for NYC dataset queries (condo base when present; same as tax for non-condos). */
export function getBblBaseFromDetails(details: Record<string, unknown> | null | undefined): string | null {
  if (!details || typeof details !== "object") return null;
  const base = details.bblBase ?? details.condoBaseBbl;
  const str = typeof base === "string" ? base.trim() : "";
  return /^\d{10}$/.test(str) ? str : null;
}

export function getBinFromDetails(details: Record<string, unknown> | null | undefined): string | null {
  if (!details || typeof details !== "object") return null;
  const bin = details.bin;
  const str = typeof bin === "string" ? bin.trim() : "";
  return str || null;
}
