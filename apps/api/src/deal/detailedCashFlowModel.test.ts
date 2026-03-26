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
});
