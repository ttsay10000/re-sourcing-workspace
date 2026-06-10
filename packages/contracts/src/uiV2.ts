import type { IngestionJobStatus, IngestionRunStatus, ListingSource } from "./enums.js";
import type { ListingActivitySummary } from "./listing.js";
import type {
  BrokerCompMarketSummary,
  OmIngestionRun,
  OmIngestionRunStatus,
  PropertyDealDossierGenerationStatus,
  PropertyDealDossierSummary,
  PropertyDocumentCategory,
  PropertySourcingUpdate,
  RentalUnitRow,
  OmRentRollRow,
  SavedDeal,
} from "./property.js";
import type {
  BrokerContact,
  ItemStatus,
  PropertyActionItem,
  PropertyDisposition,
  PropertyWorkflowState,
  RecipientResolution,
} from "./sourcing.js";

export type UiV2SortDirection = "asc" | "desc";

export type UiV2MarketType = "on_market" | "off_market" | "unknown";

export type UiV2PipelineSortField =
  | "updatedAt"
  | "createdAt"
  | "listedAt"
  | "canonicalAddress"
  | "source"
  | "propertyType"
  | "marketType"
  | "askingPrice"
  | "buildingSqft"
  | "pricePerSqft"
  | "units"
  | "capRate"
  | "ltrYocPct"
  | "mtrYocPct"
  | "yocPct"
  | "dealScore"
  | "status"
  | "lastActivityAt"
  | "lastContactedAt"
  | "omStatus";

export type UiV2PipelineStatus =
  | "new"
  | "screening"
  | "interesting"
  | "saved"
  | "underwriting"
  | "tour_scheduled"
  | "tour_completed_awaiting_inputs"
  | "outreach"
  | "awaiting_broker"
  | "om_received"
  | "dossier_generated"
  | "offer_review"
  | "negotiation"
  | "contract_signed"
  | "deal_closed"
  | "rejected"
  | "archived";

export type UiV2StatusChipTone = "neutral" | "info" | "success" | "warning" | "danger";

export type UiV2ActionSurface =
  | "global_nav"
  | "pipeline_table"
  | "property_sheet"
  | "crm_table"
  | "import_wizard"
  | "saved_table"
  | "progress_table"
  | "profile";

export type UiV2PropertyActionId =
  | "open_property"
  | "edit_status"
  | "save_deal"
  | "reject_deal"
  | "restore_deal"
  | "email_broker"
  | "edit_broker"
  | "add_tag"
  | "remove_tag"
  | "upload_om"
  | "open_docs"
  | "run_enrichment"
  | "run_underwriting"
  | "run_streeteasy_pull"
  | "schedule_follow_up"
  | "mark_om_requested"
  | "mark_om_received"
  | "move_to_underwriting";

export type UiV2DealPathDecision = "pending" | "move_forward" | "need_more_info" | "reject";

export type UiV2DealPathStatus =
  | "not_scheduled"
  | "tour_scheduled"
  | "tour_completed_awaiting_inputs"
  | "offer_candidate"
  | "need_more_info"
  | "rejected_after_tour"
  | "canceled";

export interface UiV2DealPathState {
  status: UiV2DealPathStatus;
  statusLabel: string;
  tourScheduledAt?: string | null;
  tourCompletedAt?: string | null;
  tourNotes?: string | null;
  postTourDecision?: UiV2DealPathDecision | null;
  targetPrice?: number | null;
  offerAmount?: number | null;
  offerNotes?: string | null;
  loiContingencies?: string[];
  loiContingencyNotes?: string | null;
  rejectionReasonCode?: UiV2RejectionReasonCode | null;
  rejectionNotes?: string | null;
  updatedAt?: string | null;
}

export interface UiV2PropertyAction {
  id: UiV2PropertyActionId | string;
  label: string;
  surface: UiV2ActionSurface;
  tone?: UiV2StatusChipTone;
  disabled?: boolean;
  disabledReason?: string | null;
  requiresConfirmation?: boolean;
}

