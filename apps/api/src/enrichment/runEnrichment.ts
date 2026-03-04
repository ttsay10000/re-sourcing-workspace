/**
 * Unified enrichment runner: resolve BBL first, then Phase 1 (owner cascade + tax code),
 * then permits, then the 7 modules. Owner: PLUTO → valuations → HPD → permits; once set, source of truth.
 */

import { getPool, PropertyRepo } from "@re-sourcing/db";
import { enrichPropertyWithPermits } from "./permits/enrichPermits.js";
import { getBBLForProperty } from "./resolvePropertyBBL.js";
import { getBblBaseFromDetails } from "./propertyKeys.js";
import { resolveCondoBblForQuery } from "./resolveCondoBbl.js";
import { runOwnerAndTaxCodeStep } from "./ownerAndTaxCode.js";
import { ENRICHMENT_MODULES, getEnrichmentModule } from "./modules/index.js";
import type { EnrichmentRunOptions, ResolvedContext } from "./types.js";

const DEFAULT_RATE_LIMIT_DELAY_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS || 500);

export interface RunEnrichmentForPropertyOptions extends EnrichmentRunOptions {
  rateLimitDelayMs?: number;
}

/**
 * Run enrichment for a single property. If moduleName is set, run only that module.
 * Otherwise: resolve BBL → Phase 1 (owner cascade + tax code) → permits → 7 modules.
 * Modules are skipped only if BBL/BIN could not be resolved.
 */
export async function runEnrichmentForProperty(
  propertyId: string,
  moduleName?: string,
  options: RunEnrichmentForPropertyOptions = {}
): Promise<{ ok: boolean; results: Record<string, { ok: boolean; error?: string; skipped?: boolean }> }> {
  const delayMs = options.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_DELAY_MS;
  const delay = () => new Promise((r) => setTimeout(r, delayMs));
  const results: Record<string, { ok: boolean; error?: string; skipped?: boolean }> = {};

  const modules = moduleName ? [getEnrichmentModule(moduleName)].filter(Boolean) : ENRICHMENT_MODULES;
  let runOtherModules = true;

  if (!moduleName) {
    // Resolve BBL first so every module (including permits) has it when it runs.
    const resolved = await getBBLForProperty(propertyId, { appToken: options.appToken });
    const hasBbl = !!resolved?.bbl;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    const details = (property?.details as Record<string, unknown>) ?? {};
    const hasBin = typeof details.bin === "string" && String(details.bin).trim().length > 0;
    if (!hasBbl && !hasBin) {
      runOtherModules = false;
    }
    await delay();

    let cascadeOwner: string | null = null;
    if (hasBbl && resolved?.bbl) {
      const bbl = resolved.bbl;
      const bblBase = getBblBaseFromDetails(details);
      const bblForQueries = bblBase ?? (await resolveCondoBblForQuery(bbl, { appToken: options.appToken })) ?? bbl;
      const phase1 = await runOwnerAndTaxCodeStep(propertyId, bbl, bblForQueries, { appToken: options.appToken });
      cascadeOwner = phase1.owner;
      await delay();
    }

    const permitResult = await enrichPropertyWithPermits(propertyId, {
      appToken: options.appToken,
      cascadeOwner: cascadeOwner ?? undefined,
    });
    results.permits = { ok: permitResult.ok, error: permitResult.error };
    await delay();

    // Build shared context for the 7 modules (like Phase 1) so they don't re-resolve BBL.
    let resolvedContext: ResolvedContext | null = null;
    if (runOtherModules && hasBbl && resolved?.bbl) {
      const propertyAfterPermits = await propertyRepo.byId(propertyId);
      const detailsAfter = (propertyAfterPermits?.details as Record<string, unknown>) ?? {};
      const bblStr =
        (typeof detailsAfter.bbl === "string" && String(detailsAfter.bbl).trim()) ||
        resolved.bbl;
      const bblBase = getBblBaseFromDetails(detailsAfter);
      const bblForQueries =
        bblBase ?? (await resolveCondoBblForQuery(bblStr, { appToken: options.appToken })) ?? bblStr;
      const bin =
        typeof detailsAfter.bin === "string" && String(detailsAfter.bin).trim().length > 0
          ? String(detailsAfter.bin).trim()
          : null;
      resolvedContext = { bbl: bblStr, bblForQueries, bin };
    }

    for (const mod of modules) {
      if (!mod) continue;
      if (!runOtherModules) {
        results[mod.name] = { ok: false, error: "skipped: no BBL/BIN resolved", skipped: true };
        continue;
      }
      const runOptions: RunEnrichmentForPropertyOptions = {
        appToken: options.appToken,
        rateLimitDelayMs: options.rateLimitDelayMs,
        ...(resolvedContext ? { resolvedContext } : {}),
      };
      const result = await mod.run(propertyId, runOptions);
      results[mod.name] = { ok: result.ok, error: result.error };
      await delay();
    }
  } else {
    for (const mod of modules) {
      if (!mod) continue;
      if (!runOtherModules) {
        results[mod.name] = { ok: false, error: "skipped: no BBL/BIN resolved", skipped: true };
        continue;
      }
      const result = await mod.run(propertyId, { appToken: options.appToken });
      results[mod.name] = { ok: result.ok, error: result.error };
      await delay();
    }
  }

  const ok = Object.values(results).every((r) => r.skipped || r.ok);
  return { ok, results };
}

/**
 * Run enrichment for a batch of properties. If moduleName is set, run only that module for each.
 * Otherwise run full enrichment (permits + 7 modules) per property.
 */
export async function runEnrichmentBatch(
  options: RunEnrichmentForPropertyOptions & { moduleName?: string; batchSize?: number; offset?: number } = {}
): Promise<{ total: number; success: number; failed: number; results: Record<string, number> }> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const batchSize = options.batchSize ?? Number(process.env.PERMITS_BATCH_SIZE || 50);
  const offset = options.offset ?? 0;
  const properties = await propertyRepo.list({ limit: batchSize, offset });
  let success = 0;
  let failed = 0;
  const results: Record<string, number> = {};

  for (const prop of properties) {
    const { ok, results: runResults } = await runEnrichmentForProperty(prop.id, options.moduleName, options);
    if (ok) success++;
    else failed++;
    for (const [name, r] of Object.entries(runResults)) {
      results[name] = (results[name] ?? 0) + (r.ok ? 1 : 0);
    }
  }

  return { total: properties.length, success, failed, results };
}
