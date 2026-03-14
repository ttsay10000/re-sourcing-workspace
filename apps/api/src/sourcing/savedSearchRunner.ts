import type { SearchProfile, PropertySourcingState } from "@re-sourcing/contracts";
import {
  getPool,
  ProfileRepo,
  RunRepo,
  JobRepo,
  ListingRepo,
  SnapshotRepo,
  PropertyRepo,
  MatchRepo,
  PropertySourcingStateRepo,
} from "@re-sourcing/db";
import { fetchActiveSalesWithCriteria, fetchSaleDetailsByUrl, type NycsSearchCriteria } from "../nycRealEstateApi.js";
import { normalizeStreetEasySaleDetails } from "./normalizeStreetEasyListing.js";
import { enrichBrokers, hasMeaningfulBrokerEnrichment } from "../enrichment/brokerEnrichment.js";
import { computeDuplicateScores } from "../dedup/addressDedup.js";
import { normalizeAddressLineForDisplay, getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { runRentalFlowForProperty } from "../routes/properties.js";
import { syncPropertySourcingWorkflow } from "./workflow.js";
import { buildListingChangeSummary } from "./listingChangeSummary.js";
import { runDailyOutreach, type DailyOutreachInboxSummary } from "./outreachAutomation.js";
import {
  createWorkflowRun,
  deriveWorkflowStatusFromCounts,
  mergeWorkflowRunMetadata,
  updateWorkflowRun,
  upsertWorkflowStep,
} from "../workflow/workflowTracker.js";

const ENRICHMENT_RATE_LIMIT_DELAY_MS =
  Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 300;

const ENRICHMENT_STEP_KEYS = [
  "permits",
  "hpd_registration",
  "certificate_of_occupancy",
  "zoning_ztl",
  "dob_complaints",
  "hpd_violations",
  "housing_litigations",
] as const;

type EnrichmentStepKey = (typeof ENRICHMENT_STEP_KEYS)[number];

interface PersistedListingResult {
  listingId: string;
  propertyId: string;
  created: boolean;
  errors: string[];
}

interface InquiryProgressSummary {
  sentCount: number;
  reviewRequiredCount: number;
  eligibleCount: number;
  otherCount: number;
}

interface CanonicalFollowUpSummary {
  errors: string[];
  rentalSuccess: number;
  rentalFailed: number;
  inbox: DailyOutreachInboxSummary;
  inquiry: InquiryProgressSummary & {
    batchIds: string[];
    outreachFailures: number;
  };
}

function emptyInboxSummary(): DailyOutreachInboxSummary {
  return {
    processed: 0,
    matched: 0,
    saved: 0,
    skipped: 0,
    errorCount: 0,
    blockedOutreach: false,
    lastError: null,
  };
}

function summarizeInboxCheck(inbox: DailyOutreachInboxSummary): string {
  const parts = [
    inbox.processed > 0 ? `${inbox.processed} checked` : null,
    inbox.saved > 0 ? `${inbox.saved} saved` : null,
    inbox.errorCount > 0 ? `${inbox.errorCount} issue${inbox.errorCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  if (parts.length === 0) {
    return inbox.blockedOutreach
      ? "Inbox check failed before automated outreach"
      : "Inbox checked before automated outreach";
  }
  return `Inbox: ${parts.join(", ")}`;
}

function zonedDateTimeParts(
  now: Date,
  timezone: string
): { year: number; month: number; day: number; weekday: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? 0,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

function buildNextRunAt(search: SearchProfile, now = new Date()): string | null {
  if (!search.enabled || search.scheduleCadence === "manual" || !search.runTimeLocal) return null;
  const timezone = search.timezone || "America/New_York";
  const [hoursStr = "8", minutesStr = "0"] = search.runTimeLocal.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  const localParts = zonedDateTimeParts(now, timezone);
  const candidate = zonedLocalToUtc(localParts.year, localParts.month, localParts.day, hours, minutes, timezone);

  if (search.scheduleCadence === "daily") {
    if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate.toISOString();
  }

  if (search.scheduleCadence === "weekly") {
    const target = search.weeklyRunDay ?? 1;
    const dayDiff = (target - localParts.weekday + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + dayDiff);
    if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 7);
    return candidate.toISOString();
  }

  if (search.scheduleCadence === "monthly") {
    const targetDay = Math.max(1, Math.min(search.monthlyRunDay ?? 1, 28));
    candidate.setUTCDate(targetDay);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setUTCMonth(candidate.getUTCMonth() + 1);
      candidate.setUTCDate(targetDay);
    }
    return candidate.toISOString();
  }

  return null;
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const zoned = zonedDateTimeParts(date, timezone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return zonedAsUtc - date.getTime();
}

function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMs = getTimezoneOffsetMs(utcGuess, timezone);
  return new Date(utcGuess.getTime() - offsetMs);
}

function localDateKey(date: Date, timezone: string): string {
  const parts = zonedDateTimeParts(date, timezone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function isDueByLocalDay(search: SearchProfile, now: Date): boolean {
  if (!search.nextRunAt) return false;
  const nextRunAt = new Date(search.nextRunAt);
  if (Number.isNaN(nextRunAt.getTime())) return false;
  const timezone = search.timezone || "America/New_York";
  return localDateKey(nextRunAt, timezone) <= localDateKey(now, timezone);
}

function buildCriteria(search: SearchProfile): NycsSearchCriteria {
  const areas = search.locationMode === "single"
    ? (search.singleLocationSlug?.trim() || "all-downtown")
    : (search.areaCodes.length > 0 ? search.areaCodes.join(",") : "all-downtown,all-midtown");
  return {
    areas,
    minPrice: search.minPrice ?? undefined,
    maxPrice: search.maxPrice ?? undefined,
    minBeds: search.minBeds ?? undefined,
    maxBeds: search.maxBeds ?? undefined,
    minBaths: search.minBaths ?? undefined,
    maxHoa: search.maxHoa ?? undefined,
    maxTax: search.maxTax ?? undefined,
    amenities: search.requiredAmenities.length > 0 ? search.requiredAmenities.join(",") : undefined,
    types: search.propertyTypes.length > 0 ? search.propertyTypes.join(",") : undefined,
    limit: search.resultLimit ?? 100,
  };
}

function summarizeInquiryStates(totalItems: number, states: PropertySourcingState[]): InquiryProgressSummary {
  const sentStates = new Set<PropertySourcingState["workflowState"]>([
    "sent_waiting_reply",
    "reply_received",
    "om_received_manual_review",
  ]);
  let sentCount = 0;
  let reviewRequiredCount = 0;
  let eligibleCount = 0;
  for (const state of states) {
    if (sentStates.has(state.workflowState)) sentCount++;
    else if (state.workflowState === "review_required") reviewRequiredCount++;
    else if (state.workflowState === "eligible_for_outreach") eligibleCount++;
  }
  return {
    sentCount,
    reviewRequiredCount,
    eligibleCount,
    otherCount: Math.max(0, totalItems - sentCount - reviewRequiredCount - eligibleCount),
  };
}

async function persistListingForRun(runId: string, raw: Record<string, unknown>): Promise<PersistedListingResult> {
  const pool = getPool();
  const client = await pool.connect();
  const errors: string[] = [];
  try {
    await client.query("BEGIN");
    const listingRepo = new ListingRepo({ pool, client });
    const snapshotRepo = new SnapshotRepo({ pool, client });
    const propertyRepo = new PropertyRepo({ pool, client });
    const matchRepo = new MatchRepo({ pool, client });

    const normalized = normalizeStreetEasySaleDetails(raw, 0);
    const existing = await listingRepo.bySourceAndExternalId(normalized.source, normalized.externalId);
    const previousSnapshot = existing
      ? (await snapshotRepo.list({ listingId: existing.id, limit: 1 })).snapshots[0] ?? null
      : null;
    if (existing) {
      normalized.priceHistory = normalized.priceHistory ?? existing.priceHistory ?? null;
      normalized.rentalPriceHistory = normalized.rentalPriceHistory ?? existing.rentalPriceHistory ?? null;
    }

    const agentNames = normalized.agentNames ?? [];
    if (agentNames.length > 0) {
      try {
        const context = [normalized.address, normalized.city, normalized.zip].filter(Boolean).join(", ");
        const agentEnrichment = await enrichBrokers(agentNames, context || undefined);
        if (hasMeaningfulBrokerEnrichment(agentEnrichment)) normalized.agentEnrichment = agentEnrichment;
        else if (existing?.agentEnrichment?.length) normalized.agentEnrichment = existing.agentEnrichment;
      } catch (err) {
        if (existing?.agentEnrichment?.length) normalized.agentEnrichment = existing.agentEnrichment;
        errors.push(`broker-enrichment:${normalized.externalId}:${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (existing?.agentEnrichment) {
      normalized.agentEnrichment = existing.agentEnrichment;
    }

    const sourcingUpdate = buildListingChangeSummary({
      runId,
      normalized,
      existing,
      previousSnapshot,
    });

    const upserted = await listingRepo.upsert(normalized, { uploadedRunId: runId });

    await snapshotRepo.create({
      listingId: upserted.listing.id,
      runId,
      rawPayloadPath: "inline",
      metadata: {
        capturedAt: new Date().toISOString(),
        rawPayload: raw,
        agentEnrichment: normalized.agentEnrichment ?? null,
        priceHistory: normalized.priceHistory ?? null,
        rentalPriceHistory: normalized.rentalPriceHistory ?? null,
        normalizedListing: normalized as unknown as Record<string, unknown>,
        sourcingUpdate,
      },
    });

    const canonicalAddress = [
      normalizeAddressLineForDisplay(upserted.listing.address?.trim() ?? ""),
      upserted.listing.city,
      upserted.listing.state,
      upserted.listing.zip,
    ].filter(Boolean).join(", ") || upserted.listing.address || "Unknown";
    const property = await propertyRepo.create(canonicalAddress);
    await matchRepo.create({
      listingId: upserted.listing.id,
      propertyId: property.id,
      confidence: 1,
      reasons: { addressMatch: true, normalizedAddressDistance: 0 },
    });

    const extra = upserted.listing.extra as Record<string, unknown> | null | undefined;
    const merge: Record<string, unknown> = { sourcingUpdate };
    if (upserted.listing.lat != null && upserted.listing.lon != null) {
      merge.lat = upserted.listing.lat;
      merge.lon = upserted.listing.lon;
    }
    if (extra) {
      const bbl = extra.bbl ?? extra.BBL ?? extra.borough_block_lot;
      const bin = extra.bin ?? extra.BIN ?? extra.building_identification_number;
      const hoa = extra.monthlyHoa ?? extra.monthly_hoa ?? extra.hoa;
      const tax = extra.monthlyTax ?? extra.monthly_tax ?? extra.tax;
      if (typeof bbl === "string" && /^\d{10}$/.test(bbl.trim())) merge.bbl = bbl.trim();
      if (typeof bin === "string" && bin.trim()) merge.bin = bin.trim();
      if (typeof hoa === "number" && !Number.isNaN(hoa)) merge.monthlyHoa = hoa;
      if (typeof tax === "number" && !Number.isNaN(tax)) merge.monthlyTax = tax;
    }
    if (Object.keys(merge).length > 0) await propertyRepo.mergeDetails(property.id, merge);

    await client.query("COMMIT");
    return {
      listingId: upserted.listing.id,
      propertyId: property.id,
      created: upserted.created,
      errors,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function recomputeDuplicateScores(): Promise<void> {
  const pool = getPool();
  const listingRepo = new ListingRepo({ pool });
  const { listings: allActive } = await listingRepo.list({ lifecycleState: "active", limit: 2000 });
  const dedupeUpdates = computeDuplicateScores(
    allActive.map((listing) => ({
      id: listing.id,
      address: listing.address,
      city: listing.city,
      state: listing.state,
      zip: listing.zip,
    }))
  );
  await listingRepo.updateDuplicateScores(dedupeUpdates);
}

async function runCanonicalFollowUp(
  propertyIds: string[],
  search: SearchProfile,
  runId: string,
  workflowRunId: string | null
): Promise<CanonicalFollowUpSummary> {
  const nowIso = new Date().toISOString();
  if (propertyIds.length === 0) {
    for (const stepKey of [...ENRICHMENT_STEP_KEYS, "rental_flow", "inbox", "inquiry"] as const) {
      await upsertWorkflowStep(workflowRunId, {
        stepKey,
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        status: "completed",
        startedAt: nowIso,
        finishedAt: nowIso,
        lastMessage: "No canonical properties to process",
      });
    }
    return {
      errors: [],
      rentalSuccess: 0,
      rentalFailed: 0,
      inbox: emptyInboxSummary(),
      inquiry: {
        sentCount: 0,
        reviewRequiredCount: 0,
        eligibleCount: 0,
        otherCount: 0,
        batchIds: [],
        outreachFailures: 0,
      },
    };
  }

  const pool = getPool();
  const stateRepo = new PropertySourcingStateRepo({ pool });
  const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
  const errors: string[] = [];
  let rentalSuccess = 0;
  let rentalFailed = 0;

  const enrichmentProgress = Object.fromEntries(
    ENRICHMENT_STEP_KEYS.map((stepKey) => [stepKey, { completed: 0, failed: 0, skipped: 0 }])
  ) as Record<EnrichmentStepKey, { completed: number; failed: number; skipped: number }>;

  const enrichmentStartedAt = new Date().toISOString();
  for (const stepKey of ENRICHMENT_STEP_KEYS) {
    await upsertWorkflowStep(workflowRunId, {
      stepKey,
      totalItems: propertyIds.length,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      status: "running",
      startedAt: enrichmentStartedAt,
      lastMessage: `Starting ${stepKey.replace(/_/g, " ")} for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
    });
  }

  const rentalStartedAt = new Date().toISOString();
  await upsertWorkflowStep(workflowRunId, {
    stepKey: "rental_flow",
    totalItems: propertyIds.length,
    completedItems: 0,
    failedItems: 0,
    status: "running",
    startedAt: rentalStartedAt,
    lastMessage: `Starting rental flow for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
  });

  for (let index = 0; index < propertyIds.length; index++) {
    const propertyId = propertyIds[index]!;
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_RATE_LIMIT_DELAY_MS));

    try {
      await getBBLForProperty(propertyId, { appToken });
      const enrichment = await runEnrichmentForProperty(propertyId, undefined, {
        appToken,
        rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
      });
      for (const stepKey of ENRICHMENT_STEP_KEYS) {
        const result = enrichment.results[stepKey];
        if (result?.ok) enrichmentProgress[stepKey].completed++;
        else if (result?.skipped) enrichmentProgress[stepKey].skipped++;
        else enrichmentProgress[stepKey].failed++;
        const progress = enrichmentProgress[stepKey];
        await upsertWorkflowStep(workflowRunId, {
          stepKey,
          totalItems: propertyIds.length,
          completedItems: progress.completed,
          failedItems: progress.failed,
          skippedItems: progress.skipped,
          status: deriveWorkflowStatusFromCounts({
            totalItems: propertyIds.length,
            completedItems: progress.completed,
            failedItems: progress.failed,
            skippedItems: progress.skipped,
          }),
          startedAt: enrichmentStartedAt,
          finishedAt:
            progress.completed + progress.failed + progress.skipped >= propertyIds.length
              ? new Date().toISOString()
              : null,
          lastMessage: `${progress.completed}/${propertyIds.length} completed`,
          lastError: result?.ok || result?.skipped ? null : result?.error ?? null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${propertyId}: enrichment:${message}`);
      for (const stepKey of ENRICHMENT_STEP_KEYS) {
        const progress = enrichmentProgress[stepKey];
        progress.failed++;
        await upsertWorkflowStep(workflowRunId, {
          stepKey,
          totalItems: propertyIds.length,
          completedItems: progress.completed,
          failedItems: progress.failed,
          skippedItems: progress.skipped,
          status: deriveWorkflowStatusFromCounts({
            totalItems: propertyIds.length,
            completedItems: progress.completed,
            failedItems: progress.failed,
            skippedItems: progress.skipped,
          }),
          startedAt: enrichmentStartedAt,
          finishedAt:
            progress.completed + progress.failed + progress.skipped >= propertyIds.length
              ? new Date().toISOString()
              : null,
          lastMessage: `${progress.completed}/${propertyIds.length} completed`,
          lastError: message,
        });
      }
    }

    try {
      await runRentalFlowForProperty(propertyId, pool);
      rentalSuccess++;
    } catch (err) {
      rentalFailed++;
      errors.push(`${propertyId}: rental-flow:${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await syncPropertySourcingWorkflow(propertyId, {
        pool,
        originatingProfileId: search.id,
        originatingRunId: runId,
        latestRunId: runId,
        outreachReason: "Created from saved search ingestion",
        outreachRules: search.outreachRules,
      });
    } catch (err) {
      errors.push(`${propertyId}: sourcing-workflow:${err instanceof Error ? err.message : String(err)}`);
    }

    await upsertWorkflowStep(workflowRunId, {
      stepKey: "rental_flow",
      totalItems: propertyIds.length,
      completedItems: rentalSuccess,
      failedItems: rentalFailed,
      status: deriveWorkflowStatusFromCounts({
        totalItems: propertyIds.length,
        completedItems: rentalSuccess,
        failedItems: rentalFailed,
      }),
      startedAt: rentalStartedAt,
      finishedAt:
        rentalSuccess + rentalFailed >= propertyIds.length
          ? new Date().toISOString()
          : null,
      lastMessage: `${rentalSuccess}/${propertyIds.length} properties completed`,
    });
  }

  const statesBeforeOutreach = await stateRepo.listByPropertyIds(propertyIds);
  const eligiblePropertyIds = statesBeforeOutreach
    .filter((state) => state.workflowState === "eligible_for_outreach")
    .map((state) => state.propertyId);
  let inboxSummary = emptyInboxSummary();
  const inboxStartedAt = new Date().toISOString();
  if (eligiblePropertyIds.length > 0) {
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inbox",
      totalItems: 1,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      status: "running",
      startedAt: inboxStartedAt,
      lastMessage: "Checking inbox for broker replies and OMs before automated outreach",
    });
  } else {
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inbox",
      totalItems: 1,
      completedItems: 1,
      failedItems: 0,
      skippedItems: 0,
      status: "completed",
      startedAt: inboxStartedAt,
      finishedAt: inboxStartedAt,
      lastMessage: "No properties eligible for outreach; skipped inbox check",
    });
  }
  const inquiryStartedAt = new Date().toISOString();
  await upsertWorkflowStep(workflowRunId, {
    stepKey: "inquiry",
    totalItems: propertyIds.length,
    completedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    status: eligiblePropertyIds.length > 0 ? "running" : "completed",
    startedAt: inquiryStartedAt,
    finishedAt: eligiblePropertyIds.length === 0 ? inquiryStartedAt : null,
    lastMessage:
      eligiblePropertyIds.length > 0
        ? `Attempting automated outreach for ${eligiblePropertyIds.length} propert${eligiblePropertyIds.length === 1 ? "y" : "ies"}`
        : "No properties eligible for immediate automated outreach",
  });

  let batchIds: string[] = [];
  let outreachFailures = 0;
  if (eligiblePropertyIds.length > 0) {
    try {
      const outreachResult = await runDailyOutreach({ propertyIds: eligiblePropertyIds });
      inboxSummary = outreachResult.inboxCheck;
      batchIds = outreachResult.batchIds;
      if (inboxSummary.blockedOutreach) {
        outreachFailures = eligiblePropertyIds.length;
        errors.push(`inbox-check:${inboxSummary.lastError ?? "Inbox verification failed before automated outreach"}`);
      }
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "inbox",
        totalItems: 1,
        completedItems: inboxSummary.blockedOutreach ? 0 : 1,
        failedItems: inboxSummary.blockedOutreach ? 1 : 0,
        skippedItems: 0,
        status: inboxSummary.blockedOutreach ? "failed" : inboxSummary.errorCount > 0 ? "partial" : "completed",
        startedAt: inboxStartedAt,
        finishedAt: new Date().toISOString(),
        lastMessage: summarizeInboxCheck(inboxSummary),
        lastError: inboxSummary.blockedOutreach ? (inboxSummary.lastError ?? "Inbox verification failed") : null,
        metadata: { ...inboxSummary },
      });
    } catch (err) {
      outreachFailures = eligiblePropertyIds.length;
      errors.push(`outreach:${err instanceof Error ? err.message : String(err)}`);
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "inbox",
        totalItems: 1,
        completedItems: 0,
        failedItems: 1,
        skippedItems: 0,
        status: "failed",
        startedAt: inboxStartedAt,
        finishedAt: new Date().toISOString(),
        lastMessage: "Pre-outreach automation failed",
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const statesAfterOutreach = await stateRepo.listByPropertyIds(propertyIds);
  const inquirySummary = summarizeInquiryStates(propertyIds.length, statesAfterOutreach);
  const inquirySkipped = Math.max(0, propertyIds.length - inquirySummary.sentCount - outreachFailures);
  await upsertWorkflowStep(workflowRunId, {
    stepKey: "inquiry",
    totalItems: propertyIds.length,
    completedItems: inquirySummary.sentCount,
    failedItems: outreachFailures,
    skippedItems: inquirySkipped,
    status: deriveWorkflowStatusFromCounts({
      totalItems: propertyIds.length,
      completedItems: inquirySummary.sentCount,
      failedItems: outreachFailures,
      skippedItems: inquirySkipped,
    }),
    startedAt: inquiryStartedAt,
    finishedAt: new Date().toISOString(),
    lastMessage: [
      inquirySummary.sentCount > 0 ? `${inquirySummary.sentCount} sent` : null,
      inquirySummary.reviewRequiredCount > 0 ? `${inquirySummary.reviewRequiredCount} need review` : null,
      inquirySummary.eligibleCount > 0 ? `${inquirySummary.eligibleCount} still eligible` : null,
      inquirySummary.otherCount > 0 ? `${inquirySummary.otherCount} not ready` : null,
    ].filter(Boolean).join(", ") || "No automated outreach was sent",
    lastError:
      inboxSummary.blockedOutreach
        ? (inboxSummary.lastError ?? "Inbox verification failed before automated outreach")
        : outreachFailures > 0
          ? "Automated outreach failed for eligible properties"
          : null,
    metadata: {
      batchIds,
      eligiblePropertyIds,
      inbox: inboxSummary,
    },
  });

  return {
    errors,
    rentalSuccess,
    rentalFailed,
    inbox: inboxSummary,
    inquiry: {
      ...inquirySummary,
      batchIds,
      outreachFailures,
    },
  };
}

export async function executeSavedSearchRun(
  searchId: string,
  options?: { triggerSource?: string }
): Promise<void> {
  const pool = getPool();
  const profileRepo = new ProfileRepo({ pool });
  const runRepo = new RunRepo({ pool });
  const jobRepo = new JobRepo({ pool });
  const search = await profileRepo.byId(searchId);
  if (!search) throw new Error("Saved search not found.");
  if (await runRepo.hasRunningForProfile(search.id)) return;

  const criteria = buildCriteria(search);
  const workflowStartedAt = new Date().toISOString();
  const workflowRunId = await createWorkflowRun({
    runType: "saved_search_ingestion",
    displayName: `Saved search: ${search.name}`,
    scopeLabel: search.name,
    triggerSource: options?.triggerSource ?? "manual",
    totalItems: 0,
    metadata: {
      profileId: search.id,
      searchName: search.name,
      scheduleCadence: search.scheduleCadence,
      criteria,
    },
    steps: [
      {
        stepKey: "raw_ingest",
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        status: "running",
        startedAt: workflowStartedAt,
        lastMessage: "Fetching StreetEasy sale URLs",
      },
      {
        stepKey: "canonical",
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        status: "pending",
      },
      ...ENRICHMENT_STEP_KEYS.map((stepKey) => ({
        stepKey,
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        status: "pending" as const,
      })),
      {
        stepKey: "rental_flow",
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        status: "pending",
      },
      {
        stepKey: "inbox",
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        status: "pending",
      },
      {
        stepKey: "inquiry",
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        status: "pending",
      },
    ],
  });

  const run = await runRepo.create(search.id, {
    triggerSource: options?.triggerSource ?? "manual",
    metadata: {
      searchName: search.name,
      scheduleCadence: search.scheduleCadence,
      criteria,
      workflowRunId,
    },
  });
  const job = await jobRepo.create(run.id, "streeteasy");
  await jobRepo.start(job.id);

  const errors: string[] = [];
  const listingIds: string[] = [];
  const propertyIds: string[] = [];
  let created = 0;
  let updated = 0;
  let rawIngestCompleted = 0;
  let rawIngestFailed = 0;
  let canonicalCompleted = 0;
  let canonicalFailed = 0;

  try {
    const { urls } = await fetchActiveSalesWithCriteria(criteria);
    await updateWorkflowRun(workflowRunId, {
      totalItems: urls.length,
      scopeLabel: `${urls.length} listing${urls.length === 1 ? "" : "s"}`,
    });
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "raw_ingest",
      totalItems: urls.length,
      completedItems: 0,
      failedItems: 0,
      status: urls.length === 0 ? "completed" : "running",
      startedAt: workflowStartedAt,
      finishedAt: urls.length === 0 ? new Date().toISOString() : null,
      lastMessage:
        urls.length === 0
          ? "No listings matched this saved search"
          : `Fetching details for ${urls.length} listing${urls.length === 1 ? "" : "s"}`,
    });
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "canonical",
      totalItems: urls.length,
      completedItems: 0,
      failedItems: 0,
      status: urls.length === 0 ? "completed" : "running",
      startedAt: urls.length === 0 ? workflowStartedAt : null,
      finishedAt: urls.length === 0 ? new Date().toISOString() : null,
      lastMessage:
        urls.length === 0
          ? "No canonical properties created"
          : `Creating canonical properties as listing details arrive`,
    });

    for (let index = 0; index < urls.length; index++) {
      const url = urls[index]!;
      try {
        const details = await fetchSaleDetailsByUrl(url);
        rawIngestCompleted++;
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "raw_ingest",
          totalItems: urls.length,
          completedItems: rawIngestCompleted,
          failedItems: rawIngestFailed,
          status: deriveWorkflowStatusFromCounts({
            totalItems: urls.length,
            completedItems: rawIngestCompleted,
            failedItems: rawIngestFailed,
          }),
          startedAt: workflowStartedAt,
          finishedAt:
            rawIngestCompleted + rawIngestFailed >= urls.length
              ? new Date().toISOString()
              : null,
          lastMessage: `${rawIngestCompleted}/${urls.length} listing details fetched`,
        });

        try {
          const persisted = await persistListingForRun(run.id, { ...details, _fetchUrl: url });
          listingIds.push(persisted.listingId);
          propertyIds.push(persisted.propertyId);
          errors.push(...persisted.errors);
          if (persisted.created) created++;
          else updated++;
          canonicalCompleted++;
          await mergeWorkflowRunMetadata(workflowRunId, {
            propertyIds: [...new Set(propertyIds)],
            listingIds: [...new Set(listingIds)],
          });
        } catch (err) {
          canonicalFailed++;
          errors.push(`persist:${url}:${err instanceof Error ? err.message : String(err)}`);
        }
      } catch (err) {
        rawIngestFailed++;
        canonicalFailed++;
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "raw_ingest",
          totalItems: urls.length,
          completedItems: rawIngestCompleted,
          failedItems: rawIngestFailed,
          status: deriveWorkflowStatusFromCounts({
            totalItems: urls.length,
            completedItems: rawIngestCompleted,
            failedItems: rawIngestFailed,
          }),
          startedAt: workflowStartedAt,
          finishedAt:
            rawIngestCompleted + rawIngestFailed >= urls.length
              ? new Date().toISOString()
              : null,
          lastMessage: `${rawIngestCompleted}/${urls.length} listing details fetched`,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }

      await upsertWorkflowStep(workflowRunId, {
        stepKey: "canonical",
        totalItems: urls.length,
        completedItems: canonicalCompleted,
        failedItems: canonicalFailed,
        status: deriveWorkflowStatusFromCounts({
          totalItems: urls.length,
          completedItems: canonicalCompleted,
          failedItems: canonicalFailed,
        }),
        startedAt: workflowStartedAt,
        finishedAt:
          canonicalCompleted + canonicalFailed >= urls.length
            ? new Date().toISOString()
            : null,
        lastMessage: `${canonicalCompleted}/${urls.length} canonical properties created or refreshed`,
      });
    }

    await recomputeDuplicateScores();

    const uniquePropertyIds = [...new Set(propertyIds)];
    const followUp = await runCanonicalFollowUp(uniquePropertyIds, search, run.id, workflowRunId);
    errors.push(...followUp.errors);

    const finishedAt = new Date().toISOString();
    const nextRunAt = buildNextRunAt({ ...search, lastRunAt: finishedAt }, new Date(finishedAt));
    const completedWithoutErrors = errors.length === 0;
    await profileRepo.update(search.id, {
      lastRunAt: finishedAt,
      nextRunAt,
      ...(completedWithoutErrors ? { lastSuccessAt: finishedAt } : {}),
    });
    await mergeWorkflowRunMetadata(workflowRunId, {
      propertyIds: uniquePropertyIds,
      listingIds: [...new Set(listingIds)],
      inbox: followUp.inbox,
      inquiry: followUp.inquiry,
    });
    await updateWorkflowRun(workflowRunId, {
      status: completedWithoutErrors ? "completed" : "partial",
      finishedAt,
    });
    await jobRepo.finish(job.id, completedWithoutErrors ? "completed" : "failed", errors[0] ?? null);
    await runRepo.finish(
      run.id,
      completedWithoutErrors ? "completed" : "failed",
      {
        listingsSeen: rawIngestCompleted,
        listingsNew: created,
        listingsUpdated: updated,
        jobsCompleted: completedWithoutErrors ? 1 : 0,
        jobsFailed: completedWithoutErrors ? 0 : 1,
        errors,
      },
      {
        listingIds: [...new Set(listingIds)],
        propertyIds: uniquePropertyIds,
        workflowRunId,
        inbox: followUp.inbox,
        inquiry: followUp.inquiry,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date().toISOString();
    const nextRunAt = buildNextRunAt({ ...search, lastRunAt: finishedAt }, new Date(finishedAt));
    await profileRepo.update(search.id, {
      lastRunAt: finishedAt,
      nextRunAt,
    });
    await jobRepo.finish(job.id, "failed", message);
    await mergeWorkflowRunMetadata(workflowRunId, {
      listingIds: [...new Set(listingIds)],
      propertyIds: [...new Set(propertyIds)],
      error: message,
    });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt,
    });
    await runRepo.finish(
      run.id,
      "failed",
      {
        listingsSeen: rawIngestCompleted,
        listingsNew: created,
        listingsUpdated: updated,
        jobsCompleted: 0,
        jobsFailed: 1,
        errors: [...errors, message],
      },
      {
        listingIds: [...new Set(listingIds)],
        propertyIds: [...new Set(propertyIds)],
        workflowRunId,
        searchName: search.name,
      }
    );
    throw err;
  }
}