export interface UiV2StatusChip {
  status: UiV2PipelineStatus | PropertyWorkflowState | PropertyDisposition | string;
  label: string;
  tone?: UiV2StatusChipTone;
  editable: boolean;
}

export interface UiV2PipelineStatusOption {
  status: UiV2PipelineStatus;
  label: string;
  tone: UiV2StatusChipTone;
  editable: boolean;
  terminal?: boolean;
  description?: string;
  tableActions?: UiV2PropertyActionId[];
  sheetActions?: UiV2PropertyActionId[];
}

export const UI_V2_PIPELINE_STATUS_OPTIONS = [
  {
    status: "new",
    label: "Sourced",
    tone: "neutral",
    editable: true,
    description: "Newly sourced and ready for initial screening.",
    tableActions: ["open_property", "edit_status", "save_deal", "reject_deal"],
    sheetActions: ["email_broker", "save_deal", "reject_deal", "add_tag"],
  },
  {
    status: "screening",
    label: "Screening",
    tone: "info",
    editable: true,
    description: "Initial review is in progress.",
    tableActions: ["open_property", "edit_status", "save_deal", "reject_deal"],
    sheetActions: ["email_broker", "save_deal", "reject_deal", "add_tag"],
  },
  {
    status: "interesting",
    label: "Interesting",
    tone: "warning",
    editable: true,
    description: "Worth tracking or moving toward broker outreach.",
    tableActions: ["open_property", "edit_status", "save_deal", "reject_deal"],
    sheetActions: ["email_broker", "save_deal", "reject_deal", "add_tag"],
  },
  {
    status: "saved",
    label: "Saved",
    tone: "success",
    editable: true,
    description: "Saved for active follow-up.",
    tableActions: ["open_property", "edit_status", "email_broker", "reject_deal"],
    sheetActions: ["email_broker", "reject_deal", "add_tag"],
  },
  {
    status: "underwriting",
    label: "Underwriting",
    tone: "warning",
    editable: true,
    description: "Underwriting or deal analysis is active.",
    tableActions: ["open_property", "edit_status", "run_underwriting", "reject_deal"],
    sheetActions: ["email_broker", "run_underwriting", "reject_deal", "add_tag"],
  },
  {
    status: "tour_scheduled",
    label: "Tour Scheduled",
    tone: "info",
    editable: true,
    description: "A tour is scheduled while the deal remains under active underwriting.",
    tableActions: ["open_property", "edit_status", "run_underwriting", "reject_deal"],
    sheetActions: ["email_broker", "run_underwriting", "reject_deal", "add_tag"],
  },
  {
    status: "tour_completed_awaiting_inputs",
    label: "Tour Completed - Awaiting Inputs",
    tone: "warning",
    editable: true,
    description: "The scheduled tour date has passed and the post-tour decision still needs to be recorded.",
    tableActions: ["open_property", "edit_status", "run_underwriting", "reject_deal"],
    sheetActions: ["email_broker", "run_underwriting", "reject_deal", "add_tag"],
  },
  {
    status: "outreach",
    label: "OM Requested",
    tone: "info",
    editable: true,
    description: "The broker has been asked for the OM or related deal materials.",
    tableActions: ["open_property", "edit_status", "email_broker", "schedule_follow_up"],
    sheetActions: ["email_broker", "schedule_follow_up", "mark_om_requested", "reject_deal"],
  },
  {
    status: "awaiting_broker",
    label: "OM Requested",
    tone: "warning",
    editable: true,
    description: "Waiting on the broker to send the OM, rent roll, T-12, or related documents.",
    tableActions: ["open_property", "edit_status", "email_broker", "schedule_follow_up"],
    sheetActions: ["email_broker", "schedule_follow_up", "mark_om_received", "reject_deal"],
  },
  {
    status: "om_received",
    label: "OM Received",
    tone: "success",
    editable: true,
    description: "Offering materials or deal documents have been received.",
    tableActions: ["open_property", "edit_status", "open_docs", "run_underwriting"],
    sheetActions: ["open_docs", "upload_om", "run_underwriting", "move_to_underwriting"],
  },
  {
    status: "dossier_generated",
    label: "Dossier Generated",
    tone: "success",
    editable: true,
    description: "A deal dossier or underwriting package has been generated.",
    tableActions: ["open_property", "edit_status", "open_docs", "run_underwriting"],
    sheetActions: ["open_docs", "run_underwriting", "email_broker"],
  },
  {
    status: "offer_review",
    label: "LOI Sent",
    tone: "warning",
    editable: true,
    description: "An LOI has been sent or is ready for partner approval.",
    tableActions: ["open_property", "edit_status", "email_broker"],
    sheetActions: ["email_broker", "open_docs", "schedule_follow_up"],
  },
  {
    status: "negotiation",
    label: "Negotiation",
    tone: "warning",
    editable: true,
    description: "The deal is in pricing, terms, or counterparty negotiation.",
    tableActions: ["open_property", "edit_status", "email_broker", "schedule_follow_up"],
    sheetActions: ["email_broker", "open_docs", "schedule_follow_up"],
  },
  {
    status: "contract_signed",
    label: "Contract Signed",
    tone: "success",
    editable: true,
    description: "Contract is signed and diligence or escrow work is active.",
    tableActions: ["open_property", "edit_status", "open_docs", "schedule_follow_up"],
    sheetActions: ["open_docs", "schedule_follow_up", "email_broker"],
  },
  {
    status: "deal_closed",
    label: "Closed",
    tone: "success",
    editable: true,
    terminal: true,
    description: "The deal has closed.",
    tableActions: ["open_property", "edit_status", "open_docs"],
    sheetActions: ["open_docs"],
  },
  {
    status: "rejected",
    label: "Rejected",
    tone: "danger",
    editable: true,
    terminal: true,
    description: "Removed from active pursuit with a structured rejection reason.",
    tableActions: ["open_property", "restore_deal"],
    sheetActions: ["restore_deal", "add_tag"],
  },
  {
    status: "archived",
    label: "Archived",
    tone: "neutral",
    editable: true,
    terminal: true,
    description: "Hidden from active workflows without a deal rejection.",
    tableActions: ["open_property", "restore_deal"],
    sheetActions: ["restore_deal", "add_tag"],
  },
] as const satisfies readonly UiV2PipelineStatusOption[];

