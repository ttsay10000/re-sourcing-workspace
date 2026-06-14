/**
 * Cross-document comp dedupe (code, not LLM).
 *
 * Dedupe key: same normalized address + sale price within ±2% + sale date
 * within ±30 days = one deal. The merged row keeps the most-populated record's
 * fields, prefers research-sourced figures for closed price/cap when a deal
 * appears in BOTH a research report and a broker document, and merges
 * provenance into provenance_list so the UI can show corroboration.
 */
import type { MarketComp, MarketProvenance } from "@re-sourcing/contracts";
import type { ExtractedComp } from "./extract.js";

const STREET_SUFFIXES: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  rd: "road",
  pl: "place",
  sq: "square",
  pkwy: "parkway",
  dr: "drive",
  ln: "lane",
  ct: "court",
  ter: "terrace",
  hwy: "highway",
};

const DIRECTIONALS: Record<string, string> = {
  e: "east",
  w: "west",
  n: "north",
  s: "south",
};

/**
 * Canonical dedupe key for an address: "242 Elizabeth St." and
 * "242 elizabeth street, New York" both → "242 elizabeth street".
 */
export function normalizeCompAddress(address: string): string {
  const firstSegment = address.split(",")[0] ?? address;
  const tokens = firstSegment
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .split(/\s+/)
    .filter(Boolean);
  return tokens
    .map((token, index) => {
      if (index > 0 && DIRECTIONALS[token]) return DIRECTIONALS[token];
      if (index > 0 && STREET_SUFFIXES[token]) return STREET_SUFFIXES[token];
      return token;
    })
    .join(" ");
}

const PRICE_TOLERANCE = 0.02;
const DATE_TOLERANCE_DAYS = 30;

function pricesMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  const reference = Math.max(Math.abs(a), Math.abs(b));
  if (reference === 0) return a === b;
  return Math.abs(a - b) / reference <= PRICE_TOLERANCE;
}

function datesMatch(a: string | null, b: string | null): boolean {
  // Many comp lists omit exact dates; a missing date never blocks an
  // address+price match — the populated date survives the merge.
  if (a == null || b == null) return true;
  const diffMs = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return diffMs <= DATE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
}

export interface CompForDedupe extends ExtractedComp {
  addressNormalized: string;
}

export function isSameDeal(existing: MarketComp, incoming: CompForDedupe): boolean {
  return (
    normalizeCompAddress(existing.address) === incoming.addressNormalized &&
    pricesMatch(existing.salePrice, incoming.salePrice) &&
    datesMatch(existing.saleDate, incoming.saleDate)
  );
}

function isResearch(provenance: MarketProvenance): boolean {
  return provenance.source_type === "market_research";
}

function populatedFieldCount(comp: ExtractedComp | MarketComp): number {
  const values = [
    comp.salePrice,
    comp.saleDate,
    comp.gsf,
    comp.pricePsf,
    comp.pricePerUnit,
    comp.unitsTotal,
    comp.unitsResi,
    comp.pctRentStabilized,
    comp.noi,
    comp.capRate,
    comp.grm,
    comp.assetType,
    comp.buyer,
    comp.seller,
    comp.notesShort,
    comp.borough,
    comp.neighborhoodRaw,
  ];
  return values.filter((value) => value != null).length;
}

function provenanceKey(p: MarketProvenance): string {
  return `${p.document_id}:${p.page ?? ""}`;
}

export function mergeProvenanceLists(
  existing: MarketProvenance[],
  incoming: MarketProvenance[]
): MarketProvenance[] {
  const merged: MarketProvenance[] = [];
  const seen = new Set<string>();
  for (const provenance of [...existing, ...incoming]) {
    const key = provenanceKey(provenance);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(provenance);
  }
  return merged;
}

export interface MergedComp extends CompForDedupe {
  neighborhoodId: string | null;
  provenanceList: MarketProvenance[];
  lat: number | null;
  lng: number | null;
}

/**
 * Merge an incoming extracted comp into an existing row. Field source is the
 * more-populated record, except closed price/cap figures, which prefer the
 * research-sourced side when one side is a published report.
 */
