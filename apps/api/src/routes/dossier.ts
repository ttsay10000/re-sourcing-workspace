/**
 * Dossier assumptions and generation: GET assumptions, POST generate-dossier.
 */

import { Router, type Request, type Response } from "express";
import type { DealSignalRow, PropertyDetails } from "@re-sourcing/contracts";
import {
  DealScoreOverridesRepo,
  DealSignalsRepo,
  getPool,
  ListingRepo,
  MatchRepo,
  PropertyRepo,
  SavedDealsRepo,
  UserProfileRepo,
} from "@re-sourcing/db";
import { runGenerateDossier } from "../deal/runGenerateDossier.js";
import { getDossierGenerationQueue, runWithDossierGenerationQueue } from "../deal/dossierGenerationQueue.js";
import {
  buildDealScoringProfileFromPreferences,
  DEAL_SCORING_PROFILES,
  type DealScoringProfile,
  type DealScoringProfileKey,
} from "../deal/dealScoringProfiles.js";
import { computeDealScore } from "../deal/dealScoringEngine.js";
import { resolveEffectiveDealScore } from "../deal/effectiveDealScore.js";
import { isGeminiAuthoritativeOmSnapshot, resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import { resolveCurrentFinancialsFromDetails } from "../rental/currentFinancials.js";
import { resolveDossierAssumptions, type DossierAssumptionOverrides } from "../deal/underwritingModel.js";
import { hasBrokerEmailNotes } from "../deal/brokerDossierNotes.js";
import {
  getPropertyDossierAssumptions,
  getPropertyDossierSummary,
  mergeDossierAssumptionOverrides,
  propertyAssumptionsToOverrides,
} from "../deal/propertyDossierState.js";
import {
  createWorkflowRun,
  mergeWorkflowRunMetadata,
  updateWorkflowRun,
  upsertWorkflowStep,
} from "../workflow/workflowTracker.js";

const router = Router();
const MISSING_DOSSIER_SOURCE_ERROR =
  "Authoritative OM snapshot or broker email notes required before dossier generation and deal scoring.";
const MISSING_DOSSIER_SOURCE_DETAILS =
  "Generate dossier requires either a promoted authoritative OM snapshot or saved broker email notes with rent/expense inputs.";

async function getDefaultUserId(): Promise<string> {
  const pool = getPool();
  const profileRepo = new UserProfileRepo({ pool });
  return profileRepo.ensureDefault();
}

/** GET /api/dossier-assumptions?property_id=X - profile defaults and optional property summary for the assumptions form. */
router.get("/dossier-assumptions", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    await getDefaultUserId();
    const profileRepo = new UserProfileRepo({ pool });
    const profile = await profileRepo.getDefault();
    if (!profile) {
      res.status(503).json({ error: "Profile not available." });
      return;
    }
    const propertyId = typeof req.query.property_id === "string" ? req.query.property_id.trim() : null;
    let property:
      | {
          id: string;
          canonicalAddress: string;
          primaryListing: { price: number | null; city: string | null } | null;
        }
      | null = null;
    let defaults: Record<string, unknown> | null = null;
    let formulaDefaults: Record<string, number | null> | null = null;
    let mixSummary: Record<string, number | null> | null = null;
    if (propertyId) {
      const propertyRepo = new PropertyRepo({ pool });
      const matchRepo = new MatchRepo({ pool });
      const listingRepo = new ListingRepo({ pool });
      const prop = await propertyRepo.byId(propertyId);
      if (prop) {
        const { matches } = await matchRepo.list({ propertyId, limit: 1 });
        const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;
        property = {
          id: prop.id,
          canonicalAddress: prop.canonicalAddress,
          primaryListing: listing
            ? { price: listing.price ?? null, city: listing.city ?? null }
            : null,
        };
        const details = (prop.details ?? null) as PropertyDetails | null;
        const currentFinancials = resolveCurrentFinancialsFromDetails(details);
        const propertyAssumptions = getPropertyDossierAssumptions(details);
        const formulaAssumptions = resolveDossierAssumptions(profile, listing?.price ?? null, null, {
          details,
        });
        const assumptions = resolveDossierAssumptions(
          profile,
          listing?.price ?? null,
          propertyAssumptionsToOverrides(propertyAssumptions),
          {
            details,
          }
        );
        defaults = {
          buildingSqft: propertyAssumptions?.buildingSqft ?? null,
          purchasePrice: assumptions.acquisition.purchasePrice,
          purchaseClosingCostPct: assumptions.acquisition.purchaseClosingCostPct,
          renovationCosts: assumptions.acquisition.renovationCosts,
          furnishingSetupCosts: assumptions.acquisition.furnishingSetupCosts,
          investmentProfile:
            propertyAssumptions?.investmentProfile ?? assumptions.acquisition.investmentProfile,
          targetAcquisitionDate:
            propertyAssumptions?.targetAcquisitionDate ??
            assumptions.acquisition.targetAcquisitionDate,
          unitModelRows: propertyAssumptions?.unitModelRows ?? null,
          expenseModelRows: propertyAssumptions?.expenseModelRows ?? null,
          brokerEmailNotes: propertyAssumptions?.brokerEmailNotes ?? null,
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
          currentNoi: propertyAssumptions?.currentNoi ?? null,
          holdPeriodYears: assumptions.holdPeriodYears,
          exitCapPct: assumptions.exit.exitCapPct,
          exitClosingCostPct: assumptions.exit.exitClosingCostPct,
          targetIrrPct: assumptions.targetIrrPct,
          currentGrossRent: currentFinancials.grossRentalIncome,
        };
        formulaDefaults = {
          renovationCosts: 0,
          furnishingSetupCosts: formulaAssumptions.acquisition.furnishingSetupCosts,
        };
        mixSummary = {
          totalUnits: resolvePreferredOmUnitCount(details) ?? assumptions.propertyMix.totalUnits,
          residentialUnits: assumptions.propertyMix.residentialUnits,
          eligibleResidentialUnits: assumptions.propertyMix.eligibleResidentialUnits,
          commercialUnits: assumptions.propertyMix.commercialUnits,
          rentStabilizedUnits: assumptions.propertyMix.rentStabilizedUnits,
          eligibleRevenueSharePct: assumptions.propertyMix.eligibleRevenueSharePct,
          eligibleUnitSharePct: assumptions.propertyMix.eligibleUnitSharePct,
        };
      }
    }
    if (!defaults) {
      const assumptions = resolveDossierAssumptions(profile, null);
      defaults = {
        buildingSqft: null,
        purchasePrice: assumptions.acquisition.purchasePrice,
        purchaseClosingCostPct: assumptions.acquisition.purchaseClosingCostPct,
        renovationCosts: assumptions.acquisition.renovationCosts,
        furnishingSetupCosts: assumptions.acquisition.furnishingSetupCosts,
        investmentProfile: assumptions.acquisition.investmentProfile,
        targetAcquisitionDate: assumptions.acquisition.targetAcquisitionDate,
        unitModelRows: null,
        expenseModelRows: null,
        brokerEmailNotes: null,
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
        currentNoi: null,
        holdPeriodYears: assumptions.holdPeriodYears,
        exitCapPct: assumptions.exit.exitCapPct,
        exitClosingCostPct: assumptions.exit.exitClosingCostPct,
        targetIrrPct: assumptions.targetIrrPct,
        currentGrossRent: null,
      };
    }
    res.json({
      profile: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        organization: profile.organization,
        defaultPurchaseClosingCostPct: profile.defaultPurchaseClosingCostPct,
        defaultLtv: profile.defaultLtv,
        defaultInterestRate: profile.defaultInterestRate,
        defaultAmortization: profile.defaultAmortization,
        defaultHoldPeriodYears: profile.defaultHoldPeriodYears,
        defaultExitCap: profile.defaultExitCap,
        defaultExitClosingCostPct: profile.defaultExitClosingCostPct,
        defaultRentUplift: profile.defaultRentUplift,
        defaultExpenseIncrease: profile.defaultExpenseIncrease,
        defaultManagementFee: profile.defaultManagementFee,
        defaultTargetIrrPct: profile.defaultTargetIrrPct,
        defaultVacancyPct: profile.defaultVacancyPct,
        defaultLeadTimeMonths: profile.defaultLeadTimeMonths,
        defaultAnnualRentGrowthPct: profile.defaultAnnualRentGrowthPct,
        defaultAnnualCommercialRentGrowthPct: profile.defaultAnnualCommercialRentGrowthPct,
        defaultAnnualOtherIncomeGrowthPct: profile.defaultAnnualOtherIncomeGrowthPct,
        defaultAnnualExpenseGrowthPct: profile.defaultAnnualExpenseGrowthPct,
        defaultAnnualPropertyTaxGrowthPct: profile.defaultAnnualPropertyTaxGrowthPct,
        defaultRecurringCapexAnnual: profile.defaultRecurringCapexAnnual,
        defaultLoanFeePct: profile.defaultLoanFeePct,
        scoringPreferences: profile.scoringPreferences ?? null,
      },
      property,
      defaults,
      formulaDefaults,
      mixSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dossier-assumptions get]", err);
    res.status(503).json({ error: "Failed to load assumptions.", details: message });
  }
});

