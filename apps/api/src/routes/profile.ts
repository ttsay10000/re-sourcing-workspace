/**
 * User profile API (single global user): GET/PUT profile, site password, assumption defaults, saved deals.
 */

import { Router, type Request, type Response } from "express";
import type { PropertyDetails } from "@re-sourcing/contracts";
import {
  getPool,
  UserProfileRepo,
  SavedDealsRepo,
  PropertyRepo,
  MatchRepo,
  ListingRepo,
  DealSignalsRepo,
  DealScoreOverridesRepo,
} from "@re-sourcing/db";
import { resolveEffectiveDealScore } from "../deal/effectiveDealScore.js";
import { getPropertyDossierSummary, hasCompletedDealDossier } from "../deal/propertyDossierState.js";
import { resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import { setSiteAuthSessionCookie, updateDefaultSitePassword, verifyDefaultSitePassword } from "../siteAuth.js";

const router = Router();

async function getDefaultUserId(): Promise<string> {
  const pool = getPool();
  const profileRepo = new UserProfileRepo({ pool });
  return profileRepo.ensureDefault();
}

/** GET /api/profile - get the single user profile (creates default row if none). */
router.get("/profile", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new UserProfileRepo({ pool });
    await repo.ensureDefault();
    const profile = await repo.getDefault();
    if (!profile) {
      res.status(503).json({ error: "Profile not available." });
      return;
    }
    res.json(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile get]", err);
    res.status(503).json({ error: "Failed to load profile.", details: message });
  }
});

