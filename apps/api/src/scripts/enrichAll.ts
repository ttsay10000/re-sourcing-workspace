/**
 * CLI for full enrichment (permits + 7 modules) or a single module.
 * Usage:
 *   node dist/scripts/enrichAll.js --property-id <uuid>
 *   node dist/scripts/enrichAll.js --all [--batch-size N] [--module <name>]
 */

import { runEnrichmentForProperty, runEnrichmentBatch } from "../enrichment/runEnrichment.js";
import { ENRICHMENT_MODULE_NAMES } from "../enrichment/types.js";

const RATE_LIMIT_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS || 500);
const DEFAULT_BATCH_SIZE = Number(process.env.PERMITS_BATCH_SIZE || 50);

function parseArgs(): {
  propertyId?: string;
  all?: boolean;
  batchSize: number;
  module?: string;
} {
  const args = process.argv.slice(2);
  let propertyId: string | undefined;
  let all = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let moduleName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--property-id" && args[i + 1]) {
      propertyId = args[++i];
    } else if (args[i] === "--all") {
      all = true;
    } else if (args[i] === "--batch-size" && args[i + 1]) {
      batchSize = Math.max(1, parseInt(args[++i]!, 10) || DEFAULT_BATCH_SIZE);
    } else if ((args[i] === "--module" || args[i] === "-m") && args[i + 1]) {
      moduleName = args[++i];
    }
  }
  return { propertyId, all, batchSize, module: moduleName };
}

function validateModule(name: string): boolean {
  return ENRICHMENT_MODULE_NAMES.includes(name as (typeof ENRICHMENT_MODULE_NAMES)[number]);
}

async function main(): Promise<number> {
  const { propertyId, all, batchSize, module: moduleName } = parseArgs();
  const appToken = process.env.SOCRATA_APP_TOKEN ?? null;

  if (moduleName && !validateModule(moduleName)) {
    console.error(`Invalid --module. Must be one of: ${ENRICHMENT_MODULE_NAMES.join(", ")}`);
    return 1;
  }

  if (propertyId) {
    const out = await runEnrichmentForProperty(propertyId, moduleName, {
      appToken,
      rateLimitDelayMs: RATE_LIMIT_MS,
    });
    console.log(JSON.stringify(out, null, 2));
    return out.ok ? 0 : 1;
  }

  if (all) {
    const out = await runEnrichmentBatch({
      appToken,
      moduleName,
      batchSize,
      rateLimitDelayMs: RATE_LIMIT_MS,
    });
    console.log(JSON.stringify(out, null, 2));
    return out.failed > 0 ? 1 : 0;
  }

  console.error(
    "Usage: node dist/scripts/enrichAll.js --property-id <uuid> | --all [--batch-size N] [--module <name>]"
  );
  console.error("  --module: one of " + ENRICHMENT_MODULE_NAMES.join(", "));
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
