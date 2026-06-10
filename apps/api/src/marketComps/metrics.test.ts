import { describe, expect, it } from "vitest";
import {
  aggregateMetric,
  buildOperatingMetricsRow,
  categorizeExpenseLine,
  unitTypeKeyForBeds,
  type OperatingMetricsSource,
} from "./metrics.js";

function source(overrides: Partial<OperatingMetricsSource> = {}): OperatingMetricsSource {
  return {
    propertyId: "p1",
    address: "123 Main St",
    neighborhoodRaw: "Chelsea",
    borough: "Manhattan",
    units: 10,
    gsf: 8000,
    yearBuilt: 1925,
    propertyType: "multifamily",
    askingPrice: 5_000_000,
    signalCapRatePct: null,
    signalPricePsf: null,
    signalPricePerUnit: null,
    signalExpenseRatioPct: null,
    signalNoi: null,
    effectiveGrossIncome: 400_000,
    grossRentalIncome: 390_000,
    otherIncome: 10_000,
    reportedOccupancyPct: 95,
    reportedVacancyPct: null,
    totalExpenses: 150_000,
    operatingExpensesFallback: null,
    noiReported: null,
    rentRoll: [],
    expenseLines: [],
    ...overrides,
  };
}

describe("buildOperatingMetricsRow", () => {
  it("computes per-unit, PSF, ratio, and yield metrics from OM income/expenses", () => {
    const row = buildOperatingMetricsRow(source());

    expect(row.revenue).toBe(400_000);
    expect(row.revenuePerUnit).toBe(40_000);
    expect(row.revenuePsf).toBe(50);
    expect(row.expensePerUnit).toBe(15_000);
    expect(row.noi).toBe(250_000);
    expect(row.noiPerUnit).toBe(25_000);
    expect(row.noiMarginPct).toBe(62.5);
    expect(row.expenseRatioPct).toBe(37.5);
    expect(row.capRatePct).toBe(5); // 250k / 5M
    expect(row.pricePerUnit).toBe(500_000);
    expect(row.pricePsf).toBe(625);
    expect(row.occupancyPct).toBe(95);
  });

  it("prefers stored signal values over derived ones", () => {
    const row = buildOperatingMetricsRow(
      source({ signalCapRatePct: 5.8, signalPricePsf: 700, signalExpenseRatioPct: 41.2 })
    );
    expect(row.capRatePct).toBe(5.8);
    expect(row.pricePsf).toBe(700);
    expect(row.expenseRatioPct).toBe(41.2);
  });

  it("buckets rent roll by bedroom count with median rents and annual rent PSF", () => {
    const row = buildOperatingMetricsRow(
      source({
        rentRoll: [
          { beds: 0, monthlyRent: 2400, sqft: 450 },
          { beds: 1, monthlyRent: 3000, sqft: 600 },
          { beds: 1, monthlyRent: 3400, sqft: 650 },
          { beds: 2, annualRent: 60_000 },
          { beds: 3, monthlyRent: 6200 },
          { beds: 4, monthlyRent: 7000 },
          { unitCategory: "commercial", monthlyRent: 9000 },
        ],
      })
    );

    expect(row.rentByUnitType.studio).toMatchObject({ monthlyRent: 2400, unitCount: 1 });
    expect(row.rentByUnitType.br1).toMatchObject({ monthlyRent: 3200, unitCount: 2 });
    expect(row.rentByUnitType.br2).toMatchObject({ monthlyRent: 5000, unitCount: 1 });
    // 3BR and 4BR pool into 3+.
    expect(row.rentByUnitType.br3plus).toMatchObject({ monthlyRent: 6600, unitCount: 2 });
    // Commercial space stays out of residential rent buckets.
    const bucketUnits = Object.values(row.rentByUnitType).reduce((sum, bucket) => sum + bucket.unitCount, 0);
    expect(bucketUnits).toBe(6);
    // Studio annual rent PSF: 2400×12/450 = 64.
    expect(row.rentByUnitType.studio?.rentPsf).toBe(64);
  });

  it("derives occupancy from rent-roll statuses when the OM reports none", () => {
    const row = buildOperatingMetricsRow(
      source({
        reportedOccupancyPct: null,
        rentRoll: [
          { beds: 1, monthlyRent: 3000, occupied: true },
          { beds: 1, monthlyRent: 3000, occupied: "Occupied" },
          { beds: 1, monthlyRent: 0, occupied: "Vacant" },
          { beds: 2, monthlyRent: 4000, tenantStatus: "Leased" },
        ],
      })
    );
    expect(row.occupancyPct).toBe(75);
  });

  it("sums expense lines into canonical categories", () => {
    const row = buildOperatingMetricsRow(
      source({
        expenseLines: [
          { lineItem: "Real Estate Taxes", amount: 60_000 },
          { lineItem: "Insurance", amount: 12_000 },
          { lineItem: "Water & Sewer", amount: 8_000 },
          { lineItem: "Electric & Gas", amount: 9_000 },
          { lineItem: "Repairs", amount: 7_000 },
          { lineItem: "Superintendent", amount: 18_000 },
          { lineItem: "Management", amount: 14_000 },
          { lineItem: "Misc admin", amount: 2_000 },
        ],
      })
    );

    expect(row.expenseByCategory.taxes).toBe(60_000);
    expect(row.expenseByCategory.insurance).toBe(12_000);
    expect(row.expenseByCategory.water_sewer).toBe(8_000);
    expect(row.expenseByCategory.utilities).toBe(9_000);
    expect(row.expenseByCategory.repairs_maintenance).toBe(7_000);
    expect(row.expenseByCategory.payroll).toBe(18_000);
    expect(row.expenseByCategory.management).toBe(14_000);
    expect(row.expenseByCategory.other).toBe(2_000);
  });

  it("handles sparse rows without fabricating numbers", () => {
    const row = buildOperatingMetricsRow(
      source({
        effectiveGrossIncome: null,
        grossRentalIncome: null,
        otherIncome: null,
        totalExpenses: null,
        askingPrice: null,
        reportedOccupancyPct: null,
        units: null,
        gsf: null,
      })
    );
    expect(row.revenue).toBeNull();
    expect(row.noi).toBeNull();
    expect(row.capRatePct).toBeNull();
    expect(row.revenuePerUnit).toBeNull();
    expect(row.occupancyPct).toBeNull();
  });
});

