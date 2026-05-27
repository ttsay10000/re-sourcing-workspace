import { getPool, PropertyEnrichmentStateRepo, PropertyRepo } from "@re-sourcing/db";
import { getBblBaseFromDetails } from "../propertyKeys.js";
import { getBBLForProperty } from "../resolvePropertyBBL.js";
import { resolveCondoBblForQuery } from "../resolveCondoBbl.js";
import { normalizeBblForQuery } from "../socrata/index.js";
import type { EnrichmentModule, EnrichmentRunOptions, EnrichmentRunResult } from "../types.js";
import {
  bblParts,
  buildCompSection,
  buildEmptyMarket,
  buildPlutoGeography,
  buildPrimaryIdentity,
  buildRiskSection,
  flattenProvenance,
  normalizeCensusAcsProfile,
  summarizeRollingSalesMarket,
  topNeighborhoodFromRows,
} from "./normalizers.js";
import {
  fetchCensusAcsProfile,
  fetchFemaFloodByPoint,
  fetchPlutoNeighborhoodByBbl,
  fetchRollingSalesForExactTaxLot,
  fetchRollingSalesMarketSample,
  fetchRollingSalesNeighborhoodCandidates,
} from "./sources.js";
import type {
  NeighborhoodMarket,
  NeighborhoodProvenance,
  PlutoNeighborhoodRow,
  PropertyNeighborhoodEnrichment,
  RollingSalesRow,
} from "./types.js";

const REFRESH_CADENCE_DAYS = 30;
const ENRICHMENT_NAME = "neighborhood";

function coverageForStatus(status: string): NeighborhoodProvenance["coverage"] {
  if (status === "ok") return "full";
  if (status === "empty") return "empty";
  if (status === "not_configured") return "not_configured";
  if (status === "missing_tract" || status === "missing_point" || status === "invalid_point") return "unavailable";
  return status.startsWith("error:") ? "error" : "unavailable";
}

async function resolveBblContext(
  propertyId: string,
  options: EnrichmentRunOptions,
  propertyRepo: PropertyRepo
): Promise<{ bbl: string; bblForQueries: string } | { error: string }> {
  if (options.resolvedContext?.bbl && options.resolvedContext.bblForQueries) {
    const bbl = normalizeBblForQuery(options.resolvedContext.bbl);
    const bblForQueries = normalizeBblForQuery(options.resolvedContext.bblForQueries);
    if (bbl && bblForQueries) return { bbl, bblForQueries };
  }

  const property = await propertyRepo.byId(propertyId);
  if (!property) return { error: "Property not found" };
  const resolved = await getBBLForProperty(propertyId, { appToken: options.appToken });
  const bbl = normalizeBblForQuery(resolved?.bbl);
  if (!bbl) return { error: "missing_bbl" };

  const current = await propertyRepo.byId(propertyId);
  const details = (current?.details as Record<string, unknown> | null) ?? {};
  const bblBase = getBblBaseFromDetails(details);
  const bblForQueries = normalizeBblForQuery(
    bblBase ?? (await resolveCondoBblForQuery(bbl, { appToken: options.appToken })) ?? bbl
  );
  if (!bblForQueries) return { error: "invalid_bbl" };
  return { bbl, bblForQueries };
}

