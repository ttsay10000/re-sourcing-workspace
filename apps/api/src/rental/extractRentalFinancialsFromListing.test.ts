import { describe, expect, it } from "vitest";
import { extractRentalFinancialsFallback } from "./extractRentalFinancialsFallback.js";
import {
  buildOmStyleMessages,
  mergeExtractionResultWithFallback,
  sanitizeOmAnalysisByCoverage,
  type ExtractRentalFinancialsResult,
} from "./extractRentalFinancialsFromListing.js";

const CHRISTOPHER_TEXT = `
THE OFFERING
18-20 Christopher Street has 8 Total Residential units and 3 Commercial Units. Spanning approximately a gross square footage of 4,016 square feet, these properties are zoned R6 and Tax Class 2A Protected.
104,016
TOTAL UNITS
TOTAL SQUARE FEET
$813,500$103,270
PRICE / UNITPROPERTY TAXES
is being offered at
$8,135,000
75%
FREE MARKET
2A
TAX CLASS
Annual Tax Bill$51,123$52,143
`;

describe("mergeExtractionResultWithFallback", () => {
  it("backfills package unit mix from fallback without overwriting LLM financials", () => {
    const fallbackBase = extractRentalFinancialsFallback(CHRISTOPHER_TEXT);
    const fallbackRows = Array.from({ length: 11 }, (_, index) => ({
      unit: `Fallback ${index + 1}`,
    }));
    const fallback: ExtractRentalFinancialsResult = {
      fromLlm: {
        ...(fallbackBase.fromLlm ?? {}),
        rentalNumbersPerUnit: fallbackRows,
      },
      omAnalysis: {
        ...(fallbackBase.omAnalysis ?? {}),
        rentRoll: fallbackRows,
      },
    };
    const primary: ExtractRentalFinancialsResult = {
      fromLlm: {
        grossRentTotal: 600_000,
        noi: 446_730,
        rentalNumbersPerUnit: [
          { unit: "18 Christopher Street 1" },
          { unit: "18 Christopher Street 2" },
        ],
      },
      omAnalysis: {
        propertyInfo: {
          price: 8_135_000,
          taxClass: "2A",
        },
        rentRoll: [
          { unit: "18 Christopher Street 1" },
          { unit: "18 Christopher Street 2" },
        ],
        income: {
          grossRentActual: 600_000,
          NOI: 446_730,
        },
        revenueComposition: {
          commercialUnits: 3,
          freeMarketUnits: 8,
          rentStabilizedUnits: 0,
        },
        uiFinancialSummary: {
          grossRent: 600_000,
          noi: 446_730,
          capRate: 5.49,
        },
      },
    };

    const merged = mergeExtractionResultWithFallback(primary, fallback);
    const propertyInfo = (merged.omAnalysis?.propertyInfo ?? {}) as Record<string, unknown>;
    const income = (merged.omAnalysis?.income ?? {}) as Record<string, unknown>;
    const revenueComposition = (merged.omAnalysis?.revenueComposition ?? {}) as Record<string, unknown>;

    expect(merged.fromLlm?.grossRentTotal).toBe(600_000);
    expect(merged.fromLlm?.noi).toBe(446_730);
    expect(income.grossRentActual).toBe(600_000);
    expect(propertyInfo.totalUnits).toBe(11);
    expect(propertyInfo.unitsResidential).toBe(8);
    expect(propertyInfo.unitsCommercial).toBe(3);
    expect(revenueComposition.freeMarketUnits).toBe(6);
    expect(revenueComposition.rentStabilizedUnits).toBe(2);
    expect(Array.isArray(merged.fromLlm?.rentalNumbersPerUnit)).toBe(true);
    expect(merged.fromLlm?.rentalNumbersPerUnit).toHaveLength(11);
    expect(Array.isArray(merged.omAnalysis?.rentRoll)).toBe(true);
    expect(merged.omAnalysis?.rentRoll).toHaveLength(11);
    expect(merged.omAnalysis?.investmentTakeaways?.some((line) => line.includes("commercial"))).toBe(true);
  });

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

  it("drops incomplete unit rows when they do not reconcile to the reported unit count", () => {
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

  it("strips unsupported financial fields when coverage says current financials were not extracted", () => {
    const sanitized = sanitizeOmAnalysisByCoverage(
      {
        propertyInfo: {
          totalUnits: 11,
        },
        rentRoll: [
          { unit: "18 Christopher Street 1", monthlyRent: 3000 },
          { unit: "18 Christopher Street 2", monthlyRent: 3200 },
          { unit: "18 Christopher Street 3", monthlyRent: 3400 },
          { unit: "18 Christopher Street 4", monthlyRent: 2800 },
        ],
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
          commercialUnits: 3,
          freeMarketUnits: 6,
          rentStabilizedUnits: 2,
          commercialAnnualRent: 60_000,
          residentialAnnualRent: 0,
          commercialRevenueShare: 0.3,
        },
        uiFinancialSummary: {
          price: 8_135_000,
          grossRent: 312_000,
          noi: 140_130,
          capRate: 3.45,
          expenseRatio: 0.5274,
        },
        valuationMetrics: {
          pricePerUnit: 739_545.45,
          capRate: 3.45,
        },
        furnishedModel: {
          furnishedNOI: 238_221,
        },
        sourceCoverage: {
          currentFinancialsExtracted: false,
          expensesExtracted: false,
          rentRollExtracted: false,
        },
        investmentTakeaways: [
          "NOI appears to be $140,130.",
          "Tax Class 2A remains a positive.",
        ],
        noiReported: 140_130,
      },
      {
        expenses: {
          expensesTable: [{ lineItem: "Real Estate Taxes", amount: 103_270 }],
          totalExpenses: 103_270,
        },
      }
    );

    expect(sanitized.rentRoll).toBeUndefined();
    expect((sanitized.uiFinancialSummary as Record<string, unknown>)?.price).toBe(8_135_000);
    expect((sanitized.uiFinancialSummary as Record<string, unknown>)?.noi).toBeUndefined();
    expect((sanitized.valuationMetrics as Record<string, unknown>)?.capRate).toBeUndefined();
    expect((sanitized.revenueComposition as Record<string, unknown>)?.commercialAnnualRent).toBeUndefined();
    expect((sanitized.revenueComposition as Record<string, unknown>)?.commercialUnits).toBe(3);
    expect(sanitized.noiReported).toBeUndefined();
    expect(sanitized.expenses).toEqual({
      expensesTable: [{ lineItem: "Real Estate Taxes", amount: 103_270 }],
      totalExpenses: 103_270,
    });
    expect(sanitized.investmentTakeaways).toEqual(["Tax Class 2A remains a positive."]);
  });
});