function parseAssumptionOverrides(rawAssumptions: unknown): DossierAssumptionOverrides | null {
  if (!rawAssumptions || typeof rawAssumptions !== "object") return null;
  const record = rawAssumptions as Record<string, unknown>;
  const assumptions: DossierAssumptionOverrides = {
    buildingSqft: typeof record.buildingSqft === "number" ? record.buildingSqft : null,
    purchasePrice: typeof record.purchasePrice === "number" ? record.purchasePrice : null,
    purchaseClosingCostPct:
      typeof record.purchaseClosingCostPct === "number" ? record.purchaseClosingCostPct : null,
    renovationCosts: typeof record.renovationCosts === "number" ? record.renovationCosts : null,
    furnishingSetupCosts:
      typeof record.furnishingSetupCosts === "number" ? record.furnishingSetupCosts : null,
    investmentProfile:
      typeof record.investmentProfile === "string" && record.investmentProfile.trim().length > 0
        ? record.investmentProfile.trim()
        : null,
    targetAcquisitionDate:
      typeof record.targetAcquisitionDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.targetAcquisitionDate.trim())
        ? record.targetAcquisitionDate.trim()
        : null,
    ltvPct: typeof record.ltvPct === "number" ? record.ltvPct : null,
    interestRatePct: typeof record.interestRatePct === "number" ? record.interestRatePct : null,
    amortizationYears: typeof record.amortizationYears === "number" ? record.amortizationYears : null,
    loanFeePct: typeof record.loanFeePct === "number" ? record.loanFeePct : null,
    rentUpliftPct: typeof record.rentUpliftPct === "number" ? record.rentUpliftPct : null,
    expenseIncreasePct: typeof record.expenseIncreasePct === "number" ? record.expenseIncreasePct : null,
    managementFeePct: typeof record.managementFeePct === "number" ? record.managementFeePct : null,
    occupancyTaxPct: typeof record.occupancyTaxPct === "number" ? record.occupancyTaxPct : null,
    vacancyPct: typeof record.vacancyPct === "number" ? record.vacancyPct : null,
    leadTimeMonths: typeof record.leadTimeMonths === "number" ? record.leadTimeMonths : null,
    annualRentGrowthPct:
      typeof record.annualRentGrowthPct === "number" ? record.annualRentGrowthPct : null,
    annualCommercialRentGrowthPct:
      typeof record.annualCommercialRentGrowthPct === "number"
        ? record.annualCommercialRentGrowthPct
        : null,
    annualOtherIncomeGrowthPct:
      typeof record.annualOtherIncomeGrowthPct === "number"
        ? record.annualOtherIncomeGrowthPct
        : null,
    annualExpenseGrowthPct:
      typeof record.annualExpenseGrowthPct === "number"
        ? record.annualExpenseGrowthPct
        : null,
    annualPropertyTaxGrowthPct:
      typeof record.annualPropertyTaxGrowthPct === "number"
        ? record.annualPropertyTaxGrowthPct
        : null,
    recurringCapexAnnual:
      typeof record.recurringCapexAnnual === "number" ? record.recurringCapexAnnual : null,
    currentNoi: typeof record.currentNoi === "number" ? record.currentNoi : null,
    holdPeriodYears: typeof record.holdPeriodYears === "number" ? record.holdPeriodYears : null,
    exitCapPct: typeof record.exitCapPct === "number" ? record.exitCapPct : null,
    exitClosingCostPct:
      typeof record.exitClosingCostPct === "number" ? record.exitClosingCostPct : null,
    targetIrrPct: typeof record.targetIrrPct === "number" ? record.targetIrrPct : null,
  };
  return mergeDossierAssumptionOverrides(null, assumptions);
}

