import ExcelJS from "exceljs";
import type { CellValue, FillPattern, Font, Borders } from "exceljs";
import { buildProFormaFileName } from "./dossierFileName.js";
import {
  buildDealAnalysisWorkbookBlueprint,
  type DealAnalysisSummaryMetricKey,
  type DealAnalysisWorkbookBlueprint,
} from "./dealAnalysisExcelBlueprintLlm.js";
import { computeIrr } from "./irrCalculation.js";
import type {
  ExpenseRow,
  UnderwritingContext,
} from "./underwritingContext.js";
import {
  MAX_UNDERWRITING_HOLD_PERIOD_YEARS,
  normalizeExpenseProjectionInputs,
} from "./underwritingModel.js";

const MAX_MODEL_YEARS = MAX_UNDERWRITING_HOLD_PERIOD_YEARS;
const CURRENCY_FMT = "$#,##0;[Red]($#,##0)";
const PERCENT_FMT = "0.00%";
const INPUT_PERCENT_FMT = "0.00";
const MULTIPLE_FMT = "0.00x";
const INTEGER_FMT = "0";
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
  fgColor: { argb: COLOR.blueFill },
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

const NOTE_FONT: Partial<Font> = {
  italic: true,
  size: 10,
  color: { argb: COLOR.muted },
};

