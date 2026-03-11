import { describe, expect, it } from "vitest";
import {
  buildOmStyleMessages,
  mergeExtractionResultWithFallback,
  resolveOmPrimaryPassMode,
  sanitizeOmAnalysisByCoverage,
  type ExtractRentalFinancialsResult,
} from "./extractRentalFinancialsFromListing.js";

describe("extractRentalFinancialsFromListing", () => {
  it("formats pdf attachments as OpenAI data urls", () => {
    const [message] = buildOmStyleMessages("Review this OM", [
      {
        filename: "offering.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7"),
      },
    ]);

    expect(message.role).toBe("user");
    expect(Array.isArray(message.content)).toBe(true);
    const filePart = (message.content as Array<Record<string, unknown>>)[1] as Record<string, unknown>;
    const file = filePart.file as Record<string, unknown>;
    expect(filePart.type).toBe("file");
    expect(file.file_data).toBe(`data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`);
  });

  it("maps OM extraction methods to the expected primary pass mode", () => {
    expect(resolveOmPrimaryPassMode("text_tables", true)).toBe("text");
    expect(resolveOmPrimaryPassMode("ocr_tables", true)).toBe("file");
    expect(resolveOmPrimaryPassMode("hybrid", true)).toBe("hybrid");
    expect(resolveOmPrimaryPassMode("ocr_tables", false)).toBe("text");
  });

  it("backfills missing OM structure from deterministic text tables", () => {
    const primary: ExtractRentalFinancialsResult = {
      fromLlm: {
        grossRentTotal: 600_000,
      },
      omAnalysis: {
        propertyInfo: {
          price: 8_135_000,
        },
      },
    };
    const fallback: ExtractRentalFinancialsResult = {
      fromLlm: {
        grossRentTotal: 999_999,
        rentalNumbersPerUnit: Array.from({ length: 11 }, (_, index) => ({ unit: `Fallback ${index + 1}` })),
      },
      omAnalysis: {
        propertyInfo: {
          totalUnits: 11,
          unitsResidential: 8,
        },
        rentRoll: Array.from({ length: 11 }, (_, index) => ({ unit: `Fallback ${index + 1}` })),
      },
    };

    const merged = mergeExtractionResultWithFallback(primary, fallback);
    const propertyInfo = (merged.omAnalysis?.propertyInfo ?? {}) as Record<string, unknown>;

    expect(merged.fromLlm?.grossRentTotal).toBe(600_000);
    expect(propertyInfo.price).toBe(8_135_000);
    expect(propertyInfo.totalUnits).toBe(11);
    expect(propertyInfo.unitsResidential).toBe(8);
    expect(merged.omAnalysis?.rentRoll).toHaveLength(11);
    expect(merged.fromLlm?.rentalNumbersPerUnit).toHaveLength(11);
  });

  it("drops incomplete rows when they do not reconcile to the reported unit count", () => {
    const merged = mergeExtractionResultWithFallback(
      {
        fromLlm: {
          rentalNumbersPerUnit: [{ unit: "18 Christopher Street 1" }, { unit: "18 Christopher Street 2" }],
        },
        omAnalysis: {
          propertyInfo: {
            totalUnits: 11,
          },
          rentRoll: [{ unit: "18 Christopher Street 1" }, { unit: "18 Christopher Street 2" }],
        },
      },
      {
        fromLlm: null,
        omAnalysis: null,
      }
    );

    expect(merged.fromLlm?.rentalNumbersPerUnit).toBeUndefined();
    expect(merged.omAnalysis?.rentRoll).toBeUndefined();
  });

  it("removes aggregate and placeholder rows from rent rolls and expense tables", () => {
    const merged = mergeExtractionResultWithFallback(
      {
        fromLlm: {
          rentalNumbersPerUnit: [
            {
              unit: "Unit 1",
              note: "OM states 2 total units but does not provide a unit-level rent roll. Placeholder added to match stated unit count.",
            },
            { unit: "#4", monthlyRent: 1_225, annualRent: 14_700 },
          ],
        },
        omAnalysis: {
          propertyInfo: {
            totalUnits: 2,
          },
          rentRoll: [
            {
              unit: "Unit 1",
              notes: "OM states 2 total units but does not provide a unit-level rent roll. Placeholder added to match stated unit count.",
            },
            { unit: "#4", monthlyRent: 1_225, annualRent: 14_700 },
            { unit: "TOTAL", monthlyRent: 99_999 },
          ],
          expenses: {
            expensesTable: [
              { lineItem: "Property Taxes", amount: 10_000 },
              { lineItem: "Total Expenses", amount: 10_000 },
            ],
            totalExpenses: 10_000,
          },
        },
      },
      {
        fromLlm: null,
        omAnalysis: null,
      }
    );

    expect(merged.omAnalysis?.rentRoll).toEqual([{ unit: "#4", monthlyRent: 1_225, annualRent: 14_700 }]);
    expect(merged.fromLlm?.rentalNumbersPerUnit).toEqual([{ unit: "#4", monthlyRent: 1_225, annualRent: 14_700 }]);
    expect(merged.omAnalysis?.expenses).toEqual({
      expensesTable: [{ lineItem: "Property Taxes", amount: 10_000 }],
      totalExpenses: 10_000,
    });
  });

  it("clears unsupported current financial fields when coverage says they were not extracted", () => {
    const sanitized = sanitizeOmAnalysisByCoverage(
      {
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
      },
      null
    );

    expect(sanitized.expenses).toBeUndefined();
    expect((sanitized.uiFinancialSummary as Record<string, unknown> | undefined)?.grossRent).toBeUndefined();
    expect((sanitized.uiFinancialSummary as Record<string, unknown> | undefined)?.noi).toBeUndefined();
    expect((sanitized.valuationMetrics as Record<string, unknown> | undefined)?.capRate).toBeUndefined();
    expect((sanitized.revenueComposition as Record<string, unknown> | undefined)?.commercialAnnualRent).toBeUndefined();
  });
});
