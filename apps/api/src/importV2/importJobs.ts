import { createHash, randomUUID } from "crypto";
import type { Pool } from "pg";
import {
  getPool,
  ListingRepo,
  MatchRepo,
  ProfileRepo,
  PropertyPipelineEventRepo,
  PropertyRepo,
  RunRepo,
  SnapshotRepo,
} from "@re-sourcing/db";
import type {
  ListingNormalized,
  ListingSource,
  Property,
  PropertyDetails,
  PropertyManualSourceLinks,
  UiV2ImportJobPayload,
  UiV2ImportJobResponse,
  UiV2ImportJobStatus,
  UiV2ImportJobType,
  UiV2ManualEntryImportInput,
  UiV2SavedSearchRunInput,
  UiV2StreetEasyPullInput,
  UiV2StreetEasySaleIdImportInput,
  UiV2StreetEasyUrlImportInput,
} from "@re-sourcing/contracts";
import {
  extractStreetEasySaleIdFromUrl,
  fetchSaleDetailsById,
  fetchSaleDetailsByUrl,
  normalizeStreeteasyUrl,
} from "../nycRealEstateApi.js";
import { computeDuplicateScores } from "../dedup/addressDedup.js";
import { enrichBrokers, hasMeaningfulBrokerEnrichment } from "../enrichment/brokerEnrichment.js";
import { getBBLForProperty, normalizeAddressLineForDisplay } from "../enrichment/resolvePropertyBBL.js";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { normalizeStreetEasySaleDetails } from "../sourcing/normalizeStreetEasyListing.js";
import { listEnabledSavedSearchAdapters } from "../sourcing/adapters/index.js";
import { startSavedSearchRun } from "../sourcing/savedSearchRunner.js";
import {
  getPrimaryListingForProperty,
  overwriteManualBrokerResolution,
  syncPropertySourcingWorkflow,
} from "../sourcing/workflow.js";
import { runRentalFlowForProperty } from "../routes/properties.js";

type JsonRecord = Record<string, unknown>;

export interface ImportJobRouteResult {
  statusCode: number;
  body: UiV2ImportJobResponse;
}

interface PersistListingParams {
  jobType: UiV2ImportJobType;
  normalized: ListingNormalized;
  rawPayload: JsonRecord;
  targetPropertyId?: string | null;
  savedSearchId?: string | null;
  includeBrokerInfo?: boolean;
  includeImages?: boolean;
  sourceLabel: string;
  sourceUrl?: string | null;
  sourceMetadata?: JsonRecord | null;
}

interface PersistListingResult {
  property: Property;
  listingId: string;
  createdProperty: boolean;
  createdListing: boolean;
  warnings: string[];
}

const LISTING_SOURCES = new Set<ListingSource>([
  "streeteasy",
  "manual",
  "zillow",
  "nyc_api",
  "loopnet",
  "marcus_millichap",
  "other",
]);

function nowIso(): string {
  return new Date().toISOString();
}

function cleanString(value: unknown, maxLength = 2_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stableExternalId(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 24);
}

function normalizeTag(value: unknown): string | null {
  const cleaned = cleanString(value, 80);
  if (!cleaned) return null;
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sourceFromManualInput(value: unknown): ListingSource {
  const source = cleanString(value, 80);
  return source && LISTING_SOURCES.has(source as ListingSource) ? (source as ListingSource) : "manual";
}

function marketTypeFromManualInput(value: unknown): "on_market" | "off_market" | "unknown" | null {
  const marketType = cleanString(value, 80);
  if (marketType === "on_market" || marketType === "off_market" || marketType === "unknown") return marketType;
  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isStreetEasyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "streeteasy.com" || parsed.hostname.endsWith(".streeteasy.com");
  } catch {
    return false;
  }
}

function normalizeSaleId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const saleId = String(value).trim();
  return /^\d+$/.test(saleId) ? saleId : null;
}

