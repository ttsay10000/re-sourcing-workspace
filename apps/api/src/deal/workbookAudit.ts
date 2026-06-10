/**
 * Post-generation audit of the deal-analysis workbook. The builder writes
 * every formula with a cached engine result, so the audit can verify — without
 * a formula interpreter — that the rendered workbook ties back to the
 * underwriting engine and that structural invariants hold.
 */
import ExcelJS from "exceljs";
import type { UnderwritingContext } from "./underwritingContext.js";
import { computeMortgage } from "./mortgageAmortization.js";
import { MAX_UNDERWRITING_HOLD_PERIOD_YEARS } from "./underwritingModel.js";

export type WorkbookAuditCheckStatus = "pass" | "warning" | "failed";

export interface WorkbookAuditCheck {
  key: string;
  label: string;
  status: WorkbookAuditCheckStatus;
  detail?: string | null;
  expected?: number | string | null;
  actual?: number | string | null;
  sheet?: string | null;
  cell?: string | null;
}

export interface WorkbookAuditResult {
  status: "pass" | "warnings" | "failed";
  generatedAt: string;
  checks: WorkbookAuditCheck[];
}

/** Relative tolerance for engine tie-outs (plus a $1 absolute floor). */
const TIE_OUT_RELATIVE_TOLERANCE = 0.005;

/** Year columns in CashFlowModel: column C is year 0, D is year 1, ... */
const CASH_FLOW_YEAR0_COLUMN = 3;

function findRowByLabel(worksheet: ExcelJS.Worksheet, label: string): number | null {
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    if (worksheet.getCell(row, 1).value === label) return row;
  }
  return null;
}

type CachedCellRead =
  | { kind: "number"; value: number }
  | { kind: "formula_no_result" }
  | { kind: "empty" };

function readCachedCell(cell: ExcelJS.Cell): CachedCellRead {
  const value = cell.value;
  if (value == null || value === "") return { kind: "empty" };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { kind: "number", value } : { kind: "empty" };
  }
  if (typeof value === "object" && "formula" in value) {
    const result = (value as ExcelJS.CellFormulaValue).result;
    if (typeof result === "number" && Number.isFinite(result)) {
      return { kind: "number", value: result };
    }
    // Excel recomputes on open; a formula without a cached result is
    // unverifiable here but not evidence of an error.
    return { kind: "formula_no_result" };
  }
  return { kind: "empty" };
}

function withinTolerance(expected: number, actual: number): boolean {
  const tolerance = Math.max(1, Math.abs(expected) * TIE_OUT_RELATIVE_TOLERANCE);
  return Math.abs(expected - actual) <= tolerance;
}