export type UiV2RejectionReasonCode =
  | "price_too_high"
  | "low_cap_rate"
  | "insufficient_noi"
  | "weak_rent_roll"
  | "rent_stabilized_exposure"
  | "poor_location"
  | "asset_type_mismatch"
  | "too_small"
  | "too_large"
  | "deferred_maintenance"
  | "environmental_or_legal_risk"
  | "financing_not_viable"
  | "broker_unresponsive"
  | "duplicate"
  | "already_sold_or_unavailable"
  | "data_quality_issue"
  | "other";

export interface UiV2RejectionReason {
  reasonCode: UiV2RejectionReasonCode;
  note?: string | null;
}

export interface UiV2RejectionReasonOption {
  code: UiV2RejectionReasonCode;
  label: string;
  category:
    | "pricing"
    | "financials"
    | "asset_fit"
    | "risk"
    | "execution"
    | "availability"
    | "data_quality"
    | "other";
  description?: string;
}

export const UI_V2_REJECTION_REASON_OPTIONS = [
  {
    code: "price_too_high",
    label: "Price too high",
    category: "pricing",
    description: "Ask price is too far above target value or replacement basis.",
  },
  {
    code: "low_cap_rate",
    label: "Low cap rate",
    category: "financials",
    description: "Current or stabilized cap rate is below the investment threshold.",
  },
  {
    code: "insufficient_noi",
    label: "Insufficient NOI",
    category: "financials",
    description: "Income profile does not support the requested pricing or target returns.",
  },
  {
    code: "weak_rent_roll",
    label: "Weak rent roll",
    category: "financials",
    description: "Rent roll quality, collections, or unit economics are not compelling.",
  },
  {
    code: "rent_stabilized_exposure",
    label: "Rent-stabilized exposure",
    category: "risk",
    description: "Regulated-unit exposure creates too much execution or upside risk.",
  },
  {
    code: "poor_location",
    label: "Poor location",
    category: "asset_fit",
    description: "Location does not fit the target geography or submarket quality bar.",
  },
  {
    code: "asset_type_mismatch",
    label: "Asset type mismatch",
    category: "asset_fit",
    description: "Property type does not match the target multifamily strategy.",
  },
  {
    code: "too_small",
    label: "Too small",
    category: "asset_fit",
    description: "Deal size, unit count, or equity check is below the target range.",
  },
  {
    code: "too_large",
    label: "Too large",
    category: "asset_fit",
    description: "Deal size, unit count, or equity check is above the target range.",
  },
  {
    code: "deferred_maintenance",
    label: "Deferred maintenance",
    category: "risk",
    description: "Physical condition or capex burden is too high for the opportunity.",
  },
  {
    code: "environmental_or_legal_risk",
    label: "Environmental/legal risk",
    category: "risk",
    description: "Known or suspected environmental, title, zoning, or legal issue.",
  },
  {
    code: "financing_not_viable",
    label: "Financing not viable",
    category: "execution",
    description: "Debt, leverage, DSCR, or liquidity constraints make the deal impractical.",
  },
  {
    code: "broker_unresponsive",
    label: "Broker unresponsive",
    category: "execution",
    description: "Broker or owner did not respond after reasonable follow-up.",
  },
  {
    code: "duplicate",
    label: "Duplicate",
    category: "data_quality",
    description: "Same opportunity is already represented by another property record.",
  },
  {
    code: "already_sold_or_unavailable",
    label: "Sold/unavailable",
    category: "availability",
    description: "Property is sold, unavailable, withdrawn, or no longer actionable.",
  },
  {
    code: "data_quality_issue",
    label: "Data quality issue",
    category: "data_quality",
    description: "Record cannot be trusted without more source data or cleanup.",
  },
  {
    code: "other",
    label: "Other",
    category: "other",
    description: "Use with a note when the reason does not fit a standard category.",
  },
] as const satisfies readonly UiV2RejectionReasonOption[];