function readManualSourceLinks(details: PropertyDetails | null | undefined): PropertyManualSourceLinks {
  const raw = details?.manualSourceLinks;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function mergeManualSourceLinks(
  details: PropertyDetails | null | undefined,
  patch: Partial<PropertyManualSourceLinks> & JsonRecord
): PropertyManualSourceLinks & JsonRecord {
  return {
    ...readManualSourceLinks(details),
    ...patch,
  };
}

function buildJobStatus(params: {
  jobType: UiV2ImportJobType;
  propertyId?: string | null;
  runId?: string | null;
  status: UiV2ImportJobStatus["status"];
  label?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  completedAt?: string | null;
}): UiV2ImportJobStatus {
  const createdAt = params.createdAt ?? nowIso();
  return {
    id: randomUUID(),
    jobType: params.jobType,
    propertyId: params.propertyId ?? null,
    runId: params.runId ?? null,
    status: params.status,
    label: params.label ?? null,
    progressPct: params.status === "completed" ? 100 : params.status === "queued" ? 0 : null,
    errorMessage: params.errorMessage ?? null,
    createdAt,
    updatedAt: params.completedAt ?? createdAt,
    completedAt: params.completedAt ?? (params.status === "completed" || params.status === "failed" ? createdAt : null),
  };
}

function makeResponse(statusCode: number, importJob: UiV2ImportJobPayload): ImportJobRouteResult {
  return {
    statusCode,
    body: { importJob },
  };
}

function completedResponse(params: {
  jobType: UiV2ImportJobType;
  propertyId?: string | null;
  runId?: string | null;
  label: string;
}): ImportJobRouteResult {
  const completedAt = nowIso();
  return makeResponse(200, {
    job: buildJobStatus({
      jobType: params.jobType,
      propertyId: params.propertyId,
      runId: params.runId,
      status: "completed",
      label: params.label,
      createdAt: completedAt,
      completedAt,
    }),
    property: null,
  });
}

export function failedImportResponse(params: {
  jobType: UiV2ImportJobType;
  statusCode: number;
  label: string;
  errorMessage: string;
  propertyId?: string | null;
}): ImportJobRouteResult {
  const completedAt = nowIso();
  return makeResponse(params.statusCode, {
    job: buildJobStatus({
      jobType: params.jobType,
      propertyId: params.propertyId,
      status: "failed",
      label: params.label,
      errorMessage: params.errorMessage,
      createdAt: completedAt,
      completedAt,
    }),
    property: null,
  });
}

async function createPipelineEvent(
  pool: Pool,
  params: {
    propertyId: string;
    eventType: string;
    title: string;
    body?: string | null;
    metadata?: JsonRecord | null;
  }
): Promise<void> {
  try {
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId: params.propertyId,
      eventType: params.eventType,
      source: "ui_v2_import",
      actor: "ui-v2",
      title: params.title,
      body: params.body ?? null,
      metadata: params.metadata ?? {},
    });
  } catch (err) {
    console.warn("[ui-v2 import event]", err instanceof Error ? err.message : err);
  }
}

function buildManualListing(input: UiV2ManualEntryImportInput): ListingNormalized {
  const canonicalAddress = cleanString(input.canonicalAddress, 500) ?? "";
  const listingUrl = cleanString(input.listingUrl, 2_000);
  const imageUrls =
    input.images
      ?.map((image) => cleanString(image.url, 2_000))
      .filter((url): url is string => Boolean(url)) ?? [];
  const source = sourceFromManualInput(input.source);
  const addressLine = canonicalAddress.split(",")[0]?.trim() || canonicalAddress;
  const externalSeed = listingUrl ?? `${source}:${canonicalAddress}`;
  const brokerName = cleanString(input.broker?.name, 250);

  return {
    source,
    externalId: stableExternalId(externalSeed),
    address: addressLine,
    city: "New York",
    state: "NY",
    zip: "",
    price: cleanNumber(input.askingPrice) ?? 0,
    beds: 0,
    baths: 0,
    sqft: null,
    url: listingUrl ?? "",
    title: addressLine,
    description: cleanString(input.notes, 10_000),
    imageUrls: imageUrls.length > 0 ? imageUrls : null,
    listedAt: nowIso(),
    agentNames: brokerName ? [brokerName] : null,
    agentEnrichment:
      input.broker && (input.broker.name || input.broker.email || input.broker.phone || input.broker.firm)
        ? [
            {
              name: cleanString(input.broker.name, 250) ?? "Manual broker",
              email: cleanString(input.broker.email, 250),
              phone: cleanString(input.broker.phone, 80),
              firm: cleanString(input.broker.firm, 250),
            },
          ]
        : null,
    extra: {
      source,
      sourcePayloadVersion: "ui_v2_manual_entry",
      units: cleanNumber(input.units),
      neighborhood: cleanString(input.neighborhood, 250),
      ownerName: cleanString(input.ownerName, 500),
      notes: cleanString(input.notes, 10_000),
      manualEntry: true,
      images: input.images ?? [],
    },
  };
}

