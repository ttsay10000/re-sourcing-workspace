import { describe, expect, it } from "vitest";
import type { UserProfile } from "@re-sourcing/contracts";
import { computeUnderwritingProjection, resolveDossierAssumptions } from "./underwritingModel.js";
import { buildUnderwritingValidationFlags } from "./underwritingValidationFlags.js";

function profileWith(overrides: Partial<UserProfile>): UserProfile {
  return {
    id: "profile-flags",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    defaultPurchaseClosingCostPct: 0,
    defaultLtv: 70,
    defaultInterestRate: 6,
    defaultAmortization: 30,
    defaultHoldPeriodYears: 5,
    defaultExitCap: 6,
    defaultExitClosingCostPct: 2,
    defaultRentUplift: 0,
    defaultExpenseIncrease: 0,
    defaultManagementFee: 0,
    defaultVacancyPct: 0,
    defaultLeadTimeMonths: 0,
    defaultAnnualRentGrowthPct: 0,
    defaultAnnualOtherIncomeGrowthPct: 0,
    defaultAnnualExpenseGrowthPct: 0,
    defaultAnnualPropertyTaxGrowthPct: 0,
    defaultRecurringCapexAnnual: 0,
    defaultLoanFeePct: 0,
    ...overrides,
  } as UserProfile;
}

function buildProjection(params: {
  profile?: Partial<UserProfile>;
  purchasePrice?: number;
  currentGrossRent: number;
  currentNoi: number;
  expenseRows?: Array<{ lineItem: string; amount: number }>;
}) {
  const assumptions = resolveDossierAssumptions(
    profileWith(params.profile ?? {}),
    params.purchasePrice ?? 1_000_000,
    { occupancyTaxPct: 0 }
  );
  return computeUnderwritingProjection({
    assumptions,
    currentGrossRent: params.currentGrossRent,
    currentNoi: params.currentNoi,
    expenseRows: params.expenseRows,
  });
}

function flagTypes(flags: Array<{ flagType: string }>): string[] {
  return flags.map((flag) => flag.flagType);
}

