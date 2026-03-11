import { describe, expect, it } from "vitest";
import type { PropertyDetails } from "@re-sourcing/contracts";
import { getRentRollComparison } from "./rentRollComparison.js";

describe("rentRollComparison", () => {
  it("uses authoritative OM rent roll when present", () => {
    const details: PropertyDetails = {
      omData: {
        authoritative: {
          rentRoll: [
            { unit: "1A", beds: 1, monthlyRent: 2200 },
            { unit: "2A", beds: 2, monthlyRent: 3200 },
          ],
        },
      },
      rentalFinancials: {
        rentalUnits: [
          { unit: "1A", beds: 1, rentalPrice: 2200 },
          { unit: "2A", beds: 2, rentalPrice: 3200 },
        ],
        omAnalysis: {
          rentRoll: [{ unit: "PH", beds: 4, monthlyRent: 9000 }],
        },
      },
    };

    expect(getRentRollComparison(details)).toEqual({
      comparable: true,
      totalUnitsRapid: 2,
      totalUnitsOm: 2,
      totalBedsRapid: 3,
      totalBedsOm: 3,
    });
  });
});
