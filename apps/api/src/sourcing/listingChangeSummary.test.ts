import { describe, expect, it } from "vitest";
import type { ListingNormalized, ListingRow, ListingSnapshot } from "@re-sourcing/contracts";
import { buildListingChangeSummary } from "./listingChangeSummary.js";

function makeListing(overrides: Partial<ListingNormalized> = {}): ListingNormalized {
  return {
    source: "streeteasy",
    externalId: "123",
    address: "27 West 9th Street",
    city: "Manhattan",
    state: "NY",
    zip: "10011",
    price: 4_250_000,
    beds: 8,
    baths: 4,
    sqft: 6_000,
    url: "https://streeteasy.com/building/27-west-9-street",
    title: "27 West 9th Street",
    description: "Prime multifamily value-add opportunity.",
    listedAt: "2026-03-05",
    agentNames: ["Jane Broker"],
    agentEnrichment: [{ name: "Jane Broker", email: "jane@example.com", firm: "Broker Co" }],
    priceHistory: [{ date: "2026-03-05", price: 4_250_000, event: "LISTED" }],
    rentalPriceHistory: null,
    extra: { status: "active", monthlyTax: 4200 },
    ...overrides,
  };
}

function toExistingRow(listing: ListingNormalized): ListingRow {
  return {
    id: "listing-1",
    lifecycleState: "active",
    firstSeenAt: "2026-03-05T12:00:00.000Z",
    lastSeenAt: "2026-03-05T12:00:00.000Z",
    createdAt: "2026-03-05T12:00:00.000Z",
    updatedAt: "2026-03-05T12:00:00.000Z",
    uploadedAt: "2026-03-05T12:00:00.000Z",
    uploadedRunId: "run-1",
    duplicateScore: 0,
    lastActivity: null,
    ...listing,
  };
}

function toSnapshot(listing: ListingNormalized): ListingSnapshot {
  return {
    id: "snapshot-1",
    listingId: "listing-1",
    runId: "run-1",
    capturedAt: "2026-03-05T12:00:00.000Z",
    rawPayloadPath: "inline",
    pruned: false,
    createdAt: "2026-03-05T12:00:00.000Z",
    metadata: {
      normalizedListing: listing,
      rawPayload: {
        id: listing.externalId,
        address: listing.address,
        borough: listing.city,
        zipcode: listing.zip,
        price: listing.price,
      },
      agentEnrichment: listing.agentEnrichment,
      priceHistory: listing.priceHistory,
      rentalPriceHistory: listing.rentalPriceHistory,
    },
  };
}

describe("buildListingChangeSummary", () => {
  it("marks new listings as new", () => {
    const result = buildListingChangeSummary({
      runId: "run-2",
      normalized: makeListing(),
      existing: null,
      previousSnapshot: null,
      evaluatedAt: new Date("2026-03-11T10:00:00.000Z"),
    });

    expect(result.status).toBe("new");
    expect(result.summary).toContain("New property");
    expect(result.changedFields).toEqual([]);
  });

  it("marks unchanged listings when no material fields changed", () => {
    const listing = makeListing();
    const result = buildListingChangeSummary({
      runId: "run-2",
      normalized: listing,
      existing: toExistingRow(listing),
      previousSnapshot: toSnapshot(listing),
      evaluatedAt: new Date("2026-03-11T10:00:00.000Z"),
    });

    expect(result.status).toBe("unchanged");
    expect(result.changedFields).toEqual([]);
    expect(result.summary).toContain("No material changes");
  });

  it("captures fresh price activity and new broker contact data as updates", () => {
    const previous = makeListing();
    const current = makeListing({
      price: 3_995_000,
      priceHistory: [
        { date: "2026-03-11", price: 3_995_000, event: "PRICE DECREASE" },
        { date: "2026-03-05", price: 4_250_000, event: "LISTED" },
      ],
      agentEnrichment: [
        { name: "Jane Broker", email: "jane@example.com", firm: "Broker Co" },
        { name: "John Broker", email: "john@example.com", firm: "Broker Co" },
      ],
      extra: { status: "in contract", monthlyTax: 4200, bbl: "1005310027" },
    });

    const result = buildListingChangeSummary({
      runId: "run-2",
      normalized: current,
      existing: toExistingRow(previous),
      previousSnapshot: toSnapshot(previous),
      evaluatedAt: new Date("2026-03-11T10:00:00.000Z"),
    });

    expect(result.status).toBe("updated");
    expect(result.changedFields).toEqual(
      expect.arrayContaining(["price", "priceHistory", "agentEnrichment", "listingStatus", "bbl"])
    );
    expect(result.summary).toContain("asking price");
    expect(result.changes?.find((change) => change.field === "bbl")?.changeType).toBe("added");
  });
});
