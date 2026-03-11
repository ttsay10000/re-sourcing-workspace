import { Router, type Request, type Response } from "express";
import { getPool, ProfileRepo, RunRepo } from "@re-sourcing/db";
import { buildNextRunAt, startSavedSearchRun } from "../sourcing/savedSearchRunner.js";

const router = Router();

router.get("/saved-searches", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ProfileRepo({ pool });
    const savedSearches = await repo.list();
    res.json({ savedSearches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[saved-searches list]", err);
    res.status(503).json({ error: "Failed to load saved searches.", details: message });
  }
});

router.get("/saved-searches/:id", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ProfileRepo({ pool });
    const savedSearch = await repo.byId(req.params.id);
    if (!savedSearch) {
      res.status(404).json({ error: "Saved search not found." });
      return;
    }
    res.json({ savedSearch });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[saved-searches get]", err);
    res.status(503).json({ error: "Failed to load saved search.", details: message });
  }
});

router.post("/saved-searches", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ProfileRepo({ pool });
    const payload = req.body ?? {};
    const savedSearch = await repo.create({
      name: typeof payload.name === "string" ? payload.name.trim() || "Saved search" : "Saved search",
      enabled: payload.enabled !== false,
      locationMode: payload.locationMode === "multi" ? "multi" : "single",
      singleLocationSlug: typeof payload.singleLocationSlug === "string" ? payload.singleLocationSlug.trim() || null : null,
      areaCodes: Array.isArray(payload.areaCodes) ? payload.areaCodes.filter((value: unknown): value is string => typeof value === "string") : [],
      minPrice: typeof payload.minPrice === "number" ? payload.minPrice : null,
      maxPrice: typeof payload.maxPrice === "number" ? payload.maxPrice : null,
      minBeds: typeof payload.minBeds === "number" ? payload.minBeds : null,
      maxBeds: typeof payload.maxBeds === "number" ? payload.maxBeds : null,
      minBaths: typeof payload.minBaths === "number" ? payload.minBaths : null,
      maxBaths: typeof payload.maxBaths === "number" ? payload.maxBaths : null,
      maxHoa: typeof payload.maxHoa === "number" ? payload.maxHoa : null,
      maxTax: typeof payload.maxTax === "number" ? payload.maxTax : null,
      minSqft: typeof payload.minSqft === "number" ? payload.minSqft : null,
      maxSqft: typeof payload.maxSqft === "number" ? payload.maxSqft : null,
      requiredAmenities: Array.isArray(payload.requiredAmenities)
        ? payload.requiredAmenities.filter((value: unknown): value is string => typeof value === "string")
        : [],
      propertyTypes: Array.isArray(payload.propertyTypes)
        ? payload.propertyTypes.filter((value: unknown): value is string => typeof value === "string")
        : [],
      sourceToggles: payload.sourceToggles,
      scheduleCadence: typeof payload.scheduleCadence === "string" ? payload.scheduleCadence : "manual",
      timezone: typeof payload.timezone === "string" ? payload.timezone : "America/New_York",
      runTimeLocal: typeof payload.runTimeLocal === "string" ? payload.runTimeLocal : null,
      weeklyRunDay: typeof payload.weeklyRunDay === "number" ? payload.weeklyRunDay : null,
      monthlyRunDay: typeof payload.monthlyRunDay === "number" ? payload.monthlyRunDay : null,
      outreachRules: payload.outreachRules,
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      resultLimit: typeof payload.resultLimit === "number" ? payload.resultLimit : null,
    });
    const nextRunAt = buildNextRunAt(savedSearch);
    const updated = await repo.update(savedSearch.id, { nextRunAt });
    res.status(201).json({ savedSearch: updated ?? savedSearch });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[saved-searches create]", err);
    res.status(503).json({ error: "Failed to create saved search.", details: message });
  }
});

