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
  DealScoreOverride,
  OmAuthoritativeSnapshot,
  OmAuthoritativeSnapshotRecord,
  OmCoverage,
  OmIngestionRun,
  BrokerContact,
  RecipientResolution,
  PropertySourcingState,
  PropertyOutreachFlag,
  PropertyActionItem,
  OutreachBatch,
  OutreachBatchItem,
} from "@re-sourcing/contracts";
import type { ListingSource, ListingLifecycleState, LocationMode, IngestionRunStatus, IngestionJobStatus, MatchStatus } from "@re-sourcing/contracts";

function toSourceToggles(v: unknown): SourceToggles {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as SourceToggles;
  }
  return { streeteasy: true, manual: true };
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === "string") : [];
}

function toJsonObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

export function mapProfile(row: Record<string, unknown>): SearchProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    enabled: row.enabled != null ? Boolean(row.enabled) : true,
    locationMode: row.location_mode as LocationMode,
    singleLocationSlug: (row.single_location_slug as string) ?? null,
    areaCodes: (row.area_codes as string[]) ?? [],
    minPrice: (row.min_price as number) ?? null,
    maxPrice: (row.max_price as number) ?? null,
    minBeds: (row.min_beds as number) ?? null,
    maxBeds: (row.max_beds as number) ?? null,
    minBaths: (row.min_baths as number) ?? null,
    maxBaths: (row.max_baths as number) ?? null,
    maxHoa: (row.max_hoa as number) ?? null,
    maxTax: (row.max_tax as number) ?? null,
    minSqft: (row.min_sqft as number) ?? null,
    maxSqft: (row.max_sqft as number) ?? null,
    requiredAmenities: (row.required_amenities as string[]) ?? [],
    propertyTypes: toStringArray(row.property_types),
    sourceToggles: toSourceToggles(row.source_toggles),
    scheduleCadence: ((row.schedule_cadence as SearchProfile["scheduleCadence"]) ?? "manual"),
    timezone: (row.timezone as string) ?? "America/New_York",
    runTimeLocal: row.run_time_local != null ? String(row.run_time_local) : null,
    weeklyRunDay: row.weekly_run_day != null ? Number(row.weekly_run_day) : null,
    monthlyRunDay: row.monthly_run_day != null ? Number(row.monthly_run_day) : null,
    nextRunAt: row.next_run_at != null ? toIso(row.next_run_at) : null,
    lastRunAt: row.last_run_at != null ? toIso(row.last_run_at) : null,
    lastSuccessAt: row.last_success_at != null ? toIso(row.last_success_at) : null,
    outreachRules: toJsonObject(row.outreach_rules) as SearchProfile["outreachRules"],
    scheduleCron: (row.schedule_cron as string) ?? null,
    runIntervalMinutes: (row.run_interval_minutes as number) ?? null,
    resultLimit: (row.result_limit as number) ?? null,
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
    triggerSource: (row.trigger_source as string) ?? "manual",
    metadata: toJsonObject(row.metadata),
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
  const linkedPropertyIds = Array.isArray(row.property_ids)
    ? row.property_ids.filter((value): value is string => typeof value === "string")
    : typeof row.property_id === "string"
      ? [row.property_id]
      : [];
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    linkedPropertyIds,
    messageId: row.message_id as string,
    gmailThreadId: (row.gmail_thread_id as string) ?? null,
    matchedBatchId: (row.matched_batch_id as string) ?? null,
    subject: (row.subject as string) ?? null,
    fromAddress: (row.from_address as string) ?? null,
    receivedAt: row.received_at != null ? toIso(row.received_at) : null,
    bodyText: (row.body_text as string) ?? null,
    processingStatus: (row.processing_status as string) ?? null,
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
    automationPaused: Boolean(row.automation_paused),
    automationPauseReason: (row.automation_pause_reason as string) ?? null,
    automationPausedAt: row.automation_paused_at != null ? toIso(row.automation_paused_at) : null,
    dailyDigestEnabled:
      row.daily_digest_enabled != null ? Boolean(row.daily_digest_enabled) : true,
    dailyDigestTimeLocal: (row.daily_digest_time_local as string) ?? null,
    dailyDigestTimezone: (row.daily_digest_timezone as string) ?? null,
    lastDailyDigestSentAt:
      row.last_daily_digest_sent_at != null ? toIso(row.last_daily_digest_sent_at) : null,
    defaultPurchaseClosingCostPct:
      row.default_purchase_closing_cost_pct != null ? Number(row.default_purchase_closing_cost_pct) : null,
    defaultLtv: row.default_ltv != null ? Number(row.default_ltv) : null,
    defaultInterestRate: row.default_interest_rate != null ? Number(row.default_interest_rate) : null,
    defaultAmortization: row.default_amortization != null ? Number(row.default_amortization) : null,
    defaultHoldPeriodYears: row.default_hold_period_years != null ? Number(row.default_hold_period_years) : null,
    defaultExitCap: row.default_exit_cap != null ? Number(row.default_exit_cap) : null,
    defaultExitClosingCostPct:
      row.default_exit_closing_cost_pct != null ? Number(row.default_exit_closing_cost_pct) : null,
    defaultRentUplift: row.default_rent_uplift != null ? Number(row.default_rent_uplift) : null,
    defaultExpenseIncrease: row.default_expense_increase != null ? Number(row.default_expense_increase) : null,
    defaultManagementFee: row.default_management_fee != null ? Number(row.default_management_fee) : null,
    defaultTargetIrrPct: row.default_target_irr_pct != null ? Number(row.default_target_irr_pct) : null,
    defaultVacancyPct: row.default_vacancy_pct != null ? Number(row.default_vacancy_pct) : null,
    defaultLeadTimeMonths:
      row.default_lead_time_months != null ? Number(row.default_lead_time_months) : null,
    defaultAnnualRentGrowthPct:
      row.default_annual_rent_growth_pct != null
        ? Number(row.default_annual_rent_growth_pct)
        : null,
    defaultAnnualOtherIncomeGrowthPct:
      row.default_annual_other_income_growth_pct != null
        ? Number(row.default_annual_other_income_growth_pct)
        : null,
    defaultAnnualExpenseGrowthPct:
      row.default_annual_expense_growth_pct != null
        ? Number(row.default_annual_expense_growth_pct)
        : null,
    defaultAnnualPropertyTaxGrowthPct:
      row.default_annual_property_tax_growth_pct != null
        ? Number(row.default_annual_property_tax_growth_pct)
        : null,
    defaultRecurringCapexAnnual:
      row.default_recurring_capex_annual != null
        ? Number(row.default_recurring_capex_annual)
        : null,
    defaultLoanFeePct: row.default_loan_fee_pct != null ? Number(row.default_loan_fee_pct) : null,
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

