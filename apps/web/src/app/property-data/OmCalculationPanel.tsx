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
  "annualCommercialRentGrowthPct",
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
  onboardingLaborFee: number | null;
  onboardingOtherCosts: number | null;
  onboardingFee: number | null;
  monthlyRecurringOpex: number | null;
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
  annualCommercialRentGrowthPct: number | null;
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

interface OmCalculationYearlyExpenseLine {
  lineItem: string;
  annualGrowthPct: number;
  baseAmount: number;
  yearlyAmounts: number[];
}

interface OmCalculationYearlyCashFlow {
  years: number[];
  endingLabels: string[];
  grossRentalIncome: number[];
  freeMarketResidentialGrossRentalIncome: number[];
  protectedResidentialGrossRentalIncome: number[];
  commercialGrossRentalIncome: number[];
  otherIncome: number[];
  vacancyLoss: number[];
  leadTimeLoss: number[];
  netRentalIncome: number[];
  managementFee: number[];
  expenseLineItems: OmCalculationYearlyExpenseLine[];
  totalOperatingExpenses: number[];
  noi: number[];
  recurringCapex: number[];
  reserveRelease: number[];
  cashFlowFromOperations: number[];
  debtService: number[];
  principalPaid: number[];
  interestPaid: number[];
  cashFlowAfterFinancing: number[];
  totalInvestmentCost: number[];
  financingFunding: number[];
  financingFees: number[];
  saleValue: number[];
  saleClosingCosts: number[];
  remainingLoanBalance: number[];
  financingPayoff: number[];
  netSaleProceedsBeforeDebtPayoff: number[];
  netSaleProceedsToEquity: number[];
  leveredCashFlow: number[];
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
  rentBreakdown: {
    current: {
      freeMarketResidential: number | null;
      protectedResidential: number | null;
      commercial: number | null;
      total: number | null;
    };
    stabilizedYearNumber: number;
    stabilized: {
      freeMarketResidential: number | null;
      protectedResidential: number | null;
      commercial: number | null;
      total: number | null;
    };
    freeMarketResidentialLift: number | null;
    totalLift: number | null;
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
  acquisition: {
    purchaseClosingCosts: number;
    financingFees: number;
    totalProjectCost: number;
    loanAmount: number;
    equityRequiredForPurchase: number;
    initialEquityInvested: number;
    year0CashFlow: number;
  };
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
  mode?: "property" | "standalone";
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
      { key: "furnishingSetupCosts", label: "Fallback FF&E total", step: 1000, prefix: "$" },
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
      { key: "annualRentGrowthPct", label: "Annual FM rent growth", step: 0.1, suffix: "%" },
      { key: "annualCommercialRentGrowthPct", label: "Annual commercial rent growth", step: 0.1, suffix: "%" },
      { key: "annualOtherIncomeGrowthPct", label: "Annual other-income growth", step: 0.1, suffix: "%" },
      { key: "annualExpenseGrowthPct", label: "Default expense growth", step: 0.1, suffix: "%" },
      { key: "annualPropertyTaxGrowthPct", label: "Property-tax growth", step: 0.1, suffix: "%" },
      { key: "recurringCapexAnnual", label: "Annual reserve", step: 1000, prefix: "$" },
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
  padding: "0.4rem 0.5rem",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

const sectionCardStyle: React.CSSProperties = {
  border: "1px solid #dbe2ea",
  borderRadius: "14px",
  background: "#fff",
  overflow: "hidden",
};

const unitTableSubtextStyle: React.CSSProperties = {
  marginTop: "0.12rem",
  color: "#64748b",
  fontSize: "0.71rem",
  lineHeight: 1.35,
};

const unitTableAnnualValueStyle: React.CSSProperties = {
  marginTop: "0.12rem",
  fontSize: "0.68rem",
  color: "#64748b",
  fontStyle: "italic",
};

const unitTableComputedLabelStyle: React.CSSProperties = {
  marginTop: "0.18rem",
  fontSize: "0.62rem",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#64748b",
};

const unitTableComputedValueStyle: React.CSSProperties = {
  marginTop: "0.06rem",
  fontSize: "0.69rem",
  fontWeight: 600,
  color: "#334155",
  whiteSpace: "nowrap",
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

function formatAccountingCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const absoluteValue = formatCurrency(Math.abs(value));
  return value < -0.004 ? `(${absoluteValue})` : absoluteValue;
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

function formatDateLabel(value: string | null | undefined): string {
  if (!value || value.trim().length === 0) return "—";
  const normalized = value.includes("T") ? value : `${value}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatMultiple(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}x`;
}

function formatCashFlowCellValue(value: number | null | undefined, blankZero = false): string {
  if (value == null || Number.isNaN(value)) return "";
  if (blankZero && Math.abs(value) < 0.005) return "";
  return formatAccountingCurrency(value);
}

function formatCashFlowRatioPercentValue(
  value: number | null | undefined,
  blankZero = false,
  digits = 1
): string {
  if (value == null || Number.isNaN(value)) return "";
  if (blankZero && Math.abs(value) < 0.00005) return "";
  const absoluteValue = `${(Math.abs(value) * 100).toFixed(digits)}%`;
  return value < -0.00005 ? `(${absoluteValue})` : absoluteValue;
}

function formatCashFlowMultipleValue(
  value: number | null | undefined,
  blankZero = false,
  digits = 2
): string {
  if (value == null || Number.isNaN(value)) return "";
  if (blankZero && Math.abs(value) < 0.00005) return "";
  const absoluteValue = `${Math.abs(value).toFixed(digits)}x`;
  return value < -0.00005 ? `(${absoluteValue})` : absoluteValue;
}

function cashFlowValueColor(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) && value < -0.004 ? "#b42318" : "#0f172a";
}

function sensitivityRangeLabel(range: OmCalculationSensitivityRange | null | undefined): string {
  if (!range || range.min == null || range.max == null) return "—";
  return `${formatRatioPercent(range.min, 1)} to ${formatRatioPercent(range.max, 1)}`;
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined, tolerance = 0.0001): boolean {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

function sensitivityMetricTextColor(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) && value < 0 ? "#b42318" : "#0f172a";
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
    padding: "0.32rem 0.42rem",
    border: "1px solid #cbd5e1",
    borderRadius: "7px",
    fontSize: "0.76rem",
    background: "#fff",
  };
}

function monthlyFromAnnual(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round((value / 12) * 100) / 100;
}

function annualFromMonthly(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 12 * 100) / 100;
}

function displayMonthlyInputValue(value: number | null | undefined): string {
  const monthly = monthlyFromAnnual(value);
  return monthly == null ? "" : String(Number(monthly.toFixed(2)));
}

function resolvedOnboardingBreakdown(row: OmCalculationUnitModelRow): {
  labor: number | null;
  other: number | null;
  total: number | null;
} {
  const legacyTotal = row.onboardingFee ?? null;
  const labor =
    row.onboardingLaborFee ?? (legacyTotal != null ? Math.min(legacyTotal, 2_500) : null);
  const other =
    row.onboardingOtherCosts ??
    (legacyTotal != null ? Math.max(0, legacyTotal - Math.min(legacyTotal, 2_500)) : null);
  const total =
    labor != null || other != null
      ? Math.max(0, labor ?? 0) + Math.max(0, other ?? 0)
      : legacyTotal;
  return {
    labor,
    other,
    total: total != null ? Math.round(total * 100) / 100 : null,
  };
}

