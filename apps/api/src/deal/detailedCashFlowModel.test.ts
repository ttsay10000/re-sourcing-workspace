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

  it("uses extracted projected market rent as the MTR base without applying default rent uplift again", () => {
    const model = resolveDetailedCashFlowModel({
      details: {
        omData: {
          authoritative: {
            rentRoll: [
              {
                unit: "1A",
                unitCategory: "Residential",
                annualRent: 120_000,
                projectedAnnualRent: 263_160,
              },
            ],
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

    expect(model.unitModelRows[0]).toEqual(
      expect.objectContaining({
        currentAnnualRent: 120_000,
        underwrittenAnnualRent: 263_160,
        rentUpliftPct: 0,
        modeledAnnualRent: 223_686,
        defaultProjectedAnnualRent: 263_160,
      })
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

  it("keeps removed expense rows removed: saved rows are authoritative over the OM snapshot", () => {
    const details = {
      omData: {
        authoritative: {
          rentRoll: [{ unit: "1A", unitCategory: "Residential", annualRent: 36_000 }],
          expenses: {
            expensesTable: [
              { lineItem: "Insurance", amount: 5_000 },
              { lineItem: "Water and Sewer", amount: 8_000 },
            ],
          },
        },
      },
    } as never;
    // User removed "Water and Sewer" in the OM workspace and saved: the saved
    // set only carries Insurance. The source row must NOT come back.
    const model = resolveDetailedCashFlowModel({
      details,
      defaultRentUpliftPct: 70,
      defaultVacancyPct: 15,
      defaultAnnualExpenseGrowthPct: 2,
      defaultAnnualPropertyTaxGrowthPct: 3,
      unitModelRows: null,
      expenseModelRows: [
        { rowId: "expense-insurance-1", lineItem: "Insurance", amount: 4_500, annualGrowthPct: 2 },
      ],
    });

    expect(model.expenseModelRows).toEqual([
      expect.objectContaining({ rowId: "expense-insurance-1", lineItem: "Insurance", amount: 4_500 }),
    ]);
    expect(model.expenseModelRows.some((row) => /water/i.test(row.lineItem))).toBe(false);
  });

  it("keeps saved values when an OM re-extraction shifts row identity instead of resurrecting extracted numbers", () => {
    // After a re-run of OM analysis the snapshot rows come back in a new
    // order/wording, so none of the saved rowIds match the source anymore.
    const reExtractedDetails = {
      omData: {
        authoritative: {
          rentRoll: [
            { unit: "Unit 2A", unitCategory: "Residential", annualRent: 41_000 },
            { unit: "Unit 1A", unitCategory: "Residential", annualRent: 39_000 },
          ],
          expenses: {
            expensesTable: [{ lineItem: "Insurance Premium", amount: 12_000 }],
          },
        },
      },
    } as never;
    const model = resolveDetailedCashFlowModel({
      details: reExtractedDetails,
      defaultRentUpliftPct: 70,
      defaultVacancyPct: 15,
      defaultAnnualExpenseGrowthPct: 2,
      defaultAnnualPropertyTaxGrowthPct: 3,
      unitModelRows: [
        {
          rowId: "rent-1a-residential-1",
          unitLabel: "1A",
          currentAnnualRent: 36_000,
          underwrittenAnnualRent: 48_000,
          rentUpliftPct: 0,
          occupancyPct: 100,
          includeInUnderwriting: true,
          isProtected: false,
        },
      ],
      expenseModelRows: [
        { rowId: "expense-insurance-1", lineItem: "Insurance", amount: 4_500, annualGrowthPct: 2 },
      ],
    });

    expect(model.unitModelRows).toEqual([
      expect.objectContaining({
        rowId: "rent-1a-residential-1",
        unitLabel: "1A",
        currentAnnualRent: 36_000,
        underwrittenAnnualRent: 48_000,
      }),
    ]);
    expect(model.expenseModelRows).toEqual([
      expect.objectContaining({ rowId: "expense-insurance-1", lineItem: "Insurance", amount: 4_500 }),
    ]);
  });

  it("keeps removed unit rows removed while matched saved rows still inherit source defaults", () => {
    const details = {
      omData: {
        authoritative: {
          rentRoll: [
            { unit: "1A", unitCategory: "Residential", annualRent: 36_000, beds: 2, baths: 1, sqft: 850 },
            { unit: "2A", unitCategory: "Residential", annualRent: 42_000 },
          ],
        },
      },
    } as never;
    // User dropped unit 2A and only edited 1A's underwritten rent. Beds/baths
    // and the rest of 1A keep flowing in from the matching source row.
    const model = resolveDetailedCashFlowModel({
      details,
      defaultRentUpliftPct: 70,
      defaultVacancyPct: 15,
      defaultAnnualExpenseGrowthPct: 2,
      defaultAnnualPropertyTaxGrowthPct: 3,
      unitModelRows: [
        { rowId: "rent-1a-residential-1", unitLabel: "1A", underwrittenAnnualRent: 50_000 },
      ],
      expenseModelRows: null,
    });

    expect(model.unitModelRows).toHaveLength(1);
    expect(model.unitModelRows[0]).toEqual(
      expect.objectContaining({
        rowId: "rent-1a-residential-1",
        currentAnnualRent: 36_000,
        underwrittenAnnualRent: 50_000,
        beds: 2,
        baths: 1,
        sqft: 850,
      })
    );
  });

  it("still builds the model from the OM snapshot when nothing has been saved", () => {
    const model = resolveDetailedCashFlowModel({
      details: {
        omData: {
          authoritative: {
            rentRoll: [{ unit: "1A", unitCategory: "Residential", annualRent: 36_000 }],
            expenses: { expensesTable: [{ lineItem: "Insurance", amount: 5_000 }] },
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

    expect(model.unitModelRows).toHaveLength(1);
    expect(model.expenseModelRows.some((row) => row.lineItem === "Insurance")).toBe(true);
  });
});
