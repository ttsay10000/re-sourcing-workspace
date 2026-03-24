import { describe, expect, it } from "vitest";
import type { PropertyDetails } from "@re-sourcing/contracts";
import { resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import { resolveCurrentFinancialsFromDetails } from "../rental/currentFinancials.js";
import {
  getBrokerEmailNotes,
  mergeBrokerNotesIntoDetails,
  type BrokerDossierNotesExtract,
} from "./brokerDossierNotes.js";

describe("brokerDossierNotes", () => {
  it("reads saved broker email notes from dossier assumptions", () => {
    const details: PropertyDetails = {
      dealDossier: {
        assumptions: {
          brokerEmailNotes: "  Broker says rents are $9k and expenses are $35k.  ",
        },
      },
    };

    expect(getBrokerEmailNotes(details)).toBe("Broker says rents are $9k and expenses are $35k.");
  });

  it("creates usable authoritative-style financials from broker notes when no OM exists", () => {
    const extract: BrokerDossierNotesExtract = {
      propertyInfo: {
        totalUnits: 2,
      },
      rentRoll: [
        { unit: "1", annualRent: 60_000, unitCategory: "Residential" },
        { unit: "2", annualRent: 48_000, unitCategory: "Residential" },
      ],
      expenses: {
        expensesTable: [
          { lineItem: "Taxes", amount: 18_000 },
          { lineItem: "Insurance", amount: 12_000 },
        ],
      },
    };

    const merged = mergeBrokerNotesIntoDetails(null, extract);
    const currentFinancials = resolveCurrentFinancialsFromDetails(merged);

    expect(resolvePreferredOmUnitCount(merged)).toBe(2);
    expect(currentFinancials.grossRentalIncome).toBe(108_000);
    expect(currentFinancials.operatingExpenses).toBe(30_000);
    expect(currentFinancials.noi).toBe(78_000);
  });

  it("preserves existing OM fields while layering in broker-note totals", () => {
    const details: PropertyDetails = {
      omData: {
        authoritative: {
          propertyInfo: {
            address: "123 Main Street",
          },
          currentFinancials: {
            grossRentalIncome: 95_000,
            operatingExpenses: 40_000,
            noi: 55_000,
          },
        },
      },
    };
    const extract: BrokerDossierNotesExtract = {
      currentFinancials: {
        grossRentalIncome: 102_000,
        operatingExpenses: 38_000,
      },
    };

    const merged = mergeBrokerNotesIntoDetails(details, extract);
    const authoritative = merged?.omData?.authoritative;

    expect(authoritative?.propertyInfo?.address).toBe("123 Main Street");
    expect(authoritative?.currentFinancials?.grossRentalIncome).toBe(102_000);
    expect(authoritative?.currentFinancials?.operatingExpenses).toBe(38_000);
    expect(authoritative?.currentFinancials?.noi).toBe(64_000);
  });
});
