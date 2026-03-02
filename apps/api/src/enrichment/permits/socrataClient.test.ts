import { describe, it, expect } from "vitest";
import {
  buildSoQLParamsByBBL,
  buildSoQLParamsByAddress,
  type SoQLQueryParams,
} from "./socrataClient.js";

function assertSelectiveWhere(params: SoQLQueryParams): void {
  expect(params.$select).toBeTruthy();
  expect(params.$where).toBeTruthy();
  expect(params.$where).not.toContain("1=1");
  expect(params.$order).toBe("issued_date DESC");
  expect(params.$limit).toBeGreaterThan(0);
  expect(params.$offset).toBeGreaterThanOrEqual(0);
}

describe("buildSoQLParamsByBBL", () => {
  it("builds selective BBL query with date filter", () => {
    const params = buildSoQLParamsByBBL("1234567890", "2014-01-01", 1000, 0);
    expect(params.$select).toContain("bbl");
    expect(params.$where).toContain("bbl = '1234567890'");
    expect(params.$where).toContain("issued_date >= '2014-01-01'");
    expect(params.$where).toContain("approved_date >= '2014-01-01'");
    expect(params.$limit).toBe(1000);
    expect(params.$offset).toBe(0);
    assertSelectiveWhere(params);
  });

  it("escapes single quotes in BBL", () => {
    const params = buildSoQLParamsByBBL("1'234", "2014-01-01");
    expect(params.$where).toContain("''");
  });
});

describe("buildSoQLParamsByAddress", () => {
  it("builds selective borough + house_no + street_name query", () => {
    const params = buildSoQLParamsByAddress(
      "BROOKLYN",
      "123",
      "MAIN ST",
      "2014-01-01",
      500,
      0
    );
    expect(params.$where).toContain("borough = 'BROOKLYN'");
    expect(params.$where).toContain("house_no = '123'");
    expect(params.$where).toContain("street_name = 'MAIN ST'");
    expect(params.$where).toContain("issued_date >= '2014-01-01'");
    expect(params.$limit).toBe(500);
    assertSelectiveWhere(params);
  });

  it("uses default limit and offset", () => {
    const params = buildSoQLParamsByAddress("QUEENS", "28-20", "JACKSON AVE", "2015-06-01");
    expect(params.$limit).toBe(1000);
    expect(params.$offset).toBe(0);
  });
});