async function run(propertyId: string, options: EnrichmentRunOptions): Promise<EnrichmentRunResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const stateRepo = new PropertyEnrichmentStateRepo({ pool });
  const now = new Date();
  const fetchedAt = now.toISOString();

  const context = await resolveBblContext(propertyId, options, propertyRepo);
  if ("error" in context) {
    await stateRepo.upsert({
      propertyId,
      enrichmentName: ENRICHMENT_NAME,
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: context.error,
      statsJson: { rows_fetched: 0 },
    });
    return { ok: false, error: context.error };
  }

  const warnings: string[] = [];
  let plutoRow: PlutoNeighborhoodRow | null = null;
  let exactSalesRows: RollingSalesRow[] = [];
  let candidateRows: RollingSalesRow[] = [];
  let marketRows: RollingSalesRow[] = [];

  try {
    plutoRow = await fetchPlutoNeighborhoodByBbl(context.bblForQueries, {
      appToken: options.appToken,
      timeoutMs: 20_000,
    });
  } catch (error) {
    warnings.push(`PLUTO fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const geography = buildPlutoGeography(plutoRow, {
    bbl: context.bbl,
    queryBbl: context.bblForQueries,
    fetchedAt,
  });

  try {
    exactSalesRows = await fetchRollingSalesForExactTaxLot(context.bblForQueries, {
      appToken: options.appToken,
      timeoutMs: 20_000,
    });
  } catch (error) {
    warnings.push(`Rolling sales exact-lot fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const exactNeighborhood = topNeighborhoodFromRows(exactSalesRows).name;
  let neighborhoodName = exactNeighborhood;
  let identityConfidence = exactNeighborhood ? 0.85 : 0.35;
  let marketScope: NeighborhoodMarket["scope"] = exactNeighborhood ? "neighborhood" : "unavailable";
  const fallbackBblParts = bblParts(context.bblForQueries);
  const boroughCode = geography?.boroughCode ?? fallbackBblParts?.boroughCode ?? null;

  if (!neighborhoodName && boroughCode && geography?.zip) {
    try {
      candidateRows = await fetchRollingSalesNeighborhoodCandidates({
        boroughCode,
        zip: geography.zip,
        options: {
          appToken: options.appToken,
          timeoutMs: 20_000,
        },
      });
      const top = topNeighborhoodFromRows(candidateRows);
      neighborhoodName = top.name;
      if (neighborhoodName) {
        identityConfidence = 0.55;
        marketScope = "zip_top_neighborhood";
      }
    } catch (error) {
      warnings.push(`Rolling sales neighborhood candidate fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (boroughCode && (neighborhoodName || geography?.zip)) {
    try {
      marketRows = await fetchRollingSalesMarketSample({
        boroughCode,
        neighborhoodName,
        zip: geography?.zip ?? null,
        options: {
          appToken: options.appToken,
          timeoutMs: 25_000,
        },
      });
      if (marketScope === "unavailable" && geography?.zip) marketScope = "zip_top_neighborhood";
    } catch (error) {
      warnings.push(`Rolling sales market fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const market =
    marketRows.length > 0 || neighborhoodName
      ? summarizeRollingSalesMarket({
          rows: marketRows,
          neighborhoodName,
          scope: marketScope,
          fetchedAt,
        })
      : buildEmptyMarket(fetchedAt, "No rolling sales neighborhood or ZIP market sample could be resolved.");

  const census = geography
    ? await fetchCensusAcsProfile({
        geography: {
          boroughCode: geography.boroughCode,
          censusTract2020: geography.censusTract2020,
        },
        apiKey: process.env.CENSUS_API_KEY ?? null,
        year: process.env.CENSUS_ACS_YEAR ?? null,
        timeoutMs: 20_000,
      })
    : { row: null, censusYear: process.env.CENSUS_ACS_YEAR?.trim() || "2024", tractGeoId: null, status: "missing_tract" };
  if (census.status.startsWith("error:")) warnings.push(`Census ACS fetch failed: ${census.status.slice("error:".length)}`);

  const demographics = normalizeCensusAcsProfile(census.row, {
    censusYear: census.censusYear,
    tractGeoId: census.tractGeoId,
    fetchedAt,
    notes:
      census.status === "ok"
        ? "ACS 5-year profile values by 2020 census tract."
        : census.status === "not_configured"
          ? "not configured: set CENSUS_API_KEY to populate ACS demographics."
          : `ACS demographics unavailable: ${census.status}.`,
  });

  const fema = await fetchFemaFloodByPoint({
    lat: geography?.latitude ?? null,
    lon: geography?.longitude ?? null,
    timeoutMs: 15_000,
  });
  if (fema.status.startsWith("error:")) warnings.push(`FEMA NFHL fetch failed: ${fema.status.slice("error:".length)}`);
  const risk = buildRiskSection(
    plutoRow,
    fema.attributes,
    fetchedAt,
    fema.attributes ? "full" : coverageForStatus(fema.status),
    fema.status === "empty"
      ? "Direct FEMA NFHL point query returned no intersecting flood hazard polygon."
      : fema.status === "missing_point"
        ? "No latitude/longitude available for direct FEMA NFHL point query; PLUTO FEMA-derived flags may still be present."
        : undefined
  );

  const comps = buildCompSection(fetchedAt);
  const primary = buildPrimaryIdentity({
    neighborhoodName,
    geography,
    sourceId: neighborhoodName ? "usep-8jbt" : geography?.provenance.sourceId ?? null,
    confidence: identityConfidence,
  });

  const container: PropertyNeighborhoodEnrichment = {
    primary,
    sourceMatches: [
      ...(neighborhoodName && primary ? [primary] : []),
      ...(geography?.zip
        ? [
            {
              name: `ZIP ${geography.zip}`,
              normalizedName: geography.zip,
              borough: geography.borough,
              city: "New York",
              state: "NY",
              county: primary?.county ?? null,
              zip: geography.zip,
              source: "nyc_pluto",
              sourceId: geography.provenance.sourceId,
              confidence: 0.65,
            },
          ]
        : []),
    ],
    geography,
    demographics,
    market,
    risk,
    comps,
    metrics: {
      medianHouseholdIncome: demographics.medianHouseholdIncome,
      medianRent: demographics.medianGrossRent,
      medianSalePrice: market.medianSalePrice,
      medianPricePsf: market.medianPricePsf,
      population: demographics.population,
      sourceAsOf: fetchedAt,
    },
    lastRefreshedAt: fetchedAt,
    sources: flattenProvenance({ geography, demographics, market, risk, comps }),
    warnings,
  };

  try {
    const rowsFetched =
      (plutoRow ? 1 : 0) +
      exactSalesRows.length +
      candidateRows.length +
      marketRows.length +
      (census.row ? 1 : 0) +
      (fema.attributes ? 1 : 0);
    await propertyRepo.updateDetails(propertyId, "neighborhood", container as Record<string, unknown>);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: ENRICHMENT_NAME,
      lastRefreshedAt: now,
      lastSuccessAt: now,
      lastError: null,
      statsJson: {
        rows_fetched: rowsFetched,
        pluto_rows: plutoRow ? 1 : 0,
        exact_sales_rows: exactSalesRows.length,
        neighborhood_candidate_rows: candidateRows.length,
        market_sales_rows: marketRows.length,
        census_rows: census.row ? 1 : 0,
        fema_rows: fema.attributes ? 1 : 0,
        warnings,
      },
    });
    return {
      ok: true,
      rowsFetched,
      rowsUpserted: 1,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await stateRepo.upsert({
      propertyId,
      enrichmentName: ENRICHMENT_NAME,
      lastRefreshedAt: now,
      lastSuccessAt: null,
      lastError: message,
      statsJson: null,
    }).catch(() => {});
    return { ok: false, error: message };
  }
}

export const neighborhoodModule: EnrichmentModule = {
  name: ENRICHMENT_NAME,
  requiredKeys: ["bbl"],
  refreshCadenceDays: REFRESH_CADENCE_DAYS,
  run,
};
