import { describe, expect, it } from "vitest";
import { resolveDetailedCashFlowModel } from "./detailedCashFlowModel.js";

describe("detailedCashFlowModel", () => {
  it("preserves saved commercial and rent-stabilized flags when restoring unit rows without source OM rows", () => {
    const model = resolveDetailedCashFlowModel({
      details: null,
      defaultRentUpliftPct: 70,
      defaultVacancyPct: 15,
      defaultAnnualExpenseGrowthPct: 1,
      defaultAnnualPropertyTaxGrowthPct: 3,
      unitModelRows: [
        {
          rowId: "retail-1",
          unitLabel: "Retail",
          currentAnnualRent: 120_000,
          underwrittenAnnualRent: 120_000,
          isProtected: true,
          isCommercial: true,
        },
        {
          rowId: "rs-2",
          unitLabel: "Unit 2",
          currentAnnualRent: 24_000,
          underwrittenAnnualRent: 24_000,
          isProtected: true,
          isRentStabilized: true,
        },
      ],
      expenseModelRows: null,
    });

    expect(model.unitModelRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowId: "retail-1",
          isProtected: true,
          isCommercial: true,
          isRentStabilized: false,
          rentUpliftPct: 0,
          monthlyRecurringOpex: 0,
        }),
        expect.objectContaining({
          rowId: "rs-2",
          isProtected: true,
          isCommercial: false,
          isRentStabilized: true,
          rentUpliftPct: 0,
          monthlyRecurringOpex: 0,
        }),
      ])
    );
  });

  it("adds default utility lines for modeled hospitality units and bumps repairs without inflating other rows", () => {
    const model = resolveDetailedCashFlowModel({
      details: {
        omData: {
          authoritative: {
            rentRoll: [
              { unit: "1A", unitCategory: "Residential", annualRent: 36_000 },
              { unit: "2A", unitCategory: "Residential", annualRent: 42_000 },
              { unit: "3A", unitCategory: "Residential", annualRent: 30_000, rentType: "Rent Stabilized" },
              { unit: "Retail", unitCategory: "Commercial", annualRent: 60_000 },
            ],
            expenses: {
              expensesTable: [
                { lineItem: "Repairs and Maintenance", amount: 10_000 },
                { lineItem: "Insurance", amount: 5_000 },
              ],
            },
          },
        },
      } as never,
      defaultRentUpliftPct: 70,
      defaultVacancyPct: 15,
      defaultAnnualExpenseGrowthPct: 2,
      defaultAnnualPropertyTaxGrowthPct: 3,
      unitModelRows: null,
      expenseModelRows: null,
    });

    expect(model.expenseModelRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lineItem: "Repairs and Maintenance",
          amount: 11_000,
          annualGrowthPct: 2,
        }),
        expect.objectContaining({
          lineItem: "Insurance",
          amount: 5_000,
          annualGrowthPct: 2,
        }),
        expect.objectContaining({
          rowId: "expense-derived-wifi-internet",
          lineItem: "WiFi / internet",
          amount: 2_400,
          annualGrowthPct: 2,
        }),
        expect.objectContaining({
          rowId: "expense-derived-furnished-rental-utilities",
          lineItem: "Furnished rental utilities",
          amount: 7_200,
          annualGrowthPct: 2,
        }),
      ])
    );
  });

  it("migrates the legacy in-unit-electric saved row onto furnished rental utilities", () => {
    const model = resolveDetailedCashFlowModel({
      details: {
        omData: {
          authoritative: {
            rentRoll: [{ unit: "1A", unitCategory: "Residential", annualRent: 36_000 }],
            expenses: {
              expensesTable: [{ lineItem: "Insurance", amount: 5_000 }],
            },
          },
        },
      } as never,
      defaultRentUpliftPct: 70,
      defaultVacancyPct: 15,
      defaultAnnualExpenseGrowthPct: 2,
      defaultAnnualPropertyTaxGrowthPct: 3,
      unitModelRows: null,
      expenseModelRows: [
        {
          rowId: "expense-derived-in-unit-electric",
          lineItem: "In-unit electric",
          amount: 4_200,
          annualGrowthPct: 5,
        },
      ],
    });

    expect(
      model.expenseModelRows.filter(
        (row) =>
          row.rowId === "expense-derived-furnished-rental-utilities" ||
          row.rowId === "expense-derived-in-unit-electric"
      )
    ).toEqual([
      expect.objectContaining({
        rowId: "expense-derived-furnished-rental-utilities",
        lineItem: "Furnished rental utilities",
        amount: 4_200,
        annualGrowthPct: 5,
      }),
    ]);
  });
});
