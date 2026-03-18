/**
 * Orchestrate generate-dossier: load property/list/profile, run underwriting, build Excel + dossier, save to disk and DB.
 */

import type {
  PropertyDealDossierGeneration,
  PropertyDealDossierSummary,
  PropertyDetails,
} from "@re-sourcing/contracts";
import { deriveListingActivitySummary, describeListingActivity } from "@re-sourcing/contracts";
import {
  getPool,
  PropertyRepo,
  MatchRepo,
  ListingRepo,
  UserProfileRepo,
  DealSignalsRepo,
  DealScoreOverridesRepo,
  DocumentRepo,
} from "@re-sourcing/db";
import { randomUUID } from "crypto";
import {
  getAuthoritativeOmSnapshot,
  resolvePreferredOmExpenseTable,
  resolvePreferredOmExpenseTotal,
  resolvePreferredOmPropertyInfo,
  resolvePreferredOmRentRoll,
  resolvePreferredOmRevenueComposition,
  resolvePreferredOmUnitCount,
} from "../om/authoritativeOm.js";
import { resolveCurrentFinancialsFromDetails } from "../rental/currentFinancials.js";
import { computeDealSignals } from "./computeDealSignals.js";
import { buildDealScoreSensitivity } from "./dealScoreSensitivity.js";
import { resolveEffectiveDealScore } from "./effectiveDealScore.js";
import { buildDossierStructuredText } from "./dossierGenerator.js";
import { dossierTextToPdf } from "./dossierToPdf.js";
import { buildExcelProForma } from "./excelProForma.js";
import { deleteGeneratedDocumentFile, saveGeneratedDocument } from "./generatedDocStorage.js";
import { buildSensitivityAnalyses } from "./sensitivityAnalysis.js";
import {
  propertyOverviewFromDetails,
  resolveDossierPackageContext,
} from "./dossierPropertyContext.js";
import {
  getPropertyDossierAssumptions,
  mergeDossierAssumptionOverrides,
  propertyAssumptionsToOverrides,
} from "./propertyDossierState.js";
import { resolveConservativeProjectedResidentialLeaseUpRent } from "./propertyAssumptions.js";
import {
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveAssetCapRateNoiBasis,
  resolveDossierAssumptions,
  type DossierAssumptionOverrides,
} from "./underwritingModel.js";
import type {
  ExpenseRow,
  GrossRentRow,
  UnderwritingContext,
} from "./underwritingContext.js";

export interface GenerateDossierResult {
  dossierDoc: { id: string; fileName: string; storagePath: string };
  excelDoc: { id: string; fileName: string; storagePath: string };
  /** Deal score 0–100 from the deterministic scoring engine; included so UI can confirm it flowed through. */
  dealScore: number | null;
  /** Legacy field retained for API compatibility; browser-triggered dossier runs no longer send email. */
  emailSent?: boolean;
}

export interface RunGenerateDossierOptions {
  sendEmail?: boolean;
}

function runningGenerationState(
  startedAt: string,
  stageLabel: string
): PropertyDealDossierGeneration {
  return {
    status: "running",
    stageLabel,
    startedAt,
    completedAt: null,
    lastError: null,
    dealScore: null,
    dossierDocumentId: null,
    excelDocumentId: null,
  };
}

function buildPersistedDossierSummary(params: {
  generatedAt: string;
  dealSignalsId: string;
  dealSignalsGeneratedAt: string;
  dossierDocumentId: string;
  excelDocumentId: string;
  askingPrice: number | null;
  purchasePrice: number | null;
  recommendedOffer: ReturnType<typeof computeRecommendedOffer>;
  projection: ReturnType<typeof computeUnderwritingProjection>;
  currentNoi: number | null;
  adjustedNoi: number | null;
  finalScore: number | null;
  calculatedScore: number | null;
  holdYears: number;
}): PropertyDealDossierSummary {
  return {
    generatedAt: params.generatedAt,
    askingPrice: params.askingPrice,
    purchasePrice: params.purchasePrice,
    recommendedOfferLow: params.recommendedOffer.recommendedOfferLow,
    recommendedOfferHigh: params.recommendedOffer.recommendedOfferHigh,
    targetIrrPct: params.recommendedOffer.targetIrrPct,
    discountToAskingPct: params.recommendedOffer.discountToAskingPct,
    irrAtAskingPct: params.recommendedOffer.irrAtAskingPct,
    targetMetAtAsking: params.recommendedOffer.targetMetAtAsking,
    currentNoi: params.currentNoi,
    adjustedNoi: params.adjustedNoi,
    stabilizedNoi: params.projection.operating.stabilizedNoi ?? params.adjustedNoi,
    annualDebtService: params.projection.financing.annualDebtService,
    year1EquityYield: params.projection.returns.year1EquityYield,
    irrPct: params.projection.returns.irr,
    equityMultiple: params.projection.returns.equityMultiple,
    cocPct: params.projection.returns.averageCashOnCashReturn,
    holdYears: params.holdYears,
    dealScore: params.finalScore,
    calculatedDealScore: params.calculatedScore,
    dealSignalsId: params.dealSignalsId,
    dealSignalsGeneratedAt: params.dealSignalsGeneratedAt,
    dossierDocumentId: params.dossierDocumentId,
    excelDocumentId: params.excelDocumentId,
  };
}

