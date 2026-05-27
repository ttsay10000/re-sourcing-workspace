import {
  escapeSoQLString,
  fetchSocrataQuery,
  resourceUrl,
  type FetchSocrataOptions,
  type SoQLQueryParams,
} from "../socrata/index.js";
import {
  bblParts,
  censusTractFromBct2020,
  countyForBoroughCode,
  FEMA_NFHL_SOURCE_URL,
} from "./normalizers.js";
import type {
  CensusAcsProfileRow,
  FemaFloodAttributes,
  PlutoNeighborhoodRow,
  RollingSalesRow,
} from "./types.js";

export const PLUTO_DATASET_ID = "64uk-42ks";
export const ROLLING_SALES_DATASET_ID = "usep-8jbt";

const DEFAULT_CENSUS_YEAR = process.env.CENSUS_ACS_YEAR?.trim() || "2024";
const CENSUS_VARIABLES = [
  "NAME",
  "DP05_0001E",
  "DP03_0062E",
  "DP04_0134E",
  "DP04_0046E",
  "DP04_0047E",
  "DP04_0001E",
];

const PLUTO_SELECT = [
  "borough",
  "block",
  "lot",
  "cd",
  "council",
  "zipcode",
  "address",
  "bbl",
  "ct2010",
  "cb2010",
  "tract2010",
  "bct2020",
  "bctcb2020",
  "latitude",
  "longitude",
  "landuse",
  "bldgclass",
  "lotarea",
  "bldgarea",
  "unitsres",
  "unitstotal",
  "yearbuilt",
  "version",
  "firm07_flag",
  "pfirm15_flag",
].join(", ");

const ROLLING_SALES_SELECT = [
  "borough",
  "neighborhood",
  "building_class_category",
  "tax_class_at_present",
  "block",
  "lot",
  "building_class_at_present",
  "address",
  "apartment_number",
  "zip_code",
  "residential_units",
  "commercial_units",
  "total_units",
  "land_square_feet",
  "gross_square_feet",
  "year_built",
  "tax_class_at_time_of_sale",
  "building_class_at_time_of",
  "sale_price",
  "sale_date",
].join(", ");

function onePageParams(params: {
  select: string;
  where: string;
  order?: string;
  limit?: number;
  offset?: number;
}): SoQLQueryParams {
  return {
    $select: params.select,
    $where: params.where,
    $order: params.order ?? "1",
    $limit: params.limit ?? 1,
    $offset: params.offset ?? 0,
  };
}

export async function fetchPlutoNeighborhoodByBbl(
  bbl: string,
  options: FetchSocrataOptions = {}
): Promise<PlutoNeighborhoodRow | null> {
  const parts = bblParts(bbl);
  if (!parts) return null;
  const bblNumber = Number(bbl);
  if (!Number.isFinite(bblNumber)) return null;
  const rows = await fetchSocrataQuery<PlutoNeighborhoodRow>(
    resourceUrl(PLUTO_DATASET_ID),
    onePageParams({
      select: PLUTO_SELECT,
      where: `bbl = ${bblNumber}`,
      order: "bbl",
      limit: 1,
    }),
    options
  );
  return rows[0] ?? null;
}

export async function fetchRollingSalesForExactTaxLot(
  bbl: string,
  options: FetchSocrataOptions = {}
): Promise<RollingSalesRow[]> {
  const parts = bblParts(bbl);
  if (!parts) return [];
  const lot = Number(parts.lot);
  if (!Number.isFinite(lot)) return [];
  const where = [
    `borough = '${escapeSoQLString(parts.boroughCode)}'`,
    `block = '${escapeSoQLString(parts.block)}'`,
    `lot = ${lot}`,
  ].join(" AND ");
  return fetchSocrataQuery<RollingSalesRow>(
    resourceUrl(ROLLING_SALES_DATASET_ID),
    onePageParams({
      select: ROLLING_SALES_SELECT,
      where,
      order: "sale_date DESC",
      limit: 25,
    }),
    options
  );
}

export async function fetchRollingSalesNeighborhoodCandidates(params: {
  boroughCode: string | null;
  zip: string | null;
  options?: FetchSocrataOptions;
}): Promise<RollingSalesRow[]> {
  if (!params.boroughCode || !params.zip) return [];
  const where = [
    `borough = '${escapeSoQLString(params.boroughCode)}'`,
    `zip_code = '${escapeSoQLString(params.zip)}'`,
    "sale_price > 0",
  ].join(" AND ");
  return fetchSocrataQuery<RollingSalesRow>(
    resourceUrl(ROLLING_SALES_DATASET_ID),
    onePageParams({
      select: "neighborhood, sale_date, sale_price",
      where,
      order: "sale_date DESC",
      limit: 500,
    }),
    params.options
  );
}

