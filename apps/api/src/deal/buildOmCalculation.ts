import type {
  ExpenseLineItem,
  OmRentRollRow,
  PropertyDealDossierAssumptions,
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierUnitModelRow,
  PropertyDetails,
  UserProfile,
} from "@re-sourcing/contracts";
import {
  getPool,
  ListingRepo,
  MatchRepo,
  PropertyRepo,
  UserProfileRepo,
} from "@re-sourcing/db";
import { getAuthoritativeOmSnapshot, resolvePreferredOmExpenseTable, resolvePreferredOmExpenseTotal, resolvePreferredOmPropertyInfo, resolvePreferredOmRentRoll, resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import { resolveCurrentFinancialsFromDetails } from "../rental/currentFinancials.js";
import {
  extractBrokerDossierNotes,
  getBrokerEmailNotes,
  mergeBrokerNotesIntoDetails,
} from "./brokerDossierNotes.js";
import {
  getPropertyDossierAssumptions,
  propertyAssumptionsToOverrides,
} from "./propertyDossierState.js";
import {
  expenseModelRowsToProjectionRows,
  resolveDetailedCashFlowModel,
  type ResolvedExpenseModelRow,
  type ResolvedUnitModelRow,
  unitModelRowsToProjectionRows,
} from "./detailedCashFlowModel.js";
import { resolveProjectedResidentialLeaseUpRentSummary } from "./propertyAssumptions.js";
import {
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveDossierAssumptions,
  type DossierAssumptionOverrides,
} from "./underwritingModel.js";
import { buildRentBreakdown as buildSharedRentBreakdown } from "./rentBreakdown.js";
import { buildSensitivityAnalyses, type SensitivityAnalysis } from "./sensitivityAnalysis.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = trimmedString(value);
    if (trimmed) return trimmed;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function brokerNotesSuppliedFinancialInputs(
  extract: Awaited<ReturnType<typeof extractBrokerDossierNotes>> | null | undefined
): boolean {
  return Boolean(
    extract?.currentFinancials?.grossRentalIncome != null ||
      extract?.currentFinancials?.operatingExpenses != null ||
      extract?.currentFinancials?.noi != null ||
      (extract?.rentRoll?.length ?? 0) > 0 ||
      (extract?.expenses?.expensesTable?.length ?? 0) > 0 ||
      extract?.expenses?.totalExpenses != null
  );
}

function validationMessages(details: PropertyDetails | null): string[] {
  const flags = getAuthoritativeOmSnapshot(details)?.validationFlags;
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => {
      const message = trimmedString(flag?.message);
      if (message) return message;
      const field = trimmedString(flag?.field);
      const brokerValue =
        typeof flag?.brokerValue === "string" || typeof flag?.brokerValue === "number"
          ? String(flag.brokerValue)
          : null;
      const externalValue =
        typeof flag?.externalValue === "string" || typeof flag?.externalValue === "number"
          ? String(flag.externalValue)
          : null;
      const compared = [brokerValue, externalValue].filter(Boolean).join(" vs ");
      if (field && compared) return `Verify ${field}: ${compared}`;
      if (field) return `Verify ${field}`;
      return null;
    })
    .filter((value): value is string => value != null)
    .slice(0, 5);
}

function rentRollRows(details: PropertyDetails | null): OmRentRollRow[] {
  return resolvePreferredOmRentRoll(details);
}

function expenseRows(details: PropertyDetails | null): ExpenseLineItem[] {
  return resolvePreferredOmExpenseTable(details);
}

function expenseTotal(details: PropertyDetails | null): number | null {
  return resolvePreferredOmExpenseTotal(details);
}

function buildPropertyInfoSummary(details: PropertyDetails | null) {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const zoning = asRecord(details?.enrichment?.zoning);
  const assetClass = firstString(
    propertyInfo?.assetClass,
    propertyInfo?.assetType,
    propertyInfo?.propertyType,
    propertyInfo?.buildingType,
    propertyInfo?.assetClassName
  );
  const sizeSqft = firstFiniteNumber(
    propertyInfo?.buildingSqft,
    propertyInfo?.buildingSquareFeet,
    propertyInfo?.grossSqft,
    propertyInfo?.grossSquareFeet,
    propertyInfo?.squareFeet,
    details?.assessedGrossSqft
  );
  const yearBuilt = firstString(
    propertyInfo?.yearBuilt,
    propertyInfo?.builtYear,
    propertyInfo?.yearConstructed,
    details?.yearBuilt
  );
  const taxCode = firstString(details?.taxCode, propertyInfo?.taxClass);
  const zoningDistrict = firstString(
    zoning?.zoningDistrict1,
    zoning?.zoning_district_1,
    propertyInfo?.zoningDistrict,
    propertyInfo?.zoningDistrict1
  );
  return {
    assetClass,
    sizeSqft,
    yearBuilt,
    taxCode,
    zoningDistrict,
  };
}

