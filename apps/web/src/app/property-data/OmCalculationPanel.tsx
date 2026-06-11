"use client";

import type {
  PropertyDealDossierAssumptions,
  PropertyDealDossierExpenseTreatment,
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierUnitModelRow,
} from "@re-sourcing/contracts";
import {
  Activity,
  Building2,
  Calculator,
  FileSpreadsheet,
  LayoutDashboard,
  ListChecks,
  ReceiptText,
  SlidersHorizontal,
  TableProperties,
} from "lucide-react";
import { Badge, Button, EmptyState, Panel, SkeletonRows } from "@/components/ui";
import { cx } from "@/components/ui/utils";
import { formatPercent } from "@/lib/format";
import styles from "./omCalc.module.css";

export const OM_CALC_NUMERIC_FIELDS = [
  "buildingSqft",
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
  "currentNoi",
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
  buildingSqft: number | null;
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
  currentNoi: number | null;
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
  savedAssumptions: PropertyDealDossierAssumptions | null;
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
    extractedNoi: number | null;
    isNoiOverridden: boolean;
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
    irrNullReason?: "no_sign_change" | "did_not_converge" | null;
    averageCashOnCashReturn: number | null;
    year1CashOnCashReturn: number | null;
    year1EquityYield: number | null;
    equityMultiple: number | null;
  };
  currentNoiOverridden?: boolean;
  yieldSignals?: {
    ltrYieldPct: number | null;
    mtrYieldPct: number | null;
    spreadPctPoints: number | null;
    minHealthySpreadPctPoints: number;
    calloutCode: "mtr_below_ltr" | "mtr_weak_uplift" | "mtr_spread_outlier" | null;
    calloutLabel: string | null;
  } | null;
  brokerYieldComparison?: {
    brokerNoi: number | null;
    brokerCapRatePct: number | null;
    brokerCapRateSource: "om_stated" | "implied_from_broker_noi" | null;
    reconstructedNoi: number | null;
    reconstructedCapRatePct: number | null;
    deltaPctPoints: number | null;
    minFlagDeltaPctPoints: number;
    calloutCode: "broker_cap_above_reconstructed" | "broker_cap_below_reconstructed" | null;
    calloutLabel: string | null;
  } | null;
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
    title: "Property",
    fields: [
      { key: "buildingSqft", label: "Manual building SF", step: 100, suffix: "SF" },
    ],
  },
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

function isNegativeCashFlowValue(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value < -0.004;
}