export type UiV2NonRejectedPipelineStatus = Exclude<UiV2PipelineStatus, "rejected">;

export type UiV2StatusUpdateInput =
  | {
      status: UiV2NonRejectedPipelineStatus;
      rejection?: never;
      note?: string | null;
      source?: UiV2ActionSurface | null;
    }
  | {
      status: "rejected";
      rejection: UiV2RejectionReason;
      note?: string | null;
      source?: UiV2ActionSurface | null;
    };

export interface UiV2SavePropertyInput {
  note?: string | null;
  source?: UiV2ActionSurface | null;
}

export interface UiV2RestorePropertyInput {
  restoreToStatus?: UiV2NonRejectedPipelineStatus;
  note?: string | null;
  source?: UiV2ActionSurface | null;
}

export interface UiV2TagUpdateInput {
  tags: string[];
  source?: UiV2ActionSurface | null;
}

export interface UiV2PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface UiV2PipelineQuery extends UiV2PaginationQuery {
  q?: string;
  status?: UiV2PipelineStatus | UiV2PipelineStatus[];
  source?: ListingSource | ListingSource[];
  tag?: string | string[];
  mtr?: string | string[];
  propertyType?: string | string[];
  neighborhood?: string | string[];
  borough?: string | string[];
  marketType?: UiV2MarketType | UiV2MarketType[];
  enrichmentStatus?: string | string[];
  hasOm?: boolean;
  hasBrokerContact?: boolean;
  hasOpenActions?: boolean;
  includeRejected?: boolean;
  minDealScore?: number;
  maxDealScore?: number;
  minAskingPrice?: number;
  maxAskingPrice?: number;
  minLtrYoc?: number;
  updatedSince?: string;
  sortBy?: UiV2PipelineSortField;
  sortDirection?: UiV2SortDirection;
}

