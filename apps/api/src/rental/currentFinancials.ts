import type {
  OmAnalysis,
  PropertyDetails,
  RentalFinancialsFromLlm,
} from "@re-sourcing/contracts";

export interface ResolvedCurrentFinancials {
  noi: number | null;
  grossRentalIncome: number | null;
  otherIncome: number | null;
  vacancyLoss: number | null;
  effectiveGrossIncome: number | null;
  operatingExpenses: number | null;
}

export interface ResolvedExpenseRow {
  lineItem: string;
  amount: number;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function roundCurrency(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function nonNegative(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function sumNumbers(...values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0);
}

function approxEqual(left: number | null, right: number | null, tolerance = 1_500): boolean {
  return left != null && right != null && Math.abs(left - right) <= tolerance;
}

export function resolveCurrentFinancialsFromOmAnalysis(
  omAnalysis: OmAnalysis | null | undefined,
  fromLlm?: RentalFinancialsFromLlm | null
): ResolvedCurrentFinancials {
  const om = omAnalysis ?? null;
  const income = asRecord(om?.income);
  const expenses = asRecord(om?.expenses);
  const revenue = asRecord(om?.revenueComposition);
  const valuation = asRecord(om?.valuationMetrics);
  const financial = asRecord(om?.financialMetrics);
  const ui = asRecord(om?.uiFinancialSummary);

  const noi = roundCurrency(
    firstNumber(
      om?.noiReported,
      income?.NOI,
      valuation?.NOI,
      financial?.noi,
      ui?.noi,
      fromLlm?.noi
    )
  );
  const otherIncome = roundCurrency(
    nonNegative(
      firstNumber(
        income?.otherIncome,
        income?.otherAnnualIncome,
        income?.miscIncome,
        income?.commercialReimbursements,
        income?.commercialRecoveries,
        revenue?.otherIncomeAnnual,
        revenue?.otherIncome
      )
    )
  );
  const vacancyLoss = roundCurrency(
    nonNegative(
      firstNumber(
        income?.vacancyLoss,
        income?.vacancyCollectionLoss,
        income?.vacancyAndCollectionLoss
      )
    )
  );

  const componentGrossPotential = sumNumbers(
    nonNegative(firstNumber(income?.grossRentResidentialPotential, revenue?.residentialAnnualRent)),
    nonNegative(firstNumber(income?.grossRentCommercialPotential, revenue?.commercialAnnualRent))
  );
  const directGrossPotential = nonNegative(
    firstNumber(
      income?.grossRentActual,
      income?.grossRentPotential,
      income?.grossIncome,
      income?.grossAnnualIncome
    )
  );
  const effectiveGrossIncome = roundCurrency(
    nonNegative(
      firstNumber(
        income?.effectiveGrossIncome,
        income?.effectiveGrossRent,
        componentGrossPotential != null && vacancyLoss != null
          ? componentGrossPotential + (otherIncome ?? 0) - vacancyLoss
          : null,
        directGrossPotential != null && vacancyLoss != null
          ? directGrossPotential + (otherIncome ?? 0) - vacancyLoss
          : null
      )
    )
  );

  const summaryGross = roundCurrency(
    nonNegative(firstNumber(ui?.grossRent, fromLlm?.grossRentTotal))
  );
  const explicitExpenseTotal = roundCurrency(
    nonNegative(firstNumber(expenses?.totalExpenses, fromLlm?.totalExpenses))
  );
  const summaryLooksLikeEffectiveGrossIncome =
    approxEqual(summaryGross, effectiveGrossIncome) ||
    approxEqual(summaryGross, noi != null && explicitExpenseTotal != null ? noi + explicitExpenseTotal : null);

  const grossRentalIncome = roundCurrency(
    nonNegative(
      componentGrossPotential ??
        directGrossPotential ??
        (effectiveGrossIncome != null && vacancyLoss != null
          ? effectiveGrossIncome - (otherIncome ?? 0) + vacancyLoss
          : null) ??
        (summaryLooksLikeEffectiveGrossIncome && summaryGross != null && vacancyLoss != null
          ? summaryGross - (otherIncome ?? 0) + vacancyLoss
          : summaryGross)
    )
  );
  const operatingExpenses = roundCurrency(
    nonNegative(
      explicitExpenseTotal ??
        (effectiveGrossIncome != null && noi != null ? effectiveGrossIncome - noi : null) ??
        (summaryLooksLikeEffectiveGrossIncome && summaryGross != null && noi != null
          ? summaryGross - noi
          : null)
    )
  );

  return {
    noi,
    grossRentalIncome,
    otherIncome,
    vacancyLoss,
    effectiveGrossIncome,
    operatingExpenses,
  };
}

export function resolveExpenseRowsFromOmAnalysis(
  omAnalysis: OmAnalysis | null | undefined
): ResolvedExpenseRow[] {
  const expenseTable = (omAnalysis?.expenses as { expensesTable?: Array<{ lineItem?: unknown; amount?: unknown }> } | null)
    ?.expensesTable;
  if (!Array.isArray(expenseTable)) return [];
  return expenseTable
    .map((row) => ({
      lineItem: typeof row?.lineItem === "string" && row.lineItem.trim().length > 0 ? row.lineItem.trim() : "—",
      amount: toFiniteNumber(row?.amount) ?? 0,
    }))
    .filter((row) => Number.isFinite(row.amount) && row.amount >= 0);
}

export function resolveCurrentFinancialsFromDetails(
  details: PropertyDetails | null | undefined
): ResolvedCurrentFinancials {
  return resolveCurrentFinancialsFromOmAnalysis(
    details?.rentalFinancials?.omAnalysis ?? null,
    details?.rentalFinancials?.fromLlm ?? null
  );
}

export function resolveExpenseRowsFromDetails(
  details: PropertyDetails | null | undefined
): ResolvedExpenseRow[] {
  return resolveExpenseRowsFromOmAnalysis(details?.rentalFinancials?.omAnalysis ?? null);
}