describe("aggregateMetric", () => {
  it("returns dispersion stats and subject variance vs median", () => {
    const stat = aggregateMetric([20_000, 25_000, 30_000, null, 35_000, 40_000], 33_000);

    expect(stat.count).toBe(5);
    expect(stat.median).toBe(30_000);
    expect(stat.mean).toBe(30_000);
    expect(stat.p25).toBe(25_000);
    expect(stat.p75).toBe(35_000);
    expect(stat.min).toBe(20_000);
    expect(stat.max).toBe(40_000);
    expect(stat.varianceAbs).toBe(3_000);
    expect(stat.variancePct).toBeCloseTo(10);
  });

  it("yields nulls on an empty set", () => {
    const stat = aggregateMetric([], 100);
    expect(stat.count).toBe(0);
    expect(stat.median).toBeNull();
    expect(stat.variancePct).toBeNull();
  });
});

describe("helpers", () => {
  it("unitTypeKeyForBeds buckets correctly", () => {
    expect(unitTypeKeyForBeds(0)).toBe("studio");
    expect(unitTypeKeyForBeds(1)).toBe("br1");
    expect(unitTypeKeyForBeds(2)).toBe("br2");
    expect(unitTypeKeyForBeds(3)).toBe("br3plus");
    expect(unitTypeKeyForBeds(5)).toBe("br3plus");
    expect(unitTypeKeyForBeds(null)).toBeNull();
  });

  it("categorizeExpenseLine maps common labels", () => {
    expect(categorizeExpenseLine("RE Taxes")).toBe("taxes");
    expect(categorizeExpenseLine("Fuel / Heating Oil")).toBe("utilities");
    expect(categorizeExpenseLine("Porter wages")).toBe("payroll");
    expect(categorizeExpenseLine("Legal & Accounting")).toBe("other");
  });
});
