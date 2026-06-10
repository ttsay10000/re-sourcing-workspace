import { describe, expect, it } from "vitest";
import { sanitizeOmRentRollRows, sanitizeOmRentRollRowsWithStats } from "./omAnalysisUtils.js";

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

  it("drops rows the extraction pulled twice under different unit label styles", () => {
    // Mirrors the 219-221 E 59th OM where the LLM emitted the roll twice
    // ("219 E 59th - 2" and "219 East 59th Street - 2"), doubling MTR NOI.
    const stats = sanitizeOmRentRollRowsWithStats([
      { unit: "219 E 59th - Retail", unitCategory: "Commercial", sqft: 2_150, monthlyRent: 23_000 },
      { unit: "221 E 59th - Retail", unitCategory: "Commercial", sqft: 2_000, monthlyRent: 24_360 },
      { unit: "219 E 59th - 2", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_000 },
      { unit: "219 E 59th - 3", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_000 },
      { unit: "221 E 59th - 3", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_300 },
      { unit: "221 E 59th - 4", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_500 },
      { unit: "219 East 59th Street Retail", unitCategory: "Commercial", sqft: 2_150, monthlyRent: 23_000 },
      { unit: "221 East 59th Street Retail", unitCategory: "Commercial", sqft: 2_000, monthlyRent: 24_360 },
      { unit: "219 East 59th Street - 2", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_000 },
      { unit: "219 East 59th Street - 3", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_000 },
      { unit: "221 East 59th Street - 3", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_300 },
      { unit: "221 East 59th Street - 4", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_500 },
    ]);

    expect(stats.rows).toHaveLength(6);
    expect(stats.duplicateRowsRemoved).toBe(6);
    expect(stats.duplicateExamples).toContain("219 East 59th Street Retail");
    expect(stats.rows.map((row) => row.unit)).toEqual([
      "219 E 59th - Retail",
      "221 E 59th - Retail",
      "219 E 59th - 2",
      "219 E 59th - 3",
      "221 E 59th - 3",
      "221 E 59th - 4",
    ]);
  });

  it("keeps distinct units that share identical rents and layouts", () => {
    const rows = sanitizeOmRentRollRows([
      { unit: "2A", beds: 2, baths: 1, sqft: 850, monthlyRent: 4_200 },
      { unit: "3A", beds: 2, baths: 1, sqft: 850, monthlyRent: 4_200 },
      { unit: "Apt 4A", beds: 2, baths: 1, sqft: 850, monthlyRent: 4_200 },
    ]);
    expect(rows).toHaveLength(3);
  });

  it("keeps same-label rows whose rents differ and rows without unit identity", () => {
    const rows = sanitizeOmRentRollRows([
      // Same label, different rent: could be current vs projected — keep both.
      { unit: "Retail", sqft: 1_200, monthlyRent: 10_000 },
      { unit: "Retail", sqft: 1_200, monthlyRent: 11_000 },
      // No unit label and no rent: never treated as duplicates.
      { beds: 1, baths: 1, sqft: 600 },
      { beds: 1, baths: 1, sqft: 600 },
    ]);
    expect(rows).toHaveLength(4);
  });

  it("dedupes 'Apt 2' against 'Unit 2' style label variants on the same rent", () => {
    const stats = sanitizeOmRentRollRowsWithStats([
      { unit: "Apt 2", beds: 1, baths: 1, sqft: 700, monthlyRent: 3_100 },
      { unit: "Unit 2", beds: 1, baths: 1, sqft: 700, monthlyRent: 3_100 },
    ]);
    expect(stats.rows).toHaveLength(1);
    expect(stats.duplicateRowsRemoved).toBe(1);
  });
});