/** PUT /api/profile - update name, email, organization, and/or assumption defaults. */
router.put("/profile", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new UserProfileRepo({ pool });
    const id = await repo.ensureDefault();
    const body = req.body ?? {};
    const nextSitePassword =
      typeof body.newSitePassword === "string" ? body.newSitePassword.trim() : "";
    const currentSitePassword =
      typeof body.currentSitePassword === "string" ? body.currentSitePassword : "";
    const params: {
      name?: string | null;
      email?: string | null;
      organization?: string | null;
      automationPaused?: boolean | null;
      automationPauseReason?: string | null;
      automationPausedAt?: string | null;
      dailyDigestEnabled?: boolean | null;
      dailyDigestTimeLocal?: string | null;
      dailyDigestTimezone?: string | null;
      defaultPurchaseClosingCostPct?: number | null;
      defaultLtv?: number | null;
      defaultInterestRate?: number | null;
      defaultAmortization?: number | null;
      defaultHoldPeriodYears?: number | null;
      defaultExitCap?: number | null;
      defaultExitClosingCostPct?: number | null;
      defaultRentUplift?: number | null;
      defaultExpenseIncrease?: number | null;
      defaultManagementFee?: number | null;
      defaultTargetIrrPct?: number | null;
      defaultVacancyPct?: number | null;
      defaultLeadTimeMonths?: number | null;
      defaultAnnualRentGrowthPct?: number | null;
      defaultAnnualOtherIncomeGrowthPct?: number | null;
      defaultAnnualExpenseGrowthPct?: number | null;
      defaultAnnualPropertyTaxGrowthPct?: number | null;
      defaultRecurringCapexAnnual?: number | null;
      defaultLoanFeePct?: number | null;
    } = {};
    if (nextSitePassword) {
      if (nextSitePassword.length < 8) {
        res.status(400).json({ error: "New password must be at least 8 characters." });
        return;
      }
      const currentPasswordValid = await verifyDefaultSitePassword(currentSitePassword);
      if (!currentPasswordValid.ok || !currentPasswordValid.profileId) {
        res.status(400).json({ error: "Current password is incorrect." });
        return;
      }
    }
    if (typeof body.name === "string") params.name = body.name.trim() || null;
    if (typeof body.email === "string") params.email = body.email.trim() || null;
    if (typeof body.organization === "string") params.organization = body.organization.trim() || null;
    if (typeof body.automationPaused === "boolean") {
      params.automationPaused = body.automationPaused;
      params.automationPauseReason =
        typeof body.automationPauseReason === "string" ? body.automationPauseReason.trim() || null : null;
      params.automationPausedAt = body.automationPaused ? new Date().toISOString() : null;
    } else if (typeof body.automationPauseReason === "string") {
      params.automationPauseReason = body.automationPauseReason.trim() || null;
    }
    if (typeof body.dailyDigestEnabled === "boolean") {
      params.dailyDigestEnabled = body.dailyDigestEnabled;
    }
    if (typeof body.dailyDigestTimeLocal === "string") {
      const trimmed = body.dailyDigestTimeLocal.trim();
      params.dailyDigestTimeLocal = /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
    }
    if (typeof body.dailyDigestTimezone === "string") {
      params.dailyDigestTimezone = body.dailyDigestTimezone.trim() || null;
    }
    if (typeof body.defaultPurchaseClosingCostPct === "number" && !Number.isNaN(body.defaultPurchaseClosingCostPct)) {
      params.defaultPurchaseClosingCostPct = body.defaultPurchaseClosingCostPct;
    }
    if (typeof body.defaultLtv === "number" && !Number.isNaN(body.defaultLtv)) params.defaultLtv = body.defaultLtv;
    if (typeof body.defaultInterestRate === "number" && !Number.isNaN(body.defaultInterestRate)) params.defaultInterestRate = body.defaultInterestRate;
    if (typeof body.defaultAmortization === "number" && !Number.isNaN(body.defaultAmortization)) params.defaultAmortization = body.defaultAmortization;
    if (typeof body.defaultHoldPeriodYears === "number" && !Number.isNaN(body.defaultHoldPeriodYears)) {
      params.defaultHoldPeriodYears = body.defaultHoldPeriodYears;
    }
    if (typeof body.defaultExitCap === "number" && !Number.isNaN(body.defaultExitCap)) params.defaultExitCap = body.defaultExitCap;
    if (typeof body.defaultExitClosingCostPct === "number" && !Number.isNaN(body.defaultExitClosingCostPct)) {
      params.defaultExitClosingCostPct = body.defaultExitClosingCostPct;
    }
    if (typeof body.defaultRentUplift === "number" && !Number.isNaN(body.defaultRentUplift)) params.defaultRentUplift = body.defaultRentUplift;
    if (typeof body.defaultExpenseIncrease === "number" && !Number.isNaN(body.defaultExpenseIncrease)) params.defaultExpenseIncrease = body.defaultExpenseIncrease;
    if (typeof body.defaultManagementFee === "number" && !Number.isNaN(body.defaultManagementFee)) params.defaultManagementFee = body.defaultManagementFee;
    if (typeof body.defaultTargetIrrPct === "number" && !Number.isNaN(body.defaultTargetIrrPct)) {
      params.defaultTargetIrrPct = body.defaultTargetIrrPct;
    }
    if (typeof body.defaultVacancyPct === "number" && !Number.isNaN(body.defaultVacancyPct)) {
      params.defaultVacancyPct = body.defaultVacancyPct;
    }
    if (typeof body.defaultLeadTimeMonths === "number" && !Number.isNaN(body.defaultLeadTimeMonths)) {
      params.defaultLeadTimeMonths = body.defaultLeadTimeMonths;
    }
    if (typeof body.defaultAnnualRentGrowthPct === "number" && !Number.isNaN(body.defaultAnnualRentGrowthPct)) {
      params.defaultAnnualRentGrowthPct = body.defaultAnnualRentGrowthPct;
    }
    if (
      typeof body.defaultAnnualOtherIncomeGrowthPct === "number" &&
      !Number.isNaN(body.defaultAnnualOtherIncomeGrowthPct)
    ) {
      params.defaultAnnualOtherIncomeGrowthPct = body.defaultAnnualOtherIncomeGrowthPct;
    }
    if (
      typeof body.defaultAnnualExpenseGrowthPct === "number" &&
      !Number.isNaN(body.defaultAnnualExpenseGrowthPct)
    ) {
      params.defaultAnnualExpenseGrowthPct = body.defaultAnnualExpenseGrowthPct;
    }
    if (
      typeof body.defaultAnnualPropertyTaxGrowthPct === "number" &&
      !Number.isNaN(body.defaultAnnualPropertyTaxGrowthPct)
    ) {
      params.defaultAnnualPropertyTaxGrowthPct = body.defaultAnnualPropertyTaxGrowthPct;
    }
    if (
      typeof body.defaultRecurringCapexAnnual === "number" &&
      !Number.isNaN(body.defaultRecurringCapexAnnual)
    ) {
      params.defaultRecurringCapexAnnual = body.defaultRecurringCapexAnnual;
    }
    if (typeof body.defaultLoanFeePct === "number" && !Number.isNaN(body.defaultLoanFeePct)) {
      params.defaultLoanFeePct = body.defaultLoanFeePct;
    }
    const updated = await repo.update(id, params);
    if (nextSitePassword) {
      const profileId = await updateDefaultSitePassword(nextSitePassword);
      setSiteAuthSessionCookie(res, profileId);
    }
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile put]", err);
    res.status(503).json({ error: "Failed to update profile.", details: message });
  }
});

