import type {
  UnderwritingContext,
  YearlyCashFlowProjectionContext,
} from "./underwritingContext.js";
import { conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode } from "./underwritingModel.js";

function num(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  return rounded.toLocaleString("en-US", {
    maximumFractionDigits: isWhole ? 0 : 2,
    minimumFractionDigits: isWhole ? 0 : 2,
  });
}

function moneyLabel(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${fmtMoney(value)}` : "—";
}

function pctValue(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function pctRatio(value: number | null | undefined): string {
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
  const autoPct = conservativeAnnualPropertyTaxGrowthPctFromNycTaxCode(taxCode);
  if (growthPct == null || !Number.isFinite(growthPct)) {
    return "Property-tax growth source: —";
  }
  if (!taxCode) {
    return "Property-tax growth source: no NYC tax code available; using the underwriting assumption entered for this deal.";
  }
  const normalizedTaxCode = taxCode.toUpperCase();
  if (autoPct == null) {
    return `Property-tax growth source: NYC tax code ${normalizedTaxCode} does not map to an automatic cap in the model; using the underwriting assumption entered for this deal.`;
  }
  if (Math.abs(autoPct - growthPct) < 0.005) {
    if (/^1/.test(normalizedTaxCode)) {
      return `Property-tax growth source: auto from NYC tax class ${normalizedTaxCode} cap (${pctValue(autoPct)} annual assessed-value cap).`;
    }
    if (/^2[ABC]/.test(normalizedTaxCode)) {
      return `Property-tax growth source: auto from NYC tax class ${normalizedTaxCode} cap (${pctValue(autoPct)} annual assessed-value cap for small Class 2 property).`;
    }
    return `Property-tax growth source: auto from NYC tax class ${normalizedTaxCode} conservative top-of-range assumption (${pctValue(autoPct)} annual transitional assessed-value phase-in).`;
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

function ratioSeriesCells(values: Array<number | null>, options?: { blankYearZero?: boolean }): string[] {
  const { blankYearZero = false } = options ?? {};
  return values.map((value, index) => {
    if (blankYearZero && index === 0) return "";
    return pctRatio(value);
  });
}

function pushYearlyCashFlowTable(lines: string[], yearly: YearlyCashFlowProjectionContext): void {
  const headers = ["Line item", ...yearly.years.map((year) => `Y${year}`)];
  lines.push(tableRow(headers));
  lines.push(tableRow(["Property value", ...currencySeriesCells(yearly.propertyValue)]));
  lines.push(tableRow(["Gross rental income", ...currencySeriesCells(yearly.grossRentalIncome, { blankYearZero: true })]));
  if (yearly.otherIncome.some((value, index) => index > 0 && Math.abs(value) > 0.005)) {
    lines.push(tableRow(["Other income", ...currencySeriesCells(yearly.otherIncome, { blankYearZero: true })]));
  }
  lines.push(tableRow(["Vacancy assumption", ...currencySeriesCells(yearly.vacancyLoss, { blankYearZero: true }).map((cell) => (cell ? `(${cell})` : ""))]));
  if (yearly.leadTimeLoss.some((value, index) => index > 0 && Math.abs(value) > 0.005)) {
    lines.push(tableRow(["Lead time assumption", ...currencySeriesCells(yearly.leadTimeLoss, { blankYearZero: true }).map((cell) => (cell ? `(${cell})` : ""))]));
  }
  lines.push(tableRow(["Net rental income", ...currencySeriesCells(yearly.netRentalIncome, { blankYearZero: true })]));
  yearly.expenseLineItems.forEach((row) => {
    const cells = ["", ...row.yearlyAmounts.map((value) => moneyLabel(value))];
    lines.push(
      tableRow([
        row.lineItem,
        ...cells.map((cell, index) => {
          if (index === 0) return "";
          return cell ? `(${cell})` : "";
        }),
      ])
    );
  });
  lines.push(
    tableRow([
      "Management fee",
      ...currencySeriesCells(yearly.managementFee, { blankYearZero: true }).map((cell) =>
        cell ? `(${cell})` : ""
      ),
    ])
  );
  lines.push(
    tableRow([
      "Total operating expenses",
      ...currencySeriesCells(yearly.totalOperatingExpenses, { blankYearZero: true }).map((cell) =>
        cell ? `(${cell})` : ""
      ),
    ])
  );
  lines.push(tableRow(["Net operating income (NOI)", ...currencySeriesCells(yearly.noi, { blankYearZero: true })]));
  lines.push(
    tableRow([
      "Recurring CapEx / reserve",
      ...currencySeriesCells(yearly.recurringCapex, { blankYearZero: true }).map((cell) =>
        cell ? `(${cell})` : ""
      ),
    ])
  );
  lines.push(
    tableRow(["CF from operations", ...currencySeriesCells(yearly.cashFlowFromOperations, { blankYearZero: true })])
  );
  lines.push(tableRow(["Cap rate (starting purchase price)", ...ratioSeriesCells(yearly.capRateOnPurchase)]));
  lines.push(
    tableRow([
      "Debt service payments",
      ...currencySeriesCells(yearly.debtService, { blankYearZero: true }).map((cell) =>
        cell ? `(${cell})` : ""
      ),
    ])
  );
  lines.push(
    tableRow([
      "Principal paid",
      ...currencySeriesCells(yearly.principalPaid, { blankYearZero: true }).map((cell) =>
        cell ? `(${cell})` : ""
      ),
    ])
  );
  lines.push(
    tableRow([
      "Interest paid",
      ...currencySeriesCells(yearly.interestPaid, { blankYearZero: true }).map((cell) =>
        cell ? `(${cell})` : ""
      ),
    ])
  );
  lines.push(tableRow(["CF after financing", ...currencySeriesCells(yearly.cashFlowAfterFinancing)]));
  lines.push(
    tableRow([
      "Total investment cost",
      ...yearly.totalInvestmentCost.map((value, index) =>
        index === 0 && Math.abs(value) > 0.005 ? `(${moneyLabel(Math.abs(value))})` : ""
      ),
    ])
  );
  lines.push(tableRow(["Sale value", ...currencySeriesCells(yearly.saleValue)]));
  lines.push(
    tableRow([
      "Closing costs @ sale",
      ...currencySeriesCells(yearly.saleClosingCosts).map((cell, index) =>
        index === 0 || !cell ? "" : `(${cell})`
      ),
    ])
  );
  lines.push(tableRow(["Unlevered CF", ...currencySeriesCells(yearly.unleveredCashFlow)]));
  lines.push(tableRow(["Financing funding", ...currencySeriesCells(yearly.financingFunding)]));
  lines.push(
    tableRow([
      "Financing fees",
      ...currencySeriesCells(yearly.financingFees).map((cell) => (cell ? `(${cell})` : "")),
    ])
  );
  lines.push(
    tableRow([
      "Financing payoff",
      ...currencySeriesCells(yearly.financingPayoff).map((cell) => (cell ? `(${cell})` : "")),
    ])
  );
  lines.push(tableRow(["Levered CF", ...currencySeriesCells(yearly.leveredCashFlow)]));
}

export function buildDossierText(ctx: UnderwritingContext): string {
  return buildDossierStructuredText(ctx);
}

export function buildDossierStructuredText(ctx: UnderwritingContext): string {
  const lines: string[] = [];
  const hasCurrentFinancials = ctx.currentGrossRent != null || ctx.currentNoi != null;
  const grossRentTotal = ctx.currentGrossRent;
  const otherIncome = ctx.currentOtherIncome ?? null;
  const expensesTotal =
    ctx.currentExpensesTotal ??
    (ctx.currentGrossRent != null && ctx.currentNoi != null
      ? ctx.currentGrossRent + num(ctx.currentOtherIncome) - ctx.currentNoi
      : null);
  const noi =
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
  }
  lines.push(propertyTaxGrowthSourceLine(ctx));
  pushConditionReview(lines, ctx);
  lines.push("");

  lines.push("2. RECOMMENDED OFFER");
  lines.push("--------------------");
  lines.push(tableRow(["Target IRR", pctValue(ctx.assumptions.targetIrrPct)]));
  lines.push(
    tableRow([
      "IRR at asking",
      ctx.recommendedOffer?.irrAtAskingPct != null
        ? `${(ctx.recommendedOffer.irrAtAskingPct * 100).toFixed(2)}%`
        : "—",
    ])
  );
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
  lines.push(tableRow(["**Total gross rent**", moneyLabel(grossRentTotal != null ? grossRentTotal + num(otherIncome) : grossRentTotal)]));
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
  lines.push(tableRow(["—— Gross rent minus expenses ——", ""]));
  lines.push(tableRow(["**NOI**", moneyLabel(noi)]));
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
  lines.push(tableRow(["**Stabilized NOI**", moneyLabel(hasCurrentFinancials ? ctx.operating.stabilizedNoi : null)]));
  lines.push(tableRow(["Stabilized cap rate", pctValue(ctx.adjustedCapRate)]));
  lines.push("");

  lines.push("5. FINANCING & CASH FLOW");
  lines.push("-------------------------");
  lines.push(tableRow(["Purchase price", moneyLabel(ctx.purchasePrice)]));
  lines.push(
    tableRow([
      `Purchase closing costs (${ctx.assumptions.acquisition.purchaseClosingCostPct != null ? ctx.assumptions.acquisition.purchaseClosingCostPct.toFixed(2) : "—"}%)`,
      moneyLabel(ctx.acquisition.purchaseClosingCosts),
    ])
  );
  lines.push(tableRow(["Renovation costs", moneyLabel(ctx.assumptions.acquisition.renovationCosts)]));
  lines.push(tableRow(["Furnishing/setup costs", moneyLabel(ctx.assumptions.acquisition.furnishingSetupCosts)]));
  lines.push(tableRow(["Financing fees", moneyLabel(ctx.acquisition.financingFees)]));
  lines.push(tableRow(["Total project cost", moneyLabel(ctx.acquisition.totalProjectCost)]));
  lines.push(tableRow(["Loan amount", moneyLabel(ctx.financing.loanAmount)]));
  lines.push(tableRow(["Initial equity invested", moneyLabel(ctx.acquisition.initialEquityInvested)]));
  lines.push(tableRow(["Annual debt service", moneyLabel(ctx.financing.annualDebtService)]));
  lines.push(tableRow(["Annual operating cash flow", moneyLabel(ctx.cashFlows.annualOperatingCashFlow)]));
  lines.push(tableRow(["Final year cash flow", moneyLabel(ctx.cashFlows.finalYearCashFlow)]));
  if (ctx.amortizationSchedule && ctx.amortizationSchedule.length > 0) {
    lines.push("");
    lines.push(tableRow(["Year", ...ctx.amortizationSchedule.map((row) => `Y${row.year}`)]));
    lines.push(tableRow(["Principal", ...ctx.amortizationSchedule.map((row) => moneyLabel(row.principalPayment))]));
    lines.push(tableRow(["Interest", ...ctx.amortizationSchedule.map((row) => moneyLabel(row.interestPayment))]));
    lines.push(tableRow(["Debt service", ...ctx.amortizationSchedule.map((row) => moneyLabel(row.debtService))]));
    lines.push(tableRow(["Ending balance", ...ctx.amortizationSchedule.map((row) => moneyLabel(row.endingBalance))]));
  }
  if (ctx.yearlyCashFlow) {
    lines.push("");
    pushYearlyCashFlowTable(lines, ctx.yearlyCashFlow);
  }
  lines.push("");

  lines.push("6. EXIT");
  lines.push("-------");
  lines.push(tableRow(["Hold period", `${ctx.assumptions.holdPeriodYears ?? "—"} years`]));
  lines.push(tableRow(["Exit property value", moneyLabel(ctx.exit.exitPropertyValue)]));
  lines.push(tableRow(["Sale closing costs", moneyLabel(ctx.exit.saleClosingCosts)]));
  lines.push(tableRow(["Net sale proceeds before debt payoff", moneyLabel(ctx.exit.netSaleProceedsBeforeDebtPayoff)]));
  lines.push(tableRow(["Remaining loan balance", moneyLabel(ctx.exit.remainingLoanBalance)]));
  lines.push(tableRow(["Principal paydown to date", moneyLabel(ctx.exit.principalPaydownToDate)]));
  lines.push(tableRow(["**Net proceeds to equity**", moneyLabel(ctx.exit.netProceedsToEquity)]));
  lines.push("");

  lines.push("7. RETURNS");
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
      "Cash-on-cash (year 1)",
      ctx.returns.year1CashOnCashReturn != null
        ? `${(ctx.returns.year1CashOnCashReturn * 100).toFixed(2)}%`
        : "—",
    ])
  );
  lines.push(
    tableRow([
      "Average cash-on-cash",
      ctx.returns.averageCashOnCashReturn != null
        ? `${(ctx.returns.averageCashOnCashReturn * 100).toFixed(2)}%`
        : "—",
    ])
  );
  lines.push("");

  lines.push("8. ASSUMPTIONS USED");
  lines.push("--------------------");
  lines.push(`Purchase closing costs: ${pctValue(ctx.assumptions.acquisition.purchaseClosingCostPct)}`);
  lines.push(`Renovation: ${moneyLabel(ctx.assumptions.acquisition.renovationCosts)}`);
  lines.push(`Furnishing/setup: ${moneyLabel(ctx.assumptions.acquisition.furnishingSetupCosts)}`);
  lines.push(`LTV: ${pctValue(ctx.assumptions.financing.ltvPct)}`);
  lines.push(`Interest rate: ${pctValue(ctx.assumptions.financing.interestRatePct)}`);
  lines.push(`Amortization: ${ctx.assumptions.financing.amortizationYears ?? "—"} years`);
  lines.push(`Loan fee: ${pctValue(ctx.assumptions.financing.loanFeePct)}`);
  lines.push(`Base rent uplift: ${pctValue(ctx.assumptions.operating.rentUpliftPct)}`);
  lines.push(`Blended rent uplift: ${pctValue(ctx.assumptions.operating.blendedRentUpliftPct)}`);
  lines.push(`Expense increase: ${pctValue(ctx.assumptions.operating.expenseIncreasePct)}`);
  lines.push(`Management fee: ${pctValue(ctx.assumptions.operating.managementFeePct)}`);
  lines.push(`Vacancy: ${pctValue(ctx.assumptions.operating.vacancyPct)}`);
  lines.push(`Lead time: ${ctx.assumptions.operating.leadTimeMonths ?? "—"} months`);
  lines.push(`Annual rent growth: ${pctValue(ctx.assumptions.operating.annualRentGrowthPct)}`);
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

  if (ctx.sensitivities && ctx.sensitivities.length > 0) {
    lines.push("9. SENSITIVITY ANALYSIS");
    lines.push("------------------------");
    ctx.sensitivities.forEach((sensitivity) => {
      lines.push(
        `• Base ${sensitivity.inputLabel.toLowerCase()}: ${pctValue(
          sensitivity.baseCase.valuePct
        )}; IRR range ${sensitivityRangeLabel(
          sensitivity.ranges.irrPct.min,
          sensitivity.ranges.irrPct.max
        )}; CoC range ${sensitivityRangeLabel(
          sensitivity.ranges.year1CashOnCashReturn.min,
          sensitivity.ranges.year1CashOnCashReturn.max
        )}`
      );
      lines.push(tableRow([sensitivity.inputLabel, "Stabilized NOI", "IRR", "Cash-on-cash"]));
      lines.push(
        tableRow([
          `Base (${pctValue(sensitivity.baseCase.valuePct)})`,
          moneyLabel(ctx.operating.stabilizedNoi),
          ctx.returns.irrPct != null ? `${(ctx.returns.irrPct * 100).toFixed(2)}%` : "—",
          ctx.returns.year1CashOnCashReturn != null
            ? `${(ctx.returns.year1CashOnCashReturn * 100).toFixed(2)}%`
            : "—",
        ])
      );
      sensitivity.scenarios.forEach((scenario) => {
        lines.push(
          tableRow([
            pctValue(scenario.valuePct),
            moneyLabel(scenario.stabilizedNoi),
            scenario.irrPct != null ? `${(scenario.irrPct * 100).toFixed(2)}%` : "—",
            scenario.year1CashOnCashReturn != null
              ? `${(scenario.year1CashOnCashReturn * 100).toFixed(2)}%`
              : "—",
          ])
        );
      });
      lines.push("");
    });
  }

  lines.push("10. KEY TAKEAWAYS");
  lines.push("-----------------");
  if (ctx.dealScore != null) lines.push(`• Deal score: ${ctx.dealScore}/100`);
  if (ctx.adjustedCapRate != null) lines.push(`• Stabilized cap rate: ${ctx.adjustedCapRate.toFixed(2)}%`);
  if (ctx.returns.irrPct != null) lines.push(`• Projected IRR: ${(ctx.returns.irrPct * 100).toFixed(2)}%`);
  if (ctx.recommendedOffer?.discountToAskingPct != null && ctx.recommendedOffer.discountToAskingPct > 0) {
    lines.push(
      `• High-end recommended offer is ${ctx.recommendedOffer.discountToAskingPct.toFixed(2)}% below ask to clear the target IRR.`
    );
  }
  if (ctx.exit.principalPaydownToDate != null) {
    lines.push(
      `• Exit equity includes ${moneyLabel(
        ctx.exit.principalPaydownToDate
      )} of debt paydown recovered through the lower payoff balance, not as a separate sale add-back.`
    );
  }
  lines.push("");

  return lines.join("\n");
}

export function buildDossierBuffer(ctx: UnderwritingContext): Buffer {
  return Buffer.from(buildDossierStructuredText(ctx), "utf-8");
}
