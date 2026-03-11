import { describe, expect, it } from "vitest";
import {
  buildBrokerPropertyHistorySearchQuery,
  extractGmailHistoryAddressLine,
} from "./gmailConversationHistory.js";

describe("extractGmailHistoryAddressLine", () => {
  it("uses the first canonical address segment for Gmail history lookups", () => {
    expect(extractGmailHistoryAddressLine("18 Christopher Street, Manhattan, NY, 10014")).toBe(
      "18 Christopher Street"
    );
  });
});

describe("buildBrokerPropertyHistorySearchQuery", () => {
  it("includes both broker directionality and the property zip", () => {
    expect(
      buildBrokerPropertyHistorySearchQuery({
        toAddress: "Broker@Example.com",
        canonicalAddress: "18 Christopher Street, Manhattan, NY, 10014",
      })
    ).toBe('in:anywhere (to:broker@example.com OR from:broker@example.com) "18 Christopher Street" "10014"');
  });
});
