import { describe, expect, it } from "vitest";
import { sanitizeOmRentRollRows } from "./omAnalysisUtils.js";

describe("omAnalysisUtils", () => {
  it("corrects OM rent PSF values that were parsed into monthly rent fields", () => {
    const rows = sanitizeOmRentRollRows([
      {
        unit: "2F",
        sqft: 1_100,
        monthlyRent: 63,
        annualRent: 69_300,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.monthlyRent).toBe(5_775);
    expect(rows[0]?.annualRent).toBe(69_300);
    expect(rows[0]?.rentPsf).toBe(63);
    expect(rows[0]?.notes).toContain("Monthly rent corrected from rent PSF");
  });

  it("derives rent from annual PSF only when PSF context is explicit", () => {
    const rows = sanitizeOmRentRollRows([
      {
        unit: "Retail",
        sqft: 2_450,
        monthlyRent: 85,
        notes: "Rent ($) PSF",
      },
    ]);

    expect(rows[0]?.monthlyRent).toBe(17_354.17);
    expect(rows[0]?.annualRent).toBe(208_250);
    expect(rows[0]?.rentPsf).toBe(85);
  });

  it("does not rewrite a small monthly rent without annual rent or PSF evidence", () => {
    const rows = sanitizeOmRentRollRows([
      {
        unit: "1A",
        sqft: 400,
        monthlyRent: 150,
      },
    ]);

    expect(rows[0]?.monthlyRent).toBe(150);
    expect(rows[0]?.annualRent).toBeUndefined();
    expect(rows[0]?.rentPsf).toBeUndefined();
  });

  it("filters rent roll summary rows from unit-level rent rolls", () => {
    const rows = sanitizeOmRentRollRows([
      {
        unit: "Total Rentable Space",
        sqft: 12_400,
        monthlyRent: 61.32,
        annualRent: 771_106,
      },
      {
        unit: "5 PH",
        sqft: 2_750,
        monthlyRent: 12_000,
        annualRent: 144_000,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.unit).toBe("5 PH");
  });
});
