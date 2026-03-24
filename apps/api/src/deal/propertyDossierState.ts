import type {
  PropertyDealDossierAssumptions,
  PropertyDealDossierGeneration,
  PropertyDealDossierSummary,
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
] as const satisfies ReadonlyArray<keyof DossierAssumptionOverrides>;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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
  const brokerEmailNotes =
    typeof assumptions.brokerEmailNotes === "string" && assumptions.brokerEmailNotes.trim().length > 0
      ? assumptions.brokerEmailNotes.trim()
      : null;
  const updatedAt =
    typeof assumptions.updatedAt === "string" && assumptions.updatedAt.trim().length > 0
      ? assumptions.updatedAt.trim()
      : null;
  const hasNumericValue = Object.keys(parsedNumbers).length > 0;
  if (!hasNumericValue && brokerEmailNotes == null && updatedAt == null) return null;
  return {
    ...parsedNumbers,
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

  return Object.keys(merged).length > 0 ? merged : null;
}