export function mapDealScoreOverride(row: Record<string, unknown>): DealScoreOverride {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    score: Number(row.score),
    reason: String(row.reason ?? ""),
    createdBy: (row.created_by as string) ?? null,
    createdAt: toIso(row.created_at),
    clearedAt: row.cleared_at != null ? toIso(row.cleared_at) : null,
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
    scoreBreakdown: (row.score_breakdown as DealSignalRow["scoreBreakdown"]) ?? null,
    riskProfile: (row.risk_profile as DealSignalRow["riskProfile"]) ?? null,
    riskFlags: (row.risk_flags as string[]) ?? null,
    capReasons: (row.cap_reasons as string[]) ?? null,
    confidenceScore: row.confidence_score != null ? Number(row.confidence_score) : null,
    scoreSensitivity: (row.score_sensitivity as DealSignalRow["scoreSensitivity"]) ?? null,
    scoreVersion: (row.score_version as string) ?? null,
    generatedAt: toIso(row.generated_at),
  };
}

export function mapBrokerContact(row: Record<string, unknown>): BrokerContact {
  return {
    id: row.id as string,
    normalizedEmail: row.normalized_email as string,
    displayName: (row.display_name as string) ?? null,
    firm: (row.firm as string) ?? null,
    preferredThreadId: (row.preferred_thread_id as string) ?? null,
    lastOutreachAt: row.last_outreach_at != null ? toIso(row.last_outreach_at) : null,
    lastReplyAt: row.last_reply_at != null ? toIso(row.last_reply_at) : null,
    doNotContactUntil: row.do_not_contact_until != null ? toIso(row.do_not_contact_until) : null,
    manualReviewOnly: Boolean(row.manual_review_only),
    notes: (row.notes as string) ?? null,
    activitySummary: toJsonObject(row.activity_summary),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapRecipientResolution(row: Record<string, unknown>): RecipientResolution {
  return {
    propertyId: row.property_id as string,
    status: row.status as RecipientResolution["status"],
    contactId: (row.contact_id as string) ?? null,
    contactEmail: (row.contact_email as string) ?? null,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    resolutionReason: (row.resolution_reason as string) ?? null,
    candidateContacts: Array.isArray(row.candidate_contacts)
      ? (row.candidate_contacts as RecipientResolution["candidateContacts"])
      : [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapPropertySourcingState(row: Record<string, unknown>): PropertySourcingState {
  return {
    propertyId: row.property_id as string,
    workflowState: row.workflow_state as PropertySourcingState["workflowState"],
    disposition: row.disposition as PropertySourcingState["disposition"],
    holdReason: (row.hold_reason as string) ?? null,
    holdNote: (row.hold_note as string) ?? null,
    originatingProfileId: (row.originating_profile_id as string) ?? null,
    originatingRunId: (row.originating_run_id as string) ?? null,
    latestRunId: (row.latest_run_id as string) ?? null,
    outreachReason: (row.outreach_reason as string) ?? null,
    firstEligibleAt: row.first_eligible_at != null ? toIso(row.first_eligible_at) : null,
    lastContactedAt: row.last_contacted_at != null ? toIso(row.last_contacted_at) : null,
    lastReplyAt: row.last_reply_at != null ? toIso(row.last_reply_at) : null,
    manualOmReviewAt: row.manual_om_review_at != null ? toIso(row.manual_om_review_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapPropertyOutreachFlag(row: Record<string, unknown>): PropertyOutreachFlag {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    flagType: row.flag_type as string,
    status: row.status as PropertyOutreachFlag["status"],
    summary: (row.summary as string) ?? null,
    details: toJsonObject(row.details),
    createdAt: toIso(row.created_at),
    resolvedAt: row.resolved_at != null ? toIso(row.resolved_at) : null,
    updatedAt: toIso(row.updated_at),
  };
}

export function mapPropertyActionItem(row: Record<string, unknown>): PropertyActionItem {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    actionType: row.action_type as string,
    status: row.status as PropertyActionItem["status"],
    priority: (row.priority as PropertyActionItem["priority"]) ?? "medium",
    summary: (row.summary as string) ?? null,
    details: toJsonObject(row.details),
    createdAt: toIso(row.created_at),
    dueAt: row.due_at != null ? toIso(row.due_at) : null,
    resolvedAt: row.resolved_at != null ? toIso(row.resolved_at) : null,
    updatedAt: toIso(row.updated_at),
  };
}

export function mapOutreachBatchItem(row: Record<string, unknown>): OutreachBatchItem {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    propertyId: row.property_id as string,
    status: row.status as string,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapOutreachBatch(row: Record<string, unknown>): OutreachBatch {
  return {
    id: row.id as string,
    contactId: (row.contact_id as string) ?? null,
    toAddress: row.to_address as string,
    status: row.status as string,
    createdBy: row.created_by as string,
    reviewReason: (row.review_reason as string) ?? null,
    gmailMessageId: (row.gmail_message_id as string) ?? null,
    gmailThreadId: (row.gmail_thread_id as string) ?? null,
    sentAt: row.sent_at != null ? toIso(row.sent_at) : null,
    metadata: toJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapOmIngestionRun(row: Record<string, unknown>): OmIngestionRun {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    sourceDocumentId: (row.source_document_id as string) ?? null,
    sourceType: row.source_type as OmIngestionRun["sourceType"],
    status: row.status as OmIngestionRun["status"],
    snapshotVersion:
      row.snapshot_version != null ? Number(row.snapshot_version) : null,
    extractionMethod:
      (row.extraction_method as OmIngestionRun["extractionMethod"]) ?? null,
    pageCount: row.page_count != null ? Number(row.page_count) : null,
    financialPageCount:
      row.financial_page_count != null ? Number(row.financial_page_count) : null,
    ocrPageCount: row.ocr_page_count != null ? Number(row.ocr_page_count) : null,
    sourceMeta: (row.source_meta as Record<string, unknown>) ?? null,
    coverage: (row.coverage as OmCoverage) ?? null,
    lastError: (row.last_error as string) ?? null,
    startedAt: row.started_at != null ? toIso(row.started_at) : null,
    completedAt: row.completed_at != null ? toIso(row.completed_at) : null,
    promotedAt: row.promoted_at != null ? toIso(row.promoted_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapOmAuthoritativeSnapshotRecord(
  row: Record<string, unknown>
): OmAuthoritativeSnapshotRecord {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    runId: (row.run_id as string) ?? null,
    sourceDocumentId: (row.source_document_id as string) ?? null,
    snapshotVersion:
      row.snapshot_version != null ? Number(row.snapshot_version) : null,
    snapshot: (row.snapshot as OmAuthoritativeSnapshot) ?? {},
    isActive: Boolean(row.is_active),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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
