import type { SearchProfile } from "@re-sourcing/contracts";
import {
  getPool,
  ProfileRepo,
  RunRepo,
  JobRepo,
  ListingRepo,
  SnapshotRepo,
  PropertyRepo,
  MatchRepo,
} from "@re-sourcing/db";
import { fetchActiveSalesWithCriteria, fetchSaleDetailsByUrl, type NycsSearchCriteria } from "../nycRealEstateApi.js";
import { normalizeStreetEasySaleDetails } from "./normalizeStreetEasyListing.js";
import { enrichBrokers } from "../enrichment/brokerEnrichment.js";
import { computeDuplicateScores } from "../dedup/addressDedup.js";
import { normalizeAddressLineForDisplay, getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { runRentalFlowForProperty } from "../routes/properties.js";
import { syncPropertySourcingWorkflow } from "./workflow.js";
import { buildListingChangeSummary } from "./listingChangeSummary.js";

const ENRICHMENT_RATE_LIMIT_DELAY_MS =
  Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 300;

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

async function persistListingsForRun(
  runId: string,
  rawProperties: Record<string, unknown>[]
): Promise<{ listingIds: string[]; created: number; updated: number; propertyIds: string[]; errors: string[] }> {
  const pool = getPool();
  const client = await pool.connect();
  const errors: string[] = [];
  try {
    await client.query("BEGIN");
    const listingRepo = new ListingRepo({ pool, client });
    const snapshotRepo = new SnapshotRepo({ pool, client });
    const propertyRepo = new PropertyRepo({ pool, client });
    const matchRepo = new MatchRepo({ pool, client });

    const listingIds: string[] = [];
    const propertyIds: string[] = [];
    let created = 0;
    let updated = 0;

    for (let index = 0; index < rawProperties.length; index++) {
      const raw = rawProperties[index]!;
      const normalized = normalizeStreetEasySaleDetails(raw, index);
      const existing = await listingRepo.bySourceAndExternalId(normalized.source, normalized.externalId);
      const previousSnapshot = existing
        ? (await snapshotRepo.list({ listingId: existing.id, limit: 1 })).snapshots[0] ?? null
        : null;
      if (existing) {
        normalized.priceHistory = normalized.priceHistory ?? existing.priceHistory ?? null;
        normalized.rentalPriceHistory = normalized.rentalPriceHistory ?? existing.rentalPriceHistory ?? null;
      }
      const agentNames = normalized.agentNames ?? [];
      const shouldEnrichBrokers = agentNames.length > 0;
      if (shouldEnrichBrokers) {
        try {
          const context = [normalized.address, normalized.city, normalized.zip].filter(Boolean).join(", ");
          normalized.agentEnrichment = await enrichBrokers(agentNames, context || undefined);
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
      listingIds.push(upserted.listing.id);
      if (upserted.created) created++;
      else updated++;

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
      propertyIds.push(property.id);
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
    }

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
    await client.query("COMMIT");
    return {
      listingIds,
      created,
      updated,
      propertyIds: [...new Set(propertyIds)],
      errors,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function runCanonicalFollowUp(
  propertyIds: string[],
  search: SearchProfile,
  runId: string
): Promise<string[]> {
  if (propertyIds.length === 0) return [];
  const pool = getPool();
  const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
  const errors: string[] = [];
  for (let index = 0; index < propertyIds.length; index++) {
    const propertyId = propertyIds[index]!;
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_RATE_LIMIT_DELAY_MS));
    try {
      await getBBLForProperty(propertyId, { appToken });
      await runEnrichmentForProperty(propertyId, undefined, {
        appToken,
        rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
      });
      await runRentalFlowForProperty(propertyId, pool);
      await syncPropertySourcingWorkflow(propertyId, {
        pool,
        originatingProfileId: search.id,
        originatingRunId: runId,
        latestRunId: runId,
        outreachReason: "Created from saved search ingestion",
        outreachRules: search.outreachRules,
      });
    } catch (err) {
      errors.push(`${propertyId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
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

  const run = await runRepo.create(search.id, {
    triggerSource: options?.triggerSource ?? "manual",
    metadata: {
      searchName: search.name,
      scheduleCadence: search.scheduleCadence,
      criteria: buildCriteria(search),
    },
  });
  const job = await jobRepo.create(run.id, "streeteasy");
  await jobRepo.start(job.id);

  const rawProperties: Record<string, unknown>[] = [];
  const errors: string[] = [];
  try {
    const { urls } = await fetchActiveSalesWithCriteria(buildCriteria(search));
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index]!;
      try {
        const details = await fetchSaleDetailsByUrl(url);
        rawProperties.push({ ...details, _fetchUrl: url });
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const persisted = await persistListingsForRun(run.id, rawProperties);
    errors.push(...await runCanonicalFollowUp(persisted.propertyIds, search, run.id));

    const nextRunAt = buildNextRunAt(
      {
        ...search,
        lastRunAt: new Date().toISOString(),
      },
      new Date()
    );
    await profileRepo.update(search.id, {
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      nextRunAt,
    });
    await jobRepo.finish(job.id, errors.length > 0 ? "failed" : "completed", errors[0] ?? null);
    await runRepo.finish(
      run.id,
      errors.length > 0 ? "failed" : "completed",
      {
        listingsSeen: rawProperties.length,
        listingsNew: persisted.created,
        listingsUpdated: persisted.updated,
        jobsCompleted: errors.length > 0 ? 0 : 1,
        jobsFailed: errors.length > 0 ? 1 : 0,
        errors,
      },
      {
        listingIds: persisted.listingIds,
        propertyIds: persisted.propertyIds,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobRepo.finish(job.id, "failed", message);
    await runRepo.finish(
      run.id,
      "failed",
      {
        listingsSeen: rawProperties.length,
        jobsCompleted: 0,
        jobsFailed: 1,
        errors: [...errors, message],
      },
      {
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
  options?: { dueMode?: "timestamp" | "local-day" }
): Promise<{ started: number; searchIds: string[] }> {
  const pool = getPool();
  const profileRepo = new ProfileRepo({ pool });
  const runRepo = new RunRepo({ pool });
  const dueMode = options?.dueMode ?? "timestamp";
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
    await profileRepo.update(search.id, {
      nextRunAt: buildNextRunAt(search, nextRunAnchor),
    });
    await startSavedSearchRun(search.id, { triggerSource: "scheduled" });
    startedIds.push(search.id);
  }
  return { started: startedIds.length, searchIds: startedIds };
}

export { buildNextRunAt };
