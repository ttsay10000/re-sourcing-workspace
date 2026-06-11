import ExcelJS from "exceljs";
import type { CellValue, FillPattern, Font, Borders } from "exceljs";
import { buildProFormaFileName } from "./dossierFileName.js";
import {
  buildDealAnalysisWorkbookBlueprint,
  FALLBACK_BLUEPRINT,
  type DealAnalysisSummaryMetricKey,
  type DealAnalysisWorkbookBlueprint,
} from "./dealAnalysisExcelBlueprintLlm.js";
import { computeIrr } from "./irrCalculation.js";
import { computeYieldSignals } from "./yieldSignals.js";
import type {
  ExpenseRow,
  UnderwritingContext,
} from "./underwritingContext.js";
import {
  MAX_UNDERWRITING_HOLD_PERIOD_YEARS,
  normalizeExpenseProjectionInputs,
} from "./underwritingModel.js";

const MAX_MODEL_YEARS = MAX_UNDERWRITING_HOLD_PERIOD_YEARS;
const MONTHS_PER_YEAR = 12;
const CURRENCY_FMT = "$#,##0;[Red]($#,##0);-";
const PERCENT_FMT = "0.00%;[Red](0.00%);-";
const INPUT_PERCENT_FMT = PERCENT_FMT;
const MULTIPLE_FMT = "0.00x;[Red](0.00x);-";
const INTEGER_FMT = "0;[Red](0);-";
const DATE_FMT = "yyyy-mm-dd";

const COLOR = {
  navy: "FF17375E",
  blue: "FF5B9BD5",
  blueFill: "FFF2F8FF",
  lightBlueFill: "FFD9EAF7",
  greenFill: "FFE2F0D9",
  paleYellow: "FFFFF4CC",
  white: "FFFFFFFF",
  softGray: "FFF8FAFC",
  border: "FFD6DCE5",
  text: "FF1F2937",
  muted: "FF64748B",
  greenText: "FF008000",
  sectionText: "FFFFFFFF",
} as const;

const THIN_BORDER: Partial<Borders> = {
  top: { style: "thin", color: { argb: COLOR.border } },
  left: { style: "thin", color: { argb: COLOR.border } },
  bottom: { style: "thin", color: { argb: COLOR.border } },
  right: { style: "thin", color: { argb: COLOR.border } },
};

const TITLE_FILL: FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: COLOR.navy },
};

const SECTION_FILL: FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: COLOR.blue },
};

const COLUMN_FILL: FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: COLOR.lightBlueFill },
};

const HARD_CODED_FILL: FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: COLOR.paleYellow },
};

const FORMULA_FILL: FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: COLOR.white },
};

const SOFT_FILL: FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: COLOR.softGray },
};

const TITLE_FONT: Partial<Font> = {
  bold: true,
  size: 14,
  color: { argb: COLOR.white },
};

const SECTION_FONT: Partial<Font> = {
  bold: true,
  color: { argb: COLOR.sectionText },
};

const HEADER_FONT: Partial<Font> = {
  bold: true,
  color: { argb: COLOR.text },
};

const LABEL_FONT: Partial<Font> = {
  bold: true,
  color: { argb: COLOR.text },
};

const HARD_CODED_FONT: Partial<Font> = {
  color: { argb: COLOR.blue },
  bold: false,
};

const FORMULA_FONT: Partial<Font> = {
  color: { argb: COLOR.text },
};

const LINKED_FORMULA_FONT: Partial<Font> = {
  color: { argb: COLOR.greenText },
};

const NOTE_FONT: Partial<Font> = {
  italic: true,
  size: 10,
  color: { argb: COLOR.muted },
};

// Exported so the post-generation audit (workbookAudit.ts) reads the exact
// same sheet geometry the builder writes — a row moved here can then never
// silently desynchronize the audit.
export const assumptionRows = {
  address: 5,
  area: 6,
  units: 7,
  dealScore: 8,
  investmentProfile: 9,
  targetAcquisitionDate: 10,
  purchasePrice: 13,
  purchaseClosingPct: 14,
  renovationCosts: 15,
  furnishingCosts: 16,
  onboardingCosts: 17,
  currentFreeMarketResidentialGrossRent: 20,
  currentProtectedResidentialGrossRent: 21,
  currentCommercialGrossRent: 22,
  currentGrossRent: 23,
  currentOtherIncome: 24,
  currentExpenses: 25,
  currentNoi: 26,
  currentNoiAdjustment: 27,
  ltvPct: 29,
  interestRatePct: 30,
  amortizationYears: 31,
  loanFeePct: 32,
  eligibleRevenueSharePct: 35,
  rentUpliftPct: 36,
  blendedRentUpliftPct: 37,
  expenseIncreasePct: 38,
  managementFeePct: 39,
  occupancyTaxPct: 40,
  vacancyPct: 41,
  leadTimeMonths: 42,
  annualRentGrowthPct: 43,
  annualCommercialRentGrowthPct: 44,
  annualOtherIncomeGrowthPct: 45,
  annualExpenseGrowthPct: 46,
  annualPropertyTaxGrowthPct: 47,
  recurringCapexAnnual: 48,
  holdPeriodYears: 51,
  exitCapPct: 52,
  exitClosingCostPct: 53,
  targetIrrPct: 54,
} as const;

type AssumptionKey = keyof typeof assumptionRows;

const EXPENSE_ASSUMPTION_HEADER_ROW = 57;
const EXPENSE_ASSUMPTION_START_ROW = EXPENSE_ASSUMPTION_HEADER_ROW + 1;

const financingRows = {
  loanAmount: 2,
  financingFees: 3,
  purchaseClosingCosts: 4,
  totalProjectCost: 5,
  initialEquityInvested: 6,
  monthlyInterestRate: 7,
  amortizationMonths: 8,
  monthlyPayment: 9,
  annualDebtService: 10,
  totalCapitalization: 11,
  amortizationStart: 13,
} as const;

const monthlyDebtRows = {
  header: 4,
  start: 5,
  maxMonths: MAX_MODEL_YEARS * MONTHS_PER_YEAR,
} as const;

interface CashFlowRowMap {
  propertyValue: number;
  grossRentalIncome: number;
  freeMarketResidential: number;
  protectedResidential: number;
  commercial: number;
  otherIncome: number;
  vacancy: number;
  leadTime: number;
  netRentalIncome: number;
  expenseStart: number;
  management: number;
  totalOperatingExpenses: number;
  noi: number;
  recurringCapex: number;
  cashFlowFromOperations: number;
  capRate: number;
  debtService: number;
  principal: number;
  interest: number;
  cashFlowAfterFinancing: number;
  totalInvestmentCost: number;
  saleValue: number;
  saleClosingCosts: number;
  reserveRelease: number;
  unleveredCashFlow: number;
  financingFunding: number;
  financingFees: number;
  financingPayoff: number;
  leveredCashFlow: number;
  metricsStart: number;
  calculatedStabilizedNoi: number;
  calculatedGrossSaleValue: number;
  calculatedNetSaleValue: number;
  calculatedUnleveredIrr: number;
  calculatedLeveredIrr: number;
  calculatedAverageCashOnCash: number;
  calculatedEquityMultiple: number;
}

interface WorkbookBuildArtifacts {
  currentRentBreakdown: {
    freeMarketResidential: number;
    protectedResidential: number;
    commercial: number;
  };
  expenses: Array<ExpenseRow & { yearlyAmounts?: number[] | undefined }>;
  aggregateExpenseFallback: boolean;
  cashFlowRows: CashFlowRowMap;
}

interface SummaryMetricDefinition {
  label: string;
  formula: string;
  result?: string | number | boolean | Date | ExcelJS.CellErrorValue;
  numFmt?: string;
  alignment?: Partial<ExcelJS.Alignment>;
}

interface VisibleCashFlowRow {
  label: string;
  driver: string;
  driverNumFmt?: string;
  modelRow: number;
  numFmt: string;
  isSection?: boolean;
}

