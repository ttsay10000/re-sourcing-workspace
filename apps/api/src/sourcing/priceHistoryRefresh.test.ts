import { describe, expect, it } from "vitest";
import type { ListingNormalized, ListingRow } from "@re-sourcing/contracts";
import { withRefreshPriceHistory } from "./priceHistoryRefresh.js";

function listing(overrides: Partial<ListingNormalized> = {}): ListingNormalized {
  return {
    source: "streeteasy",
    externalId: "123",
    address: "27 West 9th Street",
    city: "Manhattan",
    state: "NY",
    zip: "10011",
    price: 3_995_000,
    beds: 8,
    baths: 4,
    sqft: 6_000,
    url: "https://streeteasy.com/sale/123",
    title: "27 West 9th Street",
    description: null,
    listedAt: "2026-03-05",
    agentNames: null,
    agentEnrichment: null,
    priceHistory: null,
    rentalPriceHistory: null,
    extra: null,
    ...overrides,
  };
}

function existing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    ...listing({ price: 4_250_000 }),
    id: "listing-1",
    lifecycleState: "active",
    firstSeenAt: "2026-03-05T12:00:00.000Z",
    lastSeenAt: "2026-03-05T12:00:00.000Z",
    missingSince: null,
    prunedAt: null,
    uploadedAt: null,
    uploadedRunId: null,
    duplicateScore: null,
    lastActivity: null,
    createdAt: "2026-03-05T12:00:00.000Z",
    updatedAt: "2026-03-05T12:00:00.000Z",
    ...overrides,
  };
}

describe("withRefreshPriceHistory", () => {
  it("appends a dated price decrease when refresh returns a new ask without full history", () => {
    const result = withRefreshPriceHistory({
      normalized: listing({ price: 3_995_000, priceHistory: null }),
      existing: existing({
        priceHistory: [{ date: "2026-03-05", price: 4_250_000, event: "LISTED" }],
      }),
      capturedAt: new Date("2026-06-04T20:00:00.000Z"),
    });

    expect(result.priceHistory).toEqual([
      { date: "2026-06-04", price: 3_995_000, event: "PRICE DECREASE" },
      { date: "2026-03-05", price: 4_250_000, event: "LISTED" },
    ]);
  });

  it("keeps RapidAPI sale history when the refresh returns one", () => {
    const saleHistory = [
      { date: "2026-06-01", price: 4_100_000, event: "PRICE DECREASE" },
      { date: "2026-03-05", price: 4_250_000, event: "LISTED" },
    ];
    const result = withRefreshPriceHistory({
      normalized: listing({ price: 4_100_000, priceHistory: saleHistory }),
      existing: existing(),
      capturedAt: new Date("2026-06-04T20:00:00.000Z"),
    });

    expect(result.priceHistory).toBe(saleHistory);
  });
});
