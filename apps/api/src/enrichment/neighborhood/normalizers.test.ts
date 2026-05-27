import { describe, expect, it } from "vitest";
import {
  bblParts,
  buildCompSection,
  buildEmptyMarket,
  buildPlutoGeography,
  buildPrimaryIdentity,
  buildRiskSection,
  normalizeCensusAcsProfile,
  summarizeRollingSalesMarket,
  topNeighborhoodFromRows,
} from "./normalizers.js";

const FETCHED_AT = "2026-05-27T12:00:00.000Z";

describe("neighborhood normalizers", () => {
  it("splits BBL and normalizes PLUTO geography", () => {
    expect(bblParts("1003720009")).toEqual({
      boroughCode: "1",
      borough: "Manhattan",
      block: "372",
      lot: "9",
    });

    const geography = buildPlutoGeography(
      {
        borough: "MN",
        block: "372",
        lot: "9",
        cd: "103",
        council: "2",
        zipcode: "10009",
        address: "272 EAST 3 STREET",
        bct2020: "1002601",
        bctcb2020: "10026011000",
        latitude: "40.722",
        longitude: "-73.982",
        landuse: "2",
        bldgclass: "C7",
        lotarea: "2021",
        bldgarea: "7129",
        unitsres: "8",
        unitstotal: "9",
        yearbuilt: "1900",
        version: "25v4",
      },
      { bbl: "1003720009", queryBbl: "1003720009", fetchedAt: FETCHED_AT }
    );

    expect(geography?.borough).toBe("Manhattan");
    expect(geography?.zip).toBe("10009");
    expect(geography?.buildingAreaSqft).toBe(7129);
    expect(geography?.provenance).toMatchObject({
      source: "nyc_pluto",
      sourceId: "64uk-42ks",
      coverage: "full",
      confidence: 0.95,
    });
  });

  it("selects rolling-sales neighborhood candidates by weighted count", () => {
    expect(
      topNeighborhoodFromRows([
        { neighborhood: "ALPHABET CITY", sale_count: "3" },
        { neighborhood: "EAST VILLAGE", sale_count: "8" },
      ])
    ).toEqual({ name: "EAST VILLAGE", count: 8 });
  });

  it("summarizes rolling sales and excludes zero-dollar transfers from price metrics", () => {
    const market = summarizeRollingSalesMarket({
      fetchedAt: FETCHED_AT,
      neighborhoodName: "ALPHABET CITY",
      scope: "neighborhood",
      rows: [
        {
          address: "272 EAST 3 STREET",
          sale_price: "0",
          gross_square_feet: "7129",
          sale_date: "2026-01-01T00:00:00.000",
        },
        {
          address: "100 AVENUE A",
          sale_price: "1000000",
          gross_square_feet: "1000",
          sale_date: "2026-02-01T00:00:00.000",
        },
        {
          address: "102 AVENUE A",
          sale_price: "2000000",
          gross_square_feet: "1000",
          sale_date: "2026-03-01T00:00:00.000",
        },
      ],
    });

    expect(market.saleCount).toBe(3);
    expect(market.pricedSaleCount).toBe(2);
    expect(market.medianSalePrice).toBe(1_500_000);
    expect(market.medianPricePsf).toBe(1500);
    expect(market.latestSaleDate).toBe("2026-03-01");
    expect(market.provenance.coverage).toBe("partial");
  });

  it("represents missing Census config as not configured instead of fabricated data", () => {
    const demographics = normalizeCensusAcsProfile(null, {
      censusYear: "2024",
      tractGeoId: "36061002601",
      fetchedAt: FETCHED_AT,
      notes: "not configured: set CENSUS_API_KEY to populate ACS demographics.",
    });

    expect(demographics.population).toBeNull();
    expect(demographics.medianHouseholdIncome).toBeNull();
    expect(demographics.provenance.coverage).toBe("not_configured");
    expect(demographics.provenance.confidence).toBe(0);
  });

  it("keeps PLUTO/FEMA flood provenance explicit", () => {
    const plutoOnly = buildRiskSection(
      { firm07_flag: "1", pfirm15_flag: null },
      null,
      FETCHED_AT,
      "unavailable",
      "No point available."
    );
    expect(plutoOnly.flood.firm2007FloodplainFlag).toBe(true);
    expect(plutoOnly.flood.nfhlSpecialFloodHazardArea).toBeNull();
    expect(plutoOnly.flood.provenance.source).toBe("nyc_pluto_fema_flags");

    const directFema = buildRiskSection(
      {},
      { FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", SFHA_TF: "T", STATIC_BFE: "11.2", DEPTH: null },
      FETCHED_AT,
      "full"
    );
    expect(directFema.flood.nfhlFloodZone).toBe("AE");
    expect(directFema.flood.nfhlSpecialFloodHazardArea).toBe(true);
    expect(directFema.flood.baseFloodElevation).toBe(11.2);
    expect(directFema.flood.provenance.source).toBe("fema_nfhl");
  });

  it("builds primary identity and manual comp placeholder without scraping providers", () => {
    const primary = buildPrimaryIdentity({
      neighborhoodName: "ALPHABET CITY",
      geography: buildPlutoGeography(
        { borough: "MN", zipcode: "10009" },
        { bbl: "1003720009", queryBbl: "1003720009", fetchedAt: FETCHED_AT }
      ),
      sourceId: "usep-8jbt",
      confidence: 0.85,
    });
    expect(primary).toMatchObject({
      name: "Alphabet City",
      borough: "Manhattan",
      zip: "10009",
      source: "nyc_rolling_sales",
      confidence: 0.85,
    });

    const comps = buildCompSection(FETCHED_AT);
    expect(comps.records).toEqual([]);
    expect(comps.providerStatus.find((entry) => entry.provider === "manual")?.status).toBe("manual_import_ready");
    expect(comps.providerStatus.find((entry) => entry.provider === "airbnb")?.status).toBe("placeholder_not_scraped");
  });

  it("returns an empty market with provenance when source data is missing", () => {
    const market = buildEmptyMarket(FETCHED_AT, "No market source available.");
    expect(market.saleCount).toBe(0);
    expect(market.scope).toBe("unavailable");
    expect(market.provenance.coverage).toBe("empty");
    expect(market.provenance.confidence).toBe(0);
    expect(market.provenance.notes).toBe("No market source available.");
  });
});
