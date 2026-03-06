/**
 * Map DB rows (snake_case) to contract types (camelCase).
 */

import type {
  SearchProfile,
  SourceToggles,
  IngestionRun,
  RunSummary,
  IngestionJob,
  ListingRow,
  ListingNormalized,
  AgentEnrichmentEntry,
  PriceHistoryEntry,
  ListingSnapshot,
  SnapshotMetadata,
  Property,
  PropertyDetails,
  ListingPropertyMatch,
  DedupeReasons,
  SystemEvent,
  PropertyInquiryEmail,
  PropertyInquiryDocument,
  PropertyUploadedDocument,
  PropertyDocumentCategory,
  Document,
  UserProfile,
  SavedDeal,
  DealSignalRow,
} from "@re-sourcing/contracts";
import type { ListingSource, ListingLifecycleState, LocationMode, IngestionRunStatus, IngestionJobStatus, MatchStatus } from "@re-sourcing/contracts";

function toSourceToggles(v: unknown): SourceToggles {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as SourceToggles;
  }
  return { streeteasy: true, manual: true };
}

export function mapProfile(row: Record<string, unknown>): SearchProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    locationMode: row.location_mode as LocationMode,
    singleLocationSlug: (row.single_location_slug as string) ?? null,
    areaCodes: (row.area_codes as string[]) ?? [],
    minPrice: (row.min_price as number) ?? null,
    maxPrice: (row.max_price as number) ?? null,
    minBeds: (row.min_beds as number) ?? null,
    maxBeds: (row.max_beds as number) ?? null,
    minBaths: (row.min_baths as number) ?? null,
    maxBaths: (row.max_baths as number) ?? null,
    minSqft: (row.min_sqft as number) ?? null,
    maxSqft: (row.max_sqft as number) ?? null,
    requiredAmenities: (row.required_amenities as string[]) ?? [],
    sourceToggles: toSourceToggles(row.source_toggles),
    scheduleCron: (row.schedule_cron as string) ?? null,
    runIntervalMinutes: (row.run_interval_minutes as number) ?? null,
    createdAt: (row.created_at as Date)?.toISOString?.() ?? String(row.created_at),
    updatedAt: (row.updated_at as Date)?.toISOString?.() ?? String(row.updated_at),
  };
}

export function mapRun(row: Record<string, unknown>): IngestionRun {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    startedAt: (row.started_at as Date)?.toISOString?.() ?? String(row.started_at),
    finishedAt: row.finished_at != null ? (row.finished_at as Date)?.toISOString?.() ?? String(row.finished_at) : null,
    status: row.status as IngestionRunStatus,
    summary: (row.summary as RunSummary) ?? null,
    createdAt: (row.created_at as Date)?.toISOString?.() ?? String(row.created_at),
  };
}

