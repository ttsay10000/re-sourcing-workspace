import { describe, expect, it } from "vitest";
import { mergeManualOverrideCandidateContacts } from "./workflow.js";

describe("mergeManualOverrideCandidateContacts", () => {
  it("preserves a manual override candidate even when listing candidates exist", () => {
    const merged = mergeManualOverrideCandidateContacts({
      manualResolution: {
        propertyId: "property-1",
        status: "manual_override",
        contactId: "contact-1",
        contactEmail: "manual@outside-broker.com",
        confidence: 100,
        resolutionReason: "Manual",
        candidateContacts: [
          {
            email: "manual@outside-broker.com",
            name: "Jordan Manual",
            firm: "Outside Broker",
            contactId: "contact-1",
          },
        ],
        createdAt: "2026-03-18T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
      listingCandidates: [
        {
          email: "primary@listing-team.com",
          name: "Primary Agent",
          firm: "Listing Team",
        },
      ],
    });

    expect(merged).toEqual([
      {
        email: "manual@outside-broker.com",
        name: "Jordan Manual",
        firm: "Outside Broker",
        contactId: "contact-1",
      },
      {
        email: "primary@listing-team.com",
        name: "Primary Agent",
        firm: "Listing Team",
        contactId: null,
      },
    ]);
  });

  it("fills missing manual metadata from the matching listing candidate", () => {
    const merged = mergeManualOverrideCandidateContacts({
      manualResolution: {
        propertyId: "property-2",
        status: "manual_override",
        contactId: "contact-2",
        contactEmail: "broker@listing-team.com",
        confidence: 100,
        resolutionReason: "Manual",
        candidateContacts: [{ email: "broker@listing-team.com" }],
        createdAt: "2026-03-18T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
      listingCandidates: [
        {
          email: "broker@listing-team.com",
          name: "Bernadette Brennan",
          firm: "SERHANT",
        },
      ],
    });

    expect(merged).toEqual([
      {
        email: "broker@listing-team.com",
        name: "Bernadette Brennan",
        firm: "SERHANT",
        contactId: "contact-2",
      },
    ]);
  });
});
