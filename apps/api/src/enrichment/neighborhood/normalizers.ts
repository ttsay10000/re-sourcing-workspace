import { parseDateToYyyyMmDd } from "../normalizeDate.js";
import type {
  CensusAcsProfileRow,
  FemaFloodAttributes,
  NeighborhoodComps,
  NeighborhoodDemographics,
  NeighborhoodGeography,
  NeighborhoodIdentity,
  NeighborhoodMarket,
  NeighborhoodMarketSaleComp,
  NeighborhoodProvenance,
  NeighborhoodRisk,
  PlutoNeighborhoodRow,
  RollingSalesRow,
} from "./types.js";

export const PLUTO_SOURCE_URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json";
export const ROLLING_SALES_SOURCE_URL = "https://data.cityofnewyork.us/resource/usep-8jbt.json";
export const CENSUS_ACS_SOURCE_URL = "https://api.census.gov/data";
export const FEMA_NFHL_SOURCE_URL =
  "https://services.arcgis.com/oAoeYJ1kqmAwcEC2/ArcGIS/rest/services/Flood_Hazard_Areas/FeatureServer/0";

const BOROUGH_CODE_TO_NAME: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

const PLUTO_BOROUGH_TO_CODE: Record<string, string> = {
  MN: "1",
  BX: "2",
  BK: "3",
  QN: "4",
  SI: "5",
};

const COUNTY_BY_BOROUGH_CODE: Record<string, { code: string; name: string }> = {
  "1": { code: "061", name: "New York County" },
  "2": { code: "005", name: "Bronx County" },
  "3": { code: "047", name: "Kings County" },
  "4": { code: "081", name: "Queens County" },
  "5": { code: "085", name: "Richmond County" },
};

export function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function num(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/[$,\s]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function intString(value: unknown): string | null {
  const n = num(value);
  if (n == null) return text(value);
  return String(Math.trunc(n));
}

function booleanFlag(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "t", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "f", "no", "n"].includes(normalized)) return false;
  return null;
}

function provenance(params: {
  source: string;
  sourceId?: string | null;
  url?: string | null;
  fetchedAt: string;
  confidence: number;
  coverage: NeighborhoodProvenance["coverage"];
  notes?: string | null;
}): NeighborhoodProvenance {
  return {
    source: params.source,
    sourceId: params.sourceId ?? null,
    url: params.url ?? null,
    fetchedAt: params.fetchedAt,
    confidence: params.confidence,
    coverage: params.coverage,
    notes: params.notes ?? null,
  };
}

export function bblParts(bbl: string): { boroughCode: string; borough: string; block: string; lot: string } | null {
  const digits = bbl.replace(/\D/g, "");
  if (!/^[1-5]\d{9}$/.test(digits)) return null;
  const boroughCode = digits.slice(0, 1);
  return {
    boroughCode,
    borough: BOROUGH_CODE_TO_NAME[boroughCode] ?? boroughCode,
    block: String(Number(digits.slice(1, 6))),
    lot: String(Number(digits.slice(6, 10))),
  };
}

export function countyForBoroughCode(boroughCode: string | null): { code: string; name: string } | null {
  return boroughCode ? COUNTY_BY_BOROUGH_CODE[boroughCode] ?? null : null;
}

export function censusTractFromBct2020(bct2020: string | null): string | null {
  if (!bct2020 || !/^[1-5]\d{6}$/.test(bct2020)) return null;
  return bct2020.slice(1);
}

