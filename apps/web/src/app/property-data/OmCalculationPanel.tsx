"use client";

import type {
  PropertyDealDossierExpenseTreatment,
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierUnitModelRow,
} from "@re-sourcing/contracts";
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
  "occupancyTaxPct",
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
export type OmCalculationTextField = "investmentProfile" | "targetAcquisitionDate";

export interface OmCalculationUnitModelRow extends PropertyDealDossierUnitModelRow {
  rowId: string;
  unitLabel: string;
  currentAnnualRent: number | null;
  underwrittenAnnualRent: number | null;
  rentUpliftPct: number | null;
  occupancyPct: number | null;
  furnishingCost: number | null;
  onboardingFee: number | null;
  monthlyHospitalityExpense: number | null;
  includeInUnderwriting: boolean;
  isProtected: boolean;
  isCommercial: boolean;
  isRentStabilized: boolean;
  isVacantLike: boolean;
  modeledAnnualRent: number | null;
  defaultProjectedAnnualRent: number | null;
}

export interface OmCalculationExpenseModelRow extends PropertyDealDossierExpenseModelRow {
  rowId: string;
  lineItem: string;
  amount: number | null;
  annualGrowthPct: number | null;
  treatment: PropertyDealDossierExpenseTreatment;
  isManagementLine: boolean;
}

