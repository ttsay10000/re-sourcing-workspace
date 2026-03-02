import { describe, it, expect } from "vitest";
import {
  normalizeBorough,
  normalizeHouseNo,
  normalizeStreetName,
  parseDateToYyyyMmDd,
  parseEstimatedCost,
} from "./normalizers.js";

describe("normalizeBorough", () => {
  it("maps Manhattan variants", () => {
    expect(normalizeBorough("Manhattan")).toBe("MANHATTAN");
    expect(normalizeBorough("MANHATTAN")).toBe("MANHATTAN");
    expect(normalizeBorough("1")).toBe("MANHATTAN");
    expect(normalizeBorough("New York")).toBe("MANHATTAN");
  });
  it("maps Brooklyn variants", () => {
    expect(normalizeBorough("Brooklyn")).toBe("BROOKLYN");
    expect(normalizeBorough("Bklyn")).toBe("BROOKLYN");
    expect(normalizeBorough("3")).toBe("BROOKLYN");
  });
  it("maps Bronx, Queens, Staten Island", () => {
    expect(normalizeBorough("Bronx")).toBe("BRONX");
    expect(normalizeBorough("Queens")).toBe("QUEENS");
    expect(normalizeBorough("Staten Island")).toBe("STATEN ISLAND");
    expect(normalizeBorough("5")).toBe("STATEN ISLAND");
  });
  it("returns empty for unknown or empty", () => {
    expect(normalizeBorough("")).toBe("");
    expect(normalizeBorough("   ")).toBe("");
    expect(normalizeBorough("Unknown")).toBe("");
    expect(normalizeBorough(null)).toBe("");
    expect(normalizeBorough(undefined)).toBe("");
  });
});

describe("normalizeHouseNo", () => {
  it("trims and preserves Queens hyphen", () => {
    expect(normalizeHouseNo("28-20")).toBe("28-20");
    expect(normalizeHouseNo("  123  ")).toBe("123");
    expect(normalizeHouseNo("123A")).toBe("123A");
  });
  it("returns empty for null/undefined", () => {
    expect(normalizeHouseNo(null)).toBe("");
    expect(normalizeHouseNo(undefined)).toBe("");
  });
});

describe("normalizeStreetName", () => {
  it("uppercases and standardizes suffixes", () => {
    expect(normalizeStreetName("main st")).toBe("MAIN ST");
    expect(normalizeStreetName("Fifth Avenue")).toBe("FIFTH AVE");
    expect(normalizeStreetName("ocean parkway")).toBe("OCEAN PKWY");
  });
  it("drops unit/apt patterns", () => {
    expect(normalizeStreetName("123 Main St Apt 2B")).toBe("123 MAIN ST");
    expect(normalizeStreetName("100 Broadway, Unit 5")).toBe("100 BROADWAY");
  });
  it("returns empty for null/undefined/empty", () => {
    expect(normalizeStreetName(null)).toBe("");
    expect(normalizeStreetName("")).toBe("");
  });
});

describe("parseDateToYyyyMmDd", () => {
  it("parses ISO-like dates", () => {
    expect(parseDateToYyyyMmDd("2024-03-15")).toBe("2024-03-15");
    expect(parseDateToYyyyMmDd("2024-03-15T00:00:00.000Z")).toBe("2024-03-15");
  });
  it("parses MM/DD/YYYY", () => {
    expect(parseDateToYyyyMmDd("03/15/2024")).toBe("2024-03-15");
  });
  it("returns null for invalid or empty", () => {
    expect(parseDateToYyyyMmDd("not-a-date")).toBeNull();
    expect(parseDateToYyyyMmDd("")).toBeNull();
    expect(parseDateToYyyyMmDd(null)).toBeNull();
  });
});

describe("parseEstimatedCost", () => {
  it("strips $ and commas, returns number", () => {
    expect(parseEstimatedCost("$1,234")).toBe(1234);
    expect(parseEstimatedCost("50000")).toBe(50000);
    expect(parseEstimatedCost(1000)).toBe(1000);
  });
  it("returns 0 for invalid or null", () => {
    expect(parseEstimatedCost("")).toBe(0);
    expect(parseEstimatedCost("n/a")).toBe(0);
    expect(parseEstimatedCost(null)).toBe(0);
  });
});