function resolvedMonthlyRecurringOpex(row: OmCalculationUnitModelRow): number | null {
  return row.monthlyRecurringOpex ?? row.monthlyHospitalityExpense ?? null;
}

function normalizeUnitRow(row: OmCalculationUnitModelRow): OmCalculationUnitModelRow {
  const onboarding = resolvedOnboardingBreakdown(row);
  const monthlyRecurringOpex = resolvedMonthlyRecurringOpex(row);
  const annual = row.underwrittenAnnualRent ?? 0;
  const uplift = row.rentUpliftPct ?? 0;
  const occupancy = Math.max(0, row.occupancyPct ?? 100);
  return {
    ...row,
    onboardingLaborFee: onboarding.labor,
    onboardingOtherCosts: onboarding.other,
    onboardingFee: onboarding.total,
    monthlyRecurringOpex,
    monthlyHospitalityExpense: monthlyRecurringOpex,
    modeledAnnualRent:
      row.includeInUnderwriting === false || row.underwrittenAnnualRent == null
        ? null
        : Math.round(annual * (1 + Math.max(0, uplift) / 100) * (occupancy / 100) * 100) / 100,
  };
}

function projectedBoostedAnnualRent(
  row: Pick<OmCalculationUnitModelRow, "underwrittenAnnualRent" | "rentUpliftPct">
): number | null {
  if (row.underwrittenAnnualRent == null || Number.isNaN(row.underwrittenAnnualRent)) return null;
  const uplift = Math.max(0, row.rentUpliftPct ?? 0);
  return Math.round(row.underwrittenAnnualRent * (1 + uplift / 100) * 100) / 100;
}

function unitTableRowBackground(row: OmCalculationUnitModelRow, rowIndex: number): string {
  if (row.includeInUnderwriting === false) return "#f8fafc";
  return rowIndex % 2 === 0 ? "#ffffff" : "#fbfdff";
}

function unitTableCellStyleForRow(
  row: OmCalculationUnitModelRow,
  rowIndex: number,
  options?: {
    align?: React.CSSProperties["textAlign"];
    pinned?: boolean;
    metric?: boolean;
    lastColumn?: boolean;
  }
): React.CSSProperties {
  const baseBackground = unitTableRowBackground(row, rowIndex);
  const background = options?.metric
    ? row.includeInUnderwriting === false
      ? "#f2f5f8"
      : "#f3f8ff"
    : options?.pinned
      ? row.includeInUnderwriting === false
        ? "#f4f7fa"
        : rowIndex % 2 === 0
          ? "#f8fbff"
          : "#f2f8ff"
      : baseBackground;

  return {
    ...tableCellStyle,
    textAlign: options?.align ?? "left",
    background,
    borderBottom: "1px solid #dbe5ef",
    borderRight: options?.lastColumn ? "none" : "1px solid #e6eef5",
  };
}

function unitTableHeaderCellStyle(options?: {
  align?: React.CSSProperties["textAlign"];
  lastColumn?: boolean;
}): React.CSSProperties {
  return {
    ...tableCellStyle,
    textAlign: options?.align ?? "left",
    fontWeight: 700,
    color: "#0f172a",
    background: "#eef4fb",
    borderBottom: "1px solid #d8e3ee",
    borderRight: options?.lastColumn ? "none" : "1px solid #dbe5ef",
    whiteSpace: "nowrap",
  };
}

