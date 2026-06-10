/**
 * Benchmark-driven expense validation: compares each OM expense line (and the
 * stated tax bill vs the DOF assessment) against seeded screening bands from
 * the expense_benchmarks table. Pure functions — callers load the benchmark
 * rows and property context.
 */
import type { OmAuthoritativeSnapshot, OmValidationFlag } from "@re-sourcing/contracts";
import type { ExpenseBenchmarkRow } from "@re-sourcing/db";
import { EXPECTED_EXPENSE_CATEGORIES } from "./omValidationFlags.js";

const FLAG_SOURCE = "expense_benchmarks";

/**
 * NYC statutory tax rates by class, % of billable assessed value (FY2025).
 * Update annually when DOF publishes new rates.
 */
export const NYC_TAX_CLASS_RATES_PCT: Record<"1" | "2" | "3" | "4", number> = {
  "1": 20.085,
  "2": 12.502,
  "3": 11.181,
  "4": 10.762,
};

/** OM-stated taxes below this share of the DOF-implied bill get flagged. */
export const TAX_VS_ASSESSMENT_LOW_RATIO = 0.8;
/** OM-stated taxes above this share of the DOF-implied bill get flagged. */
export const TAX_VS_ASSESSMENT_HIGH_RATIO = 1.25;

/** Map shared expense-category keys to benchmark metric names. */
const CATEGORY_TO_METRIC: Record<string, string> = {
  propertyTaxes: "taxes",
  insurance: "insurance",
  utilities: "utilities",
  repairsMaintenance: "repairs_maintenance",
  management: "mgmt_admin",
  payroll: "payroll",
  reserves: "reserves",
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function buildingSizeBracketForUnits(unitCount: number | null | undefined): string {
  if (unitCount == null || !Number.isFinite(unitCount) || unitCount <= 0) return "all";
  if (unitCount <= 10) return "1_10";
  if (unitCount <= 19) return "11_19";
  if (unitCount <= 99) return "20_99";
  return "100_plus";
}

interface ClassifiedExpenseTotals {
  byMetric: Map<string, number>;
  totalAnnual: number;
}

/**
 * Assign each expense line to the first matching shared category and sum
 * annual amounts per benchmark metric.
 */
export function classifyExpenseLines(snapshot: OmAuthoritativeSnapshot): ClassifiedExpenseTotals {
  const table = Array.isArray(snapshot.expenses?.expensesTable) ? snapshot.expenses.expensesTable : [];
  const byMetric = new Map<string, number>();
  let totalAnnual = 0;
  for (const row of table) {
    if (!row || typeof row !== "object") continue;
    const record = row as unknown as Record<string, unknown>;
    const lineItem = typeof record.lineItem === "string" ? record.lineItem : "";
    const amount = toFiniteNumber(record.amount);
    if (!lineItem.trim() || amount == null || amount <= 0) continue;
    totalAnnual += amount;
    const category = EXPECTED_EXPENSE_CATEGORIES.find((candidate) => candidate.pattern.test(lineItem));
    const metric = category ? CATEGORY_TO_METRIC[category.key] : null;
    if (!metric) continue;
    byMetric.set(metric, (byMetric.get(metric) ?? 0) + amount);
  }
  return { byMetric, totalAnnual };
}

/** Pick the most specific benchmark row for a metric+basis (repo pre-sorts by specificity). */
function benchmarkFor(
  benchmarks: ExpenseBenchmarkRow[],
  metric: string,
  unitBasis: ExpenseBenchmarkRow["unitBasis"]
): ExpenseBenchmarkRow | null {
  return benchmarks.find((row) => row.metric === metric && row.unitBasis === unitBasis) ?? null;
}

function toSeverity(value: string): OmValidationFlag["severity"] {
  return value === "error" || value === "warning" || value === "info" ? value : "warning";
}

export interface ExpenseBenchmarkFlagParams {
  snapshot: OmAuthoritativeSnapshot;
  unitCount: number | null;
  /** Effective gross income basis for pct_egi metrics (gross rent + other income works). */
  egiAnnual: number | null;
  benchmarks: ExpenseBenchmarkRow[];
  /** DOF billable assessed value (details.assessedTaxBeforeTotal) for the tax cross-check. */
  assessedTaxableValue?: number | null;
  /** NYC tax class code (details.taxCode), e.g. "1", "2", "2A", "4". */
  taxCode?: string | null;
}

const METRIC_LABELS: Record<string, string> = {
  taxes: "Property taxes",
  insurance: "Insurance",
  utilities: "Utilities",
  repairs_maintenance: "Repairs & maintenance",
  payroll: "Payroll",
  mgmt_admin: "Management & admin",
  total_opex: "Total operating expenses",
  reserves: "Reserves",
};

/**
 * Compare classified OM expense lines to the screening bands and emit flags
 * for understated (below low) and heavy (above high) lines, plus the
 * tax-vs-DOF-assessment cross-check.
 */
export function buildExpenseBenchmarkFlags(params: ExpenseBenchmarkFlagParams): OmValidationFlag[] {
  const { snapshot, unitCount, egiAnnual, benchmarks } = params;
  const flags: OmValidationFlag[] = [];
  const { byMetric, totalAnnual } = classifyExpenseLines(snapshot);
  const statedTotal = toFiniteNumber(snapshot.currentFinancials?.operatingExpenses);
  const totalsForCheck = new Map(byMetric);
  const effectiveTotal = statedTotal ?? (totalAnnual > 0 ? totalAnnual : null);
  if (effectiveTotal != null && effectiveTotal > 0) {
    totalsForCheck.set("total_opex", effectiveTotal);
  }

  for (const [metric, annualAmount] of totalsForCheck) {
    const label = METRIC_LABELS[metric] ?? metric;

    const perUnitRow = benchmarkFor(benchmarks, metric, "per_unit_year");
    if (perUnitRow && unitCount != null && unitCount > 0) {
      const perUnit = annualAmount / unitCount;
      const range =
        perUnitRow.lowValue != null && perUnitRow.highValue != null
          ? `${formatMoney(perUnitRow.lowValue)}–${formatMoney(perUnitRow.highValue)}/unit/yr`
          : null;
      const sourceLabel = `${perUnitRow.source}${perUnitRow.sourceYear ? ` ${perUnitRow.sourceYear}` : ""}`;
      if (perUnitRow.lowValue != null && perUnit < perUnitRow.lowValue) {
        flags.push({
          flagType: "expense_benchmark",
          field: metric,
          severity: toSeverity(perUnitRow.severityLow),
          brokerValue: Math.round(perUnit),
          externalValue: perUnitRow.lowValue,
          message: `${label} of ${formatMoney(perUnit)}/unit/yr is below the screening range (${range ?? `min ${formatMoney(perUnitRow.lowValue)}/unit/yr`}, ${sourceLabel}) — likely understated${
            perUnitRow.typicalValue != null ? `; underwrite to ~${formatMoney(perUnitRow.typicalValue)}/unit/yr` : ""
          }.`,
          source: FLAG_SOURCE,
          benchmark: { metric, basis: "per_unit_year", low: perUnitRow.lowValue, typical: perUnitRow.typicalValue, high: perUnitRow.highValue, notes: perUnitRow.notes },
        });
      } else if (perUnitRow.highValue != null && perUnit > perUnitRow.highValue) {
        flags.push({
          flagType: "expense_benchmark",
          field: metric,
          severity: toSeverity(perUnitRow.severityHigh),
          brokerValue: Math.round(perUnit),
          externalValue: perUnitRow.highValue,
          message: `${label} of ${formatMoney(perUnit)}/unit/yr is above the screening range (${range ?? `max ${formatMoney(perUnitRow.highValue)}/unit/yr`}, ${sourceLabel}) — verify one-time items or structural cost issues.`,
          source: FLAG_SOURCE,
          benchmark: { metric, basis: "per_unit_year", low: perUnitRow.lowValue, typical: perUnitRow.typicalValue, high: perUnitRow.highValue, notes: perUnitRow.notes },
        });
      }
    }

    const pctRow = benchmarkFor(benchmarks, metric, "pct_egi");
    if (pctRow && egiAnnual != null && egiAnnual > 0) {
      const pct = (annualAmount / egiAnnual) * 100;
      const sourceLabel = `${pctRow.source}${pctRow.sourceYear ? ` ${pctRow.sourceYear}` : ""}`;
      if (pctRow.lowValue != null && pct < pctRow.lowValue) {
        flags.push({
          flagType: "expense_benchmark",
          field: metric,
          severity: toSeverity(pctRow.severityLow),
          brokerValue: Math.round(pct * 10) / 10,
          externalValue: pctRow.lowValue,
          message: `${label} at ${(Math.round(pct * 10) / 10).toFixed(1)}% of gross income is below the ${pctRow.lowValue}–${pctRow.highValue ?? "?"}% screening band (${sourceLabel}) — likely understated.`,
          source: FLAG_SOURCE,
          benchmark: { metric, basis: "pct_egi", low: pctRow.lowValue, typical: pctRow.typicalValue, high: pctRow.highValue, notes: pctRow.notes },
        });
      } else if (pctRow.highValue != null && pct > pctRow.highValue) {
        flags.push({
          flagType: "expense_benchmark",
          field: metric,
          severity: toSeverity(pctRow.severityHigh),
          brokerValue: Math.round(pct * 10) / 10,
          externalValue: pctRow.highValue,
          message: `${label} at ${(Math.round(pct * 10) / 10).toFixed(1)}% of gross income is above the ${pctRow.lowValue ?? "?"}–${pctRow.highValue}% screening band (${sourceLabel}).`,
          source: FLAG_SOURCE,
          benchmark: { metric, basis: "pct_egi", low: pctRow.lowValue, typical: pctRow.typicalValue, high: pctRow.highValue, notes: pctRow.notes },
        });
      }
    }
  }

  const taxFlag = buildTaxVsAssessmentFlag({
    omTaxAnnual: byMetric.get("taxes") ?? null,
    assessedTaxableValue: params.assessedTaxableValue ?? null,
    taxCode: params.taxCode ?? null,
  });
  if (taxFlag) flags.push(taxFlag);

  return flags;
}

/**
 * Cross-check the OM's stated property-tax line against the DOF-implied bill
 * (billable assessed value × statutory class rate). Catches the classic OM
 * move of quoting abated, capped, or stale taxes.
 */
export function buildTaxVsAssessmentFlag(params: {
  omTaxAnnual: number | null;
  assessedTaxableValue: number | null;
  taxCode: string | null;
}): OmValidationFlag | null {
  const { omTaxAnnual, assessedTaxableValue, taxCode } = params;
  if (omTaxAnnual == null || omTaxAnnual <= 0) return null;
  if (assessedTaxableValue == null || assessedTaxableValue <= 0) return null;
  const normalizedClass = (taxCode ?? "").trim().toUpperCase();
  const classKey = (["1", "2", "3", "4"] as const).find((key) => normalizedClass.startsWith(key));
  if (!classKey) return null;
  const ratePct = NYC_TAX_CLASS_RATES_PCT[classKey];
  const impliedAnnualTax = assessedTaxableValue * (ratePct / 100);
  if (!Number.isFinite(impliedAnnualTax) || impliedAnnualTax <= 0) return null;
  const ratio = omTaxAnnual / impliedAnnualTax;

  if (ratio < TAX_VS_ASSESSMENT_LOW_RATIO) {
    return {
      flagType: "tax_vs_assessment",
      field: "taxes",
      severity: "warning",
      brokerValue: Math.round(omTaxAnnual),
      externalValue: Math.round(impliedAnnualTax),
      message: `OM taxes (${formatMoney(omTaxAnnual)}/yr) are ${Math.round((1 - ratio) * 100)}% below the DOF-implied bill (${formatMoney(impliedAnnualTax)}/yr = billable AV ${formatMoney(assessedTaxableValue)} × class ${classKey} rate ${ratePct}%). Check for an expiring abatement/exemption or a stale figure — underwrite to the implied bill.`,
      source: FLAG_SOURCE,
    };
  }
  if (ratio > TAX_VS_ASSESSMENT_HIGH_RATIO) {
    return {
      flagType: "tax_vs_assessment",
      field: "taxes",
      severity: "info",
      brokerValue: Math.round(omTaxAnnual),
      externalValue: Math.round(impliedAnnualTax),
      message: `OM taxes (${formatMoney(omTaxAnnual)}/yr) are ${Math.round((ratio - 1) * 100)}% above the DOF-implied bill (${formatMoney(impliedAnnualTax)}/yr). Verify whether BID charges or non-tax items are bundled into the line.`,
      source: FLAG_SOURCE,
    };
  }
  return null;
}