export interface UiV2ImageAsset {
  id?: string;
  url: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
  source?: ListingSource | "om" | "manual" | string | null;
  order?: number | null;
}

export interface UiV2BrokerBlock {
  contactId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  firm?: string | null;
  source?: "sourced" | "llm" | "manual" | "overwrite" | string | null;
  overwrittenAt?: string | null;
  overwrittenBy?: string | null;
  notes?: string | null;
}

export type UiV2BrokerOverwriteTarget = "property_sourced_broker" | "crm_contact" | "both";

export interface UiV2BrokerOverwriteInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  firm?: string | null;
  notes?: string | null;
  overwriteTarget?: UiV2BrokerOverwriteTarget;
  source?: "property_sheet" | "crm" | "import_review" | "llm_review" | string | null;
  overwriteSourcedBroker?: boolean;
  overwriteReason?: string | null;
}

export interface UiV2DocumentStatus {
  hasOm: boolean;
  omStatus?: OmIngestionRunStatus | "not_requested" | "requested" | "available" | "missing" | null;
  latestOmRunId?: string | null;
  latestRequestAt?: string | null;
  documentCount?: number;
  categories?: PropertyDocumentCategory[];
  lastUpdatedAt?: string | null;
}

export interface UiV2PropertyDocumentItem {
  id: string;
  fileName: string;
  fileType?: string | null;
  source?: string | null;
  sourceType: "inquiry" | "uploaded" | "generated";
  category?: PropertyDocumentCategory | string | null;
  sourceUrl?: string | null;
  fileUrl: string;
  createdAt?: string | null;
}

export interface UiV2EnrichmentState {
  status: "not_started" | "queued" | "running" | "partial" | "complete" | "failed";
  completedKeys?: string[];
  pendingKeys?: string[];
  failedKeys?: string[];
  lastRefreshedAt?: string | null;
  errorMessage?: string | null;
}

export interface UiV2DetailItem {
  label: string;
  value?: string | number | boolean | null;
  href?: string | null;
  tone?: UiV2StatusChipTone;
}

export interface UiV2EnrichmentModuleDetail {
  key: string;
  label: string;
  status?: UiV2EnrichmentState["status"] | "available" | "missing" | "review" | string | null;
  summaryItems?: UiV2DetailItem[];
  detailItems?: UiV2DetailItem[];
}

export interface UiV2ListingFactsPayload {
  status?: string | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  ppsqft?: number | null;
  daysOnMarket?: number | null;
  listedAt?: string | null;
  closedAt?: string | null;
  monthlyHoa?: number | null;
  monthlyTax?: number | null;
  builtIn?: number | null;
  amenities?: string[] | null;
  units?: number | null;
  unitCountSource?: "source" | "om" | "rental_flow" | "inferred" | "unknown" | string | null;
}

export interface UiV2RentalFlowPayload {
  source?: string | null;
  lastUpdatedAt?: string | null;
  rentalUnits?: RentalUnitRow[] | null;
  omRentRoll?: OmRentRollRow[] | null;
  grossRent?: number | null;
  noi?: number | null;
  capRate?: number | null;
  dataGaps?: string | null;
  rentNotes?: string | null;
}

export interface UiV2OmAnalysisPayload {
  status?: string | null;
  processedAt?: string | null;
  currentNoi?: number | null;
  operatingExpenses?: number | null;
  rentRoll?: OmRentRollRow[] | null;
  takeaways?: string[] | null;
  validationFlags?: unknown[] | null;
  coverage?: Record<string, unknown> | null;
}

export interface UiV2EnrichmentDetailPayload {
  modules: UiV2EnrichmentModuleDetail[];
  sourceItems?: UiV2DetailItem[];
  rentalItems?: UiV2DetailItem[];
  listingFacts?: UiV2ListingFactsPayload | null;
  rentalFlow?: UiV2RentalFlowPayload | null;
  omAnalysis?: UiV2OmAnalysisPayload | null;
  sourcingUpdate?: PropertySourcingUpdate | null;
}