function nextExpenseRowId(): string {
  return `expense-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function OmCalculationPanel({
  mode = "property",
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
  const showPersistenceActions = mode === "property";
  const canCalculate = hasAuthoritativeOm || hasBrokerEmailNotes;
  const effectiveLabel = calculation
    ? `Using ${calculation.source.sourceLabel}`
    : hasAuthoritativeOm
      ? mode === "standalone"
        ? "Ready to refresh uploaded OM analysis"
        : "Ready to run against authoritative OM"
      : hasBrokerEmailNotes
        ? "Ready to run against saved broker notes"
        : mode === "standalone"
          ? "Upload OM PDF(s) to start the deal analysis workspace"
          : "Upload an OM/rent roll or save broker notes first";
  const unitModelRows = draft.unitModelRows ?? calculation?.unitModelRows ?? [];
  const expenseModelRows = draft.expenseModelRows ?? calculation?.expenseModelRows ?? [];
  const hasAggregateExpenseFallbackRow =
    expenseModelRows.length === 1 && expenseModelRows[0]?.lineItem === "Operating expenses";
  const showExpenseFallbackFields = expenseModelRows.length === 0 || hasAggregateExpenseFallbackRow;
  const visibleFieldGroups = FIELD_GROUPS.map((group) => {
    if (group.title !== "Operating") return group;
    return {
      ...group,
      fields: group.fields.filter((field) => {
        if (showExpenseFallbackFields) return true;
        return (
          field.key !== "expenseIncreasePct" &&
          field.key !== "annualExpenseGrowthPct" &&
          field.key !== "annualPropertyTaxGrowthPct"
        );
      }),
    };
  });
  const detailedFurnishingTotal = unitModelRows.reduce(
    (sum, row) => sum + (row.includeInUnderwriting === false ? 0 : row.furnishingCost ?? 0),
    0
  );
  const detailedOnboardingLaborTotal = unitModelRows.reduce((sum, row) => {
    const onboarding = resolvedOnboardingBreakdown(row);
    return sum + (row.includeInUnderwriting === false ? 0 : onboarding.labor ?? 0);
  }, 0);
  const detailedOnboardingOtherTotal = unitModelRows.reduce((sum, row) => {
    const onboarding = resolvedOnboardingBreakdown(row);
    return sum + (row.includeInUnderwriting === false ? 0 : onboarding.other ?? 0);
  }, 0);
  const detailedOnboardingTotal = unitModelRows.reduce(
    (sum, row) =>
      sum +
      (row.includeInUnderwriting === false ? 0 : resolvedOnboardingBreakdown(row).total ?? 0),
    0
  );
  const detailedRecurringOpexMonthlyTotal = unitModelRows.reduce(
    (sum, row) =>
      sum + (row.includeInUnderwriting === false ? 0 : resolvedMonthlyRecurringOpex(row) ?? 0),
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
  const sensitivityCards = (calculation?.sensitivities ?? []).filter(
    (sensitivity) => sensitivity.title !== "Expense Increase Sensitivity"
  );
  const propertyUnitsLabel = calculation
    ? [
        calculation.propertyInfo.totalUnits != null
          ? `${formatNumber(calculation.propertyInfo.totalUnits)} total`
          : null,
        calculation.propertyInfo.residentialUnits > 0
          ? `${formatNumber(calculation.propertyInfo.residentialUnits)} residential`
          : null,
        calculation.propertyInfo.commercialUnits > 0
          ? `${formatNumber(calculation.propertyInfo.commercialUnits)} commercial`
          : null,
        calculation.propertyInfo.rentStabilizedUnits > 0
          ? `${formatNumber(calculation.propertyInfo.rentStabilizedUnits)} RS / RC`
          : null,
      ]
        .filter(Boolean)
        .join(" / ") || "—"
    : "—";
  const purchasePricePerSqft =
    calculation?.assumptions.purchasePrice != null &&
    calculation.propertyInfo.sizeSqft != null &&
    calculation.propertyInfo.sizeSqft > 0
      ? calculation.assumptions.purchasePrice / calculation.propertyInfo.sizeSqft
      : null;
  const expectedNegotiatedPriceLabel = calculation
    ? [formatCurrency(calculation.assumptions.purchasePrice), purchasePricePerSqft != null ? `${formatCurrency(purchasePricePerSqft)} PSF` : null]
        .filter(Boolean)
        .join(" / ")
    : "—";
  const financingTermsLabel = calculation
    ? calculation.assumptions.ltvPct != null ||
      calculation.assumptions.interestRatePct != null ||
      calculation.assumptions.amortizationYears != null
      ? [
          calculation.assumptions.ltvPct != null
            ? `${formatPercent(calculation.assumptions.ltvPct)} LTV`
            : null,
          calculation.assumptions.interestRatePct != null
            ? `${formatPercent(calculation.assumptions.interestRatePct, 2)} rate`
            : null,
          calculation.assumptions.amortizationYears != null
            ? `${formatNumber(calculation.assumptions.amortizationYears)}-yr amort.`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
      : "—"
    : "—";
  const leveredCashFlowToEquitySeries = calculation?.yearlyCashFlow.cashFlowAfterFinancing ?? [];
  const equityValueCreationSeries =
    calculation?.yearlyCashFlow.cashFlowAfterFinancing.map((value, index) =>
      index === 0 ? 0 : (value ?? 0) + (calculation.yearlyCashFlow.principalPaid[index] ?? 0)
    ) ?? [];
  const dscrSeries =
    calculation?.yearlyCashFlow.cashFlowFromOperations.map((value, index) => {
      if (index === 0) return null;
      const debtService = calculation.yearlyCashFlow.debtService[index] ?? 0;
      if (!Number.isFinite(debtService) || Math.abs(debtService) < 0.005) return null;
      return (value ?? 0) / debtService;
    }) ?? [];
  const cashOnCashSeries =
    calculation?.yearlyCashFlow.noi.map((value, index) => {
      if (index === 0) return null;
      const initialEquityInvested = calculation.acquisition.initialEquityInvested ?? 0;
      if (!Number.isFinite(initialEquityInvested) || Math.abs(initialEquityInvested) < 0.005) {
        return null;
      }
      return ((value ?? 0) - (calculation.yearlyCashFlow.debtService[index] ?? 0)) / initialEquityInvested;
    }) ?? [];
  const projectedExpenseLineSeries = (
    yearlyAmounts: Array<number | null | undefined>
  ): Array<number | null> =>
    calculation?.yearlyCashFlow.years.map((year, index) =>
      index === 0 || year === 0 ? null : (yearlyAmounts[index - 1] ?? 0)
    ) ?? [];
  const rentBasisLabel = calculation
    ? calculation.currentFinancials.rentBasis === "gross_before_vacancy"
      ? "Gross before vacancy"
      : calculation.currentFinancials.rentBasis === "effective_after_vacancy"
        ? "Actual / effective after vacancy"
        : "Unknown"
    : "—";

  function updateUnitRow(rowId: string, patch: Partial<OmCalculationUnitModelRow>) {
    onUnitModelRowsChange(
      unitModelRows.map((row) => (row.rowId !== rowId ? row : normalizeUnitRow({ ...row, ...patch })))
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
        annualGrowthPct: showExpenseFallbackFields ? (draft.annualExpenseGrowthPct ?? null) : 0,
        treatment: "operating",
        isManagementLine: false,
      },
    ]);
  }

  function removeExpenseRow(rowId: string) {
    onExpenseModelRowsChange(expenseModelRows.filter((row) => row.rowId !== rowId));
  }

  function renderCashFlowSectionRow(label: string) {
    const yearLabels = calculation?.yearlyCashFlow.endingLabels ?? [];
    return (
      <tr key={label}>
        <td
          colSpan={yearLabels.length + 1}
          style={{
            ...tableCellStyle,
            fontWeight: 700,
            color: "#1e3a5f",
            background: "#edf4ff",
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </td>
      </tr>
    );
  }

  function renderCashFlowValueRow(
    label: string,
    values: Array<number | null | undefined>,
    options?: {
      blankZero?: boolean;
      bold?: boolean;
      highlight?: boolean;
      italic?: boolean;
      formatter?: (value: number | null | undefined, blankZero: boolean) => string;
    }
  ) {
    const yearLabels = calculation?.yearlyCashFlow.endingLabels ?? [];
    const background = options?.highlight ? "#f8fafc" : "#fff";
    const fontWeight = options?.bold ? 700 : 500;
    const fontStyle = options?.italic ? "italic" : "normal";
    return (
      <tr key={label}>
        <td
          style={{
            ...tableCellStyle,
            fontWeight,
            fontStyle,
            color: "#0f172a",
            background,
            minWidth: "240px",
          }}
        >
          {label}
        </td>
        {yearLabels.map((yearLabel, index) => (
          <td
            key={`${label}-${yearLabel}`}
            style={{
              ...tableCellStyle,
              textAlign: "right",
              fontWeight,
              fontStyle,
              color: cashFlowValueColor(values[index]),
              background,
              whiteSpace: "nowrap",
            }}
          >
            {(options?.formatter ?? formatCashFlowCellValue)(
              values[index],
              options?.blankZero ?? false
            )}
          </td>
        ))}
      </tr>
    );
  }

  function renderSensitivityCard(sensitivity: OmCalculationSensitivity) {
    const outputLabel =
      sensitivity.key === "exit_cap_rate" ? "Net sale to equity" : "Stabilized NOI";
    const baseScenario =
      sensitivity.scenarios.find((scenario) =>
        nearlyEqual(scenario.valuePct, sensitivity.baseCase.valuePct)
      ) ??
      (sensitivity.baseCase.valuePct == null
        ? null
        : sensitivity.scenarios.reduce<OmCalculationSensitivityScenario | null>((closest, scenario) => {
            if (closest == null) return scenario;
            return Math.abs(scenario.valuePct - sensitivity.baseCase.valuePct!) <
              Math.abs(closest.valuePct - sensitivity.baseCase.valuePct!)
              ? scenario
              : closest;
          }, null));
    return (
      <div
        key={sensitivity.key}
        style={{
          border: "1px solid #dbe2ea",
          borderRadius: "16px",
          padding: "1rem",
          background: "linear-gradient(180deg, #fcfdff 0%, #f8fbff 100%)",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.85rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "0.98rem" }}>{sensitivity.title}</div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0.18rem 0.5rem",
                  borderRadius: "999px",
                  background: "#dbeafe",
                  color: "#1d4ed8",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                }}
              >
                Base case highlighted
              </span>
            </div>
            <div style={{ marginTop: "0.22rem", fontSize: "0.76rem", color: "#64748b" }}>
              Base row stays highlighted below; negative values are shown in red.
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "0.76rem", color: "#475569" }}>
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

        <div
          style={{
            marginTop: "0.8rem",
            padding: "0.75rem",
            borderRadius: "12px",
            border: "1px solid #bfdbfe",
            background: "linear-gradient(180deg, #eff6ff 0%, #f8fbff 100%)",
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "0.55rem 0.7rem",
          }}
        >
          <div>
            <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", fontWeight: 700 }}>
              Base input
            </div>
            <div style={{ marginTop: "0.12rem", fontSize: "0.92rem", fontWeight: 700, color: "#0f172a" }}>
              {formatPercent(sensitivity.baseCase.valuePct, 1)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", fontWeight: 700 }}>
              Base IRR
            </div>
            <div style={{ marginTop: "0.12rem", fontSize: "0.92rem", fontWeight: 700, color: "#0f172a" }}>
              {formatRatioPercent(sensitivity.baseCase.irrPct, 1)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", fontWeight: 700 }}>
              Base equity yield
            </div>
            <div style={{ marginTop: "0.12rem", fontSize: "0.92rem", fontWeight: 700, color: "#0f172a" }}>
              {formatRatioPercent(
                sensitivity.baseCase.year1EquityYield ?? sensitivity.baseCase.year1CashOnCashReturn,
                1
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", fontWeight: 700 }}>
              Base {outputLabel}
            </div>
            <div style={{ marginTop: "0.12rem", fontSize: "0.92rem", fontWeight: 700, color: "#0f172a" }}>
              {formatCurrency(
                baseScenario == null
                  ? null
                  : sensitivity.key === "exit_cap_rate"
                    ? baseScenario.netProceedsToEquity
                    : baseScenario.stabilizedNoi
              )}
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: "0.8rem" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 0.32rem", fontSize: "0.78rem" }}>
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
              {sensitivity.scenarios.map((scenario) => {
                const isBaseRow = nearlyEqual(scenario.valuePct, sensitivity.baseCase.valuePct);
                const rowBackground = isBaseRow ? "#eff6ff" : "#ffffff";
                const rowBorderColor = isBaseRow ? "#93c5fd" : "#e2e8f0";
                return (
                  <tr key={`${sensitivity.key}-${scenario.valuePct}`}>
                    <td
                      style={{
                        ...tableCellStyle,
                        background: rowBackground,
                        borderTop: `1px solid ${rowBorderColor}`,
                        borderBottom: `1px solid ${rowBorderColor}`,
                        borderLeft: isBaseRow ? "4px solid #2563eb" : `1px solid ${rowBorderColor}`,
                        borderRight: `1px solid ${rowBorderColor}`,
                        borderTopLeftRadius: "10px",
                        borderBottomLeftRadius: "10px",
                        fontWeight: isBaseRow ? 700 : 600,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.45rem", alignItems: "center" }}>
                        <span>{formatPercent(scenario.valuePct, 1)}</span>
                        {isBaseRow ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "0.12rem 0.42rem",
                              borderRadius: "999px",
                              background: "#dbeafe",
                              color: "#1d4ed8",
                              fontSize: "0.68rem",
                              fontWeight: 700,
                            }}
                          >
                            Base
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      style={{
                        ...tableCellStyle,
                        textAlign: "right",
                        background: rowBackground,
                        color: sensitivityMetricTextColor(scenario.irrPct),
                        fontWeight: isBaseRow ? 700 : 600,
                        borderTop: `1px solid ${rowBorderColor}`,
                        borderBottom: `1px solid ${rowBorderColor}`,
                      }}
                    >
                      {formatRatioPercent(scenario.irrPct, 1)}
                    </td>
                    <td
                      style={{
                        ...tableCellStyle,
                        textAlign: "right",
                        background: rowBackground,
                        color: sensitivityMetricTextColor(
                          scenario.year1EquityYield ?? scenario.year1CashOnCashReturn
                        ),
                        fontWeight: isBaseRow ? 700 : 600,
                        borderTop: `1px solid ${rowBorderColor}`,
                        borderBottom: `1px solid ${rowBorderColor}`,
                      }}
                    >
                      {formatRatioPercent(
                        scenario.year1EquityYield ?? scenario.year1CashOnCashReturn,
                        1
                      )}
                    </td>
                    <td
                      style={{
                        ...tableCellStyle,
                        textAlign: "right",
                        background: rowBackground,
                        color: sensitivityMetricTextColor(
                          sensitivity.key === "exit_cap_rate"
                            ? scenario.netProceedsToEquity
                            : scenario.stabilizedNoi
                        ),
                        fontWeight: isBaseRow ? 700 : 600,
                        borderTop: `1px solid ${rowBorderColor}`,
                        borderBottom: `1px solid ${rowBorderColor}`,
                        borderRight: `1px solid ${rowBorderColor}`,
                        borderTopRightRadius: "10px",
                        borderBottomRightRadius: "10px",
                      }}
                    >
                      {formatCurrency(
                        sensitivity.key === "exit_cap_rate"
                          ? scenario.netProceedsToEquity
                          : scenario.stabilizedNoi
                      )}
                    </td>
                  </tr>
                );
              })}
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
            compact calculator, adjust unit and expense rows directly, then review the live deal overview,
            cash flow statement, sensitivities, and supporting assumptions that feed the dossier.
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
              {isDirty
                ? mode === "standalone"
                  ? "Unapplied underwriting edits"
                  : "Unsaved assumption edits"
                : mode === "standalone"
                  ? "Analysis synced"
                  : "Assumptions synced"}
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
            {running
              ? "Analyzing..."
              : mode === "standalone"
                ? calculation
                  ? "Refresh analysis"
                  : "Analyze uploaded OMs"
                : "Analyze OM"}
          </button>
          {showPersistenceActions ? (
            <>
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
            </>
          ) : null}
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
          {mode === "standalone"
            ? "Upload one or more OM PDFs and run analysis so this workspace can populate current state, unit-level underwriting rows, and dossier outputs."
            : "Upload an OM, build the authoritative OM, or save broker notes first so this workspace has a current revenue and expense base to analyze."}
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
              Use formula FF&E default
            </button>
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
              Formula FF&E default: {formatCurrency(formulaFurnishingSetupCosts ?? 0)}
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
            {visibleFieldGroups.map((group) => (
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
            {showExpenseFallbackFields
              ? null
              : "Expense amounts, step-ups, and growth now live in the expense model below. Management fee and occupancy tax stay here because they are projected overlays on revenue, not copied from the OM expense table."}
            {!showExpenseFallbackFields ? " " : ""}
            {mode === "standalone"
              ? "Adjust inputs here, then refresh analysis so the current state, sensitivities, and deal dossier all reflect the latest underwriting edits."
              : "Save assumptions when you want these inputs, unit edits, and expense edits to carry through to the generated deal dossier and Excel model."}
          </div>
        </div>
      </div>

      <div style={sectionCardStyle}>
        <div style={{ padding: "0.9rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
          <strong style={{ color: "#0f172a" }}>Per-unit monthly rent, FF&amp;E, onboarding, and OpEx</strong>
          <div style={{ marginTop: "0.22rem", fontSize: "0.75rem", color: "#64748b", lineHeight: 1.45 }}>
            Edit monthly gross rent by unit, then tune uplift, occupancy, FF&amp;E, onboarding labor,
            onboarding other, and recurring unit OpEx. Annual figures stay visible in smaller italic text.
          </div>
          <div style={{ marginTop: "0.3rem", fontSize: "0.78rem", color: "#0f172a", lineHeight: 1.5 }}>
            FF&amp;E: <strong>{formatCurrency(detailedFurnishingTotal)}</strong> • Onboarding:{" "}
            <strong>{formatCurrency(detailedOnboardingTotal)}</strong> • Rec. OpEx / mo:{" "}
            <strong>{formatCurrency(detailedRecurringOpexMonthlyTotal)}</strong> • Weighted occupancy:{" "}
            <strong>{formatPercent(weightedModeledOccupancyPct, 1)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: "1540px",
              borderCollapse: "collapse",
              fontSize: "0.76rem",
            }}
          >
            <thead>
              <tr>
                <th style={unitTableHeaderCellStyle()}>Unit</th>
                <th style={unitTableHeaderCellStyle()}>Mix</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>Current / mo</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>Base / mo</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>Uplift %</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>Occ. %</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>FF&amp;E</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>Labor</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>Other</th>
                <th style={unitTableHeaderCellStyle({ align: "right" })}>OpEx / mo</th>
                <th style={unitTableHeaderCellStyle({ align: "center" })}>Model</th>
                <th style={unitTableHeaderCellStyle({ align: "right", lastColumn: true })}>
                  Modeled / mo
                </th>
              </tr>
            </thead>
            <tbody>
              {unitModelRows.length > 0 ? (
                unitModelRows.map((row, rowIndex) => {
                  const boostedGrossAnnualRent = projectedBoostedAnnualRent(row);

                  return (
                    <tr key={row.rowId}>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { pinned: true })}>
                        <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "0.74rem" }}>{row.unitLabel}</div>
                        <div style={unitTableSubtextStyle}>
                          {[row.tenantStatus, row.notes].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { pinned: true })}>
                        <div style={{ fontSize: "0.73rem" }}>{row.unitCategory ?? "—"}</div>
                        <div style={unitTableSubtextStyle}>
                          {[row.beds != null ? `${formatNumber(row.beds)}Br` : null, row.baths != null ? `${row.baths}Ba` : null, row.sqft != null ? `${formatNumber(row.sqft)} SF` : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                        <div style={{ ...unitTableSubtextStyle, lineHeight: 1.2 }}>
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
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <div>{formatCurrency(monthlyFromAnnual(row.currentAnnualRent))}</div>
                        <div style={unitTableAnnualValueStyle}>
                          {formatCurrency(row.currentAnnualRent)} / yr
                        </div>
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          value={displayMonthlyInputValue(row.underwrittenAnnualRent)}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              underwrittenAnnualRent:
                                event.target.value === "" ? null : annualFromMonthly(Number(event.target.value)),
                            })
                          }
                          style={tableInputStyle("98px")}
                        />
                        <div style={unitTableAnnualValueStyle}>
                          {formatCurrency(row.underwrittenAnnualRent)} / yr
                        </div>
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="0.1"
                          value={row.rentUpliftPct ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              rentUpliftPct: event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          style={tableInputStyle("74px")}
                        />
                        <div style={unitTableComputedLabelStyle}>Boosted gross</div>
                        <div style={unitTableComputedValueStyle}>
                          {formatCurrency(monthlyFromAnnual(boostedGrossAnnualRent))} / mo
                        </div>
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="0.1"
                          value={row.occupancyPct ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              occupancyPct: event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          style={tableInputStyle("74px")}
                        />
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="100"
                          value={row.furnishingCost ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              furnishingCost: event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          style={tableInputStyle("92px")}
                        />
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="100"
                          value={resolvedOnboardingBreakdown(row).labor ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              onboardingLaborFee:
                                event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          style={tableInputStyle("86px")}
                        />
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="100"
                          value={resolvedOnboardingBreakdown(row).other ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              onboardingOtherCosts:
                                event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          style={tableInputStyle("86px")}
                        />
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="10"
                          value={resolvedMonthlyRecurringOpex(row) ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              monthlyRecurringOpex:
                                event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          style={tableInputStyle("86px")}
                        />
                      </td>
                      <td style={unitTableCellStyleForRow(row, rowIndex, { align: "center" })}>
                        <input
                          type="checkbox"
                          checked={row.includeInUnderwriting}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, { includeInUnderwriting: event.target.checked })
                          }
                        />
                      </td>
                      <td
                        style={unitTableCellStyleForRow(row, rowIndex, {
                          align: "right",
                          metric: true,
                          lastColumn: true,
                        })}
                      >
                        <div style={{ fontWeight: 600 }}>{formatCurrency(monthlyFromAnnual(row.modeledAnnualRent))}</div>
                        <div style={unitTableAnnualValueStyle}>
                          {formatCurrency(row.modeledAnnualRent)} / yr
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} style={{ ...tableCellStyle, color: "#64748b" }}>
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
              Expense rows are authoritative for expense amounts and growth. Use <strong>Replace with mgmt fee</strong>{" "}
              when the OM already includes management so the model does not double count it, and use <strong>Exclude</strong>{" "}
              for legacy LTR line items you want to add back or remove from the furnished / MTR case.
            </div>
            <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "#64748b", lineHeight: 1.45 }}>
              Projected <strong>management fee</strong> and <strong>occupancy tax</strong> still come from the
              operating assumptions above, even if those lines are missing from the current OM expenses.
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
                              event.target.value === "" ? 0 : Number(event.target.value),
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
        <div style={sectionCardStyle}>
          <div
            style={{
              padding: "0.95rem 1rem",
              borderBottom: "1px solid #e2e8f0",
              background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
            }}
          >
            <strong style={{ color: "#0f172a" }}>Calculated financials</strong>
            <div style={{ marginTop: "0.22rem", fontSize: "0.82rem", color: "#64748b", lineHeight: 1.5 }}>
              This is the live deal dossier view generated from the latest OM analysis, unit-level edits,
              and underwriting assumptions.
            </div>
          </div>

          <div style={{ padding: "1rem", display: "grid", gap: "1rem" }}>
            <div
              style={{
                padding: "1.1rem 1.15rem",
                borderRadius: "18px",
                border: "1px solid #dbeafe",
                background:
                  "radial-gradient(circle at top right, rgba(191, 219, 254, 0.42), transparent 32%), linear-gradient(135deg, #eff6ff 0%, #ffffff 78%)",
                display: "grid",
                gap: "0.5rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#475569",
                }}
              >
                Live dossier preview
              </div>
              <div style={{ fontSize: "clamp(1.35rem, 2vw, 2.05rem)", fontWeight: 700, color: "#0f172a" }}>
                {calculation.property.canonicalAddress}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0.3rem 0.62rem",
                    borderRadius: "999px",
                    background: "#dbeafe",
                    color: "#1d4ed8",
                    fontSize: "0.76rem",
                    fontWeight: 700,
                  }}
                >
                  {calculation.source.sourceLabel}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0.3rem 0.62rem",
                    borderRadius: "999px",
                    background: "#f8fafc",
                    color: "#334155",
                    fontSize: "0.76rem",
                    fontWeight: 600,
                  }}
                >
                  {calculation.property.city ?? "City unavailable"}
                </span>
                {calculation.property.askingPrice != null ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "0.3rem 0.62rem",
                      borderRadius: "999px",
                      background: "#ecfdf5",
                      color: "#166534",
                      fontSize: "0.76rem",
                      fontWeight: 700,
                    }}
                  >
                    Ask {formatCurrency(calculation.property.askingPrice)}
                  </span>
                ) : null}
              </div>
            </div>

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

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <div
                  style={{
                    fontSize: "0.76rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  Deal overview
                </div>
                <div style={{ marginTop: "0.2rem", fontSize: "0.83rem", color: "#64748b", lineHeight: 1.5 }}>
                  Front-page property, acquisition, rent mix, and return outputs from the latest OM run.
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "0.9rem",
                }}
              >
                {metricCard("Property info", [
                  { label: "Asset class", value: calculation.propertyInfo.assetClass ?? "—" },
                  {
                    label: "Size",
                    value:
                      calculation.propertyInfo.sizeSqft != null
                        ? `${formatNumber(calculation.propertyInfo.sizeSqft)} SF`
                        : "—",
                  },
                  { label: "Existing units", value: propertyUnitsLabel },
                  { label: "Year built", value: calculation.propertyInfo.yearBuilt ?? "—" },
                  { label: "Tax code", value: calculation.propertyInfo.taxCode ?? "—" },
                  { label: "Zoning district", value: calculation.propertyInfo.zoningDistrict ?? "—" },
                ])}
                {metricCard("Acquisition info", [
                  {
                    label: "Investment profile",
                    value:
                      (calculation.acquisitionMetadata.investmentProfile ?? draft.investmentProfile) ||
                      "—",
                  },
                  {
                    label: "Target acquisition date",
                    value: formatDateLabel(
                      calculation.acquisitionMetadata.targetAcquisitionDate ?? draft.targetAcquisitionDate
                    ),
                  },
                  { label: "Listed price", value: formatCurrency(calculation.property.askingPrice) },
                  { label: "Expected negotiated price", value: expectedNegotiatedPriceLabel },
                  {
                    label: "Source",
                    value: calculation.source.sourceLabel,
                  },
                  {
                    label: "Listed date",
                    value: formatDateLabel(calculation.property.listedAt),
                  },
                ])}
                {metricCard("Key financials", [
                  { label: "Current rent", value: formatCurrency(calculation.topLineMetrics.currentRent) },
                  {
                    label: "Current expenses",
                    value: formatCurrency(calculation.topLineMetrics.currentExpenses),
                  },
                  { label: "Current NOI", value: formatCurrency(calculation.topLineMetrics.currentNoi) },
                  {
                    label: "Current cap rate",
                    value: formatPercent(calculation.topLineMetrics.currentCapRatePct, 1),
                  },
                  {
                    label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} rent`,
                    value: formatCurrency(calculation.topLineMetrics.projectedYearRent),
                  },
                  {
                    label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} expenses`,
                    value: formatCurrency(calculation.topLineMetrics.projectedYearExpenses),
                  },
                  {
                    label: `Projected Y${calculation.topLineMetrics.projectedYearNumber} NOI`,
                    value: formatCurrency(calculation.topLineMetrics.projectedYearNoi),
                  },
                  {
                    label: "Increase in stabilized NOI",
                    value: formatPercent(calculation.topLineMetrics.stabilizedNoiIncreasePct, 1),
                  },
                ])}
                {metricCard("Expected returns", [
                  { label: "Upfront CapEx", value: formatCurrency(calculation.topLineMetrics.upfrontCapex) },
                  { label: "Financing terms", value: financingTermsLabel },
                  {
                    label: "Annual debt service",
                    value: formatCurrency(calculation.topLineMetrics.annualDebtService),
                  },
                  {
                    label: "Target hold period",
                    value:
                      calculation.topLineMetrics.holdPeriodYears != null
                        ? `${formatNumber(calculation.topLineMetrics.holdPeriodYears)} years`
                        : "—",
                  },
                  {
                    label: "Projected IRR",
                    value: formatRatioPercent(calculation.topLineMetrics.irrPct, 1),
                  },
                  {
                    label: "Projected CoC",
                    value: formatRatioPercent(calculation.topLineMetrics.averageCashOnCashReturn, 1),
                  },
                  {
                    label: "Year 1 equity yield",
                    value: formatRatioPercent(calculation.topLineMetrics.year1EquityYield, 1),
                  },
                  {
                    label: "Projected EMx",
                    value: formatMultiple(calculation.topLineMetrics.equityMultiple),
                  },
                ])}
                {metricCard("Revenue mix", [
                  {
                    label: "Current FM residential",
                    value: formatCurrency(calculation.rentBreakdown.current.freeMarketResidential),
                  },
                  {
                    label: "Current RS / RC residential",
                    value: formatCurrency(calculation.rentBreakdown.current.protectedResidential),
                  },
                  {
                    label: "Current commercial",
                    value: formatCurrency(calculation.rentBreakdown.current.commercial),
                  },
                  {
                    label: `Stabilized FM residential (Y${calculation.rentBreakdown.stabilizedYearNumber})`,
                    value: formatCurrency(calculation.rentBreakdown.stabilized.freeMarketResidential),
                  },
                  {
                    label: `Stabilized RS / RC (Y${calculation.rentBreakdown.stabilizedYearNumber})`,
                    value: formatCurrency(calculation.rentBreakdown.stabilized.protectedResidential),
                  },
                  {
                    label: `Stabilized commercial (Y${calculation.rentBreakdown.stabilizedYearNumber})`,
                    value: formatCurrency(calculation.rentBreakdown.stabilized.commercial),
                  },
                  {
                    label: "FM residential lift",
                    value: formatCurrency(calculation.rentBreakdown.freeMarketResidentialLift),
                  },
                  {
                    label: "Total gross rent lift",
                    value: formatCurrency(calculation.rentBreakdown.totalLift),
                  },
                ])}
                {metricCard("Recommended offer", [
                  { label: "Asking price", value: formatCurrency(calculation.recommendedOffer.askingPrice) },
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
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <div
                  style={{
                    fontSize: "0.76rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  Cash flow statement
                </div>
                <div style={{ marginTop: "0.2rem", fontSize: "0.83rem", color: "#64748b", lineHeight: 1.5 }}>
                  Annual roll-forward of rent, expenses, NOI, financing, and sale proceeds from the current
                  OM baseline through the modeled hold.
                </div>
              </div>
              <div style={sectionCardStyle}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                    <thead style={{ background: "#f8fafc" }}>
                      <tr>
                        <th style={{ ...tableCellStyle, textAlign: "left", fontWeight: 700, minWidth: "240px" }}>
                          Line item
                        </th>
                        {calculation.yearlyCashFlow.endingLabels.map((label) => (
                          <th
                            key={label}
                            style={{ ...tableCellStyle, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {renderCashFlowSectionRow("Acquisition & capitalization")}
                      {renderCashFlowValueRow(
                        "Purchase price",
                        calculation.yearlyCashFlow.endingLabels.map((_, index) =>
                          index === 0 && calculation.assumptions.purchasePrice != null
                            ? -Math.max(0, calculation.assumptions.purchasePrice)
                            : null
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Purchase closing costs",
                        calculation.yearlyCashFlow.endingLabels.map((_, index) =>
                          index === 0 && calculation.topLineMetrics.purchaseClosingCosts != null
                            ? -Math.max(0, calculation.topLineMetrics.purchaseClosingCosts)
                            : null
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Renovation costs",
                        calculation.yearlyCashFlow.endingLabels.map((_, index) =>
                          index === 0 && calculation.assumptions.renovationCosts != null
                            ? -Math.max(0, calculation.assumptions.renovationCosts)
                            : null
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Furnishing / setup costs",
                        calculation.yearlyCashFlow.endingLabels.map((_, index) =>
                          index === 0 && calculation.topLineMetrics.upfrontCapex != null
                            ? -Math.max(0, calculation.topLineMetrics.upfrontCapex)
                            : null
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Financing fees",
                        calculation.yearlyCashFlow.endingLabels.map((_, index) =>
                          index === 0 && calculation.topLineMetrics.financingFees != null
                            ? -Math.max(0, calculation.topLineMetrics.financingFees)
                            : null
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Total cash uses incl. financing fees",
                        calculation.yearlyCashFlow.totalInvestmentCost,
                        { blankZero: true, bold: true, highlight: true }
                      )}
                      {renderCashFlowValueRow(
                        "Loan proceeds / leverage",
                        calculation.yearlyCashFlow.financingFunding,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Net equity invested",
                        calculation.yearlyCashFlow.endingLabels.map((_, index) =>
                          index === 0 ? calculation.yearlyCashFlow.leveredCashFlow[index] : null
                        ),
                        { blankZero: true, bold: true, highlight: true }
                      )}

                      {renderCashFlowSectionRow("Operating cash flow")}
                      {renderCashFlowValueRow(
                        "Gross rental income",
                        calculation.yearlyCashFlow.grossRentalIncome,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Free-market residential",
                        calculation.yearlyCashFlow.freeMarketResidentialGrossRentalIncome,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "RS / RC residential",
                        calculation.yearlyCashFlow.protectedResidentialGrossRentalIncome,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Commercial gross",
                        calculation.yearlyCashFlow.commercialGrossRentalIncome,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Other income",
                        calculation.yearlyCashFlow.otherIncome,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Vacancy loss",
                        calculation.yearlyCashFlow.vacancyLoss.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Lead time loss",
                        calculation.yearlyCashFlow.leadTimeLoss.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Net rental income",
                        calculation.yearlyCashFlow.netRentalIncome,
                        { blankZero: true, bold: true }
                      )}
                      {calculation.yearlyCashFlow.expenseLineItems.map((row) =>
                        renderCashFlowValueRow(
                          row.lineItem,
                          projectedExpenseLineSeries(row.yearlyAmounts).map((value) =>
                            value != null ? -Math.abs(value) : value
                          ),
                          { blankZero: true }
                        )
                      )}
                      {renderCashFlowValueRow(
                        "Management fee",
                        calculation.yearlyCashFlow.managementFee.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Total operating expenses",
                        calculation.yearlyCashFlow.totalOperatingExpenses.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true, bold: true, highlight: true }
                      )}
                      {renderCashFlowValueRow(
                        "Net operating income (NOI)",
                        calculation.yearlyCashFlow.noi,
                        { blankZero: true, bold: true }
                      )}
                      {renderCashFlowValueRow(
                        "Recurring CapEx / reserve",
                        calculation.yearlyCashFlow.recurringCapex.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Unlevered CF after reserves",
                        calculation.yearlyCashFlow.cashFlowFromOperations,
                        { blankZero: true, bold: true, highlight: true }
                      )}

                      {renderCashFlowSectionRow("Debt & financing")}
                      {renderCashFlowValueRow(
                        "Interest expense",
                        calculation.yearlyCashFlow.interestPaid.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Principal paydown (equity build)",
                        calculation.yearlyCashFlow.principalPaid,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Debt service",
                        calculation.yearlyCashFlow.debtService.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Ending loan balance",
                        calculation.yearlyCashFlow.remainingLoanBalance,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Levered CF to equity",
                        leveredCashFlowToEquitySeries,
                        { blankZero: true, bold: true, highlight: true }
                      )}
                      {renderCashFlowValueRow(
                        "Equity value creation incl. principal paydown (memo only)",
                        equityValueCreationSeries,
                        { blankZero: true, italic: true }
                      )}
                      {renderCashFlowValueRow(
                        "DSCR (after reserves)",
                        dscrSeries,
                        {
                          formatter: (value, blankZero) =>
                            formatCashFlowMultipleValue(value, blankZero, 2),
                        }
                      )}
                      {renderCashFlowValueRow(
                        "Cash-on-cash return",
                        cashOnCashSeries,
                        {
                          formatter: (value, blankZero) =>
                            formatCashFlowRatioPercentValue(value, blankZero, 1),
                        }
                      )}

                      {renderCashFlowSectionRow("Exit waterfall")}
                      {renderCashFlowValueRow(
                        "Gross sale proceeds",
                        calculation.yearlyCashFlow.saleValue,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Less: sale closing costs / fees",
                        calculation.yearlyCashFlow.saleClosingCosts.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {Array.isArray(calculation.yearlyCashFlow.reserveRelease) &&
                      calculation.yearlyCashFlow.reserveRelease.some(
                        (value) => Math.abs(value ?? 0) > 0.005
                      )
                        ? renderCashFlowValueRow(
                            "Reserve release at exit",
                            calculation.yearlyCashFlow.reserveRelease,
                            { blankZero: true }
                          )
                        : null}
                      {renderCashFlowValueRow(
                        "NSP before debt payoff",
                        calculation.yearlyCashFlow.netSaleProceedsBeforeDebtPayoff,
                        { blankZero: true, bold: true }
                      )}
                      {renderCashFlowValueRow(
                        "Less: remaining loan balance",
                        calculation.yearlyCashFlow.financingPayoff.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Net sale proceeds to equity",
                        calculation.yearlyCashFlow.netSaleProceedsToEquity,
                        { blankZero: true, bold: true }
                      )}
                      {renderCashFlowValueRow(
                        "Total levered CF incl. exit",
                        calculation.yearlyCashFlow.leveredCashFlow,
                        { blankZero: true, bold: true, highlight: true }
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <div
                  style={{
                    fontSize: "0.76rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  Sensitivity analyses
                </div>
                <div style={{ marginTop: "0.2rem", fontSize: "0.83rem", color: "#64748b", lineHeight: 1.5 }}>
                  Primary scenario sweeps behind the deal dossier, with the base row highlighted and negative
                  outcomes called out in red.
                </div>
              </div>
              <div style={sectionCardStyle}>
                <div
                  style={{
                    padding: "1rem",
                    display: "grid",
                    gridTemplateColumns:
                      sensitivityCards.length > 1 ? "repeat(auto-fit, minmax(340px, 1fr))" : "1fr",
                    gap: "0.9rem",
                    maxWidth: "none",
                    margin: "0 auto",
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
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <div
                  style={{
                    fontSize: "0.76rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  Assumptions
                </div>
                <div style={{ marginTop: "0.2rem", fontSize: "0.83rem", color: "#64748b", lineHeight: 1.5 }}>
                  Source tables and resolved underwriting inputs feeding this live dossier view and the PDF
                  export below.
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gap: "0.9rem",
                }}
              >
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
                        formatDateLabel(
                          calculation.acquisitionMetadata.targetAcquisitionDate ?? draft.targetAcquisitionDate
                        )
                      )}
                      {summaryRow("Modeled purchase price", formatCurrency(calculation.assumptions.purchasePrice))}
                      {summaryRow("Closing costs", formatPercent(calculation.assumptions.purchaseClosingCostPct))}
                      {summaryRow("LTV / rate / amort.", financingTermsLabel)}
                      {summaryRow("Default rent uplift", formatPercent(calculation.assumptions.rentUpliftPct))}
                      {summaryRow("Effective blended uplift", formatPercent(calculation.assumptions.blendedRentUpliftPct))}
                      {showExpenseFallbackFields
                        ? summaryRow("Expense step-up", formatPercent(calculation.assumptions.expenseIncreasePct))
                        : null}
                      {summaryRow(
                        "Mgmt / occupancy tax",
                        calculation.assumptions.managementFeePct != null ||
                          calculation.assumptions.occupancyTaxPct != null
                          ? `${formatPercent(calculation.assumptions.managementFeePct)} / ${formatPercent(calculation.assumptions.occupancyTaxPct)}`
                          : "—"
                      )}
                      {summaryRow(
                        "Unit FF&E / onboarding",
                        `${formatCurrency(calculation.assumptions.furnishingSetupCosts)} / ${formatCurrency(calculation.assumptions.onboardingCosts)}`
                      )}
                      {summaryRow(
                        "Onboarding labor / other",
                        `${formatCurrency(detailedOnboardingLaborTotal)} / ${formatCurrency(detailedOnboardingOtherTotal)}`
                      )}
                      {summaryRow(
                        "Recurring unit OpEx / mo",
                        formatCurrency(detailedRecurringOpexMonthlyTotal)
                      )}
                      {summaryRow("Weighted modeled occupancy", formatPercent(weightedModeledOccupancyPct, 1))}
                      {summaryRow(
                        "Fallback vacancy / lead time",
                        calculation.assumptions.vacancyPct != null || calculation.assumptions.leadTimeMonths != null
                          ? `${formatPercent(calculation.assumptions.vacancyPct)} / ${formatNumber(calculation.assumptions.leadTimeMonths)} mo`
                          : "—"
                      )}
                      {summaryRow(
                        "Annual FM / commercial growth",
                        calculation.assumptions.annualRentGrowthPct != null ||
                          calculation.assumptions.annualCommercialRentGrowthPct != null
                          ? `FM ${formatPercent(calculation.assumptions.annualRentGrowthPct)} / Comm ${formatPercent(calculation.assumptions.annualCommercialRentGrowthPct)}`
                          : "—"
                      )}
                      {showExpenseFallbackFields
                        ? summaryRow(
                            "Annual other-income / expense growth",
                            calculation.assumptions.annualOtherIncomeGrowthPct != null ||
                              calculation.assumptions.annualExpenseGrowthPct != null
                              ? `Other ${formatPercent(calculation.assumptions.annualOtherIncomeGrowthPct)} / Expense ${formatPercent(calculation.assumptions.annualExpenseGrowthPct)}`
                              : "—"
                          )
                        : summaryRow(
                            "Annual other-income growth",
                            formatPercent(calculation.assumptions.annualOtherIncomeGrowthPct)
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
                        Extracted baseline income, rent basis, and expense context before stabilization is applied.
                      </div>
                    </div>
                    <div style={{ padding: "0 1rem 0.4rem" }}>
                      {summaryRow("Source", calculation.source.sourceLabel)}
                      {summaryRow("Detected rent basis", rentBasisLabel)}
                      {summaryRow(
                        "Assumed LTR occupancy",
                        formatPercent(calculation.currentFinancials.assumedLongTermOccupancyPct, 1)
                      )}
                      {summaryRow(
                        "Gross rental income",
                        formatCurrency(calculation.currentFinancials.grossRentalIncome)
                      )}
                      {summaryRow(
                        "Other income",
                        formatCurrency(calculation.currentFinancials.otherIncome)
                      )}
                      {summaryRow(
                        "Vacancy / collection loss",
                        formatCurrency(calculation.currentFinancials.vacancyLoss)
                      )}
                      {summaryRow(
                        "Effective gross income",
                        formatCurrency(calculation.currentFinancials.effectiveGrossIncome)
                      )}
                      {summaryRow(
                        "Operating expenses",
                        formatCurrency(calculation.currentFinancials.operatingExpenses)
                      )}
                      {summaryRow("Current NOI", formatCurrency(calculation.currentFinancials.noi))}
                      {summaryRow(
                        "Expense ratio",
                        formatPercent(calculation.currentFinancials.expenseRatioPct, 1)
                      )}
                      {summaryRow(
                        "Adjusted opex ex mgmt",
                        formatCurrency(calculation.operating.adjustedOperatingExpenses)
                      )}
                      {summaryRow(
                        "Modeled management fee",
                        formatCurrency(calculation.operating.managementFeeAmount)
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
                      <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "#64748b" }}>
                        OM-extracted unit rows feeding the monthly underwriting table above.
                      </div>
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
                                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                  {formatCurrency(row.monthlyRent)}
                                </td>
                                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                  {formatCurrency(
                                    row.annualRent ?? (row.monthlyRent != null ? row.monthlyRent * 12 : null)
                                  )}
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
                      <div style={{ marginTop: "0.2rem", fontSize: "0.78rem", color: "#64748b" }}>
                        Raw OM expense lines before any model treatments, exclusions, or replacement logic.
                      </div>
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
                                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                  {formatCurrency(row.amount)}
                                </td>
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
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: "#64748b", fontSize: "0.92rem" }}>
          Analyze the OM to populate the underwriting outputs, sensitivities, and cash flow records.
        </div>
      )}
    </div>
  );
}
