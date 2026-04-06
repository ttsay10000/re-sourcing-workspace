import type {
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierExpenseTreatment,
  PropertyDealDossierAssumptions,
  PropertyDealDossierGeneration,
  PropertyDealDossierSummary,
  PropertyDealDossierUnitModelRow,
  PropertyDetails,
} from "@re-sourcing/contracts";
import type { DossierAssumptionOverrides } from "./underwritingModel.js";

const DOSSIER_ASSUMPTION_NUMERIC_KEYS = [
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
] as const satisfies ReadonlyArray<keyof DossierAssumptionOverrides>;

const DOSSIER_ASSUMPTION_STRING_KEYS = [
  "investmentProfile",
  "targetAcquisitionDate",
] as const satisfies ReadonlyArray<keyof DossierAssumptionOverrides>;
const DOSSIER_EXPENSE_TREATMENTS: PropertyDealDossierExpenseTreatment[] = [
  "operating",
  "replace_management",
  "exclude",
];

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toTrimmedString(
  value: unknown,
  maxLength: number
): string | null | "invalid" {
  if (value == null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : "invalid";
}

function toOptionalBoolean(value: unknown): boolean | null | "invalid" {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  return "invalid";
}

function toDateString(value: unknown): string | null | "invalid" {
  if (value == null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "invalid";
}

export function parsePropertyDealDossierUnitModelRows(
  raw: unknown
): PropertyDealDossierUnitModelRow[] | null | "invalid" {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return "invalid";

  const rows: PropertyDealDossierUnitModelRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "invalid";
    const record = entry as Record<string, unknown>;
    const rowId = toTrimmedString(record.rowId, 200);
    const unitLabel = toTrimmedString(record.unitLabel, 200);
    const building = toTrimmedString(record.building, 200);
    const unitCategory = toTrimmedString(record.unitCategory, 200);
    const tenantName = toTrimmedString(record.tenantName, 200);
    const tenantStatus = toTrimmedString(record.tenantStatus, 200);
    const notes = toTrimmedString(record.notes, 1_000);
    const includeInUnderwriting = toOptionalBoolean(record.includeInUnderwriting);
    const isProtected = toOptionalBoolean(record.isProtected);
    const isCommercial = toOptionalBoolean(record.isCommercial);
    const isRentStabilized = toOptionalBoolean(record.isRentStabilized);
    if (
      rowId === "invalid" ||
      unitLabel === "invalid" ||
      building === "invalid" ||
      unitCategory === "invalid" ||
      tenantName === "invalid" ||
      tenantStatus === "invalid" ||
      notes === "invalid" ||
      includeInUnderwriting === "invalid" ||
      isProtected === "invalid" ||
      isCommercial === "invalid" ||
      isRentStabilized === "invalid"
    ) {
      return "invalid";
    }
    if (rowId == null) return "invalid";

    const nextRow: PropertyDealDossierUnitModelRow = {
      rowId,
      unitLabel,
      building,
      unitCategory,
      tenantName,
      currentAnnualRent: toFiniteNumber(record.currentAnnualRent),
      underwrittenAnnualRent: toFiniteNumber(record.underwrittenAnnualRent),
      rentUpliftPct: toFiniteNumber(record.rentUpliftPct),
      occupancyPct: toFiniteNumber(record.occupancyPct),
      furnishingCost: toFiniteNumber(record.furnishingCost),
      onboardingLaborFee: toFiniteNumber(record.onboardingLaborFee),
      onboardingOtherCosts: toFiniteNumber(record.onboardingOtherCosts),
      onboardingFee: toFiniteNumber(record.onboardingFee),
      monthlyRecurringOpex: toFiniteNumber(record.monthlyRecurringOpex),
      monthlyHospitalityExpense: toFiniteNumber(record.monthlyHospitalityExpense),
      includeInUnderwriting,
      isProtected,
      isCommercial,
      isRentStabilized,
      beds: toFiniteNumber(record.beds),
      baths: toFiniteNumber(record.baths),
      sqft: toFiniteNumber(record.sqft),
      tenantStatus,
      notes,
    };

    const hasMeaningfulValue =
      nextRow.unitLabel != null ||
      nextRow.currentAnnualRent != null ||
      nextRow.underwrittenAnnualRent != null ||
      nextRow.rentUpliftPct != null ||
      nextRow.occupancyPct != null ||
      nextRow.furnishingCost != null ||
      nextRow.onboardingLaborFee != null ||
      nextRow.onboardingOtherCosts != null ||
      nextRow.onboardingFee != null ||
      nextRow.monthlyRecurringOpex != null ||
      nextRow.monthlyHospitalityExpense != null;
    if (hasMeaningfulValue) rows.push(nextRow);
  }

  return rows.length > 0 ? rows : null;
}

export function parsePropertyDealDossierExpenseModelRows(
  raw: unknown
): PropertyDealDossierExpenseModelRow[] | null | "invalid" {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return "invalid";

  const rows: PropertyDealDossierExpenseModelRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "invalid";
    const record = entry as Record<string, unknown>;
    const rowId = toTrimmedString(record.rowId, 200);
    const lineItem = toTrimmedString(record.lineItem, 200);
    const rawTreatment = toTrimmedString(record.treatment, 40);
    if (rowId === "invalid" || lineItem === "invalid" || rawTreatment === "invalid") return "invalid";
    if (rowId == null) return "invalid";
    const treatment =
      rawTreatment == null
        ? null
        : DOSSIER_EXPENSE_TREATMENTS.includes(rawTreatment as PropertyDealDossierExpenseTreatment)
          ? (rawTreatment as PropertyDealDossierExpenseTreatment)
          : "invalid";
    if (treatment === "invalid") return "invalid";

    const nextRow: PropertyDealDossierExpenseModelRow = {
      rowId,
      lineItem: lineItem ?? "",
      amount: toFiniteNumber(record.amount),
      annualGrowthPct: toFiniteNumber(record.annualGrowthPct),
      treatment,
    };

    const hasMeaningfulValue =
      nextRow.lineItem.trim().length > 0 ||
      nextRow.amount != null ||
      nextRow.annualGrowthPct != null;
    if (!hasMeaningfulValue) continue;
    if (!nextRow.lineItem.trim()) return "invalid";
    rows.push(nextRow);
  }

  return rows.length > 0 ? rows : null;
}