export function normalizeNeighborhoodName(name: string | null): string | null {
  if (!name) return null;
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function buildPlutoGeography(
  row: PlutoNeighborhoodRow | null,
  params: { bbl: string; queryBbl: string; fetchedAt: string }
): NeighborhoodGeography | null {
  if (!row) return null;
  const parts = bblParts(params.bbl);
  const plutoBorough = text(row.borough);
  const boroughCode = plutoBorough ? PLUTO_BOROUGH_TO_CODE[plutoBorough] ?? parts?.boroughCode ?? null : parts?.boroughCode ?? null;
  const bct2020 = text(row.bct2020);
  const bctcb2020 = text(row.bctcb2020);
  return {
    bbl: params.bbl,
    queryBbl: params.queryBbl,
    boroughCode,
    borough: boroughCode ? BOROUGH_CODE_TO_NAME[boroughCode] ?? null : parts?.borough ?? null,
    block: intString(row.block) ?? parts?.block ?? null,
    lot: intString(row.lot) ?? parts?.lot ?? null,
    address: text(row.address),
    zip: intString(row.zipcode),
    communityDistrict: intString(row.cd),
    councilDistrict: intString(row.council),
    censusTract2010: text(row.tract2010) ?? text(row.ct2010),
    censusBlock2010: intString(row.cb2010),
    censusTract2020: bct2020,
    censusBlock2020: bctcb2020,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    landUse: text(row.landuse),
    buildingClass: text(row.bldgclass),
    lotAreaSqft: num(row.lotarea),
    buildingAreaSqft: num(row.bldgarea),
    residentialUnits: num(row.unitsres),
    totalUnits: num(row.unitstotal),
    yearBuilt: num(row.yearbuilt),
    plutoVersion: text(row.version),
    provenance: provenance({
      source: "nyc_pluto",
      sourceId: "64uk-42ks",
      url: PLUTO_SOURCE_URL,
      fetchedAt: params.fetchedAt,
      confidence: 0.95,
      coverage: "full",
      notes: "Tax-lot geography from NYC PLUTO.",
    }),
  };
}

export function buildRiskSection(
  row: PlutoNeighborhoodRow | null,
  femaAttributes: FemaFloodAttributes | null,
  fetchedAt: string,
  femaCoverage: NeighborhoodProvenance["coverage"],
  femaNotes?: string | null
): NeighborhoodRisk {
  const firm2007 = row ? booleanFlag(row.firm07_flag) : null;
  const pfirm2015 = row ? booleanFlag(row.pfirm15_flag) : null;
  const sfhaRaw = text(femaAttributes?.SFHA_TF);
  const sfha =
    sfhaRaw == null ? null : ["T", "TRUE", "Y", "YES", "1"].includes(sfhaRaw.trim().toUpperCase());
  return {
    flood: {
      firm2007FloodplainFlag: firm2007,
      preliminaryFirm2015FloodplainFlag: pfirm2015,
      nfhlFloodZone: text(femaAttributes?.FLD_ZONE),
      nfhlZoneSubtype: text(femaAttributes?.ZONE_SUBTY),
      nfhlSpecialFloodHazardArea: sfha,
      baseFloodElevation: num(femaAttributes?.STATIC_BFE),
      depth: num(femaAttributes?.DEPTH),
      provenance: provenance({
        source: femaAttributes ? "fema_nfhl" : "nyc_pluto_fema_flags",
        sourceId: femaAttributes ? "Flood_Hazard_Areas/FeatureServer/0" : "64uk-42ks",
        url: femaAttributes ? FEMA_NFHL_SOURCE_URL : PLUTO_SOURCE_URL,
        fetchedAt,
        confidence: femaAttributes ? 0.9 : row ? 0.75 : 0,
        coverage: femaCoverage,
        notes:
          femaNotes ??
          (femaAttributes
            ? "Point intersect against FEMA NFHL flood hazard areas."
            : "PLUTO exposes FEMA-derived FIRM flags at tax-lot level; direct NFHL point data was not available."),
      }),
    },
  };
}

export function buildPrimaryIdentity(params: {
  neighborhoodName: string | null;
  geography: NeighborhoodGeography | null;
  sourceId: string | null;
  confidence: number;
}): NeighborhoodIdentity | null {
  if (!params.neighborhoodName && !params.geography?.zip && !params.geography?.borough) return null;
  const county = countyForBoroughCode(params.geography?.boroughCode ?? null);
  const name = normalizeNeighborhoodName(params.neighborhoodName) ?? params.geography?.zip ?? params.geography?.borough ?? "Unknown";
  return {
    name,
    normalizedName: normalizeNeighborhoodName(name),
    borough: params.geography?.borough ?? null,
    city: "New York",
    state: "NY",
    county: county?.name ?? null,
    zip: params.geography?.zip ?? null,
    source: params.neighborhoodName ? "nyc_rolling_sales" : "nyc_pluto",
    sourceId: params.sourceId,
    confidence: params.confidence,
  };
}

export function topNeighborhoodFromRows(rows: RollingSalesRow[]): { name: string | null; count: number } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = text(row.neighborhood);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + (num(row.sale_count) ?? 1));
  }
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [name, count] = sorted[0] ?? [null, 0];
  return { name, count };
}

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  return left == null || right == null ? null : (left + right) / 2;
}

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizeRollingSale(row: RollingSalesRow): NeighborhoodMarketSaleComp {
  const salePrice = num(row.sale_price);
  const grossSqft = num(row.gross_square_feet);
  const pricePsf = salePrice != null && grossSqft != null && salePrice > 0 && grossSqft > 0 ? salePrice / grossSqft : null;
  return {
    address: text(row.address),
    saleDate: parseDateToYyyyMmDd(text(row.sale_date)),
    salePrice,
    grossSqft,
    pricePsf: round(pricePsf),
    residentialUnits: num(row.residential_units),
    totalUnits: num(row.total_units),
    buildingClassCategory: text(row.building_class_category),
    taxClass: text(row.tax_class_at_present) ?? text(row.tax_class_at_time_of_sale),
  };
}

