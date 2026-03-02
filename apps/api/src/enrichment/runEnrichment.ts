/**
 * Unified enrichment runner: permits + 7 modules. Run one module or all for a property or batch.
 */

import { getPool, PropertyRepo } from "@re-sourcing/db";
import { enrichPropertyWithPermits } from "./permits/enrichPermits.js";
import { ENRICHMENT_MODULES, getEnrichmentModule } from "./modules/index.js";
import type { EnrichmentRunOptions } from "./types.js";

const DEFAULT_RATE_LIMIT_DELAY_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS || 500);

export interface RunEnrichmentForPropertyOptions extends EnrichmentRunOptions {
  rateLimitDelayMs?: number;
}

/**
 * Run enrichment for a single property. If moduleName is set, run only that module.
 * Otherwise run permits first, then all 7 new modules in order (single-row first, then multi-row).
 */
export async function runEnrichmentForProperty(
  propertyId: string,
  moduleName?: string,
  options: RunEnrichmentForPropertyOptions = {}
): Promise<{ ok: boolean; results: Record<string, { ok: boolean; error?: string }> }> {
  const delayMs = options.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_DELAY_MS;
  const delay = () => new Promise((r) => setTimeout(r, delayMs));
  const results: Record<string, { ok: boolean; error?: string }> = {};

  if (!moduleName) {
    const permitResult = await enrichPropertyWithPermits(propertyId, { appToken: options.appToken });
    results.permits = { ok: permitResult.ok, error: permitResult.error };
    await delay();
  }

  const modules = moduleName ? [getEnrichmentModule(moduleName)].filter(Boolean) : ENRICHMENT_MODULES;
  for (const mod of modules) {
    if (!mod) continue;
    const result = await mod.run(propertyId, { appToken: options.appToken });
    results[mod.name] = { ok: result.ok, error: result.error };
    await delay();
  }

  const ok = Object.values(results).every((r) => r.ok);
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
