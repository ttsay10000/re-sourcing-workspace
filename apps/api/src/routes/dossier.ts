/**
 * Dossier assumptions and generation: GET assumptions, POST generate-dossier.
 */

import { Router, type Request, type Response } from "express";
import type { PropertyDetails } from "@re-sourcing/contracts";
import { getPool, UserProfileRepo, PropertyRepo, MatchRepo, ListingRepo } from "@re-sourcing/db";
import { runGenerateDossier } from "../deal/runGenerateDossier.js";
import { getDossierGenerationQueue, runWithDossierGenerationQueue } from "../deal/dossierGenerationQueue.js";
import { isGeminiAuthoritativeOmSnapshot, resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import { resolveCurrentFinancialsFromDetails } from "../rental/currentFinancials.js";
import { resolveDossierAssumptions, type DossierAssumptionOverrides } from "../deal/underwritingModel.js";
import {
  getPropertyDossierAssumptions,
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
const MISSING_AUTHORITATIVE_OM_ERROR = "Authoritative OM snapshot required before dossier generation and deal scoring.";
const MISSING_AUTHORITATIVE_OM_DETAILS =
  "Generate dossier requires a promoted authoritative OM snapshot. Run OM refresh first.";

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
    let defaults: Record<string, number | null> | null = null;
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
          purchasePrice: assumptions.acquisition.purchasePrice,
          purchaseClosingCostPct: assumptions.acquisition.purchaseClosingCostPct,
          renovationCosts: assumptions.acquisition.renovationCosts,
          furnishingSetupCosts: assumptions.acquisition.furnishingSetupCosts,
          ltvPct: assumptions.financing.ltvPct,
          interestRatePct: assumptions.financing.interestRatePct,
          amortizationYears: assumptions.financing.amortizationYears,
          loanFeePct: assumptions.financing.loanFeePct,
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
          holdPeriodYears: assumptions.holdPeriodYears,
          exitCapPct: assumptions.exit.exitCapPct,
          exitClosingCostPct: assumptions.exit.exitClosingCostPct,
          targetIrrPct: assumptions.targetIrrPct,
          currentGrossRent: currentFinancials.grossRentalIncome,
          currentNoi: currentFinancials.noi,
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
        purchasePrice: assumptions.acquisition.purchasePrice,
        purchaseClosingCostPct: assumptions.acquisition.purchaseClosingCostPct,
        renovationCosts: assumptions.acquisition.renovationCosts,
        furnishingSetupCosts: assumptions.acquisition.furnishingSetupCosts,
        ltvPct: assumptions.financing.ltvPct,
        interestRatePct: assumptions.financing.interestRatePct,
        amortizationYears: assumptions.financing.amortizationYears,
        loanFeePct: assumptions.financing.loanFeePct,
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
        holdPeriodYears: assumptions.holdPeriodYears,
        exitCapPct: assumptions.exit.exitCapPct,
        exitClosingCostPct: assumptions.exit.exitClosingCostPct,
        targetIrrPct: assumptions.targetIrrPct,
        currentGrossRent: null,
        currentNoi: null,
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
        defaultAnnualOtherIncomeGrowthPct: profile.defaultAnnualOtherIncomeGrowthPct,
        defaultAnnualExpenseGrowthPct: profile.defaultAnnualExpenseGrowthPct,
        defaultAnnualPropertyTaxGrowthPct: profile.defaultAnnualPropertyTaxGrowthPct,
        defaultRecurringCapexAnnual: profile.defaultRecurringCapexAnnual,
        defaultLoanFeePct: profile.defaultLoanFeePct,
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
    purchasePrice: typeof record.purchasePrice === "number" ? record.purchasePrice : null,
    purchaseClosingCostPct:
      typeof record.purchaseClosingCostPct === "number" ? record.purchaseClosingCostPct : null,
    renovationCosts: typeof record.renovationCosts === "number" ? record.renovationCosts : null,
    furnishingSetupCosts:
      typeof record.furnishingSetupCosts === "number" ? record.furnishingSetupCosts : null,
    ltvPct: typeof record.ltvPct === "number" ? record.ltvPct : null,
    interestRatePct: typeof record.interestRatePct === "number" ? record.interestRatePct : null,
    amortizationYears: typeof record.amortizationYears === "number" ? record.amortizationYears : null,
    loanFeePct: typeof record.loanFeePct === "number" ? record.loanFeePct : null,
    rentUpliftPct: typeof record.rentUpliftPct === "number" ? record.rentUpliftPct : null,
    expenseIncreasePct: typeof record.expenseIncreasePct === "number" ? record.expenseIncreasePct : null,
    managementFeePct: typeof record.managementFeePct === "number" ? record.managementFeePct : null,
    vacancyPct: typeof record.vacancyPct === "number" ? record.vacancyPct : null,
    leadTimeMonths: typeof record.leadTimeMonths === "number" ? record.leadTimeMonths : null,
    annualRentGrowthPct:
      typeof record.annualRentGrowthPct === "number" ? record.annualRentGrowthPct : null,
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
    holdPeriodYears: typeof record.holdPeriodYears === "number" ? record.holdPeriodYears : null,
    exitCapPct: typeof record.exitCapPct === "number" ? record.exitCapPct : null,
    exitClosingCostPct:
      typeof record.exitClosingCostPct === "number" ? record.exitClosingCostPct : null,
    targetIrrPct: typeof record.targetIrrPct === "number" ? record.targetIrrPct : null,
  };
  return mergeDossierAssumptionOverrides(null, assumptions);
}

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
      const requiresGeminiRefresh = !isGeminiAuthoritativeOmSnapshot((property.details ?? null) as PropertyDetails | null);
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
      if (requiresGeminiRefresh) {
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "dossier",
          totalItems: 1,
          completedItems: 0,
          failedItems: 1,
          status: "failed",
          startedAt: workflowStartedAt,
          finishedAt: new Date().toISOString(),
          lastError: MISSING_AUTHORITATIVE_OM_DETAILS,
          lastMessage: "Authoritative OM required before dossier generation",
        });
        await mergeWorkflowRunMetadata(workflowRunId, {
          error: MISSING_AUTHORITATIVE_OM_DETAILS,
          authoritativeOmRequired: true,
        });
        await updateWorkflowRun(workflowRunId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
        });
        res.status(409).json({
          error: MISSING_AUTHORITATIVE_OM_ERROR,
          details: MISSING_AUTHORITATIVE_OM_DETAILS,
          code: "authoritative_om_required",
        });
        return;
      }
      const dossierStartedAtMs = Date.now();
      const result = await runGenerateDossier(propertyId, assumptions, { sendEmail: false });
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