export function summarizeRollingSalesMarket(params: {
  rows: RollingSalesRow[];
  neighborhoodName: string | null;
  scope: NeighborhoodMarket["scope"];
  fetchedAt: string;
}): NeighborhoodMarket {
  const sample = params.rows.map(normalizeRollingSale);
  const priced = sample.filter((sale) => sale.salePrice != null && sale.salePrice > 0);
  const psf = priced
    .map((sale) => sale.pricePsf)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const latestSaleDate = sample
    .map((sale) => sale.saleDate)
    .filter((date): date is string => date != null)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  return {
    rollingSalesNeighborhood: params.neighborhoodName,
    scope: params.scope,
    saleCount: sample.length,
    pricedSaleCount: priced.length,
    medianSalePrice: median(priced.map((sale) => sale.salePrice as number)),
    medianPricePsf: round(median(psf)),
    averagePricePsf: round(psf.length > 0 ? psf.reduce((sum, value) => sum + value, 0) / psf.length : null),
    latestSaleDate,
    sample: sample.slice(0, 10),
    provenance: provenance({
      source: "nyc_rolling_calendar_sales",
      sourceId: "usep-8jbt",
      url: ROLLING_SALES_SOURCE_URL,
      fetchedAt: params.fetchedAt,
      confidence: sample.length === 0 ? 0 : priced.length >= 10 ? 0.8 : priced.length > 0 ? 0.55 : 0.25,
      coverage: sample.length > 0 ? (priced.length >= 10 ? "full" : "partial") : "empty",
      notes: "Current NYC rolling calendar sales rows; zero-dollar transfers are excluded from price metrics.",
    }),
  };
}

export function buildEmptyMarket(fetchedAt: string, notes: string): NeighborhoodMarket {
  const market = summarizeRollingSalesMarket({
    rows: [],
    neighborhoodName: null,
    scope: "unavailable",
    fetchedAt,
  });
  return {
    ...market,
    provenance: {
      ...market.provenance,
      notes,
    },
  };
}

export function normalizeCensusAcsProfile(
  row: CensusAcsProfileRow | null,
  params: { censusYear: string | null; tractGeoId: string | null; fetchedAt: string; notes?: string | null }
): NeighborhoodDemographics {
  const coverage = row ? "full" : params.notes?.includes("not configured") ? "not_configured" : "unavailable";
  return {
    censusYear: params.censusYear,
    tractGeoId: params.tractGeoId,
    name: text(row?.NAME),
    population: num(row?.DP05_0001E),
    medianHouseholdIncome: num(row?.DP03_0062E),
    medianGrossRent: num(row?.DP04_0134E),
    ownerOccupiedUnits: num(row?.DP04_0046E),
    renterOccupiedUnits: num(row?.DP04_0047E),
    totalHousingUnits: num(row?.DP04_0001E),
    provenance: provenance({
      source: "census_acs5_profile",
      sourceId: params.censusYear ? `${params.censusYear}/acs/acs5/profile` : null,
      url: CENSUS_ACS_SOURCE_URL,
      fetchedAt: params.fetchedAt,
      confidence: row ? 0.85 : 0,
      coverage,
      notes: params.notes ?? "ACS 5-year profile values by 2020 census tract.",
    }),
  };
}

export function buildCompSection(fetchedAt: string): NeighborhoodComps {
  return {
    schemaVersion: "neighborhood-comps-v1",
    records: [],
    providerStatus: [
      {
        provider: "manual",
        status: "manual_import_ready",
        notes: "Use records[] for analyst-entered or file-imported comps in the normalized schema.",
      },
      {
        provider: "airbnb",
        status: "placeholder_not_scraped",
        notes: "No Airbnb scraping. Future provider/import should write normalized records with source provenance.",
      },
      {
        provider: "blueground",
        status: "placeholder_not_scraped",
        notes: "No Blueground scraping. Add a licensed provider/import adapter before populating records.",
      },
      {
        provider: "haus",
        status: "placeholder_not_scraped",
        notes: "No Haus scraping. Add a licensed provider/import adapter before populating records.",
      },
    ],
    provenance: provenance({
      source: "manual_comp_schema",
      sourceId: "neighborhood-comps-v1",
      fetchedAt,
      confidence: 1,
      coverage: "empty",
      notes: "Schema scaffold only; no competitor data fetched.",
    }),
  };
}

export function flattenProvenance(params: {
  geography: NeighborhoodGeography | null;
  demographics: NeighborhoodDemographics | null;
  market: NeighborhoodMarket | null;
  risk: NeighborhoodRisk;
  comps: NeighborhoodComps;
}): NeighborhoodProvenance[] {
  return [
    params.geography?.provenance,
    params.demographics?.provenance,
    params.market?.provenance,
    params.risk.flood.provenance,
    params.comps.provenance,
  ].filter((entry): entry is NeighborhoodProvenance => entry != null);
}
