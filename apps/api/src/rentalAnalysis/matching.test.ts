import { describe, expect, it } from "vitest";
import type { CompetitorListing } from "@re-sourcing/contracts";
import { haversineMiles, rankRentalComps, scoreRentalComp, type MatchTarget } from "./matching.js";

const TARGET: MatchTarget = {
  propertyId: "prop-1",
  latitude: 40.7549,
  longitude: -73.984,
  neighborhood: "Hell's Kitchen",
  borough: "Manhattan",
  beds: 1,
  unitSqft: 650,
};

function listing(overrides: Partial<CompetitorListing>): CompetitorListing {
  return {
    id: "comp-1",
    source: "haus",
    sourceListingId: "slug",
    url: "https://example.com",
    excludedFromComps: false,
    scrapeStatus: "pricing_collected",
    scrapeTimestamp: "2026-06-10T00:00:00Z",
    updatedAt: "2026-06-10T00:00:00Z",
    ...overrides,
  };
}

describe("haversineMiles", () => {
  it("computes a known Manhattan distance", () => {
    // Times Sq (40.758, -73.9855) → Union Sq (40.7359, -73.9911) ≈ 1.55mi.
    const miles = haversineMiles(40.758, -73.9855, 40.7359, -73.9911);
    expect(miles).toBeGreaterThan(1.4);
    expect(miles).toBeLessThan(1.7);
  });
});

describe("scoreRentalComp", () => {
  it("scores a same-neighborhood same-bed nearby comp near the top", () => {
    const score = scoreRentalComp(
      TARGET,
      listing({
        latitude: 40.756,
        longitude: -73.985,
        neighborhood: "Hell's Kitchen",
        borough: "Manhattan",
        beds: 1,
        sqft: 620,
      }),
      { confidence: "high", normalizationStatus: "subtotal_clean_no_fees_taxes", availabilityStatus: "available" }
    );

    expect(score.distanceScore).toBe(25);
    expect(score.bedroomMatchScore).toBe(20);
    expect(score.neighborhoodScore).toBe(15);
    expect(score.sqftSimilarityScore).toBe(15);
    expect(score.confidenceScore).toBe(15);
    expect(score.termComparabilityScore).toBe(10);
    expect(score.totalScore).toBe(100);
    expect(score.labels).toContain("Same bedroom count");
    expect(score.labels).toContain("High confidence");
    expect(score.explanation).toContain("same neighborhood");
  });

  it("zeroes term score and labels excluded listings", () => {
    const score = scoreRentalComp(
      TARGET,
      listing({
        excludedFromComps: true,
        exclusionReason: "Minimum stay exceeds monthly comp threshold",
        minStayNights: 90,
      }),
      null
    );

    expect(score.termComparabilityScore).toBe(0);
    expect(score.labels).toContain("Excluded: minimum stay too long");
  });

  it("degrades with distance and bedroom mismatch", () => {
    const far = scoreRentalComp(
      TARGET,
      listing({ latitude: 40.7, longitude: -74.01, beds: 3, neighborhood: "FiDi", borough: "Manhattan" }),
      { confidence: "low", normalizationStatus: "effective_rate_only", availabilityStatus: "available" }
    );
    expect(far.bedroomMatchScore).toBe(0);
    expect(far.neighborhoodScore).toBe(7);
    expect(far.totalScore).toBeLessThan(50);
  });
});

describe("rankRentalComps", () => {
  it("ranks by total score and tags the best non-excluded comp", () => {
    const best = listing({
      id: "best",
      latitude: 40.7551,
      longitude: -73.9842,
      neighborhood: "Hell's Kitchen",
      borough: "Manhattan",
      beds: 1,
      sqft: 640,
    });
    const excluded = listing({ id: "excluded", excludedFromComps: true, exclusionReason: "Minimum stay exceeds monthly comp threshold" });
    const weaker = listing({ id: "weaker", latitude: 40.72, longitude: -74.0, beds: 2, borough: "Manhattan" });

    const ranked = rankRentalComps(TARGET, [
      { listing: weaker, observation: { confidence: "medium", normalizationStatus: "effective_rate_only", availabilityStatus: "available" } },
      { listing: excluded, observation: null },
      { listing: best, observation: { confidence: "high", normalizationStatus: "discount_removed", availabilityStatus: "available" } },
    ]);

    expect(ranked[0].listingId).toBe("best");
    expect(ranked[0].labels[0]).toBe("Best match");
    expect(ranked.map((score) => score.listingId)).toEqual(["best", "weaker", "excluded"]);
  });
});
