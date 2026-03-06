/**
 * Dossier assumptions and generation: GET assumptions, POST generate-dossier.
 */

import { Router, type Request, type Response } from "express";
import { getPool, UserProfileRepo, PropertyRepo, MatchRepo, ListingRepo } from "@re-sourcing/db";
import { runGenerateDossier } from "../deal/runGenerateDossier.js";

const router = Router();

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
    let property: { id: string; canonicalAddress: string; primaryListing: { price: number | null; city: string | null } | null } | null = null;
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
      }
    }
    res.json({
      profile: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        organization: profile.organization,
        defaultLtv: profile.defaultLtv,
        defaultInterestRate: profile.defaultInterestRate,
        defaultAmortization: profile.defaultAmortization,
        defaultExitCap: profile.defaultExitCap,
        defaultRentUplift: profile.defaultRentUplift,
        defaultExpenseIncrease: profile.defaultExpenseIncrease,
        defaultManagementFee: profile.defaultManagementFee,
        expectedAppreciationPct: profile.expectedAppreciationPct,
      },
      property,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dossier-assumptions get]", err);
    res.status(503).json({ error: "Failed to load assumptions.", details: message });
  }
});

/** POST /api/dossier/generate - run underwriting, build Excel + dossier, save to documents. Body: { propertyId }. */
router.post("/dossier/generate", async (req: Request, res: Response) => {
  try {
    const propertyId = typeof req.body?.propertyId === "string" ? req.body.propertyId.trim() : null;
    if (!propertyId) {
      res.status(400).json({ error: "propertyId required." });
      return;
    }
    const result = await runGenerateDossier(propertyId);
    res.status(201).json({
      ok: true,
      propertyId,
      dossierDoc: result.dossierDoc,
      excelDoc: result.excelDoc,
      emailSent: result.emailSent ?? false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dossier generate]", err);
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

export default router;
