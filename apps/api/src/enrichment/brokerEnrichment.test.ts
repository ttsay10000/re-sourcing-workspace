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
      },
    ]);
  });
});
