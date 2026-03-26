import { randomUUID } from "crypto";
import type {
  OmAnalysis,
  OmAuthoritativeSnapshot,
  OmCoverage,
  OmValidationFlag,
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierUnitModelRow,
  PropertyDetails,
  RentalFinancialsFromLlm,
  UserProfile,
} from "@re-sourcing/contracts";
import { getPool, UserProfileRepo } from "@re-sourcing/db";
import { resolveCurrentFinancialsFromOmAnalysis } from "../rental/currentFinancials.js";
import {
  sanitizeExpenseTableRows,
  sanitizeOmRentRollRows,
} from "../rental/omAnalysisUtils.js";
import { resolveOmPropertyAddress } from "../om/resolveOmPropertyAddress.js";
import {
  buildRentBreakdown,
  buildOmCalculationSnapshotFromInputs,
  resolveOmCalculationArtifactsFromInputs,
  type OmCalculationPropertyInput,
  type OmCalculationSnapshot,
  type ResolvedOmCalculationArtifacts,
} from "./buildOmCalculation.js";
import type { DossierAssumptionOverrides } from "./underwritingModel.js";
import {
  buildDossierStructuredText,
} from "./dossierGenerator.js";
import { buildDossierPdfCoverData } from "./dossierPdfCover.js";
import { buildDossierPdfFileName } from "./dossierFileName.js";
import { dossierTextToPdf } from "./dossierToPdf.js";
import {
  propertyOverviewFromDetails,
  resolveDossierPackageContext,
} from "./dossierPropertyContext.js";
import {
  resolveAssetCapRateNoiBasis,
} from "./underwritingModel.js";
import { resolveProjectedResidentialLeaseUpRentSummary } from "./propertyAssumptions.js";
import type {
  ExpenseRow,
  GrossRentRow,
  UnderwritingContext,
} from "./underwritingContext.js";
import { resolvePreferredOmRentRoll, resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";

export interface StandaloneUploadedOmDocument {
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

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

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function coverageFromOmAnalysis(params: {
  omAnalysis: OmAnalysis;
  currentFinancials: ReturnType<typeof resolveCurrentFinancialsFromOmAnalysis>;
}): OmCoverage {
  const propertyInfo = asRecord(params.omAnalysis.propertyInfo);
  const income = asRecord(params.omAnalysis.income);
  const expenses = asRecord(params.omAnalysis.expenses);
  const sourceCoverage = asRecord(params.omAnalysis.sourceCoverage);
  const rentRoll = sanitizeOmRentRollRows(params.omAnalysis.rentRoll ?? []);
  const expenseRows = sanitizeExpenseTableRows(params.omAnalysis.expenses?.expensesTable ?? []);
  return {
    ...(sourceCoverage ?? {}),
    propertyInfoExtracted:
      toOptionalBoolean(sourceCoverage?.propertyInfoExtracted) ??
      (propertyInfo != null && Object.keys(propertyInfo).length > 0),
    rentRollExtracted: toOptionalBoolean(sourceCoverage?.rentRollExtracted) ?? rentRoll.length > 0,
    incomeStatementExtracted:
      toOptionalBoolean(sourceCoverage?.incomeStatementExtracted) ??
      (income != null && Object.keys(income).length > 0),
    expensesExtracted:
      toOptionalBoolean(sourceCoverage?.expensesExtracted) ??
      (expenseRows.length > 0 || toFiniteNumber(expenses?.totalExpenses) != null),
    currentFinancialsExtracted:
      toOptionalBoolean(sourceCoverage?.currentFinancialsExtracted) ??
      [
        params.currentFinancials.grossRentalIncome,
        params.currentFinancials.operatingExpenses,
        params.currentFinancials.noi,
      ].some((value) => value != null),
    unitCountExtracted:
      toOptionalBoolean(sourceCoverage?.unitCountExtracted) ??
      (toFiniteNumber(propertyInfo?.totalUnits) != null || rentRoll.length > 0),
  };
}

function validationFlagsFromCurrentState(params: {
  currentFinancials: ReturnType<typeof resolveCurrentFinancialsFromOmAnalysis>;
  rentRollRows: ReturnType<typeof sanitizeOmRentRollRows>;
  expenseRows: ReturnType<typeof sanitizeExpenseTableRows>;
}): OmValidationFlag[] {
  const flags: OmValidationFlag[] = [];
  if (params.rentRollRows.length === 0) {
    flags.push({
      flagType: "missing_om_field",
      field: "rentRoll",
      severity: "warning",
      source: "standalone_deal_analysis",
      message: "Rent roll not extracted from the uploaded OM PDF(s).",
    });
  }
  if (params.expenseRows.length === 0 && params.currentFinancials.operatingExpenses == null) {
    flags.push({
      flagType: "missing_om_field",
      field: "operatingExpenses",
      severity: "warning",
      source: "standalone_deal_analysis",
      message: "Operating expenses could not be resolved from the uploaded OM PDF(s).",
    });
  }
  if (params.currentFinancials.noi == null) {
    flags.push({
      flagType: "missing_om_field",
      field: "noi",
      severity: "warning",
      source: "standalone_deal_analysis",
      message: "NOI could not be resolved from the uploaded OM PDF(s).",
    });
  }
  return flags;
}

export function resolveStandaloneAskingPrice(
  omAnalysis: OmAnalysis | null | undefined
): number | null {
  const propertyInfo = asRecord(omAnalysis?.propertyInfo);
  const valuationMetrics = asRecord(omAnalysis?.valuationMetrics);
  const uiFinancialSummary = asRecord(omAnalysis?.uiFinancialSummary);
  return firstFiniteNumber(
    propertyInfo?.price,
    propertyInfo?.askingPrice,
    propertyInfo?.listedPrice,
    propertyInfo?.askPrice,
    valuationMetrics?.price,
    valuationMetrics?.askingPrice,
    valuationMetrics?.listedPrice,
    valuationMetrics?.askPrice,
    uiFinancialSummary?.askingPrice
  );
}

export function buildStandaloneDetailsFromOmAnalysis(params: {
  omAnalysis: OmAnalysis;
  fromLlm?: RentalFinancialsFromLlm | null;
  uploadedDocuments?: StandaloneUploadedOmDocument[];
}): PropertyDetails {
  const currentFinancials = resolveCurrentFinancialsFromOmAnalysis(
    params.omAnalysis,
    params.fromLlm ?? null
  );
  const rentRoll = sanitizeOmRentRollRows(params.omAnalysis.rentRoll ?? []);
  const expenseRows = sanitizeExpenseTableRows(params.omAnalysis.expenses?.expensesTable ?? []);
  const propertyInfo = asRecord(params.omAnalysis.propertyInfo);
  const expenses = asRecord(params.omAnalysis.expenses);
  const taxCode =
    trimmedString(propertyInfo?.taxCode) ??
    trimmedString(propertyInfo?.taxClass) ??
    null;
  const authoritative: OmAuthoritativeSnapshot = {
    id: `standalone-${randomUUID()}`,
    extractionMethod: "hybrid",
    propertyInfo: propertyInfo ?? null,
    rentRoll,
    incomeStatement: asRecord(params.omAnalysis.income),
    expenses: {
      ...(expenses ?? {}),
      expensesTable: expenseRows,
      totalExpenses:
        currentFinancials.operatingExpenses ??
        toFiniteNumber(expenses?.totalExpenses) ??
        null,
    },
    revenueComposition: asRecord(params.omAnalysis.revenueComposition),
    currentFinancials: {
      noi: currentFinancials.noi,
      grossRentalIncome: currentFinancials.grossRentalIncome,
      otherIncome: currentFinancials.otherIncome,
      vacancyLoss: currentFinancials.vacancyLoss,
      effectiveGrossIncome: currentFinancials.effectiveGrossIncome,
      operatingExpenses: currentFinancials.operatingExpenses,
      rentBasis: currentFinancials.rentBasis,
      assumedLongTermOccupancyPct: currentFinancials.assumedLongTermOccupancyPct,
      reportedOccupancyPct: currentFinancials.reportedOccupancyPct,
      reportedVacancyPct: currentFinancials.reportedVacancyPct,
    },
    validationFlags: validationFlagsFromCurrentState({
      currentFinancials,
      rentRollRows: rentRoll,
      expenseRows,
    }),
    coverage: coverageFromOmAnalysis({
      omAnalysis: params.omAnalysis,
      currentFinancials,
    }),
    sourceMeta: {
      parser: {
        provider: "gemini",
        mode: "standalone_deal_analysis",
      },
      uploadedDocuments:
        params.uploadedDocuments?.map((document) => ({
          fileName: document.fileName,
          mimeType: document.mimeType ?? null,
          sizeBytes: document.sizeBytes ?? null,
        })) ?? [],
    },
    promotedAt: new Date().toISOString(),
    reportedDiscrepancies: Array.isArray(params.omAnalysis.reportedDiscrepancies)
      ? params.omAnalysis.reportedDiscrepancies
      : null,
    uiFinancialSummary: asRecord(params.omAnalysis.uiFinancialSummary),
    valuationMetrics: asRecord(params.omAnalysis.valuationMetrics),
    financialMetrics: asRecord(params.omAnalysis.financialMetrics),
    underwritingMetrics: asRecord(params.omAnalysis.underwritingMetrics),
    furnishedModel: asRecord(params.omAnalysis.furnishedModel),
    investmentTakeaways: Array.isArray(params.omAnalysis.investmentTakeaways)
      ? params.omAnalysis.investmentTakeaways
      : null,
    dossierMemo: asRecord(params.omAnalysis.dossierMemo),
    noiReported: toFiniteNumber(params.omAnalysis.noiReported),
  };

  return {
    taxCode,
    omData: {
      status: "promoted",
      snapshotVersion: 1,
      lastProcessedAt: authoritative.promotedAt ?? new Date().toISOString(),
      authoritative,
    },
    rentalFinancials: {
      fromLlm: params.fromLlm ?? null,
      omAnalysis: params.omAnalysis,
      source: "llm",
      lastUpdatedAt: authoritative.promotedAt ?? new Date().toISOString(),
    },
  };
}

export function resolveStandalonePropertyInput(params: {
  omAnalysis: OmAnalysis | null | undefined;
  details: PropertyDetails | null | undefined;
}): OmCalculationPropertyInput {
  const propertyInfo = asRecord(params.omAnalysis?.propertyInfo);
  const resolvedAddress = resolveOmPropertyAddress(propertyInfo);
  const fallbackAddress =
    trimmedString(propertyInfo?.packageAddress) ??
    trimmedString(propertyInfo?.addressLine) ??
    trimmedString(propertyInfo?.address) ??
    "Uploaded OM workspace";
  return {
    id: "standalone-om-analysis",
    canonicalAddress: resolvedAddress?.canonicalAddress ?? fallbackAddress,
    city: resolvedAddress?.locality ?? null,
    askingPrice: resolveStandaloneAskingPrice(params.omAnalysis),
    listedAt: null,
  };
}

export async function getDefaultUserProfile(): Promise<UserProfile> {
  const pool = getPool();
  const profileRepo = new UserProfileRepo({ pool });
  await profileRepo.ensureDefault();
  const profile = await profileRepo.getDefault();
  if (!profile) throw new Error("Profile not available");
  return profile;
}

export async function buildStandaloneOmCalculation(params: {
  property: OmCalculationPropertyInput;
  details: PropertyDetails | null;
  profile?: UserProfile | null;
  assumptionOverrides?: DossierAssumptionOverrides | null;
  brokerEmailNotes?: string | null;
  unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
}): Promise<{
  profile: UserProfile;
  artifacts: ResolvedOmCalculationArtifacts;
  calculation: OmCalculationSnapshot;
}> {
  const profile = params.profile ?? (await getDefaultUserProfile());
  const artifacts = await resolveOmCalculationArtifactsFromInputs({
    profile,
    askingPrice: params.property.askingPrice,
    rawDetails: params.details ?? null,
    savedAssumptions: null,
    assumptionOverrides: params.assumptionOverrides,
    brokerEmailNotes: params.brokerEmailNotes,
    unitModelRows: params.unitModelRows,
    expenseModelRows: params.expenseModelRows,
  });
  const calculation = buildOmCalculationSnapshotFromInputs({
    property: params.property,
    artifacts,
  });
  return { profile, artifacts, calculation };
}

function rentRollRowsFromDetails(details: PropertyDetails | null): GrossRentRow[] {
  const cleanRows = resolvePreferredOmRentRoll(details);
  if (cleanRows.length === 0) return [];
  const rows: GrossRentRow[] = [];
  for (const row of cleanRows) {
    const annual =
      row.annualTotalRent ??
      row.annualBaseRent ??
      row.annualRent ??
      (row.monthlyTotalRent != null ? row.monthlyTotalRent * 12 : null) ??
      (row.monthlyBaseRent != null ? row.monthlyBaseRent * 12 : null) ??
      (row.monthlyRent != null ? row.monthlyRent * 12 : null) ??
      null;
    const parts = [trimmedString(row.building), trimmedString(row.unit) ?? trimmedString(row.tenantName) ?? `Unit ${rows.length + 1}`].filter(
      (value): value is string => Boolean(value)
    );
    const qualifiers = [
      trimmedString(row.unitCategory),
      trimmedString(row.leaseType),
      trimmedString(row.leaseEndDate) ? `Lease ends ${trimmedString(row.leaseEndDate)}` : null,
      trimmedString(row.notes),
    ].filter((value): value is string => Boolean(value));
    const label =
      qualifiers.length > 0 ? `${parts.join(" - ")} (${qualifiers.join("; ")})` : parts.join(" - ");
    if (annual != null) rows.push({ label, annualRent: annual });
  }
  return rows;
}

function authoritativeValidationMessages(details: PropertyDetails | null): string[] {
  const flags = details?.omData?.authoritative?.validationFlags;
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => trimmedString(flag.message))
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);
}