export async function startSavedSearchRun(
  searchId: string,
  options?: { triggerSource?: string }
): Promise<void> {
  void executeSavedSearchRun(searchId, options).catch((err) => {
    console.error("[saved-search run]", searchId, err instanceof Error ? err.message : err);
  });
}

export async function runDueSavedSearches(
  now = new Date(),
  options?: {
    dueMode?: "timestamp" | "local-day";
    executionMode?: "background" | "blocking";
    triggerSource?: string;
  }
): Promise<{ started: number; searchIds: string[]; failedSearchIds: string[] }> {
  const pool = getPool();
  const profileRepo = new ProfileRepo({ pool });
  const runRepo = new RunRepo({ pool });
  const dueMode = options?.dueMode ?? "timestamp";
  const executionMode = options?.executionMode ?? "background";
  const triggerSource = options?.triggerSource ?? "scheduled";
  const searches = await profileRepo.list();
  const due = searches.filter(
    (search) =>
      search.enabled &&
      search.scheduleCadence !== "manual" &&
      search.nextRunAt != null &&
      (dueMode === "local-day"
        ? isDueByLocalDay(search, now)
        : new Date(search.nextRunAt).getTime() <= now.getTime())
  );
  const startedIds: string[] = [];
  const failedIds: string[] = [];
  for (const search of due) {
    if (await runRepo.hasRunningForProfile(search.id)) continue;
    const nextRunAnchor =
      dueMode === "local-day" && search.nextRunAt != null
        ? (() => {
            const scheduledAt = new Date(search.nextRunAt);
            if (Number.isNaN(scheduledAt.getTime())) return now;
            return scheduledAt.getTime() > now.getTime() ? scheduledAt : now;
          })()
        : now;
    try {
      await profileRepo.update(search.id, {
        nextRunAt: buildNextRunAt(search, nextRunAnchor),
      });
      if (executionMode === "blocking") {
        await executeSavedSearchRun(search.id, { triggerSource });
      } else {
        await startSavedSearchRun(search.id, { triggerSource });
      }
      startedIds.push(search.id);
    } catch (err) {
      failedIds.push(search.id);
      console.error("[runDueSavedSearches]", search.id, err instanceof Error ? err.message : err);
    }
  }
  return { started: startedIds.length, searchIds: startedIds, failedSearchIds: failedIds };
}

export { buildNextRunAt };
