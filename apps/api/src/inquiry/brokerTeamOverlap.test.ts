import { describe, expect, it } from "vitest";
import { buildBrokerTeamRecords, findBrokerTeamOverlapMatches } from "./brokerTeamOverlap.js";

describe("buildBrokerTeamRecords", () => {
  it("merges listing agents, candidate contacts, and manual extras into one deduped team", () => {
    const brokers = buildBrokerTeamRecords({
      listingAgents: [
        { name: "Michael Fiorillo", email: "michael@serhant.com", firm: "SERHANT" },
        { name: "Bernadette Brennan", email: "bernadette@serhant.com", firm: "SERHANT" },
      ],
      candidateContacts: [
        { name: "Michael Fiorillo", email: "MICHAEL@serhant.com", firm: "Serhant" },
      ],
      resolvedContactEmail: "bernadette@serhant.com",
      extraRecords: [{ email: "team@serhant.com" }],
    });

    expect(brokers).toEqual([
      { name: "Michael Fiorillo", email: "michael@serhant.com", firm: "SERHANT" },
      { name: "Bernadette Brennan", email: "bernadette@serhant.com", firm: "SERHANT" },
      { email: "team@serhant.com" },
    ]);
  });
});

describe("findBrokerTeamOverlapMatches", () => {
  it("flags another contacted property when a different teammate on the current listing was contacted elsewhere", () => {
    const currentBrokers = buildBrokerTeamRecords({
      listingAgents: [
        { name: "Bernadette Brennan", email: "bernadette@serhant.com", firm: "SERHANT" },
        { name: "Michael Fiorillo", email: "michael@serhant.com", firm: "SERHANT" },
      ],
    });

    const matches = findBrokerTeamOverlapMatches({
      currentBrokers,
      contactedProperties: [
        {
          propertyId: "property-1",
          canonicalAddress: "371 West 46th Street, Manhattan, NY, 10036",
          sentAt: "2026-03-18T14:00:00.000Z",
          brokers: buildBrokerTeamRecords({
            listingAgents: [
              { name: "Michael Fiorillo", email: "michael@serhant.com", firm: "SERHANT" },
            ],
          }),
        },
      ],
    });

    expect(matches).toEqual([
      {
        propertyId: "property-1",
        canonicalAddress: "371 West 46th Street, Manhattan, NY, 10036",
        sentAt: "2026-03-18T14:00:00.000Z",
        sharedBrokers: ["Michael Fiorillo (michael@serhant.com)"],
      },
    ]);
  });

  it("matches by broker name when one side is missing the email but the firm still lines up", () => {
    const currentBrokers = buildBrokerTeamRecords({
      listingAgents: [
        { name: "Michael Fiorillo", firm: "SERHANT" },
      ],
    });

    const matches = findBrokerTeamOverlapMatches({
      currentBrokers,
      contactedProperties: [
        {
          propertyId: "property-2",
          canonicalAddress: "662 Ninth Avenue, Manhattan, NY, 10036",
          sentAt: "2026-03-17T12:00:00.000Z",
          brokers: buildBrokerTeamRecords({
            listingAgents: [
              { name: "Michael Fiorillo", email: "michael@serhant.com", firm: "SERHANT" },
            ],
          }),
        },
      ],
    });

    expect(matches[0]?.sharedBrokers).toEqual(["Michael Fiorillo (michael@serhant.com)"]);
  });

  it("does not match the same name across different firms when there is no shared email", () => {
    const currentBrokers = buildBrokerTeamRecords({
      listingAgents: [
        { name: "Michael Fiorillo", firm: "SERHANT" },
      ],
    });

    const matches = findBrokerTeamOverlapMatches({
      currentBrokers,
      contactedProperties: [
        {
          propertyId: "property-3",
          canonicalAddress: "123 Broadway, Manhattan, NY, 10001",
          sentAt: "2026-03-16T12:00:00.000Z",
          brokers: buildBrokerTeamRecords({
            listingAgents: [
              { name: "Michael Fiorillo", firm: "Compass" },
            ],
          }),
        },
      ],
    });

    expect(matches).toEqual([]);
  });
});