function financialFlagsFromArtifacts(artifacts: ResolvedOmCalculationArtifacts): string[] {
  const flags: string[] = [];
  const purchasePrice = artifacts.projection.assumptions.acquisition.purchasePrice;
  if (purchasePrice != null) {
    flags.push(
      `Expected purchase price: $${purchasePrice.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      })}`
    );
  }
  flags.push(`Source: ${artifacts.source.sourceLabel}`);
  if (artifacts.currentFinancials.reportedOccupancyPct != null) {
    flags.push(
      `Reported current occupancy from OM: ${artifacts.currentFinancials.reportedOccupancyPct.toFixed(1)}%`
    );
  } else if (artifacts.currentFinancials.reportedVacancyPct != null) {
    flags.push(
      `Reported vacancy from OM: ${artifacts.currentFinancials.reportedVacancyPct.toFixed(1)}%`
    );
  }
  const mix = artifacts.projection.assumptions.propertyMix;
  if (mix.commercialUnits > 0 || mix.rentStabilizedUnits > 0) {
    const protectedParts: string[] = [];
    if (mix.commercialUnits > 0) protectedParts.push(`${mix.commercialUnits} commercial`);
    if (mix.rentStabilizedUnits > 0) {
      protectedParts.push(`${mix.rentStabilizedUnits} rent-stabilized`);
    }
    flags.push(
      `${protectedParts.join(" + ")} unit(s) excluded from residential uplift; modeled blended uplift is ${artifacts.projection.assumptions.operating.blendedRentUpliftPct.toFixed(2)}%`
    );
  }
  flags.push(...authoritativeValidationMessages(artifacts.details));
  return flags;
}