export function mergeComps(existing: MarketComp, incoming: MergedComp): MergedComp {
  const existingResearch = isResearch(existing.provenance);
  const incomingResearch = isResearch(incoming.provenance);
  const incomingWins = populatedFieldCount(incoming) > populatedFieldCount(existing);
  const base: MergedComp = incomingWins
    ? { ...incoming }
    : {
        address: existing.address,
        addressNormalized: normalizeCompAddress(existing.address),
        neighborhoodRaw: existing.neighborhoodRaw,
        neighborhoodId: existing.neighborhoodId,
        borough: existing.borough,
        salePrice: existing.salePrice,
        priceType: existing.priceType,
        saleDate: existing.saleDate,
        gsf: existing.gsf,
        pricePsf: existing.pricePsf,
        pricePerUnit: existing.pricePerUnit,
        unitsTotal: existing.unitsTotal,
        unitsResi: existing.unitsResi,
        pctRentStabilized: existing.pctRentStabilized,
        noi: existing.noi,
        capRate: existing.capRate,
        grm: existing.grm,
        assetType: existing.assetType,
        buyer: existing.buyer,
        seller: existing.seller,
        saleConditions: existing.saleConditions,
        notesShort: existing.notesShort,
        cherryPickRisk: existing.cherryPickRisk,
        isSubjectProperty: existing.isSubjectProperty,
        confidence: existing.confidence,
        rawText: existing.rawText,
        provenance: existing.provenance,
        provenanceList: existing.provenanceList,
        lat: existing.lat,
        lng: existing.lng,
      };

  // Fill gaps from the other side regardless of winner.
  const other = incomingWins ? existing : incoming;
  base.neighborhoodId = base.neighborhoodId ?? (incomingWins ? existing.neighborhoodId : incoming.neighborhoodId);
  base.neighborhoodRaw = base.neighborhoodRaw ?? other.neighborhoodRaw;
  base.borough = base.borough ?? other.borough;
  base.salePrice = base.salePrice ?? other.salePrice;
  base.saleDate = base.saleDate ?? other.saleDate;
  base.gsf = base.gsf ?? other.gsf;
  base.pricePsf = base.pricePsf ?? other.pricePsf;
  base.pricePerUnit = base.pricePerUnit ?? other.pricePerUnit;
  base.unitsTotal = base.unitsTotal ?? other.unitsTotal;
  base.unitsResi = base.unitsResi ?? other.unitsResi;
  base.pctRentStabilized = base.pctRentStabilized ?? other.pctRentStabilized;
  base.noi = base.noi ?? other.noi;
  base.capRate = base.capRate ?? other.capRate;
  base.grm = base.grm ?? other.grm;
  base.assetType = base.assetType ?? other.assetType;
  base.buyer = base.buyer ?? other.buyer;
  base.seller = base.seller ?? other.seller;
  base.notesShort = base.notesShort ?? other.notesShort;
  base.lat = base.lat ?? (incomingWins ? existing.lat : incoming.lat);
  base.lng = base.lng ?? (incomingWins ? existing.lng : incoming.lng);
  // Condition flags accumulate — a footnote either side printed stays true.
  // (?? [] guards rows persisted before migration 065 added the column.)
  base.saleConditions = [...new Set([...(existing.saleConditions ?? []), ...(incoming.saleConditions ?? [])])];

  // Research-sourced closed figures win over broker-provided ones.
  const researchSide = existingResearch ? existing : incomingResearch ? incoming : null;
  if (researchSide && researchSide.priceType === "closed") {
    base.salePrice = researchSide.salePrice ?? base.salePrice;
    base.capRate = researchSide.capRate ?? base.capRate;
    base.pricePsf = researchSide.pricePsf ?? base.pricePsf;
    base.pricePerUnit = researchSide.pricePerUnit ?? base.pricePerUnit;
    base.noi = researchSide.noi ?? base.noi;
    base.saleDate = researchSide.saleDate ?? base.saleDate;
    base.priceType = "closed";
    base.provenance = researchSide.provenance;
    // A deal corroborated by research is no longer just a cherry-picked OM comp.
    base.cherryPickRisk = false;
  }

  base.provenanceList = mergeProvenanceLists(
    existing.provenanceList.length > 0 ? existing.provenanceList : [existing.provenance],
    incoming.provenanceList.length > 0 ? incoming.provenanceList : [incoming.provenance]
  );
  return base;
}