function parseDossierFormat(rawFormat: unknown): "teaser" | "workpaper" {
  return rawFormat === "workpaper" ? "workpaper" : "teaser";
}

function parseScoringProfile(rawProfile: unknown): DealScoringProfileKey | null {
  if (typeof rawProfile !== "string" || rawProfile.trim().length === 0) return null;
  const value = rawProfile.trim();
  return value in DEAL_SCORING_PROFILES ? (value as DealScoringProfileKey) : null;
}

function purchasePriceFromSignals(signal: DealSignalRow): number | null {
  if (
    signal.currentNoi != null &&
    Number.isFinite(signal.currentNoi) &&
    signal.assetCapRate != null &&
    Number.isFinite(signal.assetCapRate) &&
    signal.assetCapRate > 0
  ) {
    return signal.currentNoi / (signal.assetCapRate / 100);
  }
  return null;
}

async function refreshScoreFromLatestSignals(params: {
  propertyId: string;
  propertyRepo: PropertyRepo;
  signalsRepo: DealSignalsRepo;
  overridesRepo: DealScoreOverridesRepo;
  scoringProfile: DealScoringProfile;
}): Promise<{
  propertyId: string;
  status: "refreshed" | "skipped";
  calculatedDealScore: number | null;
  dealScore: number | null;
  reason?: string;
}> {
  const property = await params.propertyRepo.byId(params.propertyId);
  if (!property) {
    return { propertyId: params.propertyId, status: "skipped", calculatedDealScore: null, dealScore: null, reason: "Property not found" };
  }
  const latest = await params.signalsRepo.getLatestByPropertyId(params.propertyId);
  if (!latest) {
    return { propertyId: params.propertyId, status: "skipped", calculatedDealScore: null, dealScore: null, reason: "No persisted deal signals" };
  }
  const scoringResult = computeDealScore({
    purchasePrice: purchasePriceFromSignals(latest),
    noi: latest.currentNoi ?? null,
    irrPct: latest.irrPct ?? null,
    cocPct: latest.cocPct ?? null,
    equityMultiple: latest.equityMultiple ?? null,
    adjustedCapRatePct: latest.adjustedCapRate ?? null,
    adjustedNoi: latest.adjustedNoi ?? null,
    blendedRentUpliftPct: latest.rentUpside ?? null,
    riskProfile: latest.riskProfile ?? null,
    scoringProfile: params.scoringProfile,
  });
  const calculatedDealScore = scoringResult.isScoreable ? scoringResult.dealScore : null;
  const inserted = await params.signalsRepo.insert({
    propertyId: params.propertyId,
    pricePerUnit: latest.pricePerUnit,
    pricePsf: latest.pricePsf,
    assetCapRate: scoringResult.assetCapRate ?? latest.assetCapRate,
    adjustedCapRate: scoringResult.adjustedCapRate ?? latest.adjustedCapRate,
    yieldSpread:
      scoringResult.adjustedCapRate != null && scoringResult.assetCapRate != null
        ? scoringResult.adjustedCapRate - scoringResult.assetCapRate
        : latest.yieldSpread,
    rentUpside: latest.rentUpside,
    rentPsfRatio: latest.rentPsfRatio,
    expenseRatio: latest.expenseRatio,
    liquidityScore: scoringResult.liquidityScore,
    riskScore: scoringResult.riskScore,
    priceMomentum: latest.priceMomentum,
    dealScore: calculatedDealScore,
    irrPct: latest.irrPct,
    equityMultiple: latest.equityMultiple,
    cocPct: latest.cocPct,
    holdYears: latest.holdYears,
    currentNoi: latest.currentNoi,
    adjustedNoi: latest.adjustedNoi,
    scoreBreakdown: scoringResult.scoreBreakdown,
    riskProfile: scoringResult.riskProfile,
    riskFlags: scoringResult.riskFlags,
    capReasons: scoringResult.capReasons,
    confidenceScore: scoringResult.confidenceScore,
    scoreSensitivity: latest.scoreSensitivity,
    scoreVersion: scoringResult.scoreVersion,
  });
  const override = await params.overridesRepo.getActiveByPropertyId(params.propertyId);
  const finalScore = resolveEffectiveDealScore(calculatedDealScore, override);
  const summary = getPropertyDossierSummary(property.details as PropertyDetails | null);
  if (summary) {
    await params.propertyRepo.updateDetails(params.propertyId, "dealDossier.summary", {
      ...summary,
      calculatedDealScore,
      dealScore: finalScore,
      dealSignalsId: inserted.id,
      dealSignalsGeneratedAt: inserted.generatedAt,
    } as Record<string, unknown>);
  }
  return {
    propertyId: params.propertyId,
    status: "refreshed",
    calculatedDealScore,
    dealScore: finalScore,
  };
}

