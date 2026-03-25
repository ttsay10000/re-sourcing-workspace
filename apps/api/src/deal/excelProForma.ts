import * as XLSX from "xlsx";
import type { UnderwritingContext, ExpenseRow } from "./underwritingContext.js";
import {
  MAX_UNDERWRITING_HOLD_PERIOD_YEARS,
  normalizeExpenseProjectionInputs,
} from "./underwritingModel.js";

const MAX_MODEL_YEARS = MAX_UNDERWRITING_HOLD_PERIOD_YEARS;
const CURRENCY_FMT = "$#,##0";
const PERCENT_FMT = "0.00%";
const INPUT_PERCENT_FMT = "0.00";
const MULTIPLE_FMT = "0.00x";
const INTEGER_FMT = "0";

type SheetValue = string | number | XLSX.CellObject | null | undefined;
type CellStyle = NonNullable<XLSX.CellObject["s"]>;

const titleStyle: CellStyle = {
  font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "203864" } },
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

function col(index: number): string {
  return XLSX.utils.encode_col(index);
}

function num(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

function isTaxExpense(lineItem: string): boolean {
  return /tax/i.test(lineItem);
}

export function buildExcelProForma(ctx: UnderwritingContext): Buffer {
  const wb = XLSX.utils.book_new();
  const assetCapRateNoiBasis = num(ctx.assetCapRateNoiBasis ?? ctx.currentNoi);
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
            yearlyAmounts: undefined,
          },
        ];
  const aggregateExpenseFallback =
    projectedExpenseRows.length === 0 && normalizedExpenseInputs.expenseRowsExManagement.length === 0;
  const assumptionRows = {
    purchasePrice: 7,
    purchaseClosingPct: 8,
    renovationCosts: 9,
    furnishingCosts: 10,
    onboardingCosts: 11,
    currentGrossRent: 12,
    currentOtherIncome: 13,
    currentExpenses: 14,
    ltvPct: 16,
    interestRatePct: 17,
    amortizationYears: 18,
    loanFeePct: 19,
    rentUpliftPct: 21,
    blendedRentUpliftPct: 22,
    expenseIncreasePct: 23,
    managementFeePct: 24,
    occupancyTaxPct: 25,
    vacancyPct: 26,
    leadTimeMonths: 27,
    annualRentGrowthPct: 28,
    annualOtherIncomeGrowthPct: 29,
    annualExpenseGrowthPct: 30,
    annualPropertyTaxGrowthPct: 31,
    recurringCapexAnnual: 32,
    holdPeriodYears: 34,
    exitCapPct: 35,
    exitClosingCostPct: 36,
    targetIrrPct: 37,
  } as const;

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
      [s("Onboarding / unit turn costs", inputLabelStyle), n(num(ctx.assumptions.acquisition.onboardingCosts), CURRENCY_FMT, inputValueStyle)],
      [s("Current gross rent", labelStyle), n(num(ctx.currentGrossRent), CURRENCY_FMT, textValueStyle)],
      [s("Current other income", labelStyle), n(num(ctx.currentOtherIncome), CURRENCY_FMT, textValueStyle)],
      [
        s("Current expenses (ex management)", labelStyle),
        n(normalizedExpenseInputs.currentExpensesTotalExManagement, CURRENCY_FMT, textValueStyle),
      ],
      ["", ""],
      [s("Loan-to-value (%)", inputLabelStyle), n(num(ctx.assumptions.financing.ltvPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Interest rate (%)", inputLabelStyle), n(num(ctx.assumptions.financing.interestRatePct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Amortization period (years)", inputLabelStyle), n(num(ctx.assumptions.financing.amortizationYears), INTEGER_FMT, inputValueStyle)],
      [s("Loan fee (%)", inputLabelStyle), n(num(ctx.assumptions.financing.loanFeePct), INPUT_PERCENT_FMT, inputValueStyle)],
      ["", ""],
      [s("Rent uplift (%)", inputLabelStyle), n(num(ctx.assumptions.operating.rentUpliftPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Blended rent uplift (%)", labelStyle), n(num(ctx.assumptions.operating.blendedRentUpliftPct), INPUT_PERCENT_FMT, textValueStyle)],
      [s("Expense increase (%)", inputLabelStyle), n(num(ctx.assumptions.operating.expenseIncreasePct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Management fee (%)", inputLabelStyle), n(num(ctx.assumptions.operating.managementFeePct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Occupancy tax (%)", inputLabelStyle), n(num(ctx.assumptions.operating.occupancyTaxPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Vacancy (%)", inputLabelStyle), n(num(ctx.assumptions.operating.vacancyPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Lead time (months)", inputLabelStyle), n(num(ctx.assumptions.operating.leadTimeMonths), INTEGER_FMT, inputValueStyle)],
      [s("Annual rent growth (%)", inputLabelStyle), n(num(ctx.assumptions.operating.annualRentGrowthPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Annual other-income growth (%)", inputLabelStyle), n(num(ctx.assumptions.operating.annualOtherIncomeGrowthPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Annual expense growth (%)", inputLabelStyle), n(num(ctx.assumptions.operating.annualExpenseGrowthPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Annual property-tax growth (%)", inputLabelStyle), n(num(ctx.assumptions.operating.annualPropertyTaxGrowthPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Recurring CapEx / reserve", inputLabelStyle), n(num(ctx.assumptions.operating.recurringCapexAnnual), CURRENCY_FMT, inputValueStyle)],
      ["", ""],
      [s("Hold period (years)", inputLabelStyle), n(num(ctx.assumptions.holdPeriodYears), INTEGER_FMT, inputValueStyle)],
      [s("Exit cap rate (%)", inputLabelStyle), n(num(ctx.assumptions.exit.exitCapPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Exit closing costs (%)", inputLabelStyle), n(num(ctx.assumptions.exit.exitClosingCostPct), INPUT_PERCENT_FMT, inputValueStyle)],
      [s("Target IRR (%)", inputLabelStyle), n(num(ctx.assumptions.targetIrrPct), INPUT_PERCENT_FMT, inputValueStyle)],
    ]),
    [34, 18]
  );
  assumptionsSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  protectSheet(assumptionsSheet);
  XLSX.utils.book_append_sheet(wb, assumptionsSheet, "Assumptions");

  const financingRows: SheetValue[][] = [
    [s("Financing", titleStyle), ""],
    [s("Loan amount", labelStyle), f(`Assumptions!B${assumptionRows.purchasePrice}*(Assumptions!B${assumptionRows.ltvPct}/100)`, CURRENCY_FMT, formulaValueStyle)],
    [s("Financing fees", labelStyle), f(`B2*(Assumptions!B${assumptionRows.loanFeePct}/100)`, CURRENCY_FMT, formulaValueStyle)],
    [s("Purchase closing costs", labelStyle), f(`Assumptions!B${assumptionRows.purchasePrice}*(Assumptions!B${assumptionRows.purchaseClosingPct}/100)`, CURRENCY_FMT, formulaValueStyle)],
    [s("Total project cost", sectionStyle), f(`SUM(Assumptions!B${assumptionRows.purchasePrice},B4,Assumptions!B${assumptionRows.renovationCosts},Assumptions!B${assumptionRows.furnishingCosts},Assumptions!B${assumptionRows.onboardingCosts})`, CURRENCY_FMT, formulaValueStyle)],
    [s("Initial equity invested", sectionStyle), f(`B5+B3-B2`, CURRENCY_FMT, formulaValueStyle)],
    [s("Monthly interest rate", labelStyle), f(`Assumptions!B${assumptionRows.interestRatePct}/100/12`, "0.0000%", formulaValueStyle)],
    [s("Total amortization months", labelStyle), f(`Assumptions!B${assumptionRows.amortizationYears}*12`, INTEGER_FMT, formulaValueStyle)],
    [s("Monthly payment", sectionStyle), f(`IF(B2=0,0,IF(B7=0,B2/B8,-PMT(B7,B8,B2)))`, CURRENCY_FMT, formulaValueStyle)],
    [s("Annual debt service (year 1)", sectionStyle), f(`B9*12`, CURRENCY_FMT, formulaValueStyle)],
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
    const row = 12 + year;
    const priorRow = row - 1;
    financingRows.push([
      n(year, INTEGER_FMT, textValueStyle),
      year === 1 ? f("$B$2", CURRENCY_FMT, formulaValueStyle) : f(`F${priorRow}`, CURRENCY_FMT, formulaValueStyle),
      f(`IF(B${row}=0,0,IF(A${row}<=Assumptions!B${assumptionRows.amortizationYears},$B$9*12,0))`, CURRENCY_FMT, formulaValueStyle),
      f(`IF(B${row}=0,0,B${row}-F${row})`, CURRENCY_FMT, formulaValueStyle),
      f(`IF(B${row}=0,0,C${row}-D${row})`, CURRENCY_FMT, formulaValueStyle),
      f(
        `IF(B${row}=0,0,IF(A${row}*12>=$B$8,0,IF($B$7=0,MAX(0,$B$2-($B$9*12*A${row})),MAX(0,$B$2*(1+$B$7)^(MIN(A${row}*12,$B$8))-$B$9*(((1+$B$7)^(MIN(A${row}*12,$B$8))-1)/$B$7)))))`,
        CURRENCY_FMT,
        formulaValueStyle
      ),
    ]);
  }

  const financingSheet = widthSheet(financingRows.length > 0 ? sheet(financingRows) : sheet([[]]), [12, 18, 18, 18, 18, 18]);
  financingSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  protectSheet(financingSheet);
  XLSX.utils.book_append_sheet(wb, financingSheet, "Financing");

  const yearColumns = Array.from({ length: MAX_MODEL_YEARS + 1 }, (_, index) => col(2 + index));
  const expenseStartRow = 14;
  const managementRow = expenseStartRow + expenses.length;
  const totalOperatingExpensesRow = managementRow + 1;
  const noiRow = totalOperatingExpensesRow + 1;
  const recurringCapexRow = noiRow + 1;
  const cfFromOperationsRow = recurringCapexRow + 1;
  const capRateRow = cfFromOperationsRow + 1;
  const debtServiceRow = capRateRow + 1;
  const principalRow = debtServiceRow + 1;
  const interestRow = principalRow + 1;
  const cfAfterFinancingRow = interestRow + 1;
  const totalInvestmentCostRow = cfAfterFinancingRow + 2;
  const saleValueRow = totalInvestmentCostRow + 1;
  const saleClosingCostsRow = saleValueRow + 1;
  const unleveredCfRow = saleClosingCostsRow + 1;
  const financingFundingRow = unleveredCfRow + 2;
  const financingFeesRow = financingFundingRow + 1;
  const financingPayoffRow = financingFeesRow + 1;
  const leveredCfRow = financingPayoffRow + 1;

  const cashFlowRows: SheetValue[][] = [
    [s("Cash Flow", titleStyle), "", "", "", "", ""],
    ["", "", "", "", "", ""],
    [s("Hold period", labelStyle), f(`Assumptions!B${assumptionRows.holdPeriodYears}`, INTEGER_FMT, formulaValueStyle), "", "", "", ""],
    ["", "", "", "", "", ""],
    [s("Line item", columnHeaderStyle), s("Growth", columnHeaderStyle), ...Array.from({ length: MAX_MODEL_YEARS + 1 }, (_, year) => s(`Y${year}`, columnHeaderStyle))],
    [s("Property value", labelStyle), f(`Assumptions!B${assumptionRows.annualRentGrowthPct}/100`, PERCENT_FMT, formulaValueStyle)],
    [s("Gross rental income", labelStyle), f(`Assumptions!B${assumptionRows.annualRentGrowthPct}/100`, PERCENT_FMT, formulaValueStyle)],
    [s("Other income", labelStyle), f(`Assumptions!B${assumptionRows.annualOtherIncomeGrowthPct}/100`, PERCENT_FMT, formulaValueStyle)],
    [s("Vacancy assumption", labelStyle), f(`Assumptions!B${assumptionRows.vacancyPct}/100`, PERCENT_FMT, formulaValueStyle)],
    [s("Lead time assumption", labelStyle), s("Year 1 only", textValueStyle)],
    [s("Net rental income", sectionStyle), ""],
    ["", "", "", "", "", ""],
    [s("Expenses", sectionStyle), ""],
  ];

  expenses.forEach((expense) => {
    cashFlowRows.push([
      s(expense.lineItem, labelStyle),
      expense.annualGrowthPct != null && Number.isFinite(expense.annualGrowthPct)
        ? n(expense.annualGrowthPct / 100, PERCENT_FMT, formulaValueStyle)
        : aggregateExpenseFallback
          ? f(
              `MAX(Assumptions!B${assumptionRows.annualExpenseGrowthPct}/100,Assumptions!B${assumptionRows.annualPropertyTaxGrowthPct}/100)`,
              PERCENT_FMT,
              formulaValueStyle
            )
          : isTaxExpense(expense.lineItem)
            ? f(`Assumptions!B${assumptionRows.annualPropertyTaxGrowthPct}/100`, PERCENT_FMT, formulaValueStyle)
            : f(`Assumptions!B${assumptionRows.annualExpenseGrowthPct}/100`, PERCENT_FMT, formulaValueStyle),
    ]);
  });

  cashFlowRows.push([s("Management fee", labelStyle), f(`Assumptions!B${assumptionRows.managementFeePct}/100`, PERCENT_FMT, formulaValueStyle)]);
  cashFlowRows.push([s("Total operating expenses", sectionStyle), ""]);
  cashFlowRows.push([s("Net operating income (NOI)", sectionStyle), ""]);
  cashFlowRows.push([s("Recurring CapEx / reserve", labelStyle), ""]);
  cashFlowRows.push([s("CF from operations", sectionStyle), ""]);
  cashFlowRows.push([s("Cap rate (starting purchase price)", labelStyle), ""]);
  cashFlowRows.push([s("Debt service payments", labelStyle), ""]);
  cashFlowRows.push([s("Principal paid", labelStyle), ""]);
  cashFlowRows.push([s("Interest paid", labelStyle), ""]);
  cashFlowRows.push([s("CF after financing", sectionStyle), ""]);
  cashFlowRows.push(["", ""]);
  cashFlowRows.push([s("Total investment cost", labelStyle), ""]);
  cashFlowRows.push([s("Sale value", labelStyle), f(`Assumptions!B${assumptionRows.exitCapPct}/100`, PERCENT_FMT, formulaValueStyle)]);
  cashFlowRows.push([s("Closing costs @ sale", labelStyle), f(`Assumptions!B${assumptionRows.exitClosingCostPct}/100`, PERCENT_FMT, formulaValueStyle)]);
  cashFlowRows.push([s("Unlevered CF", sectionStyle), ""]);
  cashFlowRows.push(["", ""]);
  cashFlowRows.push([s("Financing funding", labelStyle), ""]);
  cashFlowRows.push([s("Financing fees", labelStyle), ""]);
  cashFlowRows.push([s("Financing payoff", labelStyle), ""]);
  cashFlowRows.push([s("Levered CF", sectionStyle), ""]);

  const cashFlowSheet = sheet(cashFlowRows);
  cashFlowSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];

  yearColumns.forEach((column, yearIndex) => {
    const year = yearIndex;
    const yearCell = `${column}5`;
    const holdPeriodRef = `Assumptions!B${assumptionRows.holdPeriodYears}`;
    const activeYearCondition = `${column}$5<=${holdPeriodRef}`;
    const activeOperatingYearCondition = `OR(${column}$5=0,${column}$5>${holdPeriodRef})`;
    cashFlowSheet[yearCell] = n(year, INTEGER_FMT, columnHeaderStyle);
    const grossRentCell = `${column}7`;
    cashFlowSheet[grossRentCell] = f(
      `IF(${activeOperatingYearCondition},0,Assumptions!B${assumptionRows.currentGrossRent}*(1+Assumptions!B${assumptionRows.blendedRentUpliftPct}/100)*(1+Assumptions!B${assumptionRows.annualRentGrowthPct}/100)^(${column}$5-1))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const otherIncomeCell = `${column}8`;
    cashFlowSheet[otherIncomeCell] = f(
      `IF(${activeOperatingYearCondition},0,Assumptions!B${assumptionRows.currentOtherIncome}*(1+Assumptions!B${assumptionRows.annualOtherIncomeGrowthPct}/100)^(${column}$5-1))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const vacancyCell = `${column}9`;
    cashFlowSheet[vacancyCell] = f(
      `IF(${activeOperatingYearCondition},0,-${grossRentCell}*(Assumptions!B${assumptionRows.vacancyPct}/100))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const leadTimeCell = `${column}10`;
    cashFlowSheet[leadTimeCell] = f(
      `IF(${column}$5=1,-${grossRentCell}*(Assumptions!B${assumptionRows.leadTimeMonths}/12),0)`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const netRentalIncomeCell = `${column}11`;
    cashFlowSheet[netRentalIncomeCell] = f(
      `${grossRentCell}+${otherIncomeCell}+${vacancyCell}+${leadTimeCell}`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const propertyValueCell = `${column}6`;
    cashFlowSheet[propertyValueCell] = f(
      `IF(${column}$5=0,Assumptions!B${assumptionRows.purchasePrice},IF(${activeYearCondition},Assumptions!B${assumptionRows.purchasePrice}*(1+Assumptions!B${assumptionRows.annualRentGrowthPct}/100)^${column}$5,0))`,
      CURRENCY_FMT,
      formulaValueStyle
    );

    expenses.forEach((expense, expenseIndex) => {
      const row = expenseStartRow + expenseIndex;
      const projectedValue =
        year === 0
          ? 0
          : Array.isArray(expense.yearlyAmounts)
            ? expense.yearlyAmounts[year - 1] ?? 0
            : null;
      cashFlowSheet[`${column}${row}`] =
        projectedValue != null
          ? n(-Math.abs(projectedValue), CURRENCY_FMT, formulaValueStyle)
          : f(
              `IF(${activeOperatingYearCondition},0,-(${expense.amount}*(1+Assumptions!B${assumptionRows.expenseIncreasePct}/100))*((1+B${row})^(${column}$5-1)))`,
              CURRENCY_FMT,
              formulaValueStyle
            );
    });

    const managementCell = `${column}${managementRow}`;
    cashFlowSheet[managementCell] = f(
      `IF(${activeOperatingYearCondition},0,-${grossRentCell}*(Assumptions!B${assumptionRows.managementFeePct}/100))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const expenseRangeStart = `${column}${expenseStartRow}`;
    const expenseRangeEnd = `${column}${managementRow}`;
    const totalExpenseCell = `${column}${totalOperatingExpensesRow}`;
    cashFlowSheet[totalExpenseCell] = f(
      `IF(${activeOperatingYearCondition},0,SUM(${expenseRangeStart}:${expenseRangeEnd}))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const noiCell = `${column}${noiRow}`;
    cashFlowSheet[noiCell] = f(
      `IF(${activeOperatingYearCondition},0,${netRentalIncomeCell}+${totalExpenseCell})`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const capexCell = `${column}${recurringCapexRow}`;
    cashFlowSheet[capexCell] = f(
      `IF(${activeOperatingYearCondition},0,-Assumptions!B${assumptionRows.recurringCapexAnnual})`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const cfOpsCell = `${column}${cfFromOperationsRow}`;
    cashFlowSheet[cfOpsCell] = f(
      `IF(${activeOperatingYearCondition},0,${noiCell}+${capexCell})`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const capRateCell = `${column}${capRateRow}`;
    cashFlowSheet[capRateCell] = f(
      `IF(${activeOperatingYearCondition},"",IF(Assumptions!B${assumptionRows.purchasePrice}=0,0,${noiCell}/Assumptions!B${assumptionRows.purchasePrice}))`,
      PERCENT_FMT,
      formulaValueStyle
    );
    const debtServiceCell = `${column}${debtServiceRow}`;
    cashFlowSheet[debtServiceCell] = f(
      `IF(${activeOperatingYearCondition},0,-IFERROR(INDEX(Financing!$C$13:$C$${12 + MAX_MODEL_YEARS},${column}$5),0))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const principalCell = `${column}${principalRow}`;
    cashFlowSheet[principalCell] = f(
      `IF(${activeOperatingYearCondition},0,-IFERROR(INDEX(Financing!$D$13:$D$${12 + MAX_MODEL_YEARS},${column}$5),0))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const interestCell = `${column}${interestRow}`;
    cashFlowSheet[interestCell] = f(
      `IF(${activeOperatingYearCondition},0,-IFERROR(INDEX(Financing!$E$13:$E$${12 + MAX_MODEL_YEARS},${column}$5),0))`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const cfAfterFinancingCell = `${column}${cfAfterFinancingRow}`;
    cashFlowSheet[cfAfterFinancingCell] = f(
      `IF(${activeOperatingYearCondition},0,${cfOpsCell}+${debtServiceCell})`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const totalInvestmentCell = `${column}${totalInvestmentCostRow}`;
    cashFlowSheet[totalInvestmentCell] = f(
      `IF(${column}$5=0,-Financing!$B$5,0)`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const saleValueCell = `${column}${saleValueRow}`;
    cashFlowSheet[saleValueCell] = f(
      `IF(${column}$5=${holdPeriodRef},IF(Assumptions!B${assumptionRows.exitCapPct}=0,0,${noiCell}/(Assumptions!B${assumptionRows.exitCapPct}/100)),0)`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const saleClosingCell = `${column}${saleClosingCostsRow}`;
    cashFlowSheet[saleClosingCell] = f(
      `IF(${column}$5=${holdPeriodRef},-${saleValueCell}*(Assumptions!B${assumptionRows.exitClosingCostPct}/100),0)`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const unleveredCell = `${column}${unleveredCfRow}`;
    cashFlowSheet[unleveredCell] = f(
      `${cfOpsCell}+${saleValueCell}+${saleClosingCell}+${totalInvestmentCell}`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const fundingCell = `${column}${financingFundingRow}`;
    cashFlowSheet[fundingCell] = f(
      `IF(${column}$5=0,Financing!$B$2,0)`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const financingFeeCell = `${column}${financingFeesRow}`;
    cashFlowSheet[financingFeeCell] = f(
      `IF(${column}$5=0,-Financing!$B$3,0)`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const payoffCell = `${column}${financingPayoffRow}`;
    cashFlowSheet[payoffCell] = f(
      `IF(${column}$5=${holdPeriodRef},-IFERROR(INDEX(Financing!$F$13:$F$${12 + MAX_MODEL_YEARS},${column}$5),0),0)`,
      CURRENCY_FMT,
      formulaValueStyle
    );
    const leveredCell = `${column}${leveredCfRow}`;
    cashFlowSheet[leveredCell] = f(
      `${cfAfterFinancingCell}+${saleValueCell}+${saleClosingCell}+${fundingCell}+${financingFeeCell}+${payoffCell}`,
      CURRENCY_FMT,
      formulaValueStyle
    );
  });

  const cashFlowSheetWithWidths = widthSheet(cashFlowSheet, [
    30,
    12,
    ...Array.from({ length: MAX_MODEL_YEARS + 1 }, () => 14),
  ]);
  protectSheet(cashFlowSheetWithWidths);
  XLSX.utils.book_append_sheet(wb, cashFlowSheetWithWidths, "Cash Flow");

  const summarySheet = widthSheet(
    sheet([
      [s("Deal Pro Forma Summary", titleStyle), "", "", s("Returns", titleStyle), ""],
      [s("Address", labelStyle), s(ctx.canonicalAddress, textValueStyle), "", s("Hold period", labelStyle), f(`Assumptions!B${assumptionRows.holdPeriodYears}`, INTEGER_FMT, formulaValueStyle)],
      [s("Units", labelStyle), f("Assumptions!B4", INTEGER_FMT, formulaValueStyle), "", s("Stabilized occupancy", labelStyle), f(`1-(Assumptions!B${assumptionRows.vacancyPct}/100)`, PERCENT_FMT, formulaValueStyle)],
      [s("Current gross rent", labelStyle), f(`Assumptions!B${assumptionRows.currentGrossRent}+Assumptions!B${assumptionRows.currentOtherIncome}`, CURRENCY_FMT, formulaValueStyle), "", s("Management fee", labelStyle), f(`Assumptions!B${assumptionRows.managementFeePct}/100`, PERCENT_FMT, formulaValueStyle)],
      [s("Current NOI", labelStyle), n(num(ctx.currentNoi), CURRENCY_FMT, textValueStyle), "", s("Lead time to first rental", labelStyle), f(`Assumptions!B${assumptionRows.leadTimeMonths}`, INTEGER_FMT, formulaValueStyle)],
      [s("Cap rate (purchase price)", labelStyle), f(`IF(Assumptions!B${assumptionRows.purchasePrice}=0,0,${assetCapRateNoiBasis}/Assumptions!B${assumptionRows.purchasePrice})`, PERCENT_FMT, formulaValueStyle), "", s("Stabilized NOI", labelStyle), f(`INDEX('Cash Flow'!C${noiRow}:${col(2 + MAX_MODEL_YEARS)}${noiRow},1,IF(Assumptions!B${assumptionRows.leadTimeMonths}>0,MIN(Assumptions!B${assumptionRows.holdPeriodYears},2),MIN(Assumptions!B${assumptionRows.holdPeriodYears},1))+1)`, CURRENCY_FMT, formulaValueStyle)],
      [s("Purchase price", labelStyle), f(`Assumptions!B${assumptionRows.purchasePrice}`, CURRENCY_FMT, formulaValueStyle), "", s("Target cap rate @ sale", labelStyle), f(`Assumptions!B${assumptionRows.exitCapPct}/100`, PERCENT_FMT, formulaValueStyle)],
      [s("Est. closing costs", labelStyle), f("Financing!B4", CURRENCY_FMT, formulaValueStyle), "", s("Gross sale value", labelStyle), f(`INDEX('Cash Flow'!C${saleValueRow}:${col(2 + MAX_MODEL_YEARS)}${saleValueRow},1,Assumptions!B${assumptionRows.holdPeriodYears}+1)`, CURRENCY_FMT, formulaValueStyle)],
      [s("CapEx", labelStyle), f(`Assumptions!B${assumptionRows.renovationCosts}`, CURRENCY_FMT, formulaValueStyle), "", s("Net sale value", labelStyle), f(`INDEX('Cash Flow'!C${saleValueRow}:${col(2 + MAX_MODEL_YEARS)}${saleValueRow},1,Assumptions!B${assumptionRows.holdPeriodYears}+1)+INDEX('Cash Flow'!C${saleClosingCostsRow}:${col(2 + MAX_MODEL_YEARS)}${saleClosingCostsRow},1,Assumptions!B${assumptionRows.holdPeriodYears}+1)`, CURRENCY_FMT, formulaValueStyle)],
      [s("Furnishing / setup", labelStyle), f(`Assumptions!B${assumptionRows.furnishingCosts}`, CURRENCY_FMT, formulaValueStyle), "", s("Unlevered IRR", labelStyle), f(`IFERROR(IRR('Cash Flow'!C${unleveredCfRow}:INDEX(${unleveredCfRow}:${unleveredCfRow},3+Assumptions!B${assumptionRows.holdPeriodYears})),"")`, PERCENT_FMT, formulaValueStyle)],
      [s("Onboarding / unit turn", labelStyle), f(`Assumptions!B${assumptionRows.onboardingCosts}`, CURRENCY_FMT, formulaValueStyle), "", s("Unlevered EMx", labelStyle), f(`IF(ABS('Cash Flow'!C${unleveredCfRow})=0,0,SUMPRODUCT(('Cash Flow'!D${unleveredCfRow}:INDEX(${unleveredCfRow}:${unleveredCfRow},3+Assumptions!B${assumptionRows.holdPeriodYears}))*--('Cash Flow'!D${unleveredCfRow}:INDEX(${unleveredCfRow}:${unleveredCfRow},3+Assumptions!B${assumptionRows.holdPeriodYears})>0))/ABS('Cash Flow'!C${unleveredCfRow}))`, MULTIPLE_FMT, formulaValueStyle)],
      [s("Financing fees", labelStyle), f("Financing!B3", CURRENCY_FMT, formulaValueStyle), "", "", ""],
      [s("Total capitalization", sectionStyle), f("Financing!B5+Financing!B3", CURRENCY_FMT, formulaValueStyle), "", s("Levered IRR", labelStyle), f(`IFERROR(IRR('Cash Flow'!C${leveredCfRow}:INDEX(${leveredCfRow}:${leveredCfRow},3+Assumptions!B${assumptionRows.holdPeriodYears})),"")`, PERCENT_FMT, formulaValueStyle)],
      [s("Loan funding", labelStyle), f("Financing!B2", CURRENCY_FMT, formulaValueStyle), "", s("Levered EMx", labelStyle), f(`IF(ABS('Cash Flow'!C${leveredCfRow})=0,0,SUMPRODUCT(('Cash Flow'!D${leveredCfRow}:INDEX(${leveredCfRow}:${leveredCfRow},3+Assumptions!B${assumptionRows.holdPeriodYears}))*--('Cash Flow'!D${leveredCfRow}:INDEX(${leveredCfRow}:${leveredCfRow},3+Assumptions!B${assumptionRows.holdPeriodYears})>0))/ABS('Cash Flow'!C${leveredCfRow}))`, MULTIPLE_FMT, formulaValueStyle)],
      [s("LTV", labelStyle), f(`Assumptions!B${assumptionRows.ltvPct}/100`, PERCENT_FMT, formulaValueStyle), "", s("Equity yield", labelStyle), f(`IF(ABS('Cash Flow'!C${leveredCfRow})=0,0,(AVERAGE('Cash Flow'!D${cfAfterFinancingRow}:INDEX(${cfAfterFinancingRow}:${cfAfterFinancingRow},3+Assumptions!B${assumptionRows.holdPeriodYears}))-AVERAGE('Cash Flow'!D${principalRow}:INDEX(${principalRow}:${principalRow},3+Assumptions!B${assumptionRows.holdPeriodYears})))/ABS('Cash Flow'!C${leveredCfRow}))`, PERCENT_FMT, formulaValueStyle)],
      [s("Interest rate", labelStyle), f(`Assumptions!B${assumptionRows.interestRatePct}/100`, PERCENT_FMT, formulaValueStyle), "", s("Target IRR", labelStyle), f(`Assumptions!B${assumptionRows.targetIrrPct}/100`, PERCENT_FMT, formulaValueStyle)],
      [s("Cash required", sectionStyle), f(`ABS('Cash Flow'!C${leveredCfRow})`, CURRENCY_FMT, formulaValueStyle), "", "", ""],
    ]),
    [24, 20, 4, 24, 20]
  );
  summarySheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
  ];
  protectSheet(summarySheet);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as ArrayBuffer
  );
}
