/**
 * Re-run broker enrichment for listings with broker names.
 *
 * Default behavior targets listings that have agent names but no broker email in
 * agent_enrichment. Pass --all to force a refresh for all listings with agent names.
 *
 * Examples:
 *   npm run broker:rerun -w @re-sourcing/api
 *   npm run broker:rerun -w @re-sourcing/api -- --all --limit=200
 *   npm run broker:rerun -w @re-sourcing/api -- --listing-id=<uuid>
 *   npm run broker:rerun -w @re-sourcing/api -- --external-id=123456
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { closePool, getPool, ListingRepo, MatchRepo } from "@re-sourcing/db";
import type { ListingNormalized } from "@re-sourcing/contracts";
import { enrichBrokers, hasMeaningfulBrokerEnrichment } from "../enrichment/brokerEnrichment.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";

interface ScriptOptions {
  forceAll: boolean;
  dryRun: boolean;
  limit: number;
  listingId: string | null;
  externalId: string | null;
}

function parseArgs(argv: string[]): ScriptOptions {
  const getValue = (prefix: string): string | null => {
    const found = argv.find((arg) => arg.startsWith(`${prefix}=`));
    return found ? found.slice(prefix.length + 1).trim() || null : null;
  };

  const limitRaw = getValue("--limit");
  const limitParsed = limitRaw ? Number(limitRaw) : 100;

  return {
    forceAll: argv.includes("--all"),
    dryRun: argv.includes("--dry-run"),
    limit: Number.isFinite(limitParsed) && limitParsed > 0 ? Math.floor(limitParsed) : 100,
    listingId: getValue("--listing-id"),
    externalId: getValue("--external-id"),
  };
}

function toListingNormalized(listing: Awaited<ReturnType<ListingRepo["byId"]>>): ListingNormalized {
  if (!listing) throw new Error("Listing required");
  return {
    source: listing.source,
    externalId: listing.externalId,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    zip: listing.zip,
    price: listing.price,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft ?? null,
    url: listing.url,
    title: listing.title ?? null,
    description: listing.description ?? null,
    lat: listing.lat ?? null,
    lon: listing.lon ?? null,
    imageUrls: listing.imageUrls ?? null,
    listedAt: listing.listedAt ?? null,
    agentNames: listing.agentNames ?? null,
    agentEnrichment: listing.agentEnrichment ?? null,
    priceHistory: listing.priceHistory ?? null,
    rentalPriceHistory: listing.rentalPriceHistory ?? null,
    extra: listing.extra ?? null,
  };
}

async function findTargetListingIds(options: ScriptOptions): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM listings
     WHERE COALESCE(array_length(agent_names, 1), 0) > 0
       AND ($1::uuid IS NULL OR id = $1::uuid)
       AND ($2::text IS NULL OR external_id = $2)
       AND (
         $3::boolean = true
         OR agent_enrichment IS NULL
         OR jsonb_typeof(agent_enrichment) <> 'array'
         OR NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(agent_enrichment) AS entry
           WHERE NULLIF(BTRIM(COALESCE(entry->>'email', '')), '') IS NOT NULL
         )
       )
     ORDER BY uploaded_at DESC NULLS LAST, updated_at DESC
     LIMIT $4`,
    [options.listingId, options.externalId, options.forceAll, options.limit]
  );
  return result.rows.map((row) => row.id);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const listingRepo = new ListingRepo({ pool });
  const matchRepo = new MatchRepo({ pool });

  const targetIds = await findTargetListingIds(options);
  console.log("[rerunBrokerEnrichment] Targets:", targetIds.length, options);

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const listingId of targetIds) {
    try {
      const listing = await listingRepo.byId(listingId);
      if (!listing || !listing.agentNames?.length) {
        skipped++;
        continue;
      }

      const propertyContext = [listing.address, listing.city, listing.zip].filter(Boolean).join(", ") || undefined;
      const agentEnrichment = await enrichBrokers(listing.agentNames, propertyContext);

      if (!hasMeaningfulBrokerEnrichment(agentEnrichment)) {
        skipped++;
        console.warn(`[rerunBrokerEnrichment] No broker contact found for listing ${listing.externalId}`);
        continue;
      }

      const nextSerialized = JSON.stringify(agentEnrichment);
      const previousSerialized = JSON.stringify(listing.agentEnrichment ?? null);
      if (nextSerialized === previousSerialized) {
        unchanged++;
        continue;
      }

      console.log(`[rerunBrokerEnrichment] ${options.dryRun ? "Would update" : "Updating"} listing ${listing.externalId}`);
      if (!options.dryRun) {
        const normalized = toListingNormalized(listing);
        normalized.agentEnrichment = agentEnrichment;
        await listingRepo.upsert(normalized, { uploadedRunId: listing.uploadedRunId ?? null });

        const { matches } = await matchRepo.list({ listingId: listing.id, limit: 25 });
        const propertyIds = [...new Set(matches.map((match) => match.propertyId))];
        for (const propertyId of propertyIds) {
          await syncPropertySourcingWorkflow(propertyId, { pool });
        }
      }

      updated++;
    } catch (err) {
      failed++;
      console.error(
        `[rerunBrokerEnrichment] Failed for listing ${listingId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log("[rerunBrokerEnrichment] Summary", {
    targets: targetIds.length,
    updated,
    unchanged,
    skipped,
    failed,
    dryRun: options.dryRun,
  });

  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("[rerunBrokerEnrichment]", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
