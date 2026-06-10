import { describe, expect, it } from "vitest";
import { buildRuleBasedRecommendations, type RecommendationInputRow } from "./progressRecommendations.js";

function row(overrides: Partial<RecommendationInputRow>): RecommendationInputRow {
  return {
    sectionId: "sourced",
    propertyId: overrides.propertyId ?? "p1",
    displayAddress: overrides.displayAddress ?? "111 West 17th Street",
    brokerEmail: null,
    hasOm: false,
    omStatus: "none",
    tourScheduledAt: null,
    postTourDecision: null,
    underwritingReviewRequired: false,
    underwritingReviewCompleted: false,
    ...overrides,
  };
}

describe("buildRuleBasedRecommendations", () => {
  it("returns no items for an empty board", () => {
    expect(buildRuleBasedRecommendations([])).toEqual([]);
  });

  it("flags tours awaiting inputs ahead of data hygiene", () => {
    const items = buildRuleBasedRecommendations([
      row({ propertyId: "a", sectionId: "tour_completed_awaiting_inputs" }),
      row({ propertyId: "b", sectionId: "sourced", brokerEmail: null }),
    ]);
    expect(items[0]?.id).toBe("tour_inputs");
    expect(items[0]?.count).toBe(1);
    expect(items[0]?.stageId).toBe("tour_completed_awaiting_inputs");
  });

  it("does not flag tour inputs once a post-tour decision exists", () => {
    const items = buildRuleBasedRecommendations([
      row({ propertyId: "a", sectionId: "tour_completed_awaiting_inputs", postTourDecision: "move_forward" }),
    ]);
    expect(items.find((item) => item.id === "tour_inputs")).toBeUndefined();
  });

  it("collects missing broker emails across pre-LOI stages only", () => {
    const items = buildRuleBasedRecommendations([
      row({ propertyId: "a", sectionId: "sourced", brokerEmail: null }),
      row({ propertyId: "b", sectionId: "om_requested", brokerEmail: null }),
      row({ propertyId: "c", sectionId: "negotiation", brokerEmail: null }),
      row({ propertyId: "d", sectionId: "sourced", brokerEmail: "broker@example.com" }),
    ]);
    const missing = items.find((item) => item.id === "missing_broker_email");
    expect(missing?.count).toBe(2);
    expect(missing?.propertyIds).toEqual(["a", "b"]);
  });

  it("suggests OM requests only when a broker email exists and no OM activity", () => {
    const items = buildRuleBasedRecommendations([
      row({ propertyId: "a", sectionId: "sourced", brokerEmail: "x@y.com" }),
      row({ propertyId: "b", sectionId: "sourced", brokerEmail: "x@y.com", omStatus: "requested" }),
      row({ propertyId: "c", sectionId: "sourced", brokerEmail: null }),
    ]);
    const request = items.find((item) => item.id === "request_oms");
    expect(request?.propertyIds).toEqual(["a"]);
  });

  it("summarizes example addresses with an overflow counter", () => {
    const items = buildRuleBasedRecommendations(
      ["a", "b", "c", "d", "e", "f"].map((id, index) =>
        row({ propertyId: id, displayAddress: `${index + 1} Main St`, sectionId: "underwriting_awaiting_review", underwritingReviewRequired: true })
      )
    );
    const review = items.find((item) => item.id === "underwriting_review");
    expect(review?.count).toBe(6);
    expect(review?.detail).toContain("+2 more");
  });
});

describe("staleness rules", () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it("flags OM requests quiet for 10+ days", () => {
    const items = buildRuleBasedRecommendations([
      row({ propertyId: "a", sectionId: "om_requested", latestOutreachAt: daysAgo(11) }),
      row({ propertyId: "b", sectionId: "om_requested", latestOutreachAt: daysAgo(2) }),
      row({ propertyId: "c", sectionId: "om_requested", stageEnteredAt: daysAgo(12) }),
    ]);
    const stale = items.find((item) => item.id === "om_request_stale");
    expect(stale?.propertyIds.sort()).toEqual(["a", "c"]);
  });

  it("prefers outreach recency over stage age", () => {
    const items = buildRuleBasedRecommendations([
      row({ propertyId: "a", sectionId: "om_requested", latestOutreachAt: daysAgo(1), stageEnteredAt: daysAgo(30) }),
    ]);
    expect(items.find((item) => item.id === "om_request_stale")).toBeUndefined();
  });

  it("flags underwriting reviews stuck past the danger threshold", () => {
    const items = buildRuleBasedRecommendations([
      row({ propertyId: "a", sectionId: "underwriting_awaiting_review", stageEnteredAt: daysAgo(15), underwritingReviewRequired: true }),
      row({ propertyId: "b", sectionId: "underwriting_awaiting_review", stageEnteredAt: daysAgo(3), underwritingReviewRequired: true }),
    ]);
    const stuck = items.find((item) => item.id === "underwriting_stale");
    expect(stuck?.propertyIds).toEqual(["a"]);
  });
});