describe("buildUnderwritingValidationFlags", () => {
  it("errors when operating cash flow cannot cover debt service", () => {
    // 700k loan at 6%/30yr is ~$50.4k/yr debt service; NOI of 40k => DSCR ~0.79.
    const projection = buildProjection({ currentGrossRent: 60_000, currentNoi: 40_000 });
    const flags = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: null,
      egiBasisAnnual: null,
      taxExpenseAnnual: null,
      unitCount: null,
    });
    const dscr = flags.find((flag) => flag.flagType === "dscr_below_floor");
    expect(dscr).toBeDefined();
    expect(dscr!.severity).toBe("error");
    expect(dscr!.message).toContain("does not cover debt service");
  });

  it("warns between 1.0x and 1.25x DSCR and stays quiet above 1.25x", () => {
    // NOI 55k vs ~50.4k debt service => DSCR ~1.09 (warning).
    const warningProjection = buildProjection({ currentGrossRent: 80_000, currentNoi: 55_000 });
    const warningFlags = buildUnderwritingValidationFlags({
      projection: warningProjection,
      entryCapRatePct: null,
      egiBasisAnnual: null,
      taxExpenseAnnual: null,
      unitCount: null,
    });
    const dscrWarning = warningFlags.find((flag) => flag.flagType === "dscr_below_floor");
    expect(dscrWarning).toBeDefined();
    expect(dscrWarning!.severity).toBe("warning");

    // NOI 80k => DSCR ~1.59 (clear).
    const clearProjection = buildProjection({ currentGrossRent: 110_000, currentNoi: 80_000 });
    const clearFlags = buildUnderwritingValidationFlags({
      projection: clearProjection,
      entryCapRatePct: null,
      egiBasisAnnual: null,
      taxExpenseAnnual: null,
      unitCount: null,
    });
    expect(flagTypes(clearFlags)).not.toContain("dscr_below_floor");
  });

  it("flags an exit cap meaningfully below the going-in cap", () => {
    const projection = buildProjection({
      profile: { defaultExitCap: 5 },
      currentGrossRent: 110_000,
      currentNoi: 80_000,
    });
    const flagged = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: 8,
      egiBasisAnnual: null,
      taxExpenseAnnual: null,
      unitCount: null,
    });
    const exitFlag = flagged.find((flag) => flag.flagType === "exit_cap_below_entry");
    expect(exitFlag).toBeDefined();
    expect(exitFlag!.message).toContain("cap-rate compression");

    // Within tolerance: entry 5.2 vs exit 5.0 stays quiet.
    const quiet = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: 5.2,
      egiBasisAnnual: null,
      taxExpenseAnnual: null,
      unitCount: null,
    });
    expect(flagTypes(quiet)).not.toContain("exit_cap_below_entry");
  });

  it("flags tax load outside the NYC band in both directions", () => {
    const projection = buildProjection({ currentGrossRent: 110_000, currentNoi: 80_000 });
    const heavy = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: null,
      egiBasisAnnual: 100_000,
      taxExpenseAnnual: 40_000,
      unitCount: null,
    });
    const heavyFlag = heavy.find((flag) => flag.flagType === "taxes_pct_egi_outlier");
    expect(heavyFlag).toBeDefined();
    expect(heavyFlag!.message).toContain("heavy tax load");

    const light = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: null,
      egiBasisAnnual: 100_000,
      taxExpenseAnnual: 8_000,
      unitCount: null,
    });
    const lightFlag = light.find((flag) => flag.flagType === "taxes_pct_egi_outlier");
    expect(lightFlag).toBeDefined();
    expect(lightFlag!.message).toContain("abated");

    const inBand = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: null,
      egiBasisAnnual: 100_000,
      taxExpenseAnnual: 20_000,
      unitCount: null,
    });
    expect(flagTypes(inBand)).not.toContain("taxes_pct_egi_outlier");
  });

  it("notes agency floors for vacancy and reserves", () => {
    const projection = buildProjection({
      profile: { defaultVacancyPct: 0, defaultRecurringCapexAnnual: 1_000 },
      currentGrossRent: 110_000,
      currentNoi: 80_000,
    });
    const flags = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: null,
      egiBasisAnnual: null,
      taxExpenseAnnual: null,
      unitCount: 10,
    });
    const vacancy = flags.find((flag) => flag.flagType === "vacancy_below_floor");
    expect(vacancy).toBeDefined();
    expect(vacancy!.severity).toBe("info");
    const reserves = flags.find((flag) => flag.flagType === "reserves_below_floor");
    expect(reserves).toBeDefined();
    expect(reserves!.message).toContain("$250/unit/yr");
  });

  it("folds projection model-shape warnings into flag form", () => {
    // No unit mix is available in these fixtures, so the projection itself
    // warns that 100% of rent was treated as free-market.
    const projection = buildProjection({ currentGrossRent: 110_000, currentNoi: 80_000 });
    expect(
      projection.warnings.some((warning) => warning.code === "property_mix_assumed_free_market")
    ).toBe(true);
    const flags = buildUnderwritingValidationFlags({
      projection,
      entryCapRatePct: null,
      egiBasisAnnual: null,
      taxExpenseAnnual: null,
      unitCount: null,
    });
    expect(flagTypes(flags)).toContain("property_mix_assumed_free_market");
  });
});

describe("computeUnderwritingProjection warnings", () => {
  it("warns when detailed expenses lack a tax line while tax growth outpaces expense growth", () => {
    const projection = buildProjection({
      profile: { defaultAnnualPropertyTaxGrowthPct: 6, defaultAnnualExpenseGrowthPct: 0 },
      currentGrossRent: 110_000,
      currentNoi: 80_000,
      expenseRows: [
        { lineItem: "Insurance", amount: 10_000 },
        { lineItem: "Repairs & maintenance", amount: 12_000 },
      ],
    });
    const warning = projection.warnings.find((entry) => entry.code === "tax_escalation_not_applied");
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("property-tax line");
  });

  it("does not warn when a tax line is present", () => {
    const projection = buildProjection({
      profile: { defaultAnnualPropertyTaxGrowthPct: 6, defaultAnnualExpenseGrowthPct: 0 },
      currentGrossRent: 110_000,
      currentNoi: 80_000,
      expenseRows: [
        { lineItem: "Real estate taxes", amount: 25_000 },
        { lineItem: "Insurance", amount: 10_000 },
      ],
    });
    expect(
      projection.warnings.some((entry) => entry.code === "tax_escalation_not_applied")
    ).toBe(false);
  });

  it("warns when the hold ends before stabilization", () => {
    const projection = buildProjection({
      profile: { defaultHoldPeriodYears: 1, defaultLeadTimeMonths: 2 },
      currentGrossRent: 110_000,
      currentNoi: 80_000,
    });
    const warning = projection.warnings.find(
      (entry) => entry.code === "stabilized_noi_includes_lease_up"
    );
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("lease-up drag");
  });
});