function buildDetailsMerge(params: {
  property: Property;
  normalized: ListingNormalized;
  listingId: string;
  jobType: UiV2ImportJobType;
  sourceLabel: string;
  sourceUrl?: string | null;
  savedSearchId?: string | null;
  sourceMetadata?: JsonRecord | null;
  manualInput?: UiV2ManualEntryImportInput;
}): JsonRecord {
  const now = nowIso();
  const details = (params.property.details ?? null) as PropertyDetails | null;
  const detailRecord = isRecord(details) ? details : {};
  const pipeline = isRecord(detailRecord.pipeline) ? detailRecord.pipeline : {};
  const existingTags = Array.isArray(pipeline.tags) ? pipeline.tags.map((tag) => normalizeTag(tag)) : [];
  const inputTags = params.manualInput?.tags?.map((tag) => normalizeTag(tag)) ?? [];
  const marketType = marketTypeFromManualInput(params.manualInput?.marketType);
  const sourceLinks = {
    ...(isRecord(pipeline.sourceLinks) ? pipeline.sourceLinks : {}),
    ...(params.sourceUrl ? { listingUrl: params.sourceUrl } : {}),
    ...(params.savedSearchId ? { savedSearchId: params.savedSearchId } : {}),
  };
  const manualSourceLinks = mergeManualSourceLinks(details, {
    ...(params.sourceUrl && params.normalized.source === "streeteasy" ? { streetEasyUrl: params.sourceUrl } : {}),
    addedAt: now,
  });
  const merge: JsonRecord = {
    manualSourceLinks,
    pipeline: {
      ...pipeline,
      status: typeof pipeline.status === "string" ? pipeline.status : "new_sourced",
      uiV2Status: typeof pipeline.uiV2Status === "string" ? pipeline.uiV2Status : "new",
      source: params.sourceLabel,
      ...(marketType ? { marketType } : {}),
      sourceLinks,
      tags: uniqueStrings([...existingTags, ...inputTags, marketType]),
      lastActivityAt: now,
    },
    importV2: {
      jobType: params.jobType,
      source: params.sourceLabel,
      listingId: params.listingId,
      importedAt: now,
      savedSearchId: params.savedSearchId ?? null,
      sourceMetadata: params.sourceMetadata ?? null,
    },
  };

  if (params.normalized.lat != null && Number.isFinite(params.normalized.lat)) merge.lat = params.normalized.lat;
  if (params.normalized.lon != null && Number.isFinite(params.normalized.lon)) merge.lon = params.normalized.lon;

  const extra = params.normalized.extra;
  if (isRecord(extra)) {
    const bbl = cleanString(extra.bbl ?? extra.BBL ?? extra.borough_block_lot, 20);
    const bin = cleanString(extra.bin ?? extra.BIN ?? extra.building_identification_number, 20);
    const monthlyHoa = cleanNumber(extra.monthlyHoa ?? extra.monthly_hoa ?? extra.hoa);
    const monthlyTax = cleanNumber(extra.monthlyTax ?? extra.monthly_tax ?? extra.tax);
    const units = cleanNumber(extra.units ?? extra.unitCount ?? extra.unit_count ?? extra.totalUnits ?? extra.total_units ?? extra.numberOfUnits ?? extra.number_of_units);
    const sqft = cleanNumber(
      params.normalized.sqft ??
        extra.sqft ??
        extra.squareFeet ??
        extra.square_feet ??
        extra.sqft_feet ??
        extra.grossSqft ??
        extra.gross_square_feet ??
        extra.buildingSize ??
        extra.building_size
    );
    const lotSqft = cleanNumber(extra.lotSqft ?? extra.lot_size_sqft ?? extra.lotSizeSqft ?? extra.lot_size);
    const yearBuilt = cleanNumber(extra.yearBuilt ?? extra.year_built ?? extra.built);
    const neighborhood = cleanString(extra.neighborhood ?? extra.neighborhoodName ?? extra.neighborhood_name ?? extra.area ?? extra.area_name, 250);
    const borough = cleanString(extra.borough ?? extra.boroughName ?? extra.county, 120);
    const ownerName = cleanString(extra.ownerName, 500);
    if (bbl && /^\d{10}$/.test(bbl)) merge.bbl = bbl;
    if (bin) merge.bin = bin;
    if (monthlyHoa != null && monthlyHoa >= 0) merge.monthlyHoa = monthlyHoa;
    if (monthlyTax != null && monthlyTax >= 0) merge.monthlyTax = monthlyTax;
    if (units != null && units >= 0) merge.unitCount = units;
    if (sqft != null && sqft >= 0) merge.buildingSqft = sqft;
    if (lotSqft != null && lotSqft >= 0) merge.lotSqft = lotSqft;
    if (yearBuilt != null && yearBuilt >= 0) merge.yearBuilt = yearBuilt;
    if (neighborhood) merge.neighborhoodName = neighborhood;
    if (neighborhood || borough || params.normalized.zip) {
      const existingNeighborhood = isRecord(detailRecord.neighborhood) ? detailRecord.neighborhood : {};
      const existingPrimary = isRecord(existingNeighborhood.primary) ? existingNeighborhood.primary : {};
      merge.neighborhood = {
        ...existingNeighborhood,
        primary: {
          ...existingPrimary,
          ...(neighborhood ? { name: neighborhood } : {}),
          ...(borough ? { borough } : {}),
          ...(params.normalized.zip ? { zip: params.normalized.zip } : {}),
          source: params.normalized.source,
        },
      };
    }
    if (ownerName) {
      merge.ownerName = ownerName;
      merge.ownerInfo = ownerName;
    }
  }

  if (params.manualInput) {
    const notes = cleanString(params.manualInput.notes, 10_000);
    if (notes) merge.notes = notes;
  }

  return merge;
}

