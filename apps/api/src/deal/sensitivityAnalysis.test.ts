import { describe, expect, it } from "vitest";
import { computeUnderwritingProjection, resolveDossierAssumptions } from "./underwritingModel.js";
import { buildSensitivityAnalyses } from "./sensitivityAnalysis.js";

describe("sensitivityAnalysis", () => {
  it("builds one-way sensitivity ranges including a sale-cap-rate IRR table", () => {
    const assumptions = resolveDossierAssumptions(
      {
        id: "profile-1",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        defaultPurchaseClosingCostPct: 3,
        defaultLtv: 70,
        defaultInterestRate: 6,
        defaultAmortization: 30,
        defaultHoldPeriodYears: 5,
        defaultExitCap: 6,
        defaultExitClosingCostPct: 2,
        defaultRentUplift: 15,
        defaultExpenseIncrease: 5,
        defaultManagementFee: 5,
      },
      1_000_000
    );

    const baseProjection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent: 120_000,
      currentNoi: 80_000,
    });

    const sensitivities = buildSensitivityAnalyses({
      assumptions,
      currentGrossRent: 120_000,
      currentNoi: 80_000,
      baseProjection,
    });

    expect(sensitivities).toHaveLength(3);
    expect(sensitivities[0]?.scenarios).toHaveLength(5);
    expect(sensitivities[1]?.scenarios).toHaveLength(4);
    expect(sensitivities[1]?.key).toBe("management_fee");
    expect(sensitivities[2]?.key).toBe("exit_cap_rate");
    expect(sensitivities[2]?.scenarios.map((scenario) => scenario.valuePct)).toEqual([5, 5.5, 6.5, 7]);
    expect(sensitivities[0]?.ranges.irrPct.max).toBeGreaterThan(sensitivities[0]?.ranges.irrPct.min ?? 0);
    expect(sensitivities[1]?.ranges.year1CashOnCashReturn.min).toBeLessThan(
      sensitivities[1]?.ranges.year1CashOnCashReturn.max ?? 1
    );
    expect(sensitivities[1]?.ranges.year1EquityYield?.min).toBeLessThan(
      sensitivities[1]?.ranges.year1EquityYield?.max ?? 1
    );
    expect((sensitivities[2]?.scenarios[0]?.irrPct ?? 0)).toBeGreaterThan(
      sensitivities[2]?.scenarios[3]?.irrPct ?? 0
    );
    expect((sensitivities[2]?.scenarios[0]?.exitPropertyValue ?? 0)).toBeGreaterThan(
      sensitivities[2]?.scenarios[3]?.exitPropertyValue ?? 0
    );
  });
});
