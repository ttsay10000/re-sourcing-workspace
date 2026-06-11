import { describe, expect, it } from "vitest";
import { brokerLookupContextFromListing, mergeBrokerEnrichment } from "./brokerEnrichment.js";

describe("broker enrichment", () => {
  it("uses listing-time broker and brokerage as the lookup context", () => {
    const context = brokerLookupContextFromListing({
      address: "11 West 11th Street",
      city: "New York",
      zip: "10011",
      source: "streeteasy",
      url: "https://streeteasy.com/sale/1999001",
      listedAt: "2026-06-01",
      extra: {
        sourceAgentFacts: [
          {
            name: "Jane Broker",
            firm: "Example Realty",
            email: null,
            phone: null,
            source: "source",
          },
        ],
      },
      agentEnrichment: null,
    });

    expect(context.brokerageName).toBe("Example Realty");
    expect(context.agentFacts?.[0]?.name).toBe("Jane Broker");
  });

  it("marks LLM-sourced broker emails for review and preserves source identity", () => {
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      [{ name: "Jane Broker", firm: "Example Realty", email: null, phone: null, source: "source" }],
      [
        {
          name: "Jane Broker",
          firm: "Example Realty",
          email: "jane@example-realty.com",
          phone: "212-555-0100",
          source: "llm",
          confidence: 82,
          evidence: "Brokerage profile lists Jane Broker at Example Realty.",
          sourceUrl: "https://example.com/jane-broker",
          needsReview: true,
        },
      ],
      {
        propertyContext: "11 West 11th Street, New York, 10011",
        source: "streeteasy",
        listingUrl: "https://streeteasy.com/sale/1999001",
        brokerageName: "Example Realty",
        agentFacts: [{ name: "Jane Broker", firm: "Example Realty", email: null, phone: null, source: "source" }],
      }
    );

    expect(merged).toEqual([
      {
        name: "Jane Broker",
        firm: "Example Realty",
        email: "jane@example-realty.com",
        phone: "212-555-0100",
        source: "llm",
        confidence: 82,
        evidence: "Brokerage profile lists Jane Broker at Example Realty.",
        sourceUrl: "https://example.com/jane-broker",
        needsReview: true,
        verificationTier: "needs_review",
        rejectedCandidate: null,
      },
    ]);
  });

  it("promotes a high-confidence firm-verified lookup as verified", () => {
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      [{ name: "Jane Broker", firm: "Example Realty", email: null, phone: null, source: "source" }],
      [
        {
          name: "Jane Broker",
          firm: "Example Realty",
          email: "jane@example-realty.com",
          phone: null,
          source: "llm",
          confidence: 88,
          evidence: "Agent page ties Jane Broker to Example Realty and this listing.",
          sourceUrl: "https://example.com/jane",
          needsReview: false,
        },
      ],
      { brokerageName: "Example Realty" }
    );

    expect(merged?.[0]?.email).toBe("jane@example-realty.com");
    expect(merged?.[0]?.verificationTier).toBe("verified");
    // Tier and needsReview must agree — surfaces read one or the other.
    expect(merged?.[0]?.needsReview).toBe(false);
    expect(merged?.[0]?.rejectedCandidate).toBeNull();
  });

  it("passes relaxed-pass quarantined candidates through the merge without populating send fields", () => {
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      [{ name: "Jane Broker", firm: "Example Realty", email: null, phone: null, source: "source" }],
      [
        {
          // Relaxed-pass output: contact lives ONLY in rejectedCandidate.
          name: "Jane Broker",
          firm: null,
          email: null,
          phone: null,
          source: "llm",
          confidence: null,
          evidence: null,
          sourceUrl: null,
          needsReview: true,
          verificationTier: "needs_review",
          rejectedCandidate: {
            email: "jane@current-firm.com",
            phone: null,
            firm: "Current Firm",
            confidence: 65,
            evidence: "Found at her current firm; listing-time agency could not be verified.",
            sourceUrl: "https://example.com/jane-now",
            reason: "firm_mismatch",
          },
        },
      ],
      { brokerageName: "Example Realty" }
    );

    const entry = merged?.[0];
    expect(entry?.email).toBeNull();
    expect(entry?.phone).toBeNull();
    expect(entry?.verificationTier).toBe("needs_review");
    expect(entry?.rejectedCandidate?.email).toBe("jane@current-firm.com");
  });

  it("reports candidate-only merges as not-meaningful so callers never overwrite a good contact with them", async () => {
    const { hasMeaningfulBrokerEnrichment, hasRetainedBrokerCandidates } = await import("./brokerEnrichment.js");
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      null,
      [
        {
          name: "Jane Broker",
          firm: "Example Realty",
          email: "maybe@example-realty.com",
          phone: null,
          source: "llm",
          confidence: 50,
          evidence: "Uncertain match.",
          sourceUrl: null,
          needsReview: true,
        },
      ],
      { brokerageName: "Example Realty" }
    );

    expect(merged).not.toBeNull();
    // Firm is present so the entry is meaningful, but strip it to simulate a
    // candidate-only entry and confirm the gates disagree in the right way.
    const candidateOnly = merged!.map((entry) => ({ ...entry, firm: null }));
    expect(hasMeaningfulBrokerEnrichment(candidateOnly)).toBe(false);
    expect(hasRetainedBrokerCandidates(candidateOnly)).toBe(true);
  });

  it("retains a mid-confidence contact as a needs-review candidate instead of discarding it", () => {
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      [{ name: "Jane Broker", firm: "Example Realty", email: null, phone: null, source: "source" }],
      [
        {
          name: "Jane Broker",
          firm: "Example Realty",
          email: "jane@example-realty.com",
          phone: null,
          source: "llm",
          confidence: 55,
          evidence: "Name matches but the page does not mention the listing.",
          sourceUrl: "https://example.com/jane",
          needsReview: true,
        },
      ],
      { brokerageName: "Example Realty" }
    );

    const entry = merged?.[0];
    expect(entry?.email).toBeNull();
    expect(entry?.verificationTier).toBe("needs_review");
    expect(entry?.needsReview).toBe(true);
    expect(entry?.rejectedCandidate).toEqual({
      email: "jane@example-realty.com",
      phone: null,
      firm: "Example Realty",
      confidence: 55,
      evidence: "Name matches but the page does not mention the listing.",
      sourceUrl: "https://example.com/jane",
      reason: "low_confidence",
    });
  });

  it("retains a firm-mismatched contact for review without populating send fields", () => {
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      [{ name: "Jane Broker", firm: "Example Realty", email: null, phone: null, source: "source" }],
      [
        {
          name: "Jane Broker",
          firm: "Other Brokerage Group",
          email: "jane@other-brokerage.com",
          phone: null,
          source: "llm",
          confidence: 90,
          evidence: "Jane Broker appears to have moved to Other Brokerage Group.",
          sourceUrl: "https://example.com/jane-now",
          needsReview: true,
        },
      ],
      { brokerageName: "Example Realty" }
    );

    const entry = merged?.[0];
    expect(entry?.email).toBeNull();
    expect(entry?.firm).toBe("Example Realty");
    expect(entry?.verificationTier).toBe("needs_review");
    expect(entry?.rejectedCandidate?.reason).toBe("firm_mismatch");
    expect(entry?.rejectedCandidate?.email).toBe("jane@other-brokerage.com");
  });

  it("tiers very low confidence contacts as rejected while still retaining them", () => {
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      null,
      [
        {
          name: "Jane Broker",
          firm: "Example Realty",
          email: "maybe-jane@example-realty.com",
          phone: null,
          source: "llm",
          confidence: 25,
          evidence: "Weak match.",
          sourceUrl: null,
          needsReview: true,
        },
      ],
      { brokerageName: "Example Realty" }
    );

    const entry = merged?.[0];
    expect(entry?.email).toBeNull();
    expect(entry?.verificationTier).toBe("rejected");
    expect(entry?.rejectedCandidate?.email).toBe("maybe-jane@example-realty.com");
  });

  it("keeps source-payload contacts verified and untouched by lookup candidates", () => {
    const merged = mergeBrokerEnrichment(
      ["Jane Broker"],
      [
        {
          name: "Jane Broker",
          firm: "Example Realty",
          email: "jane.direct@example-realty.com",
          phone: null,
          source: "source",
        },
      ],
      [
        {
          name: "Jane Broker",
          firm: "Example Realty",
          email: "jane.other@example-realty.com",
          phone: null,
          source: "llm",
          confidence: 50,
          evidence: "Alternate address.",
          sourceUrl: null,
          needsReview: true,
        },
      ],
      { brokerageName: "Example Realty" }
    );

    const entry = merged?.[0];
    expect(entry?.email).toBe("jane.direct@example-realty.com");
    expect(entry?.verificationTier).toBe("verified");
    expect(entry?.confidence).toBe(100);
    expect(entry?.needsReview).toBe(false);
    expect(entry?.rejectedCandidate).toBeNull();
  });
});