export interface OmCalculationDraft {
  purchasePrice: number | null;
  purchaseClosingCostPct: number | null;
  renovationCosts: number | null;
  furnishingSetupCosts: number | null;
  investmentProfile: string;
  targetAcquisitionDate: string;
  ltvPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
  loanFeePct: number | null;
  rentUpliftPct: number | null;
  expenseIncreasePct: number | null;
  managementFeePct: number | null;
  occupancyTaxPct: number | null;
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
  unitModelRows?: OmCalculationUnitModelRow[];
  expenseModelRows?: OmCalculationExpenseModelRow[];
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

interface OmCalculationSensitivityScenario {
  valuePct: number;
  irrPct: number | null;
  year1CashOnCashReturn: number | null;
  year1EquityYield: number | null;
  stabilizedNoi: number;
  annualOperatingCashFlow: number;
  exitPropertyValue: number;
  netProceedsToEquity: number;
}

interface OmCalculationSensitivityRange {
  min: number | null;
  max: number | null;
}

interface OmCalculationSensitivity {
  key: "rental_uplift" | "expense_increase" | "management_fee" | "exit_cap_rate";
  title: string;
  inputLabel: string;
  scenarios: OmCalculationSensitivityScenario[];
  baseCase: {
    valuePct: number | null;
    irrPct: number | null;
    year1CashOnCashReturn: number | null;
    year1EquityYield: number | null;
  };
  ranges: {
    irrPct: OmCalculationSensitivityRange;
    year1CashOnCashReturn: OmCalculationSensitivityRange;
    year1EquityYield: OmCalculationSensitivityRange;
  };
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
  acquisitionMetadata: {
    investmentProfile: string | null;
    targetAcquisitionDate: string | null;
  };
  currentFinancials: {
    grossRentalIncome: number | null;
    otherIncome: number | null;
    vacancyLoss: number | null;
    effectiveGrossIncome: number | null;
    operatingExpenses: number | null;
    noi: number | null;
    expenseRatioPct: number | null;
    currentCapRatePct: number | null;
    rentBasis: string | null;
    assumedLongTermOccupancyPct: number | null;
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
    averageCashOnCashReturn: number | null;
    year1CashOnCashReturn: number | null;
    year1EquityYield: number | null;
    equityMultiple: number | null;
  };
  rentRoll: OmCalculationRentRollRow[];
  expenseRows: OmCalculationExpenseRow[];
  unitModelRows: OmCalculationUnitModelRow[];
  expenseModelRows: OmCalculationExpenseModelRow[];
  sensitivities: OmCalculationSensitivity[];
  yearlyCashFlow: OmCalculationYearlyCashFlow;
  operating: {
    currentExpenses: number;
    currentOtherIncome: number;
    adjustedGrossRent: number;
    adjustedOperatingExpenses: number;
    managementFeeAmount: number;
    stabilizedNoi: number;
  };
  recommendedOffer: {
    askingPrice: number | null;
    targetIrrPct: number;
    irrAtAskingPct: number | null;
    recommendedOfferLow: number | null;
    recommendedOfferHigh: number | null;
    discountToAskingPct: number | null;
    targetMetAtAsking: boolean;
  };
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
  onDraftTextChange: (field: OmCalculationTextField, value: string) => void;
  onUnitModelRowsChange: (rows: OmCalculationUnitModelRow[]) => void;
  onExpenseModelRowsChange: (rows: OmCalculationExpenseModelRow[]) => void;
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
      { key: "furnishingSetupCosts", label: "Fallback furnishing total", step: 1000, prefix: "$" },
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
    title: "Operating",
    fields: [
      { key: "rentUpliftPct", label: "Default rent uplift", step: 0.1, suffix: "%" },
      { key: "expenseIncreasePct", label: "Expense step-up", step: 0.1, suffix: "%" },
      { key: "managementFeePct", label: "Management fee", step: 0.1, suffix: "%" },
      { key: "occupancyTaxPct", label: "Occupancy tax", step: 0.1, suffix: "%" },
      { key: "vacancyPct", label: "Fallback vacancy", step: 0.1, suffix: "%" },
      { key: "leadTimeMonths", label: "Lease-up lead time", step: 1, suffix: "mo" },
      { key: "annualRentGrowthPct", label: "Annual rent growth", step: 0.1, suffix: "%" },
      { key: "annualOtherIncomeGrowthPct", label: "Annual other-income growth", step: 0.1, suffix: "%" },
      { key: "annualExpenseGrowthPct", label: "Default expense growth", step: 0.1, suffix: "%" },
      { key: "annualPropertyTaxGrowthPct", label: "Property-tax growth", step: 0.1, suffix: "%" },
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

const EXPENSE_TREATMENT_OPTIONS: Array<{
  value: PropertyDealDossierExpenseTreatment;
  label: string;
}> = [
  { value: "operating", label: "Include in opex" },
  { value: "replace_management", label: "Replace with mgmt fee" },
  { value: "exclude", label: "Exclude" },
];

const tableCellStyle: React.CSSProperties = {
  padding: "0.55rem 0.65rem",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

const sectionCardStyle: React.CSSProperties = {
  border: "1px solid #dbe2ea",
  borderRadius: "14px",
  background: "#fff",
  overflow: "hidden",
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

function formatRatioPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMultiple(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}x`;
}

function sensitivityRangeLabel(range: OmCalculationSensitivityRange | null | undefined): string {
  if (!range || range.min == null || range.max == null) return "—";
  return `${formatRatioPercent(range.min, 1)} to ${formatRatioPercent(range.max, 1)}`;
}

function formatDraftValue(draft: OmCalculationDraft, field: FieldConfig): string {
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
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(124px, 144px)",
        gap: "0.55rem",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: "0.77rem", fontWeight: 600, color: "#334155", lineHeight: 1.35 }}>
        {field.label}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid #cbd5e1",
          borderRadius: "8px",
          background: "#fff",
          overflow: "hidden",
        }}
      >
        {field.prefix ? (
          <span
            style={{
              padding: "0.4rem 0.5rem",
              borderRight: "1px solid #e2e8f0",
              color: "#64748b",
              background: "#f8fafc",
              fontSize: "0.8rem",
            }}
          >
            {field.prefix}
          </span>
        ) : null}
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
            padding: "0.4rem 0.55rem",
            border: "none",
            outline: "none",
            fontSize: "0.84rem",
            fontVariantNumeric: "tabular-nums",
          }}
        />
        {field.suffix ? (
          <span
            style={{
              padding: "0.4rem 0.5rem",
              borderLeft: "1px solid #e2e8f0",
              color: "#64748b",
              background: "#f8fafc",
              fontSize: "0.78rem",
            }}
          >
            {field.suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

function tableInputStyle(width = "100%"): React.CSSProperties {
  return {
    width,
    minWidth: 0,
    padding: "0.45rem 0.5rem",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "0.84rem",
    background: "#fff",
  };
}

function nextExpenseRowId(): string {
  return `expense-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  onDraftTextChange,
  onUnitModelRowsChange,
  onExpenseModelRowsChange,
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
  const unitModelRows = draft.unitModelRows ?? calculation?.unitModelRows ?? [];
  const expenseModelRows = draft.expenseModelRows ?? calculation?.expenseModelRows ?? [];
  const detailedFurnishingTotal = unitModelRows.reduce(
    (sum, row) => sum + (row.includeInUnderwriting === false ? 0 : row.furnishingCost ?? 0),
    0
  );
  const detailedOnboardingTotal = unitModelRows.reduce(
    (sum, row) => sum + (row.includeInUnderwriting === false ? 0 : row.onboardingFee ?? 0),
    0
  );
  const detailedHospitalityMonthlyTotal = unitModelRows.reduce(
    (sum, row) =>
      sum + (row.includeInUnderwriting === false ? 0 : row.monthlyHospitalityExpense ?? 0),
    0
  );
  const weightedModeledOccupancyPct =
    unitModelRows.length > 0
      ? (() => {
          const includedRows = unitModelRows.filter((row) => row.includeInUnderwriting !== false);
          const totalBaseAnnual = includedRows.reduce(
            (sum, row) => sum + (row.underwrittenAnnualRent ?? 0),
            0
          );
          if (totalBaseAnnual <= 0) return null;
          return (
            includedRows.reduce(
              (sum, row) =>
                sum +
                (row.underwrittenAnnualRent ?? 0) * ((Math.max(0, row.occupancyPct ?? 100)) / 100),
              0
            ) /
            totalBaseAnnual
          ) * 100;
        })()
      : null;
  const replacedManagementRows = expenseModelRows.filter((row) => row.treatment === "replace_management");
  const recommendedOfferRange =
    calculation?.recommendedOffer.recommendedOfferLow != null &&
    calculation?.recommendedOffer.recommendedOfferHigh != null
      ? `${formatCurrency(calculation.recommendedOffer.recommendedOfferLow)} - ${formatCurrency(calculation.recommendedOffer.recommendedOfferHigh)}`
      : "—";
  const sensitivityCards = calculation?.sensitivities ?? [];

  function updateUnitRow(rowId: string, patch: Partial<OmCalculationUnitModelRow>) {
    onUnitModelRowsChange(
      unitModelRows.map((row) => {
        if (row.rowId !== rowId) return row;
        const next = { ...row, ...patch };
        const annual = next.underwrittenAnnualRent ?? 0;
        const uplift = next.rentUpliftPct ?? 0;
        const occupancy = Math.max(0, next.occupancyPct ?? 100);
        return {
          ...next,
          modeledAnnualRent:
            next.includeInUnderwriting === false || next.underwrittenAnnualRent == null
              ? null
              : Math.round(annual * (1 + Math.max(0, uplift) / 100) * (occupancy / 100) * 100) /
                100,
        };
      })
    );
  }

  function updateExpenseRow(rowId: string, patch: Partial<OmCalculationExpenseModelRow>) {
    onExpenseModelRowsChange(
      expenseModelRows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    );
  }

  function addExpenseRow() {
    onExpenseModelRowsChange([
      ...expenseModelRows,
      {
        rowId: nextExpenseRowId(),
        lineItem: "",
        amount: null,
        annualGrowthPct: draft.annualExpenseGrowthPct ?? null,
        treatment: "operating",
        isManagementLine: false,
      },
    ]);
  }

  function removeExpenseRow(rowId: string) {
    onExpenseModelRowsChange(expenseModelRows.filter((row) => row.rowId !== rowId));
  }

  function renderSensitivityCard(sensitivity: OmCalculationSensitivity) {
    const outputLabel =
      sensitivity.key === "exit_cap_rate" ? "Net sale to equity" : "Stabilized NOI";

    return (
      <div
        key={sensitivity.key}
        style={{
          border: "1px solid #dbe2ea",
          borderRadius: "12px",
          padding: "0.9rem",
          background: "#fbfdff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, color: "#0f172a" }}>{sensitivity.title}</div>
            <div style={{ marginTop: "0.22rem", fontSize: "0.78rem", color: "#64748b" }}>
              Base {sensitivity.inputLabel.toLowerCase()}:{" "}
              <strong style={{ color: "#0f172a" }}>{formatPercent(sensitivity.baseCase.valuePct, 1)}</strong>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "0.78rem", color: "#475569" }}>
            <div>IRR range: {sensitivityRangeLabel(sensitivity.ranges.irrPct)}</div>
            <div>
              Equity-yield range:{" "}
              {sensitivityRangeLabel(
                sensitivity.ranges.year1EquityYield.min != null ||
                  sensitivity.ranges.year1EquityYield.max != null
                  ? sensitivity.ranges.year1EquityYield
                  : sensitivity.ranges.year1CashOnCashReturn
              )}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>
                  {sensitivity.inputLabel}
                </th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>IRR</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>
                  Equity yield
                </th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>
                  {outputLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {sensitivity.scenarios.map((scenario) => (
              <tr key={`${sensitivity.key}-${scenario.valuePct}`}>
                <td style={tableCellStyle}>{formatPercent(scenario.valuePct, 1)}</td>
                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                    {formatRatioPercent(scenario.irrPct, 1)}
                  </td>
                  <td style={{ ...tableCellStyle, textAlign: "right" }}>
                    {formatRatioPercent(
                      scenario.year1EquityYield ?? scenario.year1CashOnCashReturn,
                      1
                    )}
                  </td>
                  <td style={{ ...tableCellStyle, textAlign: "right" }}>
                    {formatCurrency(
                      sensitivity.key === "exit_cap_rate"
                        ? scenario.netProceedsToEquity
                        : scenario.stabilizedNoi
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1rem",
        border: "1px solid #dbeafe",
        borderRadius: "16px",
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
        <div style={{ maxWidth: "820px" }}>
          <h3 style={{ margin: 0, fontSize: "1.08rem", color: "#0f172a" }}>OM analysis workspace</h3>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "#475569", lineHeight: 1.55 }}>
            Work from the uploaded OM the way you would in a live underwrite: tighten the assumptions in a
            compact calculator, adjust unit and expense rows directly, then review current state, cash flow
            records, sensitivities, and the assumptions that will feed the dossier.
          </p>
          <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap", marginTop: "0.55rem" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.28rem 0.58rem",
                borderRadius: "999px",
                background: "#dbeafe",
                color: "#1d4ed8",
                fontSize: "0.77rem",
                fontWeight: 700,
              }}
            >
              {effectiveLabel}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.28rem 0.58rem",
                borderRadius: "999px",
                background: isDirty ? "#fef3c7" : "#ecfdf5",
                color: isDirty ? "#92400e" : "#166534",
                fontSize: "0.77rem",
                fontWeight: 700,
              }}
            >
              {isDirty ? "Unsaved assumption edits" : "Assumptions synced"}
            </span>
          </div>
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
            {running ? "Analyzing..." : "Analyze OM"}
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
            {saving ? "Saving..." : "Save assumptions"}
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

      {!canCalculate ? (
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
          Upload an OM, build the authoritative OM, or save broker notes first so this workspace has a
          current revenue and expense base to analyze.
        </div>
      ) : null}

      {error ? (
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
      ) : null}

      {calculation ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "0.9rem",
          }}
        >
          {metricCard("Current state", [
            {
              label: "Gross rental income",
              value: formatCurrency(calculation.currentFinancials.grossRentalIncome),
            },
            {
              label: "Other income",
              value: formatCurrency(calculation.currentFinancials.otherIncome),
            },
            {
              label: "Vacancy / collection loss",
              value: formatCurrency(calculation.currentFinancials.vacancyLoss),
            },
            {
              label: "Effective gross income",
              value: formatCurrency(calculation.currentFinancials.effectiveGrossIncome),
            },
            {
              label: "Operating expenses",
              value: formatCurrency(calculation.currentFinancials.operatingExpenses),
            },
            { label: "NOI", value: formatCurrency(calculation.currentFinancials.noi) },
            {
              label: "Expense ratio",
              value: formatPercent(calculation.currentFinancials.expenseRatioPct, 1),
            },
            {
              label: "Detected rent basis",
              value:
                calculation.currentFinancials.rentBasis === "gross_before_vacancy"
                  ? "Gross before vacancy"
                  : calculation.currentFinancials.rentBasis === "effective_after_vacancy"
                    ? "Actual / effective after vacancy"
                    : "Unknown",
            },
            {
              label: "Assumed LTR occupancy",
              value: formatPercent(calculation.currentFinancials.assumedLongTermOccupancyPct, 1),
            },
          ])}
          {metricCard("Underwritten state", [
            {
              label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} rent`,
              value: formatCurrency(calculation.topLineMetrics.projectedYearRent),
            },
            {
              label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} NOI`,
              value: formatCurrency(calculation.topLineMetrics.projectedYearNoi),
            },
            {
              label: "Stabilized NOI",
              value: formatCurrency(calculation.topLineMetrics.stabilizedNoi),
            },
            {
              label: "NOI lift",
              value: formatPercent(calculation.topLineMetrics.stabilizedNoiIncreasePct, 1),
            },
            {
              label: "Current cap rate",
              value: formatPercent(calculation.topLineMetrics.currentCapRatePct, 1),
            },
            {
              label: "Stabilized cap rate",
              value: formatPercent(calculation.topLineMetrics.stabilizedCapRatePct, 1),
            },
          ])}
          {metricCard("Returns", [
            {
              label: "Expected purchase price",
              value: formatCurrency(calculation.assumptions.purchasePrice),
            },
            { label: "Annual debt service", value: formatCurrency(calculation.topLineMetrics.annualDebtService) },
            {
              label: "Projected CoC",
              value: formatRatioPercent(calculation.topLineMetrics.averageCashOnCashReturn, 1),
            },
            {
              label: "Year 1 equity yield",
              value: formatRatioPercent(calculation.topLineMetrics.year1EquityYield, 1),
            },
            { label: "Projected IRR", value: formatRatioPercent(calculation.topLineMetrics.irrPct, 1) },
            {
              label: "Equity multiple",
              value: formatMultiple(calculation.topLineMetrics.equityMultiple),
            },
            {
              label: "Hold period",
              value:
                calculation.topLineMetrics.holdPeriodYears != null
                  ? `${formatNumber(calculation.topLineMetrics.holdPeriodYears)} years`
                  : "—",
            },
          ])}
          {metricCard("Offer check", [
            {
              label: "Asking price",
              value: formatCurrency(calculation.recommendedOffer.askingPrice),
            },
            {
              label: "IRR at asking",
              value: formatRatioPercent(calculation.recommendedOffer.irrAtAskingPct, 1),
            },
            {
              label: "Target IRR",
              value: formatPercent(calculation.recommendedOffer.targetIrrPct, 1),
            },
            {
              label: "Recommended offer band",
              value: recommendedOfferRange,
            },
            {
              label: "Discount to asking",
              value: formatPercent(calculation.recommendedOffer.discountToAskingPct, 1),
            },
            {
              label: "Target met at asking",
              value:
                calculation.recommendedOffer.irrAtAskingPct == null
                  ? "—"
                  : calculation.recommendedOffer.targetMetAtAsking
                    ? "Yes"
                    : "No",
            },
          ])}
        </div>
      ) : null}

      <div style={sectionCardStyle}>
        <div
          style={{
            padding: "0.9rem 1rem",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <div style={{ maxWidth: "720px" }}>
            <strong style={{ color: "#0f172a" }}>Assumptions calculator</strong>
            <div style={{ marginTop: "0.24rem", fontSize: "0.82rem", color: "#64748b", lineHeight: 1.5 }}>
              All of the core underwriting inputs live here in a tighter calculator layout so it is easier to
              key in and iterate quickly during OM review.
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={onApplyFormulaDefault}
              disabled={saving || running}
              style={{
                padding: "0.5rem 0.8rem",
                borderRadius: "9px",
                border: "1px solid #cbd5e1",
                background: "#eff6ff",
                color: "#1d4ed8",
                cursor: saving || running ? "not-allowed" : "pointer",
              }}
            >
              Use formula furnishing default
            </button>
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
              Formula furnishing default: {formatCurrency(formulaFurnishingSetupCosts ?? 0)}
            </div>
          </div>
        </div>
        <div style={{ padding: "0.95rem 1rem" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem",
              marginBottom: "0.9rem",
            }}
          >
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span style={{ fontSize: "0.77rem", fontWeight: 600, color: "#334155" }}>
                Investment profile
              </span>
              <select
                value={draft.investmentProfile}
                onChange={(event) => onDraftTextChange("investmentProfile", event.target.value)}
                style={tableInputStyle()}
              >
                <option value="">Select profile</option>
                <option value="Core">Core</option>
                <option value="Core-plus">Core-plus</option>
                <option value="Light value-add">Light value-add</option>
                <option value="Value-add">Value-add</option>
                <option value="Opportunistic">Opportunistic</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span style={{ fontSize: "0.77rem", fontWeight: 600, color: "#334155" }}>
                Target acquisition date
              </span>
              <input
                type="date"
                value={draft.targetAcquisitionDate}
                onChange={(event) => onDraftTextChange("targetAcquisitionDate", event.target.value)}
                style={tableInputStyle()}
              />
            </label>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "0.85rem",
            }}
          >
            {FIELD_GROUPS.map((group) => (
              <div
                key={group.title}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "0.85rem 0.9rem",
                  background: "#fbfdff",
                }}
              >
                <div
                  style={{
                    fontSize: "0.74rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#475569",
                    marginBottom: "0.7rem",
                  }}
                >
                  {group.title}
                </div>
                <div style={{ display: "grid", gap: "0.6rem" }}>
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
          <div style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "#64748b", lineHeight: 1.5 }}>
            Save assumptions when you want these inputs, unit edits, and expense edits to carry through to
            the generated deal dossier and Excel model.
          </div>
        </div>
      </div>

