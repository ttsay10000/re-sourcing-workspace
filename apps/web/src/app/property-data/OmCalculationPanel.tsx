"use client";

import React from "react";

export const OM_CALC_NUMERIC_FIELDS = [
  "purchasePrice",
  "purchaseClosingCostPct",
  "renovationCosts",
  "furnishingSetupCosts",
  "ltvPct",
  "interestRatePct",
  "amortizationYears",
  "loanFeePct",
  "rentUpliftPct",
  "expenseIncreasePct",
  "managementFeePct",
  "vacancyPct",
  "leadTimeMonths",
  "annualRentGrowthPct",
  "annualOtherIncomeGrowthPct",
  "annualExpenseGrowthPct",
  "annualPropertyTaxGrowthPct",
  "recurringCapexAnnual",
  "holdPeriodYears",
  "exitCapPct",
  "exitClosingCostPct",
  "targetIrrPct",
] as const;

export type OmCalculationNumericField = (typeof OM_CALC_NUMERIC_FIELDS)[number];

export interface OmCalculationDraft {
  purchasePrice: number | null;
  purchaseClosingCostPct: number | null;
  renovationCosts: number | null;
  furnishingSetupCosts: number | null;
  ltvPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
  loanFeePct: number | null;
  rentUpliftPct: number | null;
  expenseIncreasePct: number | null;
  managementFeePct: number | null;
  vacancyPct: number | null;
  leadTimeMonths: number | null;
  annualRentGrowthPct: number | null;
  annualOtherIncomeGrowthPct: number | null;
  annualExpenseGrowthPct: number | null;
  annualPropertyTaxGrowthPct: number | null;
  recurringCapexAnnual: number | null;
  holdPeriodYears: number | null;
  exitCapPct: number | null;
  exitClosingCostPct: number | null;
  targetIrrPct: number | null;
  brokerEmailNotes: string;
}

interface OmCalculationRentRollRow {
  unit?: string;
  building?: string;
  unitCategory?: string;
  tenantName?: string;
  monthlyRent?: number;
  annualRent?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  rentType?: string;
  tenantStatus?: string;
  notes?: string;
}

interface OmCalculationExpenseRow {
  lineItem: string;
  amount: number;
}

interface OmCalculationYearlyCashFlow {
  endingLabels: string[];
  grossRentalIncome: number[];
  otherIncome: number[];
  totalOperatingExpenses: number[];
  noi: number[];
  debtService: number[];
  cashFlowAfterFinancing: number[];
  netSaleProceedsToEquity: number[];
}

export interface OmCalculationSnapshot {
  property: {
    canonicalAddress: string;
    city: string | null;
    askingPrice: number | null;
    listedAt: string | null;
  };
  source: {
    hasAuthoritativeOm: boolean;
    hasBrokerFinancialInputs: boolean;
    sourceLabel: string;
  };
  propertyInfo: {
    assetClass: string | null;
    sizeSqft: number | null;
    yearBuilt: string | null;
    taxCode: string | null;
    zoningDistrict: string | null;
    totalUnits: number | null;
    residentialUnits: number;
    commercialUnits: number;
    rentStabilizedUnits: number;
  };
  assumptions: Record<string, number | null>;
  currentFinancials: {
    grossRentalIncome: number | null;
    otherIncome: number | null;
    effectiveGrossIncome: number | null;
    operatingExpenses: number | null;
    noi: number | null;
    expenseRatioPct: number | null;
    currentCapRatePct: number | null;
  };
  topLineMetrics: {
    projectedYearNumber: number;
    currentRent: number | null;
    currentExpenses: number | null;
    currentNoi: number | null;
    currentCapRatePct: number | null;
    projectedYearRent: number | null;
    projectedYearExpenses: number | null;
    projectedYearNoi: number | null;
    stabilizedNoi: number | null;
    stabilizedNoiIncreasePct: number | null;
    stabilizedCapRatePct: number | null;
    upfrontCapex: number | null;
    purchaseClosingCosts: number | null;
    financingFees: number | null;
    totalProjectCost: number | null;
    annualDebtService: number | null;
    holdPeriodYears: number | null;
    irrPct: number | null;
    year1CashOnCashReturn: number | null;
    year1EquityYield: number | null;
    equityMultiple: number | null;
  };
  rentRoll: OmCalculationRentRollRow[];
  expenseRows: OmCalculationExpenseRow[];
  yearlyCashFlow: OmCalculationYearlyCashFlow;
  validationMessages: string[];
}