export function mapJob(row: Record<string, unknown>): IngestionJob {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    source: row.source as ListingSource,
    status: row.status as IngestionJobStatus,
    startedAt: row.started_at != null ? (row.started_at as Date)?.toISOString?.() ?? String(row.started_at) : null,
    finishedAt: row.finished_at != null ? (row.finished_at as Date)?.toISOString?.() ?? String(row.finished_at) : null,
    errorMessage: (row.error_message as string) ?? null,
    createdAt: (row.created_at as Date)?.toISOString?.() ?? String(row.created_at),
  };
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export function mapListing(row: Record<string, unknown>): ListingRow {
  return {
    id: row.id as string,
    source: row.source as ListingSource,
    externalId: row.external_id as string,
    lifecycleState: row.lifecycle_state as ListingLifecycleState,
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
    missingSince: row.missing_since != null ? toIso(row.missing_since) : null,
    prunedAt: row.pruned_at != null ? toIso(row.pruned_at) : null,
    address: row.address as string,
    city: row.city as string,
    state: row.state as string,
    zip: row.zip as string,
    price: Number(row.price),
    beds: Number(row.beds),
    baths: Number(row.baths),
    sqft: row.sqft != null ? Number(row.sqft) : null,
    url: row.url as string,
    title: (row.title as string) ?? null,
    description: (row.description as string) ?? null,
    lat: row.lat != null ? Number(row.lat) : null,
    lon: row.lon != null ? Number(row.lon) : null,
    imageUrls: (row.image_urls as string[]) ?? null,
    listedAt: row.listed_at != null ? toIso(row.listed_at) : null,
    agentNames: (row.agent_names as string[]) ?? null,
    agentEnrichment: (row.agent_enrichment as AgentEnrichmentEntry[] | null) ?? null,
    priceHistory: (row.price_history as PriceHistoryEntry[] | null) ?? null,
    rentalPriceHistory: (row.rental_price_history as PriceHistoryEntry[] | null) ?? null,
    extra: (row.extra as Record<string, unknown>) ?? null,
    uploadedAt: row.uploaded_at != null ? toIso(row.uploaded_at) : null,
    uploadedRunId: (row.uploaded_run_id as string) ?? null,
    duplicateScore: row.duplicate_score != null ? Number(row.duplicate_score) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapSnapshot(row: Record<string, unknown>): ListingSnapshot {
  return {
    id: row.id as string,
    listingId: row.listing_id as string,
    runId: (row.run_id as string) ?? null,
    capturedAt: toIso(row.captured_at),
    rawPayloadPath: row.raw_payload_path as string,
    metadata: (row.metadata as SnapshotMetadata) ?? {},
    pruned: Boolean(row.pruned),
    createdAt: toIso(row.created_at),
  };
}

export function mapProperty(row: Record<string, unknown>): Property {
  return {
    id: row.id as string,
    canonicalAddress: row.canonical_address as string,
    details: (row.details as PropertyDetails | null) ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapMatch(row: Record<string, unknown>): ListingPropertyMatch {
  return {
    id: row.id as string,
    listingId: row.listing_id as string,
    propertyId: row.property_id as string,
    confidence: Number(row.confidence),
    reasons: (row.reasons as DedupeReasons) ?? {},
    status: row.status as MatchStatus,
    createdAt: toIso(row.created_at),
  };
}

export function mapEvent(row: Record<string, unknown>): SystemEvent {
  return {
    id: row.id as string,
    eventType: row.event_type as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: toIso(row.created_at),
  };
}

export function mapInquiryEmail(row: Record<string, unknown>): PropertyInquiryEmail {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    messageId: row.message_id as string,
    subject: (row.subject as string) ?? null,
    fromAddress: (row.from_address as string) ?? null,
    receivedAt: row.received_at != null ? toIso(row.received_at) : null,
    bodyText: (row.body_text as string) ?? null,
    bodySummary: (row.body_summary as string) ?? null,
    receiptDateFromBroker: (row.receipt_date_from_broker as string) ?? null,
    attachmentsList: (row.attachments_list as string) ?? null,
    createdAt: toIso(row.created_at),
  };
}

export function mapInquiryDocument(row: Record<string, unknown>): PropertyInquiryDocument {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    inquiryEmailId: row.inquiry_email_id as string,
    filename: row.filename as string,
    contentType: (row.content_type as string) ?? null,
    filePath: row.file_path as string,
    createdAt: toIso(row.created_at),
  };
}

export function mapPropertyUploadedDocument(row: Record<string, unknown>): PropertyUploadedDocument {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    filename: row.filename as string,
    contentType: (row.content_type as string) ?? null,
    filePath: row.file_path as string,
    category: (row.category as PropertyDocumentCategory) ?? "Other",
    source: (row.source as string) ?? null,
    createdAt: toIso(row.created_at),
  };
}

export function mapDocument(row: Record<string, unknown>): Document {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    fileName: row.file_name as string,
    fileType: (row.file_type as string) ?? null,
    source: row.source as Document["source"],
    uploadedBy: (row.uploaded_by as string) ?? null,
    storagePath: row.storage_path as string,
    createdAt: toIso(row.created_at),
  };
}