/** POST /api/profile/generate-standard-leverage - set default LTV 65%, interest 6.5%, amortization 30. */
router.post("/profile/generate-standard-leverage", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new UserProfileRepo({ pool });
    const id = await repo.ensureDefault();
    const updated = await repo.update(id, {
      defaultLtv: 65,
      defaultInterestRate: 6.5,
      defaultAmortization: 30,
    });
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile generate-standard-leverage]", err);
    res.status(503).json({ error: "Failed to set standard leverage.", details: message });
  }
});

/** GET /api/profile/saved-deals - list saved deals for the default user (with property summary, address, price, units, deal_score). */
router.get("/profile/saved-deals", async (_req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const pool = getPool();
    const savedRepo = new SavedDealsRepo({ pool });
    const propertyRepo = new PropertyRepo({ pool });
    const matchRepo = new MatchRepo({ pool });
    const listingRepo = new ListingRepo({ pool });
    const signalsRepo = new DealSignalsRepo({ pool });
    const overridesRepo = new DealScoreOverridesRepo({ pool });
    const saved = await savedRepo.listByUserId(userId);
    const results: Array<{
      savedDeal: { id: string; propertyId: string; dealStatus: string; createdAt: string };
      address: string;
      price: number | null;
      units: number | null;
      dealScore: number | null;
    }> = [];
    for (const row of saved) {
      const property = await propertyRepo.byId(row.propertyId);
      const address = property?.canonicalAddress ?? "";
      const { matches } = await matchRepo.list({ propertyId: row.propertyId, limit: 1 });
      const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;
      const price = listing?.price ?? null;
      const details = (property?.details ?? {}) as PropertyDetails;
      const rentalUnits = (details.rentalFinancials as Record<string, unknown> | undefined)?.rentalUnits as unknown[] | undefined;
      const units = resolvePreferredOmUnitCount(details) ?? rentalUnits?.length ?? null;
      const [latestSignal, scoreOverride] = await Promise.all([
        signalsRepo.getLatestByPropertyId(row.propertyId),
        overridesRepo.getActiveByPropertyId(row.propertyId),
      ]);
      const dossierReady = hasCompletedDealDossier(details);
      const dossierSummary = getPropertyDossierSummary(details);
      const calculatedDealScore =
        dossierSummary?.calculatedDealScore
        ?? dossierSummary?.dealScore
        ?? latestSignal?.dealScore
        ?? null;
      results.push({
        savedDeal: { id: row.id, propertyId: row.propertyId, dealStatus: row.dealStatus, createdAt: row.createdAt },
        address,
        price,
        units,
        dealScore: dossierReady ? resolveEffectiveDealScore(calculatedDealScore, scoreOverride) : null,
      });
    }
    res.json({ savedDeals: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile saved-deals list]", err);
    res.status(503).json({ error: "Failed to list saved deals.", details: message });
  }
});

/** POST /api/profile/saved-deals - save a deal (add to saved_deals for default user). Body: { propertyId }. */
router.post("/profile/saved-deals", async (req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const propertyId = typeof req.body?.propertyId === "string" ? req.body.propertyId.trim() : null;
    if (!propertyId) {
      res.status(400).json({ error: "propertyId required." });
      return;
    }
    const pool = getPool();
    const savedRepo = new SavedDealsRepo({ pool });
    const saved = await savedRepo.save(userId, propertyId, "saved");
    res.status(201).json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile saved-deals save]", err);
    res.status(503).json({ error: "Failed to save deal.", details: message });
  }
});

/** DELETE /api/profile/saved-deals/:propertyId - unsave a deal. */
router.delete("/profile/saved-deals/:propertyId", async (req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const { propertyId } = req.params;
    if (!propertyId) {
      res.status(400).json({ error: "propertyId required." });
      return;
    }
    const pool = getPool();
    const savedRepo = new SavedDealsRepo({ pool });
    const removed = await savedRepo.unsave(userId, propertyId);
    res.json({ ok: true, removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile saved-deals unsave]", err);
    res.status(503).json({ error: "Failed to unsave deal.", details: message });
  }
});

/** GET /api/profile/saved-deals/check?propertyIds=id1,id2 - return which property IDs are saved (for star state). */
router.get("/profile/saved-deals/check", async (req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const raw = req.query.propertyIds;
    const propertyIds = typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const pool = getPool();
    const savedRepo = new SavedDealsRepo({ pool });
    const saved = await savedRepo.listByUserId(userId);
    const savedSet = new Set(saved.map((s) => s.propertyId));
    const result: Record<string, boolean> = {};
    for (const id of propertyIds) result[id] = savedSet.has(id);
    res.json({ saved: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[profile saved-deals check]", err);
    res.status(503).json({ error: "Failed to check saved deals.", details: message });
  }
});

export default router;