interface OmCalculationPanelProps {
  draft: OmCalculationDraft;
  calculation: OmCalculationSnapshot | null;
  loading: boolean;
  running: boolean;
  saving: boolean;
  error: string | null;
  isDirty: boolean;
  hasAuthoritativeOm: boolean;
  hasBrokerEmailNotes: boolean;
  formulaFurnishingSetupCosts: number | null;
  onDraftNumberChange: (field: OmCalculationNumericField, value: number | null) => void;
  onRunCalculation: () => void;
  onSave: () => void;
  onResetToSaved: () => void;
  onApplyFormulaDefault: () => void;
  onClearSaved: () => void;
}

type FieldConfig = {
  key: OmCalculationNumericField;
  label: string;
  step?: number;
  prefix?: string;
  suffix?: string;
};

const FIELD_GROUPS: Array<{ title: string; fields: FieldConfig[] }> = [
  {
    title: "Acquisition",
    fields: [
      { key: "purchasePrice", label: "Modeled purchase price", step: 1000, prefix: "$" },
      { key: "purchaseClosingCostPct", label: "Closing costs", step: 0.1, suffix: "%" },
      { key: "renovationCosts", label: "Renovation costs", step: 1000, prefix: "$" },
      { key: "furnishingSetupCosts", label: "Furnishing / setup", step: 1000, prefix: "$" },
    ],
  },
  {
    title: "Financing",
    fields: [
      { key: "ltvPct", label: "LTV", step: 0.1, suffix: "%" },
      { key: "interestRatePct", label: "Interest rate", step: 0.01, suffix: "%" },
      { key: "amortizationYears", label: "Amortization", step: 1, suffix: "yrs" },
      { key: "loanFeePct", label: "Loan fee", step: 0.01, suffix: "%" },
    ],
  },
  {
    title: "Operations",
    fields: [
      { key: "rentUpliftPct", label: "Rent uplift", step: 0.1, suffix: "%" },
      { key: "expenseIncreasePct", label: "Expense increase", step: 0.1, suffix: "%" },
      { key: "managementFeePct", label: "Management fee", step: 0.1, suffix: "%" },
      { key: "vacancyPct", label: "Vacancy", step: 0.1, suffix: "%" },
      { key: "leadTimeMonths", label: "Lease-up lead time", step: 1, suffix: "mo" },
      { key: "annualRentGrowthPct", label: "Annual rent growth", step: 0.1, suffix: "%" },
      { key: "annualOtherIncomeGrowthPct", label: "Annual other-income growth", step: 0.1, suffix: "%" },
      { key: "annualExpenseGrowthPct", label: "Annual expense growth", step: 0.1, suffix: "%" },
      { key: "annualPropertyTaxGrowthPct", label: "Annual property-tax growth", step: 0.1, suffix: "%" },
      { key: "recurringCapexAnnual", label: "Recurring annual CapEx", step: 1000, prefix: "$" },
    ],
  },
  {
    title: "Exit",
    fields: [
      { key: "holdPeriodYears", label: "Hold period", step: 1, suffix: "yrs" },
      { key: "exitCapPct", label: "Exit cap", step: 0.1, suffix: "%" },
      { key: "exitClosingCostPct", label: "Exit closing costs", step: 0.1, suffix: "%" },
      { key: "targetIrrPct", label: "Target IRR", step: 0.1, suffix: "%" },
    ],
  },
];