export function mapUserProfile(row: Record<string, unknown>): UserProfile {
  return {
    id: row.id as string,
    name: (row.name as string) ?? null,
    email: (row.email as string) ?? null,
    organization: (row.organization as string) ?? null,
    defaultLtv: row.default_ltv != null ? Number(row.default_ltv) : null,
    defaultInterestRate: row.default_interest_rate != null ? Number(row.default_interest_rate) : null,
    defaultAmortization: row.default_amortization != null ? Number(row.default_amortization) : null,
    defaultExitCap: row.default_exit_cap != null ? Number(row.default_exit_cap) : null,
    defaultRentUplift: row.default_rent_uplift != null ? Number(row.default_rent_uplift) : null,
    defaultExpenseIncrease: row.default_expense_increase != null ? Number(row.default_expense_increase) : null,
    defaultManagementFee: row.default_management_fee != null ? Number(row.default_management_fee) : null,
    expectedAppreciationPct: row.expected_appreciation_pct != null ? Number(row.expected_appreciation_pct) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapSavedDeal(row: Record<string, unknown>): SavedDeal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    propertyId: row.property_id as string,
    dealStatus: row.deal_status as SavedDeal["dealStatus"],
    createdAt: toIso(row.created_at),
  };
}

export function mapDealSignalRow(row: Record<string, unknown>): DealSignalRow {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    pricePerUnit: row.price_per_unit != null ? Number(row.price_per_unit) : null,
    pricePsf: row.price_psf != null ? Number(row.price_psf) : null,
    assetCapRate: row.asset_cap_rate != null ? Number(row.asset_cap_rate) : null,
    adjustedCapRate: row.adjusted_cap_rate != null ? Number(row.adjusted_cap_rate) : null,
    yieldSpread: row.yield_spread != null ? Number(row.yield_spread) : null,
    rentUpside: row.rent_upside != null ? Number(row.rent_upside) : null,
    rentPsfRatio: row.rent_psf_ratio != null ? Number(row.rent_psf_ratio) : null,
    expenseRatio: row.expense_ratio != null ? Number(row.expense_ratio) : null,
    liquidityScore: row.liquidity_score != null ? Number(row.liquidity_score) : null,
    riskScore: row.risk_score != null ? Number(row.risk_score) : null,
    priceMomentum: row.price_momentum != null ? Number(row.price_momentum) : null,
    dealScore: row.deal_score != null ? Number(row.deal_score) : null,
    irrPct: row.irr_pct != null ? Number(row.irr_pct) : null,
    equityMultiple: row.equity_multiple != null ? Number(row.equity_multiple) : null,
    cocPct: row.coc_pct != null ? Number(row.coc_pct) : null,
    holdYears: row.hold_years != null ? Number(row.hold_years) : null,
    currentNoi: row.current_noi != null ? Number(row.current_noi) : null,
    adjustedNoi: row.adjusted_noi != null ? Number(row.adjusted_noi) : null,
    generatedAt: toIso(row.generated_at),
  };
}

/** Convert ListingNormalized to DB insert/update row (snake_case). */
export function listingNormalizedToRow(l: ListingNormalized): Record<string, unknown> {
  return {
    source: l.source,
    external_id: l.externalId,
    address: l.address,
    city: l.city,
    state: l.state,
    zip: l.zip,
    price: l.price,
    beds: l.beds,
    baths: l.baths,
    sqft: l.sqft ?? null,
    url: l.url,
    title: l.title ?? null,
    description: l.description ?? null,
    lat: l.lat ?? null,
    lon: l.lon ?? null,
    image_urls: l.imageUrls ?? null,
    listed_at: l.listedAt ?? null,
    agent_names: l.agentNames ?? null,
    agent_enrichment: l.agentEnrichment ?? null,
    price_history: l.priceHistory ?? null,
    rental_price_history: l.rentalPriceHistory ?? null,
    extra: l.extra ?? null,
  };
}