function flattenedAssumptions(
  assumptions: ReturnType<typeof resolveDossierAssumptions>
): Record<string, number | null> {
  return {
    purchasePrice: assumptions.acquisition.purchasePrice,
    purchaseClosingCostPct: assumptions.acquisition.purchaseClosingCostPct,
    renovationCosts: assumptions.acquisition.renovationCosts,
    furnishingSetupCosts: assumptions.acquisition.furnishingSetupCosts,
    onboardingCosts: assumptions.acquisition.onboardingCosts,
    ltvPct: assumptions.financing.ltvPct,
    interestRatePct: assumptions.financing.interestRatePct,
    amortizationYears: assumptions.financing.amortizationYears,
    loanFeePct: assumptions.financing.loanFeePct,
    rentUpliftPct: assumptions.operating.rentUpliftPct,
    blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
    expenseIncreasePct: assumptions.operating.expenseIncreasePct,
    managementFeePct: assumptions.operating.managementFeePct,
    occupancyTaxPct: assumptions.operating.occupancyTaxPct,
    vacancyPct: assumptions.operating.vacancyPct,
    leadTimeMonths: assumptions.operating.leadTimeMonths,
    annualRentGrowthPct: assumptions.operating.annualRentGrowthPct,
    annualCommercialRentGrowthPct: assumptions.operating.annualCommercialRentGrowthPct,
    annualOtherIncomeGrowthPct: assumptions.operating.annualOtherIncomeGrowthPct,
    annualExpenseGrowthPct: assumptions.operating.annualExpenseGrowthPct,
    annualPropertyTaxGrowthPct: assumptions.operating.annualPropertyTaxGrowthPct,
    recurringCapexAnnual: assumptions.operating.recurringCapexAnnual,
    holdPeriodYears: assumptions.holdPeriodYears,
    exitCapPct: assumptions.exit.exitCapPct,
    exitClosingCostPct: assumptions.exit.exitClosingCostPct,
    targetIrrPct: assumptions.targetIrrPct,
  };
}