const assumptionRows = {
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

const assumptionNames = {
  address: "PropertyAddress",
  area: "PropertyArea",
  units: "UnitCount",
  dealScore: "DealScore",
  investmentProfile: "InvestmentProfile",
  targetAcquisitionDate: "TargetAcquisitionDate",
  purchasePrice: "PurchasePrice",
  purchaseClosingPct: "PurchaseClosingPct",
  renovationCosts: "RenovationCosts",
  furnishingCosts: "FurnishingSetupCosts",
  onboardingCosts: "OnboardingCosts",
  currentFreeMarketResidentialGrossRent: "CurrentFreeMarketResidentialGrossRent",
  currentProtectedResidentialGrossRent: "CurrentProtectedResidentialGrossRent",
  currentCommercialGrossRent: "CurrentCommercialGrossRent",
  currentGrossRent: "CurrentGrossRent",
  currentOtherIncome: "CurrentOtherIncome",
  currentExpenses: "CurrentOperatingExpensesExManagement",
  currentNoi: "CurrentNOI",
  currentNoiAdjustment: "CurrentNoiCapRateAdjustment",
  ltvPct: "LtvPct",
  interestRatePct: "InterestRatePct",
  amortizationYears: "AmortizationYears",
  loanFeePct: "LoanFeePct",
  eligibleRevenueSharePct: "EligibleRevenueSharePct",
  rentUpliftPct: "RentUpliftPct",
  blendedRentUpliftPct: "BlendedRentUpliftPct",
  expenseIncreasePct: "ExpenseIncreasePct",
  managementFeePct: "ManagementFeePct",
  occupancyTaxPct: "OccupancyTaxPct",
  vacancyPct: "VacancyPct",
  leadTimeMonths: "LeadTimeMonths",
  annualRentGrowthPct: "AnnualRentGrowthPct",
  annualCommercialRentGrowthPct: "AnnualCommercialRentGrowthPct",
  annualOtherIncomeGrowthPct: "AnnualOtherIncomeGrowthPct",
  annualExpenseGrowthPct: "AnnualExpenseGrowthPct",
  annualPropertyTaxGrowthPct: "AnnualPropertyTaxGrowthPct",
  recurringCapexAnnual: "RecurringCapexAnnual",
  holdPeriodYears: "HoldPeriodYears",
  exitCapPct: "ExitCapPct",
  exitClosingCostPct: "ExitClosingCostPct",
  targetIrrPct: "TargetIrrPct",
} as const;

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

function columnLetter(index: number): string {
  let result = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function assumptionCell(row: number): string {
  return `$C$${row}`;
}

function defineName(
  workbook: ExcelJS.Workbook,
  name: string,
  worksheetName: string,
  cell: string
): void {
  workbook.definedNames.add(`${worksheetName}!${cell}`, name);
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
    }
  ) => {
    setSheetCell(worksheet, `A${row}`, params.section, { font: LABEL_FONT, fill: SOFT_FILL });
    setSheetCell(worksheet, `B${row}`, params.label, { font: LABEL_FONT });
    if (params.formula) {
      setFormulaCell(worksheet, `C${row}`, params.formula, {
        result: params.result,
        numFmt: params.valueNumFmt,
        fill: FORMULA_FILL,
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
    section: "Property",
    label: "Investment profile",
    value: ctx.assumptions.acquisition.investmentProfile ?? "",
    source: "Hard coded user / profile assumption",
    hardCoded: true,
  });
  addRow(assumptionRows.targetAcquisitionDate, {
    section: "Property",
    label: "Target acquisition date",
    value: ctx.assumptions.acquisition.targetAcquisitionDate ?? "",
    valueNumFmt: ctx.assumptions.acquisition.targetAcquisitionDate ? DATE_FMT : undefined,
    source: "Hard coded user / profile assumption",
    hardCoded: true,
  });

  addRow(assumptionRows.purchasePrice, {
    section: "Acquisition",
    label: "Purchase price",
    value: num(ctx.assumptions.acquisition.purchasePrice),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.purchaseClosingPct, {
    section: "Acquisition",
    label: "Purchase closing costs",
    value: num(ctx.assumptions.acquisition.purchaseClosingCostPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.renovationCosts, {
    section: "Acquisition",
    label: "Renovation costs",
    value: num(ctx.assumptions.acquisition.renovationCosts),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.furnishingCosts, {
    section: "Acquisition",
    label: "Furnishing / setup costs",
    value: num(ctx.assumptions.acquisition.furnishingSetupCosts),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.onboardingCosts, {
    section: "Acquisition",
    label: "Onboarding / unit turn costs",
    value: num(ctx.assumptions.acquisition.onboardingCosts),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  addRow(assumptionRows.currentFreeMarketResidentialGrossRent, {
    section: "Current Basis",
    label: "Current free-market residential gross rent",
    value: artifacts.currentRentBreakdown.freeMarketResidential,
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived rent breakdown",
    hardCoded: true,
  });
  addRow(assumptionRows.currentProtectedResidentialGrossRent, {
    section: "Current Basis",
    label: "Current protected residential gross rent",
    value: artifacts.currentRentBreakdown.protectedResidential,
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived rent breakdown",
    hardCoded: true,
  });
  addRow(assumptionRows.currentCommercialGrossRent, {
    section: "Current Basis",
    label: "Current commercial gross rent",
    value: artifacts.currentRentBreakdown.commercial,
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived rent breakdown",
    hardCoded: true,
  });
  addRow(assumptionRows.currentGrossRent, {
    section: "Current Basis",
    label: "Current gross rent",
    value: "",
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Formula = residential + protected + commercial rent",
    formula: `${assumptionNames.currentFreeMarketResidentialGrossRent}+${assumptionNames.currentProtectedResidentialGrossRent}+${assumptionNames.currentCommercialGrossRent}`,
    result:
      artifacts.currentRentBreakdown.freeMarketResidential +
      artifacts.currentRentBreakdown.protectedResidential +
      artifacts.currentRentBreakdown.commercial,
  });
  addRow(assumptionRows.currentOtherIncome, {
    section: "Current Basis",
    label: "Current other income",
    value: num(ctx.currentOtherIncome),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived current income",
    hardCoded: true,
  });
  addRow(assumptionRows.currentExpenses, {
    section: "Current Basis",
    label: "Current operating expenses (ex management)",
    value: num(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded from OM-derived or reconstructed expense basis",
    hardCoded: true,
  });
  addRow(assumptionRows.currentNoiAdjustment, {
    section: "Current Basis",
    label: "Projected vacant residential rent",
    value: Math.max(0, num(ctx.conservativeProjectedLeaseUpRent)),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source:
      "Hard coded add-back used only when the ask-cap / dossier current NOI includes delivered-vacant residential rent",
    hardCoded: true,
  });
  addRow(assumptionRows.currentNoi, {
    section: "Current Basis",
    label: "Current NOI",
    value: "",
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Formula = gross rent + other income - current expenses + projected vacant residential rent",
    formula: `${assumptionNames.currentGrossRent}+${assumptionNames.currentOtherIncome}-${assumptionNames.currentExpenses}+${assumptionNames.currentNoiAdjustment}`,
    result:
      artifacts.currentRentBreakdown.freeMarketResidential +
      artifacts.currentRentBreakdown.protectedResidential +
      artifacts.currentRentBreakdown.commercial +
      num(ctx.currentOtherIncome) -
      num(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses) +
      Math.max(0, num(ctx.conservativeProjectedLeaseUpRent)),
  });

  addRow(assumptionRows.ltvPct, {
    section: "Financing",
    label: "Loan-to-value",
    value: num(ctx.assumptions.financing.ltvPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.interestRatePct, {
    section: "Financing",
    label: "Interest rate",
    value: num(ctx.assumptions.financing.interestRatePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.amortizationYears, {
    section: "Financing",
    label: "Amortization period",
    value: num(ctx.assumptions.financing.amortizationYears),
    valueNumFmt: INTEGER_FMT,
    units: "years",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.loanFeePct, {
    section: "Financing",
    label: "Loan fee",
    value: num(ctx.assumptions.financing.loanFeePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  addRow(assumptionRows.eligibleRevenueSharePct, {
    section: "Operating",
    label: "Eligible revenue share",
    value: num(ctx.propertyMix?.eligibleRevenueSharePct) * 100,
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded model input for blended uplift logic",
    hardCoded: true,
  });
  addRow(assumptionRows.rentUpliftPct, {
    section: "Operating",
    label: "Rent uplift",
    value: num(ctx.assumptions.operating.rentUpliftPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.blendedRentUpliftPct, {
    section: "Operating",
    label: "Blended rent uplift",
    value: num(ctx.assumptions.operating.blendedRentUpliftPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source:
      "Hard coded from the detailed unit underwriting / blended projected rent path used by the PDF dossier",
    hardCoded: true,
  });
  addRow(assumptionRows.expenseIncreasePct, {
    section: "Operating",
    label: "Expense increase",
    value: num(ctx.assumptions.operating.expenseIncreasePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.managementFeePct, {
    section: "Operating",
    label: "Management fee",
    value: num(ctx.assumptions.operating.managementFeePct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.occupancyTaxPct, {
    section: "Operating",
    label: "Occupancy tax",
    value: num(ctx.assumptions.operating.occupancyTaxPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.vacancyPct, {
    section: "Operating",
    label: "Vacancy",
    value: num(ctx.assumptions.operating.vacancyPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.leadTimeMonths, {
    section: "Operating",
    label: "Lead time",
    value: num(ctx.assumptions.operating.leadTimeMonths),
    valueNumFmt: INTEGER_FMT,
    units: "months",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualRentGrowthPct, {
    section: "Operating",
    label: "Annual free-market rent growth",
    value: num(ctx.assumptions.operating.annualRentGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualCommercialRentGrowthPct, {
    section: "Operating",
    label: "Annual commercial rent growth",
    value: num(ctx.assumptions.operating.annualCommercialRentGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualOtherIncomeGrowthPct, {
    section: "Operating",
    label: "Annual other-income growth",
    value: num(ctx.assumptions.operating.annualOtherIncomeGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualExpenseGrowthPct, {
    section: "Operating",
    label: "Annual expense growth",
    value: num(ctx.assumptions.operating.annualExpenseGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.annualPropertyTaxGrowthPct, {
    section: "Operating",
    label: "Annual property-tax growth",
    value: num(ctx.assumptions.operating.annualPropertyTaxGrowthPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.recurringCapexAnnual, {
    section: "Operating",
    label: "Recurring CapEx / reserve",
    value: num(ctx.assumptions.operating.recurringCapexAnnual),
    valueNumFmt: CURRENCY_FMT,
    units: "USD",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  addRow(assumptionRows.holdPeriodYears, {
    section: "Exit",
    label: "Hold period",
    value: num(ctx.assumptions.holdPeriodYears),
    valueNumFmt: INTEGER_FMT,
    units: "years",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.exitCapPct, {
    section: "Exit",
    label: "Exit cap rate",
    value: num(ctx.assumptions.exit.exitCapPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.exitClosingCostPct, {
    section: "Exit",
    label: "Exit closing costs",
    value: num(ctx.assumptions.exit.exitClosingCostPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });
  addRow(assumptionRows.targetIrrPct, {
    section: "Exit",
    label: "Target IRR",
    value: num(ctx.assumptions.targetIrrPct),
    valueNumFmt: INPUT_PERCENT_FMT,
    units: "%",
    source: "Hard coded underwriting input",
    hardCoded: true,
  });

  for (const [key, row] of Object.entries(assumptionRows) as Array<
    [keyof typeof assumptionRows, number]
  >) {
    defineName(workbook, assumptionNames[key], "Assumptions", assumptionCell(row));
  }
}

function buildFinancingModelSheet(
  workbook: ExcelJS.Workbook,
  ctx: UnderwritingContext
): void {
  const worksheet = workbook.addWorksheet("FinancingModel");
  worksheet.state = "hidden";
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
  setFormulaCell(worksheet, "B2", "PurchasePrice*(LtvPct/100)", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.financing.loanAmount,
  });
  setSheetCell(worksheet, "A3", "Financing fees", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B3", "B2*(LoanFeePct/100)", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.financing.financingFees ?? 0,
  });
  setSheetCell(worksheet, "A4", "Purchase closing costs", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B4", "PurchasePrice*(PurchaseClosingPct/100)", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.acquisition.purchaseClosingCosts,
  });
  setSheetCell(worksheet, "A5", "Total project cost", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B5", "SUM(PurchasePrice,B4,RenovationCosts,FurnishingSetupCosts,OnboardingCosts)", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
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
  setFormulaCell(worksheet, "B7", "InterestRatePct/100/12", {
    numFmt: "0.0000%",
    fill: FORMULA_FILL,
    result: num(ctx.assumptions.financing.interestRatePct) / 100 / 12,
  });
  setSheetCell(worksheet, "A8", "Total amortization months", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B8", "AmortizationYears*12", {
    numFmt: INTEGER_FMT,
    fill: FORMULA_FILL,
    result: num(ctx.assumptions.financing.amortizationYears) * 12,
  });
  setSheetCell(worksheet, "A9", "Monthly payment", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B9", "IF(B2=0,0,IF(B7=0,B2/B8,-PMT(B7,B8,B2)))", {
    numFmt: CURRENCY_FMT,
    fill: FORMULA_FILL,
    result: ctx.financing.monthlyPayment,
  });
  setSheetCell(worksheet, "A10", "Annual debt service", {
    font: LABEL_FONT,
    fill: COLUMN_FILL,
  });
  setFormulaCell(worksheet, "B10", "B9*12", {
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

  for (let year = 1; year <= MAX_MODEL_YEARS; year += 1) {
    const row = financingRows.amortizationStart + year - 1;
    const previousRow = row - 1;
    const annualPeriodsFormula = `MIN(12,MAX(0,$B$8-((A${row}-1)*12)))`;
    const periodRangeFormula = `ROW(INDIRECT(((A${row}-1)*12+1)&":"&MIN(A${row}*12,$B$8)))`;
    setSheetCell(worksheet, `A${row}`, year, {
      numFmt: INTEGER_FMT,
      fill: SOFT_FILL,
      alignment: { horizontal: "center" },
    });
    setFormulaCell(
      worksheet,
      `B${row}`,
      year === 1 ? "$B$2" : `F${previousRow}`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `C${row}`,
      `IF(OR(B${row}=0,${annualPeriodsFormula}=0),0,D${row}+E${row})`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `D${row}`,
      `IF(OR(B${row}=0,${annualPeriodsFormula}=0),0,IF($B$7=0,MIN(B${row},$B$9*${annualPeriodsFormula}),-SUMPRODUCT(PPMT($B$7,${periodRangeFormula},$B$8,$B$2))))`,
      {
        numFmt: CURRENCY_FMT,
        fill: FORMULA_FILL,
      }
    );
    setFormulaCell(
      worksheet,
      `E${row}`,
      `IF(OR(B${row}=0,${annualPeriodsFormula}=0),0,IF($B$7=0,0,-SUMPRODUCT(IPMT($B$7,${periodRangeFormula},$B$8,$B$2))))`,
      {
        numFmt: CURRENCY_FMT,
        fill: FORMULA_FILL,
      }
    );
    setFormulaCell(worksheet, `F${row}`, `MAX(0,B${row}-D${row})`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
    });
  }

  defineName(workbook, "CalculatedLoanAmount", "FinancingModel", "$B$2");
  defineName(workbook, "CalculatedFinancingFees", "FinancingModel", "$B$3");
  defineName(workbook, "CalculatedPurchaseClosingCosts", "FinancingModel", "$B$4");
  defineName(workbook, "CalculatedTotalProjectCost", "FinancingModel", "$B$5");
  defineName(workbook, "CalculatedInitialEquity", "FinancingModel", "$B$6");
  defineName(workbook, "CalculatedMonthlyPayment", "FinancingModel", "$B$9");
  defineName(workbook, "CalculatedAnnualDebtService", "FinancingModel", "$B$10");
  defineName(workbook, "CalculatedTotalCapitalization", "FinancingModel", "$B$11");
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
  worksheet.state = "hidden";
  worksheet.columns = [
    { width: 30 },
    { width: 14 },
    ...Array.from({ length: MAX_MODEL_YEARS + 1 }, () => ({ width: 14 })),
  ];

  const rows = artifacts.cashFlowRows;

  worksheet.mergeCells("A1:F1");
  setSheetCell(worksheet, "A1", "Cash Flow Model", {
    fill: TITLE_FILL,
    font: TITLE_FONT,
    alignment: { horizontal: "left" },
  });

  setSheetCell(worksheet, "A3", "Hold period", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B3", "HoldPeriodYears", {
    numFmt: INTEGER_FMT,
    fill: FORMULA_FILL,
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
    const column = columnLetter(3 + yearIndex);
    setSheetCell(worksheet, `${column}5`, yearIndex, {
      numFmt: INTEGER_FMT,
      fill: COLUMN_FILL,
      font: HEADER_FONT,
      alignment: { horizontal: "center" },
    });
  }

  setSheetCell(worksheet, "A6", "Property value", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B6", "AnnualRentGrowthPct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
  });
  setSheetCell(worksheet, "A7", "Gross rental income", { font: LABEL_FONT });
  setSheetCell(worksheet, "A8", "Free-market residential gross rent", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B8", "BlendedRentUpliftPct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
    result: num(ctx.assumptions.operating.blendedRentUpliftPct) / 100,
  });
  setSheetCell(worksheet, "A9", "RS / RC residential gross rent", { font: LABEL_FONT });
  setSheetCell(worksheet, "B9", "Flat", {
    fill: SOFT_FILL,
    alignment: { horizontal: "center" },
  });
  setSheetCell(worksheet, "A10", "Commercial gross rent", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B10", "AnnualCommercialRentGrowthPct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
  });
  setSheetCell(worksheet, "A11", "Other income", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B11", "AnnualOtherIncomeGrowthPct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
  });
  setSheetCell(worksheet, "A12", "Vacancy assumption", { font: LABEL_FONT });
  setFormulaCell(worksheet, "B12", "VacancyPct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
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
      setFormulaCell(worksheet, `B${row}`, "OccupancyTaxPct/100", {
        numFmt: PERCENT_FMT,
        fill: FORMULA_FILL,
      });
    } else if (expense.annualGrowthPct != null && Number.isFinite(expense.annualGrowthPct)) {
      setSheetCell(worksheet, `B${row}`, expense.annualGrowthPct / 100, {
        numFmt: PERCENT_FMT,
        fill: HARD_CODED_FILL,
        font: HARD_CODED_FONT,
      });
    } else if (isTaxExpense(expense.lineItem)) {
      setFormulaCell(worksheet, `B${row}`, "AnnualPropertyTaxGrowthPct/100", {
        numFmt: PERCENT_FMT,
        fill: FORMULA_FILL,
      });
    } else {
      setFormulaCell(worksheet, `B${row}`, "AnnualExpenseGrowthPct/100", {
        numFmt: PERCENT_FMT,
        fill: FORMULA_FILL,
      });
    }
  });

  setSheetCell(worksheet, `A${rows.management}`, "Management fee", { font: LABEL_FONT });
  setFormulaCell(worksheet, `B${rows.management}`, "ManagementFeePct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
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
  setFormulaCell(worksheet, `B${rows.saleValue}`, "ExitCapPct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
  });
  setSheetCell(worksheet, `A${rows.saleClosingCosts}`, "Closing costs @ sale", { font: LABEL_FONT });
  setFormulaCell(worksheet, `B${rows.saleClosingCosts}`, "ExitClosingCostPct/100", {
    numFmt: PERCENT_FMT,
    fill: FORMULA_FILL,
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
    const column = columnLetter(3 + yearIndex);
    const activeOperatingCondition = `OR(${column}$5=0,${column}$5>HoldPeriodYears)`;
    const activeYearCondition = `${column}$5<=HoldPeriodYears`;

    setFormulaCell(
      worksheet,
      `${column}${rows.propertyValue}`,
      `IF(${column}$5=0,PurchasePrice,IF(${activeYearCondition},PurchasePrice*(1+AnnualRentGrowthPct/100)^${column}$5,0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.freeMarketResidential}`,
      `IF(${activeOperatingCondition},0,CurrentFreeMarketResidentialGrossRent*(1+BlendedRentUpliftPct/100)*(1+AnnualRentGrowthPct/100)^(${column}$5-1))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.protectedResidential}`,
      `IF(${activeOperatingCondition},0,CurrentProtectedResidentialGrossRent)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.commercial}`,
      `IF(${activeOperatingCondition},0,CurrentCommercialGrossRent*(1+AnnualCommercialRentGrowthPct/100)^(${column}$5-1))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
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
      `IF(${activeOperatingCondition},0,CurrentOtherIncome*(1+AnnualOtherIncomeGrowthPct/100)^(${column}$5-1))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.vacancy}`,
      `IF(${activeOperatingCondition},0,-${column}${rows.grossRentalIncome}*(VacancyPct/100))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.leadTime}`,
      `IF(${column}$5=1,-${column}${rows.grossRentalIncome}*(LeadTimeMonths/12),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
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
        expense.annualGrowthPct != null && Number.isFinite(expense.annualGrowthPct)
          ? `B${row}`
          : isOccupancyTaxExpense(expense.lineItem)
            ? "OccupancyTaxPct/100"
            : isTaxExpense(expense.lineItem)
            ? "AnnualPropertyTaxGrowthPct/100"
            : "AnnualExpenseGrowthPct/100";
      const projectedValue =
        year > 0 && Array.isArray(expense.yearlyAmounts)
          ? expense.yearlyAmounts[year - 1] ?? 0
          : undefined;
      const baseAmountFormula = artifacts.aggregateExpenseFallback
        ? `${expense.amount}*(1+ExpenseIncreasePct/100)`
        : `${expense.amount}`;
      const expenseFormula = isOccupancyTaxExpense(expense.lineItem)
        ? `IF(${activeOperatingCondition},0,-MAX(0,${column}${rows.grossRentalIncome}+${column}${rows.vacancy}+${column}${rows.leadTime})*(OccupancyTaxPct/100))`
        : `IF(${activeOperatingCondition},0,-(${baseAmountFormula})*((1+${growthRef})^(${column}$5-1)))`;

      setFormulaCell(worksheet, `${column}${row}`, expenseFormula, {
        numFmt: CURRENCY_FMT,
        fill: FORMULA_FILL,
        result: projectedValue == null ? undefined : -Math.abs(projectedValue),
      });
    });

    setFormulaCell(
      worksheet,
      `${column}${rows.management}`,
      `IF(${activeOperatingCondition},0,-MAX(0,${column}${rows.grossRentalIncome}+${column}${rows.vacancy}+${column}${rows.leadTime})*(ManagementFeePct/100))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
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
      `IF(${activeOperatingCondition},0,-RecurringCapexAnnual)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
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
      `IF(${activeOperatingCondition},"",IF(PurchasePrice=0,0,${column}${rows.noi}/PurchasePrice))`,
      { numFmt: PERCENT_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.debtService}`,
      `IF(${activeOperatingCondition},0,-IFERROR(INDEX(FinancingModel!$C$${financingRows.amortizationStart}:$C$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.principal}`,
      `IF(${activeOperatingCondition},0,-IFERROR(INDEX(FinancingModel!$D$${financingRows.amortizationStart}:$D$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.interest}`,
      `IF(${activeOperatingCondition},0,-IFERROR(INDEX(FinancingModel!$E$${financingRows.amortizationStart}:$E$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0))`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
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
    });
    setFormulaCell(
      worksheet,
      `${column}${rows.saleValue}`,
      `IF(${column}$5=HoldPeriodYears,IF(ExitCapPct=0,0,${column}${rows.noi}/(ExitCapPct/100)),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.saleClosingCosts}`,
      `IF(${column}$5=HoldPeriodYears,-${column}${rows.saleValue}*(ExitClosingCostPct/100),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
    );
    setFormulaCell(
      worksheet,
      `${column}${rows.reserveRelease}`,
      `IF(${column}$5=HoldPeriodYears,-SUM($C${rows.recurringCapex}:${column}${rows.recurringCapex}),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
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
    });
    setFormulaCell(worksheet, `${column}${rows.financingFees}`, `IF(${column}$5=0,-FinancingModel!$B$3,0)`, {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
    });
    setFormulaCell(
      worksheet,
      `${column}${rows.financingPayoff}`,
      `IF(${column}$5=HoldPeriodYears,-IFERROR(INDEX(FinancingModel!$F$${financingRows.amortizationStart}:$F$${financingRows.amortizationStart + MAX_MODEL_YEARS - 1},${column}$5),0),0)`,
      { numFmt: CURRENCY_FMT, fill: FORMULA_FILL }
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
    `INDEX($C${rows.noi}:${columnLetter(3 + MAX_MODEL_YEARS)}${rows.noi},1,IF(LeadTimeMonths>0,MIN(HoldPeriodYears,2),MIN(HoldPeriodYears,1))+1)`,
    { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, result: ctx.operating.stabilizedNoi }
  );
  setSheetCell(worksheet, `A${rows.calculatedGrossSaleValue}`, "Calculated gross sale value", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedGrossSaleValue}`,
    `INDEX($C${rows.saleValue}:${columnLetter(3 + MAX_MODEL_YEARS)}${rows.saleValue},1,HoldPeriodYears+1)`,
    { numFmt: CURRENCY_FMT, fill: FORMULA_FILL, result: ctx.exit.exitPropertyValue }
  );
  setSheetCell(worksheet, `A${rows.calculatedNetSaleValue}`, "Calculated net sale value", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedNetSaleValue}`,
    `INDEX($C${rows.saleValue}:${columnLetter(3 + MAX_MODEL_YEARS)}${rows.saleValue},1,HoldPeriodYears+1)+INDEX($C${rows.saleClosingCosts}:${columnLetter(3 + MAX_MODEL_YEARS)}${rows.saleClosingCosts},1,HoldPeriodYears+1)`,
    {
      numFmt: CURRENCY_FMT,
      fill: FORMULA_FILL,
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
    `IFERROR(IRR(OFFSET($C$${rows.unleveredCashFlow},0,0,1,HoldPeriodYears+1)),"")`,
    { numFmt: PERCENT_FMT, fill: FORMULA_FILL }
  );
  setSheetCell(worksheet, `A${rows.calculatedLeveredIrr}`, "Calculated levered IRR", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedLeveredIrr}`,
    `IFERROR(IRR(OFFSET($C$${rows.leveredCashFlow},0,0,1,HoldPeriodYears+1)),"")`,
    { numFmt: PERCENT_FMT, fill: FORMULA_FILL, result: ctx.returns.irrPct ?? undefined }
  );
  setSheetCell(worksheet, `A${rows.calculatedAverageCashOnCash}`, "Calculated average cash-on-cash", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedAverageCashOnCash}`,
    `IF(OR(CalculatedInitialEquity=0,HoldPeriodYears=0),0,(SUM(OFFSET($D$${rows.noi},0,0,1,HoldPeriodYears))+SUM(OFFSET($D$${rows.debtService},0,0,1,HoldPeriodYears)))/(HoldPeriodYears*CalculatedInitialEquity))`,
    { numFmt: PERCENT_FMT, fill: FORMULA_FILL, result: ctx.returns.averageCashOnCashReturn ?? undefined }
  );
  setSheetCell(worksheet, `A${rows.calculatedEquityMultiple}`, "Calculated equity multiple", {
    font: LABEL_FONT,
    fill: SOFT_FILL,
  });
  setFormulaCell(
    worksheet,
    `B${rows.calculatedEquityMultiple}`,
    `IF(CalculatedInitialEquity=0,0,SUMPRODUCT((OFFSET($D$${rows.leveredCashFlow},0,0,1,HoldPeriodYears)>0)*OFFSET($D$${rows.leveredCashFlow},0,0,1,HoldPeriodYears))/CalculatedInitialEquity)`,
    { numFmt: MULTIPLE_FMT, fill: FORMULA_FILL, result: ctx.returns.equityMultiple ?? undefined }
  );

  defineName(workbook, "CalculatedStabilizedNoi", "CashFlowModel", `$B$${rows.calculatedStabilizedNoi}`);
  defineName(workbook, "CalculatedGrossSaleValue", "CashFlowModel", `$B$${rows.calculatedGrossSaleValue}`);
  defineName(workbook, "CalculatedNetSaleValue", "CashFlowModel", `$B$${rows.calculatedNetSaleValue}`);
  defineName(workbook, "CalculatedUnleveredIRR", "CashFlowModel", `$B$${rows.calculatedUnleveredIrr}`);
  defineName(workbook, "CalculatedLeveredIRR", "CashFlowModel", `$B$${rows.calculatedLeveredIrr}`);
  defineName(workbook, "CalculatedAverageCashOnCash", "CashFlowModel", `$B$${rows.calculatedAverageCashOnCash}`);
  defineName(workbook, "CalculatedEquityMultiple", "CashFlowModel", `$B$${rows.calculatedEquityMultiple}`);
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
      formula: "PropertyAddress",
      result: ctx.canonicalAddress,
    },
    area: {
      label: "Area",
      formula: "PropertyArea",
      result: ctx.listingCity ?? "",
    },
    units: {
      label: "Units",
      formula: "UnitCount",
      result: num(ctx.unitCount),
      numFmt: INTEGER_FMT,
    },
    deal_score: {
      label: "Deal score",
      formula: "DealScore",
      result: ctx.dealScore ?? "",
      numFmt: INTEGER_FMT,
    },
    investment_profile: {
      label: "Investment profile",
      formula: "InvestmentProfile",
      result: ctx.assumptions.acquisition.investmentProfile ?? "",
    },
    target_acquisition_date: {
      label: "Target acquisition",
      formula: "TargetAcquisitionDate",
      result: ctx.assumptions.acquisition.targetAcquisitionDate ?? "",
      numFmt: ctx.assumptions.acquisition.targetAcquisitionDate ? DATE_FMT : undefined,
    },
    purchase_price: {
      label: "Purchase price",
      formula: "PurchasePrice",
      result: num(ctx.assumptions.acquisition.purchasePrice),
      numFmt: CURRENCY_FMT,
    },
    total_capitalization: {
      label: "Total capitalization",
      formula: "CalculatedTotalCapitalization",
      result: ctx.acquisition.totalProjectCost + num(ctx.financing.financingFees),
      numFmt: CURRENCY_FMT,
    },
    loan_amount: {
      label: "Loan amount",
      formula: "CalculatedLoanAmount",
      result: ctx.financing.loanAmount,
      numFmt: CURRENCY_FMT,
    },
    cash_required: {
      label: "Cash required",
      formula: "CalculatedInitialEquity",
      result: ctx.acquisition.initialEquityInvested,
      numFmt: CURRENCY_FMT,
    },
    current_gross_rent: {
      label: "Current gross rent",
      formula: "CurrentGrossRent",
      result: num(ctx.currentGrossRent),
      numFmt: CURRENCY_FMT,
    },
    current_noi: {
      label: "Current NOI",
      formula: "CurrentNOI",
      result:
        artifacts.currentRentBreakdown.freeMarketResidential +
        artifacts.currentRentBreakdown.protectedResidential +
        artifacts.currentRentBreakdown.commercial +
        num(ctx.currentOtherIncome) -
        num(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses),
      numFmt: CURRENCY_FMT,
    },
    stabilized_noi: {
      label: "Stabilized NOI",
      formula: "CalculatedStabilizedNoi",
      result: ctx.operating.stabilizedNoi,
      numFmt: CURRENCY_FMT,
    },
    hold_period: {
      label: "Hold period",
      formula: "HoldPeriodYears",
      result: num(ctx.assumptions.holdPeriodYears),
      numFmt: INTEGER_FMT,
    },
    exit_cap: {
      label: "Exit cap rate",
      formula: "ExitCapPct/100",
      result: num(ctx.assumptions.exit.exitCapPct) / 100,
      numFmt: PERCENT_FMT,
    },
    gross_sale_value: {
      label: "Gross sale value",
      formula: "CalculatedGrossSaleValue",
      result: ctx.exit.exitPropertyValue,
      numFmt: CURRENCY_FMT,
    },
    net_sale_value: {
      label: "Net sale value",
      formula: "CalculatedNetSaleValue",
      result: ctx.exit.netSaleProceedsBeforeDebtPayoff,
      numFmt: CURRENCY_FMT,
    },
    levered_irr: {
      label: "Levered IRR",
      formula: "CalculatedLeveredIRR",
      result: ctx.returns.irrPct ?? undefined,
      numFmt: PERCENT_FMT,
    },
    unlevered_irr: {
      label: "Unlevered IRR",
      formula: "CalculatedUnleveredIRR",
      result: unleveredReturn?.irr ?? undefined,
      numFmt: PERCENT_FMT,
    },
    avg_cash_on_cash: {
      label: "Avg cash-on-cash",
      formula: "CalculatedAverageCashOnCash",
      result: ctx.returns.averageCashOnCashReturn ?? undefined,
      numFmt: PERCENT_FMT,
    },
    equity_multiple: {
      label: "Equity multiple",
      formula: "CalculatedEquityMultiple",
      result: ctx.returns.equityMultiple ?? undefined,
      numFmt: MULTIPLE_FMT,
    },
    target_irr: {
      label: "Target IRR",
      formula: "TargetIrrPct/100",
      result: num(ctx.assumptions.targetIrrPct) / 100,
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
    "Blue text on the Assumptions tab marks hard-coded inputs. All downstream summary and cash-flow outputs remain formula-linked.",
    {
      fill: SOFT_FILL,
      font: NOTE_FONT,
      alignment: { wrapText: true },
    }
  );

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

export async function buildDealAnalysisWorkbook(
  ctx: UnderwritingContext
): Promise<{ buffer: Buffer; fileName: string; blueprint: DealAnalysisWorkbookBlueprint }> {
  const blueprint = await buildDealAnalysisWorkbookBlueprint(ctx);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenAI / Codex";
  workbook.lastModifiedBy = "OpenAI / Codex";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const artifacts = buildArtifacts(ctx);
  buildAssumptionsSheet(workbook, ctx, blueprint, artifacts);
  buildFinancingModelSheet(workbook, ctx);
  buildCashFlowModelSheet(workbook, ctx, artifacts);
  buildSummarySheet(workbook, ctx, blueprint, artifacts);

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    fileName: buildProFormaFileName(ctx.canonicalAddress),
    blueprint,
  };
}
