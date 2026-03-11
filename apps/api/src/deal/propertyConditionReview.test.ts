import { describe, expect, it } from "vitest";
import type { ListingRow, PropertyDetails } from "@re-sourcing/contracts";
import { collectConditionImageUrls, extractConditionSignalsFromText } from "./propertyConditionReview.js";

function sampleListing(overrides?: Partial<ListingRow>): ListingRow {
  return {
    id: "listing-1",
    source: "manual",
    externalId: "ext-1",
    address: "123 Main St",
    city: "New York",
    state: "NY",
    zip: "10001",
    price: 1_000_000,
    beds: 4,
    baths: 2,
    sqft: 3_000,
    url: "https://example.com/listing",
    title: "123 Main St",
    description: null,
    lat: null,
    lon: null,
    imageUrls: null,
    listedAt: "2026-03-11",
    agentNames: null,
    agentEnrichment: null,
    priceHistory: null,
    rentalPriceHistory: null,
    extra: null,
    lifecycleState: "active",
    firstSeenAt: "2026-03-11T00:00:00.000Z",
    lastSeenAt: "2026-03-11T00:00:00.000Z",
    missingSince: null,
    prunedAt: null,
    uploadedAt: null,
    uploadedRunId: null,
    duplicateScore: null,
    createdAt: "2026-03-11T00:00:00.000Z",
    updatedAt: "2026-03-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("extractConditionSignalsFromText", () => {
  it("detects value-add and fixer cues from listing and OM text", () => {
    const out = extractConditionSignalsFromText(
      "Classic pre-war asset with value-add upside. Property is being sold as-is and needs TLC.",
      {
        investmentTakeaways: [
          "Fixer-upper opportunity with below-market rents.",
        ],
      }
    );

    expect(out.overallCondition).toBe("Needs rehab");
    expect(out.renovationScope).toBe("Heavy");
    expect(out.textSignals).toContain("fixer / major renovation language");
    expect(out.summaryBullets[0]).toMatch(/rehab|capital work/i);
  });

  it("flags mixed signals when renovation-positive and value-add cues both appear", () => {
    const out = extractConditionSignalsFromText(
      "Recently renovated kitchens, but still marketed as a value-add opportunity with deferred maintenance.",
      null
    );

    expect(out.overallCondition).toBe("Mixed condition signals");
    expect(out.renovationScope).toBe("Unclear from text alone");
    expect(out.summaryBullets[0]).toMatch(/mixed/i);
  });
});

describe("collectConditionImageUrls", () => {
  it("dedupes and caps image urls across listing, extra, and rental-unit images", () => {
    const listing = sampleListing({
      imageUrls: [
        "https://img.example.com/a.jpg",
        "https://img.example.com/b.jpg",
      ],
      extra: {
        images: [
          "https://img.example.com/b.jpg",
          "https://img.example.com/c.jpg",
          "notaurl",
        ],
      },
    });
    const details: PropertyDetails = {
      rentalFinancials: {
        rentalUnits: [
          { unit: "1", images: ["https://img.example.com/d.jpg", "https://img.example.com/e.jpg"] },
          { unit: "2", images: ["https://img.example.com/f.jpg", "https://img.example.com/g.jpg"] },
        ],
      },
    };

    expect(collectConditionImageUrls(listing, details)).toEqual([
      "https://img.example.com/a.jpg",
      "https://img.example.com/b.jpg",
      "https://img.example.com/c.jpg",
      "https://img.example.com/d.jpg",
      "https://img.example.com/e.jpg",
      "https://img.example.com/f.jpg",
    ]);
  });
});
