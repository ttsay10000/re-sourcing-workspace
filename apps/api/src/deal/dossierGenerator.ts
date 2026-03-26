import type { UnderwritingContext } from "./underwritingContext.js";
import { defaultAnnualPropertyTaxGrowthPctFromNycTaxCode } from "./underwritingModel.js";

function num(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function moneyLabel(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${fmtMoney(value)}` : "—";
}

function pctValue(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function decimalPctLabel(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function sensitivityRangeLabel(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  if (min == null || max == null || Number.isNaN(min) || Number.isNaN(max)) return "—";
  return `${(min * 100).toFixed(2)}% to ${(max * 100).toFixed(2)}%`;
}

function offerRangeLabel(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null || high == null || Number.isNaN(low) || Number.isNaN(high)) return "—";
  return `$${fmtMoney(low)} to $${fmtMoney(high)}`;
}

function confidenceLabel(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 0.75) return "high";
  if (value >= 0.5) return "moderate";
  return "low";
}

function joinList(values: string[] | null | undefined): string {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "—";
}

function tableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function boldCell(value: string): string {
  return value.trim().length > 0 ? `**${value}**` : value;
}

function italicCell(value: string): string {
  return value.trim().length > 0 ? `*${value}*` : value;
}

function boldRow(cells: string[]): string[] {
  return cells.map((cell) => boldCell(cell));
}

function sectionRow(label: string, colCount: number): string[] {
  return [boldCell(label), ...Array.from({ length: Math.max(0, colCount - 1) }, () => "")];
}

function pushConditionReview(lines: string[], ctx: UnderwritingContext): void {
  const review = ctx.conditionReview;
  if (!review) return;
  if (review.overallCondition) lines.push(`Condition: ${review.overallCondition}`);
  if (review.renovationScope) lines.push(`Renovation scope: ${review.renovationScope}`);
  lines.push(
    `Photo review: ${review.imageCountAnalyzed} image(s) analyzed; image quality ${review.imageQuality ?? "—"}; confidence ${confidenceLabel(review.confidence)}`
  );
  if (Array.isArray(review.coverageSeen) && review.coverageSeen.length > 0) {
    lines.push(`Photos cover: ${joinList(review.coverageSeen)}`);
  }
  if (Array.isArray(review.coverageMissing) && review.coverageMissing.length > 0) {
    lines.push(`Not visible in photos: ${joinList(review.coverageMissing)}`);
  }
  const bullets =
    (Array.isArray(review.summaryBullets) && review.summaryBullets.length > 0
      ? review.summaryBullets
      : review.observedSignals ?? [])
      .slice(0, 3);
  bullets.forEach((bullet) => lines.push(`• ${bullet}`));
}

function propertyTaxGrowthSourceLine(ctx: UnderwritingContext): string {
  const taxCode = ctx.propertyOverview?.taxCode?.trim() || null;
  const growthPct = ctx.assumptions.operating.annualPropertyTaxGrowthPct;
  const autoPct = defaultAnnualPropertyTaxGrowthPctFromNycTaxCode(taxCode);
  if (growthPct == null || !Number.isFinite(growthPct)) {
    return "Property-tax growth source: —";
  }
  if (!taxCode) {
    return "Property-tax growth source: no NYC tax code available; using the underwriting assumption entered for this deal.";
  }
  const normalizedTaxCode = taxCode.toUpperCase();
  if (autoPct == null) {
    return `Property-tax growth source: NYC tax code ${normalizedTaxCode} does not map to an automatic underwriting default in the model; using the underwriting assumption entered for this deal.`;
  }
  if (Math.abs(autoPct - growthPct) < 0.005) {
    if (/^1/.test(normalizedTaxCode)) {
      return `Property-tax growth source: auto NYC underwriting default for tax class ${normalizedTaxCode} (${pctValue(autoPct)} normalized annual tax-growth assumption for Class 1).`;
    }
    if (/^2[ABC]/.test(normalizedTaxCode)) {
      return `Property-tax growth source: auto NYC underwriting default for tax class ${normalizedTaxCode} (${pctValue(autoPct)} normalized annual tax-growth assumption for small Class 2 property).`;
    }
    if (/^2/.test(normalizedTaxCode)) {
      return `Property-tax growth source: auto NYC underwriting default for tax class ${normalizedTaxCode} (${pctValue(autoPct)} normalized annual tax-growth assumption for larger Class 2 property).`;
    }
    if (/^4/.test(normalizedTaxCode)) {
      return `Property-tax growth source: auto NYC underwriting default for tax class ${normalizedTaxCode} (${pctValue(autoPct)} normalized annual tax-growth assumption for Class 4 property).`;
    }
    return `Property-tax growth source: auto NYC underwriting default for tax class ${normalizedTaxCode} (${pctValue(autoPct)} annual tax-growth assumption).`;
  }
  return `Property-tax growth source: custom override at ${pctValue(growthPct)}; NYC tax class ${normalizedTaxCode} auto default would be ${pctValue(autoPct)}.`;
}

function currencySeriesCells(values: number[], options?: { blankYearZero?: boolean }): string[] {
  const { blankYearZero = false } = options ?? {};
  return values.map((value, index) => {
    if (blankYearZero && index === 0) return "";
    return moneyLabel(value);
  });
}

function negativeSeriesCells(values: number[], options?: { blankYearZero?: boolean }): string[] {
  const { blankYearZero = false } = options ?? {};
  return values.map((value, index) => {
    if (blankYearZero && index === 0) return "";
    if (Math.abs(value) <= 0.005) return "$0";
    return value < 0 ? `(${moneyLabel(Math.abs(value))})` : moneyLabel(value);
  });
}

function ratioPercentSeriesCells(
  values: Array<number | null | undefined>,
  options?: { blankYearZero?: boolean; digits?: number }
): string[] {
  const { blankYearZero = false, digits = 1 } = options ?? {};
  return values.map((value, index) => {
    if (blankYearZero && index === 0) return "";
    if (value == null || !Number.isFinite(value)) return "";
    return value < -0.00005
      ? `(${Math.abs(value * 100).toFixed(digits)}%)`
      : `${(value * 100).toFixed(digits)}%`;
  });
}

function multipleSeriesCells(
  values: Array<number | null | undefined>,
  options?: { blankYearZero?: boolean; digits?: number }
): string[] {
  const { blankYearZero = false, digits = 2 } = options ?? {};
  return values.map((value, index) => {
    if (blankYearZero && index === 0) return "";
    if (value == null || !Number.isFinite(value)) return "";
    return value < -0.00005
      ? `(${Math.abs(value).toFixed(digits)}x)`
      : `${value.toFixed(digits)}x`;
  });
}

function yearZeroOnlyCells(
  years: number[],
  value: number | null | undefined,
  options?: { negative?: boolean }
): string[] {
  const negative = options?.negative === true;
  return years.map((year, index) => {
    if (index !== 0 || year !== 0) return "";
    if (value == null || !Number.isFinite(value) || Math.abs(value) <= 0.005) return "$0";
    return negative ? `(${moneyLabel(Math.abs(value))})` : moneyLabel(value);
  });
}

function exitOnlyCells(
  years: number[],
  value: number | null | undefined,
  options?: { negative?: boolean }
): string[] {
  const negative = options?.negative === true;
  const holdPeriodYear = years[years.length - 1] ?? 0;
  return years.map((year) => {
    if (year !== holdPeriodYear) return "";
    if (value == null || !Number.isFinite(value) || Math.abs(value) <= 0.005) return "$0";
    return negative ? `(${moneyLabel(Math.abs(value))})` : moneyLabel(value);
  });
}

function sensitivityRows<T extends { valuePct: number | null }>(
  baseRow: T,
  scenarioRows: T[]
): Array<Omit<T, "valuePct"> & { valuePct: number; isBase: boolean }> {
  const rowsByValue = new Map<number, Omit<T, "valuePct"> & { valuePct: number; isBase: boolean }>();
  const addRow = (row: T, isBase: boolean): void => {
    if (row.valuePct == null || !Number.isFinite(row.valuePct)) return;
    const key = Math.round(row.valuePct * 100) / 100;
    const normalizedRow = { ...row, valuePct: row.valuePct, isBase };
    const existing = rowsByValue.get(key);
    if (existing) {
      if (isBase) rowsByValue.set(key, normalizedRow);
      return;
    }
    rowsByValue.set(key, normalizedRow);
  };

  addRow(baseRow, true);
  scenarioRows.forEach((row) => addRow(row, false));

  return Array.from(rowsByValue.values()).sort((left, right) => left.valuePct - right.valuePct);
}

function pushSensitivityAnalysis(lines: string[], ctx: UnderwritingContext): void {
  if (!ctx.sensitivities || ctx.sensitivities.length === 0) return;

  lines.push("8. SENSITIVITY ANALYSIS");
  lines.push("------------------------");

  ctx.sensitivities.forEach((sensitivity) => {
    if (sensitivity.key === "exit_cap_rate") {
      lines.push(
        `• Base ${sensitivity.inputLabel.toLowerCase()}: ${pctValue(
          sensitivity.baseCase.valuePct
        )}; IRR range ${sensitivityRangeLabel(
          sensitivity.ranges.irrPct.min,
          sensitivity.ranges.irrPct.max
        )} across alternate sale-cap assumptions`
      );
      lines.push(
        tableRow([
          sensitivity.inputLabel,
          "Exit value",
          "Net sale proceeds to equity",
          "IRR",
        ])
      );
      const exitCapRows = sensitivityRows(
        {
          valuePct: sensitivity.baseCase.valuePct,
          exitPropertyValue: ctx.exit.exitPropertyValue,
          netProceedsToEquity: ctx.exit.netProceedsToEquity,
          irrPct: ctx.returns.irrPct,
        },
        sensitivity.scenarios.map((scenario) => ({
          valuePct: scenario.valuePct,
          exitPropertyValue: scenario.exitPropertyValue,
          netProceedsToEquity: scenario.netProceedsToEquity,
          irrPct: scenario.irrPct,
        })),
      );

      exitCapRows.forEach((row) => {
        const cells = [
          pctValue(row.valuePct),
          moneyLabel(row.exitPropertyValue),
          moneyLabel(row.netProceedsToEquity),
          decimalPctLabel(row.irrPct),
        ];
        lines.push(tableRow(row.isBase ? boldRow(cells) : cells));
      });
      lines.push("");
      return;
    }

    const sensitivityEquityYieldRange =
      sensitivity.ranges.year1EquityYield ?? sensitivity.ranges.year1CashOnCashReturn;
    lines.push(
      `• Base ${sensitivity.inputLabel.toLowerCase()}: ${pctValue(
        sensitivity.baseCase.valuePct
      )}; IRR range ${sensitivityRangeLabel(
        sensitivity.ranges.irrPct.min,
        sensitivity.ranges.irrPct.max
      )}; Equity-yield range ${sensitivityRangeLabel(
        sensitivityEquityYieldRange?.min,
        sensitivityEquityYieldRange?.max
      )}`
    );
    lines.push(tableRow([sensitivity.inputLabel, "Stabilized NOI", "IRR", "Equity yield"]));
    sensitivityRows(
      {
        valuePct: sensitivity.baseCase.valuePct,
        stabilizedNoi: ctx.operating.stabilizedNoi,
        irrPct: ctx.returns.irrPct,
        year1EquityYield: ctx.returns.year1EquityYield ?? ctx.returns.year1CashOnCashReturn,
      },
      sensitivity.scenarios.map((scenario) => ({
        valuePct: scenario.valuePct,
        stabilizedNoi: scenario.stabilizedNoi,
        irrPct: scenario.irrPct,
        year1EquityYield: scenario.year1EquityYield ?? scenario.year1CashOnCashReturn,
      }))
    ).forEach((scenario) => {
      lines.push(
        tableRow([
          ...(scenario.isBase
            ? boldRow([
                pctValue(scenario.valuePct),
                moneyLabel(scenario.stabilizedNoi),
                decimalPctLabel(scenario.irrPct),
                decimalPctLabel(scenario.year1EquityYield),
              ])
            : [
                pctValue(scenario.valuePct),
                moneyLabel(scenario.stabilizedNoi),
                decimalPctLabel(scenario.irrPct),
                decimalPctLabel(scenario.year1EquityYield),
              ]),
        ])
      );
    });
    lines.push("");
  });
}

function pushYearlyCashFlowTable(lines: string[], ctx: UnderwritingContext): void {
  const yearly = ctx.yearlyCashFlow;
  if (!yearly) return;
  const headers = ["Line item", ...yearly.years.map((year) => `Y${year}`)];
  const amortizationByYear = new Map((ctx.amortizationSchedule ?? []).map((row) => [row.year, row]));
  const nonManagementExpenseSeries = yearly.totalOperatingExpenses.map((value, index) =>
    Math.max(0, num(value) - num(yearly.managementFee[index]))
  );
  const hasExpenseBreakout =
    yearly.expenseLineItems.length > 1 ||
    (yearly.expenseLineItems[0]?.lineItem != null &&
      !/^operating expenses$/i.test(yearly.expenseLineItems[0].lineItem.trim()));
  const interestSeries = yearly.years.map((year, index) => {
    if (index === 0) return 0;
    const scheduledRow = amortizationByYear.get(year);
    if (scheduledRow) return num(scheduledRow.interestPayment);
    return Math.max(0, num(yearly.debtService[index]) - num(yearly.principalPaid[index]));
  });
  const loanBalanceSeries = yearly.years.map((year, index) => {
    if (index === 0) return num(ctx.financing.loanAmount);
    const scheduledRow = amortizationByYear.get(year);
    if (scheduledRow) return num(scheduledRow.endingBalance);
    const cumulativePrincipalPaid = yearly.principalPaid
      .slice(1, index + 1)
      .reduce((sum, value) => sum + num(value), 0);
    return Math.max(0, num(ctx.financing.loanAmount) - cumulativePrincipalPaid);
  });
  const yearlyEquityGain = yearly.cashFlowAfterFinancing.map((value, index) =>
    index === 0 ? 0 : value + (yearly.principalPaid[index] ?? 0)
  );
  const dscrSeries = yearly.cashFlowFromOperations.map((value, index) => {
    if (index === 0) return null;
    const debtService = num(yearly.debtService[index]);
    if (Math.abs(debtService) <= 0.005) return null;
    return num(value) / debtService;
  });
  const cashOnCashSeries = yearly.noi.map((value, index) => {
    if (index === 0) return null;
    const initialEquityInvested = num(ctx.acquisition.initialEquityInvested);
    if (Math.abs(initialEquityInvested) <= 0.005) return null;
    return (num(value) - num(yearly.debtService[index])) / initialEquityInvested;
  });

  lines.push(tableRow(headers));
  lines.push(tableRow(sectionRow("Acquisition & Capitalization", headers.length)));
  lines.push(
    tableRow([
      "Purchase price",
      ...yearZeroOnlyCells(yearly.years, ctx.purchasePrice, { negative: true }),
    ])
  );
  lines.push(
    tableRow([
      "Purchase closing costs",
      ...yearZeroOnlyCells(yearly.years, ctx.acquisition.purchaseClosingCosts, { negative: true }),
    ])
  );
  lines.push(
    tableRow([
      "Renovation costs",
      ...yearZeroOnlyCells(yearly.years, ctx.assumptions.acquisition.renovationCosts, {
        negative: true,
      }),
    ])
  );
  lines.push(
    tableRow([
      "Furnishing / setup costs",
      ...yearZeroOnlyCells(yearly.years, ctx.assumptions.acquisition.furnishingSetupCosts, {
        negative: true,
      }),
    ])
  );
  if ((ctx.assumptions.acquisition.onboardingCosts ?? 0) > 0) {
    lines.push(
      tableRow([
        "Unit onboarding costs",
        ...yearZeroOnlyCells(yearly.years, ctx.assumptions.acquisition.onboardingCosts, {
          negative: true,
        }),
      ])
    );
  }
  lines.push(
    tableRow([
      "Financing fees",
      ...yearZeroOnlyCells(yearly.years, ctx.acquisition.financingFees, { negative: true }),
    ])
  );
  lines.push(
    tableRow(
      boldRow([
        "Total cash uses incl. financing fees",
        ...yearZeroOnlyCells(yearly.years, ctx.acquisition.totalProjectCost + num(ctx.acquisition.financingFees), {
          negative: true,
        }),
      ])
    )
  );
  lines.push(
    tableRow([
      "Loan proceeds / leverage",
      ...yearZeroOnlyCells(yearly.years, ctx.financing.loanAmount),
    ])
  );
  lines.push(
    tableRow(
      boldRow([
        "Net equity invested",
        ...yearZeroOnlyCells(yearly.years, ctx.acquisition.initialEquityInvested, { negative: true }),
      ])
    )
  );

  lines.push(tableRow(sectionRow("Operating Cash Flow", headers.length)));
  lines.push(
    tableRow(
      boldRow([
        "Gross rental income",
        ...currencySeriesCells(yearly.grossRentalIncome, { blankYearZero: true }),
      ])
    )
  );
  if (yearly.otherIncome.some((value, index) => index > 0 && Math.abs(value) > 0.005)) {
    lines.push(
      tableRow(["Other income", ...currencySeriesCells(yearly.otherIncome, { blankYearZero: true })])
    );
  }
  lines.push(
    tableRow([
      "Vacancy loss",
      ...negativeSeriesCells(yearly.vacancyLoss.map((value) => -Math.abs(value)), {
        blankYearZero: true,
      }),
    ])
  );
  if (yearly.leadTimeLoss.some((value, index) => index > 0 && Math.abs(value) > 0.005)) {
    lines.push(
      tableRow([
        "Lead time loss",
        ...negativeSeriesCells(yearly.leadTimeLoss.map((value) => -Math.abs(value)), {
          blankYearZero: true,
        }),
      ])
    );
  }
  lines.push(
    tableRow(
      boldRow(["Net rental income", ...currencySeriesCells(yearly.netRentalIncome, { blankYearZero: true })])
    )
  );
  if (hasExpenseBreakout) {
    yearly.expenseLineItems.forEach((row) => {
      const projectedValues = yearly.years.map((year, index) =>
        index === 0 || year === 0 ? 0 : num(row.yearlyAmounts[index - 1])
      );
      lines.push(
        tableRow([
          row.lineItem,
          ...negativeSeriesCells(projectedValues.map((value) => -Math.abs(value)), {
            blankYearZero: true,
          }),
        ])
      );
    });
  }
  lines.push(
    tableRow(
      boldRow([
        "Operating expenses ex management",
        ...negativeSeriesCells(
          nonManagementExpenseSeries.map((value) => -Math.abs(value)),
          { blankYearZero: true }
        ),
      ])
    )
  );
  lines.push(
    tableRow([
      `Management fee (${ctx.assumptions.operating.managementFeePct ?? 0}%)`,
      ...negativeSeriesCells(
        yearly.managementFee.map((value) => -Math.abs(value)),
        { blankYearZero: true }
      ),
    ])
  );
  lines.push(
    tableRow(
      boldRow([
        "Total operating expenses",
        ...negativeSeriesCells(
          yearly.totalOperatingExpenses.map((value) => -Math.abs(value)),
          { blankYearZero: true }
        ),
      ])
    )
  );
  lines.push(
    tableRow(
      boldRow([
        "Net operating income (NOI)",
        ...currencySeriesCells(yearly.noi, { blankYearZero: true }),
      ])
    )
  );
  lines.push(
    tableRow([
      "Recurring CapEx / reserve",
      ...negativeSeriesCells(
        yearly.recurringCapex.map((value) => -Math.abs(value)),
        { blankYearZero: true }
      ),
    ])
  );
  lines.push(
    tableRow(
      boldRow([
        "Unlevered CF after reserves",
        ...currencySeriesCells(yearly.cashFlowFromOperations, { blankYearZero: true }),
      ])
    )
  );
  lines.push(tableRow(sectionRow("Debt & Financing", headers.length)));
  if (interestSeries.some((value, index) => index > 0 && Math.abs(value) > 0.005)) {
    lines.push(
      tableRow([
        "Interest expense",
        ...currencySeriesCells(interestSeries, { blankYearZero: true }),
      ])
    );
  }
  if (yearly.principalPaid.some((value, index) => index > 0 && Math.abs(value) > 0.005)) {
    lines.push(
      tableRow([
        "Principal paydown (equity build)",
        ...currencySeriesCells(yearly.principalPaid, { blankYearZero: true }),
      ])
    );
  }
  lines.push(
    tableRow([
      "Debt service payments",
      ...negativeSeriesCells(yearly.debtService.map((value) => -Math.abs(value)), {
        blankYearZero: true,
      }),
    ])
  );
  if (loanBalanceSeries.some((value) => Math.abs(value) > 0.005)) {
    lines.push(
      tableRow([
        "Ending loan balance",
        ...currencySeriesCells(loanBalanceSeries),
      ])
    );
  }
  lines.push(
    tableRow(
      boldRow([
        "Levered CF to equity",
        ...negativeSeriesCells(yearly.cashFlowAfterFinancing),
      ])
    )
  );
  lines.push(
    tableRow([
      italicCell("Equity value creation incl. principal paydown (memo only)"),
      ...currencySeriesCells(yearlyEquityGain),
    ])
  );
  lines.push(
    tableRow([
      "DSCR (after reserves)",
      ...multipleSeriesCells(dscrSeries, { blankYearZero: true }),
    ])
  );
  lines.push(
    tableRow([
      "Cash-on-cash return",
      ...ratioPercentSeriesCells(cashOnCashSeries, { blankYearZero: true, digits: 1 }),
    ])
  );

  lines.push(tableRow(sectionRow("Exit Waterfall", headers.length)));
  lines.push(
    tableRow([
      "Gross sale proceeds",
      ...exitOnlyCells(yearly.years, ctx.exit.exitPropertyValue),
    ])
  );
  lines.push(
    tableRow([
      "Less: sale closing costs / fees",
      ...exitOnlyCells(yearly.years, ctx.exit.saleClosingCosts, { negative: true }),
    ])
  );
  if (
    Array.isArray(yearly.reserveRelease) &&
    yearly.reserveRelease.some((value, index) => index > 0 && Math.abs(value) > 0.005)
  ) {
    lines.push(
      tableRow([
        "Reserve release at exit",
        ...currencySeriesCells(yearly.reserveRelease, { blankYearZero: true }),
      ])
    );
  }
  lines.push(
    tableRow(
      boldRow([
        "NSP before debt payoff",
        ...exitOnlyCells(yearly.years, ctx.exit.netSaleProceedsBeforeDebtPayoff),
      ])
    )
  );
  lines.push(
    tableRow([
      "Less: remaining loan balance",
      ...exitOnlyCells(yearly.years, ctx.exit.remainingLoanBalance, { negative: true }),
    ])
  );
  lines.push(
    tableRow(
      boldRow([
        "Net sale proceeds to equity",
        ...currencySeriesCells(yearly.netSaleProceedsToEquity, { blankYearZero: true }),
      ])
    )
  );
  lines.push(
    tableRow(
      boldRow(["Total levered CF incl. exit", ...negativeSeriesCells(yearly.leveredCashFlow)])
    )
  );
}

export function buildDossierText(ctx: UnderwritingContext): string {
  return buildDossierStructuredText(ctx);
}

export function buildDossierStructuredText(ctx: UnderwritingContext): string {
  const lines: string[] = [];
  const hasCurrentFinancials = ctx.currentGrossRent != null || ctx.currentNoi != null;
  const grossRentTotal = ctx.currentGrossRent;
  const otherIncome = ctx.currentOtherIncome ?? null;
  const conservativeProjectedLeaseUpRent =
    ctx.conservativeProjectedLeaseUpRent != null && ctx.conservativeProjectedLeaseUpRent > 0
      ? ctx.conservativeProjectedLeaseUpRent
      : null;
  const displayedGrossRentTotal =
    grossRentTotal != null
      ? grossRentTotal + num(otherIncome) + num(conservativeProjectedLeaseUpRent)
      : null;
  const expensesTotal =
    ctx.currentExpensesTotal ??
    (ctx.currentGrossRent != null && ctx.currentNoi != null
      ? ctx.currentGrossRent + num(ctx.currentOtherIncome) - ctx.currentNoi
      : null);
  const noi =
    ctx.currentStateNoi ??
    ctx.currentNoi ??
    (ctx.currentGrossRent != null && expensesTotal != null
      ? ctx.currentGrossRent + num(ctx.currentOtherIncome) - expensesTotal
      : null);

  lines.push("DEAL DOSSIER");
  lines.push("============");
  lines.push("");
  lines.push(`Deal score: ${ctx.dealScore != null ? `${ctx.dealScore}/100` : "—"}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push("1. PROPERTY OVERVIEW");
  lines.push("--------------------");
  lines.push(`Address: ${ctx.canonicalAddress}`);
  lines.push(`Area: ${ctx.listingCity ?? "—"}`);
  lines.push(`Units: ${ctx.unitCount != null ? String(ctx.unitCount) : "—"}`);
  if (ctx.propertyOverview) {
    if (ctx.propertyOverview.taxCode) lines.push(`Tax code: ${ctx.propertyOverview.taxCode}`);
    if (ctx.propertyOverview.hpdRegistrationId) lines.push(`HPD registration: ${ctx.propertyOverview.hpdRegistrationId}`);
    if (ctx.propertyOverview.hpdRegistrationDate) lines.push(`HPD last registration: ${ctx.propertyOverview.hpdRegistrationDate}`);
    if (ctx.propertyOverview.bbl) lines.push(`BBL: ${ctx.propertyOverview.bbl}`);
    if (ctx.propertyOverview.packageNote) lines.push(`Package note: ${ctx.propertyOverview.packageNote}`);
  }
  lines.push(propertyTaxGrowthSourceLine(ctx));
  pushConditionReview(lines, ctx);
  lines.push("");

  lines.push("2. RECOMMENDED OFFER");
  lines.push("--------------------");
  lines.push(tableRow(["Target IRR", pctValue(ctx.assumptions.targetIrrPct)]));
  lines.push(
    tableRow([
      "Recommended offer range",
      offerRangeLabel(
        ctx.recommendedOffer?.recommendedOfferLow,
        ctx.recommendedOffer?.recommendedOfferHigh
      ),
    ])
  );
  lines.push(tableRow(["Discount to asking", pctValue(ctx.recommendedOffer?.discountToAskingPct)]));
  lines.push("");

  lines.push("3. CURRENT STATE: FINANCIALS");
  lines.push("-----------------------------");
  if (ctx.financialFlags && ctx.financialFlags.length > 0) {
    ctx.financialFlags.slice(0, 3).forEach((flag) => lines.push(`• ${flag}`));
    lines.push("");
  }
  lines.push(tableRow(["Gross rent", "Annual"]));
  if (ctx.rentRollRows && ctx.rentRollRows.length > 0) {
    ctx.rentRollRows.forEach((row) => lines.push(tableRow([row.label, moneyLabel(row.annualRent)])));
  } else if (grossRentTotal != null) {
    lines.push(tableRow(["Current gross rent", moneyLabel(grossRentTotal)]));
  } else {
    lines.push(tableRow(["Current gross rent not extracted from OM text", "—"]));
  }
  if (otherIncome != null && Math.abs(otherIncome) > 0.005) {
    lines.push(tableRow(["Other income", moneyLabel(otherIncome)]));
  }
  if (ctx.rentBreakdown) {
    lines.push(
      tableRow([
        "Free-market residential gross rent",
        moneyLabel(ctx.rentBreakdown.current.freeMarketResidential),
      ])
    );
    lines.push(
      tableRow([
        "RS / RC residential gross rent",
        moneyLabel(ctx.rentBreakdown.current.protectedResidential),
      ])
    );
    lines.push(
      tableRow([
        "Commercial gross rent",
        moneyLabel(ctx.rentBreakdown.current.commercial),
      ])
    );
  }
  if (conservativeProjectedLeaseUpRent != null) {
    lines.push(
      tableRow([
        "Conservative projected vacant residential rent",
        moneyLabel(conservativeProjectedLeaseUpRent),
      ])
    );
  }
  lines.push(tableRow(["**Total gross rent**", moneyLabel(displayedGrossRentTotal)]));
  lines.push("");
  lines.push(tableRow(["Expenses", "Annual"]));
  if (ctx.expenseRows && ctx.expenseRows.length > 0) {
    ctx.expenseRows.forEach((row) => lines.push(tableRow([row.lineItem, moneyLabel(row.amount)])));
    lines.push(tableRow(["**Total expenses**", moneyLabel(expensesTotal)]));
  } else if (expensesTotal != null) {
    lines.push(tableRow(["Operating expenses", moneyLabel(expensesTotal)]));
    lines.push(tableRow(["**Total expenses**", moneyLabel(expensesTotal)]));
  } else {
    lines.push(tableRow(["Current expenses not extracted from OM text", "—"]));
  }
  lines.push("");
  lines.push(
    tableRow([
      conservativeProjectedLeaseUpRent != null
        ? "**NOI incl. projected vacant residential rent**"
        : "**NOI**",
      moneyLabel(noi),
    ])
  );
  lines.push(tableRow(["Cap rate", pctValue(ctx.assetCapRate)]));
  lines.push("");

  lines.push("4. STABILIZED OPERATIONS");
  lines.push("------------------------");
  if (!hasCurrentFinancials) {
    lines.push("• Stabilized operations are not reliable yet because the OM text did not yield enough current rent / NOI data.");
  }
  lines.push(tableRow(["Adjusted gross rent", moneyLabel(hasCurrentFinancials ? ctx.operating.adjustedGrossRent : null)]));
  lines.push(tableRow(["Adjusted operating expenses", moneyLabel(hasCurrentFinancials ? ctx.operating.adjustedOperatingExpenses : null)]));
  lines.push(
    tableRow([
      `Management fee (${ctx.assumptions.operating.managementFeePct ?? 0}% of gross rent)`,
      moneyLabel(hasCurrentFinancials ? ctx.operating.managementFeeAmount : null),
    ])
  );
  if (ctx.rentBreakdown) {
    lines.push(
      tableRow([
        `Free-market residential gross (Y${ctx.rentBreakdown.stabilizedYearNumber})`,
        moneyLabel(ctx.rentBreakdown.stabilized.freeMarketResidential),
      ])
    );
    lines.push(
      tableRow([
        `RS / RC residential gross (Y${ctx.rentBreakdown.stabilizedYearNumber})`,
        moneyLabel(ctx.rentBreakdown.stabilized.protectedResidential),
      ])
    );
    lines.push(
      tableRow([
        `Commercial gross (Y${ctx.rentBreakdown.stabilizedYearNumber})`,
        moneyLabel(ctx.rentBreakdown.stabilized.commercial),
      ])
    );
    lines.push(
      tableRow([
        "Free-market residential lift",
        moneyLabel(ctx.rentBreakdown.freeMarketResidentialLift),
      ])
    );
  }
  lines.push(tableRow(["**Stabilized NOI**", moneyLabel(hasCurrentFinancials ? ctx.operating.stabilizedNoi : null)]));
  lines.push(tableRow(["Stabilized cap rate", pctValue(ctx.adjustedCapRate)]));
  lines.push("");

  lines.push("5. FINANCING & EQUITY CASH FLOW");
  lines.push("-------------------------------");
  pushYearlyCashFlowTable(lines, ctx);
  lines.push("");

  lines.push("6. RETURNS");
  lines.push("----------");
  lines.push(
    tableRow([
      `IRR (${ctx.assumptions.holdPeriodYears ?? "—"}-year)`,
      ctx.returns.irrPct != null ? `${(ctx.returns.irrPct * 100).toFixed(2)}%` : "—",
    ])
  );
  lines.push(
    tableRow([
      "Equity multiple",
      ctx.returns.equityMultiple != null ? `${ctx.returns.equityMultiple.toFixed(2)}x` : "—",
    ])
  );
  lines.push(
    tableRow([
      "Average annual cash-on-cash",
      ctx.returns.averageCashOnCashReturn != null
        ? `${(ctx.returns.averageCashOnCashReturn * 100).toFixed(2)}%`
        : "—",
    ])
  );
  lines.push(
    tableRow([
      "Cash-on-cash (year 1)",
      ctx.returns.year1CashOnCashReturn != null
        ? `${(ctx.returns.year1CashOnCashReturn * 100).toFixed(2)}%`
        : "—",
    ])
  );
  lines.push(
    tableRow([
      "Equity yield (year 1)",
      ctx.returns.year1EquityYield != null
        ? `${(ctx.returns.year1EquityYield * 100).toFixed(2)}%`
        : "—",
    ])
  );
  lines.push(
    tableRow([
      "Average annual equity yield",
      ctx.returns.averageEquityYield != null
        ? `${(ctx.returns.averageEquityYield * 100).toFixed(2)}%`
        : "—",
    ])
  );
  lines.push("");

  lines.push("7. ASSUMPTIONS USED");
  lines.push("--------------------");
  lines.push(`Purchase closing costs: ${pctValue(ctx.assumptions.acquisition.purchaseClosingCostPct)}`);
  lines.push(`Renovation: ${moneyLabel(ctx.assumptions.acquisition.renovationCosts)}`);
  lines.push(`Furnishing/setup: ${moneyLabel(ctx.assumptions.acquisition.furnishingSetupCosts)}`);
  lines.push(`Onboarding / unit turn costs: ${moneyLabel(ctx.assumptions.acquisition.onboardingCosts)}`);
  lines.push(
    `Investment profile: ${ctx.assumptions.acquisition.investmentProfile?.trim() || "—"}`
  );
  lines.push(
    `Target acquisition date: ${ctx.assumptions.acquisition.targetAcquisitionDate ?? "—"}`
  );
  lines.push(`LTV: ${pctValue(ctx.assumptions.financing.ltvPct)}`);
  lines.push(`Interest rate: ${pctValue(ctx.assumptions.financing.interestRatePct)}`);
  lines.push(`Amortization: ${ctx.assumptions.financing.amortizationYears ?? "—"} years`);
  lines.push(`Loan fee: ${pctValue(ctx.assumptions.financing.loanFeePct)}`);
  lines.push(`Base rent uplift: ${pctValue(ctx.assumptions.operating.rentUpliftPct)}`);
  lines.push(`Blended rent uplift: ${pctValue(ctx.assumptions.operating.blendedRentUpliftPct)}`);
  lines.push(`Expense increase: ${pctValue(ctx.assumptions.operating.expenseIncreasePct)}`);
  lines.push(`Management fee: ${pctValue(ctx.assumptions.operating.managementFeePct)}`);
  lines.push(`Occupancy tax: ${pctValue(ctx.assumptions.operating.occupancyTaxPct)}`);
  lines.push(`Vacancy: ${pctValue(ctx.assumptions.operating.vacancyPct)}`);
  lines.push(`Lead time: ${ctx.assumptions.operating.leadTimeMonths ?? "—"} months`);
  lines.push(`Annual FM rent growth: ${pctValue(ctx.assumptions.operating.annualRentGrowthPct)}`);
  lines.push(
    `Annual commercial rent growth: ${pctValue(ctx.assumptions.operating.annualCommercialRentGrowthPct)}`
  );
  lines.push(`Annual other-income growth: ${pctValue(ctx.assumptions.operating.annualOtherIncomeGrowthPct)}`);
  lines.push(`Annual expense growth: ${pctValue(ctx.assumptions.operating.annualExpenseGrowthPct)}`);
  lines.push(`Annual property-tax growth: ${pctValue(ctx.assumptions.operating.annualPropertyTaxGrowthPct)}`);
  lines.push(propertyTaxGrowthSourceLine(ctx));
  lines.push(`Recurring CapEx / reserve: ${moneyLabel(ctx.assumptions.operating.recurringCapexAnnual)}`);
  lines.push(`Hold period: ${ctx.assumptions.holdPeriodYears ?? "—"} years`);
  lines.push(`Exit cap: ${pctValue(ctx.assumptions.exit.exitCapPct)}`);
  lines.push(`Exit closing costs: ${pctValue(ctx.assumptions.exit.exitClosingCostPct)}`);
  lines.push(`Target IRR: ${pctValue(ctx.assumptions.targetIrrPct)}`);
  lines.push("");

  pushSensitivityAnalysis(lines, ctx);

  lines.push("9. KEY TAKEAWAYS");
  lines.push("----------------");
  if (ctx.dealScore != null) lines.push(`• Deal score: ${ctx.dealScore}/100`);
  if (ctx.adjustedCapRate != null) lines.push(`• Stabilized cap rate: ${ctx.adjustedCapRate.toFixed(2)}%`);
  if (ctx.returns.irrPct != null) lines.push(`• Projected IRR: ${(ctx.returns.irrPct * 100).toFixed(2)}%`);
  if (ctx.recommendedOffer?.discountToAskingPct != null && ctx.recommendedOffer.discountToAskingPct > 0) {
    lines.push(
      `• High-end recommended offer is ${ctx.recommendedOffer.discountToAskingPct.toFixed(2)}% below ask to clear the target IRR.`
    );
  }
  lines.push("");

  return lines.join("\n");
}

export function buildDossierBuffer(ctx: UnderwritingContext): Buffer {
  return Buffer.from(buildDossierStructuredText(ctx), "utf-8");
}