function unitCountFromDetails(details: PropertyDetails | null): number | null {
  return resolvePreferredOmUnitCount(details);
}

function rentRollRowsFromDetails(
  details: PropertyDetails | null,
  _currentGrossRent: number | null
): GrossRentRow[] {
  const cleanRows = resolvePreferredOmRentRoll(details);
  if (cleanRows.length === 0) return [];
  const rows: GrossRentRow[] = [];
  for (const r of cleanRows) {
    const annual =
      (r as {
        annualTotalRent?: number;
        annualBaseRent?: number;
        annualRent?: number;
        monthlyTotalRent?: number;
        monthlyBaseRent?: number;
        monthlyRent?: number;
        rent?: number;
      }).annualTotalRent ??
      (r as { annualBaseRent?: number }).annualBaseRent ??
      (r as { annualRent?: number }).annualRent ??
      ((r as { monthlyTotalRent?: number }).monthlyTotalRent != null
        ? (r as { monthlyTotalRent: number }).monthlyTotalRent * 12
        : null) ??
      ((r as { monthlyBaseRent?: number }).monthlyBaseRent != null
        ? (r as { monthlyBaseRent: number }).monthlyBaseRent * 12
        : null) ??
      ((r as { monthlyRent?: number }).monthlyRent != null
        ? (r as { monthlyRent: number }).monthlyRent * 12
        : null) ??
      ((r as { rent?: number }).rent != null ? (r as { rent: number }).rent * 12 : null);
    const parts: string[] = [];
    const building = (r as { building?: string }).building;
    if (building) parts.push(building);
    const unit = (r as { unit?: string }).unit;
    const tenantName = (r as { tenantName?: string }).tenantName;
    parts.push(unit ?? tenantName ?? `Unit ${rows.length + 1}`);
    const qualifiers = [
      (r as { unitCategory?: string }).unitCategory,
      (r as { leaseType?: string }).leaseType,
      (r as { leaseEndDate?: string }).leaseEndDate
        ? `Lease ends ${(r as { leaseEndDate: string }).leaseEndDate}`
        : null,
      (r as { notes?: string }).notes,
    ].filter((value): value is string => typeof value === "string" && value.trim() !== "");
    const label = qualifiers.length > 0 ? `${parts.join(" - ")} (${qualifiers.join("; ")})` : parts.join(" - ");
    if (annual != null && !Number.isNaN(annual)) rows.push({ label, annualRent: annual });
  }
  return rows;
}

function expenseRowsFromDetails(details: PropertyDetails | null): { rows: ExpenseRow[]; total: number } {
  const table = resolvePreferredOmExpenseTable(details);
  if (!table || !Array.isArray(table)) {
    return { rows: [], total: resolvePreferredOmExpenseTotal(details) ?? 0 };
  }
  const rows: ExpenseRow[] = table.map((e) => ({
    lineItem: e.lineItem ?? "—",
    amount: typeof e.amount === "number" ? e.amount : 0,
  }));
  const total = resolvePreferredOmExpenseTotal(details) ?? rows.reduce((sum, row) => sum + row.amount, 0);
  return { rows, total };
}