export function getPropertyDossierAssumptions(
  details: PropertyDetails | null | undefined
): PropertyDealDossierAssumptions | null {
  const assumptions = details?.dealDossier?.assumptions;
  if (!assumptions || typeof assumptions !== "object") return null;
  const parsedNumbers = Object.fromEntries(
    DOSSIER_ASSUMPTION_NUMERIC_KEYS.flatMap((key) => {
      const parsed = toFiniteNumber(assumptions[key]);
      return parsed != null ? [[key, parsed]] : [];
    })
  ) as DossierAssumptionOverrides;
  const parsedStrings = Object.fromEntries(
    DOSSIER_ASSUMPTION_STRING_KEYS.flatMap((key) => {
      const parsed =
        key === "targetAcquisitionDate"
          ? toDateString(assumptions[key])
          : toTrimmedString(assumptions[key], 200);
      return typeof parsed === "string" && parsed.length > 0 ? [[key, parsed]] : [];
    })
  ) as Partial<DossierAssumptionOverrides>;
  const brokerEmailNotes =
    typeof assumptions.brokerEmailNotes === "string" && assumptions.brokerEmailNotes.trim().length > 0
      ? assumptions.brokerEmailNotes.trim()
      : null;
  const unitModelRows = parsePropertyDealDossierUnitModelRows(assumptions.unitModelRows);
  const expenseModelRows = parsePropertyDealDossierExpenseModelRows(assumptions.expenseModelRows);
  const updatedAt =
    typeof assumptions.updatedAt === "string" && assumptions.updatedAt.trim().length > 0
      ? assumptions.updatedAt.trim()
      : null;
  const hasNumericValue = Object.keys(parsedNumbers).length > 0;
  const hasStringValue = Object.keys(parsedStrings).length > 0;
  if (
    !hasNumericValue &&
    !hasStringValue &&
    brokerEmailNotes == null &&
    updatedAt == null &&
    unitModelRows !== "invalid" &&
    expenseModelRows !== "invalid" &&
    unitModelRows == null &&
    expenseModelRows == null
  ) {
    return null;
  }
  return {
    ...parsedNumbers,
    ...parsedStrings,
    unitModelRows: unitModelRows === "invalid" ? null : unitModelRows,
    expenseModelRows: expenseModelRows === "invalid" ? null : expenseModelRows,
    brokerEmailNotes,
    updatedAt,
  };
}

export function getPropertyDossierGeneration(
  details: PropertyDetails | null | undefined
): PropertyDealDossierGeneration | null {
  const generation = details?.dealDossier?.generation;
  if (!generation || typeof generation !== "object") return null;
  return generation;
}

export function hasCompletedDealDossier(
  details: PropertyDetails | null | undefined
): boolean {
  const generation = getPropertyDossierGeneration(details);
  return generation?.status === "completed";
}

