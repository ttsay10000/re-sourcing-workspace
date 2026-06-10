import { describe, expect, it } from "vitest";
import { groupInquiryRecipients } from "./bulkInquiryGrouping.js";

describe("groupInquiryRecipients", () => {
  it("groups properties sharing a broker email into one batch with the bulleted template", () => {
    const batches = groupInquiryRecipients([
      { propertyId: "p1", canonicalAddress: "123 Main St, Brooklyn, NY 11211", email: "Jane@Firm.com", name: "Jane Broker" },
      { propertyId: "p2", canonicalAddress: "456 Oak Ave, Brooklyn, NY 11215", email: "jane@firm.com", name: null },
      { propertyId: "p3", canonicalAddress: "789 Pine Rd, Queens, NY 11375", email: "other@firm.com", name: "Other Agent" },
    ]);

    expect(batches).toHaveLength(2);
    const jane = batches.find((batch) => batch.toAddress === "jane@firm.com");
    expect(jane).toBeDefined();
    expect(jane!.propertyIds).toEqual(["p1", "p2"]);
    expect(jane!.contactName).toBe("Jane Broker");
    expect(jane!.subject).toBe("OM Request - 123 Main St, Brooklyn, NY 11211 and 456 Oak Ave, Brooklyn, NY 11215");
    expect(jane!.body).toContain("- 123 Main St, Brooklyn, NY 11211");
    expect(jane!.body).toContain("- 456 Oak Ave, Brooklyn, NY 11215");
    expect(jane!.body).toContain("Hi Jane,");
  });

  it("keeps the classic single-property template for lone batches", () => {
    const batches = groupInquiryRecipients([
      { propertyId: "p1", canonicalAddress: "123 Main St, Brooklyn, NY 11211", email: "solo@firm.com", name: "Sam Solo" },
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.subject).toBe("Inquiry about 123 Main St");
    expect(batches[0]!.body).toContain("regarding the property at 123 Main St");
    expect(batches[0]!.body).toContain("Hi Sam,");
  });

  it("uses three-or-more property subject form and skips blank emails", () => {
    const batches = groupInquiryRecipients([
      { propertyId: "p1", canonicalAddress: "1 First St", email: "team@firm.com", name: null },
      { propertyId: "p2", canonicalAddress: "2 Second St", email: "team@firm.com", name: null },
      { propertyId: "p3", canonicalAddress: "3 Third St", email: "TEAM@firm.com", name: "Team Lead" },
      { propertyId: "p4", canonicalAddress: "4 Fourth St", email: "   ", name: null },
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.subject).toBe("OM Request - 3 properties");
    expect(batches[0]!.propertyIds).toEqual(["p1", "p2", "p3"]);
    expect(batches[0]!.contactName).toBe("Team Lead");
  });
});
