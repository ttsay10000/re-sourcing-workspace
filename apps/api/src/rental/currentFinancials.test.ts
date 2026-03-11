import { describe, expect, it } from "vitest";
import {
  resolveCurrentFinancialsFromDetails,
  resolveCurrentFinancialsFromOmAnalysis,
  resolveExpenseRowsFromDetails,
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
      omData: {
        authoritative: {
          incomeStatement: {
            grossPotentialRent: 617_208,
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

  it("returns empty current financials when no authoritative OM snapshot exists", () => {
    const resolved = resolveCurrentFinancialsFromDetails({
      rentalFinancials: {
        omAnalysis: {
          income: {
            grossRentPotential: 617_208,
            NOI: 446_272,
          },
        },
      },
    });

    expect(resolved).toEqual({
      noi: null,
      grossRentalIncome: null,
      otherIncome: null,
      vacancyLoss: null,
      effectiveGrossIncome: null,
      operatingExpenses: null,
    });
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

  it("uses authoritative OM snapshot values instead of legacy OM summary fallbacks", () => {
    const resolved = resolveCurrentFinancialsFromDetails({
      omData: {
        authoritative: {
          currentFinancials: {
            noi: 510_000,
            grossRentalIncome: 720_000,
            effectiveGrossIncome: 705_000,
            operatingExpenses: 195_000,
          },
          expenses: {
            expensesTable: [{ lineItem: "Taxes", amount: 120_000 }],
          },
        },
      },
      rentalFinancials: {
        omAnalysis: {
          income: {
            grossRentPotential: 617_208,
            NOI: 446_272,
          },
          uiFinancialSummary: {
            grossRent: 600_000,
            noi: 446_272,
          },
        },
        fromLlm: {
          noi: 430_000,
          grossRentTotal: 590_000,
          totalExpenses: 160_000,
        },
      },
    });

    expect(resolved.grossRentalIncome).toBe(720_000);
    expect(resolved.effectiveGrossIncome).toBe(705_000);
    expect(resolved.noi).toBe(510_000);
    expect(resolved.operatingExpenses).toBe(195_000);
  });

  it("does not fall back to legacy expense rows once authoritative OM exists", () => {
    const rows = resolveExpenseRowsFromDetails({
      omData: {
        authoritative: {
          expenses: {
            totalExpenses: 195_000,
          },
        },
      },
      rentalFinancials: {
        omAnalysis: {
          expenses: {
            expensesTable: [{ lineItem: "Legacy Taxes", amount: 99_000 }],
          },
        },
      },
    });

    expect(rows).toEqual([]);
  });
});