async function recomputeDuplicateScores(pool: Pool): Promise<void> {
  const listingRepo = new ListingRepo({ pool });
  const { listings } = await listingRepo.list({ lifecycleState: "active", limit: 2000 });
  const updates = computeDuplicateScores(
    listings.map((listing) => ({
      id: listing.id,
      address: listing.address,
      city: listing.city,
      state: listing.state,
      zip: listing.zip,
    }))
  );
  await listingRepo.updateDuplicateScores(updates);
}

async function persistListingAsProperty(params: PersistListingParams): Promise<PersistListingResult> {
  const pool = getPool();
  const warnings: string[] = [];
  const normalized = { ...params.normalized };
  if (params.includeImages === false) normalized.imageUrls = null;

  const client = await pool.connect();
  let propertyId = "";
  let listingId = "";
  let createdProperty = false;
  let createdListing = false;
  try {
    await client.query("BEGIN");
    const listingRepo = new ListingRepo({ pool, client });
    const propertyRepo = new PropertyRepo({ pool, client });
    const matchRepo = new MatchRepo({ pool, client });
    const snapshotRepo = new SnapshotRepo({ pool, client });

    const existingListing = await listingRepo.bySourceAndExternalId(normalized.source, normalized.externalId);
    if (existingListing) {
      normalized.priceHistory = normalized.priceHistory ?? existingListing.priceHistory ?? null;
      normalized.rentalPriceHistory = normalized.rentalPriceHistory ?? existingListing.rentalPriceHistory ?? null;
      if (params.includeImages === false) normalized.imageUrls = existingListing.imageUrls ?? null;
    }

    const shouldRunBrokerLlm = params.includeBrokerInfo !== false && (normalized.agentNames?.length ?? 0) > 0;
    if (shouldRunBrokerLlm) {
      try {
        const context = [normalized.address, normalized.city, normalized.zip].filter(Boolean).join(", ") || undefined;
        const agentEnrichment = await enrichBrokers(normalized.agentNames ?? [], context);
        if (hasMeaningfulBrokerEnrichment(agentEnrichment)) normalized.agentEnrichment = agentEnrichment;
        else if (existingListing?.agentEnrichment?.length) normalized.agentEnrichment = existingListing.agentEnrichment;
      } catch (err) {
        if (existingListing?.agentEnrichment?.length) normalized.agentEnrichment = existingListing.agentEnrichment;
        warnings.push(`Broker enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (existingListing?.agentEnrichment?.length) {
      normalized.agentEnrichment = existingListing.agentEnrichment;
    }

    const upserted = await listingRepo.upsert(normalized, { uploadedRunId: null });
    listingId = upserted.listing.id;
    createdListing = upserted.created;

    const canonicalAddress =
      [
        normalizeAddressLineForDisplay(upserted.listing.address?.trim() ?? ""),
        upserted.listing.city,
        upserted.listing.state,
        upserted.listing.zip,
      ].filter(Boolean).join(", ") || upserted.listing.address || "Unknown";
    const existingProperty =
      params.targetPropertyId != null
        ? await propertyRepo.byId(params.targetPropertyId)
        : await propertyRepo.byCanonicalAddress(canonicalAddress);
    if (params.targetPropertyId && !existingProperty) {
      throw new Error("Target property not found.");
    }
    const property = existingProperty ?? (await propertyRepo.create(canonicalAddress));
    propertyId = property.id;
    createdProperty = existingProperty == null;

    await matchRepo.create({
      listingId,
      propertyId,
      confidence: 1,
      reasons: {
        addressMatch: true,
        normalizedAddressDistance: 0,
        other: ["ui_v2_import"],
      },
    });
    await snapshotRepo.create({
      listingId,
      runId: null,
      rawPayloadPath: "inline",
      metadata: {
        importV2: true,
        jobType: params.jobType,
        source: params.sourceLabel,
        capturedAt: nowIso(),
        rawPayload: params.rawPayload,
        sourceMetadata: params.sourceMetadata ?? null,
        agentEnrichment: normalized.agentEnrichment ?? null,
        priceHistory: normalized.priceHistory ?? null,
        rentalPriceHistory: normalized.rentalPriceHistory ?? null,
        normalizedListing: normalized as unknown as JsonRecord,
      },
    });
    await propertyRepo.mergeDetails(
      propertyId,
      buildDetailsMerge({
        property,
        normalized,
        listingId,
        jobType: params.jobType,
        sourceLabel: params.sourceLabel,
        sourceUrl: params.sourceUrl,
        savedSearchId: params.savedSearchId,
        sourceMetadata: params.sourceMetadata,
      })
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await recomputeDuplicateScores(pool).catch((err) => {
    warnings.push(`Duplicate scoring failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  await syncPropertySourcingWorkflow(propertyId, { pool, originatingProfileId: params.savedSearchId ?? null }).catch((err) => {
    warnings.push(`Sourcing workflow sync failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const property = await new PropertyRepo({ pool }).byId(propertyId);
  if (!property) throw new Error("Imported property could not be loaded.");
  return {
    property,
    listingId,
    createdProperty,
    createdListing,
    warnings,
  };
}

async function persistManualEntry(input: UiV2ManualEntryImportInput): Promise<PersistListingResult> {
  const canonicalAddress = cleanString(input.canonicalAddress, 500);
  if (!canonicalAddress) throw new Error("canonicalAddress is required.");
  const listing = buildManualListing(input);
  const pool = getPool();
  const result = await persistListingAsProperty({
    jobType: "manual_entry",
    normalized: listing,
    rawPayload: {
      ...input,
      source: listing.source,
      importedAt: nowIso(),
    } as JsonRecord,
    includeBrokerInfo: false,
    includeImages: true,
    sourceLabel: "manual",
    sourceUrl: cleanString(input.listingUrl, 2_000),
  });
  await new PropertyRepo({ pool }).mergeDetails(
    result.property.id,
    buildDetailsMerge({
      property: result.property,
      normalized: listing,
      listingId: result.listingId,
      jobType: "manual_entry",
      sourceLabel: "manual",
      sourceUrl: cleanString(input.listingUrl, 2_000),
      manualInput: input,
    })
  );
  if (input.broker && (input.broker.name || input.broker.email || input.broker.phone || input.broker.firm)) {
    await overwriteManualBrokerResolution(result.property.id, {
      name: input.broker.name ?? null,
      email: input.broker.email ?? null,
      phone: input.broker.phone ?? null,
      firm: input.broker.firm ?? null,
      notes: input.broker.notes ?? null,
      actorName: "ui-v2-import",
    }, pool);
  }
  await syncPropertySourcingWorkflow(result.property.id, { pool }).catch((err) => {
    result.warnings.push(`Sourcing workflow sync failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  const refreshed = await new PropertyRepo({ pool }).byId(result.property.id);
  return {
    ...result,
    property: refreshed ?? result.property,
  };
}

async function streetEasyListingFromUrl(input: UiV2StreetEasyUrlImportInput): Promise<{
  normalized: ListingNormalized;
  rawPayload: JsonRecord;
  url: string;
  saleId: string | null;
  sourceMetadata: JsonRecord;
}> {
  const url = cleanString(input.url, 2_000);
  if (!url) throw new Error("url is required.");
  if (!isHttpUrl(url) || !isStreetEasyUrl(url)) throw new Error("url must be a valid StreetEasy URL.");
  const normalizedUrl = normalizeStreeteasyUrl(url);
  const saleId = extractStreetEasySaleIdFromUrl(normalizedUrl);
  let raw: JsonRecord;
  let fetchMethod: "id" | "url" = "url";
  try {
    raw = saleId ? await fetchSaleDetailsById(saleId) : await fetchSaleDetailsByUrl(normalizedUrl);
    fetchMethod = saleId ? "id" : "url";
  } catch (err) {
    if (!saleId) throw err;
    raw = await fetchSaleDetailsByUrl(normalizedUrl);
    fetchMethod = "url";
  }
  const normalized = normalizeStreetEasySaleDetails(
    {
      ...raw,
      id: raw.id ?? raw.listing_id ?? saleId ?? undefined,
      _fetchUrl: normalizedUrl,
    },
    0
  );
  return {
    normalized,
    rawPayload: { ...raw, _fetchUrl: normalizedUrl },
    url: normalizedUrl,
    saleId,
    sourceMetadata: {
      fetchMethod,
      saleId,
      savedSearchId: input.savedSearchId ?? null,
    },
  };
}

async function streetEasyListingFromSaleId(input: UiV2StreetEasySaleIdImportInput): Promise<{
  normalized: ListingNormalized;
  rawPayload: JsonRecord;
  url: string;
  saleId: string;
  sourceMetadata: JsonRecord;
}> {
  const saleId = normalizeSaleId(input.saleId);
  if (!saleId) throw new Error("saleId must be numeric.");
  const raw = await fetchSaleDetailsById(saleId);
  const url = `https://streeteasy.com/sale/${saleId}`;
  const normalized = normalizeStreetEasySaleDetails(
    {
      ...raw,
      id: raw.id ?? raw.listing_id ?? saleId,
      _fetchUrl: url,
    },
    0
  );
  return {
    normalized,
    rawPayload: { ...raw, _fetchUrl: url },
    url,
    saleId,
    sourceMetadata: {
      fetchMethod: "id",
      saleId,
      savedSearchId: input.savedSearchId ?? null,
    },
  };
}

async function maybeRunStreetEasyPullFollowUps(
  propertyId: string,
  input: UiV2StreetEasyPullInput,
  warnings: string[]
): Promise<void> {
  const pool = getPool();
  if (input.options?.includeBuildingDetails || input.options?.includeNearbyComparables) {
    try {
      const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
      await getBBLForProperty(propertyId, { appToken });
      await runEnrichmentForProperty(propertyId, undefined, {
        appToken,
        rateLimitDelayMs: Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 300,
      });
    } catch (err) {
      warnings.push(`City/building enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (input.options?.includeUnitDetails) {
    try {
      await runRentalFlowForProperty(propertyId, pool);
    } catch (err) {
      warnings.push(`Rental/unit flow failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function importManualEntry(input: UiV2ManualEntryImportInput): Promise<ImportJobRouteResult> {
  const pool = getPool();
  const result = await persistManualEntry(input);
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_started",
    title: "Manual import started",
    metadata: { jobType: "manual_entry" },
  });
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_completed",
    title: "Manual property imported",
    body: result.createdProperty ? "Created a new property from manual entry." : "Updated an existing property from manual entry.",
    metadata: {
      jobType: "manual_entry",
      listingId: result.listingId,
      createdProperty: result.createdProperty,
      createdListing: result.createdListing,
      warnings: result.warnings,
    },
  });
  return completedResponse({
    jobType: "manual_entry",
    propertyId: result.property.id,
    label: result.createdProperty ? "Manual property created" : "Manual property updated",
  });
}

export async function importStreetEasyUrl(input: UiV2StreetEasyUrlImportInput): Promise<ImportJobRouteResult> {
  const pool = getPool();
  const prepared = await streetEasyListingFromUrl(input);
  const result = await persistListingAsProperty({
    jobType: "streeteasy_url",
    normalized: prepared.normalized,
    rawPayload: prepared.rawPayload,
    savedSearchId: input.savedSearchId ?? null,
    includeBrokerInfo: true,
    includeImages: true,
    sourceLabel: "streeteasy",
    sourceUrl: prepared.url,
    sourceMetadata: prepared.sourceMetadata,
  });
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_started",
    title: "StreetEasy URL import started",
    metadata: { jobType: "streeteasy_url", url: prepared.url, saleId: prepared.saleId },
  });
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_completed",
    title: "StreetEasy URL imported",
    body: result.createdProperty ? "Created a property from StreetEasy." : "Refreshed the StreetEasy property.",
    metadata: {
      jobType: "streeteasy_url",
      url: prepared.url,
      saleId: prepared.saleId,
      listingId: result.listingId,
      createdProperty: result.createdProperty,
      createdListing: result.createdListing,
      warnings: result.warnings,
    },
  });
  return completedResponse({
    jobType: "streeteasy_url",
    propertyId: result.property.id,
    label: result.createdProperty ? "StreetEasy property created" : "StreetEasy property updated",
  });
}

export async function importStreetEasySaleId(input: UiV2StreetEasySaleIdImportInput): Promise<ImportJobRouteResult> {
  const pool = getPool();
  const prepared = await streetEasyListingFromSaleId(input);
  const result = await persistListingAsProperty({
    jobType: "streeteasy_sale_id",
    normalized: prepared.normalized,
    rawPayload: prepared.rawPayload,
    savedSearchId: input.savedSearchId ?? null,
    includeBrokerInfo: true,
    includeImages: true,
    sourceLabel: "streeteasy",
    sourceUrl: prepared.url,
    sourceMetadata: prepared.sourceMetadata,
  });
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_started",
    title: "StreetEasy sale ID import started",
    metadata: { jobType: "streeteasy_sale_id", saleId: prepared.saleId },
  });
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_completed",
    title: "StreetEasy sale ID imported",
    metadata: {
      jobType: "streeteasy_sale_id",
      saleId: prepared.saleId,
      listingId: result.listingId,
      createdProperty: result.createdProperty,
      createdListing: result.createdListing,
      warnings: result.warnings,
    },
  });
  return completedResponse({
    jobType: "streeteasy_sale_id",
    propertyId: result.property.id,
    label: result.createdProperty ? "StreetEasy sale imported" : "StreetEasy sale refreshed",
  });
}

