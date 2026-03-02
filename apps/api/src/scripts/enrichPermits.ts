/**
 * CLI for permit enrichment: single property or batch (--all).
 * Usage:
 *   node dist/scripts/enrichPermits.js --property-id <uuid>
 *   node dist/scripts/enrichPermits.js --all [--batch-size N]
 */

import { getPool, PropertyRepo } from "@re-sourcing/db";
import { enrichPropertyWithPermits } from "../enrichment/permits/enrichPermits.js";

const PERMITS_RATE_LIMIT_DELAY_MS = Number(process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 500;
const DEFAULT_BATCH_SIZE = Number(process.env.PERMITS_BATCH_SIZE) || 50;

function parseArgs(): { propertyId?: string; all?: boolean; batchSize: number } {
  const args = process.argv.slice(2);
  let propertyId: string | undefined;
  let all = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--property-id" && args[i + 1]) {
      propertyId = args[++i];
    } else if (args[i] === "--all") {
      all = true;
    } else if (args[i] === "--batch-size" && args[i + 1]) {
      batchSize = Math.max(1, parseInt(args[++i]!, 10) || DEFAULT_BATCH_SIZE);
    }
  }
  return { propertyId, all, batchSize };
}

async function main(): Promise<number> {
  const { propertyId, all, batchSize } = parseArgs();
  const appToken = process.env.SOCRATA_APP_TOKEN ?? null;

  if (propertyId) {
    const out = await enrichPropertyWithPermits(propertyId, { appToken });
    console.log(JSON.stringify(out, null, 2));
    return out.ok ? 0 : 1;
  }

  if (all) {
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const properties = await propertyRepo.list({ limit: batchSize, offset: 0 });
    let success = 0;
    let failed = 0;
    for (let i = 0; i < properties.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, PERMITS_RATE_LIMIT_DELAY_MS));
      const out = await enrichPropertyWithPermits(properties[i]!.id, { appToken });
      if (out.ok) success++;
      else {
        failed++;
        console.error(`[permits] ${properties[i]!.id}: ${out.error ?? "failed"}`);
      }
    }
    console.log(JSON.stringify({ total: properties.length, success, failed }, null, 2));
    return failed > 0 ? 1 : 0;
  }

  console.error("Usage: node dist/scripts/enrichPermits.js --property-id <uuid> | --all [--batch-size N]");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