router.put("/saved-searches/:id", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ProfileRepo({ pool });
    const existing = await repo.byId(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Saved search not found." });
      return;
    }
    const payload = req.body ?? {};
    const patch = {
      name: typeof payload.name === "string" ? payload.name.trim() : existing.name,
      enabled: typeof payload.enabled === "boolean" ? payload.enabled : existing.enabled,
      locationMode: payload.locationMode === "multi" || payload.locationMode === "single" ? payload.locationMode : existing.locationMode,
      singleLocationSlug:
        typeof payload.singleLocationSlug === "string"
          ? payload.singleLocationSlug.trim() || null
          : payload.singleLocationSlug === null
            ? null
            : existing.singleLocationSlug,
      areaCodes: Array.isArray(payload.areaCodes)
        ? payload.areaCodes.filter((value: unknown): value is string => typeof value === "string")
        : existing.areaCodes,
      minPrice: typeof payload.minPrice === "number" ? payload.minPrice : existing.minPrice,
      maxPrice: typeof payload.maxPrice === "number" ? payload.maxPrice : existing.maxPrice,
      minBeds: typeof payload.minBeds === "number" ? payload.minBeds : existing.minBeds,
      maxBeds: typeof payload.maxBeds === "number" ? payload.maxBeds : existing.maxBeds,
      minBaths: typeof payload.minBaths === "number" ? payload.minBaths : existing.minBaths,
      maxBaths: typeof payload.maxBaths === "number" ? payload.maxBaths : existing.maxBaths,
      maxHoa: typeof payload.maxHoa === "number" ? payload.maxHoa : payload.maxHoa === null ? null : existing.maxHoa,
      maxTax: typeof payload.maxTax === "number" ? payload.maxTax : payload.maxTax === null ? null : existing.maxTax,
      minSqft: typeof payload.minSqft === "number" ? payload.minSqft : existing.minSqft,
      maxSqft: typeof payload.maxSqft === "number" ? payload.maxSqft : existing.maxSqft,
      requiredAmenities: Array.isArray(payload.requiredAmenities)
        ? payload.requiredAmenities.filter((value: unknown): value is string => typeof value === "string")
        : existing.requiredAmenities,
      propertyTypes: Array.isArray(payload.propertyTypes)
        ? payload.propertyTypes.filter((value: unknown): value is string => typeof value === "string")
        : existing.propertyTypes,
      sourceToggles: payload.sourceToggles ?? existing.sourceToggles,
      scheduleCadence: typeof payload.scheduleCadence === "string" ? payload.scheduleCadence : existing.scheduleCadence,
      timezone: typeof payload.timezone === "string" ? payload.timezone : existing.timezone,
      runTimeLocal: typeof payload.runTimeLocal === "string" ? payload.runTimeLocal : payload.runTimeLocal === null ? null : existing.runTimeLocal,
      weeklyRunDay: typeof payload.weeklyRunDay === "number" ? payload.weeklyRunDay : payload.weeklyRunDay === null ? null : existing.weeklyRunDay,
      monthlyRunDay: typeof payload.monthlyRunDay === "number" ? payload.monthlyRunDay : payload.monthlyRunDay === null ? null : existing.monthlyRunDay,
      outreachRules: payload.outreachRules ?? existing.outreachRules,
      resultLimit:
        typeof payload.resultLimit === "number"
          ? payload.resultLimit
          : payload.resultLimit === null
            ? null
            : existing.resultLimit,
    };
    const nextRunAt = buildNextRunAt({ ...existing, ...patch });
    const savedSearch = await repo.update(existing.id, { ...patch, nextRunAt });
    res.json({ savedSearch });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[saved-searches update]", err);
    res.status(503).json({ error: "Failed to update saved search.", details: message });
  }
});

router.post("/saved-searches/:id/run-now", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ProfileRepo({ pool });
    const savedSearch = await repo.byId(req.params.id);
    if (!savedSearch) {
      res.status(404).json({ error: "Saved search not found." });
      return;
    }
    await repo.update(savedSearch.id, { lastRunAt: new Date().toISOString() });
    await startSavedSearchRun(savedSearch.id, { triggerSource: "manual" });
    res.status(202).json({ ok: true, savedSearchId: savedSearch.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[saved-searches run-now]", err);
    res.status(503).json({ error: "Failed to start saved search run.", details: message });
  }
});

router.get("/saved-searches/:id/runs", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const runRepo = new RunRepo({ pool });
    const runs = await runRepo.list({ profileId: req.params.id, limit: 50 });
    res.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[saved-searches runs]", err);
    res.status(503).json({ error: "Failed to load saved search runs.", details: message });
  }
});

router.delete("/saved-searches/:id", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const repo = new ProfileRepo({ pool });
    const removed = await repo.delete(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Saved search not found." });
      return;
    }
    res.json({ ok: true, removed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[saved-searches delete]", err);
    res.status(503).json({ error: "Failed to delete saved search.", details: message });
  }
});

export default router;
