export type NeighborhoodCoverage =
  | "full"
  | "partial"
  | "empty"
  | "unavailable"
  | "error"
  | "not_configured";

export interface NeighborhoodProvenance {
  source: string;
  sourceId?: string | null;
  url?: string | null;
  fetchedAt: string;
  confidence: number;
  coverage: NeighborhoodCoverage;
  notes?: string | null;
}

export interface NeighborhoodIdentity {
  name: string;
  normalizedName?: string | null;
  borough?: string | null;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  source?: string | null;
  sourceId?: string | null;
  confidence?: number | null;
}

export interface NeighborhoodGeography {
  bbl: string;
  queryBbl: string;
  boroughCode: string | null;
  borough: string | null;
  block: string | null;
  lot: string | null;
  address: string | null;
  zip: string | null;
  communityDistrict: string | null;
  councilDistrict: string | null;
  censusTract2010: string | null;
  censusBlock2010: string | null;
  censusTract2020: string | null;
  censusBlock2020: string | null;
  latitude: number | null;
  longitude: number | null;
  landUse: string | null;
  buildingClass: string | null;
  lotAreaSqft: number | null;
  buildingAreaSqft: number | null;
  residentialUnits: number | null;
  totalUnits: number | null;
  yearBuilt: number | null;
  plutoVersion: string | null;
  provenance: NeighborhoodProvenance;
}

export interface NeighborhoodDemographics {
  censusYear: string | null;
  tractGeoId: string | null;
  name: string | null;
  population: number | null;
  medianHouseholdIncome: number | null;
  medianGrossRent: number | null;
  renterOccupiedUnits: number | null;
  ownerOccupiedUnits: number | null;
  totalHousingUnits: number | null;
  provenance: NeighborhoodProvenance;
}

export interface NeighborhoodMarketSaleComp {
  address: string | null;
  saleDate: string | null;
  salePrice: number | null;
  grossSqft: number | null;
  pricePsf: number | null;
  residentialUnits: number | null;
  totalUnits: number | null;
  buildingClassCategory: string | null;
  taxClass: string | null;
}

export interface NeighborhoodMarket {
  rollingSalesNeighborhood: string | null;
  scope: "exact_tax_lot" | "zip_top_neighborhood" | "neighborhood" | "unavailable";
  saleCount: number;
  pricedSaleCount: number;
  medianSalePrice: number | null;
  medianPricePsf: number | null;
  averagePricePsf: number | null;
  latestSaleDate: string | null;
  sample: NeighborhoodMarketSaleComp[];
  provenance: NeighborhoodProvenance;
}

export interface NeighborhoodRisk {
  flood: {
    firm2007FloodplainFlag: boolean | null;
    preliminaryFirm2015FloodplainFlag: boolean | null;
    nfhlFloodZone: string | null;
    nfhlZoneSubtype: string | null;
    nfhlSpecialFloodHazardArea: boolean | null;
    baseFloodElevation: number | null;
    depth: number | null;
    provenance: NeighborhoodProvenance;
  };
}

export interface NeighborhoodCompRecord {
  source: "manual" | "provider";
  provider: string;
  providerListingId?: string | null;
  address?: string | null;
  unit?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  askingRentMonthly?: number | null;
  achievedRentMonthly?: number | null;
  furnished?: boolean | null;
  stayLength?: "short_term" | "medium_term" | "long_term" | null;
  observedAt?: string | null;
  url?: string | null;
  notes?: string | null;
}

export interface NeighborhoodComps {
  schemaVersion: "neighborhood-comps-v1";
  records: NeighborhoodCompRecord[];
  providerStatus: Array<{
    provider: string;
    status: "manual_import_ready" | "placeholder_not_scraped" | "not_configured";
    notes: string;
  }>;
  provenance: NeighborhoodProvenance;
}

export interface PropertyNeighborhoodEnrichment {
  primary: NeighborhoodIdentity | null;
  sourceMatches: NeighborhoodIdentity[];
  geography: NeighborhoodGeography | null;
  demographics: NeighborhoodDemographics | null;
  market: NeighborhoodMarket | null;
  risk: NeighborhoodRisk;
  comps: NeighborhoodComps;
  metrics: {
    medianHouseholdIncome?: number | null;
    medianRent?: number | null;
    medianSalePrice?: number | null;
    medianPricePsf?: number | null;
    population?: number | null;
    sourceAsOf?: string | null;
    [key: string]: unknown;
  };
  lastRefreshedAt: string;
  sources: NeighborhoodProvenance[];
  warnings: string[];
  [key: string]: unknown;
}

export interface PlutoNeighborhoodRow {
  borough?: unknown;
  block?: unknown;
  lot?: unknown;
  cd?: unknown;
  council?: unknown;
  zipcode?: unknown;
  address?: unknown;
  bbl?: unknown;
  ct2010?: unknown;
  cb2010?: unknown;
  tract2010?: unknown;
  bct2020?: unknown;
  bctcb2020?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  landuse?: unknown;
  bldgclass?: unknown;
  lotarea?: unknown;
  bldgarea?: unknown;
  unitsres?: unknown;
  unitstotal?: unknown;
  yearbuilt?: unknown;
  version?: unknown;
  firm07_flag?: unknown;
  pfirm15_flag?: unknown;
}

export interface RollingSalesRow {
  borough?: unknown;
  neighborhood?: unknown;
  building_class_category?: unknown;
  tax_class_at_present?: unknown;
  block?: unknown;
  lot?: unknown;
  building_class_at_present?: unknown;
  address?: unknown;
  apartment_number?: unknown;
  zip_code?: unknown;
  residential_units?: unknown;
  commercial_units?: unknown;
  total_units?: unknown;
  land_square_feet?: unknown;
  gross_square_feet?: unknown;
  year_built?: unknown;
  tax_class_at_time_of_sale?: unknown;
  building_class_at_time_of?: unknown;
  sale_price?: unknown;
  sale_date?: unknown;
  sale_count?: unknown;
}

export interface CensusAcsProfileRow {
  NAME?: unknown;
  DP05_0001E?: unknown;
  DP03_0062E?: unknown;
  DP04_0134E?: unknown;
  DP04_0046E?: unknown;
  DP04_0047E?: unknown;
  DP04_0001E?: unknown;
  state?: unknown;
  county?: unknown;
  tract?: unknown;
}

export interface FemaFloodAttributes {
  FLD_ZONE?: unknown;
  ZONE_SUBTY?: unknown;
  SFHA_TF?: unknown;
  STATIC_BFE?: unknown;
  DEPTH?: unknown;
}
