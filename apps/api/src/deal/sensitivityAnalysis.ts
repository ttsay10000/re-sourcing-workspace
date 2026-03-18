import {
  computeBlendedRentUpliftPct,
  computeUnderwritingProjection,
  type ResolvedDossierAssumptions,
} from "./underwritingModel.js";

export type SensitivityKey = "rental_uplift" | "expense_increase" | "management_fee" | "exit_cap_rate";

export interface SensitivityScenario {
  valuePct: number;
  irrPct: number | null;
  year1CashOnCashReturn: number | null;
  year1EquityYield: number | null;
  stabilizedNoi: number;
  annualOperatingCashFlow: number;
  exitPropertyValue: number;
  netProceedsToEquity: number;
}

export interface SensitivityMetricRange {
  min: number | null;
  max: number | null;
}

export interface SensitivityAnalysis {
  key: SensitivityKey;
  title: string;
  inputLabel: string;
  scenarios: SensitivityScenario[];
  baseCase: {
    valuePct: number | null;
    irrPct: number | null;
    year1CashOnCashReturn: number | null;
    year1EquityYield: number | null;
  };
  ranges: {
    irrPct: SensitivityMetricRange;
    year1CashOnCashReturn: SensitivityMetricRange;
    year1EquityYield: SensitivityMetricRange;
  };
}

export const RENTAL_UPLIFT_SENSITIVITY_VALUES = [50, 60, 70, 80, 90];
export const EXPENSE_INCREASE_SENSITIVITY_VALUES = [10, 17.5, 25, 30];
export const MANAGEMENT_FEE_SENSITIVITY_VALUES = [6, 8, 10, 12];
export const EXIT_CAP_RATE_SENSITIVITY_OFFSETS_BPS = [-100, -50, 50, 100];
const MIN_EXIT_CAP_RATE_PCT = 0.25;

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function range(values: Array<number | null | undefined>): SensitivityMetricRange {
  const numeric = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (numeric.length === 0) return { min: null, max: null };
  return { min: Math.min(...numeric), max: Math.max(...numeric) };
}

function scenarioFromProjection(valuePct: number, projection: ReturnType<typeof computeUnderwritingProjection>): SensitivityScenario {
  return {
    valuePct,
    irrPct: projection.returns.irr,
    year1CashOnCashReturn: projection.returns.year1CashOnCashReturn,
    year1EquityYield: projection.returns.year1EquityYield,
    stabilizedNoi: projection.operating.stabilizedNoi,
    annualOperatingCashFlow: projection.cashFlows.annualOperatingCashFlow,
    exitPropertyValue: projection.exit.exitPropertyValue,
    netProceedsToEquity: projection.exit.netProceedsToEquity,
  };
}

function buildExitCapRateSensitivityValues(baseExitCapPct: number): number[] {
  const values = new Set<number>();
  for (const offsetBps of EXIT_CAP_RATE_SENSITIVITY_OFFSETS_BPS) {
    const adjustedValue = roundPct(
      Math.max(MIN_EXIT_CAP_RATE_PCT, baseExitCapPct + offsetBps / 100)
    );
    if (Math.abs(adjustedValue - baseExitCapPct) < 0.0001) continue;
    values.add(adjustedValue);
  }
  return Array.from(values).sort((left, right) => left - right);
}

