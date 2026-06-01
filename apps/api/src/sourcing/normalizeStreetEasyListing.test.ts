import { describe, expect, it } from "vitest";
import { normalizeStreetEasySaleDetails } from "./normalizeStreetEasyListing.js";

describe("normalizeStreetEasySaleDetails", () => {
  it("uses nested RapidAPI sqft and infers apartment units from listing description", () => {
    const normalized = normalizeStreetEasySaleDetails(
      {
        id: "1820233",
        address: "233 East 34th Street",
        borough: "manhattan",
        neighborhood: "murray-hill",
        zipcode: "10016",
        price: 10_500_000,
        bedrooms: 9,
        bathrooms: 8,
        sqft: 0,
        building: { sqft: 9_000 },
        description:
          "This rare townhouse is configured as three full-floor residences with private outdoor spaces and a finished lower level.",
      },
      0
    );

    expect(normalized.sqft).toBe(9_000);
    expect(normalized.extra?.sqft).toBe(9_000);
    expect(normalized.extra?.unitCount).toBe(3);
    expect(normalized.extra?.ppsqft).toBe(1_167);
  });

  it("uses explicit RapidAPI price per square foot when present", () => {
    const normalized = normalizeStreetEasySaleDetails(
      {
        id: "1724898",
        address: "5 Beekman Street #30A",
        borough: "manhattan",
        price: 2_900_000,
        sqft: 1_395,
        ppsqft: 2_078,
      },
      0
    );

    expect(normalized.sqft).toBe(1_395);
    expect(normalized.extra?.ppsqft).toBe(2_078);
    expect(normalized.extra?.pricePerSqft).toBe(2_078);
  });
});