/** POST /api/dossier/refresh-scores - re-score persisted dossier signals without regenerating PDFs. */
router.post("/dossier/refresh-scores", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const profileRepo = new UserProfileRepo({ pool });
    const userId = await profileRepo.ensureDefault();
    const profile = await profileRepo.getDefault();
    if (!profile) {
      res.status(503).json({ error: "Profile not available." });
      return;
    }
    const rawScoringProfile = req.body?.scoringProfile ?? req.body?.scoringProfileKey;
    const scoringProfileKey = parseScoringProfile(rawScoringProfile);
    if (
      typeof rawScoringProfile === "string" &&
      rawScoringProfile.trim().length > 0 &&
      scoringProfileKey == null
    ) {
      res.status(400).json({ error: "Unknown scoringProfile.", allowed: Object.keys(DEAL_SCORING_PROFILES) });
      return;
    }
    const scope =
      req.body?.scope === "saved" || req.body?.scope === "all" || req.body?.scope === "selected"
        ? req.body.scope
        : "selected";
    const propertyRepo = new PropertyRepo({ pool });
    const signalsRepo = new DealSignalsRepo({ pool });
    const overridesRepo = new DealScoreOverridesRepo({ pool });
    let propertyIds: string[] = [];
    if (scope === "selected") {
      propertyIds = Array.isArray(req.body?.propertyIds)
        ? req.body.propertyIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
        : [];
      if (propertyIds.length === 0) {
        res.status(400).json({ error: "propertyIds required when scope is selected." });
        return;
      }
    } else if (scope === "saved") {
      const savedRepo = new SavedDealsRepo({ pool });
      propertyIds = (await savedRepo.listByUserId(userId)).map((row) => row.propertyId);
    } else {
      const rows = await pool.query<{ property_id: string }>(
        "SELECT DISTINCT property_id FROM deal_signals ORDER BY property_id"
      );
      propertyIds = rows.rows.map((row) => row.property_id);
    }
    propertyIds = [...new Set(propertyIds)];
    const scoringProfile = buildDealScoringProfileFromPreferences(
      scoringProfileKey,
      profile.scoringPreferences ?? null
    );
    const results = [];
    for (const propertyId of propertyIds) {
      results.push(
        await refreshScoreFromLatestSignals({
          propertyId,
          propertyRepo,
          signalsRepo,
          overridesRepo,
          scoringProfile,
        })
      );
    }
    res.json({
      ok: true,
      scope,
      scoringProfile: scoringProfile.key,
      scoreVersion: scoringProfile.scoreVersion,
      refreshed: results.filter((row) => row.status === "refreshed").length,
      skipped: results.filter((row) => row.status === "skipped").length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dossier refresh-scores]", err);
    res.status(503).json({ error: "Failed to refresh deal scores.", details: message });
  }
});