export interface OmCalculationSnapshot {
  property: {
    id: string;
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
  rentRoll: OmRentRollRow[];
  expenseRows: ExpenseLineItem[];
  unitModelRows: ResolvedUnitModelRow[];
  expenseModelRows: ResolvedExpenseModelRow[];
  sensitivities: SensitivityAnalysis[];
  yearlyCashFlow: ReturnType<typeof computeUnderwritingProjection>["yearly"];
  acquisition: ReturnType<typeof computeUnderwritingProjection>["acquisition"];
  financing: ReturnType<typeof computeUnderwritingProjection>["financing"];
  operating: ReturnType<typeof computeUnderwritingProjection>["operating"];
  exit: ReturnType<typeof computeUnderwritingProjection>["exit"];
  returns: ReturnType<typeof computeUnderwritingProjection>["returns"];
  recommendedOffer: ReturnType<typeof computeRecommendedOffer>;
  validationMessages: string[];
}

export interface OmCalculationPropertyInput {
  id: string;
  canonicalAddress: string;
  city: string | null;
  askingPrice: number | null;
  listedAt: string | null;
}

export interface RentBreakdownInput {
  currentFinancials: {
    grossRentalIncome: number | null;
  };
  assumptions: {
    propertyMix: {
      freeMarketAnnualRent: number | null;
      rentStabilizedAnnualRent: number | null;
      commercialAnnualRent: number | null;
    };
  };
  projection: Pick<ReturnType<typeof computeUnderwritingProjection>, "assumptions" | "yearly">;
}

export function buildRentBreakdown(artifacts: RentBreakdownInput) {
  return buildSharedRentBreakdown({
    currentGrossRent: artifacts.currentFinancials.grossRentalIncome,
    propertyMix: {
      freeMarketAnnualRent: artifacts.assumptions.propertyMix.freeMarketAnnualRent,
      rentStabilizedAnnualRent: artifacts.assumptions.propertyMix.rentStabilizedAnnualRent,
      commercialAnnualRent: artifacts.assumptions.propertyMix.commercialAnnualRent,
    },
    holdPeriodYears: artifacts.projection.assumptions.holdPeriodYears,
    leadTimeMonths: artifacts.projection.assumptions.operating.leadTimeMonths,
    yearly: artifacts.projection.yearly,
  });
}

export interface ResolvedOmCalculationArtifacts {
  rawDetails: PropertyDetails | null;
  details: PropertyDetails | null;
  source: OmCalculationSnapshot["source"];
  savedAssumptions: PropertyDealDossierAssumptions | null;
  assumptions: ReturnType<typeof resolveDossierAssumptions>;
  detailedModel: ReturnType<typeof resolveDetailedCashFlowModel>;
  currentFinancials: ReturnType<typeof resolveCurrentFinancialsFromDetails>;
  resolvedExpenseTotal: number | null;
  projection: ReturnType<typeof computeUnderwritingProjection>;
  recommendedOffer: ReturnType<typeof computeRecommendedOffer>;
  sensitivities: SensitivityAnalysis[];
}

export async function resolveOmCalculationArtifactsFromInputs(params: {
  profile: UserProfile;
  askingPrice: number | null;
  rawDetails: PropertyDetails | null;
  savedAssumptions?: PropertyDealDossierAssumptions | null;
  assumptionOverrides?: DossierAssumptionOverrides | null;
  brokerEmailNotes?: string | null;
  unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
}): Promise<ResolvedOmCalculationArtifacts> {
  const rawDetails = params.rawDetails ?? null;
  const brokerEmailNotes = trimmedString(params.brokerEmailNotes) ?? getBrokerEmailNotes(rawDetails);
  const brokerNotesExtract = await extractBrokerDossierNotes(brokerEmailNotes);
  const details = mergeBrokerNotesIntoDetails(rawDetails, brokerNotesExtract);
  const hasAuthoritativeOm = getAuthoritativeOmSnapshot(rawDetails) != null;
  const hasBrokerFinancialInputs = brokerNotesSuppliedFinancialInputs(brokerNotesExtract);

  if (!getAuthoritativeOmSnapshot(details)) {
    throw new Error(
      "Authoritative OM snapshot or saved broker email notes required before OM calculation."
    );
  }

  const savedAssumptions = params.savedAssumptions ?? null;
  const mergedAssumptionOverrides =
    params.assumptionOverrides != null
      ? params.assumptionOverrides
      : propertyAssumptionsToOverrides(savedAssumptions);
  const assumptions = resolveDossierAssumptions(
    params.profile,
    params.askingPrice ?? null,
    mergedAssumptionOverrides,
    { details }
  );
  const detailedModel = resolveDetailedCashFlowModel({
    details,
    defaultRentUpliftPct: assumptions.operating.rentUpliftPct,
    defaultVacancyPct: assumptions.operating.vacancyPct,
    defaultAnnualExpenseGrowthPct: assumptions.operating.annualExpenseGrowthPct,
    defaultAnnualPropertyTaxGrowthPct: assumptions.operating.annualPropertyTaxGrowthPct,
    unitModelRows:
      params.unitModelRows !== undefined ? params.unitModelRows : savedAssumptions?.unitModelRows,
    expenseModelRows:
      params.expenseModelRows !== undefined
        ? params.expenseModelRows
        : savedAssumptions?.expenseModelRows,
  });
  const currentFinancials = resolveCurrentFinancialsFromDetails(details);
  const leaseUpRentSummary = resolveProjectedResidentialLeaseUpRentSummary(details);
  const resolvedExpenseTotal = expenseTotal(details) ?? currentFinancials.operatingExpenses;
  const projection = computeUnderwritingProjection({
    assumptions,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentNoi: currentFinancials.noi,
    currentOtherIncome: currentFinancials.otherIncome,
    currentExpensesTotal: resolvedExpenseTotal,
    expenseRows: expenseModelRowsToProjectionRows(detailedModel.expenseModelRows),
    unitRows: unitModelRowsToProjectionRows(detailedModel.unitModelRows),
    conservativeProjectedLeaseUpRent: leaseUpRentSummary.totalAnnualRent,
    protectedProjectedLeaseUpRent: leaseUpRentSummary.protectedAnnualRent,
  });
  const recommendedOffer = computeRecommendedOffer({
    assumptions,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentNoi: currentFinancials.noi,
    currentOtherIncome: currentFinancials.otherIncome,
    currentExpensesTotal: resolvedExpenseTotal,
    expenseRows: expenseModelRowsToProjectionRows(detailedModel.expenseModelRows),
    unitRows: unitModelRowsToProjectionRows(detailedModel.unitModelRows),
    conservativeProjectedLeaseUpRent: leaseUpRentSummary.totalAnnualRent,
    protectedProjectedLeaseUpRent: leaseUpRentSummary.protectedAnnualRent,
  });
  const sensitivities = buildSensitivityAnalyses({
    assumptions: projection.assumptions,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentNoi: currentFinancials.noi,
    currentOtherIncome: currentFinancials.otherIncome,
    currentExpensesTotal: resolvedExpenseTotal,
    expenseRows: expenseModelRowsToProjectionRows(detailedModel.expenseModelRows),
    unitRows: unitModelRowsToProjectionRows(detailedModel.unitModelRows),
    conservativeProjectedLeaseUpRent: leaseUpRentSummary.totalAnnualRent,
    protectedProjectedLeaseUpRent: leaseUpRentSummary.protectedAnnualRent,
    baseProjection: projection,
  });

  return {
    rawDetails,
    details,
    source: {
      hasAuthoritativeOm,
      hasBrokerFinancialInputs,
      sourceLabel: hasAuthoritativeOm
        ? hasBrokerFinancialInputs
          ? "Authoritative OM + broker notes"
          : "Authoritative OM"
        : "Broker notes",
    },
    savedAssumptions,
    assumptions,
    detailedModel,
    currentFinancials,
    resolvedExpenseTotal,
    projection,
    recommendedOffer,
    sensitivities,
  };
}

export function buildOmCalculationSnapshotFromInputs(params: {
  property: OmCalculationPropertyInput;
  artifacts: ResolvedOmCalculationArtifacts;
}): OmCalculationSnapshot {
  const { property, artifacts } = params;
  const {
    details,
    source,
    savedAssumptions,
    assumptions,
    detailedModel,
    currentFinancials,
    projection,
    recommendedOffer,
    sensitivities,
  } = artifacts;

  const modeledPurchasePrice = assumptions.acquisition.purchasePrice;
  const projectedYearNumber = assumptions.holdPeriodYears >= 2 ? 2 : 1;
  const projectedYearRent = projection.yearly.grossRentalIncome[projectedYearNumber] ?? null;
  const projectedYearExpenses = projection.yearly.totalOperatingExpenses[projectedYearNumber] ?? null;
  const projectedYearNoi = projection.yearly.noi[projectedYearNumber] ?? null;
  const currentCapRatePct =
    modeledPurchasePrice != null && modeledPurchasePrice > 0 && currentFinancials.noi != null
      ? (currentFinancials.noi / modeledPurchasePrice) * 100
      : null;
  const stabilizedCapRatePct =
    modeledPurchasePrice != null &&
    modeledPurchasePrice > 0 &&
    projection.operating.stabilizedNoi != null
      ? (projection.operating.stabilizedNoi / modeledPurchasePrice) * 100
      : null;
  const stabilizedNoiIncreasePct =
    currentFinancials.noi != null &&
    currentFinancials.noi !== 0 &&
    projection.operating.stabilizedNoi != null
      ? ((projection.operating.stabilizedNoi - currentFinancials.noi) / currentFinancials.noi) * 100
      : null;
  const totalCurrentRevenue =
    (currentFinancials.grossRentalIncome ?? 0) + (currentFinancials.otherIncome ?? 0);
  const expenseRatioPct =
    currentFinancials.operatingExpenses != null && totalCurrentRevenue > 0
      ? (currentFinancials.operatingExpenses / totalCurrentRevenue) * 100
      : null;

  const infoSummary = buildPropertyInfoSummary(details);
  const rentBreakdown = buildRentBreakdown(artifacts);

  return {
    property: {
      id: property.id,
      canonicalAddress: property.canonicalAddress,
      city: property.city,
      askingPrice: property.askingPrice,
      listedAt: property.listedAt,
    },
    source,
    propertyInfo: {
      ...infoSummary,
      totalUnits: resolvePreferredOmUnitCount(details) ?? assumptions.propertyMix.totalUnits,
      residentialUnits: assumptions.propertyMix.residentialUnits,
      commercialUnits: assumptions.propertyMix.commercialUnits,
      rentStabilizedUnits: assumptions.propertyMix.rentStabilizedUnits,
    },
    savedAssumptions,
    assumptions: flattenedAssumptions(projection.assumptions),
    acquisitionMetadata: {
      investmentProfile: projection.assumptions.acquisition.investmentProfile,
      targetAcquisitionDate: projection.assumptions.acquisition.targetAcquisitionDate,
    },
    currentFinancials: {
      grossRentalIncome: currentFinancials.grossRentalIncome,
      otherIncome: currentFinancials.otherIncome,
      vacancyLoss: currentFinancials.vacancyLoss,
      effectiveGrossIncome: currentFinancials.effectiveGrossIncome,
      operatingExpenses: currentFinancials.operatingExpenses,
      noi: currentFinancials.noi,
      expenseRatioPct,
      currentCapRatePct,
      rentBasis: currentFinancials.rentBasis,
      assumedLongTermOccupancyPct: currentFinancials.assumedLongTermOccupancyPct,
    },
    rentBreakdown,
    topLineMetrics: {
      projectedYearNumber,
      currentRent: currentFinancials.grossRentalIncome,
      currentExpenses: currentFinancials.operatingExpenses,
      currentNoi: currentFinancials.noi,
      currentCapRatePct,
      projectedYearRent,
      projectedYearExpenses,
      projectedYearNoi,
      stabilizedNoi: projection.operating.stabilizedNoi,
      stabilizedNoiIncreasePct,
      stabilizedCapRatePct,
      upfrontCapex:
        (assumptions.acquisition.renovationCosts ?? 0) +
        (projection.assumptions.acquisition.furnishingSetupCosts ?? 0) +
        (projection.assumptions.acquisition.onboardingCosts ?? 0),
      purchaseClosingCosts: projection.acquisition.purchaseClosingCosts,
      financingFees: projection.acquisition.financingFees,
      totalProjectCost: projection.acquisition.totalProjectCost,
      annualDebtService: projection.financing.annualDebtService,
      holdPeriodYears: assumptions.holdPeriodYears,
      irrPct: projection.returns.irr,
      averageCashOnCashReturn: projection.returns.averageCashOnCashReturn,
      year1CashOnCashReturn: projection.returns.year1CashOnCashReturn,
      year1EquityYield: projection.returns.year1EquityYield,
      equityMultiple: projection.returns.equityMultiple,
    },
    rentRoll: rentRollRows(details),
    expenseRows: expenseRows(details),
    unitModelRows: detailedModel.unitModelRows,
    expenseModelRows: detailedModel.expenseModelRows,
    sensitivities,
    yearlyCashFlow: projection.yearly,
    acquisition: projection.acquisition,
    financing: projection.financing,
    operating: projection.operating,
    exit: projection.exit,
    returns: projection.returns,
    recommendedOffer,
    validationMessages: validationMessages(details),
  };
}

export async function buildOmCalculationSnapshot(params: {
  propertyId: string;
  assumptionOverrides?: DossierAssumptionOverrides | null;
  brokerEmailNotes?: string | null;
  unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
}): Promise<OmCalculationSnapshot> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const profileRepo = new UserProfileRepo({ pool });

  const property = await propertyRepo.byId(params.propertyId);
  if (!property) throw new Error("Property not found");

  const { matches } = await matchRepo.list({ propertyId: params.propertyId, limit: 1 });
  const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;

  await profileRepo.ensureDefault();
  const profile = await profileRepo.getDefault();
  if (!profile) throw new Error("Profile not available");

  const rawDetails = property.details as PropertyDetails | null;
  const propertyAssumptions = getPropertyDossierAssumptions(rawDetails);
  const artifacts = await resolveOmCalculationArtifactsFromInputs({
    profile,
    askingPrice: listing?.price ?? null,
    rawDetails,
    savedAssumptions: propertyAssumptions,
    assumptionOverrides: params.assumptionOverrides,
    brokerEmailNotes: params.brokerEmailNotes,
    unitModelRows: params.unitModelRows,
    expenseModelRows: params.expenseModelRows,
  });

  return buildOmCalculationSnapshotFromInputs({
    property: {
      id: property.id,
      canonicalAddress: property.canonicalAddress,
      city: listing?.city ?? null,
      askingPrice: listing?.price ?? null,
      listedAt: listing?.listedAt ?? null,
    },
    artifacts,
  });
}