function sensitivityRangeLabel(range: OmCalculationSensitivityRange | null | undefined): string {
  if (!range || range.min == null || range.max == null) return "—";
  return `${formatRatioPercent(range.min, 1)} to ${formatRatioPercent(range.max, 1)}`;
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined, tolerance = 0.0001): boolean {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

function isNegativeSensitivityMetric(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value < 0;
}

function formatDraftValue(draft: OmCalculationDraft, field: FieldConfig): string {
  const value = draft[field.key];
  return value == null ? "" : String(value);
}

function summaryRow(label: string, value: string) {
  return (
    <div key={label} className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <strong className={styles.summaryValue}>{value}</strong>
    </div>
  );
}

function metricCard(title: string, rows: Array<{ label: string; value: string }>) {
  return (
    <div key={title} className={styles.metricCard}>
      <div className={cx(styles.kicker, styles.metricCardTitle)}>{title}</div>
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
    <label className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{field.label}</span>
      <div className={styles.fieldControl}>
        {field.prefix ? (
          <span className={cx(styles.fieldAffix, styles.fieldAffixLeft)}>{field.prefix}</span>
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
          className={styles.fieldBareInput}
        />
        {field.suffix ? (
          <span className={cx(styles.fieldAffix, styles.fieldAffixRight)}>{field.suffix}</span>
        ) : null}
      </div>
    </label>
  );
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

function unitTableRowToneClass(row: OmCalculationUnitModelRow, rowIndex: number): string {
  if (row.includeInUnderwriting === false) return styles.uToneExcluded;
  return rowIndex % 2 === 0 ? styles.uToneEven : styles.uToneOdd;
}

function unitTableCellClassForRow(
  row: OmCalculationUnitModelRow,
  rowIndex: number,
  options?: {
    align?: "right" | "center";
    pinned?: boolean;
    metric?: boolean;
    lastColumn?: boolean;
  }
): string {
  const baseTone = unitTableRowToneClass(row, rowIndex);
  // Branches mirror the legacy background ladder. The token palette has a
  // single blue-soft, so the legacy even/odd zebra nuance inside pinned
  // columns (and the three excluded grey variants) collapse onto the shared
  // tone classes (see omCalc.module.css).
  const tone = options?.metric
    ? row.includeInUnderwriting === false
      ? styles.uToneExcluded
      : styles.uToneMetric
    : options?.pinned
      ? row.includeInUnderwriting === false
        ? styles.uToneExcluded
        : styles.uTonePinned
      : baseTone;

  return cx(
    styles.uCell,
    tone,
    options?.align === "right" && styles.uCellRight,
    options?.align === "center" && styles.uCellCenter,
    options?.lastColumn && styles.uCellLast
  );
}

function unitTableHeaderCellClass(options?: {
  align?: "right" | "center";
  lastColumn?: boolean;
}): string {
  return cx(
    styles.uTh,
    options?.align === "right" && styles.uThRight,
    options?.align === "center" && styles.uThCenter,
    options?.lastColumn && styles.uThLast
  );
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
  const pulledCurrentNoi =
    calculation?.currentFinancials.extractedNoi ?? calculation?.currentFinancials.noi ?? null;
  const appliedCurrentNoi = calculation?.currentFinancials.noi ?? pulledCurrentNoi;
  const appliedHoldPeriodYears = calculation?.topLineMetrics.holdPeriodYears ?? null;
  const hasCurrentNoiOverrideApplied =
    draft.currentNoi != null || calculation?.currentFinancials.isNoiOverridden === true;
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
        <td colSpan={yearLabels.length + 1} className={styles.cfSection}>
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
      indent?: boolean;
      topRule?: boolean;
      bottomRule?: boolean;
      doubleTopRule?: boolean;
      formatter?: (value: number | null | undefined, blankZero: boolean) => string;
    }
  ) {
    const yearLabels = calculation?.yearlyCashFlow.endingLabels ?? [];
    // Every legacy style branch becomes a class toggle on the shared cell.
    const ruleClasses = cx(
      options?.doubleTopRule ? styles.cfDoubleTopRule : options?.topRule && styles.cfTopRule,
      options?.bottomRule && styles.cfBottomRule
    );
    const emphasisClasses = cx(
      options?.bold && styles.cfBold,
      options?.italic && styles.cfItalic,
      options?.highlight && styles.cfHighlight
    );
    return (
      <tr key={label}>
        <td
          className={cx(
            styles.cfCell,
            styles.cfLabel,
            ruleClasses,
            emphasisClasses,
            options?.indent && styles.cfIndent
          )}
        >
          {label}
        </td>
        {yearLabels.map((yearLabel, index) => (
          <td
            key={`${label}-${yearLabel}`}
            className={cx(
              styles.cfCell,
              styles.cfNum,
              ruleClasses,
              emphasisClasses,
              isNegativeCashFlowValue(values[index]) && styles.negative
            )}
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
      <div key={sensitivity.key} className={styles.sensCard}>
        <div className={styles.sensHead}>
          <div>
            <div className={styles.sensTitleRow}>
              <div className={styles.sensTitle}>{sensitivity.title}</div>
              <Badge tone="info">Base case highlighted</Badge>
            </div>
            <div className={styles.sensNote}>
              Base row stays highlighted below; negative values are shown in red.
            </div>
          </div>
          <div className={styles.sensRanges}>
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

        <div className={styles.sensBaseGrid}>
          <div>
            <div className={styles.sensBaseKicker}>Base input</div>
            <div className={styles.sensBaseValue}>
              {formatPercent(sensitivity.baseCase.valuePct, 1)}
            </div>
          </div>
          <div>
            <div className={styles.sensBaseKicker}>Base IRR</div>
            <div className={styles.sensBaseValue}>
              {formatRatioPercent(sensitivity.baseCase.irrPct, 1)}
            </div>
          </div>
          <div>
            <div className={styles.sensBaseKicker}>Base equity yield</div>
            <div className={styles.sensBaseValue}>
              {formatRatioPercent(
                sensitivity.baseCase.year1EquityYield ?? sensitivity.baseCase.year1CashOnCashReturn,
                1
              )}
            </div>
          </div>
          <div>
            <div className={styles.sensBaseKicker}>Base {outputLabel}</div>
            <div className={styles.sensBaseValue}>
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

        <div className={styles.sensTableWrap}>
          <table className={styles.sensTable}>
            <thead className={styles.theadRaised}>
              <tr>
                <th className={styles.th}>{sensitivity.inputLabel}</th>
                <th className={cx(styles.th, styles.thRight)}>IRR</th>
                <th className={cx(styles.th, styles.thRight)}>Equity yield</th>
                <th className={cx(styles.th, styles.thRight)}>{outputLabel}</th>
              </tr>
            </thead>
            <tbody>
              {sensitivity.scenarios.map((scenario) => {
                const isBaseRow = nearlyEqual(scenario.valuePct, sensitivity.baseCase.valuePct);
                const baseRowClass = isBaseRow ? styles.sensCellBase : undefined;
                return (
                  <tr key={`${sensitivity.key}-${scenario.valuePct}`}>
                    <td
                      className={cx(
                        styles.sensCell,
                        styles.sensCellFirst,
                        baseRowClass,
                        isBaseRow && styles.sensCellFirstBase
                      )}
                    >
                      <div className={styles.sensValueWrap}>
                        <span>{formatPercent(scenario.valuePct, 1)}</span>
                        {isBaseRow ? <Badge tone="info">Base</Badge> : null}
                      </div>
                    </td>
                    <td
                      className={cx(
                        styles.sensCell,
                        styles.cellNum,
                        baseRowClass,
                        isNegativeSensitivityMetric(scenario.irrPct) && styles.negative
                      )}
                    >
                      {formatRatioPercent(scenario.irrPct, 1)}
                    </td>
                    <td
                      className={cx(
                        styles.sensCell,
                        styles.cellNum,
                        baseRowClass,
                        isNegativeSensitivityMetric(
                          scenario.year1EquityYield ?? scenario.year1CashOnCashReturn
                        ) && styles.negative
                      )}
                    >
                      {formatRatioPercent(
                        scenario.year1EquityYield ?? scenario.year1CashOnCashReturn,
                        1
                      )}
                    </td>
                    <td
                      className={cx(
                        styles.sensCell,
                        styles.cellNum,
                        styles.sensCellLast,
                        baseRowClass,
                        isNegativeSensitivityMetric(
                          sensitivity.key === "exit_cap_rate"
                            ? scenario.netProceedsToEquity
                            : scenario.stabilizedNoi
                        ) && styles.negative
                      )}
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
    <Panel padding="md" className={styles.root}>
      <div className={styles.headerRow}>
        <div className={styles.headerIntro}>
          <h3 className={styles.title}>
            <Calculator size={16} strokeWidth={2} aria-hidden="true" className={styles.titleIcon} />
            OM analysis workspace
          </h3>
          <p className={styles.lede}>
            Work from the uploaded OM the way you would in a live underwrite: tighten the assumptions in a
            compact calculator, adjust unit and expense rows directly, then review the live deal overview,
            cash flow statement, sensitivities, and supporting assumptions that feed the dossier.
          </p>
          <div className={styles.badgeRow}>
            <Badge tone="info">{effectiveLabel}</Badge>
            <Badge tone={isDirty ? "warning" : "success"}>
              {isDirty
                ? mode === "standalone"
                  ? "Unapplied underwriting edits"
                  : "Unsaved assumption edits"
                : mode === "standalone"
                  ? "Analysis synced"
                  : "Assumptions synced"}
            </Badge>
          </div>
        </div>
        <div className={styles.actionRow}>
          <Button
            type="button"
            variant="primary"
            onClick={onRunCalculation}
            disabled={running || !canCalculate}
          >
            {running
              ? "Analyzing..."
              : mode === "standalone"
                ? calculation
                  ? "Refresh analysis"
                  : "Analyze uploaded OMs"
                : "Analyze OM"}
          </Button>
          {showPersistenceActions ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className={styles.buttonAccent}
                onClick={onSave}
                disabled={saving || running || !isDirty}
              >
                {saving ? "Saving..." : "Save assumptions"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={onResetToSaved}
                disabled={saving || running || !isDirty}
              >
                Reset edits
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={onClearSaved}
                disabled={saving || running}
              >
                Clear saved overrides
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!canCalculate ? (
        <div className={styles.notice}>
          {mode === "standalone"
            ? "Upload one or more OM PDFs and run analysis so this workspace can populate current state, unit-level underwriting rows, and dossier outputs."
            : "Upload an OM, build the authoritative OM, or save broker notes first so this workspace has a current revenue and expense base to analyze."}
        </div>
      ) : null}

      {error ? <div className={styles.noticeDanger}>{error}</div> : null}

      <div className={styles.sectionCard}>
        <div className={cx(styles.sectionHead, styles.sectionHeadRow)}>
          <div className={styles.sectionHeadIntro}>
            <strong className={styles.sectionTitle}>
              <SlidersHorizontal
                size={15}
                strokeWidth={2}
                aria-hidden="true"
                className={styles.sectionTitleIcon}
              />
              Assumptions calculator
            </strong>
            <div className={styles.sectionDesc}>
              All of the core underwriting inputs live here in a tighter calculator layout so it is easier to
              key in and iterate quickly during OM review.
            </div>
          </div>
          <div className={styles.sectionActions}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.buttonAccent}
              onClick={onApplyFormulaDefault}
              disabled={saving || running}
            >
              Use formula FF&E default
            </Button>
            <div className={styles.formulaHint}>
              Formula FF&E default: {formatCurrency(formulaFurnishingSetupCosts ?? 0)}
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.metaGrid}>
            <label className={styles.fieldStack}>
              <span className={styles.fieldLabel}>Investment profile</span>
              <select
                value={draft.investmentProfile}
                onChange={(event) => onDraftTextChange("investmentProfile", event.target.value)}
                className={styles.input}
              >
                <option value="">Select profile</option>
                <option value="Core">Core</option>
                <option value="Core-plus">Core-plus</option>
                <option value="Light value-add">Light value-add</option>
                <option value="Value-add">Value-add</option>
                <option value="Opportunistic">Opportunistic</option>
              </select>
            </label>
            <label className={styles.fieldStack}>
              <span className={styles.fieldLabel}>Target acquisition date</span>
              <input
                type="date"
                value={draft.targetAcquisitionDate}
                onChange={(event) => onDraftTextChange("targetAcquisitionDate", event.target.value)}
                className={styles.input}
              />
            </label>
          </div>
          <div className={cx(styles.calloutPanel, styles.calloutPanelBlue)}>
            <div className={styles.calloutHead}>
              <div>
                <div className={styles.kickerBlue}>Current NOI override</div>
                <div className={styles.calloutDesc}>
                  If the pulled current NOI is off, replace it here and refresh analysis. Leave blank to
                  keep using the OM value.
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={styles.buttonBlue}
                onClick={() => onDraftNumberChange("currentNoi", null)}
                disabled={saving || running || draft.currentNoi == null}
              >
                Use pulled NOI
              </Button>
            </div>
            <div className={styles.calloutGrid}>
              <div className={styles.statBox}>
                <div className={styles.statKicker}>Pulled NOI</div>
                <div className={styles.statValue}>{formatCurrency(pulledCurrentNoi)}</div>
              </div>
              <label className={styles.fieldStack}>
                <span className={styles.fieldLabel}>Override current NOI</span>
                <div className={styles.fieldControl}>
                  <span className={cx(styles.fieldAffix, styles.fieldAffixLeft)}>$</span>
                  <input
                    type="number"
                    step="any"
                    value={draft.currentNoi == null ? "" : String(draft.currentNoi)}
                    onChange={(event) =>
                      onDraftNumberChange(
                        "currentNoi",
                        event.target.value === "" ? null : Number(event.target.value)
                      )
                    }
                    placeholder={pulledCurrentNoi == null ? "No NOI pulled yet" : String(pulledCurrentNoi)}
                    className={styles.fieldBareInput}
                  />
                </div>
              </label>
              <div className={cx(styles.statBox, !hasCurrentNoiOverrideApplied && styles.statBoxMuted)}>
                <div className={styles.statKicker}>Applied in analysis</div>
                <div className={styles.statValue}>{formatCurrency(appliedCurrentNoi)}</div>
              </div>
            </div>
          </div>
          <div className={cx(styles.calloutPanel, styles.calloutPanelBrand)}>
            <div>
              <div className={styles.kickerBrand}>Hold period / exit year</div>
              <div className={styles.calloutDesc}>
                This drives the sale year, the number of cash-flow columns, recommended-offer math, and the
                projected IRR.
              </div>
            </div>
            <div className={styles.calloutGrid}>
              <label className={styles.fieldStack}>
                <span className={styles.fieldLabel}>Hold period</span>
                <div className={styles.fieldControl}>
                  <input
                    type="number"
                    step={1}
                    min={1}
                    value={draft.holdPeriodYears == null ? "" : String(draft.holdPeriodYears)}
                    onChange={(event) =>
                      onDraftNumberChange(
                        "holdPeriodYears",
                        event.target.value === "" ? null : Number(event.target.value)
                      )
                    }
                    placeholder={appliedHoldPeriodYears == null ? "2" : String(appliedHoldPeriodYears)}
                    className={styles.fieldBareInput}
                  />
                  <span className={cx(styles.fieldAffix, styles.fieldAffixRight)}>yrs</span>
                </div>
              </label>
              <div className={styles.statBox}>
                <div className={styles.statKicker}>Applied in analysis</div>
                <div className={styles.statValue}>
                  {appliedHoldPeriodYears != null ? `${formatNumber(appliedHoldPeriodYears)} years` : "—"}
                </div>
              </div>
              <div className={styles.statBox}>
                <div className={styles.statKicker}>IRR basis</div>
                <div className={styles.statValue}>
                  {appliedHoldPeriodYears != null ? `${formatNumber(appliedHoldPeriodYears)}-year exit` : "Refresh to apply"}
                </div>
              </div>
            </div>
          </div>
          <div className={styles.groupGrid}>
            {visibleFieldGroups.map((group) => (
              <div key={group.title} className={styles.groupCard}>
                <div className={styles.groupKicker}>{group.title}</div>
                <div className={styles.groupFields}>
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
          <div className={styles.footnote}>
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

      <div className={styles.sectionCard}>
        <div className={styles.sectionHead}>
          <strong className={styles.sectionTitle}>
            <Building2 size={15} strokeWidth={2} aria-hidden="true" className={styles.sectionTitleIcon} />
            Per-unit monthly rent, FF&amp;E, onboarding, and OpEx
          </strong>
          <div className={styles.sectionDesc}>
            Edit monthly gross rent by unit, then tune uplift, occupancy, FF&amp;E, onboarding labor,
            onboarding other, and recurring unit OpEx. Annual figures stay visible in smaller italic text.
          </div>
          <div className={styles.sectionStatsLine}>
            FF&amp;E: <strong>{formatCurrency(detailedFurnishingTotal)}</strong> • Onboarding:{" "}
            <strong>{formatCurrency(detailedOnboardingTotal)}</strong> • Rec. OpEx / mo:{" "}
            <strong>{formatCurrency(detailedRecurringOpexMonthlyTotal)}</strong> • Weighted occupancy:{" "}
            <strong>{formatPercent(weightedModeledOccupancyPct, 1)}</strong>
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.unitTable}>
            <thead>
              <tr>
                <th className={unitTableHeaderCellClass()}>Unit</th>
                <th className={unitTableHeaderCellClass()}>Mix</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>Current / mo</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>Base / mo</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>Uplift %</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>Occ. %</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>FF&amp;E</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>Labor</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>Other</th>
                <th className={unitTableHeaderCellClass({ align: "right" })}>OpEx / mo</th>
                <th className={unitTableHeaderCellClass({ align: "center" })}>Model</th>
                <th className={unitTableHeaderCellClass({ align: "right", lastColumn: true })}>
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
                      <td className={unitTableCellClassForRow(row, rowIndex, { pinned: true })}>
                        <div className={styles.unitName}>{row.unitLabel}</div>
                        <div className={styles.unitSub}>
                          {[row.tenantStatus, row.notes].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { pinned: true })}>
                        <div>{row.unitCategory ?? "—"}</div>
                        <div className={styles.unitSub}>
                          {[row.beds != null ? `${formatNumber(row.beds)}Br` : null, row.baths != null ? `${row.baths}Ba` : null, row.sqft != null ? `${formatNumber(row.sqft)} SF` : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                        <div className={cx(styles.unitSub, styles.unitSubTight)}>
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
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
                        <div>{formatCurrency(monthlyFromAnnual(row.currentAnnualRent))}</div>
                        <div className={styles.unitAnnual}>
                          {formatCurrency(row.currentAnnualRent)} / yr
                        </div>
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          value={displayMonthlyInputValue(row.underwrittenAnnualRent)}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              underwrittenAnnualRent:
                                event.target.value === "" ? null : annualFromMonthly(Number(event.target.value)),
                            })
                          }
                          className={cx(styles.input, styles.inputNum, styles.w98)}
                        />
                        <div className={styles.unitAnnual}>
                          {formatCurrency(row.underwrittenAnnualRent)} / yr
                        </div>
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="0.1"
                          value={row.rentUpliftPct ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              rentUpliftPct: event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          className={cx(styles.input, styles.inputNum, styles.w74)}
                        />
                        <div className={styles.unitComputedLabel}>Boosted gross</div>
                        <div className={styles.unitComputedValue}>
                          {formatCurrency(monthlyFromAnnual(boostedGrossAnnualRent))} / mo
                        </div>
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="0.1"
                          value={row.occupancyPct ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              occupancyPct: event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          className={cx(styles.input, styles.inputNum, styles.w74)}
                        />
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
                        <input
                          type="number"
                          step="100"
                          value={row.furnishingCost ?? ""}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, {
                              furnishingCost: event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                          className={cx(styles.input, styles.inputNum, styles.w92)}
                        />
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
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
                          className={cx(styles.input, styles.inputNum, styles.w86)}
                        />
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
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
                          className={cx(styles.input, styles.inputNum, styles.w86)}
                        />
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "right" })}>
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
                          className={cx(styles.input, styles.inputNum, styles.w86)}
                        />
                      </td>
                      <td className={unitTableCellClassForRow(row, rowIndex, { align: "center" })}>
                        <input
                          type="checkbox"
                          checked={row.includeInUnderwriting}
                          onChange={(event) =>
                            updateUnitRow(row.rowId, { includeInUnderwriting: event.target.checked })
                          }
                        />
                      </td>
                      <td
                        className={unitTableCellClassForRow(row, rowIndex, {
                          align: "right",
                          metric: true,
                          lastColumn: true,
                        })}
                      >
                        <div className={styles.semibold}>{formatCurrency(monthlyFromAnnual(row.modeledAnnualRent))}</div>
                        <div className={styles.unitAnnual}>
                          {formatCurrency(row.modeledAnnualRent)} / yr
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} className={cx(styles.cell, styles.cellMuted)}>
                    Analyze the OM to pull rent roll rows into the underwrite.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.sectionCard}>
        <div className={cx(styles.sectionHead, styles.sectionHeadRow, styles.sectionHeadRowCenter)}>
          <div>
            <strong className={styles.sectionTitle}>
              <ReceiptText size={15} strokeWidth={2} aria-hidden="true" className={styles.sectionTitleIcon} />
              Expense model
            </strong>
            <div className={styles.sectionDesc}>
              Expense rows are authoritative for expense amounts and growth. Use <strong>Replace with mgmt fee</strong>{" "}
              when the OM already includes management so the model does not double count it, and use <strong>Exclude</strong>{" "}
              for legacy LTR line items you want to add back or remove from the furnished / MTR case.
            </div>
            <div className={styles.sectionDesc}>
              Projected <strong>management fee</strong> and <strong>occupancy tax</strong> still come from the
              operating assumptions above, even if those lines are missing from the current OM expenses.
            </div>
            {replacedManagementRows.length > 0 ? (
              <div className={styles.sectionNote}>
                Rows replacing management fee:{" "}
                <strong>{replacedManagementRows.map((row) => row.lineItem).join(", ")}</strong>
              </div>
            ) : null}
          </div>
          <Button type="button" variant="secondary" onClick={addExpenseRow}>
            Add expense row
          </Button>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead className={styles.theadRaised}>
              <tr>
                <th className={styles.th}>Line item</th>
                <th className={cx(styles.th, styles.thRight)}>Amount</th>
                <th className={cx(styles.th, styles.thRight)}>Growth %</th>
                <th className={styles.th}>Treatment</th>
                <th className={cx(styles.th, styles.thCenter)}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {expenseModelRows.length > 0 ? (
                expenseModelRows.map((row) => (
                  <tr key={row.rowId}>
                    <td className={styles.cell}>
                      <input
                        type="text"
                        value={row.lineItem}
                        onChange={(event) =>
                          updateExpenseRow(row.rowId, {
                            lineItem: event.target.value,
                            isManagementLine: /\b(management|mgmt)\b/i.test(event.target.value),
                          })
                        }
                        className={styles.input}
                      />
                    </td>
                    <td className={cx(styles.cell, styles.cellNum)}>
                      <input
                        type="number"
                        step="100"
                        value={row.amount ?? ""}
                        onChange={(event) =>
                          updateExpenseRow(row.rowId, {
                            amount: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        className={cx(styles.input, styles.inputNum, styles.w120)}
                      />
                    </td>
                    <td className={cx(styles.cell, styles.cellNum)}>
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
                        className={cx(styles.input, styles.inputNum, styles.w92)}
                      />
                    </td>
                    <td className={styles.cell}>
                      <select
                        value={row.treatment}
                        onChange={(event) =>
                          updateExpenseRow(row.rowId, {
                            treatment: event.target.value as PropertyDealDossierExpenseTreatment,
                          })
                        }
                        className={cx(styles.input, styles.w190)}
                      >
                        {EXPENSE_TREATMENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={cx(styles.cell, styles.cellCenter)}>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeExpenseRow(row.rowId)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className={cx(styles.cell, styles.cellMuted)}>
                    Analyze the OM to load expense rows, or add your own manually.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading ? (
        <SkeletonRows count={4} />
      ) : calculation ? (
        <div className={styles.sectionCard}>
          <div className={styles.calcHead}>
            <strong className={styles.sectionTitle}>
              <FileSpreadsheet size={15} strokeWidth={2} aria-hidden="true" className={styles.sectionTitleIcon} />
              Calculated financials
            </strong>
            <div className={styles.sectionDesc}>
              This is the live deal dossier view generated from the latest OM analysis, unit-level edits,
              and underwriting assumptions.
            </div>
          </div>

          <div className={styles.calcBody}>
            <div className={styles.hero}>
              <div className={styles.kicker}>Live dossier preview</div>
              <div className={styles.heroAddress}>{calculation.property.canonicalAddress}</div>
              <div className={styles.heroBadges}>
                <Badge tone="info">{calculation.source.sourceLabel}</Badge>
                <Badge tone="neutral">{calculation.property.city ?? "City unavailable"}</Badge>
                {calculation.property.askingPrice != null ? (
                  <Badge tone="success">Ask {formatCurrency(calculation.property.askingPrice)}</Badge>
                ) : null}
              </div>
            </div>

            {calculation.yieldSignals?.calloutCode ? (
              <div
                className={cx(
                  styles.callout,
                  calculation.yieldSignals.calloutCode === "mtr_weak_uplift"
                    ? styles.calloutWarning
                    : styles.calloutDanger
                )}
              >
                <strong className={styles.calloutTitle}>
                  {calculation.yieldSignals.calloutCode === "mtr_below_ltr"
                    ? "MTR yield below LTR — source as an LTR deal"
                    : calculation.yieldSignals.calloutCode === "mtr_spread_outlier"
                      ? "MTR spread implausibly high — check for double-counted rents"
                      : "Weak MTR yield bump"}
                </strong>
                <div className={styles.calloutBody}>{calculation.yieldSignals.calloutLabel}</div>
              </div>
            ) : null}

            {calculation.validationMessages.filter(
              (message) => message !== calculation.yieldSignals?.calloutLabel
            ).length > 0 ? (
              <div className={cx(styles.callout, styles.calloutWarning)}>
                <strong className={styles.calloutTitle}>Validation flags</strong>
                {calculation.validationMessages
                  .filter((message) => message !== calculation.yieldSignals?.calloutLabel)
                  .map((message) => (
                    <div key={message} className={styles.calloutBody}>
                      {message}
                    </div>
                  ))}
              </div>
            ) : null}

            <div className={styles.subSection}>
              <div>
                <div className={cx(styles.kicker, styles.kickerWithIcon)}>
                  <LayoutDashboard size={15} strokeWidth={2} aria-hidden="true" className={styles.kickerIcon} />
                  Deal overview
                </div>
                <div className={styles.kickerNote}>
                  Front-page property, acquisition, rent mix, and return outputs from the latest OM run.
                </div>
              </div>
              {calculation.currentNoiOverridden ? (
                <div className={styles.noiOverrideNote}>
                  NOI override active — current NOI is user-set, so the expense rows below are informational and do
                  not feed this number. Clear the override in assumptions to recalculate from expenses.
                </div>
              ) : null}
              <div className={styles.metricGrid}>
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
                    label: "Current cap rate (LTR yield)",
                    value: formatPercent(calculation.topLineMetrics.currentCapRatePct, 1),
                  },
                  {
                    label: "Stabilized cap rate (MTR yield)",
                    value: formatPercent(calculation.topLineMetrics.stabilizedCapRatePct, 1),
                  },
                  {
                    label: "MTR vs LTR spread",
                    value:
                      calculation.yieldSignals?.spreadPctPoints != null
                        ? `${calculation.yieldSignals.spreadPctPoints >= 0 ? "+" : "−"}${Math.abs(
                            calculation.yieldSignals.spreadPctPoints
                          ).toFixed(2)} pt${
                            calculation.yieldSignals.calloutCode === "mtr_below_ltr"
                              ? " (below LTR)"
                              : calculation.yieldSignals.calloutCode === "mtr_weak_uplift"
                                ? " (weak bump)"
                                : calculation.yieldSignals.calloutCode === "mtr_spread_outlier"
                                  ? " (implausible — verify rents)"
                                  : ""
                          }`
                        : "—",
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
                    label:
                      calculation.topLineMetrics.holdPeriodYears != null
                        ? `Projected ${formatNumber(calculation.topLineMetrics.holdPeriodYears)}-year IRR`
                        : "Projected IRR",
                    value:
                      calculation.topLineMetrics.irrPct != null
                        ? formatRatioPercent(calculation.topLineMetrics.irrPct, 1)
                        : calculation.topLineMetrics.irrNullReason === "no_sign_change"
                          ? "— (cash flows never turn positive)"
                          : calculation.topLineMetrics.irrNullReason === "did_not_converge"
                            ? "— (solver did not converge)"
                            : formatRatioPercent(null, 1),
                  },
                  {
                    label: "Avg cash-on-cash",
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

            <div className={styles.subSection}>
              <div>
                <div className={cx(styles.kicker, styles.kickerWithIcon)}>
                  <TableProperties size={15} strokeWidth={2} aria-hidden="true" className={styles.kickerIcon} />
                  Cash flow statement
                </div>
                <div className={styles.kickerNote}>
                  Annual roll-forward of rent, expenses, NOI, financing, and sale proceeds from the current
                  OM baseline through the modeled hold.
                </div>
              </div>
              <div className={styles.sectionCard}>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead className={styles.theadRaised}>
                      <tr>
                        <th className={cx(styles.th, styles.cfLabel)}>Line item</th>
                        {calculation.yearlyCashFlow.endingLabels.map((label) => (
                          <th key={label} className={cx(styles.th, styles.thRight, styles.thNowrap)}>
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
                        { blankZero: true, bold: true, highlight: true, topRule: true, bottomRule: true }
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
                        { blankZero: true, bold: true, highlight: true, doubleTopRule: true, bottomRule: true }
                      )}

                      {renderCashFlowSectionRow("Operating cash flow")}
                      {renderCashFlowValueRow(
                        "Free-market residential",
                        calculation.yearlyCashFlow.freeMarketResidentialGrossRentalIncome,
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "RS / RC residential",
                        calculation.yearlyCashFlow.protectedResidentialGrossRentalIncome,
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "Commercial gross",
                        calculation.yearlyCashFlow.commercialGrossRentalIncome,
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "Gross rental income",
                        calculation.yearlyCashFlow.grossRentalIncome,
                        { blankZero: true, bold: true, highlight: true, topRule: true, bottomRule: true }
                      )}
                      {renderCashFlowValueRow(
                        "Other income",
                        calculation.yearlyCashFlow.otherIncome,
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "Vacancy loss",
                        calculation.yearlyCashFlow.vacancyLoss.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "Lead time loss",
                        calculation.yearlyCashFlow.leadTimeLoss.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "Net rental income",
                        calculation.yearlyCashFlow.netRentalIncome,
                        { blankZero: true, bold: true, highlight: true, doubleTopRule: true, bottomRule: true }
                      )}
                      {calculation.yearlyCashFlow.expenseLineItems.map((row) =>
                        renderCashFlowValueRow(
                          row.lineItem,
                          projectedExpenseLineSeries(row.yearlyAmounts).map((value) =>
                            value != null ? -Math.abs(value) : value
                          ),
                          { blankZero: true, indent: true }
                        )
                      )}
                      {renderCashFlowValueRow(
                        "Management fee",
                        calculation.yearlyCashFlow.managementFee.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "Total operating expenses",
                        calculation.yearlyCashFlow.totalOperatingExpenses.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true, bold: true, highlight: true, topRule: true, bottomRule: true }
                      )}
                      {renderCashFlowValueRow(
                        "Net operating income (NOI)",
                        calculation.yearlyCashFlow.noi,
                        { blankZero: true, bold: true, highlight: true, doubleTopRule: true, bottomRule: true }
                      )}
                      {renderCashFlowValueRow(
                        "Recurring CapEx / reserve",
                        calculation.yearlyCashFlow.recurringCapex.map((value) =>
                          value != null ? -Math.abs(value) : value
                        ),
                        { blankZero: true, indent: true }
                      )}
                      {renderCashFlowValueRow(
                        "Unlevered CF after reserves",
                        calculation.yearlyCashFlow.cashFlowFromOperations,
                        { blankZero: true, bold: true, highlight: true, topRule: true, bottomRule: true }
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
                        { blankZero: true, topRule: true }
                      )}
                      {renderCashFlowValueRow(
                        "Ending loan balance",
                        calculation.yearlyCashFlow.remainingLoanBalance,
                        { blankZero: true }
                      )}
                      {renderCashFlowValueRow(
                        "Levered CF to equity",
                        leveredCashFlowToEquitySeries,
                        { blankZero: true, bold: true, highlight: true, doubleTopRule: true, bottomRule: true }
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
                        { blankZero: true, bold: true, highlight: true, topRule: true, bottomRule: true }
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
                        { blankZero: true, bold: true, topRule: true, bottomRule: true }
                      )}
                      {renderCashFlowValueRow(
                        "Total levered CF incl. exit",
                        calculation.yearlyCashFlow.leveredCashFlow,
                        { blankZero: true, bold: true, highlight: true, doubleTopRule: true, bottomRule: true }
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className={styles.subSection}>
              <div>
                <div className={cx(styles.kicker, styles.kickerWithIcon)}>
                  <Activity size={15} strokeWidth={2} aria-hidden="true" className={styles.kickerIcon} />
                  Sensitivity analyses
                </div>
                <div className={styles.kickerNote}>
                  Primary scenario sweeps behind the deal dossier, with the base row highlighted and negative
                  outcomes called out in red.
                </div>
              </div>
              <div className={styles.sectionCard}>
                <div
                  className={cx(
                    styles.sensGrid,
                    sensitivityCards.length > 1 ? styles.sensGridMulti : styles.sensGridSingle
                  )}
                >
                  {sensitivityCards.length > 0 ? (
                    sensitivityCards.map((sensitivity) => renderSensitivityCard(sensitivity))
                  ) : (
                    <div className={styles.emptyNote}>
                      Sensitivity outputs are not available for this run yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.subSection}>
              <div>
                <div className={cx(styles.kicker, styles.kickerWithIcon)}>
                  <ListChecks size={15} strokeWidth={2} aria-hidden="true" className={styles.kickerIcon} />
                  Assumptions
                </div>
                <div className={styles.kickerNote}>
                  Source tables and resolved underwriting inputs feeding this live dossier view and the PDF
                  export below.
                </div>
              </div>
              <div className={styles.assumpStack}>
                <div className={styles.assumpGrid}>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionHead}>
                      <strong className={styles.sectionTitle}>Assumptions used</strong>
                      <div className={styles.sectionDesc}>
                        These are the resolved assumptions from the latest OM analysis run.
                      </div>
                    </div>
                    <div className={styles.listPad}>
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
                      {summaryRow("Building SF", calculation.propertyInfo.sizeSqft != null ? `${formatNumber(calculation.propertyInfo.sizeSqft)} SF` : "—")}
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

                  <div className={styles.sectionCard}>
                    <div className={styles.sectionHead}>
                      <strong className={styles.sectionTitle}>Current OM state</strong>
                      <div className={styles.sectionDesc}>
                        Extracted baseline income, rent basis, and expense context before stabilization is applied.
                      </div>
                    </div>
                    <div className={styles.listPad}>
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
                      {summaryRow(
                        "Extracted current NOI",
                        formatCurrency(calculation.currentFinancials.extractedNoi)
                      )}
                      {calculation.currentFinancials.isNoiOverridden
                        ? summaryRow(
                            "Applied NOI override",
                            formatCurrency(calculation.currentFinancials.noi)
                          )
                        : null}
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

                <div className={styles.assumpGrid}>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionHead}>
                      <strong className={styles.sectionTitle}>Source rent roll</strong>
                      <div className={styles.sectionDesc}>
                        OM-extracted unit rows feeding the monthly underwriting table above.
                      </div>
                    </div>
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead className={styles.theadRaised}>
                          <tr>
                            <th className={styles.th}>Unit</th>
                            <th className={styles.th}>Mix</th>
                            <th className={cx(styles.th, styles.thRight)}>Monthly</th>
                            <th className={cx(styles.th, styles.thRight)}>Annual</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calculation.rentRoll.length > 0 ? (
                            calculation.rentRoll.map((row, index) => (
                              <tr key={`${row.unit ?? row.tenantName ?? "row"}-${index}`}>
                                <td className={styles.cell}>{row.unit ?? row.tenantName ?? "—"}</td>
                                <td className={styles.cell}>
                                  {[
                                    row.beds != null ? `${formatNumber(row.beds)}Br` : null,
                                    row.baths != null ? `${row.baths}Ba` : null,
                                    row.sqft != null ? `${formatNumber(row.sqft)} SF` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "—"}
                                </td>
                                <td className={cx(styles.cell, styles.cellNum)}>
                                  {formatCurrency(row.monthlyRent)}
                                </td>
                                <td className={cx(styles.cell, styles.cellNum)}>
                                  {formatCurrency(
                                    row.annualRent ?? (row.monthlyRent != null ? row.monthlyRent * 12 : null)
                                  )}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className={cx(styles.cell, styles.cellMuted)}>
                                No rent roll rows were extracted from the OM source.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className={styles.sectionCard}>
                    <div className={styles.sectionHead}>
                      <strong className={styles.sectionTitle}>Current expense table</strong>
                      <div className={styles.sectionDesc}>
                        Raw OM expense lines before any model treatments, exclusions, or replacement logic.
                      </div>
                    </div>
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead className={styles.theadRaised}>
                          <tr>
                            <th className={styles.th}>Line item</th>
                            <th className={cx(styles.th, styles.thRight)}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calculation.expenseRows.length > 0 ? (
                            calculation.expenseRows.map((row) => (
                              <tr key={`${row.lineItem}-${row.amount}`}>
                                <td className={styles.cell}>{row.lineItem}</td>
                                <td className={cx(styles.cell, styles.cellNum)}>
                                  {formatCurrency(row.amount)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={2} className={cx(styles.cell, styles.cellMuted)}>
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
        <EmptyState title="Analyze the OM to populate the underwriting outputs, sensitivities, and cash flow records." />
      )}
    </Panel>
  );
}