function omRevenueMixFlag(details: PropertyDetails | null): string | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details) ?? undefined;
  const revenue = resolvePreferredOmRevenueComposition(details) ?? undefined;
  const unitsResidential =
    typeof propertyInfo?.unitsResidential === "number" ? propertyInfo.unitsResidential : null;
  const unitsCommercial =
    typeof propertyInfo?.unitsCommercial === "number" ? propertyInfo.unitsCommercial : null;
  const commercialMonthly =
    typeof revenue?.commercialMonthlyRent === "number" ? revenue.commercialMonthlyRent : null;
  const totalMonthly =
    typeof revenue?.residentialMonthlyRent === "number" || commercialMonthly != null
      ? ((revenue?.residentialMonthlyRent as number | undefined) ?? 0) + (commercialMonthly ?? 0)
      : null;
  const commercialShare =
    typeof revenue?.commercialRevenueShare === "number"
      ? revenue.commercialRevenueShare
      : totalMonthly && commercialMonthly != null && totalMonthly > 0
        ? commercialMonthly / totalMonthly
        : null;
  const parts: string[] = [];
  if (unitsResidential != null || unitsCommercial != null) {
    parts.push(`Mixed-use: ${unitsResidential ?? "—"} residential / ${unitsCommercial ?? "—"} commercial`);
  }
  if (commercialMonthly != null) {
    const shareLabel =
      commercialShare != null
        ? ` (${(commercialShare > 1 ? commercialShare : commercialShare * 100).toFixed(1)}% of monthly rent)`
        : "";
    parts.push(
      `Commercial rent: $${commercialMonthly.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      })}/mo${shareLabel}`
    );
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function authoritativeValidationMessages(details: PropertyDetails | null): string[] {
  const flags = getAuthoritativeOmSnapshot(details)?.validationFlags;
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => {
      const field = typeof flag?.field === "string" ? flag.field : "OM data";
      const brokerValue =
        typeof flag?.brokerValue === "string" || typeof flag?.brokerValue === "number"
          ? String(flag.brokerValue)
          : null;
      const externalValue =
        typeof flag?.externalValue === "string" || typeof flag?.externalValue === "number"
          ? String(flag.externalValue)
          : null;
      const message =
        typeof flag?.message === "string" && flag.message.trim().length > 0
          ? flag.message.trim()
          : null;
      const compared = [brokerValue, externalValue].filter(Boolean).join(" vs ");
      if (message) return message;
      if (compared) return `Verify ${field}: ${compared}`;
      return `Verify ${field}`;
    })
    .slice(0, 5);
}

function omDiscrepancyFlag(details: PropertyDetails | null): string | null {
  const authoritativeFlag = getAuthoritativeOmSnapshot(details)?.validationFlags?.[0] as
    | {
        field?: unknown;
        brokerValue?: unknown;
        externalValue?: unknown;
        message?: unknown;
      }
    | undefined;
  if (authoritativeFlag) {
    const field = typeof authoritativeFlag.field === "string" ? authoritativeFlag.field : "OM data";
    const brokerValue =
      typeof authoritativeFlag.brokerValue === "string" || typeof authoritativeFlag.brokerValue === "number"
        ? String(authoritativeFlag.brokerValue)
        : null;
    const externalValue =
      typeof authoritativeFlag.externalValue === "string" || typeof authoritativeFlag.externalValue === "number"
        ? String(authoritativeFlag.externalValue)
        : null;
    const message =
      typeof authoritativeFlag.message === "string" && authoritativeFlag.message.trim().length > 0
        ? authoritativeFlag.message.trim()
        : null;
    const compared = [brokerValue, externalValue].filter(Boolean).join(" vs ");
    if (message) return message;
    if (compared) return `Verify ${field}: ${compared}`;
    return `Verify ${field}`;
  }
  return null;
}

const RENT_STAB_PATTERN = /rent\s+stabiliz/i;

function detectRentStabilization(details: PropertyDetails | null, dossierText?: string | null): boolean {
  const preferredRoll = resolvePreferredOmRentRoll(details);
  for (const row of preferredRoll) {
    const label = [row.rentType, row.notes, row.tenantStatus].filter(Boolean).join(" ");
    if (RENT_STAB_PATTERN.test(label)) return true;
  }
  const revenue = resolvePreferredOmRevenueComposition(details);
  const rentStabilizedUnits = typeof revenue?.rentStabilizedUnits === "number" ? revenue.rentStabilizedUnits : null;
  if (rentStabilizedUnits != null && rentStabilizedUnits > 0) {
    return true;
  }
  if (dossierText && RENT_STAB_PATTERN.test(dossierText)) return true;
  return false;
}

