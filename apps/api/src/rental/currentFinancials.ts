import type {
  OmAuthoritativeSnapshot,
  OmAnalysis,
  PropertyDetails,
  RentalFinancialsFromLlm,
} from "@re-sourcing/contracts";
import { getAuthoritativeOmSnapshot } from "../om/authoritativeOm.js";
import { sanitizeExpenseTableRows } from "./omAnalysisUtils.js";

export interface ResolvedCurrentFinancials {
  noi: number | null;
  grossRentalIncome: number | null;
  otherIncome: number | null;
  vacancyLoss: number | null;
  effectiveGrossIncome: number | null;
  operatingExpenses: number | null;
  rentBasis: "gross_before_vacancy" | "effective_after_vacancy" | "unknown";
  assumedLongTermOccupancyPct: number | null;
  reportedOccupancyPct: number | null;
  reportedVacancyPct: number | null;
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

function normalizePct(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return null;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeRentBasis(value: unknown): ResolvedCurrentFinancials["rentBasis"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  if (normalized === "gross_before_vacancy" || normalized === "gross_potential") {
    return "gross_before_vacancy";
  }
  if (
    normalized === "effective_after_vacancy" ||
    normalized === "actual_effective" ||
    normalized === "effective_gross_income"
  ) {
    return "effective_after_vacancy";
  }
  if (normalized === "unknown") return "unknown";
  return null;
}

function deriveRentBasis(params: {
  explicitBasis: ResolvedCurrentFinancials["rentBasis"] | null;
  vacancyLoss: number | null;
  componentGrossPotential: number | null;
  directGrossPotential: number | null;
  effectiveGrossIncome: number | null;
  summaryLooksLikeEffectiveGrossIncome?: boolean;
}): ResolvedCurrentFinancials["rentBasis"] {
  if (params.explicitBasis) return params.explicitBasis;
  if (
    params.vacancyLoss != null ||
    params.componentGrossPotential != null ||
    params.directGrossPotential != null
  ) {
    return "gross_before_vacancy";
  }
  if (params.effectiveGrossIncome != null || params.summaryLooksLikeEffectiveGrossIncome) {
    return "effective_after_vacancy";
  }
  return "unknown";
}

function assumedLongTermOccupancyPct(params: {
  rentBasis: ResolvedCurrentFinancials["rentBasis"];
  reportedOccupancyPct: number | null;
  reportedVacancyPct: number | null;
}): number | null {
  if (params.rentBasis !== "effective_after_vacancy") return null;
  return (
    normalizePct(params.reportedOccupancyPct) ??
    (params.reportedVacancyPct != null ? Math.max(0, 100 - params.reportedVacancyPct) : null) ??
    97
  );
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
  const reportedOccupancyPct = normalizePct(
    firstNumber(
      income?.reportedOccupancyPct,
      income?.occupancyPct,
      income?.economicOccupancyPct,
      income?.physicalOccupancyPct
    )
  );
  const reportedVacancyPct = normalizePct(
    firstNumber(
      income?.reportedVacancyPct,
      income?.vacancyPct,
      income?.economicVacancyPct
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
  const rentBasis = deriveRentBasis({
    explicitBasis: normalizeRentBasis(income?.currentRentBasis ?? income?.rentBasis),
    vacancyLoss,
    componentGrossPotential,
    directGrossPotential,
    effectiveGrossIncome,
    summaryLooksLikeEffectiveGrossIncome,
  });

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
  const assumedOccupancyPct = assumedLongTermOccupancyPct({
    rentBasis,
    reportedOccupancyPct,
    reportedVacancyPct,
  });

  return {
    noi,
    grossRentalIncome,
    otherIncome,
    vacancyLoss,
    effectiveGrossIncome,
    operatingExpenses,
    rentBasis,
    assumedLongTermOccupancyPct: assumedOccupancyPct,
    reportedOccupancyPct,
    reportedVacancyPct,
  };
}

export function resolveCurrentFinancialsFromAuthoritativeSnapshot(
  snapshot: OmAuthoritativeSnapshot | null | undefined
): ResolvedCurrentFinancials {
  const current = asRecord(snapshot?.currentFinancials);
  const income = asRecord(snapshot?.incomeStatement);
  const expenses = asRecord(snapshot?.expenses);
  const revenue = asRecord(snapshot?.revenueComposition);

  const noi = roundCurrency(
    firstNumber(
      current?.noi,
      income?.reportedNoi,
      income?.reportedNOI,
      income?.noi,
      income?.NOI
    )
  );
  const otherIncome = roundCurrency(
    nonNegative(
      firstNumber(
        current?.otherIncome,
        income?.otherIncome,
        income?.other_income,
        income?.otherAnnualIncome,
        income?.other_annual_income,
        income?.miscIncome,
        income?.misc_income,
        revenue?.otherIncomeAnnual,
        revenue?.other_income_annual,
        revenue?.otherIncome,
        revenue?.other_income
      )
    )
  );
  const vacancyLoss = roundCurrency(
    nonNegative(
      firstNumber(
        current?.vacancyLoss,
        income?.vacancyLoss,
        income?.vacancy_loss,
        income?.vacancyCollectionLoss,
        income?.vacancy_collection_loss,
        income?.vacancyAndCollectionLoss,
        income?.vacancy_and_collection_loss
      )
    )
  );
  const reportedOccupancyPct = normalizePct(
    firstNumber(
      current?.reportedOccupancyPct,
      income?.reportedOccupancyPct,
      income?.occupancyPct,
      income?.occupancy_pct,
      income?.economicOccupancyPct,
      income?.economic_occupancy_pct,
      income?.physicalOccupancyPct,
      income?.physical_occupancy_pct
    )
  );
  const reportedVacancyPct = normalizePct(
    firstNumber(
      current?.reportedVacancyPct,
      income?.reportedVacancyPct,
      income?.vacancyPct,
      income?.vacancy_pct,
      income?.economicVacancyPct,
      income?.economic_vacancy_pct
    )
  );

  const componentGrossPotential = sumNumbers(
    nonNegative(
      firstNumber(
        income?.grossRentResidentialPotential,
        income?.gross_rent_residential_potential,
        revenue?.residentialAnnualRent,
        revenue?.residential_annual_rent
      )
    ),
    nonNegative(
      firstNumber(
        income?.grossRentCommercialPotential,
        income?.gross_rent_commercial_potential,
        revenue?.commercialAnnualRent,
        revenue?.commercial_annual_rent
      )
    )
  );
  const directGrossPotential = nonNegative(
    firstNumber(
      current?.grossRentalIncome,
      current?.gross_potential_rent,
      income?.grossPotentialRent,
      income?.gross_potential_rent,
      income?.grossRentPotential,
      income?.gross_rent_potential,
      income?.grossRentActual,
      income?.gross_rent_actual,
      income?.grossRentalIncome,
      income?.gross_rental_income,
      income?.grossIncome,
      income?.gross_income
    )
  );
  const effectiveGrossIncome = roundCurrency(
    nonNegative(
      firstNumber(
        current?.effectiveGrossIncome,
        income?.effectiveGrossIncome,
        income?.effective_gross_income,
        income?.effectiveGrossRent,
        income?.effective_gross_rent,
        componentGrossPotential != null && vacancyLoss != null
          ? componentGrossPotential + (otherIncome ?? 0) - vacancyLoss
          : null,
        directGrossPotential != null && vacancyLoss != null
          ? directGrossPotential + (otherIncome ?? 0) - vacancyLoss
          : null
      )
    )
  );

  const grossRentalIncome = roundCurrency(
    nonNegative(
      directGrossPotential ??
        componentGrossPotential ??
        (effectiveGrossIncome != null && vacancyLoss != null
          ? effectiveGrossIncome - (otherIncome ?? 0) + vacancyLoss
          : null)
    )
  );
  const explicitExpenseTotal = roundCurrency(
    nonNegative(
      firstNumber(
        current?.operatingExpenses,
        expenses?.totalExpenses,
        expenses?.total_expenses
      )
    )
  );
  const operatingExpenses = roundCurrency(
    nonNegative(
      explicitExpenseTotal ??
        (effectiveGrossIncome != null && noi != null ? effectiveGrossIncome - noi : null)
    )
  );
  const rentBasis = deriveRentBasis({
    explicitBasis: normalizeRentBasis(current?.rentBasis ?? income?.currentRentBasis ?? income?.rentBasis),
    vacancyLoss,
    componentGrossPotential,
    directGrossPotential,
    effectiveGrossIncome,
    summaryLooksLikeEffectiveGrossIncome: false,
  });
  const assumedOccupancyPct = assumedLongTermOccupancyPct({
    rentBasis,
    reportedOccupancyPct,
    reportedVacancyPct,
  });

  return {
    noi,
    grossRentalIncome,
    otherIncome,
    vacancyLoss,
    effectiveGrossIncome,
    operatingExpenses,
    rentBasis,
    assumedLongTermOccupancyPct: assumedOccupancyPct,
    reportedOccupancyPct,
    reportedVacancyPct,
  };
}

export function resolveExpenseRowsFromOmAnalysis(
  omAnalysis: OmAnalysis | null | undefined
): ResolvedExpenseRow[] {
  const expenseTable = sanitizeExpenseTableRows(
    (omAnalysis?.expenses as { expensesTable?: Array<{ lineItem?: unknown; amount?: unknown }> } | null)
      ?.expensesTable
  );
  if (!Array.isArray(expenseTable)) return [];
  return expenseTable
    .map((row) => ({
      lineItem: typeof row?.lineItem === "string" && row.lineItem.trim().length > 0 ? row.lineItem.trim() : "—",
      amount: toFiniteNumber(row?.amount) ?? 0,
    }))
    .filter((row) => Number.isFinite(row.amount) && row.amount >= 0);
}

export function resolveExpenseRowsFromAuthoritativeSnapshot(
  snapshot: OmAuthoritativeSnapshot | null | undefined
): ResolvedExpenseRow[] {
  const expenseTable = sanitizeExpenseTableRows(
    (snapshot?.expenses as { expensesTable?: Array<{ lineItem?: unknown; amount?: unknown }> } | null)
      ?.expensesTable
  );
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
  const authoritative = getAuthoritativeOmSnapshot(details);
  return authoritative
    ? resolveCurrentFinancialsFromAuthoritativeSnapshot(authoritative)
    : {
        noi: null,
        grossRentalIncome: null,
        otherIncome: null,
        vacancyLoss: null,
        effectiveGrossIncome: null,
        operatingExpenses: null,
        rentBasis: "unknown",
        assumedLongTermOccupancyPct: null,
        reportedOccupancyPct: null,
        reportedVacancyPct: null,
      };
}

export function resolveExpenseRowsFromDetails(
  details: PropertyDetails | null | undefined
): ResolvedExpenseRow[] {
  const authoritative = getAuthoritativeOmSnapshot(details);
  return authoritative ? resolveExpenseRowsFromAuthoritativeSnapshot(authoritative) : [];
}
