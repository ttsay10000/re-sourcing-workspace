import { describe, expect, it } from "vitest";
import {
  fromLlmFromOmAnalysis,
  parseCompletionJsonContent,
  sanitizeOmAnalysisByCoverage,
  summarizeOmAnalysisCoverage,
} from "./omAnalysisShared.js";

describe("omAnalysisShared", () => {
  it("clears unsupported current financial fields when coverage says they were not extracted", () => {
    const sanitized = sanitizeOmAnalysisByCoverage({
      propertyInfo: {
        totalUnits: 11,
      },
      income: {
        grossRentActual: 276_000,
        effectiveGrossIncome: 296_400,
      },
      expenses: {
        expensesTable: [
          { lineItem: "Real Estate Taxes", amount: 103_270 },
          { lineItem: "Insurance", amount: 15_000 },
        ],
        totalExpenses: 156_270,
      },
      revenueComposition: {
        commercialAnnualRent: 60_000,
        residentialAnnualRent: 216_000,
      },
      uiFinancialSummary: {
        grossRent: 312_000,
        noi: 140_130,
        capRate: 3.45,
        expenseRatio: 0.5274,
      },
      valuationMetrics: {
        pricePerUnit: 739_545.45,
        capRate: 3.45,
      },
      sourceCoverage: {
        currentFinancialsExtracted: false,
        expensesExtracted: false,
        rentRollExtracted: false,
      },
    });

    expect(sanitized.expenses).toBeUndefined();
    expect((sanitized.uiFinancialSummary as Record<string, unknown> | undefined)?.grossRent).toBeUndefined();
    expect((sanitized.uiFinancialSummary as Record<string, unknown> | undefined)?.noi).toBeUndefined();
    expect((sanitized.valuationMetrics as Record<string, unknown> | undefined)?.capRate).toBeUndefined();
    expect((sanitized.revenueComposition as Record<string, unknown> | undefined)?.commercialAnnualRent).toBeUndefined();
  });

  it("derives listing-facing rental financials from OM rent roll and expenses", () => {
    const derived = fromLlmFromOmAnalysis({
      propertyInfo: {
        totalUnits: 2,
      },
      rentRoll: [
        { unit: "#1", monthlyRent: 2_500, annualRent: 30_000, beds: 1, baths: 1 },
        { unit: "#2", monthlyRent: 2_750, annualRent: 33_000, beds: 1, baths: 1 },
      ],
      expenses: {
        expensesTable: [{ lineItem: "Taxes", amount: 12_000 }],
        totalExpenses: 12_000,
      },
      income: {
        grossRentActual: 63_000,
      },
      uiFinancialSummary: {
        capRate: 5.5,
      },
      sourceCoverage: {
        rentRollExtracted: true,
        currentFinancialsExtracted: true,
        expensesExtracted: true,
      },
      noiReported: 51_000,
      investmentTakeaways: ["Stable in-place rent roll"],
    });

    expect(derived.noi).toBe(51_000);
    expect(derived.capRate).toBe(5.5);
    expect(derived.grossRentTotal).toBe(63_000);
    expect(derived.totalExpenses).toBe(12_000);
    expect(derived.rentalNumbersPerUnit).toHaveLength(2);
    expect(derived.keyTakeaways).toContain("Stable in-place rent roll");
  });

  it("summarizes OM coverage for dossier readiness checks", () => {
    const coverage = summarizeOmAnalysisCoverage({
      propertyInfo: {
        totalUnits: 10,
        price: 8_500_000,
      },
      rentRoll: [{ unit: "#1", annualRent: 30_000 }],
      expenses: {
        expensesTable: [{ lineItem: "Taxes", amount: 12_000 }],
      },
    });

    expect(coverage).toEqual({
      hasPrice: true,
      hasUnitCount: true,
      hasRentRoll: true,
      rentRollCount: 1,
      hasExpenses: true,
      expenseLineCount: 1,
    });
  });

  it("parses JSON wrapped in code fences", () => {
    expect(parseCompletionJsonContent("```json\n{\"propertyInfo\":{\"totalUnits\":6}}\n```")).toEqual({
      propertyInfo: { totalUnits: 6 },
    });
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseCompletionJsonContent("{\"propertyInfo\":\"unterminated}")).toBeNull();
  });
});
