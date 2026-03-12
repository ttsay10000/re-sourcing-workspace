import type {
  PropertyDealDossierAssumptions,
  PropertyDealDossierGeneration,
  PropertyDealDossierSummary,
  PropertyDetails,
} from "@re-sourcing/contracts";
import type { DossierAssumptionOverrides } from "./underwritingModel.js";

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
  const renovationCosts = toFiniteNumber(assumptions.renovationCosts);
  const furnishingSetupCosts = toFiniteNumber(assumptions.furnishingSetupCosts);
  const updatedAt =
    typeof assumptions.updatedAt === "string" && assumptions.updatedAt.trim().length > 0
      ? assumptions.updatedAt.trim()
      : null;
  if (renovationCosts == null && furnishingSetupCosts == null && updatedAt == null) return null;
  return {
    renovationCosts,
    furnishingSetupCosts,
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
  if (assumptions.renovationCosts != null && Number.isFinite(assumptions.renovationCosts)) {
    overrides.renovationCosts = assumptions.renovationCosts;
  }
  if (assumptions.furnishingSetupCosts != null && Number.isFinite(assumptions.furnishingSetupCosts)) {
    overrides.furnishingSetupCosts = assumptions.furnishingSetupCosts;
  }
  return Object.keys(overrides).length > 0 ? overrides : null;
}

export function mergeDossierAssumptionOverrides(
  base: DossierAssumptionOverrides | null | undefined,
  override: DossierAssumptionOverrides | null | undefined
): DossierAssumptionOverrides | null {
  const merged: DossierAssumptionOverrides = {};
  const keys = new Set<keyof DossierAssumptionOverrides>([
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
  ]);

  for (const key of keys) {
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