function columnLetter(column: number): string {
  let result = "";
  let value = column;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function tieOutSeries(params: {
  worksheet: ExcelJS.Worksheet;
  rowLabel: string;
  expectedByYear: ReadonlyArray<number | null | undefined>;
  holdYears: number;
  key: string;
  label: string;
  checks: WorkbookAuditCheck[];
}): void {
  const { worksheet, rowLabel, expectedByYear, holdYears, key, label, checks } = params;
  const row = findRowByLabel(worksheet, rowLabel);
  if (row == null) {
    checks.push({
      key,
      label,
      status: "failed",
      detail: `Row "${rowLabel}" not found in ${worksheet.name} — workbook layout drifted.`,
      sheet: worksheet.name,
    });
    return;
  }
  let verifiedYears = 0;
  let hadFailure = false;
  for (let year = 1; year <= holdYears; year += 1) {
    const expectedRaw = expectedByYear[year];
    if (expectedRaw == null || !Number.isFinite(expectedRaw)) continue;
    const column = CASH_FLOW_YEAR0_COLUMN + year;
    const cellRef = `${columnLetter(column)}${row}`;
    const read = readCachedCell(worksheet.getCell(row, column));
    if (read.kind === "formula_no_result") continue;
    if (read.kind === "empty") {
      hadFailure = true;
      checks.push({
        key: `${key}_y${year}`,
        label: `${label} (year ${year})`,
        status: "failed",
        detail: "Workbook cell is empty where the engine has a value.",
        expected: Math.round(expectedRaw),
        actual: null,
        sheet: worksheet.name,
        cell: cellRef,
      });
      continue;
    }
    verifiedYears += 1;
    if (!withinTolerance(expectedRaw, read.value)) {
      hadFailure = true;
      checks.push({
        key: `${key}_y${year}`,
        label: `${label} (year ${year})`,
        status: "failed",
        detail: "Workbook cached value does not tie to the underwriting engine.",
        expected: Math.round(expectedRaw),
        actual: Math.round(read.value),
        sheet: worksheet.name,
        cell: cellRef,
      });
    }
  }
  if (!hadFailure) {
    checks.push({
      key,
      label: `${label} ties to engine`,
      status: "pass",
      detail: verifiedYears > 0 ? `${verifiedYears} year(s) verified against cached values.` : "No cached values to verify (Excel recomputes on open).",
      sheet: worksheet.name,
    });
  }
}

/**
 * Audit a generated workbook buffer against the underwriting context that
 * produced it. Failures flag — they should never block generation.
 */
export async function auditDealAnalysisWorkbook(params: {
  buffer: Buffer;
  ctx: UnderwritingContext;
}): Promise<WorkbookAuditResult> {
  const { buffer, ctx } = params;
  const checks: WorkbookAuditCheck[] = [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const cashFlow = workbook.getWorksheet("CashFlowModel");
  const assumptionsSheet = workbook.getWorksheet("Assumptions");
  for (const [name, sheet] of [
    ["CashFlowModel", cashFlow],
    ["Assumptions", assumptionsSheet],
    ["FinancingModel", workbook.getWorksheet("FinancingModel")],
    ["Summary", workbook.getWorksheet("Summary")],
  ] as const) {
    if (!sheet) {
      checks.push({
        key: `sheet_${name}`,
        label: `${name} sheet present`,
        status: "failed",
        detail: "Expected worksheet is missing.",
      });
    }
  }

  const holdYears = Math.max(1, Math.round(ctx.assumptions.holdPeriodYears ?? 1));
  const ltvPct = ctx.assumptions.financing.ltvPct;
  const interestRatePct = ctx.assumptions.financing.interestRatePct;
  const amortizationYears = ctx.assumptions.financing.amortizationYears;
  const vacancyPct = ctx.assumptions.operating.vacancyPct;
  const exitCapPct = ctx.assumptions.exit.exitCapPct;
  const yearly = ctx.yearlyCashFlow;

  // 1a. Engine tie-out on the expense lines — the only year-series rows the
  //     builder writes with cached results (workbook shows them negative).
  if (cashFlow && yearly?.expenseLineItems?.length) {
    for (const line of yearly.expenseLineItems) {
      const expectedByYear: Array<number | null> = [null];
      for (let year = 1; year <= holdYears; year += 1) {
        const amount = line.yearlyAmounts?.[year - 1];
        expectedByYear.push(amount != null && Number.isFinite(amount) ? -Math.abs(amount) : null);
      }
      tieOutSeries({
        worksheet: cashFlow,
        rowLabel: line.lineItem,
        expectedByYear,
        holdYears,
        key: `expense_tie_out_${line.lineItem.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        label: `Expense line "${line.lineItem}"`,
        checks,
      });
    }
  }

  // 1b. Structural presence: the load-bearing aggregate rows must exist and be
  //     formulas (catches hardcoded-constant regressions even though their
  //     results are recomputed by Excel on open).
  if (cashFlow) {
    for (const rowLabel of [
      "Net operating income (NOI)",
      "Total operating expenses",
      "Total debt service",
      "Total levered CF incl. exit",
    ]) {
      const row = findRowByLabel(cashFlow, rowLabel);
      if (row == null) {
        checks.push({
          key: `structure_${rowLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
          label: `Row "${rowLabel}" present`,
          status: "failed",
          detail: "Expected row is missing — workbook layout drifted.",
          sheet: "CashFlowModel",
        });
        continue;
      }
      let formulaCells = 0;
      let constantCells = 0;
      for (let year = 1; year <= holdYears; year += 1) {
        const value = cashFlow.getCell(row, CASH_FLOW_YEAR0_COLUMN + year).value;
        if (value && typeof value === "object" && "formula" in value) formulaCells += 1;
        else if (typeof value === "number") constantCells += 1;
      }
      checks.push({
        key: `structure_${rowLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        label: `Row "${rowLabel}" is formula-driven`,
        status: constantCells > 0 ? "failed" : "pass",
        detail:
          constantCells > 0
            ? `${constantCells} year cell(s) are hardcoded constants instead of formulas.`
            : `${formulaCells} year cell(s) verified as formulas.`,
        sheet: "CashFlowModel",
        cell: `A${row}`,
      });
    }
  }

  // 1c. Assumptions inputs tie to the engine context.
  if (assumptionsSheet) {
    const purchaseCell = readCachedCell(assumptionsSheet.getCell("C13"));
    if (ctx.assumptions.acquisition.purchasePrice != null && purchaseCell.kind === "number") {
      checks.push({
        key: "assumption_purchase_price",
        label: "Purchase price input ties to engine",
        status: withinTolerance(ctx.assumptions.acquisition.purchasePrice, purchaseCell.value) ? "pass" : "failed",
        expected: ctx.assumptions.acquisition.purchasePrice,
        actual: purchaseCell.value,
        sheet: "Assumptions",
        cell: "C13",
      });
    }
    const noiBasis = ctx.assetCapRateNoiBasis ?? ctx.currentNoi;
    const noiCell = readCachedCell(assumptionsSheet.getCell("C26"));
    if (noiBasis != null && Number.isFinite(noiBasis) && noiCell.kind === "number") {
      checks.push({
        key: "assumption_current_noi",
        label: "Current NOI basis ties to engine",
        status: withinTolerance(noiBasis, noiCell.value) ? "pass" : "failed",
        expected: Math.round(noiBasis),
        actual: Math.round(noiCell.value),
        sheet: "Assumptions",
        cell: "C26",
      });
    }
  }

  // 2. Debt re-derivation: monthly payment recomputed from the same inputs.
  const loanAmount = ctx.financing.loanAmount;
  if (loanAmount > 0 && ctx.financing.monthlyPayment > 0 && interestRatePct != null && amortizationYears != null) {
    const recomputed = computeMortgage({
      principal: loanAmount,
      annualRate: interestRatePct / 100,
      amortizationYears,
    });
    if (!withinTolerance(recomputed.monthlyPayment, ctx.financing.monthlyPayment)) {
      checks.push({
        key: "monthly_payment_rederivation",
        label: "Monthly debt payment re-derivation",
        status: "failed",
        detail: "Monthly payment in the model does not match the payment recomputed from LTV/rate/amortization.",
        expected: Math.round(recomputed.monthlyPayment * 100) / 100,
        actual: Math.round(ctx.financing.monthlyPayment * 100) / 100,
      });
    } else {
      checks.push({ key: "monthly_payment_rederivation", label: "Monthly debt payment re-derivation", status: "pass" });
    }
  }

  // 3. Formula sanity: no #REF and no formula cells with error results.
  let refErrors = 0;
  let errorResults = 0;
  workbook.worksheets.forEach((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (value && typeof value === "object" && "formula" in value) {
          const formulaValue = value as ExcelJS.CellFormulaValue;
          if (typeof formulaValue.formula === "string" && formulaValue.formula.includes("#REF")) {
            refErrors += 1;
          }
          const result = formulaValue.result as unknown;
          if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
            errorResults += 1;
          }
        }
      });
    });
  });
  checks.push({
    key: "formula_sanity",
    label: "Formula sanity (#REF / error results)",
    status: refErrors > 0 || errorResults > 0 ? "failed" : "pass",
    detail:
      refErrors > 0 || errorResults > 0
        ? `${refErrors} #REF reference(s), ${errorResults} formula error result(s).`
        : null,
  });

  // 4. Inputs within bounds (mirrors the deal-level validation flags so the
  //    workbook and dossier always agree).
  const bounds: Array<{ key: string; label: string; ok: boolean; detail: string }> = [];
  if (ltvPct != null) {
    bounds.push({
      key: "bounds_ltv",
      label: "LTV within lending bounds",
      ok: ltvPct <= 80,
      detail: `LTV ${ltvPct}% exceeds the 80% screening bound.`,
    });
  }
  if (interestRatePct != null) {
    bounds.push({
      key: "bounds_rate",
      label: "Interest rate plausible",
      ok: interestRatePct >= 1 && interestRatePct <= 12,
      detail: `Interest rate ${interestRatePct}% is outside the 1–12% plausibility band.`,
    });
  }
  if (vacancyPct != null) {
    bounds.push({
      key: "bounds_vacancy",
      label: "Vacancy plausible",
      ok: vacancyPct >= 0 && vacancyPct <= 50,
      detail: `Vacancy ${vacancyPct}% is outside 0–50%.`,
    });
  }
  bounds.push({
    key: "bounds_hold",
    label: "Hold period within model limit",
    ok: holdYears <= MAX_UNDERWRITING_HOLD_PERIOD_YEARS,
    detail: `Hold ${holdYears} years exceeds the ${MAX_UNDERWRITING_HOLD_PERIOD_YEARS}-year model limit.`,
  });
  if (
    exitCapPct != null &&
    ctx.assetCapRate != null &&
    Number.isFinite(ctx.assetCapRate) &&
    ctx.assetCapRate > 0
  ) {
    bounds.push({
      key: "bounds_exit_cap",
      label: "Exit cap vs going-in cap",
      ok: exitCapPct >= ctx.assetCapRate - 0.25,
      detail: `Exit cap ${exitCapPct}% sits below the going-in cap ${ctx.assetCapRate.toFixed(2)}% — compression-driven returns.`,
    });
  }
  for (const bound of bounds) {
    checks.push({
      key: bound.key,
      label: bound.label,
      status: bound.ok ? "pass" : "warning",
      detail: bound.ok ? null : bound.detail,
    });
  }

  const status: WorkbookAuditResult["status"] = checks.some((check) => check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status === "warning")
      ? "warnings"
      : "pass";

  return { status, generatedAt: new Date().toISOString(), checks };
}
