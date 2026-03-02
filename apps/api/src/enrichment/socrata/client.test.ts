import { describe, it, expect } from "vitest";
import type { SoQLQueryParams } from "./client.js";
import {
  mapV3ResponseToRows,
  escapeSoQLString,
  paramsToSearchParams,
  resourceUrl,
  bblToBoroughBlockLot,
} from "./index.js";

describe("mapV3ResponseToRows", () => {
  it("returns array as-is when response is already an array of objects", () => {
    const arr = [{ bbl: "1", bin: "2" }, { bbl: "3" }];
    const out = mapV3ResponseToRows(arr);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ bbl: "1", bin: "2" });
    expect(out[1]).toEqual({ bbl: "3" });
  });

  it("maps columns + rows to array of objects keyed by column name", () => {
    const response = {
      columns: [{ name: "bbl" }, { name: "bin" }],
      rows: [["1000123456", "1234567"], ["1000987654", "7654321"]],
    };
    const out = mapV3ResponseToRows(response);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ bbl: "1000123456", bin: "1234567" });
    expect(out[1]).toEqual({ bbl: "1000987654", bin: "7654321" });
  });

  it("handles missing or empty column names", () => {
    const response = {
      columns: [{ name: "a" }, { name: "" }, { name: "c" }],
      rows: [["x", "y", "z"]],
    };
    const out = mapV3ResponseToRows(response);
    expect(out[0]).toEqual({ a: "x", c: "z" });
  });

  it("handles null/undefined in row values", () => {
    const response = {
      columns: [{ name: "bbl" }, { name: "bin" }],
      rows: [["1000123456", null]],
    };
    const out = mapV3ResponseToRows(response);
    expect(out[0]).toEqual({ bbl: "1000123456", bin: null });
  });

  it("returns empty array for non-array and missing columns/rows", () => {
    expect(mapV3ResponseToRows({})).toEqual([]);
    expect(mapV3ResponseToRows({ columns: [] })).toEqual([]);
    expect(mapV3ResponseToRows(null)).toEqual([]);
  });
});

describe("escapeSoQLString", () => {
  it("doubles single quotes", () => {
    expect(escapeSoQLString("a'b")).toBe("a''b");
    expect(escapeSoQLString("''")).toBe("''''");
  });
});

describe("paramsToSearchParams", () => {
  it("builds URL search params from SoQL params", () => {
    const params: SoQLQueryParams = {
      $select: "bbl, bin",
      $where: "bbl = '123'",
      $order: "bbl DESC",
      $limit: 10,
      $offset: 0,
    };
    const sp = paramsToSearchParams(params);
    expect(sp.get("$select")).toBe("bbl, bin");
    expect(sp.get("$where")).toBe("bbl = '123'");
    expect(sp.get("$limit")).toBe("10");
    expect(sp.get("$offset")).toBe("0");
  });
});

describe("resourceUrl", () => {
  it("returns NYC resource URL for dataset id", () => {
    expect(resourceUrl("fdkv-4t4z")).toContain("data.cityofnewyork.us");
    expect(resourceUrl("fdkv-4t4z")).toContain("fdkv-4t4z");
    expect(resourceUrl("fdkv-4t4z")).toMatch(/\.json$/);
  });
});

describe("bblToBoroughBlockLot", () => {
  it("splits 10-digit BBL into borough name, block, lot", () => {
    const out = bblToBoroughBlockLot("1000123456");
    expect(out).not.toBeNull();
    expect(out!.borough).toBe("MANHATTAN");
    expect(out!.block).toBe("00012");
    expect(out!.lot).toBe("3456");
  });

  it("maps borough codes 1-5 to names", () => {
    expect(bblToBoroughBlockLot("2000111111")!.borough).toBe("BRONX");
    expect(bblToBoroughBlockLot("3000111111")!.borough).toBe("BROOKLYN");
    expect(bblToBoroughBlockLot("4000111111")!.borough).toBe("QUEENS");
    expect(bblToBoroughBlockLot("5000111111")!.borough).toBe("STATEN ISLAND");
  });

  it("returns null for invalid BBL", () => {
    expect(bblToBoroughBlockLot("")).toBeNull();
    expect(bblToBoroughBlockLot("123")).toBeNull();
    expect(bblToBoroughBlockLot("12345678901")).toBeNull();
    expect(bblToBoroughBlockLot("abcdefghij")).toBeNull();
  });
});