export interface UiV2UnderwritingSummary {
  generationStatus?: PropertyDealDossierGenerationStatus | null;
  dealScore?: number | null;
  askingPrice?: number | null;
  recommendedOfferLow?: number | null;
  recommendedOfferHigh?: number | null;
  capRate?: number | null;
  ltrYocPct?: number | null;
  mtrYocPct?: number | null;
  yocPct?: number | null;
  yocBasis?: "adjusted_noi" | "current_noi" | "unknown" | null;
  marketCapRatePct?: number | null;
  yocSpreadPct?: number | null;
  mtrCalloutCode?: "mtr_below_ltr" | "mtr_weak_uplift" | "mtr_spread_outlier" | null;
  mtrCalloutLabel?: string | null;
  riskFlags?: string[];
  capReasons?: string[];
  targetIrrPct?: number | null;
  irrPct?: number | null;
  cocPct?: number | null;
  currentNoi?: number | null;
  adjustedNoi?: number | null;
  summary?: PropertyDealDossierSummary | null;
}

export type UiV2ActivityItemType =
  | "status_changed"
  | "listing_seen"
  | "broker_edited"
  | "outreach_drafted"
  | "outreach_sent"
  | "broker_reply"
  | "om_uploaded"
  | "om_imported"
  | "om_processed"
  | "underwriting_generated"
  | "note_added"
  | "saved"
  | "rejected";

