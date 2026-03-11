import { describe, expect, it } from "vitest";
import {
  resolveCurrentFinancialsFromDetails,
  resolveCurrentFinancialsFromOmAnalysis,
  resolveExpenseRowsFromOmAnalysis,
} from "./currentFinancials.js";

describe("currentFinancials", () => {
  it("prefers explicit OM income fields over rounded UI summary figures", () => {
    const resolved = resolveCurrentFinancialsFromOmAnalysis({
      income: {
        grossRentResidentialPotential: 351_468,
        grossRentCommercialPotential: 265_740,
        otherIncome: 1_931,
        vacancyLoss: 8_787,
        effectiveGrossIncome: 610_352,
        NOI: 446_272,
      },
      uiFinancialSummary: {
        grossRent: 600_000,
        noi: 446_272,
      },
    });

    expect(resolved.grossRentalIncome).toBe(617_208);
    expect(resolved.otherIncome).toBe(1_931);
    expect(resolved.effectiveGrossIncome).toBe(610_352);
    expect(resolved.operatingExpenses).toBe(164_080);
  });

  it("uses effective gross income minus NOI for expenses when no expense table exists", () => {
    const resolved = resolveCurrentFinancialsFromDetails({
      rentalFinancials: {
        omAnalysis: {
          income: {
            grossRentPotential: 617_208,
            otherIncome: 1_931,
            vacancyLoss: 8_787,
            effectiveGrossIncome: 610_352,
            NOI: 446_272,
          },
        },
      },
    });

    expect(resolved.grossRentalIncome).toBe(617_208);
    expect(resolved.operatingExpenses).toBe(164_080);
  });

  it("uses grossRentActual when that is the only explicit gross-rent field", () => {
    const resolved = resolveCurrentFinancialsFromOmAnalysis({
      income: {
        grossRentActual: 550_000,
        NOI: 400_000,
      },
    });

    expect(resolved.grossRentalIncome).toBe(550_000);
  });

  it("returns normalized expense rows from the OM table", () => {
    const rows = resolveExpenseRowsFromOmAnalysis({
      expenses: {
        expensesTable: [
          { lineItem: "Taxes", amount: 100_000 },
          { lineItem: "Management Fee", amount: 25_000 },
        ],
      },
    });

    expect(rows).toEqual([
      { lineItem: "Taxes", amount: 100_000 },
      { lineItem: "Management Fee", amount: 25_000 },
    ]);
  });
});