export async function buildStandaloneUnderwritingContext(params: {
  property: OmCalculationPropertyInput;
  details: PropertyDetails | null;
  profile?: UserProfile | null;
  assumptionOverrides?: DossierAssumptionOverrides | null;
  brokerEmailNotes?: string | null;
  unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
}): Promise<{
  ctx: UnderwritingContext;
  profile: UserProfile;
  artifacts: ResolvedOmCalculationArtifacts;
}> {
  const { profile, artifacts } = await buildStandaloneOmCalculation(params);
  const details = artifacts.details;
  const currentGrossRent = artifacts.currentFinancials.grossRentalIncome;
  const currentNoi = artifacts.currentFinancials.noi;
  const currentOtherIncome = artifacts.currentFinancials.otherIncome;
  const packageContext = resolveDossierPackageContext(params.property.canonicalAddress, details);
  const propertyOverview = propertyOverviewFromDetails(details, packageContext);
  const leaseUpRentSummary = resolveProjectedResidentialLeaseUpRentSummary(details);
  const conservativeProjectedLeaseUpRent =
    leaseUpRentSummary.totalAnnualRent != null && leaseUpRentSummary.totalAnnualRent > 0
      ? leaseUpRentSummary.totalAnnualRent
      : null;
  const assetCapRateNoiBasis = resolveAssetCapRateNoiBasis({
    currentNoi,
    currentGrossRent,
    currentOtherIncome,
    currentExpensesTotal: artifacts.resolvedExpenseTotal,
    conservativeProjectedLeaseUpRent,
  });
  const assetCapRate =
    artifacts.projection.assumptions.acquisition.purchasePrice != null &&
    assetCapRateNoiBasis != null &&
    assetCapRateNoiBasis >= 0
      ? (assetCapRateNoiBasis / artifacts.projection.assumptions.acquisition.purchasePrice) * 100
      : null;
  const adjustedCapRate =
    artifacts.projection.assumptions.acquisition.purchasePrice != null &&
    artifacts.projection.operating.stabilizedNoi >= 0
      ? (artifacts.projection.operating.stabilizedNoi /
          artifacts.projection.assumptions.acquisition.purchasePrice) *
        100
      : null;
  const amortizationSchedule =
    artifacts.projection.financing.amortizationSchedule.length > 0
      ? artifacts.projection.financing.amortizationSchedule.map((row) => ({
          year: row.year,
          principalPayment: row.principalPayment,
          interestPayment: row.interestPayment,
          debtService: row.debtService,
          endingBalance: row.endingBalance,
        }))
      : undefined;
  const ctx: UnderwritingContext = {
    propertyId: params.property.id,
    canonicalAddress: packageContext.dossierAddress,
    purchasePrice: artifacts.projection.assumptions.acquisition.purchasePrice,
    listingCity: params.property.city,
    currentNoi,
    currentGrossRent,
    currentOtherIncome,
    unitCount: resolvePreferredOmUnitCount(details),
    dealScore: null,
    conservativeProjectedLeaseUpRent,
    currentStateNoi: assetCapRateNoiBasis,
    assetCapRateNoiBasis,
    assetCapRate,
    adjustedCapRate,
    assumptions: {
      acquisition: {
        purchasePrice: artifacts.projection.assumptions.acquisition.purchasePrice,
        purchaseClosingCostPct: artifacts.projection.assumptions.acquisition.purchaseClosingCostPct,
        renovationCosts: artifacts.projection.assumptions.acquisition.renovationCosts,
        furnishingSetupCosts: artifacts.projection.assumptions.acquisition.furnishingSetupCosts,
        onboardingCosts: artifacts.projection.assumptions.acquisition.onboardingCosts,
        investmentProfile: artifacts.projection.assumptions.acquisition.investmentProfile,
        targetAcquisitionDate: artifacts.projection.assumptions.acquisition.targetAcquisitionDate,
      },
      financing: {
        ltvPct: artifacts.projection.assumptions.financing.ltvPct,
        interestRatePct: artifacts.projection.assumptions.financing.interestRatePct,
        amortizationYears: artifacts.projection.assumptions.financing.amortizationYears,
        loanFeePct: artifacts.projection.assumptions.financing.loanFeePct,
      },
      operating: {
        rentUpliftPct: artifacts.projection.assumptions.operating.rentUpliftPct,
        blendedRentUpliftPct: artifacts.projection.assumptions.operating.blendedRentUpliftPct,
        expenseIncreasePct: artifacts.projection.assumptions.operating.expenseIncreasePct,
        managementFeePct: artifacts.projection.assumptions.operating.managementFeePct,
        occupancyTaxPct: artifacts.projection.assumptions.operating.occupancyTaxPct,
        vacancyPct: artifacts.projection.assumptions.operating.vacancyPct,
        leadTimeMonths: artifacts.projection.assumptions.operating.leadTimeMonths,
        annualRentGrowthPct: artifacts.projection.assumptions.operating.annualRentGrowthPct,
        annualCommercialRentGrowthPct:
          artifacts.projection.assumptions.operating.annualCommercialRentGrowthPct,
        annualOtherIncomeGrowthPct:
          artifacts.projection.assumptions.operating.annualOtherIncomeGrowthPct,
        annualExpenseGrowthPct:
          artifacts.projection.assumptions.operating.annualExpenseGrowthPct,
        annualPropertyTaxGrowthPct:
          artifacts.projection.assumptions.operating.annualPropertyTaxGrowthPct,
        recurringCapexAnnual: artifacts.projection.assumptions.operating.recurringCapexAnnual,
      },
      holdPeriodYears: artifacts.projection.assumptions.holdPeriodYears,
      targetIrrPct: artifacts.projection.assumptions.targetIrrPct,
      exit: {
        exitCapPct: artifacts.projection.assumptions.exit.exitCapPct,
        exitClosingCostPct: artifacts.projection.assumptions.exit.exitClosingCostPct,
      },
    },
    acquisition: artifacts.projection.acquisition,
    financing: {
      loanAmount: artifacts.projection.financing.loanAmount,
      financingFees: artifacts.projection.financing.financingFees,
      monthlyPayment: artifacts.projection.financing.monthlyPayment,
      annualDebtService: artifacts.projection.financing.annualDebtService,
      remainingLoanBalanceAtExit: artifacts.projection.financing.remainingLoanBalanceAtExit,
      principalPaydownAtExit: artifacts.projection.financing.principalPaydownAtExit,
    },
    operating: {
      ...artifacts.projection.operating,
      currentOtherIncome: artifacts.projection.operating.currentOtherIncome,
    },
    exit: {
      ...artifacts.projection.exit,
      principalPaydownToDate: artifacts.projection.exit.principalPaydownToDate,
    },
    cashFlows: {
      ...artifacts.projection.cashFlows,
      annualPrincipalPaydown: artifacts.projection.cashFlows.annualPrincipalPaydown,
      annualPrincipalPaydowns: artifacts.projection.cashFlows.annualPrincipalPaydowns,
      annualEquityGain: artifacts.projection.cashFlows.annualEquityGain,
      annualEquityGains: artifacts.projection.cashFlows.annualEquityGains,
      annualUnleveredCashFlows: artifacts.projection.cashFlows.annualUnleveredCashFlows,
      unleveredCashFlowSeries: artifacts.projection.cashFlows.unleveredCashFlowSeries,
    },
    returns: {
      irrPct: artifacts.projection.returns.irr,
      equityMultiple: artifacts.projection.returns.equityMultiple,
      year1CashOnCashReturn: artifacts.projection.returns.year1CashOnCashReturn,
      averageCashOnCashReturn: artifacts.projection.returns.averageCashOnCashReturn,
      year1EquityYield: artifacts.projection.returns.year1EquityYield,
      averageEquityYield: artifacts.projection.returns.averageEquityYield,
    },
    propertyOverview: propertyOverview ?? undefined,
    rentRollRows: rentRollRowsFromDetails(details),
    expenseRows:
      artifacts.detailedModel.expenseModelRows.length > 0
        ? artifacts.detailedModel.expenseModelRows
            .filter((row) => row.amount != null)
            .map<ExpenseRow>((row) => ({
              lineItem: row.lineItem,
              amount: row.amount ?? 0,
              annualGrowthPct: row.annualGrowthPct,
              treatment: row.treatment,
            }))
        : undefined,
    currentExpensesTotal: artifacts.resolvedExpenseTotal ?? undefined,
    financialFlags: financialFlagsFromArtifacts(artifacts),
    amortizationSchedule,
    sensitivities: artifacts.sensitivities,
    yearlyCashFlow: artifacts.projection.yearly,
    propertyMix: artifacts.projection.assumptions.propertyMix,
    rentBreakdown: buildRentBreakdown(artifacts),
    recommendedOffer: artifacts.recommendedOffer,
  };

  return { ctx, profile, artifacts };
}

export async function buildStandaloneDossierPdf(params: {
  property: OmCalculationPropertyInput;
  details: PropertyDetails | null;
  profile?: UserProfile | null;
  assumptionOverrides?: DossierAssumptionOverrides | null;
  brokerEmailNotes?: string | null;
  unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
}): Promise<{
  buffer: Buffer;
  fileName: string;
  ctx: UnderwritingContext;
}> {
  const { ctx } = await buildStandaloneUnderwritingContext(params);
  const dossierText = buildDossierStructuredText(ctx);
  const dossierCover = buildDossierPdfCoverData({
    ctx,
    details: params.details ?? null,
    listing: null,
  });
  const buffer = await dossierTextToPdf(dossierText, { cover: dossierCover });
  const fileName = buildDossierPdfFileName(params.property.canonicalAddress);
  return { buffer, fileName, ctx };
}
