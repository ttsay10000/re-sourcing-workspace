import { afterEach, describe, expect, it } from "vitest";
import { buildOutreachBody, extractOutreachAddressesFromMessage, isAutomatedOutreachEnabled, normalizeOutreachAddressKey } from "./outreachAutomation.js";

const originalEnableAutomatedOutreach = process.env.ENABLE_AUTOMATED_OUTREACH;

afterEach(() => {
  if (originalEnableAutomatedOutreach == null) delete process.env.ENABLE_AUTOMATED_OUTREACH;
  else process.env.ENABLE_AUTOMATED_OUTREACH = originalEnableAutomatedOutreach;
});

describe("extractOutreachAddressesFromMessage", () => {
  it("prefers bullet-listed addresses from the email body", () => {
    const addresses = extractOutreachAddressesFromMessage({
      subject: "OM Request - 1 Main Street and 2 Main Street",
      body: `Hi,\n\nCould you please send over the OMs?\n\n- 18 Christopher Street, Manhattan, NY, 10014\n- 27 West 9th Street, Manhattan, NY, 10011\n\nThank you.`,
    });

    expect(addresses).toEqual([
      "18 Christopher Street, Manhattan, NY, 10014",
      "27 West 9th Street, Manhattan, NY, 10011",
    ]);
  });

  it("falls back to subject parsing when the body list is unavailable", () => {
    const addresses = extractOutreachAddressesFromMessage({
      subject: "OM Request - 18 Christopher Street, Manhattan, NY, 10014 and 27 West 9th Street, Manhattan, NY, 10011",
      body: "Hi,\n\nCould you please send over the OMs?\n\nThank you.",
    });

    expect(addresses).toEqual([
      "18 Christopher Street, Manhattan, NY, 10014",
      "27 West 9th Street, Manhattan, NY, 10011",
    ]);
  });
});

describe("normalizeOutreachAddressKey", () => {
  it("matches the same building when city/state formatting differs", () => {
    expect(normalizeOutreachAddressKey("18 Christopher Street, Manhattan, NY, 10014")).toBe(
      normalizeOutreachAddressKey("18 Christopher Street, New York, NY 10014")
    );
  });
});

describe("buildOutreachBody", () => {
  it("uses the warmer manual-style single-property copy", () => {
    const body = buildOutreachBody("Jane Broker", ["18 Christopher Street, Manhattan, NY, 10014"]);

    expect(body).toContain("Hi Jane,");
    expect(body).toContain(
      "My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the property below currently on the market."
    );
    expect(body).toContain("- 18 Christopher Street, Manhattan, NY, 10014");
    expect(body).toContain(
      "Would you be able to share the OM, T-12, current rent roll, expenses, and/or any available financials?"
    );
    expect(body).toContain(
      "If there is a better contact for this property, please feel free to point me in the right direction."
    );
    expect(body).toContain("Thanks in advance - looking forward to taking a look.");
    expect(body).toContain("Best,\nTyler Tsay\n617 306 3336\ntyler@stayhaus.co");
  });

  it("pluralizes the request for batched outreach", () => {
    const body = buildOutreachBody("Jane Broker", [
      "18 Christopher Street, Manhattan, NY, 10014",
      "27 West 9th Street, Manhattan, NY, 10011",
    ]);

    expect(body).toContain(
      "My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the properties below currently on the market."
    );
    expect(body).toContain("- 18 Christopher Street, Manhattan, NY, 10014");
    expect(body).toContain("- 27 West 9th Street, Manhattan, NY, 10011");
    expect(body).toContain(
      "Would you be able to share the OMs, T-12s, current rent rolls, expenses, and/or any available financials for these properties?"
    );
    expect(body).toContain(
      "If there is a better contact for any of these, please feel free to point me in the right direction."
    );
  });
});

describe("isAutomatedOutreachEnabled", () => {
  it("defaults outgoing automation to disabled", () => {
    delete process.env.ENABLE_AUTOMATED_OUTREACH;

    expect(isAutomatedOutreachEnabled()).toBe(false);
  });

  it("requires explicit enablement", () => {
    process.env.ENABLE_AUTOMATED_OUTREACH = "1";
    expect(isAutomatedOutreachEnabled()).toBe(true);

    process.env.ENABLE_AUTOMATED_OUTREACH = "true";
    expect(isAutomatedOutreachEnabled()).toBe(true);
  });
});