export async function runStreetEasyPull(input: UiV2StreetEasyPullInput): Promise<ImportJobRouteResult> {
  const pool = getPool();
  let sourceUrl = cleanString(input.url, 2_000);
  let saleId = normalizeSaleId(input.saleId);
  if (!sourceUrl && !saleId && input.propertyId) {
    const listing = await getPrimaryListingForProperty(input.propertyId, pool);
    sourceUrl = cleanString(listing?.url, 2_000);
    saleId = sourceUrl ? extractStreetEasySaleIdFromUrl(sourceUrl) : null;
  }
  if (!sourceUrl && !saleId) {
    throw new Error("StreetEasy pull requires a url, saleId, or propertyId with a matched StreetEasy listing.");
  }
  if (input.options?.createPropertyIfMissing === false && !input.propertyId) {
    throw new Error("propertyId is required when createPropertyIfMissing is false.");
  }

  const prepared = sourceUrl
    ? await streetEasyListingFromUrl({ url: sourceUrl, savedSearchId: input.options?.savedSearchId ?? null })
    : await streetEasyListingFromSaleId({ saleId: saleId ?? "", savedSearchId: input.options?.savedSearchId ?? null });
  const result = await persistListingAsProperty({
    jobType: "streeteasy_pull",
    normalized: prepared.normalized,
    rawPayload: prepared.rawPayload,
    targetPropertyId: input.propertyId ?? null,
    savedSearchId: input.options?.savedSearchId ?? null,
    includeBrokerInfo: input.options?.includeBrokerInfo !== false,
    includeImages: input.options?.includeImages !== false,
    sourceLabel: "streeteasy",
    sourceUrl: prepared.url,
    sourceMetadata: {
      ...prepared.sourceMetadata,
      options: input.options ?? {},
    },
  });
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_started",
    title: "StreetEasy pull started",
    metadata: { jobType: "streeteasy_pull", url: prepared.url, saleId: prepared.saleId, options: input.options ?? {} },
  });
  await maybeRunStreetEasyPullFollowUps(result.property.id, input, result.warnings);
  await createPipelineEvent(pool, {
    propertyId: result.property.id,
    eventType: "import_completed",
    title: "StreetEasy pull completed",
    body: result.createdProperty ? "Created a property from the StreetEasy pull." : "Updated property data from the StreetEasy pull.",
    metadata: {
      jobType: "streeteasy_pull",
      url: prepared.url,
      saleId: prepared.saleId,
      listingId: result.listingId,
      options: input.options ?? {},
      createdProperty: result.createdProperty,
      createdListing: result.createdListing,
      warnings: result.warnings,
    },
  });
  return completedResponse({
    jobType: "streeteasy_pull",
    propertyId: result.property.id,
    label: result.createdProperty ? "StreetEasy pull created property" : "StreetEasy pull completed",
  });
}

