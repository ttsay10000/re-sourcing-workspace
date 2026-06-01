import { describe, expect, it } from "vitest";
import {
  addressMatches,
  mapApiResponseToRentalUnitRow,
  mapRentalsSearchResponse,
  rentalSearchAreasForAddress,
  unwrapRentalApiResponse,
} from "./rentalApiClient.js";

describe("rentalApiClient", () => {
  it("matches abbreviated StreetEasy rental addresses to canonical addresses", () => {
    expect(addressMatches("485 W 22nd St #2", "485 West 22nd Street")).toBe(true);
    expect(addressMatches("662 9th Ave Apt 4", "662 Ninth Avenue")).toBe(true);
    expect(addressMatches("485 W 23rd St #2", "485 West 22nd Street")).toBe(false);
  });

  it("unwraps common RapidAPI rental detail wrappers", () => {
    expect(
      unwrapRentalApiResponse({
        data: {
          result: {
            listing: {
              address: "485 W 22nd St #2",
              price: 4300,
            },
          },
        },
      })
    ).toMatchObject({ address: "485 W 22nd St #2", price: 4300 });
  });

  it("normalizes common rentals/search response shapes", () => {
    expect(
      mapRentalsSearchResponse({
        data: {
          listings: [
            {
              listing_id: 123,
              listing_url: "https://www.streeteasy.com/rental/123",
              monthly_rent: 4200,
              display_address: "485 W 22nd St #2",
            },
          ],
        },
      })
    ).toEqual([
      {
        id: "123",
        price: 4200,
        url: "https://www.streeteasy.com/rental/123",
        address: "485 W 22nd St #2",
      },
    ]);
  });

  it("maps camelCase RapidAPI listing fields into rental rows", () => {
    expect(
      mapApiResponseToRentalUnitRow(
        {
          price: 4200,
          listedAt: "2026-01-04",
          closedAt: "2026-02-01",
          bedrooms: 2,
          bathrooms: 1.5,
          sqft: 875,
          images: ["https://example.com/unit.jpg"],
        },
        "2A",
        "https://www.streeteasy.com/rental/123"
      )
    ).toMatchObject({
      unit: "2A",
      rentalPrice: 4200,
      listedDate: "2026-01-04",
      lastRentedDate: "2026-02-01",
      beds: 2,
      baths: 1.5,
      sqft: 875,
      images: ["https://example.com/unit.jpg"],
      source: "rapidapi",
      streeteasyUrl: "https://www.streeteasy.com/rental/123",
    });
  });

  it("uses a Manhattan-wide default rental fallback scope", () => {
    expect(rentalSearchAreasForAddress("485 West 22nd Street, New York, NY")).toContain("all-upper-west-side");
  });
});
