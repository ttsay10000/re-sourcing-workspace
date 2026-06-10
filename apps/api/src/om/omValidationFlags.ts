/**
 * Deterministic validation flags computed after OM extraction: missing rents,
 * duplicated rent roll rows (the LLM pulling the same units twice), expected
 * expense categories that didn't appear, and outlier underwriting metrics
 * (cap rate, expense ratio, NOI tie-out). These complement the LLM-reported
 * discrepancies with checks that don't depend on the model noticing the
 * problem itself.
 */
import type { OmAnalysis, OmAuthoritativeSnapshot, OmRentRollRow, OmValidationFlag } from "@re-sourcing/contracts";
import { resolveOmAskingPriceFromAnalysis } from "../deal/omAskingPrice.js";
import { sanitizeOmRentRollRowsWithStats } from "../rental/omAnalysisUtils.js";

const FLAG_SOURCE = "authoritative_om";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatPct(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

interface ExpectedExpenseCategory {
  key: string;
  label: string;
  pattern: RegExp;
  severity: "warning" | "info";
  note: string;
}

/**
 * Categories every NYC multifamily operating statement should show. Missing
 * warning-level lines usually mean the OM understates expenses (and inflates
 * NOI); info-level lines are often legitimately absent on small buildings.
 */
const EXPECTED_EXPENSE_CATEGORIES: ExpectedExpenseCategory[] = [
  {
    key: "propertyTaxes",
    label: "Property taxes",
    pattern: /tax/i,
    severity: "warning",
    note: "Every building owes property tax; without it NOI is overstated.",
  },
  {
    key: "insurance",
    label: "Insurance",
    pattern: /insurance/i,
    severity: "warning",
    note: "Property insurance is a universal carrying cost.",
  },
  {
    key: "utilities",
    label: "Utilities",
    pattern: /utilit|heat|fuel|gas|electric|water|sewer/i,
    severity: "warning",
    note: "No heat/water/electric line — confirm tenants truly pay all utilities.",
  },
  {
    key: "repairsMaintenance",
    label: "Repairs & maintenance",
    pattern: /repair|maint/i,
    severity: "warning",
    note: "Statements without an R&M line usually understate operating costs.",
  },
  {
    key: "management",
    label: "Management fee",
    pattern: /manage|mgmt/i,
    severity: "warning",
    note: "Commonly omitted to inflate NOI; underwrite a management fee even if owner-managed.",
  },
  {
    key: "payroll",
    label: "Payroll / super",
    pattern: /payroll|super\b|superintendent|janitor|staff|labor/i,
    severity: "info",
    note: "Often legitimately absent on small walk-ups; confirm who handles the building.",
  },
  {
    key: "reserves",
    label: "Reserves / replacements",
    pattern: /reserve|replacement|cap[\s-]?ex/i,
    severity: "info",
    note: "OMs rarely include reserves; add them in underwriting.",
  },
];

function expenseLineItemTexts(snapshot: OmAuthoritativeSnapshot): string[] {
  const table = Array.isArray(snapshot.expenses?.expensesTable) ? snapshot.expenses.expensesTable : [];
  return table
    .map((row) => (isPlainObject(row) && typeof row.lineItem === "string" ? row.lineItem : ""))
    .filter((line) => line.trim().length > 0);
}

function resolveExplicitCapRatePct(omAnalysis: OmAnalysis | null | undefined): number | null {
  const ui = isPlainObject(omAnalysis?.uiFinancialSummary) ? omAnalysis.uiFinancialSummary : null;
  const valuation = isPlainObject(omAnalysis?.valuationMetrics) ? omAnalysis.valuationMetrics : null;
  const raw = toFiniteNumber(ui?.capRate) ?? toFiniteNumber(valuation?.capRate);
  if (raw == null || raw <= 0) return null;
  return raw <= 1 ? raw * 100 : raw;
}

function rowAnnualRent(row: OmRentRollRow): number | null {
  const record = row as Record<string, unknown>;
  const annual =
    toFiniteNumber(record.annualRent) ??
    toFiniteNumber(record.annualTotalRent) ??
    toFiniteNumber(record.annualBaseRent);
  if (annual != null) return annual;
  const monthly =
    toFiniteNumber(record.monthlyRent) ??
    toFiniteNumber(record.monthlyTotalRent) ??
    toFiniteNumber(record.monthlyBaseRent);
  return monthly != null ? monthly * 12 : null;
}

function declaredTotalUnits(snapshot: OmAuthoritativeSnapshot): number | null {
  const info = isPlainObject(snapshot.propertyInfo) ? snapshot.propertyInfo : null;
  const declared = toFiniteNumber(info?.totalUnits) ?? toFiniteNumber(info?.unitsTotal);
  return declared != null && declared > 0 ? declared : null;
}

/** Roll gross at or above this multiple of the stated gross income means rents were double-counted. */
const ROLL_GROSS_DOUBLE_COUNT_RATIO = 1.7;

/**
 * Build the post-extraction validation flags for a snapshot. Appends to any
 * flags already on the snapshot (e.g. carried over by the extractor).
 */
export function buildOmValidationFlags(params: {
  snapshot: OmAuthoritativeSnapshot;
  omAnalysis?: OmAnalysis | null;
  /** Rent roll as the LLM returned it, before sanitize/dedupe — enables the duplicate-extraction flag. */
  rawRentRoll?: OmRentRollRow[] | null;
}): OmValidationFlag[] {
  const { snapshot, omAnalysis, rawRentRoll } = params;
  const flags: OmValidationFlag[] = Array.isArray(snapshot.validationFlags) ? [...snapshot.validationFlags] : [];
  const current = snapshot.currentFinancials ?? null;
  const rentRollCount = Array.isArray(snapshot.rentRoll) ? snapshot.rentRoll.length : 0;
  const grossRentalIncome = toFiniteNumber(current?.grossRentalIncome);
  const effectiveGrossIncome = toFiniteNumber(current?.effectiveGrossIncome);
  const operatingExpenses = toFiniteNumber(current?.operatingExpenses);
  const noi = toFiniteNumber(current?.noi);
  const expenseLines = expenseLineItemTexts(snapshot);

  // --- Duplicate rent roll rows (LLM pulled the same units twice) ---
  if (Array.isArray(rawRentRoll)) {
    const stats = sanitizeOmRentRollRowsWithStats(rawRentRoll);
    if (stats.duplicateRowsRemoved > 0) {
      const examples = stats.duplicateExamples.slice(0, 3).join(", ");
      flags.push({
        flagType: "duplicate_rent_roll",
        field: "rentRoll",
        severity: "warning",
        source: FLAG_SOURCE,
        message:
          `Extraction listed the same units twice — ${stats.duplicateRowsRemoved} duplicate rent roll row${stats.duplicateRowsRemoved === 1 ? "" : "s"} removed` +
          (examples ? ` (e.g. ${examples})` : "") +
          ". Verify the remaining roll covers every unit exactly once; duplicated rents inflate the unit model and the MTR/adjusted NOI.",
      });
    }
  }

  const sanitizedRoll = Array.isArray(snapshot.rentRoll) ? snapshot.rentRoll : [];
  const totalUnits = declaredTotalUnits(snapshot);
  if (totalUnits != null && totalUnits >= 2 && rentRollCount >= totalUnits * 2) {
    flags.push({
      flagType: "duplicate_rent_roll",
      field: "rentRoll.unitCount",
      severity: "warning",
      source: FLAG_SOURCE,
      message: `Rent roll has ${rentRollCount} rows but the OM declares ${totalUnits} units — the rents were likely extracted twice. Verify the roll before trusting unit-model NOI and MTR yield.`,
    });
  }

  const rollAnnualGross = sanitizedRoll.reduce<number>((sum, row) => sum + (rowAnnualRent(row) ?? 0), 0);
  if (
    sanitizedRoll.length >= 2 &&
    grossRentalIncome != null &&
    grossRentalIncome > 0 &&
    rollAnnualGross >= grossRentalIncome * ROLL_GROSS_DOUBLE_COUNT_RATIO
  ) {
    flags.push({
      flagType: "duplicate_rent_roll",
      field: "rentRoll.grossTieOut",
      severity: "warning",
      source: FLAG_SOURCE,
      message: `Rent roll sums to ${Math.round(rollAnnualGross).toLocaleString("en-US")}/yr but the OM states ${Math.round(grossRentalIncome).toLocaleString("en-US")} gross rental income — unit rents look double-counted. Verify the roll; the unit model and MTR/adjusted NOI would be inflated.`,
    });
  }

  // --- Rents ---
  const noRentsFound = rentRollCount === 0 && grossRentalIncome == null;
  if (noRentsFound) {
    flags.push({
      flagType: "missing_om_field",
      field: "rents",
      severity: "warning",
      source: FLAG_SOURCE,
      message:
        "No rents found in the source documents — no rent roll rows and no gross rental income were extracted. Upload a rent roll (or OM with rents) or enter gross rent at review.",
    });
  } else {
    if (rentRollCount === 0) {
      flags.push({
        flagType: "missing_om_field",
        field: "rentRoll",
        severity: "warning",
        source: FLAG_SOURCE,
        message: "Rent roll not extracted from OM; review source document and request an updated rent roll if needed.",
      });
    }
    if (grossRentalIncome == null) {
      flags.push({
        flagType: "missing_om_field",
        field: "grossRentalIncome",
        severity: "warning",
        source: FLAG_SOURCE,
        message: "Gross rental income is missing from the OM extraction and remains null.",
      });
    }
  }
  if (operatingExpenses == null) {
    flags.push({
      flagType: "missing_om_field",
      field: "operatingExpenses",
      severity: "warning",
      source: FLAG_SOURCE,
      message: "Operating expenses are missing from the OM extraction and remain null.",
    });
  }
  if (noi == null) {
    flags.push({
      flagType: "missing_om_field",
      field: "noi",
      severity: "warning",
      source: FLAG_SOURCE,
      message: noRentsFound
        ? "NOI cannot be computed without rents; it will fill in once rent data is added."
        : "NOI is missing from the OM extraction and remains null.",
    });
  }

  // --- Expected expense categories (only meaningful when an expense table exists) ---
  if (expenseLines.length > 0) {
    for (const category of EXPECTED_EXPENSE_CATEGORIES) {
      if (expenseLines.some((line) => category.pattern.test(line))) continue;
      flags.push({
        flagType: "missing_expense_category",
        field: `expenses.${category.key}`,
        severity: category.severity,
        source: FLAG_SOURCE,
        message: `Expense table has no ${category.label} line. ${category.note}`,
      });
    }
  }

  // --- Metric outliers ---
  const askingPrice = resolveOmAskingPriceFromAnalysis(omAnalysis);
  const capRatePct =
    resolveExplicitCapRatePct(omAnalysis) ??
    (noi != null && askingPrice != null && askingPrice > 0 ? (noi / askingPrice) * 100 : null);
  if (capRatePct != null) {
    if (capRatePct < 3) {
      flags.push({
        flagType: "metric_outlier",
        field: "capRate",
        severity: "warning",
        source: FLAG_SOURCE,
        message: `Cap rate ${formatPct(capRatePct)} is under 3% — very aggressive pricing or an extraction error. Verify NOI and asking price against the source.`,
      });
    } else if (capRatePct > 12) {
      flags.push({
        flagType: "metric_outlier",
        field: "capRate",
        severity: "warning",
        source: FLAG_SOURCE,
        message: `Cap rate ${formatPct(capRatePct)} is implausibly high — likely a price or NOI extraction error, or pro forma figures leaked into current numbers.`,
      });
    } else if (capRatePct > 6) {
      flags.push({
        flagType: "metric_outlier",
        field: "capRate",
        severity: "info",
        source: FLAG_SOURCE,
        message: `Cap rate ${formatPct(capRatePct)} is above 6% — strong yield for NYC multifamily. Verify the figures are current (not pro forma) before getting excited.`,
      });
    }
  }

  const incomeBasis = effectiveGrossIncome ?? grossRentalIncome;
  if (operatingExpenses != null && incomeBasis != null && incomeBasis > 0) {
    const expenseRatioPct = (operatingExpenses / incomeBasis) * 100;
    if (expenseRatioPct < 25) {
      flags.push({
        flagType: "metric_outlier",
        field: "expenseRatio",
        severity: "warning",
        source: FLAG_SOURCE,
        message: `Expense ratio ${formatPct(expenseRatioPct)} is under 25% — NYC multifamily rarely runs this lean. Expenses are likely understated; check for missing lines.`,
      });
    } else if (expenseRatioPct > 65) {
      flags.push({
        flagType: "metric_outlier",
        field: "expenseRatio",
        severity: "info",
        source: FLAG_SOURCE,
        message: `Expense ratio ${formatPct(expenseRatioPct)} is above 65% — heavy expense load. Confirm one-time items aren't mixed into operating expenses.`,
      });
    }
  }

  if (noi != null && operatingExpenses != null && incomeBasis != null) {
    const expectedNoi = incomeBasis - operatingExpenses;
    const tolerance = Math.max(Math.abs(expectedNoi) * 0.015, 1_000);
    if (Math.abs(noi - expectedNoi) > tolerance) {
      flags.push({
        flagType: "metric_outlier",
        field: "noi",
        severity: "info",
        source: FLAG_SOURCE,
        message: `Reported NOI (${Math.round(noi).toLocaleString("en-US")}) doesn't tie to income minus expenses (${Math.round(expectedNoi).toLocaleString("en-US")}). Check which figure the source actually supports.`,
      });
    }
  }

  return flags;
}