function rentStabilizedUnitCount(
  details: PropertyDetails | null,
  _dossierText: string | null,
  anyRentStab: boolean
): number {
  const roll = resolvePreferredOmRentRoll(details);
  if (Array.isArray(roll)) {
    let count = 0;
    for (const row of roll) {
      const haystack = [(row as { notes?: string }).notes, (row as { rentType?: string }).rentType]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ");
      if (RENT_STAB_PATTERN.test(haystack)) count++;
    }
    if (count > 0) return count;
  }
  return anyRentStab ? 1 : 0;
}

export async function runGenerateDossier(
  propertyId: string,
  assumptionOverrides?: DossierAssumptionOverrides | null,
  _options?: RunGenerateDossierOptions
): Promise<GenerateDossierResult> {
  const generationStartedAtMs = Date.now();
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const profileRepo = new UserProfileRepo({ pool });
  const signalsRepo = new DealSignalsRepo({ pool });
  const overridesRepo = new DealScoreOverridesRepo({ pool });
  const documentRepo = new DocumentRepo({ pool });

  const property = await propertyRepo.byId(propertyId);
  if (!property) throw new Error("Property not found");

  const startedAt = new Date().toISOString();
  const setGenerationState = async (state: PropertyDealDossierGeneration): Promise<void> => {
    await propertyRepo.updateDetails(
      propertyId,
      "dealDossier.generation",
      state as Record<string, unknown>
    );
  };
  const deleteSupersededGeneratedDocuments = async (retainIds: string[]): Promise<void> => {
    const generatedDocs = (await documentRepo.listByPropertyId(propertyId)).filter(
      (doc) => doc.source === "generated_dossier" || doc.source === "generated_excel"
    );
    for (const doc of generatedDocs) {
      if (retainIds.includes(doc.id)) continue;
      await documentRepo.delete(doc.id);
      await deleteGeneratedDocumentFile(doc.storagePath);
    }
  };

  await setGenerationState(runningGenerationState(startedAt, "Preparing property inputs"));

  try {
    const { matches } = await matchRepo.list({ propertyId, limit: 1 });
    const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;
    const purchasePrice = listing?.price ?? null;
    const listingCity = listing?.city ?? null;

    await profileRepo.ensureDefault();
    const profile = await profileRepo.getDefault();
    if (!profile) throw new Error("Profile not available");

    const details = property.details as PropertyDetails | null;
    if (!getAuthoritativeOmSnapshot(details)) {
      throw new Error("Authoritative OM snapshot required before dossier generation and deal scoring.");
    }
    const currentFinancials = resolveCurrentFinancialsFromDetails(details);
    const currentNoi = currentFinancials.noi;
    const currentGrossRent = currentFinancials.grossRentalIncome;
    const currentOtherIncome = currentFinancials.otherIncome;
    const unitCount = unitCountFromDetails(details);
    const rentRollRows = rentRollRowsFromDetails(details, currentGrossRent);
    const { rows: expenseRows, total: extractedExpenseTotal } = expenseRowsFromDetails(details);
    const propertyAssumptionOverrides = propertyAssumptionsToOverrides(
      getPropertyDossierAssumptions(details)
    );
    const mergedAssumptionOverrides = mergeDossierAssumptionOverrides(
      propertyAssumptionOverrides,
      assumptionOverrides
    );

    await setGenerationState(runningGenerationState(startedAt, "Running underwriting model"));
    const assumptions = resolveDossierAssumptions(
      profile,
      purchasePrice,
      mergedAssumptionOverrides,
      { details }
    );
    const conservativeProjectedLeaseUpRent = resolveConservativeProjectedResidentialLeaseUpRent(details);
    const resolvedCurrentExpensesTotal =
      extractedExpenseTotal > 0 ? extractedExpenseTotal : currentFinancials.operatingExpenses;
    const projection = computeUnderwritingProjection({
      assumptions,
      currentGrossRent,
      currentNoi,
      currentOtherIncome,
      currentExpensesTotal: resolvedCurrentExpensesTotal,
      expenseRows,
      conservativeProjectedLeaseUpRent,
    });
    const recommendedOffer = computeRecommendedOffer({
      assumptions,
      currentGrossRent,
      currentNoi,
      currentOtherIncome,
      currentExpensesTotal: resolvedCurrentExpensesTotal,
      expenseRows,
      conservativeProjectedLeaseUpRent,
    });
    const sensitivities = buildSensitivityAnalyses({
      assumptions,
      currentGrossRent,
      currentNoi,
      currentOtherIncome,
      currentExpensesTotal: resolvedCurrentExpensesTotal,
      expenseRows,
      conservativeProjectedLeaseUpRent,
      baseProjection: projection,
    });
    console.info("[runGenerateDossier] Financial model prepared", {
      propertyId,
      durationMs: Date.now() - generationStartedAtMs,
      hasCurrentGrossRent: currentGrossRent != null,
      hasCurrentNoi: currentNoi != null,
      rentRollRowCount: rentRollRows.length,
      expenseRowCount: expenseRows.length,
    });

    const packageContext = resolveDossierPackageContext(property.canonicalAddress, details);
    const propertyOverview = propertyOverviewFromDetails(details, packageContext);
    const financialFlags: string[] = [];
    const hasCurrentFinancials = currentGrossRent != null && currentNoi != null;
    const assetCapRateNoiBasis = resolveAssetCapRateNoiBasis({
      currentNoi,
      conservativeProjectedLeaseUpRent,
    });
    const listingActivity = deriveListingActivitySummary({
      listedAt: listing?.listedAt ?? null,
      currentPrice: listing?.price ?? null,
      priceHistory: listing?.priceHistory ?? null,
    });

    if (assumptions.acquisition.purchasePrice != null) {
      financialFlags.push(
        `Purchase price: $${assumptions.acquisition.purchasePrice.toLocaleString("en-US", {
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        })}`
      );
    }
    if (conservativeProjectedLeaseUpRent != null && conservativeProjectedLeaseUpRent > 0) {
      financialFlags.push(
        `Cap rate includes $${conservativeProjectedLeaseUpRent.toLocaleString("en-US", {
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        })} conservative projected rent for delivered-vacant residential unit(s)`
      );
    }
    const listingActivitySummary = describeListingActivity(listingActivity);
    if (listingActivitySummary) {
      financialFlags.push(`Last market activity: ${listingActivitySummary}`);
    }
    if (!hasCurrentFinancials) {
      financialFlags.push(
        "Current rent and/or NOI could not be extracted from the OM text alone; pricing and underwriting are incomplete until a fuller rent roll or operating statement is parsed."
      );
    }
    if (
      assumptions.propertyMix.commercialUnits > 0 ||
      assumptions.propertyMix.rentStabilizedUnits > 0
    ) {
      const protectedParts: string[] = [];
      if (assumptions.propertyMix.commercialUnits > 0) {
        protectedParts.push(`${assumptions.propertyMix.commercialUnits} commercial`);
      }
      if (assumptions.propertyMix.rentStabilizedUnits > 0) {
        protectedParts.push(`${assumptions.propertyMix.rentStabilizedUnits} rent-stabilized`);
      }
      financialFlags.push(
        `${protectedParts.join(" + ")} unit(s) excluded from residential uplift; blended rent uplift underwritten at ${assumptions.operating.blendedRentUpliftPct.toFixed(2)}%`
      );
    }
    if (recommendedOffer.recommendedOfferHigh != null) {
      financialFlags.push(
        recommendedOffer.discountToAskingPct != null && recommendedOffer.discountToAskingPct > 0
          ? `Max recommended offer to hit ${recommendedOffer.targetIrrPct.toFixed(0)}% target IRR: $${recommendedOffer.recommendedOfferHigh.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${recommendedOffer.discountToAskingPct.toFixed(1)}% below ask)`
          : `Asking price already clears the ${recommendedOffer.targetIrrPct.toFixed(0)}% target IRR`
      );
    }
    const revenueMixFlag = omRevenueMixFlag(details);
    if (revenueMixFlag) financialFlags.push(revenueMixFlag);
    const discrepancyFlag = omDiscrepancyFlag(details);
    if (discrepancyFlag) financialFlags.push(discrepancyFlag);
    financialFlags.push(...authoritativeValidationMessages(details).filter((message) => !financialFlags.includes(message)));

    const assetCapRateForCtx =
      assumptions.acquisition.purchasePrice != null &&
      assetCapRateNoiBasis != null &&
      assetCapRateNoiBasis >= 0
        ? (assetCapRateNoiBasis / assumptions.acquisition.purchasePrice) * 100
        : null;
    const adjustedNoiForCtx = projection.operating.stabilizedNoi;
    const adjustedCapRateForCtx =
      assumptions.acquisition.purchasePrice != null &&
      hasCurrentFinancials &&
      adjustedNoiForCtx >= 0
        ? (adjustedNoiForCtx / assumptions.acquisition.purchasePrice) * 100
        : null;

    const amortizationSchedule =
      projection.financing.amortizationSchedule.length > 0
        ? projection.financing.amortizationSchedule.map((row) => ({
            year: row.year,
            principalPayment: row.principalPayment,
            interestPayment: row.interestPayment,
            debtService: row.debtService,
            endingBalance: row.endingBalance,
          }))
        : undefined;

    const ctx: UnderwritingContext = {
      propertyId,
      canonicalAddress: packageContext.dossierAddress,
      purchasePrice: assumptions.acquisition.purchasePrice,
      listingCity,
      currentNoi,
      currentGrossRent,
      currentOtherIncome,
      unitCount,
      dealScore: null,
      assetCapRateNoiBasis,
      assetCapRate: assetCapRateForCtx,
      adjustedCapRate: adjustedCapRateForCtx,
      assumptions: {
        acquisition: {
          purchasePrice: assumptions.acquisition.purchasePrice,
          purchaseClosingCostPct: assumptions.acquisition.purchaseClosingCostPct,
          renovationCosts: assumptions.acquisition.renovationCosts,
          furnishingSetupCosts: assumptions.acquisition.furnishingSetupCosts,
        },
        financing: {
          ltvPct: assumptions.financing.ltvPct,
          interestRatePct: assumptions.financing.interestRatePct,
          amortizationYears: assumptions.financing.amortizationYears,
          loanFeePct: assumptions.financing.loanFeePct,
        },
        operating: {
          rentUpliftPct: assumptions.operating.rentUpliftPct,
          blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
          expenseIncreasePct: assumptions.operating.expenseIncreasePct,
          managementFeePct: assumptions.operating.managementFeePct,
          vacancyPct: assumptions.operating.vacancyPct,
          leadTimeMonths: assumptions.operating.leadTimeMonths,
          annualRentGrowthPct: assumptions.operating.annualRentGrowthPct,
          annualOtherIncomeGrowthPct: assumptions.operating.annualOtherIncomeGrowthPct,
          annualExpenseGrowthPct: assumptions.operating.annualExpenseGrowthPct,
          annualPropertyTaxGrowthPct: assumptions.operating.annualPropertyTaxGrowthPct,
          recurringCapexAnnual: assumptions.operating.recurringCapexAnnual,
        },
        holdPeriodYears: assumptions.holdPeriodYears,
        targetIrrPct: assumptions.targetIrrPct,
        exit: {
          exitCapPct: assumptions.exit.exitCapPct,
          exitClosingCostPct: assumptions.exit.exitClosingCostPct,
        },
      },
      acquisition: projection.acquisition,
      financing: {
        loanAmount: projection.financing.loanAmount,
        financingFees: projection.financing.financingFees,
        monthlyPayment: projection.financing.monthlyPayment,
        annualDebtService: projection.financing.annualDebtService,
        remainingLoanBalanceAtExit: projection.financing.remainingLoanBalanceAtExit,
        principalPaydownAtExit: projection.financing.principalPaydownAtExit,
      },
      operating: {
        ...projection.operating,
        currentOtherIncome: projection.operating.currentOtherIncome,
      },
      exit: {
        ...projection.exit,
        principalPaydownToDate: projection.exit.principalPaydownToDate,
      },
      cashFlows: {
        ...projection.cashFlows,
        annualPrincipalPaydown: projection.cashFlows.annualPrincipalPaydown,
        annualPrincipalPaydowns: projection.cashFlows.annualPrincipalPaydowns,
        annualEquityGain: projection.cashFlows.annualEquityGain,
        annualEquityGains: projection.cashFlows.annualEquityGains,
        annualUnleveredCashFlows: projection.cashFlows.annualUnleveredCashFlows,
        unleveredCashFlowSeries: projection.cashFlows.unleveredCashFlowSeries,
      },
      returns: {
        irrPct: projection.returns.irr,
        equityMultiple: projection.returns.equityMultiple,
        year1CashOnCashReturn: projection.returns.year1CashOnCashReturn,
        averageCashOnCashReturn: projection.returns.averageCashOnCashReturn,
        year1EquityYield: projection.returns.year1EquityYield,
        averageEquityYield: projection.returns.averageEquityYield,
      },
      propertyOverview: propertyOverview ?? undefined,
      rentRollRows: rentRollRows.length > 0 ? rentRollRows : undefined,
      expenseRows: expenseRows.length > 0 ? expenseRows : undefined,
      currentExpensesTotal: resolvedCurrentExpensesTotal ?? undefined,
      financialFlags: financialFlags.length > 0 ? financialFlags : undefined,
      amortizationSchedule,
      sensitivities,
      yearlyCashFlow: projection.yearly,
      propertyMix: assumptions.propertyMix,
      recommendedOffer,
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    const slug =
      packageContext.dossierAddress.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) ||
      propertyId.slice(0, 8);
    const dossierFileName = `Deal-Dossier-${slug}-${dateStr}.pdf`;
    const excelFileName = `Pro-Forma-${slug}-${dateStr}.xlsx`;

    await setGenerationState(runningGenerationState(startedAt, "Drafting investment memo"));
    const draftingStartedAtMs = Date.now();
    const dossierText = buildDossierStructuredText(ctx);
    console.info("[runGenerateDossier] Dossier text drafted", {
      propertyId,
      durationMs: Date.now() - draftingStartedAtMs,
      textLength: dossierText.length,
    });

    const anyRentStab = detectRentStabilization(details, dossierText);
    const rentStabCount = Math.max(
      assumptions.propertyMix.rentStabilizedUnits,
      rentStabilizedUnitCount(details, dossierText, anyRentStab)
    );

    const { insertParams, scoringResult } = computeDealSignals({
      propertyId,
      canonicalAddress: property.canonicalAddress,
      details,
      primaryListing: {
        price: assumptions.acquisition.purchasePrice,
        city: listingCity,
        listedAt: listing?.listedAt ?? null,
        priceHistory: listing?.priceHistory ?? null,
      },
      assetCapRateNoi: assetCapRateNoiBasis,
      irrPct: projection.returns.irr ?? null,
      cocPct: projection.returns.averageCashOnCashReturn ?? null,
      equityMultiple: projection.returns.equityMultiple ?? null,
      adjustedCapRatePct: adjustedCapRateForCtx,
      adjustedNoi: projection.operating.stabilizedNoi ?? null,
      recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
      blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
      annualExpenseGrowthPct: assumptions.operating.annualExpenseGrowthPct,
      vacancyPct: assumptions.operating.vacancyPct,
      exitCapRatePct: assumptions.exit.exitCapPct,
      rentStabilizedUnitCount: rentStabCount,
      commercialUnitCount: assumptions.propertyMix.commercialUnits,
    });
    insertParams.scoreSensitivity = buildDealScoreSensitivity({
      propertyId,
      canonicalAddress: property.canonicalAddress,
      details,
      primaryListing: {
        price: assumptions.acquisition.purchasePrice,
        city: listingCity,
        listedAt: listing?.listedAt ?? null,
        priceHistory: listing?.priceHistory ?? null,
      },
      assumptions,
      currentGrossRent,
      currentNoi,
      currentOtherIncome,
      currentExpensesTotal: resolvedCurrentExpensesTotal ?? undefined,
      expenseRows,
      conservativeProjectedLeaseUpRent,
      baseCalculatedScore: scoringResult.isScoreable ? scoringResult.dealScore : null,
    });

    const scoreOverride = await overridesRepo.getActiveByPropertyId(propertyId);
    const calculatedScore = scoringResult.isScoreable ? scoringResult.dealScore : null;
    const finalScore = resolveEffectiveDealScore(calculatedScore, scoreOverride);
    ctx.dealScore = finalScore;
    insertParams.dealScore = calculatedScore ?? undefined;

    if (scoringResult.negativeSignals.length > 0) financialFlags.push(scoringResult.negativeSignals[0]);
    else if (scoringResult.positiveSignals.length > 0) financialFlags.push(scoringResult.positiveSignals[0]);

    const scoredDossierText = dossierText.replace(
      /^Deal score: .*$/im,
      ctx.dealScore != null ? `Deal score: ${ctx.dealScore}/100` : "Deal score: —"
    );

    await setGenerationState(runningGenerationState(startedAt, "Rendering PDF and Excel"));
    const renderStartedAtMs = Date.now();
    const dossierBuffer = await dossierTextToPdf(scoredDossierText);
    const excelBuffer = buildExcelProForma(ctx);
    console.info("[runGenerateDossier] Rendered PDF and Excel", {
      propertyId,
      durationMs: Date.now() - renderStartedAtMs,
      dossierBytes: dossierBuffer.length,
      excelBytes: excelBuffer.length,
    });

    await setGenerationState(runningGenerationState(startedAt, "Saving documents"));
    const saveStartedAtMs = Date.now();
    const persistedSignals = await signalsRepo.insert({
      ...insertParams,
      irrPct: projection.returns.irr ?? null,
      equityMultiple: projection.returns.equityMultiple ?? null,
      cocPct: projection.returns.averageCashOnCashReturn ?? null,
      holdYears: assumptions.holdPeriodYears,
      currentNoi: currentNoi ?? null,
      adjustedNoi: projection.operating.stabilizedNoi ?? currentNoi ?? null,
    });

    const dossierDocId = randomUUID();
    const excelDocId = randomUUID();

    const dossierStoragePath = await saveGeneratedDocument(
      propertyId,
      dossierDocId,
      dossierFileName,
      dossierBuffer
    );
    const excelStoragePath = await saveGeneratedDocument(
      propertyId,
      excelDocId,
      excelFileName,
      excelBuffer
    );

    const dossierDoc = await documentRepo.insert({
      propertyId,
      fileName: dossierFileName,
      fileType: "application/pdf",
      source: "generated_dossier",
      storagePath: dossierStoragePath,
      fileContent: dossierBuffer,
    });

    const excelDoc = await documentRepo.insert({
      propertyId,
      fileName: excelFileName,
      fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      source: "generated_excel",
      storagePath: excelStoragePath,
      fileContent: excelBuffer,
    });

    await deleteSupersededGeneratedDocuments([dossierDoc.id, excelDoc.id]);
    console.info("[runGenerateDossier] Persisted dossier outputs", {
      propertyId,
      durationMs: Date.now() - saveStartedAtMs,
      dossierDocumentId: dossierDoc.id,
      excelDocumentId: excelDoc.id,
      dealSignalsId: persistedSignals.id,
    });

    const completedAt = new Date().toISOString();
    await propertyRepo.updateDetails(
      propertyId,
      "dealDossier.summary",
      buildPersistedDossierSummary({
        generatedAt: completedAt,
        dossierDocumentId: dossierDoc.id,
        excelDocumentId: excelDoc.id,
        askingPrice: recommendedOffer.askingPrice,
        purchasePrice: assumptions.acquisition.purchasePrice,
        recommendedOffer,
        projection,
        currentNoi: currentNoi ?? null,
        adjustedNoi: projection.operating.stabilizedNoi ?? currentNoi ?? null,
        finalScore,
        calculatedScore,
        holdYears: assumptions.holdPeriodYears,
        dealSignalsId: persistedSignals.id,
        dealSignalsGeneratedAt: persistedSignals.generatedAt,
      }) as Record<string, unknown>
    );

    const emailSent = false;
    console.info("[runGenerateDossier] Dossier email disabled", {
      propertyId,
    });

    await setGenerationState({
      status: "completed",
      stageLabel: "Dossier ready",
      startedAt,
      completedAt,
      lastError: null,
      dealScore: finalScore,
      dossierDocumentId: dossierDoc.id,
      excelDocumentId: excelDoc.id,
    });
    console.info("[runGenerateDossier] Completed", {
      propertyId,
      totalDurationMs: Date.now() - generationStartedAtMs,
      emailSent,
      dealScore: finalScore,
    });

    return {
      dossierDoc: {
        id: dossierDoc.id,
        fileName: dossierDoc.fileName,
        storagePath: dossierDoc.storagePath,
      },
      excelDoc: {
        id: excelDoc.id,
        fileName: excelDoc.fileName,
        storagePath: excelDoc.storagePath,
      },
      dealScore: finalScore,
      emailSent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.info("[runGenerateDossier] Failed", {
      propertyId,
      totalDurationMs: Date.now() - generationStartedAtMs,
      error: message,
    });
    await setGenerationState({
      status: "failed",
      stageLabel: "Generation failed",
      startedAt,
      completedAt: new Date().toISOString(),
      lastError: message,
      dealScore: null,
      dossierDocumentId: null,
      excelDocumentId: null,
    });
    throw err;
  }
}