export function buildSensitivityAnalyses(input: {
  assumptions: ResolvedDossierAssumptions;
  currentGrossRent: number | null;
  currentNoi: number | null;
  currentOtherIncome?: number | null;
  currentExpensesTotal?: number | null;
  expenseRows?: Array<{ lineItem: string; amount: number }> | null;
  conservativeProjectedLeaseUpRent?: number | null;
  baseProjection: ReturnType<typeof computeUnderwritingProjection>;
}): SensitivityAnalysis[] {
  const {
    assumptions,
    currentGrossRent,
    currentNoi,
    currentOtherIncome,
    currentExpensesTotal,
    expenseRows,
    conservativeProjectedLeaseUpRent,
    baseProjection,
  } = input;

  const rentalUpliftScenarios = RENTAL_UPLIFT_SENSITIVITY_VALUES.map((valuePct) =>
    scenarioFromProjection(
      valuePct,
      computeUnderwritingProjection({
        assumptions: {
          ...assumptions,
          operating: {
            ...assumptions.operating,
            rentUpliftPct: valuePct,
            blendedRentUpliftPct: computeBlendedRentUpliftPct(valuePct, assumptions.propertyMix),
          },
        },
        currentGrossRent,
        currentNoi,
        currentOtherIncome,
        currentExpensesTotal,
        expenseRows,
        conservativeProjectedLeaseUpRent,
      })
    )
  );

  const expenseIncreaseScenarios = EXPENSE_INCREASE_SENSITIVITY_VALUES.map((valuePct) =>
    scenarioFromProjection(
      valuePct,
      computeUnderwritingProjection({
        assumptions: {
          ...assumptions,
          operating: {
            ...assumptions.operating,
            expenseIncreasePct: valuePct,
          },
        },
        currentGrossRent,
        currentNoi,
        currentOtherIncome,
        currentExpensesTotal,
        expenseRows,
        conservativeProjectedLeaseUpRent,
      })
    )
  );

  const managementFeeScenarios = MANAGEMENT_FEE_SENSITIVITY_VALUES.map((valuePct) =>
    scenarioFromProjection(
      valuePct,
      computeUnderwritingProjection({
        assumptions: {
          ...assumptions,
          operating: {
            ...assumptions.operating,
            managementFeePct: valuePct,
          },
        },
        currentGrossRent,
        currentNoi,
        currentOtherIncome,
        currentExpensesTotal,
        expenseRows,
        conservativeProjectedLeaseUpRent,
      })
    )
  );

  const exitCapRateScenarios = buildExitCapRateSensitivityValues(assumptions.exit.exitCapPct).map(
    (valuePct) =>
      scenarioFromProjection(
        valuePct,
        computeUnderwritingProjection({
          assumptions: {
            ...assumptions,
            exit: {
              ...assumptions.exit,
              exitCapPct: valuePct,
            },
          },
          currentGrossRent,
          currentNoi,
          currentOtherIncome,
          currentExpensesTotal,
          expenseRows,
          conservativeProjectedLeaseUpRent,
        })
      )
  );

  return [
    {
      key: "rental_uplift",
      title: "Rental Uplift Sensitivity",
      inputLabel: "Rental uplift (%)",
      scenarios: rentalUpliftScenarios,
      baseCase: {
        valuePct: assumptions.operating.rentUpliftPct,
        irrPct: baseProjection.returns.irr,
        year1CashOnCashReturn: baseProjection.returns.year1CashOnCashReturn,
        year1EquityYield: baseProjection.returns.year1EquityYield,
      },
      ranges: {
        irrPct: range(rentalUpliftScenarios.map((scenario) => scenario.irrPct)),
        year1CashOnCashReturn: range(
          rentalUpliftScenarios.map((scenario) => scenario.year1CashOnCashReturn)
        ),
        year1EquityYield: range(
          rentalUpliftScenarios.map((scenario) => scenario.year1EquityYield)
        ),
      },
    },
    {
      key: "expense_increase",
      title: "Expense Increase Sensitivity",
      inputLabel: "Expense increase (%)",
      scenarios: expenseIncreaseScenarios,
      baseCase: {
        valuePct: assumptions.operating.expenseIncreasePct,
        irrPct: baseProjection.returns.irr,
        year1CashOnCashReturn: baseProjection.returns.year1CashOnCashReturn,
        year1EquityYield: baseProjection.returns.year1EquityYield,
      },
      ranges: {
        irrPct: range(expenseIncreaseScenarios.map((scenario) => scenario.irrPct)),
        year1CashOnCashReturn: range(
          expenseIncreaseScenarios.map((scenario) => scenario.year1CashOnCashReturn)
        ),
        year1EquityYield: range(
          expenseIncreaseScenarios.map((scenario) => scenario.year1EquityYield)
        ),
      },
    },
    {
      key: "management_fee",
      title: "Management Fee Sensitivity",
      inputLabel: "Management fee (%)",
      scenarios: managementFeeScenarios,
      baseCase: {
        valuePct: assumptions.operating.managementFeePct,
        irrPct: baseProjection.returns.irr,
        year1CashOnCashReturn: baseProjection.returns.year1CashOnCashReturn,
        year1EquityYield: baseProjection.returns.year1EquityYield,
      },
      ranges: {
        irrPct: range(managementFeeScenarios.map((scenario) => scenario.irrPct)),
        year1CashOnCashReturn: range(
          managementFeeScenarios.map((scenario) => scenario.year1CashOnCashReturn)
        ),
        year1EquityYield: range(
          managementFeeScenarios.map((scenario) => scenario.year1EquityYield)
        ),
      },
    },
    {
      key: "exit_cap_rate",
      title: "Sale Cap Rate Sensitivity",
      inputLabel: "Sale cap rate (%)",
      scenarios: exitCapRateScenarios,
      baseCase: {
        valuePct: assumptions.exit.exitCapPct,
        irrPct: baseProjection.returns.irr,
        year1CashOnCashReturn: baseProjection.returns.year1CashOnCashReturn,
        year1EquityYield: baseProjection.returns.year1EquityYield,
      },
      ranges: {
        irrPct: range(exitCapRateScenarios.map((scenario) => scenario.irrPct)),
        year1CashOnCashReturn: range(
          exitCapRateScenarios.map((scenario) => scenario.year1CashOnCashReturn)
        ),
        year1EquityYield: range(
          exitCapRateScenarios.map((scenario) => scenario.year1EquityYield)
        ),
      },
    },
  ];
}
