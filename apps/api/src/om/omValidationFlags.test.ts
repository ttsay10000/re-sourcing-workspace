import { describe, expect, it } from "vitest";
import type { OmAuthoritativeSnapshot } from "@re-sourcing/contracts";
import { buildOmValidationFlags } from "./omValidationFlags.js";

function flagFields(flags: ReturnType<typeof buildOmValidationFlags>): string[] {
  return flags.map((flag) => String(flag.field));
}

describe("buildOmValidationFlags", () => {
  it("flags 'no rents found' once (not per-field) for an expenses-only workbook", () => {
    // Mirrors the 325 W 22nd 3yr annual expense xlsx: expenses extracted, no rent data.
    const snapshot: OmAuthoritativeSnapshot = {
      rentRoll: [],
      currentFinancials: { operatingExpenses: 70_000, noi: null, grossRentalIncome: null },
      expenses: {
        totalExpenses: 70_000,
        expensesTable: [
          { lineItem: "Utilities", amount: 11_000 },
          { lineItem: "Normal Maint & Rpr", amount: 9_000 },
          { lineItem: "prop insurance", amount: 6_500 },
          { lineItem: "prop tax", amount: 43_500 },
        ],
      },
    };

    const flags = buildOmValidationFlags({ snapshot });
    const fields = flagFields(flags);

    expect(fields).toContain("rents");
    const rentsFlag = flags.find((flag) => flag.field === "rents");
    expect(rentsFlag?.severity).toBe("warning");
    expect(rentsFlag?.message).toContain("No rents found");
    // Subsumed by the combined flag.
    expect(fields).not.toContain("rentRoll");
    expect(fields).not.toContain("grossRentalIncome");
    // NOI flag explains it's blocked on rents rather than reading like an extraction bug.
    expect(flags.find((flag) => flag.field === "noi")?.message).toContain("without rents");
    // Expenses were extracted, so no operatingExpenses flag.
    expect(fields).not.toContain("operatingExpenses");
  });

  it("flags expected expense categories that are absent, with management as a warning", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      rentRoll: [{ unit: "1A", monthlyRent: 2_500 }],
      currentFinancials: { grossRentalIncome: 120_000, operatingExpenses: 70_000, noi: 50_000 },
      expenses: {
        expensesTable: [
          { lineItem: "Utilities", amount: 11_000 },
          { lineItem: "Normal Maint & Rpr", amount: 9_000 },
          { lineItem: "prop insurance", amount: 6_500 },
          { lineItem: "prop tax", amount: 43_500 },
        ],
      },
    };

    const flags = buildOmValidationFlags({ snapshot });
    const management = flags.find((flag) => flag.field === "expenses.management");
    expect(management?.severity).toBe("warning");
    expect(management?.flagType).toBe("missing_expense_category");
    expect(flags.find((flag) => flag.field === "expenses.payroll")?.severity).toBe("info");
    expect(flags.find((flag) => flag.field === "expenses.reserves")?.severity).toBe("info");
    // Present categories don't flag.
    const fields = flagFields(flags);
    expect(fields).not.toContain("expenses.propertyTaxes");
    expect(fields).not.toContain("expenses.insurance");
    expect(fields).not.toContain("expenses.utilities");
    expect(fields).not.toContain("expenses.repairsMaintenance");
  });

  it("does not run category checks when no expense table was extracted", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      rentRoll: [],
      currentFinancials: {},
      expenses: null,
    };
    const fields = flagFields(buildOmValidationFlags({ snapshot }));
    expect(fields.filter((field) => field.startsWith("expenses."))).toEqual([]);
  });

  it("flags sub-3% cap rates as warnings and 6%+ cap rates as positive callouts", () => {
    const base: OmAuthoritativeSnapshot = {
      rentRoll: [{ unit: "1A" }],
      currentFinancials: { grossRentalIncome: 500_000, operatingExpenses: 200_000, noi: 300_000 },
      expenses: null,
    };

    const low = buildOmValidationFlags({
      snapshot: base,
      omAnalysis: { propertyInfo: { askingPrice: 12_000_000 } }, // 2.5% derived
    }).find((flag) => flag.field === "capRate");
    expect(low?.severity).toBe("warning");
    expect(low?.message).toContain("under 3%");

    const strong = buildOmValidationFlags({
      snapshot: base,
      omAnalysis: { propertyInfo: { askingPrice: 4_000_000 } }, // 7.5% derived
    }).find((flag) => flag.field === "capRate");
    expect(strong?.severity).toBe("info");
    expect(strong?.message).toContain("above 6%");

    const implausible = buildOmValidationFlags({
      snapshot: base,
      omAnalysis: { propertyInfo: { askingPrice: 1_500_000 } }, // 20% derived
    }).find((flag) => flag.field === "capRate");
    expect(implausible?.severity).toBe("warning");
    expect(implausible?.message).toContain("implausibly high");

    const normal = buildOmValidationFlags({
      snapshot: base,
      omAnalysis: { propertyInfo: { askingPrice: 6_000_000 } }, // 5.0% derived
    }).find((flag) => flag.field === "capRate");
    expect(normal).toBeUndefined();
  });

  it("prefers an explicit extracted cap rate and normalizes fractional values", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      rentRoll: [{ unit: "1A" }],
      currentFinancials: { grossRentalIncome: 500_000, operatingExpenses: 200_000, noi: 300_000 },
      expenses: null,
    };
    const flag = buildOmValidationFlags({
      snapshot,
      omAnalysis: { uiFinancialSummary: { capRate: 0.025 }, propertyInfo: { askingPrice: 4_000_000 } },
    }).find((f) => f.field === "capRate");
    expect(flag?.severity).toBe("warning");
    expect(flag?.message).toContain("2.5%");
  });

  it("flags understated expense ratios and NOI that doesn't tie out", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      rentRoll: [{ unit: "1A" }],
      currentFinancials: { grossRentalIncome: 500_000, operatingExpenses: 80_000, noi: 350_000 },
      expenses: null,
    };
    const flags = buildOmValidationFlags({ snapshot });
    const ratio = flags.find((flag) => flag.field === "expenseRatio");
    expect(ratio?.severity).toBe("warning");
    expect(ratio?.message).toContain("under 25%");
    const noiTie = flags.find((flag) => flag.field === "noi");
    expect(noiTie?.severity).toBe("info");
    expect(noiTie?.message).toContain("doesn't tie");
  });

  it("flags rent rolls the LLM pulled twice via the raw roll", () => {
    const duplicatedRoll = [
      { unit: "219 E 59th - Retail", sqft: 2_150, monthlyRent: 23_000 },
      { unit: "219 E 59th - 2", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_000 },
      { unit: "219 East 59th Street Retail", sqft: 2_150, monthlyRent: 23_000 },
      { unit: "219 East 59th Street - 2", beds: 4, baths: 2, sqft: 1_386, monthlyRent: 9_000 },
    ];
    const snapshot: OmAuthoritativeSnapshot = {
      rentRoll: duplicatedRoll.slice(0, 2),
      currentFinancials: { grossRentalIncome: 384_000, operatingExpenses: 150_000, noi: 234_000 },
      expenses: null,
    };
    const flag = buildOmValidationFlags({ snapshot, rawRentRoll: duplicatedRoll }).find(
      (entry) => entry.flagType === "duplicate_rent_roll" && entry.field === "rentRoll"
    );
    expect(flag?.severity).toBe("warning");
    expect(flag?.message).toContain("2 duplicate rent roll rows removed");
    expect(flag?.message).toContain("219 East 59th Street Retail");
  });

  it("flags a roll with 2x the declared unit count and a gross that doesn't tie out", () => {
    // A double-pulled roll that slipped past exact dedupe (rents drifted slightly).
    const snapshot: OmAuthoritativeSnapshot = {
      propertyInfo: { totalUnits: 2 },
      rentRoll: [
        { unit: "Retail A", monthlyRent: 23_000 },
        { unit: "Unit 2", monthlyRent: 9_000 },
        { unit: "Retail One", monthlyRent: 23_500 },
        { unit: "Second Unit", monthlyRent: 9_100 },
      ],
      currentFinancials: { grossRentalIncome: 384_000, operatingExpenses: 150_000, noi: 234_000 },
      expenses: null,
    };
    const flags = buildOmValidationFlags({ snapshot });
    const unitCount = flags.find((flag) => flag.field === "rentRoll.unitCount");
    expect(unitCount?.severity).toBe("warning");
    expect(unitCount?.message).toContain("4 rows");
    expect(unitCount?.message).toContain("2 units");
    const tieOut = flags.find((flag) => flag.field === "rentRoll.grossTieOut");
    expect(tieOut?.severity).toBe("warning");
    expect(tieOut?.message).toContain("double-counted");
  });

  it("does not flag a roll that legitimately exceeds the unit count or ties out", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      propertyInfo: { totalUnits: 4 },
      rentRoll: [
        { unit: "Retail", monthlyRent: 23_000 },
        { unit: "2", monthlyRent: 3_000 },
        { unit: "3", monthlyRent: 3_100 },
        { unit: "4", monthlyRent: 3_200 },
        // One tenant leasing a second space — rows may exceed totalUnits.
        { unit: "Cellar", monthlyRent: 1_500 },
      ],
      currentFinancials: { grossRentalIncome: 405_600, operatingExpenses: 150_000, noi: 255_600 },
      expenses: null,
    };
    const flags = buildOmValidationFlags({ snapshot, rawRentRoll: snapshot.rentRoll });
    expect(flags.filter((flag) => flag.flagType === "duplicate_rent_roll")).toEqual([]);
  });

  it("returns no flags for a complete, in-range extraction", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      rentRoll: [{ unit: "1A", monthlyRent: 2_500 }],
      currentFinancials: { grossRentalIncome: 500_000, operatingExpenses: 200_000, noi: 300_000 },
      expenses: {
        expensesTable: [
          { lineItem: "Real Estate Taxes", amount: 90_000 },
          { lineItem: "Insurance", amount: 20_000 },
          { lineItem: "Utilities (heat, water)", amount: 40_000 },
          { lineItem: "Repairs & Maintenance", amount: 25_000 },
          { lineItem: "Management Fee", amount: 15_000 },
          { lineItem: "Payroll - Superintendent", amount: 8_000 },
          { lineItem: "Replacement Reserves", amount: 2_000 },
        ],
        totalExpenses: 200_000,
      },
    };
    const flags = buildOmValidationFlags({
      snapshot,
      omAnalysis: { propertyInfo: { askingPrice: 6_000_000 } }, // 5.0% cap
    });
    expect(flags).toEqual([]);
  });
});