export interface UiV2ActivityTimelineItem {
  id: string;
  propertyId: string;
  type: UiV2ActivityItemType | string;
  title: string;
  body?: string | null;
  actorName?: string | null;
  actionId?: UiV2PropertyActionId | string | null;
  surface?: UiV2ActionSurface | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface UiV2PipelineRow {
  propertyId: string;
  canonicalAddress: string;
  displayAddress?: string | null;
  source?: ListingSource | string | null;
  statusChip: UiV2StatusChip;
  tags: string[];
  askingPrice?: number | null;
  units?: number | null;
  buildingSqft?: number | null;
  pricePerSqft?: number | null;
  propertyType?: string | null;
  marketType?: UiV2MarketType | null;
  neighborhood?: string | null;
  borough?: string | null;
  thumbnailUrl?: string | null;
  broker?: UiV2BrokerBlock | null;
  availableActions?: UiV2PropertyAction[];
  documentStatus?: UiV2DocumentStatus | null;
  enrichmentState?: UiV2EnrichmentState | null;
  underwriting?: UiV2UnderwritingSummary | null;
  brokerComps?: BrokerCompMarketSummary | null;
  openActionItemCount?: number;
  savedDeal?: SavedDeal | null;
  dealPath?: UiV2DealPathState | null;
  listingActivity?: ListingActivitySummary | null;
  lastActivityAt?: string | null;
  newness?: UiV2PipelineNewness | null;
  listedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UiV2PipelineNewnessReason =
  | "saved_search_run"
  | "saved_search_upload"
  | "manual_import"
  | "property_added";

export interface UiV2PipelineNewness {
  isNew: boolean;
  reason: UiV2PipelineNewnessReason;
  occurredAt?: string | null;
}

export interface UiV2PipelineListPayload {
  rows: UiV2PipelineRow[];
  total: number;
  limit: number;
  offset: number;
  query?: UiV2PipelineQuery;
}

export interface UiV2PropertyOverview {
  propertyId: string;
  canonicalAddress: string;
  displayAddress?: string | null;
  neighborhood?: string | null;
  borough?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  source?: ListingSource | string | null;
  propertyType?: string | null;
  marketType?: UiV2MarketType | null;
  listingUrl?: string | null;
  askingPrice?: number | null;
  units?: number | null;
  beds?: number | null;
  baths?: number | null;
  buildingSqft?: number | null;
  pricePerSqft?: number | null;
  lotSqft?: number | null;
  yearBuilt?: number | null;
  description?: string | null;
}

export interface UiV2PropertyDetailPayload {
  overview: UiV2PropertyOverview;
  statusChip: UiV2StatusChip;
  gallery: UiV2ImageAsset[];
  broker: UiV2BrokerBlock | null;
  availableActions?: UiV2PropertyAction[];
  tags: string[];
  documentStatus: UiV2DocumentStatus;
  documents?: UiV2PropertyDocumentItem[];
  enrichmentState: UiV2EnrichmentState;
  enrichmentDetails?: UiV2EnrichmentDetailPayload | null;
  underwriting: UiV2UnderwritingSummary | null;
  brokerComps?: BrokerCompMarketSummary | null;
  dealPath?: UiV2DealPathState | null;
  sourcingUpdate?: PropertySourcingUpdate | null;
  activityTimeline: UiV2ActivityTimelineItem[];
  actionItems: PropertyActionItem[];
  savedDeal?: SavedDeal | null;
}

export type UiV2ImportJobType =
  | "om_upload"
  | "om_url"
  | "manual_entry"
  | "streeteasy_url"
  | "streeteasy_sale_id"
  | "streeteasy_pull"
  | "saved_search_run";

export type UiV2ImportWizardMode = UiV2ImportJobType;

export interface UiV2StreetEasyPullOptions {
  includeListingDetails?: boolean;
  includeBuildingDetails?: boolean;
  includeSaleHistory?: boolean;
  includeUnitDetails?: boolean;
  includeBrokerInfo?: boolean;
  includeImages?: boolean;
  includeNearbyComparables?: boolean;
  createPropertyIfMissing?: boolean;
  savedSearchId?: string | null;
}

export interface UiV2ImportJobStatus {
  id: string;
  jobType: UiV2ImportJobType;
  propertyId?: string | null;
  runId?: string | null;
  status: IngestionJobStatus | IngestionRunStatus | OmIngestionRunStatus | "queued";
  label?: string | null;
  progressPct?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface UiV2OmUploadImportInput {
  propertyId: string;
  fileName: string;
  contentType?: string | null;
  category?: Extract<PropertyDocumentCategory, "OM" | "Brochure">;
}

export interface UiV2OmUrlImportInput {
  propertyId?: string | null;
  url: string;
  fileName?: string | null;
}

export interface UiV2ManualEntryImportInput {
  canonicalAddress: string;
  listingUrl?: string | null;
  askingPrice?: number | null;
  units?: number | null;
  neighborhood?: string | null;
  marketType?: UiV2MarketType | null;
  source?: ListingSource | string | null;
  ownerName?: string | null;
  broker?: UiV2BrokerOverwriteInput | null;
  notes?: string | null;
  images?: UiV2ImageAsset[];
  tags?: string[];
}

export interface UiV2StreetEasyUrlImportInput {
  url: string;
  savedSearchId?: string | null;
}

export interface UiV2StreetEasySaleIdImportInput {
  saleId: string;
  savedSearchId?: string | null;
}

export interface UiV2StreetEasyPullInput {
  propertyId?: string | null;
  saleId?: string | null;
  url?: string | null;
  options?: UiV2StreetEasyPullOptions;
}

export interface UiV2SavedSearchRunInput {
  savedSearchId: string;
}

export interface UiV2ImportJobPayload {
  job: UiV2ImportJobStatus;
  omRun?: OmIngestionRun | null;
  property?: UiV2PropertyDetailPayload | null;
}

export type UiV2ImportJobInput =
  | {
      jobType: "om_upload";
      input: UiV2OmUploadImportInput;
    }
  | {
      jobType: "om_url";
      input: UiV2OmUrlImportInput;
    }
  | {
      jobType: "manual_entry";
      input: UiV2ManualEntryImportInput;
    }
  | {
      jobType: "streeteasy_url";
      input: UiV2StreetEasyUrlImportInput;
    }
  | {
      jobType: "streeteasy_sale_id";
      input: UiV2StreetEasySaleIdImportInput;
    }
  | {
      jobType: "streeteasy_pull";
      input: UiV2StreetEasyPullInput;
    }
  | {
      jobType: "saved_search_run";
      input: UiV2SavedSearchRunInput;
    };

export interface UiV2CrmRelatedProperty {
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  contactEmail?: string | null;
  isPrimary?: boolean;
  openActionItemCount?: number;
  lastActivityAt?: string | null;
  uiV2Status?: UiV2PipelineStatus | string | null;
  brokerResponseStatus?: UiV2CrmBrokerResponseStatus | string | null;
}

export interface UiV2CrmContactPayload {
  contact: BrokerContact;
  relatedPropertyIds?: string[];
  relatedProperties?: UiV2CrmRelatedProperty[];
  openActionItemCount?: number;
  lastActivityAt?: string | null;
}

export type UiV2CrmBrokerResponseStatus =
  | "none"
  | "waiting"
  | "responded"
  | "unresponsive"
  | "inefficient"
  | "wrong_contact";

export interface UiV2CrmBrokerResponsePayload {
  status: UiV2CrmBrokerResponseStatus | string;
  note?: string | null;
  recordedAt?: string | null;
  recordedBy?: string | null;
  lastActivityAt?: string | null;
}

export interface UiV2CrmPropertyRowPayload {
  propertyId: string;
  canonicalAddress: string;
  displayAddress?: string | null;
  uiV2Status?: UiV2PipelineStatus | string | null;
  rejectedAt?: string | null;
  broker: UiV2BrokerBlock | null;
  contact: BrokerContact | null;
  resolutionStatus?: RecipientResolution["status"] | string | null;
  candidateCount?: number;
  hasEmail: boolean;
  openActionItemCount?: number;
  lastActivityAt?: string | null;
  response?: UiV2CrmBrokerResponsePayload | null;
}

export interface UiV2CrmListPayload {
  contacts: UiV2CrmContactPayload[];
  propertyRows?: UiV2CrmPropertyRowPayload[];
  total: number;
  limit: number;
  offset: number;
}

export type UiV2OutreachDraftStatus = "draft" | "ready_for_review" | "queued" | "sent" | "failed";

export interface UiV2OutreachComposerPayload {
  propertyId: string;
  broker: UiV2BrokerBlock | null;
  suggestedRecipients: UiV2CrmContactPayload[];
  subject: string;
  body: string;
  followUpAt?: string | null;
  warnings?: string[];
}

export interface UiV2OutreachTemplatePayload {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UiV2OutreachTemplateInput {
  id?: string | null;
  name: string;
  subject: string;
  body: string;
}

export interface UiV2OutreachDraftInput {
  propertyId: string;
  contactId?: string | null;
  toAddress: string;
  subject: string;
  body: string;
  followUpAt?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  force?: boolean;
}

export interface UiV2OutreachDraftPayload {
  id: string;
  propertyId: string;
  contactId?: string | null;
  toAddress: string;
  subject: string;
  body: string;
  status: UiV2OutreachDraftStatus;
  followUpAt?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UiV2OutreachSendNowPayload {
  draft: UiV2OutreachDraftPayload;
  batchId: string;
  messageId: string;
  threadId?: string | null;
  sentAt: string;
}

export interface UiV2OutreachFollowUpActionInput {
  draftId?: string | null;
  propertyId: string;
  contactId?: string | null;
  action: "schedule" | "send_now" | "cancel" | "mark_complete";
  followUpAt?: string | null;
  note?: string | null;
}

export interface UiV2OutreachFollowUpActionPayload {
  actionItem?: PropertyActionItem | null;
  draft?: UiV2OutreachDraftPayload | null;
  status: ItemStatus | UiV2OutreachDraftStatus | "scheduled";
}

export interface UiV2SavedDealsPayload {
  deals: SavedDeal[];
  total: number;
  limit: number;
  offset: number;
}

export interface UiV2DealProgressSummary {
  savedCount: number;
  underwritingCount: number;
  outreachCount: number;
  awaitingBrokerCount: number;
  omReceivedCount: number;
  rejectedCount: number;
  updatedAt?: string | null;
}