export async function fetchRollingSalesMarketSample(params: {
  boroughCode: string | null;
  neighborhoodName: string | null;
  zip: string | null;
  options?: FetchSocrataOptions;
}): Promise<RollingSalesRow[]> {
  if (!params.boroughCode) return [];
  const filters = [`borough = '${escapeSoQLString(params.boroughCode)}'`, "sale_price > 0"];
  if (params.neighborhoodName) {
    filters.push(`neighborhood = '${escapeSoQLString(params.neighborhoodName)}'`);
  } else if (params.zip) {
    filters.push(`zip_code = '${escapeSoQLString(params.zip)}'`);
  } else {
    return [];
  }
  return fetchSocrataQuery<RollingSalesRow>(
    resourceUrl(ROLLING_SALES_DATASET_ID),
    onePageParams({
      select: ROLLING_SALES_SELECT,
      where: filters.join(" AND "),
      order: "sale_date DESC",
      limit: 500,
    }),
    params.options
  );
}

export function buildCensusTractGeoId(geography: {
  boroughCode: string | null;
  censusTract2020: string | null;
}): { state: string; county: string; tract: string; geoid: string } | null {
  const county = countyForBoroughCode(geography.boroughCode);
  const tract = censusTractFromBct2020(geography.censusTract2020);
  if (!county || !tract) return null;
  return {
    state: "36",
    county: county.code,
    tract,
    geoid: `36${county.code}${tract}`,
  };
}

export async function fetchCensusAcsProfile(params: {
  geography: { boroughCode: string | null; censusTract2020: string | null };
  apiKey?: string | null;
  year?: string | null;
  timeoutMs?: number;
}): Promise<{ row: CensusAcsProfileRow | null; censusYear: string; tractGeoId: string | null; status: string }> {
  const censusYear = params.year?.trim() || DEFAULT_CENSUS_YEAR;
  const tract = buildCensusTractGeoId(params.geography);
  if (!tract) return { row: null, censusYear, tractGeoId: null, status: "missing_tract" };
  const apiKey = params.apiKey?.trim();
  if (!apiKey) return { row: null, censusYear, tractGeoId: tract.geoid, status: "not_configured" };

  const url = new URL(`https://api.census.gov/data/${encodeURIComponent(censusYear)}/acs/acs5/profile`);
  url.searchParams.set("get", CENSUS_VARIABLES.join(","));
  url.searchParams.set("for", `tract:${tract.tract}`);
  url.searchParams.set("in", `state:${tract.state} county:${tract.county}`);
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      return { row: null, censusYear, tractGeoId: tract.geoid, status: `error:${res.status}` };
    }
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0]) || !Array.isArray(parsed[1])) {
      return { row: null, censusYear, tractGeoId: tract.geoid, status: "empty" };
    }
    const header = parsed[0] as string[];
    const values = parsed[1] as unknown[];
    const row: Record<string, unknown> = {};
    for (let index = 0; index < header.length; index += 1) row[header[index]!] = values[index] ?? null;
    return { row: row as CensusAcsProfileRow, censusYear, tractGeoId: tract.geoid, status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { row: null, censusYear, tractGeoId: tract.geoid, status: `error:${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchFemaFloodByPoint(params: {
  lat: number | null;
  lon: number | null;
  timeoutMs?: number;
}): Promise<{ attributes: FemaFloodAttributes | null; status: string }> {
  if (params.lat == null || params.lon == null) return { attributes: null, status: "missing_point" };
  if (!Number.isFinite(params.lat) || !Number.isFinite(params.lon)) return { attributes: null, status: "invalid_point" };

  const url = new URL(`${FEMA_NFHL_SOURCE_URL}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("geometry", `${params.lon},${params.lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH");
  url.searchParams.set("returnGeometry", "false");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { attributes: null, status: `error:${res.status}` };
    const body = JSON.parse(text) as { features?: Array<{ attributes?: FemaFloodAttributes }> };
    const attributes = Array.isArray(body.features) ? body.features[0]?.attributes ?? null : null;
    return { attributes, status: attributes ? "ok" : "empty" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { attributes: null, status: `error:${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}