export function getPropertyDossierSummary(
  details: PropertyDetails | null | undefined
): PropertyDealDossierSummary | null {
  const summary = details?.dealDossier?.summary;
  if (!summary || typeof summary !== "object") return null;

  const generatedAt =
    typeof summary.generatedAt === "string" && summary.generatedAt.trim().length > 0
      ? summary.generatedAt.trim()
      : null;
  const targetMetAtAsking =
    typeof summary.targetMetAtAsking === "boolean" ? summary.targetMetAtAsking : null;

  const parsed: PropertyDealDossierSummary = {
    generatedAt,
    askingPrice: toFiniteNumber(summary.askingPrice),
    purchasePrice: toFiniteNumber(summary.purchasePrice),
    recommendedOfferLow: toFiniteNumber(summary.recommendedOfferLow),
    recommendedOfferHigh: toFiniteNumber(summary.recommendedOfferHigh),
    targetIrrPct: toFiniteNumber(summary.targetIrrPct),
    discountToAskingPct: toFiniteNumber(summary.discountToAskingPct),
    irrAtAskingPct: toFiniteNumber(summary.irrAtAskingPct),
    targetMetAtAsking,
    currentNoi: toFiniteNumber(summary.currentNoi),
    adjustedNoi: toFiniteNumber(summary.adjustedNoi),
    stabilizedNoi: toFiniteNumber(summary.stabilizedNoi),
    annualDebtService: toFiniteNumber(summary.annualDebtService),
    year1EquityYield: toFiniteNumber(summary.year1EquityYield),
    irrPct: toFiniteNumber(summary.irrPct),
    equityMultiple: toFiniteNumber(summary.equityMultiple),
    cocPct: toFiniteNumber(summary.cocPct),
    holdYears: toFiniteNumber(summary.holdYears),
    dealScore: toFiniteNumber(summary.dealScore),
    calculatedDealScore: toFiniteNumber(summary.calculatedDealScore),
    dealSignalsId:
      typeof summary.dealSignalsId === "string" && summary.dealSignalsId.trim().length > 0
        ? summary.dealSignalsId.trim()
        : null,
    dealSignalsGeneratedAt:
      typeof summary.dealSignalsGeneratedAt === "string" && summary.dealSignalsGeneratedAt.trim().length > 0
        ? summary.dealSignalsGeneratedAt.trim()
        : null,
    dossierDocumentId:
      typeof summary.dossierDocumentId === "string" && summary.dossierDocumentId.trim().length > 0
        ? summary.dossierDocumentId.trim()
        : null,
    excelDocumentId:
      typeof summary.excelDocumentId === "string" && summary.excelDocumentId.trim().length > 0
        ? summary.excelDocumentId.trim()
        : null,
  };

  const hasValue = Object.entries(parsed).some(([, value]) => value != null);
  return hasValue ? parsed : null;
}

export function propertyAssumptionsToOverrides(
  assumptions: PropertyDealDossierAssumptions | null | undefined
): DossierAssumptionOverrides | null {
  if (!assumptions) return null;
  const overrides: DossierAssumptionOverrides = {};
  for (const key of DOSSIER_ASSUMPTION_NUMERIC_KEYS) {
    const value = assumptions[key];
    if (value != null && Number.isFinite(value)) {
      overrides[key] = value;
    }
  }
  for (const key of DOSSIER_ASSUMPTION_STRING_KEYS) {
    const value = assumptions[key];
    if (typeof value === "string" && value.trim().length > 0) {
      overrides[key] = value.trim();
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : null;
}

export function mergeDossierAssumptionOverrides(
  base: DossierAssumptionOverrides | null | undefined,
  override: DossierAssumptionOverrides | null | undefined
): DossierAssumptionOverrides | null {
  const merged: DossierAssumptionOverrides = {};
  for (const key of DOSSIER_ASSUMPTION_NUMERIC_KEYS) {
    const overrideValue = override?.[key];
    if (typeof overrideValue === "number" && Number.isFinite(overrideValue)) {
      merged[key] = overrideValue;
      continue;
    }
    const baseValue = base?.[key];
    if (typeof baseValue === "number" && Number.isFinite(baseValue)) {
      merged[key] = baseValue;
    }
  }

  for (const key of DOSSIER_ASSUMPTION_STRING_KEYS) {
    const overrideValue = override?.[key];
    if (typeof overrideValue === "string" && overrideValue.trim().length > 0) {
      merged[key] = overrideValue.trim();
      continue;
    }
    const baseValue = base?.[key];
    if (typeof baseValue === "string" && baseValue.trim().length > 0) {
      merged[key] = baseValue.trim();
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}