      <div style={sectionCardStyle}>
        <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
          <strong style={{ color: "#0f172a" }}>Per-unit revenue, capex, and MTR opex model</strong>
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "#64748b", lineHeight: 1.5 }}>
            Edit the OM rent roll row by row. Set uplift, occupancy, furnishing, onboarding, and monthly hospitality
            spend at the unit level so the underwrite reflects the actual OM mix instead of one blended
            assumption.
          </div>
          <div style={{ marginTop: "0.35rem", fontSize: "0.82rem", color: "#0f172a", lineHeight: 1.55 }}>
            Furnishing: <strong>{formatCurrency(detailedFurnishingTotal)}</strong> • Onboarding:{" "}
            <strong>{formatCurrency(detailedOnboardingTotal)}</strong> • Monthly hospitality spend:{" "}
            <strong>{formatCurrency(detailedHospitalityMonthlyTotal)}</strong> • Weighted occupancy:{" "}
            <strong>{formatPercent(weightedModeledOccupancyPct, 1)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Unit</th>
                <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Mix</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Current annual</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Base annual</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Uplift %</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Occ. %</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Furnish</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Onboard</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Hosp. / mo</th>
                <th style={{ ...tableCellStyle, textAlign: "center", fontWeight: 700 }}>Model</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Modeled annual</th>
              </tr>
            </thead>
            <tbody>
              {unitModelRows.length > 0 ? (
                unitModelRows.map((row) => (
                  <tr key={row.rowId}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>{row.unitLabel}</div>
                      <div style={{ marginTop: "0.15rem", color: "#64748b" }}>
                        {[row.tenantStatus, row.notes].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td style={tableCellStyle}>
                      <div>{row.unitCategory ?? "—"}</div>
                      <div style={{ marginTop: "0.15rem", color: "#64748b" }}>
                        {[row.beds != null ? `${formatNumber(row.beds)}Br` : null, row.baths != null ? `${row.baths}Ba` : null, row.sqft != null ? `${formatNumber(row.sqft)} SF` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                      <div style={{ marginTop: "0.15rem", color: "#64748b" }}>
                        {row.isCommercial
                          ? "Commercial"
                          : row.isRentStabilized
                            ? "Rent stabilized"
                            : row.isProtected
                              ? "Protected"
                              : row.isVacantLike
                                ? "Vacant / projected"
                                : "Eligible"}
                      </div>
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(row.currentAnnualRent)}</td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        value={row.underwrittenAnnualRent ?? ""}
                        onChange={(event) =>
                          updateUnitRow(row.rowId, {
                            underwrittenAnnualRent:
                              event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("120px")}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        step="0.1"
                        value={row.rentUpliftPct ?? ""}
                        onChange={(event) =>
                          updateUnitRow(row.rowId, {
                            rentUpliftPct: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("92px")}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        step="0.1"
                        value={row.occupancyPct ?? ""}
                        onChange={(event) =>
                          updateUnitRow(row.rowId, {
                            occupancyPct: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("92px")}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        step="100"
                        value={row.furnishingCost ?? ""}
                        onChange={(event) =>
                          updateUnitRow(row.rowId, {
                            furnishingCost: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("110px")}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        step="100"
                        value={row.onboardingFee ?? ""}
                        onChange={(event) =>
                          updateUnitRow(row.rowId, {
                            onboardingFee: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("105px")}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        step="10"
                        value={row.monthlyHospitalityExpense ?? ""}
                        onChange={(event) =>
                          updateUnitRow(row.rowId, {
                            monthlyHospitalityExpense:
                              event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("105px")}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={row.includeInUnderwriting}
                        onChange={(event) =>
                          updateUnitRow(row.rowId, { includeInUnderwriting: event.target.checked })
                        }
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(row.modeledAnnualRent)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} style={{ ...tableCellStyle, color: "#64748b" }}>
                    Analyze the OM to pull rent roll rows into the underwrite.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={sectionCardStyle}>
        <div
          style={{
            padding: "0.9rem 1rem",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <strong style={{ color: "#0f172a" }}>Expense model</strong>
            <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "#64748b", lineHeight: 1.5 }}>
              Adjust OM expense rows directly. Use <strong>Replace with mgmt fee</strong> when the OM already
              includes management so the model does not double count it, and use <strong>Exclude</strong> for
              legacy LTR line items you want to add back or remove from the furnished / MTR case.
            </div>
            {replacedManagementRows.length > 0 ? (
              <div style={{ marginTop: "0.35rem", fontSize: "0.82rem", color: "#0f172a" }}>
                Rows replacing management fee:{" "}
                <strong>{replacedManagementRows.map((row) => row.lineItem).join(", ")}</strong>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={addExpenseRow}
            style={{
              padding: "0.55rem 0.85rem",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Add expense row
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead style={{ background: "#f8fafc" }}>
              <tr>
                <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Line item</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Amount</th>
                <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Growth %</th>
                <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Treatment</th>
                <th style={{ ...tableCellStyle, textAlign: "center", fontWeight: 700 }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {expenseModelRows.length > 0 ? (
                expenseModelRows.map((row) => (
                  <tr key={row.rowId}>
                    <td style={tableCellStyle}>
                      <input
                        type="text"
                        value={row.lineItem}
                        onChange={(event) =>
                          updateExpenseRow(row.rowId, {
                            lineItem: event.target.value,
                            isManagementLine: /\b(management|mgmt)\b/i.test(event.target.value),
                          })
                        }
                        style={tableInputStyle()}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        step="100"
                        value={row.amount ?? ""}
                        onChange={(event) =>
                          updateExpenseRow(row.rowId, {
                            amount: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("120px")}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        step="0.1"
                        value={row.annualGrowthPct ?? ""}
                        onChange={(event) =>
                          updateExpenseRow(row.rowId, {
                            annualGrowthPct:
                              event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        style={tableInputStyle("92px")}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <select
                        value={row.treatment}
                        onChange={(event) =>
                          updateExpenseRow(row.rowId, {
                            treatment: event.target.value as PropertyDealDossierExpenseTreatment,
                          })
                        }
                        style={tableInputStyle("190px")}
                      >
                        {EXPENSE_TREATMENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={() => removeExpenseRow(row.rowId)}
                        style={{
                          padding: "0.35rem 0.6rem",
                          borderRadius: "8px",
                          border: "1px solid #fecaca",
                          background: "#fff1f2",
                          color: "#b91c1c",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ ...tableCellStyle, color: "#64748b" }}>
                    Analyze the OM to load expense rows, or add your own manually.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading ? (
        <div style={{ color: "#64748b", fontSize: "0.92rem" }}>Loading OM analysis...</div>
      ) : calculation ? (
        <>
          {calculation.validationMessages.length > 0 ? (
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
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "0.9rem",
            }}
          >
            <div style={sectionCardStyle}>
              <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
                <strong style={{ color: "#0f172a" }}>Assumptions used</strong>
                <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "#64748b" }}>
                  These are the resolved assumptions from the latest OM analysis run.
                </div>
              </div>
              <div style={{ padding: "0 1rem 0.4rem" }}>
                {summaryRow(
                  "Investment profile",
                  (calculation.acquisitionMetadata.investmentProfile ?? draft.investmentProfile) ||
                    "—"
                )}
                {summaryRow(
                  "Target acquisition date",
                  (calculation.acquisitionMetadata.targetAcquisitionDate ??
                    draft.targetAcquisitionDate) ||
                    "—"
                )}
                {summaryRow("Modeled purchase price", formatCurrency(calculation.assumptions.purchasePrice))}
                {summaryRow("Closing costs", formatPercent(calculation.assumptions.purchaseClosingCostPct))}
                {summaryRow(
                  "LTV / rate / amort.",
                  calculation.assumptions.ltvPct != null ||
                    calculation.assumptions.interestRatePct != null ||
                    calculation.assumptions.amortizationYears != null
                    ? `${formatPercent(calculation.assumptions.ltvPct)} / ${formatPercent(calculation.assumptions.interestRatePct, 2)} / ${formatNumber(calculation.assumptions.amortizationYears)} yrs`
                    : "—"
                )}
                {summaryRow("Default rent uplift", formatPercent(calculation.assumptions.rentUpliftPct))}
                {summaryRow("Effective blended uplift", formatPercent(calculation.assumptions.blendedRentUpliftPct))}
                {summaryRow("Expense step-up", formatPercent(calculation.assumptions.expenseIncreasePct))}
                {summaryRow(
                  "Mgmt / occupancy tax",
                  calculation.assumptions.managementFeePct != null ||
                    calculation.assumptions.occupancyTaxPct != null
                    ? `${formatPercent(calculation.assumptions.managementFeePct)} / ${formatPercent(calculation.assumptions.occupancyTaxPct)}`
                    : "—"
                )}
                {summaryRow(
                  "Unit furnishing / onboarding",
                  `${formatCurrency(calculation.assumptions.furnishingSetupCosts)} / ${formatCurrency(calculation.assumptions.onboardingCosts)}`
                )}
                {summaryRow(
                  "Monthly hospitality spend",
                  formatCurrency(detailedHospitalityMonthlyTotal)
                )}
                {summaryRow("Weighted modeled occupancy", formatPercent(weightedModeledOccupancyPct, 1))}
                {summaryRow(
                  "Fallback vacancy / lead time",
                  calculation.assumptions.vacancyPct != null || calculation.assumptions.leadTimeMonths != null
                    ? `${formatPercent(calculation.assumptions.vacancyPct)} / ${formatNumber(calculation.assumptions.leadTimeMonths)} mo`
                    : "—"
                )}
                {summaryRow(
                  "Annual growth",
                  calculation.assumptions.annualRentGrowthPct != null ||
                    calculation.assumptions.annualExpenseGrowthPct != null
                    ? `Rent ${formatPercent(calculation.assumptions.annualRentGrowthPct)} / Expense ${formatPercent(calculation.assumptions.annualExpenseGrowthPct)}`
                    : "—"
                )}
                {summaryRow(
                  "Exit cap / close costs",
                  calculation.assumptions.exitCapPct != null ||
                    calculation.assumptions.exitClosingCostPct != null
                    ? `${formatPercent(calculation.assumptions.exitCapPct)} / ${formatPercent(calculation.assumptions.exitClosingCostPct)}`
                    : "—"
                )}
                {summaryRow("Target IRR", formatPercent(calculation.assumptions.targetIrrPct))}
              </div>
            </div>

            <div style={sectionCardStyle}>
              <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
                <strong style={{ color: "#0f172a" }}>Current OM state</strong>
                <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "#64748b" }}>
                  The live baseline before stabilization and exit assumptions are layered in.
                </div>
              </div>
              <div style={{ padding: "0 1rem 0.4rem" }}>
                {summaryRow("Source", calculation.source.sourceLabel)}
                {summaryRow("Asset class", calculation.propertyInfo.assetClass ?? "—")}
                {summaryRow(
                  "Unit mix",
                  calculation.propertyInfo.totalUnits != null
                    ? `${formatNumber(calculation.propertyInfo.totalUnits)} total / ${formatNumber(calculation.propertyInfo.residentialUnits)} resi / ${formatNumber(calculation.propertyInfo.commercialUnits)} comm.`
                    : "—"
                )}
                {summaryRow(
                  "Building size",
                  calculation.propertyInfo.sizeSqft != null
                    ? `${formatNumber(calculation.propertyInfo.sizeSqft)} SF`
                    : "—"
                )}
                {summaryRow("Current NOI", formatCurrency(calculation.currentFinancials.noi))}
                {summaryRow(
                  "Adjusted opex ex mgmt",
                  formatCurrency(calculation.operating.adjustedOperatingExpenses)
                )}
                {summaryRow(
                  "Modeled management fee",
                  formatCurrency(calculation.operating.managementFeeAmount)
                )}
                {summaryRow(
                  "Total project cost",
                  formatCurrency(calculation.topLineMetrics.totalProjectCost)
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "0.9rem",
            }}
          >
            <div style={sectionCardStyle}>
              <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
                <strong style={{ color: "#0f172a" }}>Source rent roll</strong>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Unit</th>
                      <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700 }}>Mix</th>
                      <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Monthly</th>
                      <th style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700 }}>Annual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculation.rentRoll.length > 0 ? (
                      calculation.rentRoll.map((row, index) => (
                        <tr key={`${row.unit ?? row.tenantName ?? "row"}-${index}`}>
                          <td style={tableCellStyle}>{row.unit ?? row.tenantName ?? "—"}</td>
                          <td style={tableCellStyle}>
                            {[
                              row.beds != null ? `${formatNumber(row.beds)}Br` : null,
                              row.baths != null ? `${row.baths}Ba` : null,
                              row.sqft != null ? `${formatNumber(row.sqft)} SF` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td style={{ ...tableCellStyle, textAlign: "right" }}>{formatCurrency(row.monthlyRent)}</td>
                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                            {formatCurrency(row.annualRent ?? (row.monthlyRent != null ? row.monthlyRent * 12 : null))}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} style={{ ...tableCellStyle, color: "#64748b" }}>
                          No rent roll rows were extracted from the OM source.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={sectionCardStyle}>
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

          <div style={sectionCardStyle}>
            <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
              <strong style={{ color: "#0f172a" }}>Sensitivity analysis</strong>
              <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "#64748b" }}>
                These are the primary scenario sweeps behind the deal dossier: rent, expenses, management,
                and exit cap rate.
              </div>
            </div>
            <div
              style={{
                padding: "1rem",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "0.9rem",
              }}
            >
              {sensitivityCards.length > 0 ? (
                sensitivityCards.map((sensitivity) => renderSensitivityCard(sensitivity))
              ) : (
                <div style={{ color: "#64748b", fontSize: "0.9rem" }}>
                  Sensitivity outputs are not available for this run yet.
                </div>
              )}
            </div>
          </div>

          <div style={sectionCardStyle}>
            <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
              <strong style={{ color: "#0f172a" }}>Yearly cash flow records</strong>
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
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatCurrency(calculation.yearlyCashFlow.grossRentalIncome[index])}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatCurrency(calculation.yearlyCashFlow.otherIncome[index])}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatCurrency(calculation.yearlyCashFlow.totalOperatingExpenses[index])}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatCurrency(calculation.yearlyCashFlow.noi[index])}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatCurrency(calculation.yearlyCashFlow.debtService[index])}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatCurrency(calculation.yearlyCashFlow.cashFlowAfterFinancing[index])}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatCurrency(calculation.yearlyCashFlow.netSaleProceedsToEquity[index])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div style={{ color: "#64748b", fontSize: "0.92rem" }}>
          Analyze the OM to populate the underwriting outputs, sensitivities, and cash flow records.
        </div>
      )}
    </div>
  );
}