function num(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

export function columnLetter(index: number): string {
  let result = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

/** CashFlowModel lays years across columns starting here (column C = year 0). */
export const CASH_FLOW_YEAR0_COLUMN = 3;

function assumptionCell(row: number): string {
  return `$C$${row}`;
}

function quotedSheetRef(sheetName: string, cell: string): string {
  return `'${sheetName.replace(/'/g, "''")}'!${cell}`;
}

function assumptionRef(key: AssumptionKey): string {
  return quotedSheetRef("Assumptions", assumptionCell(assumptionRows[key]));
}

function percentAssumption(value: number | null | undefined): number {
  return num(value) / 100;
}

function expenseAssumptionRow(index: number): number {
  return EXPENSE_ASSUMPTION_START_ROW + index;
}

function expenseBaseAmountRef(index: number): string {
  return quotedSheetRef("Assumptions", `$B$${expenseAssumptionRow(index)}`);
}

function expenseGrowthRef(index: number): string {
  return quotedSheetRef("Assumptions", `$C$${expenseAssumptionRow(index)}`);
}

function yieldOnCostAssumptionRows(artifacts: WorkbookBuildArtifacts): {
  longTermNoi: number;
  midTermNoi: number;
} {
  const start = EXPENSE_ASSUMPTION_START_ROW + artifacts.expenses.length + 4;
  return {
    longTermNoi: start,
    midTermNoi: start + 1,
  };
}

function currentNoiResult(ctx: UnderwritingContext, artifacts: WorkbookBuildArtifacts): number {
  return (
    artifacts.currentRentBreakdown.freeMarketResidential +
    artifacts.currentRentBreakdown.protectedResidential +
    artifacts.currentRentBreakdown.commercial +
    num(ctx.currentOtherIncome) -
    num(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses) +
    Math.max(0, num(ctx.conservativeProjectedLeaseUpRent))
  );
}

function monthlyDebtEndRow(): number {
  return monthlyDebtRows.start + monthlyDebtRows.maxMonths - 1;
}

function applyFill(cell: ExcelJS.Cell, fill: FillPattern): void {
  cell.fill = fill;
}

function applyBorder(cell: ExcelJS.Cell): void {
  cell.border = THIN_BORDER;
}

function setSheetCell(
  worksheet: ExcelJS.Worksheet,
  address: string,
  value: CellValue,
  options: {
    numFmt?: string;
    font?: Partial<Font>;
    fill?: FillPattern;
    alignment?: Partial<ExcelJS.Alignment>;
    border?: boolean;
  } = {}
): ExcelJS.Cell {
  const cell = worksheet.getCell(address);
  cell.value = value;
  if (options.numFmt) cell.numFmt = options.numFmt;
  if (options.font) cell.font = { ...cell.font, ...options.font };
  if (options.fill) applyFill(cell, options.fill);
  if (options.alignment) cell.alignment = { ...cell.alignment, ...options.alignment };
  if (options.border !== false) applyBorder(cell);
  return cell;
}

function setFormulaCell(
  worksheet: ExcelJS.Worksheet,
  address: string,
  formula: string,
  options: {
    result?: string | number | boolean | Date | ExcelJS.CellErrorValue;
    numFmt?: string;
    font?: Partial<Font>;
    fill?: FillPattern;
    alignment?: Partial<ExcelJS.Alignment>;
    border?: boolean;
  } = {}
): ExcelJS.Cell {
  return setSheetCell(
    worksheet,
    address,
    {
      formula,
      result: options.result == null ? undefined : options.result,
    },
    options
  );
}

function styledSectionTitle(worksheet: ExcelJS.Worksheet, start: string, end: string, value: string): void {
  worksheet.mergeCells(`${start}:${end}`);
  setSheetCell(worksheet, start, value, {
    fill: SECTION_FILL,
    font: SECTION_FONT,
    alignment: { vertical: "middle", horizontal: "left" },
  });
}

function buildArtifacts(ctx: UnderwritingContext): WorkbookBuildArtifacts {
  const normalizedExpenseInputs = normalizeExpenseProjectionInputs<ExpenseRow>({
    currentExpensesTotal: num(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses),
    expenseRows: ctx.expenseRows,
  });
  const projectedExpenseRows =
    ctx.yearlyCashFlow?.expenseLineItems?.map((row) => ({
      lineItem: row.lineItem,
      amount: row.baseAmount,
      annualGrowthPct: row.annualGrowthPct,
      yearlyAmounts: row.yearlyAmounts,
    })) ?? [];
  const expenses =
    projectedExpenseRows.length > 0
      ? projectedExpenseRows
      : normalizedExpenseInputs.expenseRowsExManagement.length > 0
        ? normalizedExpenseInputs.expenseRowsExManagement.map((row) => ({
            ...row,
            yearlyAmounts: undefined,
          }))
        : [
            {
              lineItem: "Operating expenses",
              amount: normalizedExpenseInputs.currentExpensesTotalExManagement,
              annualGrowthPct: ctx.assumptions.operating.annualExpenseGrowthPct ?? 0,
            },
          ];
  const aggregateExpenseFallback =
    projectedExpenseRows.length === 0 && normalizedExpenseInputs.expenseRowsExManagement.length === 0;

  const currentRentBreakdown =
    ctx.rentBreakdown?.current != null
      ? {
          freeMarketResidential: num(ctx.rentBreakdown.current.freeMarketResidential),
          protectedResidential: num(ctx.rentBreakdown.current.protectedResidential),
          commercial: num(ctx.rentBreakdown.current.commercial),
        }
      : {
          freeMarketResidential: num(ctx.currentGrossRent),
          protectedResidential: 0,
          commercial: 0,
        };

  if (
    currentRentBreakdown.freeMarketResidential +
      currentRentBreakdown.protectedResidential +
      currentRentBreakdown.commercial <=
    0 &&
    num(ctx.currentGrossRent) > 0
  ) {
    currentRentBreakdown.freeMarketResidential = num(ctx.currentGrossRent);
  }

  const expenseStart = 17;
  const management = expenseStart + expenses.length;
  const totalOperatingExpenses = management + 1;
  const noi = totalOperatingExpenses + 1;
  const recurringCapex = noi + 1;
  const cashFlowFromOperations = recurringCapex + 1;
  const capRate = cashFlowFromOperations + 1;
  const debtService = capRate + 1;
  const principal = debtService + 1;
  const interest = principal + 1;
  const cashFlowAfterFinancing = interest + 1;
  const totalInvestmentCost = cashFlowAfterFinancing + 2;
  const saleValue = totalInvestmentCost + 1;
  const saleClosingCosts = saleValue + 1;
  const reserveRelease = saleClosingCosts + 1;
  const unleveredCashFlow = reserveRelease + 1;
  const financingFunding = unleveredCashFlow + 2;
  const financingFees = financingFunding + 1;
  const financingPayoff = financingFees + 1;
  const leveredCashFlow = financingPayoff + 1;
  const metricsStart = leveredCashFlow + 3;

  return {
    currentRentBreakdown,
    expenses,
    aggregateExpenseFallback,
    cashFlowRows: {
      propertyValue: 6,
      grossRentalIncome: 7,
      freeMarketResidential: 8,
      protectedResidential: 9,
      commercial: 10,
      otherIncome: 11,
      vacancy: 12,
      leadTime: 13,
      netRentalIncome: 14,
      expenseStart,
      management,
      totalOperatingExpenses,
      noi,
      recurringCapex,
      cashFlowFromOperations,
      capRate,
      debtService,
      principal,
      interest,
      cashFlowAfterFinancing,
      totalInvestmentCost,
      saleValue,
      saleClosingCosts,
      reserveRelease,
      unleveredCashFlow,
      financingFunding,
      financingFees,
      financingPayoff,
      leveredCashFlow,
      metricsStart,
      calculatedStabilizedNoi: metricsStart,
      calculatedGrossSaleValue: metricsStart + 1,
      calculatedNetSaleValue: metricsStart + 2,
      calculatedUnleveredIrr: metricsStart + 3,
      calculatedLeveredIrr: metricsStart + 4,
      calculatedAverageCashOnCash: metricsStart + 5,
      calculatedEquityMultiple: metricsStart + 6,
    },
  };
}

function buildAssumptionsSheet(
  workbook: ExcelJS.Workbook,
  ctx: UnderwritingContext,
  blueprint: DealAnalysisWorkbookBlueprint,
  artifacts: WorkbookBuildArtifacts
): void {
  const worksheet = workbook.addWorksheet("Assumptions", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  worksheet.columns = [
    { width: 16 },
    { width: 32 },
    { width: 18 },
    { width: 14 },
    { width: 30 },
  ];

  worksheet.mergeCells("A1:E1");
  setSheetCell(worksheet, "A1", blueprint.workbookTitle, {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left", vertical: "middle" },
  });

  worksheet.mergeCells("A2:E2");
  setSheetCell(worksheet, "A2", blueprint.assumptionsSubtitle, {
    fill: SOFT_FILL,
    font: NOTE_FONT,
    alignment: { wrapText: true, vertical: "middle" },
  });
  worksheet.getRow(2).height = 32;

  setSheetCell(worksheet, "A4", "Section", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "B4", "Assumption", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "C4", "Value", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "D4", "Units", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "E4", "Source / Logic", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });

  const addRow = (
    row: number,
    params: {
      section: string;
      label: string;
      value: CellValue;
      valueNumFmt?: string;
      units?: string;
      source: string;
      hardCoded?: boolean;
      formula?: string;
      result?: string | number | boolean | Date | ExcelJS.CellErrorValue;
      linkedFormula?: boolean;
    }
  ) => {
    setSheetCell(worksheet, `A${row}`, params.section, { font: LABEL_FONT, fill: SOFT_FILL });
    setSheetCell(worksheet, `B${row}`, params.label, { font: LABEL_FONT });
    if (params.formula) {
      setFormulaCell(worksheet, `C${row}`, params.formula, {
        result: params.result,
        numFmt: params.valueNumFmt,
        fill: FORMULA_FILL,
        font: params.linkedFormula ? LINKED_FORMULA_FONT : FORMULA_FONT,
        alignment: { horizontal: "right" },
      });
    } else {
      setSheetCell(worksheet, `C${row}`, params.value, {
        numFmt: params.valueNumFmt,
        fill: params.hardCoded ? HARD_CODED_FILL : SOFT_FILL,
        font: params.hardCoded ? HARD_CODED_FONT : undefined,
        alignment: { horizontal: params.valueNumFmt ? "right" : "left" },
      });
    }
    setSheetCell(worksheet, `D${row}`, params.units ?? "", {
      alignment: { horizontal: "center" },
      fill: SOFT_FILL,
    });
    setSheetCell(worksheet, `E${row}`, params.source, {
      font: params.hardCoded ? HARD_CODED_FONT : NOTE_FONT,
      alignment: { wrapText: true },
      fill: params.hardCoded ? HARD_CODED_FILL : SOFT_FILL,
    });
  };

  addRow(assumptionRows.address, {
    section: "Property",
    label: "Address",
    value: ctx.canonicalAddress,
    source: "Hard coded from current OM workspace",
    hardCoded: true,
  });
  addRow(assumptionRows.area, {
    section: "Property",
    label: "Area / Market",
    value: ctx.listingCity ?? "",
    source: "Hard coded from current OM workspace",
    hardCoded: true,
  });
  addRow(assumptionRows.units, {
    section: "Property",
    label: "Units",
    value: num(ctx.unitCount),
    valueNumFmt: INTEGER_FMT,
    units: "count",
    source: "Hard coded from extracted OM property data",
    hardCoded: true,
  });
  addRow(assumptionRows.dealScore, {
    section: "Property",
    label: "Deal score",
    value: ctx.dealScore ?? "",
    valueNumFmt: ctx.dealScore != null ? INTEGER_FMT : undefined,
    units: ctx.dealScore != null ? "points" : "",
    source: "Hard coded from live underwriting snapshot",
    hardCoded: true,
  });
  addRow(assumptionRows.investmentProfile, {
    section: "Acquisition Assumptions",
    label: "Investment profile",
    value: ctx.assumptions.acquisition.investmentProfile ?? "",
    source: "Hard coded user / profile assumption",
    hardCoded: true,
  });
  addRow(assumptionRows.targetAcquisitionDate, {
    section: "Acquisition Assumptions",
    label: "Target acquisition date",
    value: ctx.assumptions.acquisition.targetAcquisitionDate ?? "",
    valueNumFmt: ctx.assumptions.acquisition.targetAcquisitionDate ? DATE_FMT : undefined,
    source: "Hard coded user / profile assumption",
    hardCoded: true,
  });

  addRow(assumptionRows.purchasePrice, {
    section: "Acquisition Assumptions",
    label: "Purchase price",
    value: num(ctx.assumptions.acquisition.purchasePrice),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.purchaseClosingPct, {
    section: "CapEx / FF&E / Closing Cost Assumptions",
    label: "Purchase closing costs",
    value: percentAssumption(ctx.assumptions.acquisition.purchaseClosingCostPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.renovationCosts, {
    section: "CapEx / FF&E / Closing Cost Assumptions",
    label: "Renovation costs",
    value: num(ctx.assumptions.acquisition.renovationCosts),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.furnishingCosts, {
    section: "CapEx / FF&E / Closing Cost Assumptions",
    label: "Furnishing / setup costs",
    value: num(ctx.assumptions.acquisition.furnishingSetupCosts),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.onboardingCosts, {
    section: "CapEx / FF&E / Closing Cost Assumptions",
    label: "Onboarding / unit turn costs",
    value: num(ctx.assumptions.acquisition.onboardingCosts),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  addRow(assumptionRows.currentFreeMarketResidentialGrossRent, {
    section: "Rental Revenue Assumptions",
    label: "Current free-market residential gross rent",
    value: artifacts.currentRentBreakdown.freeMarketResidential,
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived rent breakdown",
    hardCoded: true,
  });
  addRow(assumptionRows.currentProtectedResidentialGrossRent, {
    section: "Rental Revenue Assumptions",
    label: "Current protected residential gross rent",
    value: artifacts.currentRentBreakdown.protectedResidential,
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived rent breakdown",
    hardCoded: true,
  });
  addRow(assumptionRows.currentCommercialGrossRent, {
    section: "Rental Revenue Assumptions",
    label: "Current commercial gross rent",
    value: artifacts.currentRentBreakdown.commercial,
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived rent breakdown",
    hardCoded: true,
  });
  addRow(assumptionRows.currentGrossRent, {
    section: "Rental Revenue Assumptions",
    label: "Current gross rent",
    value: "",
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Formula = residential + protected + commercial rent",
    formula: `${assumptionRef("currentFreeMarketResidentialGrossRent")}+${assumptionRef("currentProtectedResidentialGrossRent")}+${assumptionRef("currentCommercialGrossRent")}`,
    result:
      artifacts.currentRentBreakdown.freeMarketResidential +
      artifacts.currentRentBreakdown.protectedResidential +
      artifacts.currentRentBreakdown.commercial,
  });
  addRow(assumptionRows.currentOtherIncome, {
    section: "Rental Revenue Assumptions",
    label: "Current other income",
    value: num(ctx.currentOtherIncome),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived current income",
    hardCoded: true,
  });
  addRow(assumptionRows.currentExpenses, {
    section: "Operating Expense Assumptions",
    label: "Current operating expenses (ex management)",
    value: num(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived or reconstructed expense basis",
    hardCoded: true,
  });
  addRow(assumptionRows.currentNoiAdjustment, {
    section: "Rental Revenue Assumptions",
    label: "Projected vacant residential rent",
    value: Math.max(0, num(ctx.conservativeProjectedLeaseUpRent)),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source:
      "Hard coded add-back used only when the ask-cap / dossier current NOI includes delivered-vacant residential rent",
    hardCoded: true,
  });
  addRow(assumptionRows.currentNoi, {
    section: "Rental Revenue Assumptions",
    label: "Current NOI",
    value: "",
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Formula = gross rent + other income - current expenses + projected vacant residential rent",
    formula: `${assumptionRef("currentGrossRent")}+${assumptionRef("currentOtherIncome")}-${assumptionRef("currentExpenses")}+${assumptionRef("currentNoiAdjustment")}`,
    result: currentNoiResult(ctx, artifacts),
  });

  addRow(assumptionRows.ltvPct, {
    section: "Financing Assumptions",
    label: "Loan-to-value",
    value: percentAssumption(ctx.assumptions.financing.ltvPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.interestRatePct, {
    section: "Financing Assumptions",
    label: "Interest rate",
    value: percentAssumption(ctx.assumptions.financing.interestRatePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.amortizationYears, {
    section: "Financing Assumptions",
    label: "Amortization period",
    value: num(ctx.assumptions.financing.amortizationYears),
    valueNumFmt: INTEGER_FMT,
    units: "years",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.loanFeePct, {
    section: "Financing Assumptions",
    label: "Loan fee",
    value: percentAssumption(ctx.assumptions.financing.loanFeePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  addRow(assumptionRows.eligibleRevenueSharePct, {
    section: "Rental Revenue Assumptions",
    label: "Eligible revenue share",
    value: num(ctx.propertyMix?.eligibleRevenueSharePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded model input for blended uplift logic",
    hardCoded: true,
  });
  addRow(assumptionRows.rentUpliftPct, {
    section: "Rental Revenue Assumptions",
    label: "Rent uplift",
    value: percentAssumption(ctx.assumptions.operating.rentUpliftPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.blendedRentUpliftPct, {
    section: "Rental Revenue Assumptions",
    label: "Blended rent uplift",
    value: percentAssumption(ctx.assumptions.operating.blendedRentUpliftPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source:
      "Hard coded from the detailed unit underwriting / blended projected rent path used by the PDF dossier",
    hardCoded: true,
  });
  addRow(assumptionRows.expenseIncreasePct, {
    section: "Operating Expense Assumptions",
    label: "Expense increase",
    value: percentAssumption(ctx.assumptions.operating.expenseIncreasePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.managementFeePct, {
    section: "Operating Expense Assumptions",
    label: "Management fee",
    value: percentAssumption(ctx.assumptions.operating.managementFeePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.occupancyTaxPct, {
    section: "Operating Expense Assumptions",
    label: "Occupancy tax",
    value: percentAssumption(ctx.assumptions.operating.occupancyTaxPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.vacancyPct, {
    section: "Rental Revenue Assumptions",
    label: "Vacancy",
    value: percentAssumption(ctx.assumptions.operating.vacancyPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.leadTimeMonths, {
    section: "Rental Revenue Assumptions",
    label: "Lead time",
    value: num(ctx.assumptions.operating.leadTimeMonths),
    valueNumFmt: INTEGER_FMT,
    units: "months",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualRentGrowthPct, {
    section: "Rental Revenue Assumptions",
    label: "Annual free-market rent growth",
    value: percentAssumption(ctx.assumptions.operating.annualRentGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualCommercialRentGrowthPct, {
    section: "Rental Revenue Assumptions",
    label: "Annual commercial rent growth",
    value: percentAssumption(ctx.assumptions.operating.annualCommercialRentGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualOtherIncomeGrowthPct, {
    section: "Rental Revenue Assumptions",
    label: "Annual other-income growth",
    value: percentAssumption(ctx.assumptions.operating.annualOtherIncomeGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualExpenseGrowthPct, {
    section: "Operating Expense Assumptions",
    label: "Annual expense growth",
    value: percentAssumption(ctx.assumptions.operating.annualExpenseGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualPropertyTaxGrowthPct, {
    section: "Operating Expense Assumptions",
    label: "Annual property-tax growth",
    value: percentAssumption(ctx.assumptions.operating.annualPropertyTaxGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.recurringCapexAnnual, {
    section: "CapEx / FF&E / Closing Cost Assumptions",
    label: "Recurring CapEx / reserve",
    value: num(ctx.assumptions.operating.recurringCapexAnnual),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  addRow(assumptionRows.holdPeriodYears, {
    section: "Yield on Cost Assumptions",
    label: "Hold period",
    value: num(ctx.assumptions.holdPeriodYears),
    valueNumFmt: INTEGER_FMT,
    units: "years",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.exitCapPct, {
    section: "Yield on Cost Assumptions",
    label: "Exit cap rate",
    value: percentAssumption(ctx.assumptions.exit.exitCapPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.exitClosingCostPct, {
    section: "CapEx / FF&E / Closing Cost Assumptions",
    label: "Exit closing costs",
    value: percentAssumption(ctx.assumptions.exit.exitClosingCostPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.targetIrrPct, {
    section: "Yield on Cost Assumptions",
    label: "Target IRR",
    value: percentAssumption(ctx.assumptions.targetIrrPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  styledSectionTitle(
    worksheet,
    `A${EXPENSE_ASSUMPTION_HEADER_ROW - 1}`,
    `E${EXPENSE_ASSUMPTION_HEADER_ROW - 1}`,
    "Operating Expense Assumptions"
  );
  ["Expense Line", "Base Amount", "Annual Growth Rate", "Notes / Source"].forEach((label, index) => {
    const cell = worksheet.getCell(EXPENSE_ASSUMPTION_HEADER_ROW, index + 1);
    cell.value = label;
    cell.fill = COLUMN_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center" };
    applyBorder(cell);
  });

  artifacts.expenses.forEach((expense, index) => {
    const row = expenseAssumptionRow(index);
    const fallbackGrowth = isTaxExpense(expense.lineItem)
      ? percentAssumption(ctx.assumptions.operating.annualPropertyTaxGrowthPct)
      : percentAssumption(ctx.assumptions.operating.annualExpenseGrowthPct);
    const annualGrowth =
      expense.annualGrowthPct != null && Number.isFinite(expense.annualGrowthPct)
        ? percentAssumption(expense.annualGrowthPct)
        : fallbackGrowth;
    setSheetCell(worksheet, `A${row}`, expense.lineItem, {
      fill: HARD_CODED_FILL,
      font: HARD_CODED_FONT,
      alignment: { wrapText: true },
    });
    setSheetCell(worksheet, `B${row}`, num(expense.amount), {
      numFmt: CURRENCY_FMT,
      fill: HARD_CODED_FILL,
      font: HARD_CODED_FONT,
      alignment: { horizontal: "right" },
    });
    setSheetCell(worksheet, `C${row}`, annualGrowth, {
      numFmt: INPUT_PERCENT_FMT,
      fill: HARD_CODED_FILL,
      font: HARD_CODED_FONT,
      alignment: { horizontal: "right" },
    });
    setSheetCell(
      worksheet,
      `D${row}`,
      expense.annualGrowthPct != null && Number.isFinite(expense.annualGrowthPct)
        ? "Line-specific annual growth from detailed cash-flow model"
        : isTaxExpense(expense.lineItem)
          ? "Uses property-tax growth fallback"
          : "Uses operating-expense growth fallback",
      {
        fill: SOFT_FILL,
        font: NOTE_FONT,
        alignment: { wrapText: true },
      }
    );
    setSheetCell(worksheet, `E${row}`, "", { fill: SOFT_FILL });
  });

  const yocRows = yieldOnCostAssumptionRows(artifacts);
  styledSectionTitle(
    worksheet,
    `A${yocRows.longTermNoi - 2}`,
    `E${yocRows.longTermNoi - 2}`,
    "Yield on Cost Assumptions"
  );
  addRow(yocRows.longTermNoi, {
    section: "Yield on Cost Assumptions",
    label: "Stabilized long-term rental NOI",
    value: "",
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Formula linked to the current long-term NOI basis",
    formula: assumptionRef("currentNoi"),
    result: currentNoiResult(ctx, artifacts),
  });
  addRow(yocRows.midTermNoi, {
    section: "Yield on Cost Assumptions",
    label: "Stabilized mid-term rental NOI",
    value: "",
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Formula linked to CashFlowModel calculated stabilized NOI",
    formula: quotedSheetRef("CashFlowModel", `$B$${artifacts.cashFlowRows.calculatedStabilizedNoi}`),
    result: ctx.operating.stabilizedNoi,
    linkedFormula: true,
  });

}

function buildFinancingModelSheet(
  workbook: ExcelJS.Workbook,
  ctx: UnderwritingContext
): void {
  const worksheet = workbook.addWorksheet("FinancingModel");
  worksheet.views = [{ state: "frozen", ySplit: financingRows.amortizationStart - 1, showGridLines: false }];
  worksheet.columns = [
    { width: 24 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  worksheet.mergeCells("A1:F1");
  setSheetCell(worksheet, "A1", "Financing Model", {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left" },
  });

  setSheetCell(worksheet, "A2", "Loan amount", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B2", `${assumptionRef("purchasePrice")}*${assumptionRef("ltvPct")}`, {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: ctx.financing.loanAmount,
  });
  setSheetCell(worksheet, "A3", "Financing fees", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B3", `B2*${assumptionRef("loanFeePct")}`, {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: ctx.financing.financingFees ?? 0,
  });
  setSheetCell(worksheet, "A4", "Purchase closing costs", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B4", `${assumptionRef("purchasePrice")}*${assumptionRef("purchaseClosingPct")}`, {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: ctx.acquisition.purchaseClosingCosts,
  });
  setSheetCell(worksheet, "A5", "Total project cost", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B5", `SUM(${assumptionRef("purchasePrice")},B4,${assumptionRef("renovationCosts")},${assumptionRef("furnishingCosts")},${assumptionRef("onboardingCosts")})`, {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: ctx.acquisition.totalProjectCost,
  });
  setSheetCell(worksheet, "A6", "Initial equity invested", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B6", "B5+B3-B2", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.acquisition.initialEquityInvested,
  });
  setSheetCell(worksheet, "A7", "Monthly interest rate", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B7", `${assumptionRef("interestRatePct")}/${MONTHS_PER_YEAR}`, {
    numFmt: "0.0000%",
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: num(ctx.assumptions.financing.interestRatePct) / 100 / 12,
  });
  setSheetCell(worksheet, "A8", "Total amortization months", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B8", `${assumptionRef("amortizationYears")}*${MONTHS_PER_YEAR}`, {
    numFmt: INTEGER_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: num(ctx.assumptions.financing.amortizationYears) * 12,
  });
  setSheetCell(worksheet, "A9", "Monthly payment", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B9", "IF(OR(B2=0,B8=0),0,IF(B7=0,B2/B8,-PMT(B7,B8,B2)))", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.financing.monthlyPayment,
  });
  setSheetCell(worksheet, "A10", "Annual debt service", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B10", `B9*${MONTHS_PER_YEAR}`, {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.financing.annualDebtService,
  });
  setSheetCell(worksheet, "A11", "Total capitalization", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B11", "B5+B3", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.acquisition.totalProjectCost + num(ctx.financing.financingFees),
  });

  const headerRow = financingRows.amortizationStart - 1;
  ["Year", "Beginning balance", "Debt service", "Principal paid", "Interest paid", "Ending balance"].forEach(
    (label, index) => {
      setSheetCell(worksheet, `${columnLetter(index + 1)}${headerRow}`, label, {
        fill: COLUMN_FILL,
        font: HEADER_FONT,
        alignment: { horizontal: "center" },
      });
    }
  );

  const monthlyStart = monthlyDebtRows.start;
  const monthlyEnd = monthlyDebtEndRow();
  for (let year = 1; year <= MAX_MODEL_YEARS; year += 1) {
    const row = financingRows.amortizationStart + year - 1;
    setSheetCell(worksheet, `A${row}`, year, {
      numFmt: INTEGER_FMT,
      fill: SOFT_FILL,
      alignment: { horizontal: "center" },
    });
    setFormulaCell(
      worksheet,
      `B${row}`,
      year === 1
        ? "$B$2"
        : `IFERROR(INDEX(MonthlyDebt!$H$${monthlyStart}:$H$${monthlyEnd},MATCH((A${row}-1)*${MONTHS_PER_YEAR},MonthlyDebt!$A$${monthlyStart}:$A$${monthlyEnd},0)),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `C${row}`,
      `SUMIFS(MonthlyDebt!$F$${monthlyStart}:$F$${monthlyEnd},MonthlyDebt!$I$${monthlyStart}:$I$${monthlyEnd},A${row})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `D${row}`,
      `SUMIFS(MonthlyDebt!$G$${monthlyStart}:$G$${monthlyEnd},MonthlyDebt!$I$${monthlyStart}:$I$${monthlyEnd},A${row})`,
      {
        numFmt: CURRENCY_FMT,
        fill: FORMULA_FILL,
        font: LINKED_FORMULA_FONT,
      }
    );
    setFormulaCell(
      worksheet,
      `E${row}`,
      `SUMIFS(MonthlyDebt!$E$${monthlyStart}:$E$${monthlyEnd},MonthlyDebt!$I$${monthlyStart}:$I$${monthlyEnd},A${row})`,
      {
        numFmt: CURRENCY_FMT,
        fill: FORMULA_FILL,
        font: LINKED_FORMULA_FONT,
      }
    );
    setFormulaCell(worksheet, `F${row}`, `IFERROR(INDEX(MonthlyDebt!$H$${monthlyStart}:$H$${monthlyEnd},MATCH(MIN(A${row}*${MONTHS_PER_YEAR},$B$8),MonthlyDebt!$A$${monthlyStart}:$A$${monthlyEnd},0)),0)`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
    });
  }
}

function buildMonthlyDebtSheet(workbook: ExcelJS.Workbook): void {
  const worksheet = workbook.addWorksheet("MonthlyDebt");
  worksheet.views = [{ state: "frozen", ySplit: monthlyDebtRows.header, showGridLines: false }];
  worksheet.columns = [
    { width: 12 },
    { width: 14 },
    { width: 18 },
    { width: 14 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
    { width: 18 },
    { width: 10 },
  ];

  worksheet.mergeCells("A1:I1");
  setSheetCell(worksheet, "A1", "Monthly Debt Schedule", {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left" },
  });
  worksheet.mergeCells("A2:I2");
  setSheetCell(
    worksheet,
    "A2",
    "Monthly loan mechanics feed the annual FinancingModel summary through SUMIFS, so debt service, interest, principal, and ending balance are traceable month by month.",
    {
      fill: SOFT_FILL,
      font: NOTE_FONT,
      alignment: { wrapText: true, vertical: "top" },
    }
  );
  worksheet.getRow(2).height = 36;

  [
    "Month #",
    "Date / Period",
    "Beginning Loan Balance",
    "Interest Rate",
    "Monthly Interest",
    "Monthly Debt Service",
    "Principal Amortization",
    "Ending Loan Balance",
    "Year",
  ].forEach((label, index) => {
    setSheetCell(worksheet, `${columnLetter(index + 1)}${monthlyDebtRows.header}`, label, {
      fill: COLUMN_FILL,
      font: HEADER_FONT,
      alignment: { horizontal: "center", wrapText: true },
    });
  });

  for (let month = 1; month <= monthlyDebtRows.maxMonths; month += 1) {
    const row = monthlyDebtRows.start + month - 1;
    const previousRow = row - 1;
    setSheetCell(worksheet, `A${row}`, month, {
      numFmt: INTEGER_FMT,
      fill: SOFT_FILL,
      alignment: { horizontal: "center" },
    });
    setFormulaCell(worksheet, `B${row}`, `IF(A${row}>FinancingModel!$B$8,"","Month "&A${row})`, {
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
      alignment: { horizontal: "center" },
    });
    setFormulaCell(
      worksheet,
      `C${row}`,
      month === 1
        ? `IF(A${row}>FinancingModel!$B$8,0,FinancingModel!$B$2)`
        : `IF(A${row}>FinancingModel!$B$8,0,H${previousRow})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(worksheet, `D${row}`, assumptionRef("interestRatePct"), {
      numFmt: PERCENT_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
    });
    setFormulaCell(worksheet, `E${row}`, `IF(OR(A${row}>FinancingModel!$B$8,C${row}=0),0,C${row}*(D${row}/${MONTHS_PER_YEAR}))`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
    });
    setFormulaCell(worksheet, `F${row}`, `IF(OR(A${row}>FinancingModel!$B$8,C${row}=0),0,MIN(FinancingModel!$B$9,C${row}+E${row}))`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
    });
    setFormulaCell(worksheet, `G${row}`, `IF(OR(A${row}>FinancingModel!$B$8,C${row}=0),0,MAX(0,MIN(C${row},F${row}-E${row})))`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
    });
    setFormulaCell(worksheet, `H${row}`, `MAX(0,C${row}-G${row})`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
    });
    setFormulaCell(worksheet, `I${row}`, `ROUNDUP(A${row}/${MONTHS_PER_YEAR},0)`, {
      numFmt: INTEGER_FMT,
      fill: FORMULA_FILL,
    });
  }
}

function isTaxExpense(lineItem: string): boolean {
  return /tax/i.test(lineItem);
}

function isOccupancyTaxExpense(lineItem: string): boolean {
  return /occupancy\s*tax/i.test(lineItem);
}

function buildCashFlowModelSheet(
  workbook: ExcelJS.Workbook,
  ctx: UnderwritingContext,
  artifacts: WorkbookBuildArtifacts
): void {
  const worksheet = workbook.addWorksheet("CashFlowModel");
  worksheet.views = [{ state: "frozen", ySplit: 5, xSplit: 2, showGridLines: false }];
  worksheet.columns = [
    { width: 30 },
    { width: 14 },
    ...Array.from({ length: MAX_MODEL_YEARS + 1 }, () => ({ width: 14 })),
  ];

  const rows = artifacts.cashFlowRows;
  const holdPeriodRef = assumptionRef("holdPeriodYears");
  const leadTimeMonthsRef = assumptionRef("leadTimeMonths");
  const lastModelColumn = columnLetter(CASH_FLOW_YEAR0_COLUMN + MAX_MODEL_YEARS);

  worksheet.mergeCells("A1:F1");
  setSheetCell(worksheet, "A1", "Cash Flow Model", {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left" },
  });

  setSheetCell(worksheet, "A3", "Hold period", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B3", holdPeriodRef, {
    numFmt: INTEGER_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: num(ctx.assumptions.holdPeriodYears),
  });

  setSheetCell(worksheet, "A5", "Line item", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "B5", "Driver", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  for (let yearIndex = 0; yearIndex <= MAX_MODEL_YEARS; yearIndex += 1) {
    const column = columnLetter(CASH_FLOW_YEAR0_COLUMN + yearIndex);
    setSheetCell(worksheet, `${column}5`, yearIndex, {
      numFmt: INTEGER_FMT,
      fill: COLUMN_FILL,
      font: HEADER_FONT,
      alignment: { horizontal: "center" },
    });
  }

  setSheetCell(worksheet, "A6", "Property value", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B6", assumptionRef("annualRentGrowthPct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
  });
  setSheetCell(worksheet, "A7", "Gross rental income", { font: LABEL_FONT });
  setSheetCell(worksheet, "A8", "Free-market residential gross rent", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B8", assumptionRef("blendedRentUpliftPct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
    result: num(ctx.assumptions.operating.blendedRentUpliftPct) / 100,
  });
  setSheetCell(worksheet, "A9", "RS / RC residential gross rent", { font: LABEL_FONT });
  setSheetCell(worksheet, "B9", "Flat", {
    fill: SOFT_FILL,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "A10", "Commercial gross rent", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B10", assumptionRef("annualCommercialRentGrowthPct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
  });
  setSheetCell(worksheet, "A11", "Other income", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B11", assumptionRef("annualOtherIncomeGrowthPct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
  });
  setSheetCell(worksheet, "A12", "Vacancy assumption", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B12", assumptionRef("vacancyPct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
  });
  setSheetCell(worksheet, "A13", "Lead time assumption", { font: LABEL_FONT });
  setSheetCell(worksheet, "B13", "Year 1 only", {
    fill: SOFT_FILL,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "A14", "Net rental income", {
    fill: COLUMN_FILL,
    font: LABEL_FONT,
  });

  styledSectionTitle(worksheet, "A16", "B16", "Expenses");
  artifacts.expenses.forEach((expense, index) => {
    const row = rows.expenseStart + index;
    setSheetCell(worksheet, `A${row}`, expense.lineItem, { font: LABEL_FONT });
    if (isOccupancyTaxExpense(expense.lineItem)) {
      setFormulaCell(worksheet, `B${row}`, assumptionRef("occupancyTaxPct"), {
        numFmt: PERCENT_FMT,
        fill: FORMULA_FILL,
        font: LINKED_FORMULA_FONT,
      });
    } else {
      setFormulaCell(worksheet, `B${row}`, expenseGrowthRef(index), {
        numFmt: PERCENT_FMT,
        fill: FORMULA_FILL,
        font: LINKED_FORMULA_FONT,
      });
    }
  });

  setSheetCell(worksheet, `A${rows.management}`, "Management fee", { font: LABEL_FONT });
  setFormulaCell(worksheet, `B${rows.management}`, assumptionRef("managementFeePct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
  });
  setSheetCell(worksheet, `A${rows.totalOperatingExpenses}`, "Total operating expenses", {
    fill: COLUMN_FILL,
    font: LABEL_FONT,
  });
  setSheetCell(worksheet, `A${rows.noi}`, "Net operating income (NOI)", {
    fill: COLUMN_FILL,
    font: LABEL_FONT,
  });
  setSheetCell(worksheet, `A${rows.recurringCapex}`, "Recurring CapEx / reserve", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.cashFlowFromOperations}`, "Unlevered CF after reserves", {
    fill: COLUMN_FILL,
    font: LABEL_FONT,
  });
  setSheetCell(worksheet, `A${rows.capRate}`, "Cap rate (purchase price)", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.debtService}`, "Total debt service", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.principal}`, "Principal paydown", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.interest}`, "Interest expense", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.cashFlowAfterFinancing}`, "Levered CF to equity", {
    fill: COLUMN_FILL,
    font: LABEL_FONT,
  });
  setSheetCell(worksheet, `A${rows.totalInvestmentCost}`, "Total investment cost", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.saleValue}`, "Sale value", { font: LABEL_FONT });
  setFormulaCell(worksheet, `B${rows.saleValue}`, assumptionRef("exitCapPct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
  });
  setSheetCell(worksheet, `A${rows.saleClosingCosts}`, "Closing costs @ sale", { font: LABEL_FONT });
  setFormulaCell(worksheet, `B${rows.saleClosingCosts}`, assumptionRef("exitClosingCostPct"), {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    font: LINKED_FORMULA_FONT,
  });
  setSheetCell(worksheet, `A${rows.reserveRelease}`, "Reserve release at exit", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.unleveredCashFlow}`, "Unlevered CF", {
    fill: COLUMN_FILL,
    font: LABEL_FONT,
  });
  setSheetCell(worksheet, `A${rows.financingFunding}`, "Financing funding", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.financingFees}`, "Financing fees", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.financingPayoff}`, "Financing payoff", { font: LABEL_FONT });
  setSheetCell(worksheet, `A${rows.leveredCashFlow}`, "Total levered CF incl. exit", {
    fill: COLUMN_FILL,
    font: LABEL_FONT,
  });

  for (let yearIndex = 0; yearIndex <= MAX_MODEL_YEARS; yearIndex += 1) {
    const year = yearIndex;
    const column = columnLetter(CASH_FLOW_YEAR0_COLUMN + yearIndex);
    const activeOperatingCondition = `OR(${column}$5=0,${column}$5>${holdPeriodRef})`;
    const activeYearCondition = `${column}$5<=${holdPeriodRef}`;

    setFormulaCell(
      worksheet,
      `${column}${rows.propertyValue}`,
      `IF(${column}$5=0,${assumptionRef("purchasePrice")},IF(${activeYearCondition},${assumptionRef("purchasePrice")}*(1+${assumptionRef("annualRentGrowthPct")})^${column}$5,0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.freeMarketResidential}`,
      `IF(${activeOperatingCondition},0,${assumptionRef("currentFreeMarketResidentialGrossRent")}*(1+${assumptionRef("blendedRentUpliftPct")})*(1+${assumptionRef("annualRentGrowthPct")})^(${column}$5-1))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.protectedResidential}`,
      `IF(${activeOperatingCondition},0,${assumptionRef("currentProtectedResidentialGrossRent")})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.commercial}`,
      `IF(${activeOperatingCondition},0,${assumptionRef("currentCommercialGrossRent")}*(1+${assumptionRef("annualCommercialRentGrowthPct")})^(${column}$5-1))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.grossRentalIncome}`,
      `IF(${activeOperatingCondition},0,${column}${rows.freeMarketResidential}+${column}${rows.protectedResidential}+${column}${rows.commercial})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.otherIncome}`,
      `IF(${activeOperatingCondition},0,${assumptionRef("currentOtherIncome")}*(1+${assumptionRef("annualOtherIncomeGrowthPct")})^(${column}$5-1))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.vacancy}`,
      `IF(${activeOperatingCondition},0,-${column}${rows.grossRentalIncome}*${assumptionRef("vacancyPct")})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.leadTime}`,
      `IF(${column}$5=1,-${column}${rows.grossRentalIncome}*(${leadTimeMonthsRef}/${MONTHS_PER_YEAR}),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.netRentalIncome}`,
      `${column}${rows.grossRentalIncome}+${column}${rows.otherIncome}+${column}${rows.vacancy}+${column}${rows.leadTime}`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );

    artifacts.expenses.forEach((expense, index) => {
      const row = rows.expenseStart + index;
      const growthRef =
        isOccupancyTaxExpense(expense.lineItem)
          ? assumptionRef("occupancyTaxPct")
          : expenseGrowthRef(index);
      const projectedValue =
        year > 0 && Array.isArray(expense.yearlyAmounts)
          ? expense.yearlyAmounts[year - 1] ?? 0
          : undefined;
      const baseAmountFormula = artifacts.aggregateExpenseFallback
        ? `${expenseBaseAmountRef(index)}*(1+${assumptionRef("expenseIncreasePct")})`
        : expenseBaseAmountRef(index);
      const expenseFormula = isOccupancyTaxExpense(expense.lineItem)
        ? `IF(${activeOperatingCondition},0,-MAX(0,${column}${rows.grossRentalIncome}+${column}${rows.vacancy}+${column}${rows.leadTime})*${growthRef})`
        : `IF(${activeOperatingCondition},0,-(${baseAmountFormula})*((1+${growthRef})^(${column}$5-1)))`;

      setFormulaCell(worksheet, `${column}${row}`, expenseFormula, {
        numFmt: CURRENCY_FMT,
        fill: FORMULA_FILL,
        font: LINKED_FORMULA_FONT,
        result: projectedValue == null ? undefined : -Math.abs(projectedValue),
      });
    });

    setFormulaCell(
      worksheet,
      `${column}${rows.management}`,
      `IF(${activeOperatingCondition},0,-MAX(0,${column}${rows.grossRentalIncome}+${column}${rows.vacancy}+${column}${rows.leadTime})*${assumptionRef("managementFeePct")})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.totalOperatingExpenses}`,
      `IF(${activeOperatingCondition},0,SUM(${column}${rows.expenseStart}:${column}${rows.management}))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.noi}`,
      `IF(${activeOperatingCondition},0,${column}${rows.netRentalIncome}+${column}${rows.totalOperatingExpenses})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.recurringCapex}`,
      `IF(${activeOperatingCondition},0,-${assumptionRef("recurringCapexAnnual")})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.cashFlowFromOperations}`,
      `IF(${activeOperatingCondition},0,${column}${rows.noi}+${column}${rows.recurringCapex})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.capRate}`,
      `IF(${activeOperatingCondition},"",IF(${assumptionRef("purchasePrice")}=0,0,${column}${rows.noi}/${assumptionRef("purchasePrice")}))`,
      { numFmt: PERCENT_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.debtService}`,
      `IF(${activeOperatingCondition},0,-IFERROR(INDEX(FinancingModel!$C$${financingRows.amortizationStart}:$C$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.principal}`,
      `IF(${activeOperatingCondition},0,-IFERROR(INDEX(FinancingModel!$D$${financingRows.amortizationStart}:$D$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.interest}`,
      `IF(${activeOperatingCondition},0,-IFERROR(INDEX(FinancingModel!$E$${financingRows.amortizationStart}:$E$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.cashFlowAfterFinancing}`,
      `IF(${activeOperatingCondition},0,${column}${rows.cashFlowFromOperations}+${column}${rows.debtService})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(worksheet, `${column}${rows.totalInvestmentCost}`, `IF(${column}$5=0,-FinancingModel!$B$5,0)`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
    });
    setFormulaCell(
      worksheet,
      `${column}${rows.saleValue}`,
      `IF(${column}$5=${holdPeriodRef},IF(${assumptionRef("exitCapPct")}=0,0,${column}${rows.noi}/${assumptionRef("exitCapPct")}),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.saleClosingCosts}`,
      `IF(${column}$5=${holdPeriodRef},-${column}${rows.saleValue}*${assumptionRef("exitClosingCostPct")},0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.reserveRelease}`,
      `IF(${column}$5=${holdPeriodRef},-SUM($C${rows.recurringCapex}:${column}${rows.recurringCapex}),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.unleveredCashFlow}`,
      `${column}${rows.cashFlowFromOperations}+${column}${rows.reserveRelease}+${column}${rows.saleValue}+${column}${rows.saleClosingCosts}+${column}${rows.totalInvestmentCost}`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(worksheet, `${column}${rows.financingFunding}`, `IF(${column}$5=0,FinancingModel!$B$2,0)`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
    });
    setFormulaCell(worksheet, `${column}${rows.financingFees}`, `IF(${column}$5=0,-FinancingModel!$B$3,0)`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
    });
    setFormulaCell(
      worksheet,
      `${column}${rows.financingPayoff}`,
      `IF(${column}$5=${holdPeriodRef},-IFERROR(INDEX(FinancingModel!$F$${financingRows.amortizationStart}:$F$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.leveredCashFlow}`,
      `${column}${rows.cashFlowAfterFinancing}+${column}${rows.totalInvestmentCost}+${column}${rows.reserveRelease}+${column}${rows.saleValue}+${column}${rows.saleClosingCosts}+${column}${rows.financingFunding}+${column}${rows.financingFees}+${column}${rows.financingPayoff}`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
  }

  setSheetCell(worksheet, `A${rows.calculatedStabilizedNoi}`, "Calculated stabilized NOI", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedStabilizedNoi}`,
    `INDEX($C${rows.noi}:${lastModelColumn}${rows.noi},1,IF(${leadTimeMonthsRef}>0,MIN(${holdPeriodRef},2),MIN(${holdPeriodRef},1))+1)`,
    { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT, result: ctx.operating.stabilizedNoi }
  );
  setSheetCell(worksheet, `A${rows.calculatedGrossSaleValue}`, "Calculated gross sale value", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedGrossSaleValue}`,
    `INDEX($C${rows.saleValue}:${lastModelColumn}${rows.saleValue},1,${holdPeriodRef}+1)`,
    { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT, result: ctx.exit.exitPropertyValue }
  );
  setSheetCell(worksheet, `A${rows.calculatedNetSaleValue}`, "Calculated net sale value", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedNetSaleValue}`,
    `INDEX($C${rows.saleValue}:${lastModelColumn}${rows.saleValue},1,${holdPeriodRef}+1)+INDEX($C${rows.saleClosingCosts}:${lastModelColumn}${rows.saleClosingCosts},1,${holdPeriodRef}+1)`,
    {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
      result: ctx.exit.netSaleProceedsBeforeDebtPayoff,
    }
  );
  setSheetCell(worksheet, `A${rows.calculatedUnleveredIrr}`, "Calculated unlevered IRR", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedUnleveredIrr}`,
    `IFERROR(IRR($C$${rows.unleveredCashFlow}:INDEX($C$${rows.unleveredCashFlow}:$${lastModelColumn}$${rows.unleveredCashFlow},1,${holdPeriodRef}+1)),"")`,
    { numFmt: PERCENT_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT }
  );
  setSheetCell(worksheet, `A${rows.calculatedLeveredIrr}`, "Calculated levered IRR", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedLeveredIrr}`,
    `IFERROR(IRR($C$${rows.leveredCashFlow}:INDEX($C$${rows.leveredCashFlow}:$${lastModelColumn}$${rows.leveredCashFlow},1,${holdPeriodRef}+1)),"")`,
    { numFmt: PERCENT_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT, result: ctx.returns.irrPct ?? undefined }
  );
  setSheetCell(worksheet, `A${rows.calculatedAverageCashOnCash}`, "Calculated average cash-on-cash", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedAverageCashOnCash}`,
    `IF(OR(FinancingModel!$B$6=0,${holdPeriodRef}=0),0,(SUM($D$${rows.noi}:INDEX($D$${rows.noi}:$${lastModelColumn}$${rows.noi},1,${holdPeriodRef}))+SUM($D$${rows.debtService}:INDEX($D$${rows.debtService}:$${lastModelColumn}$${rows.debtService},1,${holdPeriodRef})))/(${holdPeriodRef}*FinancingModel!$B$6))`,
    { numFmt: PERCENT_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT, result: ctx.returns.averageCashOnCashReturn ?? undefined }
  );
  setSheetCell(worksheet, `A${rows.calculatedEquityMultiple}`, "Calculated equity multiple", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedEquityMultiple}`,
    `IF(FinancingModel!$B$6=0,0,SUMPRODUCT(($D$${rows.leveredCashFlow}:INDEX($D$${rows.leveredCashFlow}:$${lastModelColumn}$${rows.leveredCashFlow},1,${holdPeriodRef})>0)*$D$${rows.leveredCashFlow}:INDEX($D$${rows.leveredCashFlow}:$${lastModelColumn}$${rows.leveredCashFlow},1,${holdPeriodRef}))/FinancingModel!$B$6)`,
    { numFmt: MULTIPLE_FMT, fill: FORMULA_FILL, font: LINKED_FORMULA_FONT, result: ctx.returns.equityMultiple ?? undefined }
  );
}

function summaryMetricDefinitions(
  ctx: UnderwritingContext,
  artifacts: WorkbookBuildArtifacts
): Record<DealAnalysisSummaryMetricKey, SummaryMetricDefinition> {
  const unleveredReturn = ctx.cashFlows.unleveredCashFlowSeries
    ? computeIrr({
        equityCashFlows: ctx.cashFlows.unleveredCashFlowSeries,
      })
    : null;

  return {
    address: {
      label: "Address",
      formula: assumptionRef("address"),
      result: ctx.canonicalAddress,
    },
    area: {
      label: "Area",
      formula: assumptionRef("area"),
      result: ctx.listingCity ?? "",
    },
    units: {
      label: "Units",
      formula: assumptionRef("units"),
      result: num(ctx.unitCount),
      numFmt: INTEGER_FMT,
    },
    deal_score: {
      label: "Deal score",
      formula: assumptionRef("dealScore"),
      result: ctx.dealScore ?? "",
      numFmt: INTEGER_FMT,
    },
    investment_profile: {
      label: "Investment profile",
      formula: assumptionRef("investmentProfile"),
      result: ctx.assumptions.acquisition.investmentProfile ?? "",
    },
    target_acquisition_date: {
      label: "Target acquisition",
      formula: assumptionRef("targetAcquisitionDate"),
      result: ctx.assumptions.acquisition.targetAcquisitionDate ?? "",
      numFmt: ctx.assumptions.acquisition.targetAcquisitionDate ? DATE_FMT : undefined,
    },
    purchase_price: {
      label: "Purchase price",
      formula: assumptionRef("purchasePrice"),
      result: num(ctx.assumptions.acquisition.purchasePrice),
      numFmt: CURRENCY_FMT,
    },
    total_capitalization: {
      label: "Total capitalization",
      formula: "FinancingModel!$B$11",
      result: ctx.acquisition.totalProjectCost + num(ctx.financing.financingFees),
      numFmt: CURRENCY_FMT,
    },
    loan_amount: {
      label: "Loan amount",
      formula: "FinancingModel!$B$2",
      result: ctx.financing.loanAmount,
      numFmt: CURRENCY_FMT,
    },
    cash_required: {
      label: "Cash required",
      formula: "FinancingModel!$B$6",
      result: ctx.acquisition.initialEquityInvested,
      numFmt: CURRENCY_FMT,
    },
    current_gross_rent: {
      label: "Current gross rent",
      formula: assumptionRef("currentGrossRent"),
      result:
        artifacts.currentRentBreakdown.freeMarketResidential +
        artifacts.currentRentBreakdown.protectedResidential +
        artifacts.currentRentBreakdown.commercial,
      numFmt: CURRENCY_FMT,
    },
    current_noi: {
      label: "Current NOI",
      formula: assumptionRef("currentNoi"),
      result: currentNoiResult(ctx, artifacts),
      numFmt: CURRENCY_FMT,
    },
    stabilized_noi: {
      label: "Stabilized NOI",
      formula: `CashFlowModel!$B$${artifacts.cashFlowRows.calculatedStabilizedNoi}`,
      result: ctx.operating.stabilizedNoi,
      numFmt: CURRENCY_FMT,
    },
    hold_period: {
      label: "Hold period",
      formula: assumptionRef("holdPeriodYears"),
      result: num(ctx.assumptions.holdPeriodYears),
      numFmt: INTEGER_FMT,
    },
    exit_cap: {
      label: "Exit cap rate",
      formula: assumptionRef("exitCapPct"),
      result: num(ctx.assumptions.exit.exitCapPct) / 100,
      numFmt: PERCENT_FMT,
    },
    gross_sale_value: {
      label: "Gross sale value",
      formula: `CashFlowModel!$B$${artifacts.cashFlowRows.calculatedGrossSaleValue}`,
      result: ctx.exit.exitPropertyValue,
      numFmt: CURRENCY_FMT,
    },
    net_sale_value: {
      label: "Net sale value",
      formula: `CashFlowModel!$B$${artifacts.cashFlowRows.calculatedNetSaleValue}`,
      result: ctx.exit.netSaleProceedsBeforeDebtPayoff,
      numFmt: CURRENCY_FMT,
    },
    levered_irr: {
      label: "Levered IRR",
      formula: `CashFlowModel!$B$${artifacts.cashFlowRows.calculatedLeveredIrr}`,
      result: ctx.returns.irrPct ?? undefined,
      numFmt: PERCENT_FMT,
    },
    unlevered_irr: {
      label: "Unlevered IRR",
      formula: `CashFlowModel!$B$${artifacts.cashFlowRows.calculatedUnleveredIrr}`,
      result: unleveredReturn?.irr ?? undefined,
      numFmt: PERCENT_FMT,
    },
    avg_cash_on_cash: {
      label: "Avg cash-on-cash",
      formula: `CashFlowModel!$B$${artifacts.cashFlowRows.calculatedAverageCashOnCash}`,
      result: ctx.returns.averageCashOnCashReturn ?? undefined,
      numFmt: PERCENT_FMT,
    },
    equity_multiple: {
      label: "Equity multiple",
      formula: `CashFlowModel!$B$${artifacts.cashFlowRows.calculatedEquityMultiple}`,
      result: ctx.returns.equityMultiple ?? undefined,
      numFmt: MULTIPLE_FMT,
    },
    target_irr: {
      label: "Target IRR",
      formula: assumptionRef("targetIrrPct"),
      result: num(ctx.assumptions.targetIrrPct) / 100,
      numFmt: PERCENT_FMT,
    },
    ltr_yield: {
      label: "LTR yield (current cap)",
      formula: `IF(${assumptionRef("purchasePrice")}=0,"",${assumptionRef("currentNoi")}/${assumptionRef("purchasePrice")})`,
      result: ctx.assetCapRate != null ? ctx.assetCapRate / 100 : undefined,
      numFmt: PERCENT_FMT,
    },
    mtr_yield: {
      label: "MTR yield (stabilized cap)",
      formula: `IF(${assumptionRef("purchasePrice")}=0,"",CashFlowModel!$B$${artifacts.cashFlowRows.calculatedStabilizedNoi}/${assumptionRef("purchasePrice")})`,
      result: ctx.adjustedCapRate != null ? ctx.adjustedCapRate / 100 : undefined,
      numFmt: PERCENT_FMT,
    },
    mtr_spread: {
      label: "MTR vs LTR spread",
      formula: `IF(${assumptionRef("purchasePrice")}=0,"",(CashFlowModel!$B$${artifacts.cashFlowRows.calculatedStabilizedNoi}-${assumptionRef("currentNoi")})/${assumptionRef("purchasePrice")})`,
      result:
        ctx.assetCapRate != null && ctx.adjustedCapRate != null
          ? (ctx.adjustedCapRate - ctx.assetCapRate) / 100
          : undefined,
      numFmt: PERCENT_FMT,
    },
  };
}

function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  ctx: UnderwritingContext,
  blueprint: DealAnalysisWorkbookBlueprint,
  artifacts: WorkbookBuildArtifacts
): void {
  const worksheet = workbook.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 19, xSplit: 2, showGridLines: false }],
  });
  worksheet.columns = [
    { width: 26 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 3 },
    { width: 26 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    ...Array.from({ length: MAX_MODEL_YEARS + 1 }, () => ({ width: 14 })),
  ];

  const definitions = summaryMetricDefinitions(ctx, artifacts);

  worksheet.mergeCells("A1:J1");
  setSheetCell(worksheet, "A1", blueprint.workbookTitle, {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left", vertical: "middle" },
  });
  worksheet.mergeCells("A2:J2");
  setSheetCell(worksheet, "A2", blueprint.summarySubtitle, {
    fill: SOFT_FILL,
    font: NOTE_FONT,
    alignment: { wrapText: true, vertical: "middle" },
  });
  worksheet.getRow(2).height = 32;

  const boxStarts = [
    { row: 4, col: 1 },
    { row: 4, col: 6 },
    { row: 10, col: 1 },
    { row: 10, col: 6 },
  ];

  blueprint.summaryBoxes.forEach((box, index) => {
    const start = boxStarts[index]!;
    const startCol = columnLetter(start.col);
    const endCol = columnLetter(start.col + 3);
    worksheet.mergeCells(`${startCol}${start.row}:${endCol}${start.row}`);
    setSheetCell(worksheet, `${startCol}${start.row}`, box.title, {
      fill: SECTION_FILL,
      font: SECTION_FONT,
      alignment: { horizontal: "left", vertical: "middle" },
    });

    box.metricKeys.forEach((metricKey, metricIndex) => {
      const definition = definitions[metricKey];
      const row = start.row + metricIndex + 1;
      const labelStart = columnLetter(start.col);
      const labelEnd = columnLetter(start.col + 1);
      const valueStart = columnLetter(start.col + 2);
      const valueEnd = columnLetter(start.col + 3);
      worksheet.mergeCells(`${labelStart}${row}:${labelEnd}${row}`);
      worksheet.mergeCells(`${valueStart}${row}:${valueEnd}${row}`);
      setSheetCell(worksheet, `${labelStart}${row}`, definition.label, {
        font: LABEL_FONT,
        fill: SOFT_FILL,
      });
      setFormulaCell(worksheet, `${valueStart}${row}`, definition.formula, {
        result: definition.result,
        numFmt: definition.numFmt,
        fill: FORMULA_FILL,
        font: LINKED_FORMULA_FONT,
        alignment: definition.numFmt ? { horizontal: "right" } : definition.alignment,
      });
      for (let current = start.col; current <= start.col + 3; current += 1) {
        applyBorder(worksheet.getCell(`${columnLetter(current)}${row}`));
      }
    });
  });

  worksheet.mergeCells("A16:J16");
  setSheetCell(
    worksheet,
    "A16",
    "Blue text on the Assumptions tab marks hard-coded editable inputs; yellow fill marks key assumptions to review. Summary formulas use direct visible references into Assumptions, FinancingModel, MonthlyDebt, and CashFlowModel.",
    {
      fill: SOFT_FILL,
      font: NOTE_FONT,
      alignment: { wrapText: true },
    }
  );

  const summaryYieldSignals = computeYieldSignals({
    ltrYieldPct: ctx.assetCapRate,
    mtrYieldPct: ctx.adjustedCapRate,
  });
  if (summaryYieldSignals.calloutLabel) {
    worksheet.mergeCells("A17:J17");
    setSheetCell(worksheet, "A17", `Yield check: ${summaryYieldSignals.calloutLabel}`, {
      fill: SOFT_FILL,
      font: NOTE_FONT,
      alignment: { wrapText: true },
    });
  }

  worksheet.mergeCells("A18:J18");
  setSheetCell(worksheet, "A18", blueprint.cashFlowHeading, {
    fill: SECTION_FILL,
    font: SECTION_FONT,
    alignment: { horizontal: "left" },
  });

  setSheetCell(worksheet, "A19", "Line item", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "B19", "Driver", {
    fill: COLUMN_FILL,
    font: HEADER_FONT,
    alignment: { horizontal: "center" },
  });
  for (let yearIndex = 0; yearIndex <= MAX_MODEL_YEARS; yearIndex += 1) {
    const col = columnLetter(3 + yearIndex);
    setSheetCell(worksheet, `${col}19`, `Y${yearIndex}`, {
      fill: COLUMN_FILL,
      font: HEADER_FONT,
      alignment: { horizontal: "center" },
    });
  }

  const rows = artifacts.cashFlowRows;
  const visibleRows: VisibleCashFlowRow[] = [
    {
      label: "Property value",
      driver: `=CashFlowModel!B${rows.propertyValue}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.propertyValue,
      numFmt: CURRENCY_FMT,
    },
    { label: "Gross rental income", driver: "", modelRow: rows.grossRentalIncome, numFmt: CURRENCY_FMT, isSection: true },
    {
      label: "Free-market residential gross rent",
      driver: `=CashFlowModel!B${rows.freeMarketResidential}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.freeMarketResidential,
      numFmt: CURRENCY_FMT,
    },
    { label: "RS / RC residential gross rent", driver: `=CashFlowModel!B${rows.protectedResidential}`, modelRow: rows.protectedResidential, numFmt: CURRENCY_FMT },
    {
      label: "Commercial gross rent",
      driver: `=CashFlowModel!B${rows.commercial}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.commercial,
      numFmt: CURRENCY_FMT,
    },
    {
      label: "Other income",
      driver: `=CashFlowModel!B${rows.otherIncome}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.otherIncome,
      numFmt: CURRENCY_FMT,
    },
    {
      label: "Vacancy loss",
      driver: `=CashFlowModel!B${rows.vacancy}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.vacancy,
      numFmt: CURRENCY_FMT,
    },
    { label: "Lead time loss", driver: `=CashFlowModel!B${rows.leadTime}`, modelRow: rows.leadTime, numFmt: CURRENCY_FMT },
    { label: "Net rental income", driver: "", modelRow: rows.netRentalIncome, numFmt: CURRENCY_FMT, isSection: true },
  ];

  artifacts.expenses.forEach((expense, index) => {
    visibleRows.push({
      label: expense.lineItem,
      driver: `=CashFlowModel!B${rows.expenseStart + index}`,
      driverNumFmt:
        expense.annualGrowthPct != null && Number.isFinite(expense.annualGrowthPct)
          ? PERCENT_FMT
          : undefined,
      modelRow: rows.expenseStart + index,
      numFmt: CURRENCY_FMT,
    });
  });

  visibleRows.push(
    {
      label: "Management fee",
      driver: `=CashFlowModel!B${rows.management}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.management,
      numFmt: CURRENCY_FMT,
    },
    {
      label: "Total operating expenses",
      driver: "",
      modelRow: rows.totalOperatingExpenses,
      numFmt: CURRENCY_FMT,
      isSection: true,
    },
    { label: "Net operating income (NOI)", driver: "", modelRow: rows.noi, numFmt: CURRENCY_FMT, isSection: true },
    { label: "Recurring CapEx / reserve", driver: "", modelRow: rows.recurringCapex, numFmt: CURRENCY_FMT },
    {
      label: "Unlevered CF after reserves",
      driver: "",
      modelRow: rows.cashFlowFromOperations,
      numFmt: CURRENCY_FMT,
      isSection: true,
    },
    { label: "Cap rate (purchase price)", driver: "", modelRow: rows.capRate, numFmt: PERCENT_FMT },
    { label: "Total debt service", driver: "", modelRow: rows.debtService, numFmt: CURRENCY_FMT },
    { label: "Principal paydown", driver: "", modelRow: rows.principal, numFmt: CURRENCY_FMT },
    { label: "Interest expense", driver: "", modelRow: rows.interest, numFmt: CURRENCY_FMT },
    { label: "Levered CF to equity", driver: "", modelRow: rows.cashFlowAfterFinancing, numFmt: CURRENCY_FMT, isSection: true },
    { label: "Total investment cost", driver: "", modelRow: rows.totalInvestmentCost, numFmt: CURRENCY_FMT },
    {
      label: "Sale value",
      driver: `=CashFlowModel!B${rows.saleValue}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.saleValue,
      numFmt: CURRENCY_FMT,
    },
    {
      label: "Closing costs @ sale",
      driver: `=CashFlowModel!B${rows.saleClosingCosts}`,
      driverNumFmt: PERCENT_FMT,
      modelRow: rows.saleClosingCosts,
      numFmt: CURRENCY_FMT,
    },
    { label: "Reserve release at exit", driver: "", modelRow: rows.reserveRelease, numFmt: CURRENCY_FMT },
    { label: "Unlevered CF", driver: "", modelRow: rows.unleveredCashFlow, numFmt: CURRENCY_FMT, isSection: true },
    { label: "Financing funding", driver: "", modelRow: rows.financingFunding, numFmt: CURRENCY_FMT },
    { label: "Financing fees", driver: "", modelRow: rows.financingFees, numFmt: CURRENCY_FMT },
    { label: "Financing payoff", driver: "", modelRow: rows.financingPayoff, numFmt: CURRENCY_FMT },
    { label: "Total levered CF incl. exit", driver: "", modelRow: rows.leveredCashFlow, numFmt: CURRENCY_FMT, isSection: true }
  );

  let rowIndex = 20;
  for (const visibleRow of visibleRows) {
    setSheetCell(worksheet, `A${rowIndex}`, visibleRow.label, {
      font: LABEL_FONT,
      fill: visibleRow.isSection ? COLUMN_FILL : SOFT_FILL,
    });
    if (visibleRow.driver) {
      setFormulaCell(worksheet, `B${rowIndex}`, visibleRow.driver.replace(/^=/, ""), {
        fill: FORMULA_FILL,
        numFmt: visibleRow.driverNumFmt,
        alignment: { horizontal: "center" },
      });
    } else {
      setSheetCell(worksheet, `B${rowIndex}`, "", {
        fill: visibleRow.isSection ? COLUMN_FILL : SOFT_FILL,
      });
    }
    for (let yearIndex = 0; yearIndex <= MAX_MODEL_YEARS; yearIndex += 1) {
      const sourceCol = columnLetter(3 + yearIndex);
      const targetCol = columnLetter(3 + yearIndex);
      setFormulaCell(
        worksheet,
        `${targetCol}${rowIndex}`,
        `CashFlowModel!${sourceCol}${visibleRow.modelRow}`,
        {
          fill: FORMULA_FILL,
          numFmt: visibleRow.numFmt,
          alignment: { horizontal: "right" },
        }
      );
    }
    rowIndex += 1;
  }
}

function buildYieldOnCostSheet(
  workbook: ExcelJS.Workbook,
  ctx: UnderwritingContext,
  artifacts: WorkbookBuildArtifacts
): void {
  const worksheet = workbook.addWorksheet("Yield on Cost", {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
  });
  worksheet.columns = [
    { width: 30 },
    { width: 18 },
    { width: 4 },
    { width: 32 },
    { width: 18 },
    { width: 4 },
    { width: 28 },
    { width: 18 },
  ];

  const yocRows = yieldOnCostAssumptionRows(artifacts);
  const longTermNoiRef = quotedSheetRef("Assumptions", `$C$${yocRows.longTermNoi}`);
  const midTermNoiRef = quotedSheetRef("Assumptions", `$C$${yocRows.midTermNoi}`);

  worksheet.mergeCells("A1:H1");
  setSheetCell(worksheet, "A1", "Yield on Cost", {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left" },
  });

  styledSectionTitle(worksheet, "A3", "B3", "Total Cost Basis");
  const costRows = [
    ["Purchase price", assumptionRef("purchasePrice"), num(ctx.assumptions.acquisition.purchasePrice)],
    ["Closing costs", "FinancingModel!$B$4", ctx.acquisition.purchaseClosingCosts],
    ["Initial CapEx", assumptionRef("renovationCosts"), num(ctx.assumptions.acquisition.renovationCosts)],
    ["FF&E / furnishing cost", assumptionRef("furnishingCosts"), num(ctx.assumptions.acquisition.furnishingSetupCosts)],
    ["Other upfront costs", assumptionRef("onboardingCosts"), num(ctx.assumptions.acquisition.onboardingCosts)],
  ] as const;
  costRows.forEach(([label, formula, result], index) => {
    const row = 4 + index;
    setSheetCell(worksheet, `A${row}`, label, { font: LABEL_FONT, fill: SOFT_FILL });
    setFormulaCell(worksheet, `B${row}`, formula, {
      result,
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
      font: LINKED_FORMULA_FONT,
      alignment: { horizontal: "right" },
    });
  });
  setSheetCell(worksheet, "A9", "Total project cost", { font: LABEL_FONT, fill: COLUMN_FILL });
  setFormulaCell(worksheet, "B9", "SUM(B4:B8)", {
    result: ctx.acquisition.totalProjectCost,
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    alignment: { horizontal: "right" },
  });

  styledSectionTitle(worksheet, "D3", "E3", "NOI Comparison");
  [
    ["Stabilized long-term rental NOI", longTermNoiRef, currentNoiResult(ctx, artifacts), CURRENCY_FMT],
    ["Stabilized mid-term rental NOI", midTermNoiRef, ctx.operating.stabilizedNoi, CURRENCY_FMT],
    ["NOI uplift", "E5-E4", ctx.operating.stabilizedNoi - currentNoiResult(ctx, artifacts), CURRENCY_FMT],
    [
      "NOI uplift %",
      "IF(E4=0,0,E5/E4-1)",
      currentNoiResult(ctx, artifacts) === 0
        ? 0
        : ctx.operating.stabilizedNoi / currentNoiResult(ctx, artifacts) - 1,
      PERCENT_FMT,
    ],
    ["Exit cap rate", assumptionRef("exitCapPct"), percentAssumption(ctx.assumptions.exit.exitCapPct), PERCENT_FMT],
  ].forEach(([label, formula, result, numFmt], index) => {
    const row = 4 + index;
    setSheetCell(worksheet, `D${row}`, label, { font: LABEL_FONT, fill: SOFT_FILL });
    setFormulaCell(worksheet, `E${row}`, formula as string, {
      result: result as number,
      numFmt: numFmt as string,
      fill: FORMULA_FILL,
      font: index < 2 || index === 4 ? LINKED_FORMULA_FONT : FORMULA_FONT,
      alignment: { horizontal: "right" },
    });
  });

  styledSectionTitle(worksheet, "A11", "E11", "Yield on Cost / Value Creation Summary");
  const summaryRows = [
    ["Long-term rental yield on cost", "IF(B9=0,0,E4/B9)", PERCENT_FMT],
    ["Mid-term rental yield on cost", "IF(B9=0,0,E5/B9)", PERCENT_FMT],
    ["Yield on cost spread", "B13-B12", PERCENT_FMT],
    ["Implied value using LTR NOI", "IF(E8=0,0,E4/E8)", CURRENCY_FMT],
    ["Implied value using MTR NOI", "IF(E8=0,0,E5/E8)", CURRENCY_FMT],
    ["Implied value uplift", "B16-B15", CURRENCY_FMT],
  ] as const;
  summaryRows.forEach(([label, formula, numFmt], index) => {
    const row = 12 + index;
    setSheetCell(worksheet, `A${row}`, label, { font: LABEL_FONT, fill: SOFT_FILL });
    setFormulaCell(worksheet, `B${row}`, formula, {
      numFmt,
      fill: FORMULA_FILL,
      alignment: { horizontal: "right" },
    });
  });

  styledSectionTitle(worksheet, "G3", "H3", "Summary Box");
  [
    ["Total Project Cost", "B9", CURRENCY_FMT],
    ["LTR NOI", "E4", CURRENCY_FMT],
    ["MTR NOI", "E5", CURRENCY_FMT],
    ["LTR Yield on Cost", "B12", PERCENT_FMT],
    ["MTR Yield on Cost", "B13", PERCENT_FMT],
    ["Yield Spread", "B14", PERCENT_FMT],
    ["Implied Value Uplift", "B17", CURRENCY_FMT],
  ].forEach(([label, formula, numFmt], index) => {
    const row = 4 + index;
    setSheetCell(worksheet, `G${row}`, label, { font: LABEL_FONT, fill: index === 0 ? COLUMN_FILL : SOFT_FILL });
    setFormulaCell(worksheet, `H${row}`, formula, {
      numFmt,
      fill: FORMULA_FILL,
      alignment: { horizontal: "right" },
    });
  });

  styledSectionTitle(worksheet, "A21", "D21", "MTR Yield Sensitivity");
  setSheetCell(worksheet, "A22", "MTR NOI premium", { fill: COLUMN_FILL, font: HEADER_FONT, alignment: { horizontal: "center" } });
  [0, 0.05, 0.1].forEach((costCase, index) => {
    const cell = `${columnLetter(2 + index)}22`;
    setSheetCell(worksheet, cell, costCase, {
      numFmt: PERCENT_FMT,
      fill: COLUMN_FILL,
      font: HEADER_FONT,
      alignment: { horizontal: "center" },
    });
  });
  [0.2, 0.4, 0.6, 0.8, 1].forEach((premium, index) => {
    const row = 23 + index;
    setSheetCell(worksheet, `A${row}`, premium, {
      numFmt: PERCENT_FMT,
      fill: SOFT_FILL,
      font: LABEL_FONT,
      alignment: { horizontal: "center" },
    });
    for (let colIndex = 2; colIndex <= 4; colIndex += 1) {
      const col = columnLetter(colIndex);
      setFormulaCell(worksheet, `${col}${row}`, `IF($B$9=0,0,($E$4*(1+$A${row}))/($B$9*(1+${col}$22)))`, {
        numFmt: PERCENT_FMT,
        fill: FORMULA_FILL,
        alignment: { horizontal: "right" },
      });
    }
  });
}

function buildFormulaAuditSheet(workbook: ExcelJS.Workbook, artifacts: WorkbookBuildArtifacts): void {
  const worksheet = workbook.addWorksheet("Formula Audit", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
  });
  worksheet.columns = [
    { width: 30 },
    { width: 38 },
    { width: 38 },
    { width: 42 },
    { width: 56 },
  ];

  worksheet.mergeCells("A1:E1");
  setSheetCell(worksheet, "A1", "Formula Audit", {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left" },
  });
  worksheet.mergeCells("A2:E2");
  setSheetCell(
    worksheet,
    "A2",
    "Audit trail for the workbook-generation changes applied to every deal dossier / analysis Excel export.",
    {
      fill: SOFT_FILL,
      font: NOTE_FONT,
      alignment: { wrapText: true },
    }
  );

  ["Area", "Original issue", "Why it mattered", "Fix implemented", "Example revised formula / reference logic"].forEach(
    (label, index) => {
      setSheetCell(worksheet, `${columnLetter(index + 1)}4`, label, {
        fill: COLUMN_FILL,
        font: HEADER_FONT,
        alignment: { horizontal: "center", wrapText: true },
      });
    }
  );

  const rows = [
    [
      "Named ranges replaced with direct visible references",
      "Summary and model cells previously used workbook-level names for key outputs.",
      "Named ranges make click-through review harder because the user must inspect name definitions.",
      "Summary formulas now point directly to visible cells on Assumptions, FinancingModel, and CashFlowModel.",
      `Summary purchase price = ${assumptionRef("purchasePrice")}; levered IRR = CashFlowModel!$B$${artifacts.cashFlowRows.calculatedLeveredIrr}`,
    ],
    [
      "Hardcoded expense constants moved to Assumptions",
      "Annual cash-flow expense formulas embedded base amounts from source data.",
      "Expense diligence requires each base amount and growth rate to be editable in one visible place.",
      "Operating expenses now use the Assumptions expense table for base amount and growth.",
      `CashFlowModel expense row uses ${expenseBaseAmountRef(0)} and ${expenseGrowthRef(0)}`,
    ],
    [
      "Percentage assumptions converted to true percentages",
      "Percent inputs were stored as whole numbers and divided by 100 inside formulas.",
      "Whole-number percentages hide unit conversion and invite accidental double-scaling.",
      "Assumptions stores 65% as 0.65 with percent formatting, and formulas reference the cell directly.",
      `Loan amount = ${assumptionRef("purchasePrice")}*${assumptionRef("ltvPct")}`,
    ],
    [
      "Monthly debt schedule added",
      "Annual debt formulas used opaque per-year amortization formulas.",
      "Debt service, interest, principal, and payoff should be traceable month by month.",
      "MonthlyDebt now shows each month; FinancingModel annual rows roll up with SUMIFS.",
      `FinancingModel annual interest = SUMIFS(MonthlyDebt!$E$${monthlyDebtRows.start}:$E$${monthlyDebtEndRow()},MonthlyDebt!$I$${monthlyDebtRows.start}:$I$${monthlyDebtEndRow()},A${financingRows.amortizationStart})`,
    ],
    [
      "OFFSET / INDIRECT replaced",
      "Return metrics and debt calculations used volatile or hard-to-audit dynamic references.",
      "Volatile formulas are harder to review and can recalculate unpredictably.",
      "Dynamic ending-period logic now uses INDEX with visible row ranges.",
      `IRR range = $C$${artifacts.cashFlowRows.leveredCashFlow}:INDEX($C$${artifacts.cashFlowRows.leveredCashFlow}:$${columnLetter(3 + MAX_MODEL_YEARS)}$${artifacts.cashFlowRows.leveredCashFlow},1,${assumptionRef("holdPeriodYears")}+1)`,
    ],
    [
      "Yield on Cost calculator added",
      "Yield-on-cost comparison was not isolated as a reviewable tab.",
      "The long-term vs mid-term rental value creation thesis needs a clear diligence view.",
      "Yield on Cost compares LTR NOI, MTR NOI, total project cost, yield spread, and implied value uplift.",
      `MTR yield on cost = ${quotedSheetRef("Yield on Cost", "$E$5")}/${quotedSheetRef("Yield on Cost", "$B$9")}`,
    ],
  ];

  rows.forEach((values, index) => {
    const row = 5 + index;
    values.forEach((value, colIndex) => {
      setSheetCell(worksheet, `${columnLetter(colIndex + 1)}${row}`, value, {
        fill: colIndex === 0 ? SOFT_FILL : FORMULA_FILL,
        font: colIndex === 0 ? LABEL_FONT : undefined,
        alignment: { wrapText: true, vertical: "top" },
      });
    });
    worksheet.getRow(row).height = 72;
  });
}

function buildModelGuideSheet(workbook: ExcelJS.Workbook): void {
  const worksheet = workbook.addWorksheet("Model Guide", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
  });
  worksheet.columns = [
    { width: 22 },
    { width: 34 },
    { width: 64 },
  ];

  worksheet.mergeCells("A1:C1");
  setSheetCell(worksheet, "A1", "Workbook Formula Map", {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left", vertical: "middle" },
  });
  worksheet.mergeCells("A2:C2");
  setSheetCell(
    worksheet,
    "A2",
    "This workbook is formula-visible by design: inputs live on Assumptions, monthly debt mechanics live on MonthlyDebt, annual financing rollups live on FinancingModel, operating / exit cash flows live on CashFlowModel, and Summary links directly to those visible cells.",
    {
      fill: SOFT_FILL,
      font: NOTE_FONT,
      alignment: { wrapText: true, vertical: "middle" },
    }
  );
  worksheet.getRow(2).height = 42;

  ["Sheet", "Purpose", "Audit notes"].forEach((label, index) => {
    setSheetCell(worksheet, `${columnLetter(index + 1)}4`, label, {
      fill: COLUMN_FILL,
      font: HEADER_FONT,
      alignment: { horizontal: "center" },
    });
  });

  const rows = [
    [
      "Summary",
      "Presentation output",
      "Uses direct sheet-qualified formulas linked to Assumptions, FinancingModel, and CashFlowModel.",
    ],
    [
      "Assumptions",
      "Editable inputs and source handoff",
      "Blue values are hard-coded from the current OM workspace / saved underwriting assumptions. Formula cells are white.",
    ],
    [
      "FinancingModel",
      "Loan sizing and amortization schedule",
      "Visible annual support model. Loan amount, fees, payment, debt service, principal, interest, and ending balance are formula-driven from MonthlyDebt.",
    ],
    [
      "MonthlyDebt",
      "Monthly debt schedule",
      "Shows beginning balance, rate, monthly interest, debt service, principal amortization, ending balance, and annual grouping.",
    ],
    [
      "CashFlowModel",
      "Revenue, expenses, NOI, exit, and returns",
      "Visible support model. Expense formulas reference the editable Assumptions expense table; return metrics use INDEX ranges.",
    ],
    [
      "Yield on Cost",
      "LTR vs MTR value creation",
      "Compares total project cost, long-term NOI, mid-term NOI, yield spread, and implied value uplift.",
    ],
    [
      "Formula Audit",
      "Change log and formula audit trail",
      "Documents the formula cleanup applied to the generated workbook.",
    ],
  ];

  rows.forEach((rowValues, rowIndex) => {
    const rowNumber = rowIndex + 5;
    rowValues.forEach((value, colIndex) => {
      setSheetCell(worksheet, `${columnLetter(colIndex + 1)}${rowNumber}`, value, {
        fill: colIndex === 0 ? SOFT_FILL : FORMULA_FILL,
        font: colIndex === 0 ? LABEL_FONT : undefined,
        alignment: { wrapText: true, vertical: "top" },
      });
    });
    worksheet.getRow(rowNumber).height = 42;
  });

  const freshnessTitleRow = rows.length + 7;
  const freshnessBodyRow = freshnessTitleRow + 1;
  worksheet.mergeCells(`A${freshnessTitleRow}:C${freshnessTitleRow}`);
  setSheetCell(worksheet, `A${freshnessTitleRow}`, "Manual-change freshness", {
    fill: SECTION_FILL,
    font: SECTION_FONT,
    alignment: { horizontal: "left" },
  });
  worksheet.mergeCells(`A${freshnessBodyRow}:C${freshnessBodyRow}`);
  setSheetCell(
    worksheet,
    `A${freshnessBodyRow}`,
    "For property-backed Deal Analysis workspaces, the app saves the current manual underwriting draft before dossier / Excel generation. Batch regeneration should use the saved per-property assumptions already persisted to the property record.",
    {
      fill: SOFT_FILL,
      font: NOTE_FONT,
      alignment: { wrapText: true, vertical: "top" },
    }
  );
  worksheet.getRow(freshnessBodyRow).height = 50;
}

export async function buildDealAnalysisWorkbook(
  ctx: UnderwritingContext,
  options: { useLlmBlueprint?: boolean } = {}
): Promise<{ buffer: Buffer; fileName: string; blueprint: DealAnalysisWorkbookBlueprint }> {
  const blueprint =
    options.useLlmBlueprint === false
      ? FALLBACK_BLUEPRINT
      : await buildDealAnalysisWorkbookBlueprint(ctx);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenAI / Codex";
  workbook.lastModifiedBy = "OpenAI / Codex";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const artifacts = buildArtifacts(ctx);
  buildAssumptionsSheet(workbook, ctx, blueprint, artifacts);
  buildFinancingModelSheet(workbook, ctx);
  buildMonthlyDebtSheet(workbook);
  buildCashFlowModelSheet(workbook, ctx, artifacts);
  buildSummarySheet(workbook, ctx, blueprint, artifacts);
  buildYieldOnCostSheet(workbook, ctx, artifacts);
  buildFormulaAuditSheet(workbook, artifacts);
  buildModelGuideSheet(workbook);

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    fileName: buildProFormaFileName(ctx.canonicalAddress),
    blueprint,
  };
}
