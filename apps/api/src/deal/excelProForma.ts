/**
 * Excel pro forma: build a formula-driven workbook so the user can adjust assumptions directly
 * in Excel and watch acquisition, financing, cash flow, exit, and returns recalculate.
 */

import * as XLSX from "xlsx";
import type { UnderwritingContext } from "./underwritingContext.js";
import {
  EXPENSE_INCREASE_SENSITIVITY_VALUES,
  MANAGEMENT_FEE_SENSITIVITY_VALUES,
  RENTAL_UPLIFT_SENSITIVITY_VALUES,
} from "./sensitivityAnalysis.js";
import { MAX_UNDERWRITING_HOLD_PERIOD_YEARS } from "./underwritingModel.js";

const MAX_MODEL_YEARS = MAX_UNDERWRITING_HOLD_PERIOD_YEARS;
const CURRENCY_FMT = "$#,##0.00";
const PERCENT_FMT = "0.00%";
const INPUT_PERCENT_FMT = "0.00";
const MULTIPLE_FMT = "0.00x";
const INTEGER_FMT = "0";

type SheetValue = string | number | XLSX.CellObject | null | undefined;
type CellStyle = NonNullable<XLSX.CellObject["s"]>;

function num(n: number | null | undefined): number {
  return n != null && Number.isFinite(n) ? n : 0;
}

const titleStyle: CellStyle = {
  font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "1F4E78" } },
  alignment: { horizontal: "left", vertical: "center" },
};

const sectionStyle: CellStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "5B9BD5" } },
  alignment: { horizontal: "left", vertical: "center" },
};

const columnHeaderStyle: CellStyle = {
  font: { bold: true, color: { rgb: "1F1F1F" } },
  fill: { patternType: "solid", fgColor: { rgb: "D9EAF7" } },
  alignment: { horizontal: "center", vertical: "center" },
};

const labelStyle: CellStyle = {
  font: { bold: true, color: { rgb: "404040" } },
};

const inputLabelStyle: CellStyle = {
  ...labelStyle,
  fill: { patternType: "solid", fgColor: { rgb: "FFF2CC" } },
};

const inputValueStyle: CellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "FFF9E6" } },
  protection: { locked: false },
};

const formulaValueStyle: CellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "E2F0D9" } },
};

const textValueStyle: CellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
};

const baseCaseStyle: CellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "D9EAF7" } },
};

const greenToRedScale = ["F8696B", "F4B183", "FFE699", "C6E0B4", "63BE7B"];
function n(value: number, format?: string, style?: CellStyle): XLSX.CellObject {
  const cell: XLSX.CellObject = { t: "n", v: value };
  if (format) cell.z = format;
  if (style) cell.s = style;
  return cell;
}

function f(formula: string, format?: string, style?: CellStyle): XLSX.CellObject {
  const cell: XLSX.CellObject = { t: "n", v: 0, f: formula };
  if (format) cell.z = format;
  if (style) cell.s = style;
  return cell;
}

function fs(formula: string, style?: CellStyle): XLSX.CellObject {
  const cell: XLSX.CellObject = { t: "s", v: "", f: formula };
  if (style) cell.s = style;
  return cell;
}

function s(value: string, style?: CellStyle): XLSX.CellObject {
  const cell: XLSX.CellObject = { t: "s", v: value };
  if (style) cell.s = style;
  return cell;
}

