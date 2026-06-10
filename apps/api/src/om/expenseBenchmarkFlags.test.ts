import { describe, expect, it } from "vitest";
import type { OmAuthoritativeSnapshot } from "@re-sourcing/contracts";
import type { ExpenseBenchmarkRow } from "@re-sourcing/db";
import {
  buildExpenseBenchmarkFlags,
  buildTaxVsAssessmentFlag,
  buildingSizeBracketForUnits,
  classifyExpenseLines,
} from "./expenseBenchmarkFlags.js";

function snapshotWith(
  expenses: Array<{ lineItem: string; amount: number }>,
  operatingExpenses?: number | null
): OmAuthoritativeSnapshot {
  return {
    runId: "run-1",
    sourceDocumentId: null,
    extractionMethod: "test",
    propertyInfo: { totalUnits: 10 },
    rentRoll: null,
    incomeStatement: null,
    expenses: { expensesTable: expenses },
    currentFinancials: {
      grossRentalIncome: 300_000,
      effectiveGrossIncome: 290_000,
      operatingExpenses: operatingExpenses ?? null,
      noi: null,
    },
    coverage: null,
    validationFlags: [],
    promotedAt: null,
  } as unknown as OmAuthoritativeSnapshot;
}

function benchmarkRow(partial: Partial<ExpenseBenchmarkRow>): ExpenseBenchmarkRow {
  return {
    id: "bench-1",
    source: "nyc_rgb_ie_screening_2024",
    sourceYear: 2024,
    geography: "nyc",
    buildingSizeBracket: "all",
    buildingEra: "all",
    metric: "insurance",
    unitBasis: "per_unit_year",
    lowValue: 600,
    typicalValue: 1500,
    highValue: 3000,
    severityLow: "warning",
    severityHigh: "info",
    notes: null,
    effectiveDate: null,
    ...partial,
  };
}

describe("buildingSizeBracketForUnits", () => {
  it("maps unit counts to brackets", () => {
    expect(buildingSizeBracketForUnits(null)).toBe("all");
    expect(buildingSizeBracketForUnits(8)).toBe("1_10");
    expect(buildingSizeBracketForUnits(15)).toBe("11_19");
    expect(buildingSizeBracketForUnits(48)).toBe("20_99");
    expect(buildingSizeBracketForUnits(150)).toBe("100_plus");
  });
});

describe("classifyExpenseLines", () => {
  it("assigns each line to one category and totals annual amounts", () => {
    const { byMetric, totalAnnual } = classifyExpenseLines(
      snapshotWith([
        { lineItem: "Real Estate Taxes", amount: 42_000 },
        { lineItem: "Insurance", amount: 9_000 },
        { lineItem: "Water & Sewer", amount: 8_000 },
        { lineItem: "Fuel", amount: 7_000 },
        { lineItem: "Repairs and Maintenance", amount: 12_000 },
        { lineItem: "Miscellaneous", amount: 2_000 },
      ])
    );
    expect(byMetric.get("taxes")).toBe(42_000);
    expect(byMetric.get("insurance")).toBe(9_000);
    expect(byMetric.get("utilities")).toBe(15_000);
    expect(byMetric.get("repairs_maintenance")).toBe(12_000);
    expect(totalAnnual).toBe(80_000);
  });
});

