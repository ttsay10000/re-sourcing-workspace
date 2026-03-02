/**
 * Generic enrichment module interface and registry.
 */

export type EnrichmentKey = "bbl" | "bin";

export interface EnrichmentRunOptions {
  appToken?: string | null;
}

export interface EnrichmentRunResult {
  ok: boolean;
  rowsFetched?: number;
  rowsUpserted?: number;
  error?: string;
}

export interface EnrichmentModule {
  name: string;
  requiredKeys: EnrichmentKey[];
  refreshCadenceDays: number;
  run(
    propertyId: string,
    options: EnrichmentRunOptions
  ): Promise<EnrichmentRunResult>;
}

export const ENRICHMENT_MODULE_NAMES = [
  "zoning_ztl",
  "certificate_of_occupancy",
  "hpd_registration",
  "hpd_violations",
  "dob_complaints",
  "housing_litigations",
  "affordable_housing",
] as const;

export type EnrichmentModuleName = (typeof ENRICHMENT_MODULE_NAMES)[number];