function sheet(rows: SheetValue[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

function widthSheet(ws: XLSX.WorkSheet, widths: number[]): XLSX.WorkSheet {
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

function protectSheet(ws: XLSX.WorkSheet): XLSX.WorkSheet {
  ws["!protect"] = {
    selectLockedCells: false,
    selectUnlockedCells: true,
  };
  return ws;
}

function scenarioHeatStyle(index: number, total: number, positiveDirection: "higher_better" | "lower_better"): CellStyle {
  const scale = total <= 4 ? [greenToRedScale[0], greenToRedScale[2], greenToRedScale[3], greenToRedScale[4]] : greenToRedScale;
  const colors = positiveDirection === "higher_better" ? scale : [...scale].reverse();
  const colorIndex = Math.max(0, Math.min(colors.length - 1, Math.round((index / Math.max(1, total - 1)) * (colors.length - 1))));
  return {
    fill: { patternType: "solid", fgColor: { rgb: colors[colorIndex]! } },
  };
}

function col(index: number): string {
  return XLSX.utils.encode_col(index);
}

export function buildExcelProForma(ctx: UnderwritingContext): Buffer {
  const wb = XLSX.utils.book_new();

  const rentRows =
    ctx.rentRollRows && ctx.rentRollRows.length > 0
      ? ctx.rentRollRows
      : [{ label: "Current gross rent", annualRent: num(ctx.currentGrossRent) }];
  const expenseRows =
    ctx.expenseRows && ctx.expenseRows.length > 0
      ? ctx.expenseRows
      : [{ lineItem: "Current expenses", amount: num(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses) }];

  const rentStartRow = 4;
  const rentEndRow = rentStartRow + rentRows.length - 1;
  const rentTotalRow = rentEndRow + 1;
  const expenseHeaderRow = rentTotalRow + 2;
  const expenseStartRow = expenseHeaderRow + 1;
  const expenseEndRow = expenseStartRow + expenseRows.length - 1;
  const expenseTotalRow = expenseEndRow + 1;
  const currentSummaryStartRow = expenseTotalRow + 2;

  const assumptionsSheet = widthSheet(
    sheet([
      [s("Deal Pro Forma Inputs", titleStyle), ""],
      [s("Property", labelStyle), s(ctx.canonicalAddress, textValueStyle)],
      [s("Area", labelStyle), s(ctx.listingCity ?? "", textValueStyle)],
      [s("Units", labelStyle), ctx.unitCount != null ? n(ctx.unitCount, INTEGER_FMT, textValueStyle) : ""],
      [s("Deal score", labelStyle), ctx.dealScore != null ? n(ctx.dealScore, INTEGER_FMT, textValueStyle) : ""],
      ["", ""],
      [s("Purchase price", inputLabelStyle), n(num(ctx.assumptions.acquisition.purchasePrice), CURRENCY_FMT, inputValueStyle)],
      [s("Purchase closing costs (%)", inputLabelStyle), n(num(ctx.assumptions.acquisition.purchaseClosingCostPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Renovation costs", inputLabelStyle), n(num(ctx.assumptions.acquisition.renovationCosts), CURRENCY_FMT, inputValueStyle)],
      [s("Furnishing / setup costs", inputLabelStyle), n(num(ctx.assumptions.acquisition.furnishingSetupCosts), CURRENCY_FMT, inputValueStyle)],
      ["", ""],
      [s("Loan-to-value (%)", inputLabelStyle), n(num(ctx.assumptions.financing.ltvPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Interest rate (%)", inputLabelStyle), n(num(ctx.assumptions.financing.interestRatePct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Amortization period (years)", inputLabelStyle), n(num(ctx.assumptions.financing.amortizationYears), INTEGER_FMT, inputValueStyle)],
      ["", ""],
      [s("Rent uplift (%)", inputLabelStyle), n(num(ctx.assumptions.operating.rentUpliftPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Expense increase (%)", inputLabelStyle), n(num(ctx.assumptions.operating.expenseIncreasePct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Management fee (%)", inputLabelStyle), n(num(ctx.assumptions.operating.managementFeePct), INPUT_PERCENT_FMT, inputValueStyle)],
      ["", ""],
      [s("Hold period (years)", inputLabelStyle), n(num(ctx.assumptions.holdPeriodYears), INTEGER_FMT, inputValueStyle)],
      ["", ""],
      [s("Exit cap rate (%)", inputLabelStyle), n(num(ctx.assumptions.exit.exitCapPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Exit closing costs (%)", inputLabelStyle), n(num(ctx.assumptions.exit.exitClosingCostPct), INPUT_PERCENT_FMT, inputValueStyle)],
    ]),
    [34, 18]
  );
  assumptionsSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(assumptionsSheet);
  XLSX.utils.book_append_sheet(wb, assumptionsSheet, "Assumptions");

  const currentFinancialRows: SheetValue[][] = [
    [s("Current Financials", titleStyle), ""],
    ["", ""],
    [s("Gross rent line item", columnHeaderStyle), s("Annual amount", columnHeaderStyle)],
    ...rentRows.map((row) => [s(row.label, inputLabelStyle), n(row.annualRent, CURRENCY_FMT, inputValueStyle)]),
    [s("Total gross rent", labelStyle), f(`SUM(B${rentStartRow}:B${rentEndRow})`, CURRENCY_FMT, formulaValueStyle)],
    ["", ""],
    [s("Expense line item", columnHeaderStyle), s("Annual amount", columnHeaderStyle)],
    ...expenseRows.map((row) => [s(row.lineItem, inputLabelStyle), n(row.amount, CURRENCY_FMT, inputValueStyle)]),
    [s("Total expenses", labelStyle), f(`SUM(B${expenseStartRow}:B${expenseEndRow})`, CURRENCY_FMT, formulaValueStyle)],
    ["", ""],
    [s("Current gross rent", labelStyle), f(`B${rentTotalRow}`, CURRENCY_FMT, formulaValueStyle)],
    [s("Current expenses", labelStyle), f(`B${expenseTotalRow}`, CURRENCY_FMT, formulaValueStyle)],
    [s("Current NOI", labelStyle), f(`B${currentSummaryStartRow}-B${currentSummaryStartRow + 1}`, CURRENCY_FMT, formulaValueStyle)],
  ];
  const currentFinancialsSheet = widthSheet(sheet(currentFinancialRows), [34, 18]);
  currentFinancialsSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(currentFinancialsSheet);
  XLSX.utils.book_append_sheet(wb, currentFinancialsSheet, "CurrentFinancials");

  const acquisitionSheet = widthSheet(
    sheet([
      [s("Acquisition", titleStyle), ""],
      ["", ""],
      [s("Purchase price", labelStyle), f("Assumptions!B7", CURRENCY_FMT, formulaValueStyle)],
      [s("Purchase closing cost (%)", labelStyle), f("Assumptions!B8", INPUT_PERCENT_FMT, formulaValueStyle)],
      [s("Purchase closing costs", labelStyle), f("B3*(B4/100)", CURRENCY_FMT, formulaValueStyle)],
      [s("Renovation costs", labelStyle), f("Assumptions!B9", CURRENCY_FMT, formulaValueStyle)],
      [s("Furnishing / setup costs", labelStyle), f("Assumptions!B10", CURRENCY_FMT, formulaValueStyle)],
      [s("Total project cost", sectionStyle), f("SUM(B3,B5:B7)", CURRENCY_FMT, formulaValueStyle)],
      [s("Loan amount", labelStyle), f("B3*(Assumptions!B12/100)", CURRENCY_FMT, formulaValueStyle)],
      [s("Equity required for purchase", labelStyle), f("B3-B9", CURRENCY_FMT, formulaValueStyle)],
      [s("Initial equity invested", sectionStyle), f("B8-B9", CURRENCY_FMT, formulaValueStyle)],
      [s("Year 0 cash flow", sectionStyle), f("-B11", CURRENCY_FMT, formulaValueStyle)],
    ]),
    [34, 18]
  );
  acquisitionSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(acquisitionSheet);
  XLSX.utils.book_append_sheet(wb, acquisitionSheet, "Acquisition");

  const operationsSheet = widthSheet(
    sheet([
      [s("Operations", titleStyle), ""],
      ["", ""],
      [s("Current gross rent", labelStyle), f(`CurrentFinancials!B${currentSummaryStartRow}`, CURRENCY_FMT, formulaValueStyle)],
      [s("Current expenses", labelStyle), f(`CurrentFinancials!B${currentSummaryStartRow + 1}`, CURRENCY_FMT, formulaValueStyle)],
      [s("Current NOI", labelStyle), f(`CurrentFinancials!B${currentSummaryStartRow + 2}`, CURRENCY_FMT, formulaValueStyle)],
      ["", ""],
      [s("Rent uplift (%)", labelStyle), f("Assumptions!B16", INPUT_PERCENT_FMT, formulaValueStyle)],
      [s("Expense increase (%)", labelStyle), f("Assumptions!B17", INPUT_PERCENT_FMT, formulaValueStyle)],
      [s("Management fee (%)", labelStyle), f("Assumptions!B18", INPUT_PERCENT_FMT, formulaValueStyle)],
      ["", ""],
      [s("Adjusted gross rent", labelStyle), f("B3*(1+B7/100)", CURRENCY_FMT, formulaValueStyle)],
      [s("Adjusted operating expenses", labelStyle), f("B4*(1+B8/100)", CURRENCY_FMT, formulaValueStyle)],
      [s("Management fee", labelStyle), f("B11*(B9/100)", CURRENCY_FMT, formulaValueStyle)],
      [s("Stabilized NOI", sectionStyle), f("B11-B12-B13", CURRENCY_FMT, formulaValueStyle)],
      [s("Current cap rate", labelStyle), f('IF(Acquisition!B3=0,"",B5/Acquisition!B3)', PERCENT_FMT, formulaValueStyle)],
      [s("Stabilized cap rate", sectionStyle), f('IF(Acquisition!B3=0,"",B14/Acquisition!B3)', PERCENT_FMT, formulaValueStyle)],
    ]),
    [34, 18]
  );
  operationsSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(operationsSheet);
  XLSX.utils.book_append_sheet(wb, operationsSheet, "Operations");

  const financingRows: SheetValue[][] = [
    [s("Financing", titleStyle), ""],
    [s("Monthly interest rate", labelStyle), f("Assumptions!B13/100/12", "0.0000%", formulaValueStyle)],
    [s("Total amortization months", labelStyle), f("Assumptions!B14*12", INTEGER_FMT, formulaValueStyle)],
    [s("Monthly payment", sectionStyle), f('IF(Acquisition!B9=0,0,IF(B2=0,Acquisition!B9/B3,-PMT(B2,B3,Acquisition!B9)))', CURRENCY_FMT, formulaValueStyle)],
    [s("Annual debt service (year 1)", sectionStyle), f("B4*12", CURRENCY_FMT, formulaValueStyle)],
    ["", ""],
    [
      s("Year", columnHeaderStyle),
      s("Beginning balance", columnHeaderStyle),
      s("Debt service", columnHeaderStyle),
      s("Principal paid", columnHeaderStyle),
      s("Interest paid", columnHeaderStyle),
      s("Ending balance", columnHeaderStyle),
    ],
  ];

  for (let year = 1; year <= MAX_MODEL_YEARS; year++) {
    const row = 7 + year;
    const previousEnding = row - 1;
    financingRows.push([
      n(year, INTEGER_FMT, textValueStyle),
      year === 1 ? f("Acquisition!B9", CURRENCY_FMT, formulaValueStyle) : f(`F${previousEnding}`, CURRENCY_FMT, formulaValueStyle),
      f(`IF(A${row}<=Assumptions!B14,$B$4*12,0)`, CURRENCY_FMT, formulaValueStyle),
      f(`B${row}-F${row}`, CURRENCY_FMT, formulaValueStyle),
      f(`C${row}-D${row}`, CURRENCY_FMT, formulaValueStyle),
      f(
        `IF(A${row}*12>=$B$3,0,IF($B$2=0,MAX(0,Acquisition!$B$9-($B$4*12*A${row})),MAX(0,Acquisition!$B$9*(1+$B$2)^(MIN(A${row}*12,$B$3))-$B$4*(((1+$B$2)^(MIN(A${row}*12,$B$3))-1)/$B$2))))`,
        CURRENCY_FMT,
        formulaValueStyle
      ),
    ]);
  }
  const financingSheet = widthSheet(sheet(financingRows), [10, 18, 18, 18, 18, 18]);
  financingSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  protectSheet(financingSheet);
  XLSX.utils.book_append_sheet(wb, financingSheet, "Financing");

  const financingEndingRangeEnd = 7 + MAX_MODEL_YEARS;

  const exitSheet = widthSheet(
    sheet([
      [s("Exit", titleStyle), ""],
      ["", ""],
      [s("Hold period (years)", labelStyle), f("Assumptions!B20", INTEGER_FMT, formulaValueStyle)],
      [s("Exit cap rate (%)", labelStyle), f("Assumptions!B22", INPUT_PERCENT_FMT, formulaValueStyle)],
      [s("Exit closing costs (%)", labelStyle), f("Assumptions!B23", INPUT_PERCENT_FMT, formulaValueStyle)],
      [s("Exit property value", sectionStyle), f('IF(B4=0,0,Operations!B14/(B4/100))', CURRENCY_FMT, formulaValueStyle)],
      [s("Sale closing costs", labelStyle), f("B6*(B5/100)", CURRENCY_FMT, formulaValueStyle)],
      [s("Net sale proceeds before debt payoff", labelStyle), f("B6-B7", CURRENCY_FMT, formulaValueStyle)],
      [s("Remaining loan balance", labelStyle), f(`IFERROR(INDEX(Financing!F8:F${financingEndingRangeEnd},B3),0)`, CURRENCY_FMT, formulaValueStyle)],
      [s("Net proceeds to equity", sectionStyle), f("B8-B9", CURRENCY_FMT, formulaValueStyle)],
    ]),
    [34, 18]
  );
  exitSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(exitSheet);
  XLSX.utils.book_append_sheet(wb, exitSheet, "Exit");

  const cashFlowRows: SheetValue[][] = [
    [s("Cash Flow", titleStyle), "", "", "", ""],
    ["", "", "", "", ""],
    [
      s("Year", columnHeaderStyle),
      s("Equity cash flow", columnHeaderStyle),
      s("Operating cash flow", columnHeaderStyle),
      s("Debt service", columnHeaderStyle),
      s("Sale proceeds to equity", columnHeaderStyle),
    ],
    [n(0, INTEGER_FMT, textValueStyle), f("Acquisition!B12", CURRENCY_FMT, formulaValueStyle), "", "", ""],
  ];

  for (let year = 1; year <= MAX_MODEL_YEARS; year++) {
    const row = 4 + year;
    cashFlowRows.push([
      n(year, INTEGER_FMT, textValueStyle),
      f(`IF(A${row}<=Exit!$B$3,C${row}+E${row},"")`, CURRENCY_FMT, formulaValueStyle),
      f(`IF(A${row}<=Exit!$B$3,Operations!$B$14-D${row},"")`, CURRENCY_FMT, formulaValueStyle),
      f(`IF(A${row}<=Exit!$B$3,INDEX(Financing!$C$8:$C$${financingEndingRangeEnd},A${row}),"")`, CURRENCY_FMT, formulaValueStyle),
      f(`IF(A${row}=Exit!$B$3,Exit!$B$10,0)`, CURRENCY_FMT, formulaValueStyle),
    ]);
  }
  const cashFlowSheet = widthSheet(sheet(cashFlowRows), [10, 18, 18, 18, 18]);
  cashFlowSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  protectSheet(cashFlowSheet);
  XLSX.utils.book_append_sheet(wb, cashFlowSheet, "CashFlow");

  const returnsSheet = widthSheet(
    sheet([
      [s("Returns", titleStyle), ""],
      ["", ""],
      [s("Initial equity invested", labelStyle), f("-CashFlow!B4", CURRENCY_FMT, formulaValueStyle)],
      [
        s("Total cash received", labelStyle),
        f(
          `SUMPRODUCT((CashFlow!B5:INDEX(CashFlow!B:B,4+Exit!B3))*--(CashFlow!B5:INDEX(CashFlow!B:B,4+Exit!B3)>0))`,
          CURRENCY_FMT,
          formulaValueStyle
        ),
      ],
      [s("IRR", sectionStyle), f('IFERROR(IRR(CashFlow!B4:INDEX(CashFlow!B:B,4+Exit!B3)),"")', PERCENT_FMT, formulaValueStyle)],
      [s("Equity multiple", sectionStyle), f('IF(B3=0,"",B4/B3)', MULTIPLE_FMT, formulaValueStyle)],
      [s("Year 1 cash-on-cash return", sectionStyle), f('IF(B3=0,"",CashFlow!C5/B3)', PERCENT_FMT, formulaValueStyle)],
      [s("Average cash-on-cash return", sectionStyle), f('IF(B3=0,"",AVERAGE(CashFlow!C5:INDEX(CashFlow!C:C,4+Exit!B3))/B3)', PERCENT_FMT, formulaValueStyle)],
    ]),
    [34, 18]
  );
  returnsSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(returnsSheet);
  XLSX.utils.book_append_sheet(wb, returnsSheet, "Returns");

  const sensitivitiesRows: SheetValue[][] = [[s("Sensitivity Tables", titleStyle), "", "", "", "", ""]];
  const sensitivityConfigs = [
    {
      title: "Rental Uplift Sensitivity",
      inputLabel: "Rental uplift (%)",
      values: RENTAL_UPLIFT_SENSITIVITY_VALUES,
      baseValueFormula: "Assumptions!$B$16",
      key: "rental_uplift" as const,
      direction: "higher_better" as const,
    },
    {
      title: "Expense Increase Sensitivity",
      inputLabel: "Expense increase (%)",
      values: EXPENSE_INCREASE_SENSITIVITY_VALUES,
      baseValueFormula: "Assumptions!$B$17",
      key: "expense_increase" as const,
      direction: "lower_better" as const,
    },
    {
      title: "Management Fee Sensitivity",
      inputLabel: "Management fee (%)",
      values: MANAGEMENT_FEE_SENSITIVITY_VALUES,
      baseValueFormula: "Assumptions!$B$18",
      key: "management_fee" as const,
      direction: "lower_better" as const,
    },
  ];

  const sensitivityTableStartRows: Record<string, number> = {};
  const helperStartCol = 6;
  const helperNetProceedsCol = col(helperStartCol);
  const helperYear0Col = col(helperStartCol + 1);
  const currentGrossRef = `CurrentFinancials!B${currentSummaryStartRow}`;
  const currentExpenseRef = `CurrentFinancials!B${currentSummaryStartRow + 1}`;

  for (const config of sensitivityConfigs) {
    while (sensitivitiesRows.length < 2 || sensitivitiesRows[sensitivitiesRows.length - 1]?.some(Boolean)) {
      sensitivitiesRows.push(["", "", "", "", "", ""]);
    }
    const tableStartRow = sensitivitiesRows.length + 1;
    sensitivityTableStartRows[config.key] = tableStartRow;
    const headerRow = tableStartRow + 4;
    const baseRow = tableStartRow + 5;
    const scenarioStartRow = tableStartRow + 6;
    const scenarioEndRow = scenarioStartRow + config.values.length - 1;

    sensitivitiesRows.push([s(config.title, sectionStyle), "", "", "", "", ""]);
    sensitivitiesRows.push([
      s("IRR range across tested cases", labelStyle),
      fs(`TEXT(MIN(E${scenarioStartRow}:E${scenarioEndRow}),"0.00%")&" to "&TEXT(MAX(E${scenarioStartRow}:E${scenarioEndRow}),"0.00%")`, formulaValueStyle),
      "",
      s("Base case IRR", labelStyle),
      f(`E${baseRow}`, PERCENT_FMT, baseCaseStyle),
      "",
    ]);
    sensitivitiesRows.push([
      s("CoC range across tested cases", labelStyle),
      fs(`TEXT(MIN(F${scenarioStartRow}:F${scenarioEndRow}),"0.00%")&" to "&TEXT(MAX(F${scenarioStartRow}:F${scenarioEndRow}),"0.00%")`, formulaValueStyle),
      "",
      s("Base case CoC", labelStyle),
      f(`F${baseRow}`, PERCENT_FMT, baseCaseStyle),
      "",
    ]);
    sensitivitiesRows.push(["", "", "", "", "", ""]);
    sensitivitiesRows.push([
      s("Scenario", columnHeaderStyle),
      s(config.inputLabel, columnHeaderStyle),
      s("Stabilized NOI", columnHeaderStyle),
      s("Annual op CF", columnHeaderStyle),
      s("IRR", columnHeaderStyle),
      s("Year 1 CoC", columnHeaderStyle),
    ]);

    const allRows = [{ label: "Base case", valueFormula: config.baseValueFormula, style: baseCaseStyle }, ...config.values.map((value, index) => ({
      label: `Scenario ${index + 1}`,
      value: value,
      style: scenarioHeatStyle(index, config.values.length, config.direction),
    }))];

    allRows.forEach((entry, index) => {
      const row = baseRow + index;
      const rentExpr =
        config.key === "rental_uplift" ? `B${row}` : "Assumptions!$B$16";
      const expenseExpr =
        config.key === "expense_increase" ? `B${row}` : "Assumptions!$B$17";
      const managementExpr =
        config.key === "management_fee" ? `B${row}` : "Assumptions!$B$18";
      const adjustedGrossFormula = `(${currentGrossRef})*(1+(${rentExpr}/100))`;
      const adjustedExpenseFormula = `(${currentExpenseRef})*(1+(${expenseExpr}/100))`;
      const managementFeeFormula = `(${adjustedGrossFormula})*(${managementExpr}/100)`;
      const noiFormula = `(${adjustedGrossFormula})-(${adjustedExpenseFormula})-(${managementFeeFormula})`;
      const netProceedsFormula = `(((${noiFormula})/(Assumptions!$B$22/100))*(1-Assumptions!$B$23/100))-Exit!$B$9`;
      const rowStyle = entry.style;

      sensitivitiesRows.push([
        s(entry.label, rowStyle),
        "valueFormula" in entry
          ? f(entry.valueFormula, INPUT_PERCENT_FMT, rowStyle)
          : n(entry.value, INPUT_PERCENT_FMT, { ...rowStyle, protection: { locked: false } }),
        f(noiFormula, CURRENCY_FMT, rowStyle),
        f(`C${row}-Financing!$B$5`, CURRENCY_FMT, rowStyle),
        f(`IFERROR(IRR(${helperYear0Col}${row}:INDEX(${row}:${row},${helperStartCol + 2 + MAX_MODEL_YEARS})),"")`, PERCENT_FMT, rowStyle),
        f(`IF(Acquisition!$B$11=0,"",D${row}/Acquisition!$B$11)`, PERCENT_FMT, rowStyle),
      ]);

      sensitivitiesRows[row - 1]![helperStartCol] = f(netProceedsFormula, CURRENCY_FMT, formulaValueStyle);
      sensitivitiesRows[row - 1]![helperStartCol + 1] = f("-Acquisition!$B$11", CURRENCY_FMT, formulaValueStyle);
      for (let year = 1; year <= MAX_MODEL_YEARS; year++) {
        const helperColIndex = helperStartCol + 1 + year;
        const helperCol = col(helperColIndex);
        sensitivitiesRows[row - 1]![helperColIndex] = f(
          `IF(${year}<=Exit!$B$3,C${row}-INDEX(Financing!$C$8:$C$${financingEndingRangeEnd},${year})+IF(${year}=Exit!$B$3,${helperNetProceedsCol}${row},0),"")`,
          CURRENCY_FMT,
          formulaValueStyle
        );
        if (sensitivitiesRows[headerRow - 1]!.length <= helperColIndex) {
          sensitivitiesRows[headerRow - 1]![helperColIndex] = s(helperCol, columnHeaderStyle);
        }
      }
    });
  }

  const sensitivitiesSheet = widthSheet(sheet(sensitivitiesRows), [
    18,
    16,
    18,
    18,
    14,
    14,
    18,
    18,
    ...Array.from({ length: MAX_MODEL_YEARS }, () => 14),
  ]);
  sensitivitiesSheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    ...Object.values(sensitivityTableStartRows).map((row) => ({
      s: { r: row - 1, c: 0 },
      e: { r: row - 1, c: 5 },
    })),
  ];
  sensitivitiesSheet["!cols"]?.forEach((column, index) => {
    if (index >= helperStartCol) column.hidden = true;
  });
  protectSheet(sensitivitiesSheet);
  XLSX.utils.book_append_sheet(wb, sensitivitiesSheet, "Sensitivities");

  const summarySheet = widthSheet(
    sheet([
      [s("Deal Pro Forma Summary", titleStyle), ""],
      [s("Property", labelStyle), s(ctx.canonicalAddress, textValueStyle)],
      [s("Area", labelStyle), s(ctx.listingCity ?? "", textValueStyle)],
      [s("Units", labelStyle), ctx.unitCount != null ? n(ctx.unitCount, INTEGER_FMT, textValueStyle) : ""],
      [s("Deal score", labelStyle), ctx.dealScore != null ? n(ctx.dealScore, INTEGER_FMT, textValueStyle) : ""],
      ["", ""],
      [s("Purchase price", labelStyle), f("Acquisition!B3", CURRENCY_FMT, formulaValueStyle)],
      [s("Total project cost", sectionStyle), f("Acquisition!B8", CURRENCY_FMT, formulaValueStyle)],
      [s("Initial equity invested", sectionStyle), f("Acquisition!B11", CURRENCY_FMT, formulaValueStyle)],
      [s("Current NOI", labelStyle), f("Operations!B5", CURRENCY_FMT, formulaValueStyle)],
      [s("Current cap rate", labelStyle), f("Operations!B15", PERCENT_FMT, formulaValueStyle)],
      [s("Stabilized NOI", sectionStyle), f("Operations!B14", CURRENCY_FMT, formulaValueStyle)],
      [s("Stabilized cap rate", sectionStyle), f("Operations!B16", PERCENT_FMT, formulaValueStyle)],
      [s("Annual operating cash flow (year 1)", sectionStyle), f("CashFlow!C5", CURRENCY_FMT, formulaValueStyle)],
      [s("Annual debt service (year 1)", labelStyle), f("Financing!B5", CURRENCY_FMT, formulaValueStyle)],
      [s("Net proceeds to equity", sectionStyle), f("Exit!B10", CURRENCY_FMT, formulaValueStyle)],
      [s("IRR", sectionStyle), f("Returns!B5", PERCENT_FMT, formulaValueStyle)],
      [s("Equity multiple", sectionStyle), f("Returns!B6", MULTIPLE_FMT, formulaValueStyle)],
      [s("Year 1 cash-on-cash return", sectionStyle), f("Returns!B7", PERCENT_FMT, formulaValueStyle)],
      [s("Average cash-on-cash return", sectionStyle), f("Returns!B8", PERCENT_FMT, formulaValueStyle)],
      ["", ""],
      [s("Rental uplift sensitivity IRR range", labelStyle), fs(`Sensitivities!B${sensitivityTableStartRows.rental_uplift + 1}`, formulaValueStyle)],
      [s("Rental uplift sensitivity CoC range", labelStyle), fs(`Sensitivities!B${sensitivityTableStartRows.rental_uplift + 2}`, formulaValueStyle)],
      [s("Expense sensitivity IRR range", labelStyle), fs(`Sensitivities!B${sensitivityTableStartRows.expense_increase + 1}`, formulaValueStyle)],
      [s("Expense sensitivity CoC range", labelStyle), fs(`Sensitivities!B${sensitivityTableStartRows.expense_increase + 2}`, formulaValueStyle)],
      [s("Management fee sensitivity IRR range", labelStyle), fs(`Sensitivities!B${sensitivityTableStartRows.management_fee + 1}`, formulaValueStyle)],
      [s("Management fee sensitivity CoC range", labelStyle), fs(`Sensitivities!B${sensitivityTableStartRows.management_fee + 2}`, formulaValueStyle)],
    ]),
    [34, 18]
  );
  summarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(summarySheet);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as ArrayBuffer
  );
}