const tableCellStyle: React.CSSProperties = {
  padding: "0.55rem 0.65rem",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDraftValue(
  draft: OmCalculationDraft,
  field: FieldConfig
): string {
  const value = draft[field.key];
  return value == null ? "" : String(value);
}

function summaryRow(label: string, value: string) {
  return (
    <div
      key={label}
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.45rem 0",
        borderBottom: "1px solid #eef2f7",
        fontSize: "0.92rem",
      }}
    >
      <span style={{ color: "#64748b" }}>{label}</span>
      <strong style={{ color: "#0f172a", textAlign: "right" }}>{value}</strong>
    </div>
  );
}

function metricCard(title: string, rows: Array<{ label: string; value: string }>) {
  return (
    <div
      key={title}
      style={{
        border: "1px solid #dbe2ea",
        borderRadius: "14px",
        padding: "1rem 1.1rem",
        background: "#ffffff",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#475569",
          marginBottom: "0.35rem",
        }}
      >
        {title}
      </div>
      {rows.map((row) => summaryRow(row.label, row.value))}
    </div>
  );
}

function AssumptionInput({
  draft,
  field,
  onDraftNumberChange,
}: {
  draft: OmCalculationDraft;
  field: FieldConfig;
  onDraftNumberChange: (field: OmCalculationNumericField, value: number | null) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#0f172a" }}>{field.label}</span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid #cbd5e1",
          borderRadius: "10px",
          background: "#fff",
          overflow: "hidden",
        }}
      >
        {field.prefix && (
          <span
            style={{
              padding: "0.55rem 0.65rem",
              borderRight: "1px solid #e2e8f0",
              color: "#64748b",
              background: "#f8fafc",
            }}
          >
            {field.prefix}
          </span>
        )}
        <input
          type="number"
          step={field.step ?? "any"}
          value={formatDraftValue(draft, field)}
          onChange={(event) =>
            onDraftNumberChange(
              field.key,
              event.target.value === "" ? null : Number(event.target.value)
            )
          }
          style={{
            flex: 1,
            minWidth: 0,
            padding: "0.55rem 0.7rem",
            border: "none",
            outline: "none",
            fontSize: "0.92rem",
          }}
        />
        {field.suffix && (
          <span
            style={{
              padding: "0.55rem 0.65rem",
              borderLeft: "1px solid #e2e8f0",
              color: "#64748b",
              background: "#f8fafc",
            }}
          >
            {field.suffix}
          </span>
        )}
      </div>
    </label>
  );
}