export async function startSavedSearchImport(input: UiV2SavedSearchRunInput): Promise<ImportJobRouteResult> {
  const savedSearchId = cleanString(input.savedSearchId, 120);
  if (!savedSearchId) throw new Error("savedSearchId is required.");
  const pool = getPool();
  const profileRepo = new ProfileRepo({ pool });
  const runRepo = new RunRepo({ pool });
  const savedSearch = await profileRepo.byId(savedSearchId);
  if (!savedSearch) throw new Error("Saved search not found.");
  if (listEnabledSavedSearchAdapters(savedSearch.sourceToggles).length === 0) {
    throw new Error("No saved-search source is enabled. Enable StreetEasy for automated saved-search runs.");
  }
  if (await runRepo.hasRunningForProfile(savedSearchId)) {
    return makeResponse(409, {
      job: buildJobStatus({
        jobType: "saved_search_run",
        status: "running",
        label: "Saved search already running",
        runId: null,
      }),
      property: null,
    });
  }
  await startSavedSearchRun(savedSearchId, { triggerSource: "ui_v2_import" });
  return makeResponse(202, {
    job: buildJobStatus({
      jobType: "saved_search_run",
      status: "queued",
      label: `Started saved search: ${savedSearch.name}`,
      runId: null,
    }),
    property: null,
  });
}

export function omUrlPlaceholder(input: { propertyId?: string | null; url?: string | null }): ImportJobRouteResult {
  return failedImportResponse({
    jobType: "om_url",
    statusCode: 501,
    propertyId: cleanString(input.propertyId, 120),
    label: "OM URL import needs service extraction",
    errorMessage:
      "UI v2 OM URL import is not wired yet. The existing implementation is coupled to /api/properties/manual-add-from-om and needs a shared OM URL service before this route should process downloads.",
  });
}

export function omUploadPlaceholder(input: { propertyId?: string | null }): ImportJobRouteResult {
  return failedImportResponse({
    jobType: "om_upload",
    statusCode: 501,
    propertyId: cleanString(input.propertyId, 120),
    label: "OM upload uses legacy multipart endpoint for now",
    errorMessage:
      "UI v2 OM upload metadata is exposed here, but multipart analysis still lives in /api/deal-analysis/analyze-upload until that flow is extracted into a shared service.",
  });
}