describe("buildExpenseBenchmarkFlags", () => {
  it("flags an understated line below the screening band", () => {
    const flags = buildExpenseBenchmarkFlags({
      snapshot: snapshotWith([{ lineItem: "Insurance", amount: 3_000 }]),
      unitCount: 10,
      egiAnnual: 290_000,
      benchmarks: [benchmarkRow({})],
    });
    const insurance = flags.find((flag) => flag.field === "insurance");
    expect(insurance).toBeDefined();
    expect(insurance!.severity).toBe("warning");
    expect(insurance!.message).toContain("$300/unit/yr is below");
    expect(insurance!.message).toContain("underwrite to ~$1,500/unit/yr");
  });

  it("flags a heavy line above the band with the high severity", () => {
    const flags = buildExpenseBenchmarkFlags({
      snapshot: snapshotWith([{ lineItem: "Insurance", amount: 40_000 }]),
      unitCount: 10,
      egiAnnual: 290_000,
      benchmarks: [benchmarkRow({})],
    });
    const insurance = flags.find((flag) => flag.field === "insurance");
    expect(insurance).toBeDefined();
    expect(insurance!.severity).toBe("info");
    expect(insurance!.message).toContain("above the screening range");
  });

  it("stays quiet inside the band and without a unit count", () => {
    const inBand = buildExpenseBenchmarkFlags({
      snapshot: snapshotWith([{ lineItem: "Insurance", amount: 15_000 }]),
      unitCount: 10,
      egiAnnual: 290_000,
      benchmarks: [benchmarkRow({})],
    });
    expect(inBand.filter((flag) => flag.field === "insurance")).toHaveLength(0);

    const noUnits = buildExpenseBenchmarkFlags({
      snapshot: snapshotWith([{ lineItem: "Insurance", amount: 3_000 }]),
      unitCount: null,
      egiAnnual: 290_000,
      benchmarks: [benchmarkRow({})],
    });
    expect(noUnits.filter((flag) => flag.field === "insurance")).toHaveLength(0);
  });

  it("checks the stated total opex per unit", () => {
    const flags = buildExpenseBenchmarkFlags({
      snapshot: snapshotWith([{ lineItem: "Insurance", amount: 15_000 }], 50_000),
      unitCount: 10,
      egiAnnual: 290_000,
      benchmarks: [
        benchmarkRow({}),
        benchmarkRow({ id: "bench-2", metric: "total_opex", lowValue: 7_200, typicalValue: 13_500, highValue: 24_000 }),
      ],
    });
    const total = flags.find((flag) => flag.field === "total_opex");
    expect(total).toBeDefined();
    expect(total!.message).toContain("$5,000/unit/yr is below");
  });

  it("evaluates pct_egi metrics against income", () => {
    const flags = buildExpenseBenchmarkFlags({
      snapshot: snapshotWith([{ lineItem: "Management Fee", amount: 2_900 }]),
      unitCount: 10,
      egiAnnual: 290_000,
      benchmarks: [
        benchmarkRow({ id: "bench-3", metric: "mgmt_admin", unitBasis: "pct_egi", lowValue: 3, typicalValue: 5, highValue: 9 }),
      ],
    });
    const mgmt = flags.find((flag) => flag.field === "mgmt_admin");
    expect(mgmt).toBeDefined();
    expect(mgmt!.message).toContain("1.0% of gross income is below");
  });
});

describe("buildTaxVsAssessmentFlag", () => {
  it("flags OM taxes far below the DOF-implied bill", () => {
    // Billable AV 500k × class 2 rate 12.502% = $62,510 implied.
    const flag = buildTaxVsAssessmentFlag({
      omTaxAnnual: 30_000,
      assessedTaxableValue: 500_000,
      taxCode: "2A",
    });
    expect(flag).not.toBeNull();
    expect(flag!.flagType).toBe("tax_vs_assessment");
    expect(flag!.severity).toBe("warning");
    expect(flag!.message).toContain("below the DOF-implied bill");
    expect(flag!.message).toContain("class 2");
  });

  it("flags OM taxes well above the implied bill as info", () => {
    const flag = buildTaxVsAssessmentFlag({
      omTaxAnnual: 90_000,
      assessedTaxableValue: 500_000,
      taxCode: "2",
    });
    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe("info");
    expect(flag!.message).toContain("above the DOF-implied bill");
  });

  it("returns null inside tolerance or with missing inputs", () => {
    expect(
      buildTaxVsAssessmentFlag({ omTaxAnnual: 60_000, assessedTaxableValue: 500_000, taxCode: "2" })
    ).toBeNull();
    expect(buildTaxVsAssessmentFlag({ omTaxAnnual: null, assessedTaxableValue: 500_000, taxCode: "2" })).toBeNull();
    expect(buildTaxVsAssessmentFlag({ omTaxAnnual: 60_000, assessedTaxableValue: null, taxCode: "2" })).toBeNull();
    expect(buildTaxVsAssessmentFlag({ omTaxAnnual: 60_000, assessedTaxableValue: 500_000, taxCode: null })).toBeNull();
  });
});