export function OmCalculationPanel({
  draft,
  calculation,
  loading,
  running,
  saving,
  error,
  isDirty,
  hasAuthoritativeOm,
  hasBrokerEmailNotes,
  formulaFurnishingSetupCosts,
  onDraftNumberChange,
  onRunCalculation,
  onSave,
  onResetToSaved,
  onApplyFormulaDefault,
  onClearSaved,
}: OmCalculationPanelProps) {
  const canCalculate = hasAuthoritativeOm || hasBrokerEmailNotes;
  const effectiveLabel = calculation
    ? `Using ${calculation.source.sourceLabel}`
    : hasAuthoritativeOm
      ? "Ready to run against authoritative OM"
      : hasBrokerEmailNotes
        ? "Ready to run against saved broker notes"
        : "Upload an OM/rent roll or save broker notes first";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1rem",
        border: "1px solid #dbeafe",
        borderRadius: "14px",
        background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <div style={{ maxWidth: "780px" }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>OM calculation</h3>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "#475569", lineHeight: 1.55 }}>
            Run a cleaner property-level underwriting preview from the authoritative OM or saved broker notes.
            This keeps the top-line property metrics, current rent roll, resolved assumptions, and yearly cash
            flow on-screen without generating the full dossier.
          </p>
          <p style={{ margin: "0.55rem 0 0", fontSize: "0.8rem", color: "#1d4ed8", fontWeight: 600 }}>
            {effectiveLabel}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onRunCalculation}
            disabled={running || !canCalculate}
            style={{
              padding: "0.6rem 0.95rem",
              borderRadius: "10px",
              border: "none",
              background: "#0066cc",
              color: "#fff",
              fontWeight: 600,
              cursor: running || !canCalculate ? "not-allowed" : "pointer",
              opacity: !canCalculate ? 0.65 : 1,
            }}
          >
            {running ? "Running..." : "Run OM calculation"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || running || !isDirty}
            style={{
              padding: "0.6rem 0.95rem",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              fontWeight: 600,
              cursor: saving || running || !isDirty ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save property defaults"}
          </button>
          <button
            type="button"
            onClick={onResetToSaved}
            disabled={saving || running || !isDirty}
            style={{
              padding: "0.6rem 0.95rem",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
              color: "#334155",
              cursor: saving || running || !isDirty ? "not-allowed" : "pointer",
            }}
          >
            Reset edits
          </button>
          <button
            type="button"
            onClick={onClearSaved}
            disabled={saving || running}
            style={{
              padding: "0.6rem 0.95rem",
              borderRadius: "10px",
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#b91c1c",
              cursor: saving || running ? "not-allowed" : "pointer",
            }}
          >
            Clear saved overrides
          </button>
        </div>
      </div>

      {!canCalculate && (
        <div
          style={{
            padding: "0.85rem 1rem",
            borderRadius: "12px",
            border: "1px solid #cbd5e1",
            background: "#f8fafc",
            color: "#334155",
            fontSize: "0.92rem",
          }}
        >
          Save broker email notes in this workspace or build the authoritative OM first so this property has
          current financial inputs to underwrite against.
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "0.85rem 1rem",
            borderRadius: "12px",
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#b91c1c",
            fontSize: "0.92rem",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "0.9rem",
        }}
      >
        {FIELD_GROUPS.map((group) => (
          <div
            key={group.title}
            style={{
              border: "1px solid #dbe2ea",
              borderRadius: "14px",
              padding: "1rem",
              background: "#fff",
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#475569",
                marginBottom: "0.75rem",
              }}
            >
              {group.title}
            </div>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {group.fields.map((field) => (
                <AssumptionInput
                  key={field.key}
                  draft={draft}
                  field={field}
                  onDraftNumberChange={onDraftNumberChange}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onApplyFormulaDefault}
          disabled={saving || running}
          style={{
            padding: "0.55rem 0.9rem",
            borderRadius: "10px",
            border: "1px solid #cbd5e1",
            background: "#eff6ff",
            color: "#1d4ed8",
            cursor: saving || running ? "not-allowed" : "pointer",
          }}
        >
          Use formula furnishing default
        </button>
        <div style={{ fontSize: "0.8rem", color: "#64748b", alignSelf: "center" }}>
          Formula furnishing default: {formatCurrency(formulaFurnishingSetupCosts ?? 0)}
        </div>
      </div>

      {loading ? (
        <div style={{ color: "#64748b", fontSize: "0.92rem" }}>Loading OM calculation...</div>
      ) : calculation ? (
        <>
          {calculation.validationMessages.length > 0 && (
            <div
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "12px",
                border: "1px solid #fcd34d",
                background: "#fffbeb",
                color: "#92400e",
              }}
            >
              <strong style={{ display: "block", marginBottom: "0.35rem" }}>Validation flags</strong>
              {calculation.validationMessages.map((message) => (
                <div key={message} style={{ fontSize: "0.88rem", lineHeight: 1.5 }}>
                  {message}
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "0.9rem",
            }}
          >
            {metricCard("Property info", [
              { label: "Asset class", value: calculation.propertyInfo.assetClass ?? "—" },
              { label: "Size", value: calculation.propertyInfo.sizeSqft != null ? `${formatNumber(calculation.propertyInfo.sizeSqft)} SF` : "—" },
              { label: "Unit mix", value: calculation.propertyInfo.totalUnits != null ? `${formatNumber(calculation.propertyInfo.totalUnits)} total / ${formatNumber(calculation.propertyInfo.residentialUnits)} resi / ${formatNumber(calculation.propertyInfo.commercialUnits)} comm.` : "—" },
              { label: "Year built", value: calculation.propertyInfo.yearBuilt ?? "—" },
              { label: "Tax code", value: calculation.propertyInfo.taxCode ?? "—" },
              { label: "Zoning district", value: calculation.propertyInfo.zoningDistrict ?? "—" },
            ])}
            {metricCard("Key financials", [
              { label: "Current rent", value: formatCurrency(calculation.topLineMetrics.currentRent) },
              { label: "Expenses", value: formatCurrency(calculation.topLineMetrics.currentExpenses) },
              { label: "Current NOI", value: formatCurrency(calculation.topLineMetrics.currentNoi) },
              { label: "Current cap rate", value: formatPercent(calculation.topLineMetrics.currentCapRatePct, 2) },
              { label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} rent`, value: formatCurrency(calculation.topLineMetrics.projectedYearRent) },
              { label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} expenses`, value: formatCurrency(calculation.topLineMetrics.projectedYearExpenses) },
              { label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} NOI`, value: formatCurrency(calculation.topLineMetrics.projectedYearNoi) },
              { label: "Increase in stabilized NOI", value: formatPercent(calculation.topLineMetrics.stabilizedNoiIncreasePct, 1) },
            ])}
            {metricCard("Expected returns", [
              { label: "Upfront CapEx", value: formatCurrency(calculation.topLineMetrics.upfrontCapex) },
              { label: "Closing costs", value: formatCurrency(calculation.topLineMetrics.purchaseClosingCosts) },
              { label: "Debt service", value: formatCurrency(calculation.topLineMetrics.annualDebtService) },
              { label: "Hold period", value: calculation.topLineMetrics.holdPeriodYears != null ? `${formatNumber(calculation.topLineMetrics.holdPeriodYears)} years` : "—" },
              { label: "Projected IRR", value: formatPercent(calculation.topLineMetrics.irrPct, 1) },
              { label: "Year 1 cash-on-cash", value: formatPercent(calculation.topLineMetrics.year1CashOnCashReturn, 1) },
              { label: "Year 1 equity yield", value: formatPercent(calculation.topLineMetrics.year1EquityYield, 1) },
              { label: "Equity multiple", value: calculation.topLineMetrics.equityMultiple != null ? `${calculation.topLineMetrics.equityMultiple.toFixed(2)}x` : "—" },
            ])}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "0.9rem",
            }}
          >
            <div style={{ border: "1px solid #dbe2ea", borderRadius: "14px", background: "#fff", overflow: "hidden" }}>
              <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
                <strong style={{ color: "#0f172a" }}>Resolved assumptions</strong>
                <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "#64748b" }}>
                  These are the assumptions used in the latest OM calculation run.
                </div>
              </div>
              <div style={{ padding: "0 1rem 0.4rem" }}>
                {summaryRow("Modeled purchase price", formatCurrency(calculation.assumptions.purchasePrice))}
                {summaryRow("Closing costs", formatPercent(calculation.assumptions.purchaseClosingCostPct))}
                {summaryRow("LTV / rate / amort.", calculation.assumptions.ltvPct != null || calculation.assumptions.interestRatePct != null || calculation.assumptions.amortizationYears != null ? `${formatPercent(calculation.assumptions.ltvPct)} / ${formatPercent(calculation.assumptions.interestRatePct, 2)} / ${formatNumber(calculation.assumptions.amortizationYears)} yrs` : "—")}
                {summaryRow("Rent uplift", formatPercent(calculation.assumptions.rentUpliftPct))}
                {summaryRow("Blended uplift", formatPercent(calculation.assumptions.blendedRentUpliftPct))}
                {summaryRow("Expense increase", formatPercent(calculation.assumptions.expenseIncreasePct))}
                {summaryRow("Management fee", formatPercent(calculation.assumptions.managementFeePct))}
                {summaryRow("Vacancy / lead time", calculation.assumptions.vacancyPct != null || calculation.assumptions.leadTimeMonths != null ? `${formatPercent(calculation.assumptions.vacancyPct)} / ${formatNumber(calculation.assumptions.leadTimeMonths)} mo` : "—")}
                {summaryRow("Annual growth", calculation.assumptions.annualRentGrowthPct != null || calculation.assumptions.annualExpenseGrowthPct != null ? `Rent ${formatPercent(calculation.assumptions.annualRentGrowthPct)} / Expense ${formatPercent(calculation.assumptions.annualExpenseGrowthPct)}` : "—")}
                {summaryRow("Exit cap / close costs", calculation.assumptions.exitCapPct != null || calculation.assumptions.exitClosingCostPct != null ? `${formatPercent(calculation.assumptions.exitCapPct)} / ${formatPercent(calculation.assumptions.exitClosingCostPct)}` : "—")}
                {summaryRow("Target IRR", formatPercent(calculation.assumptions.targetIrrPct))}
              </div>
            </div>

            <div style={{ border: "1px solid #dbe2ea", borderRadius: "14px", background: "#fff", overflow: "hidden" }}>
              <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
                <strong style={{ color: "#0f172a" }}>Current expense table</strong>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Line item</th>
                      <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculation.expenseRows.length > 0 ? (
                      calculation.expenseRows.map((row) => (
                        <tr key={`${row.lineItem}-${row.amount}`}>
                          <td style={tableCellStyle}>{row.lineItem}</td>
                          <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(row.amount)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} style={{ ...tableCellStyle, color: "#64748b" }}>
                          No detailed expense rows were extracted from the OM source.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid #dbe2ea", borderRadius: "14px", background: "#fff", overflow: "hidden" }}>
            <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
              <strong style={{ color: "#0f172a" }}>Current rent roll</strong>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Unit</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Monthly</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Annual</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Beds</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Baths</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>SF</th>
                    <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.rentRoll.length > 0 ? (
                    calculation.rentRoll.map((row, index) => (
                      <tr key={`${row.unit ?? row.tenantName ?? "row"}-${index}`}>
                        <td style={tableCellStyle}>{row.unit ?? row.tenantName ?? "—"}</td>
                        <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(row.monthlyRent)}</td>
                        <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(row.annualRent ?? (row.monthlyRent != null ? row.monthlyRent * 12 : null))}</td>
                        <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatNumber(row.beds)}</td>
                        <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatNumber(row.baths)}</td>
                        <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatNumber(row.sqft)}</td>
                        <td style={tableCellStyle}>{[row.unitCategory, row.rentType, row.tenantStatus, row.notes].filter(Boolean).join("; ") || "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ ...tableCellStyle, color: "#64748b" }}>
                        No rent roll rows were extracted from the OM source.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ border: "1px solid #dbe2ea", borderRadius: "14px", background: "#fff", overflow: "hidden" }}>
            <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
              <strong style={{ color: "#0f172a" }}>Yearly cash flow</strong>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Year</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Gross rent</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Other income</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Opex</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>NOI</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Debt service</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Levered cash flow</th>
                    <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Sale to equity</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.yearlyCashFlow.endingLabels.map((label, index) => (
                    <tr key={`${label}-${index}`}>
                      <td style={tableCellStyle}>{label}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(calculation.yearlyCashFlow.grossRentalIncome[index])}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(calculation.yearlyCashFlow.otherIncome[index])}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(calculation.yearlyCashFlow.totalOperatingExpenses[index])}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(calculation.yearlyCashFlow.noi[index])}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(calculation.yearlyCashFlow.debtService[index])}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(calculation.yearlyCashFlow.cashFlowAfterFinancing[index])}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(calculation.yearlyCashFlow.netSaleProceedsToEquity[index])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div style={{ color: "#64748b", fontSize: "0.92rem" }}>
          Run the OM calculation to populate the simplified underwriting view.
        </div>
      )}
    </div>
  );
}