/** POST /api/dossier/generate - run underwriting, build Excel + dossier, save to documents. Body: { propertyId }. */
router.post("/dossier/generate", async (req: Request, res: Response) => {
  const queue = getDossierGenerationQueue();
  const queuedAt = Date.now();
  const queuedBehind = queue.getPendingCount() + queue.getRunningCount();

  return runWithDossierGenerationQueue(async () => {
    let workflowRunId: string | null = null;
    const workflowStartedAt = new Date().toISOString();
    const requestStartedAtMs = Date.now();
    try {
      const propertyId = typeof req.body?.propertyId === "string" ? req.body.propertyId.trim() : null;
      if (!propertyId) {
        res.status(400).json({ error: "propertyId required." });
        return;
      }
      const pool = getPool();
      const propertyRepo = new PropertyRepo({ pool });
      const property = await propertyRepo.byId(propertyId);
      if (!property) {
        res.status(404).json({ error: "Property not found" });
        return;
      }
      console.info("[dossier generate] Started", {
        propertyId,
        queueWaitMs: requestStartedAtMs - queuedAt,
        queuedBehind,
      });
      const assumptions = parseAssumptionOverrides(req.body?.assumptions);
      const dossierFormat = parseDossierFormat(req.body?.dossierFormat);
      const rawScoringProfile = req.body?.scoringProfile ?? req.body?.scoringProfileKey;
      const scoringProfile = parseScoringProfile(rawScoringProfile);
      if (
        typeof rawScoringProfile === "string" &&
        rawScoringProfile.trim().length > 0 &&
        scoringProfile == null
      ) {
        res.status(400).json({
          error: "Unknown scoringProfile.",
          allowed: Object.keys(DEAL_SCORING_PROFILES),
        });
        return;
      }
      const propertyDetails = (property.details ?? null) as PropertyDetails | null;
      const requiresStructuredSource =
        !isGeminiAuthoritativeOmSnapshot(propertyDetails) && !hasBrokerEmailNotes(propertyDetails);
      workflowRunId = await createWorkflowRun({
        runType: "generate_dossier",
        displayName: "Generate dossier",
        scopeLabel: property.canonicalAddress,
        triggerSource: "manual",
        totalItems: 1,
        metadata: { propertyIds: [propertyId] },
        steps: [
          {
            stepKey: "dossier",
            totalItems: 1,
            status: "running",
            startedAt: workflowStartedAt,
            lastMessage: "Generating dossier",
          },
        ],
      });
      if (requiresStructuredSource) {
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "dossier",
          totalItems: 1,
          completedItems: 0,
          failedItems: 1,
          status: "failed",
          startedAt: workflowStartedAt,
          finishedAt: new Date().toISOString(),
          lastError: MISSING_DOSSIER_SOURCE_DETAILS,
          lastMessage: "Authoritative OM or broker notes required before dossier generation",
        });
        await mergeWorkflowRunMetadata(workflowRunId, {
          error: MISSING_DOSSIER_SOURCE_DETAILS,
          dossierSourceRequired: true,
        });
        await updateWorkflowRun(workflowRunId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
        });
        res.status(409).json({
          error: MISSING_DOSSIER_SOURCE_ERROR,
          details: MISSING_DOSSIER_SOURCE_DETAILS,
          code: "dossier_source_required",
        });
        return;
      }
      const dossierStartedAtMs = Date.now();
      const result = await runGenerateDossier(propertyId, assumptions, {
        sendEmail: false,
        dossierFormat,
        scoringProfile,
      });
      console.info("[dossier generate] Dossier generation completed", {
        propertyId,
        workflowRunId,
        dossierDurationMs: Date.now() - dossierStartedAtMs,
      });
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "dossier",
        totalItems: 1,
        completedItems: 1,
        failedItems: 0,
        status: "completed",
        startedAt: workflowStartedAt,
        finishedAt: new Date().toISOString(),
        lastMessage: "Dossier ready",
      });
      await mergeWorkflowRunMetadata(workflowRunId, {
        dealScore: result.dealScore,
        emailSent: result.emailSent ?? false,
        dossierFormat,
        scoringProfile: scoringProfile ?? "legacy_v3",
        dossierDocumentId: result.dossierDoc?.id ?? null,
        excelDocumentId: result.excelDoc?.id ?? null,
      });
      await updateWorkflowRun(workflowRunId, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });
      console.info("[dossier generate] Completed", {
        propertyId,
        workflowRunId,
        totalDurationMs: Date.now() - requestStartedAtMs,
        queueWaitMs: requestStartedAtMs - queuedAt,
        queuedBehind,
        emailSent: result.emailSent ?? false,
      });
      res.status(201).json({
        ok: true,
        propertyId,
        dossierDoc: result.dossierDoc,
        excelDoc: result.excelDoc,
        dealScore: result.dealScore,
        emailSent: result.emailSent ?? false,
        dossierFormat,
        scoringProfile: scoringProfile ?? "legacy_v3",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dossier generate]", err);
      console.info("[dossier generate] Failed", {
        workflowRunId,
        totalDurationMs: Date.now() - requestStartedAtMs,
        queueWaitMs: requestStartedAtMs - queuedAt,
        queuedBehind,
        error: message,
      });
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "dossier",
        totalItems: 1,
        completedItems: 0,
        failedItems: 1,
        status: "failed",
        startedAt: workflowStartedAt,
        finishedAt: new Date().toISOString(),
        lastError: message,
        lastMessage: "Dossier generation failed",
      });
      await mergeWorkflowRunMetadata(workflowRunId, { error: message });
      await updateWorkflowRun(workflowRunId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      if (message === "Property not found") {
        res.status(404).json({ error: message });
        return;
      }
      if (message === "Profile not available") {
        res.status(503).json({ error: message });
        return;
      }
      res.status(503).json({ error: "Failed to generate dossier.", details: message });
    }
  });
});

export default router;
