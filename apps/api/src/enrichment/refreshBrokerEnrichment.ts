/**
 * Standalone broker-contact refresh for a property: re-runs ONLY the broker
 * lookup (directory pre-pass, strict web search, optional relaxed/deep pass)
 * against the property's primary listing, persists the merged enrichment, and
 * rebuilds recipient resolution. Independent of the full enrichment pipeline.
 */
import type { AgentEnrichmentEntry, ListingNormalized } from "@re-sourcing/contracts";
import { ListingRepo, getPool } from "@re-sourcing/db";
import { getPrimaryListingForProperty, syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import {
  brokerLookupContextFromListing,
  enrichBrokers,
  hasMeaningfulBrokerEnrichment,
  hasRetainedBrokerCandidates,
  mergeBrokerEnrichment,
  type EnrichBrokersOptions,
} from "./brokerEnrichment.js";
import { findDirectoryContact, recordVerifiedContactsInDirectory } from "./brokerDirectory.js";

export interface RefreshBrokerEnrichmentOptions extends EnrichBrokersOptions {
  /** Re-run the lookup even when a sendable email already exists. */
  force?: boolean;
  /** Skip the broker_contacts pre-pass (always hit the web search). */
  skipDirectory?: boolean;
}

export interface RefreshBrokerEnrichmentResult {
  status:
    | "updated"
    | "unchanged"
    | "already_has_email"
    | "no_listing"
    | "no_agent_names"
    | "no_contact_found";
  propertyId: string;
  listingId?: string | null;
  entries?: AgentEnrichmentEntry[] | null;
  /** How each resolved contact was found, for the UI banner. */
  resolution?: {
    fromDirectory: number;
    verified: number;
    needsReview: number;
    rejected: number;
  };
}

type ListingRow = NonNullable<Awaited<ReturnType<ListingRepo["byId"]>>>;

/** Map a persisted listing row back to the normalized shape ListingRepo.upsert expects. Shared with the broker rerun CLI script. */
export function toListingNormalized(listing: ListingRow): ListingNormalized {
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

function entryHasSendableEmail(entry: AgentEnrichmentEntry | null | undefined): boolean {
  return Boolean(entry?.email?.trim());
}

function summarizeResolution(
  entries: AgentEnrichmentEntry[],
  directoryNames: Set<string>
): RefreshBrokerEnrichmentResult["resolution"] {
  let fromDirectory = 0;
  let verified = 0;
  let needsReview = 0;
  let rejected = 0;
  for (const entry of entries) {
    if (directoryNames.has(entry.name.trim().toLowerCase())) fromDirectory++;
    if (entry.verificationTier === "verified" || (entry.verificationTier == null && entryHasSendableEmail(entry))) {
      verified++;
    } else if (entry.verificationTier === "needs_review") {
      needsReview++;
    } else if (entry.verificationTier === "rejected") {
      rejected++;
    }
  }
  return { fromDirectory, verified, needsReview, rejected };
}

export async function refreshBrokerEnrichmentForProperty(
  propertyId: string,
  pool: import("pg").Pool = getPool(),
  options: RefreshBrokerEnrichmentOptions = {}
): Promise<RefreshBrokerEnrichmentResult> {
  const listing = await getPrimaryListingForProperty(propertyId, pool);
  if (!listing) return { status: "no_listing", propertyId };
  const agentNames = (listing.agentNames ?? []).map((name) => name.trim()).filter(Boolean);
  if (agentNames.length === 0) {
    return { status: "no_agent_names", propertyId, listingId: listing.id };
  }

  const existingEnrichment = listing.agentEnrichment ?? null;
  if (!options.force && existingEnrichment?.some(entryHasSendableEmail)) {
    return {
      status: "already_has_email",
      propertyId,
      listingId: listing.id,
      entries: existingEnrichment,
    };
  }

  const normalized = toListingNormalized(listing);
  // Build lookup context from TRUE source facts only. Passing previously
  // persisted enrichment as "source" would launder old LLM-found contacts
  // into verified source-payload entries (confidence 100, no review) on
  // every refresh — the context must not see stored enrichment at all.
  const context = brokerLookupContextFromListing({ ...normalized, agentEnrichment: null });
  const sourceFacts = context.agentFacts ?? null;

  // Directory pre-pass: brokers verified on other listings resolve for free.
  const directoryHits = new Map<string, AgentEnrichmentEntry>();
  if (!options.skipDirectory) {
    for (const name of agentNames) {
      const hit = await findDirectoryContact(pool, name, context.brokerageName);
      if (hit) directoryHits.set(name.trim().toLowerCase(), { ...hit, name });
    }
  }
  const unresolvedNames = agentNames.filter((name) => !directoryHits.has(name.trim().toLowerCase()));

  const lookedUp =
    unresolvedNames.length > 0
      ? await enrichBrokers(unresolvedNames, context, {
          relaxedSecondPass: options.relaxedSecondPass,
          deep: options.deep,
        })
      : null;
  const combinedLookup = [
    ...directoryHits.values(),
    ...(lookedUp ?? []),
  ];
  const merged = mergeBrokerEnrichment(
    agentNames,
    sourceFacts,
    combinedLookup.length > 0 ? combinedLookup : null,
    context
  );

  // Never let a weaker re-lookup erase a contact we already had: per broker,
  // keep the existing entry when the fresh merge produced nothing sendable,
  // carrying over any newly retained candidate for review.
  const existingByName = new Map<string, AgentEnrichmentEntry>();
  for (const entry of existingEnrichment ?? []) {
    const key = entry.name?.trim().toLowerCase();
    if (key) existingByName.set(key, entry);
  }
  const finalEntries: AgentEnrichmentEntry[] | null = merged
    ? merged.map((entry) => {
        const existing = existingByName.get(entry.name.trim().toLowerCase());
        if (!entry.email && !entry.phone && (existing?.email || existing?.phone)) {
          return {
            ...existing!,
            rejectedCandidate: entry.rejectedCandidate ?? existing!.rejectedCandidate ?? null,
          };
        }
        return entry;
      })
    : null;

  if (
    !finalEntries ||
    (!hasMeaningfulBrokerEnrichment(finalEntries) && !hasRetainedBrokerCandidates(finalEntries))
  ) {
    return { status: "no_contact_found", propertyId, listingId: listing.id };
  }

  const nextSerialized = JSON.stringify(finalEntries);
  const previousSerialized = JSON.stringify(existingEnrichment ?? null);
  if (nextSerialized === previousSerialized) {
    return {
      status: "unchanged",
      propertyId,
      listingId: listing.id,
      entries: finalEntries,
      resolution: summarizeResolution(finalEntries, new Set(directoryHits.keys())),
    };
  }

  normalized.agentEnrichment = finalEntries;
  const listingRepo = new ListingRepo({ pool });
  await listingRepo.upsert(normalized, { uploadedRunId: listing.uploadedRunId ?? null });
  await recordVerifiedContactsInDirectory(pool, finalEntries);
  await syncPropertySourcingWorkflow(propertyId, { pool });

  return {
    status: "updated",
    propertyId,
    listingId: listing.id,
    entries: finalEntries,
    resolution: summarizeResolution(finalEntries, new Set(directoryHits.keys())),
  };
}
