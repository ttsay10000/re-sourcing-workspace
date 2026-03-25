/**
 * Minimal property entity (canonical deduplicated place).
 */
/** Summary of DOB permits enrichment (count, last issued, owner). */
export interface PermitsSummary {
  count?: number;
  last_issued_date?: string;
  owner_business_name?: string;
  owner_name?: string;
}

export interface ZoningSummary {
  zoningDistrict1?: string | null;
  zoningDistrict2?: string | null;
  specialDistrict1?: string | null;
  zoningMapNumber?: string | null;
  zoningMapCode?: string | null;
  lastRefreshedAt?: string | null;
}

export interface CertificateOfOccupancySummary {
  jobType?: string | null;
  status?: string | null;
  filingType?: string | null;
  issuanceDate?: string | null;
  dwellingUnits?: number | null;
  lastRefreshedAt?: string | null;
}

export interface HpdRegistrationSummary {
  registrationId?: string | null;
  lastRegistrationDate?: string | null;
  lastRefreshedAt?: string | null;
}

export interface HpdViolationsSummary {
  total?: number;
  byClass?: Record<string, number>;
  rentImpairingOpen?: number;
  openCount?: number;
  closedCount?: number;
  mostRecentApprovedDate?: string | null;
  lastRefreshedAt?: string | null;
}

export interface DobComplaintsSummary {
  count30?: number;
  count90?: number;
  count365?: number;
  openCount?: number;
  closedCount?: number;
  topCategories?: Array<{ name: string; count: number }>;
  lastRefreshedAt?: string | null;
}

export interface HousingLitigationsSummary {
  total?: number;
  openCount?: number;
  lastFindingDate?: string | null;
  totalPenalty?: number;
  byCaseType?: Record<string, number>;
  byStatus?: Record<string, number>;
  lastRefreshedAt?: string | null;
}

export interface AffordableHousingSummary {
  latestProjectName?: string | null;
  latestProjectStartDate?: string | null;
  latestProjectCompletionDate?: string | null;
  totalAffordableByBand?: Record<string, number>;
  totalUnits?: number;
  projectCount?: number;
  lastRefreshedAt?: string | null;
}

/** One rental unit row from RapidAPI rentals/url or from inquiry/LLM. */
export interface RentalUnitRow {
  unit?: string | null;
  /** When status is "sold"/closed, this is the latest rental price it rented for; when "open", current ask. */
  rentalPrice?: number | null;
  /** API status: "open" = active listing (price = ask), "sold" = closed (price = last rent). */
  status?: string | null;
  sqft?: number | null;
  listedDate?: string | null;
  lastRentedDate?: string | null;
  beds?: number | null;
  baths?: number | null;
  /** Photo URLs for this unit (from API images array). */
  images?: string[] | null;
  source?: "rapidapi" | "inquiry" | null;
  /** Streeteasy listing URL for this unit (from RapidAPI); used to link "Unit #2" → listing. */
  streeteasyUrl?: string | null;
  [key: string]: unknown;
}

/** One expense line item from OM/brochure (for table display). */
export interface ExpenseLineItem {
  lineItem: string;
  amount: number;
}

export type PropertyDealDossierExpenseTreatment =
  | "operating"
  | "replace_management"
  | "exclude";

/** One unit row from OM/brochure rent roll (for table display). */
export interface RentalNumberPerUnit {
  unit?: string;
  /** Monthly rent. */
  monthlyRent?: number;
  /** Annual rent. */
  annualRent?: number;
  /** Legacy: single rent value (treated as monthly if no annualRent). */
  rent?: number;
  /** Bedrooms (for rent roll comparison: total_bedrooms must match RapidAPI). */
  beds?: number;
  /** Bathrooms for this unit when stated in OM/rent roll. */
  baths?: number;
  /** Square footage for this unit when stated. */
  sqft?: number;
  /** Occupancy: true/false or "Occupied" / "Vacant" etc. */
  occupied?: boolean | string;
  /** Last rented date (e.g. lease start or when unit was last rented). */
  lastRentedDate?: string;
  /** Date unit became or will become vacant (if vacant or known). */
  dateVacant?: string;
  /** e.g. "Rent Stabilized", "Recently renovated", "Market rate". */
  note?: string;
}

/** LLM-extracted financials (from listing description, OM, or email/attachments); merged without overwriting API data. */
export interface RentalFinancialsFromLlm {
  noi?: number | null;
  capRate?: number | null;
  grossRentTotal?: number | null;
  totalExpenses?: number | null;
  /** Full expense breakdown from OM (taxes, insurance, HOA, etc.) for table display. */
  expensesTable?: ExpenseLineItem[] | null;
  /** Brief human-readable summary of rent roll / income; keep short and formatted, not a raw dump. */
  rentalEstimates?: string | null;
  rentalNumbersPerUnit?: RentalNumberPerUnit[] | null;
  /** Other financial notes: clean line or comma-separated "Item: $X" when not in expensesTable. */
  otherFinancials?: string | null;
  /** 2–5 bullet points or short paragraph: key takeaways from the OM (value, risks, highlights). */
  keyTakeaways?: string | null;
  /** LLM suggestion when sale listing vs rental units suggest missing data (e.g. sale has 4 beds, rental data sums to 2). */
  dataGapSuggestions?: string | null;
  [key: string]: unknown;
}

/** One rent roll row from full OM analysis LLM. */
export interface OmRentRollRow {
  unit?: string;
  /** Optional building/address label when an OM covers multiple adjacent buildings. */
  building?: string;
  /** Residential, commercial, retail, office, etc. */
  unitCategory?: string;
  /** Commercial tenant name or occupant label when provided. */
  tenantName?: string;
  monthlyRent?: number;
  monthlyBaseRent?: number;
  monthlyTotalRent?: number;
  annualRent?: number;
  annualBaseRent?: number;
  annualTotalRent?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  rentType?: string;
  tenantStatus?: string;
  leaseType?: string;
  leaseStartDate?: string;
  leaseEndDate?: string;
  reimbursementType?: string;
  reimbursementAmount?: number;
  rentEscalations?: string;
  /** Occupancy: true/false or "Occupied" / "Vacant". */
  occupied?: boolean | string;
  /** Last rented date (e.g. lease start or when unit was last rented). */
  lastRentedDate?: string;
  /** Date unit became or will become vacant (if vacant or known). */
  dateVacant?: string;
  notes?: string;
  [key: string]: unknown;
}

/** Full OM / investment analysis from senior-analyst LLM (property page + dossier). */
export interface OmAnalysis {
  propertyInfo?: Record<string, unknown> | null;
  rentRoll?: OmRentRollRow[] | null;
  income?: Record<string, unknown> | null;
  expenses?: { expensesTable?: ExpenseLineItem[]; totalExpenses?: number; [key: string]: unknown } | null;
  revenueComposition?: Record<string, unknown> | null;
  financialMetrics?: Record<string, unknown> | null;
  valuationMetrics?: Record<string, unknown> | null;
  underwritingMetrics?: Record<string, unknown> | null;
  nycRegulatorySummary?: Record<string, unknown> | null;
  furnishedModel?: Record<string, unknown> | null;
  reportedDiscrepancies?: Array<Record<string, unknown>> | null;
  sourceCoverage?: Record<string, unknown> | null;
  investmentTakeaways?: string[] | null;
  recommendedOfferAnalysis?: Record<string, unknown> | null;
  uiFinancialSummary?: Record<string, unknown> | null;
  dossierMemo?: Record<string, string> | null;
  /** If OM reported NOI explicitly. */
  noiReported?: number | null;
  [key: string]: unknown;
}

export type OmIngestionRunStatus =
  | "queued"
  | "processing"
  | "completed"
  | "promoted"
  | "needs_review"
  | "failed";

export type OmIngestionSourceType =
  | "uploaded_document"
  | "inquiry_attachment"
  | "manual_refresh"
  | "backfill"
  | "other";

export type OmExtractionMethod = "text_tables" | "ocr_tables" | "hybrid";

export type OmPageType =
  | "COVER_PAGE"
  | "PROPERTY_OVERVIEW"
  | "FINANCIAL_SECTION_HEADER"
  | "FINANCIAL_OVERVIEW"
  | "RENT_ROLL"
  | "INCOME_EXPENSE"
  | "PROPERTY_DESCRIPTION"
  | "FLOOR_PLANS"
  | "MAPS"
  | "PHOTOS"
  | "BROKER_INFO"
  | "DISCLAIMERS"
  | "IRRELEVANT";

export type OmExtractionMethodCandidate = "text_table" | "ocr_table" | "ignore";

export interface OmPageClassification {
  pageNumber: number;
  pageType: OmPageType;
  extractionMethodCandidate: OmExtractionMethodCandidate;
  textDensity?: number | null;
  imageDensity?: number | null;
  numericDensity?: number | null;
  layoutBlocks?: string[] | null;
  detectedKeywords?: string[] | null;
  [key: string]: unknown;
}

export interface OmTableRegion {
  pageNumber: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  regionType?: string | null;
  extractionMethod?: OmExtractionMethodCandidate | null;
  confidence?: number | null;
  [key: string]: unknown;
}

export interface OmValidationFlag {
  flagType: string;
  field?: string | null;
  severity?: "info" | "warning" | "error" | null;
  brokerValue?: unknown;
  externalValue?: unknown;
  confidenceScore?: number | null;
  message?: string | null;
  pageNumber?: number | null;
  source?: string | null;
  [key: string]: unknown;
}

export interface OmCoverage {
  propertyInfoExtracted?: boolean | null;
  rentRollExtracted?: boolean | null;
  incomeStatementExtracted?: boolean | null;
  expensesExtracted?: boolean | null;
  currentFinancialsExtracted?: boolean | null;
  unitCountExtracted?: boolean | null;
  pageCountAnalyzed?: number | null;
  financialPagesDetected?: number | null;
  ocrPagesUsed?: number | null;
  placeholderRowsGenerated?: number | null;
  brokerBlankRowsObserved?: number | null;
  [key: string]: unknown;
}

export interface OmAuthoritativeCurrentFinancials {
  noi?: number | null;
  grossRentalIncome?: number | null;
  otherIncome?: number | null;
  vacancyLoss?: number | null;
  effectiveGrossIncome?: number | null;
  operatingExpenses?: number | null;
  [key: string]: unknown;
}

export interface OmAuthoritativeSnapshot {
  id?: string;
  runId?: string | null;
  sourceDocumentId?: string | null;
  extractionMethod?: OmExtractionMethod | null;
  propertyInfo?: Record<string, unknown> | null;
  rentRoll?: OmRentRollRow[] | null;
  incomeStatement?: Record<string, unknown> | null;
  expenses?: { expensesTable?: ExpenseLineItem[] | null; totalExpenses?: number | null; [key: string]: unknown } | null;
  revenueComposition?: Record<string, unknown> | null;
  currentFinancials?: OmAuthoritativeCurrentFinancials | null;
  validationFlags?: OmValidationFlag[] | null;
  coverage?: OmCoverage | null;
  pageClassification?: OmPageClassification[] | null;
  tableRegions?: OmTableRegion[] | null;
  sourceMeta?: Record<string, unknown> | null;
  promotedAt?: string | null;
  [key: string]: unknown;
}

export interface OmData {
  activeRunId?: string | null;
  activeSnapshotId?: string | null;
  latestRunId?: string | null;
  status?: OmIngestionRunStatus | null;
  snapshotVersion?: number | null;
  lastProcessedAt?: string | null;
  authoritative?: OmAuthoritativeSnapshot | null;
  [key: string]: unknown;
}

export interface OmIngestionRun {
  id: string;
  propertyId: string;
  sourceDocumentId?: string | null;
  sourceType: OmIngestionSourceType;
  status: OmIngestionRunStatus;
  snapshotVersion?: number | null;
  extractionMethod?: OmExtractionMethod | null;
  pageCount?: number | null;
  financialPageCount?: number | null;
  ocrPageCount?: number | null;
  sourceMeta?: Record<string, unknown> | null;
  coverage?: OmCoverage | null;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  promotedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OmAuthoritativeSnapshotRecord {
  id: string;
  propertyId: string;
  runId?: string | null;
  sourceDocumentId?: string | null;
  snapshotVersion?: number | null;
  snapshot: OmAuthoritativeSnapshot;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Rental data on a property: per-unit table (from API or inquiry) + LLM-extracted financials. */
export interface RentalFinancials {
  rentalUnits?: RentalUnitRow[] | null;
  fromLlm?: RentalFinancialsFromLlm | null;
  /** Full OM analysis from senior-analyst prompt (rent roll, metrics, takeaways, dossier memo). */
  omAnalysis?: OmAnalysis | null;
  source?: "rapidapi" | "llm" | "inquiry" | null;
  lastUpdatedAt?: string | null;
  [key: string]: unknown;
}

export interface PropertyDealDossierAssumptions {
  purchasePrice?: number | null;
  purchaseClosingCostPct?: number | null;
  renovationCosts?: number | null;
  furnishingSetupCosts?: number | null;
  investmentProfile?: string | null;
  targetAcquisitionDate?: string | null;
  ltvPct?: number | null;
  interestRatePct?: number | null;
  amortizationYears?: number | null;
  loanFeePct?: number | null;
  rentUpliftPct?: number | null;
  expenseIncreasePct?: number | null;
  managementFeePct?: number | null;
  occupancyTaxPct?: number | null;
  vacancyPct?: number | null;
  leadTimeMonths?: number | null;
  annualRentGrowthPct?: number | null;
  annualOtherIncomeGrowthPct?: number | null;
  annualExpenseGrowthPct?: number | null;
  annualPropertyTaxGrowthPct?: number | null;
  recurringCapexAnnual?: number | null;
  holdPeriodYears?: number | null;
  exitCapPct?: number | null;
  exitClosingCostPct?: number | null;
  targetIrrPct?: number | null;
  unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
  brokerEmailNotes?: string | null;
  updatedAt?: string | null;
}

export interface PropertyDealDossierUnitModelRow {
  rowId: string;
  unitLabel?: string | null;
  building?: string | null;
  unitCategory?: string | null;
  tenantName?: string | null;
  currentAnnualRent?: number | null;
  underwrittenAnnualRent?: number | null;
  rentUpliftPct?: number | null;
  occupancyPct?: number | null;
  furnishingCost?: number | null;
  onboardingFee?: number | null;
  monthlyHospitalityExpense?: number | null;
  includeInUnderwriting?: boolean | null;
  isProtected?: boolean | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  tenantStatus?: string | null;
  notes?: string | null;
}

export interface PropertyDealDossierExpenseModelRow {
  rowId: string;
  lineItem: string;
  amount?: number | null;
  annualGrowthPct?: number | null;
  treatment?: PropertyDealDossierExpenseTreatment | null;
}

export type PropertyDealDossierGenerationStatus =
  | "not_started"
  | "running"
  | "completed"
  | "failed";

export interface PropertyDealDossierGeneration {
  status?: PropertyDealDossierGenerationStatus | null;
  stageLabel?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastError?: string | null;
  dealScore?: number | null;
  dossierDocumentId?: string | null;
  excelDocumentId?: string | null;
}

export interface PropertyDealDossierSummary {
  generatedAt?: string | null;
  askingPrice?: number | null;
  purchasePrice?: number | null;
  recommendedOfferLow?: number | null;
  recommendedOfferHigh?: number | null;
  targetIrrPct?: number | null;
  discountToAskingPct?: number | null;
  irrAtAskingPct?: number | null;
  targetMetAtAsking?: boolean | null;
  currentNoi?: number | null;
  adjustedNoi?: number | null;
  stabilizedNoi?: number | null;
  annualDebtService?: number | null;
  year1EquityYield?: number | null;
  irrPct?: number | null;
  equityMultiple?: number | null;
  cocPct?: number | null;
  holdYears?: number | null;
  dealScore?: number | null;
  calculatedDealScore?: number | null;
  dealSignalsId?: string | null;
  dealSignalsGeneratedAt?: string | null;
  dossierDocumentId?: string | null;
  excelDocumentId?: string | null;
}

export interface PropertyDealDossier {
  assumptions?: PropertyDealDossierAssumptions | null;
  generation?: PropertyDealDossierGeneration | null;
  summary?: PropertyDealDossierSummary | null;
}

export type PropertySourcingUpdateStatus = "new" | "updated" | "unchanged";

export type PropertySourcingUpdateChangeType = "added" | "updated" | "removed";

export interface PropertySourcingUpdateChange {
  field: string;
  label: string;
  changeType?: PropertySourcingUpdateChangeType | null;
  previousValue?: string | number | boolean | null;
  currentValue?: string | number | boolean | null;
}

export interface PropertySourcingUpdate {
  status?: PropertySourcingUpdateStatus | null;
  lastRunId?: string | null;
  lastEvaluatedAt?: string | null;
  previousSnapshotId?: string | null;
  changedFields?: string[] | null;
  changes?: PropertySourcingUpdateChange[] | null;
  summary?: string | null;
}

/** Inquiry email row (reply matched to property by subject address). */
export interface PropertyInquiryEmail {
  id: string;
  propertyId: string;
  linkedPropertyIds?: string[] | null;
  messageId: string;
  gmailThreadId?: string | null;
  matchedBatchId?: string | null;
  subject?: string | null;
  fromAddress?: string | null;
  receivedAt?: string | null;
  bodyText?: string | null;
  processingStatus?: string | null;
  /** LLM summary of email body. */
  bodySummary?: string | null;
  /** Latest receipt/send date mentioned from broker (LLM-extracted). */
  receiptDateFromBroker?: string | null;
  /** List of attachments (e.g. "offering_memo.pdf" or "none"). */
  attachmentsList?: string | null;
  createdAt: string;
}

/** Inquiry document row (attachment from an inquiry email). */
export interface PropertyInquiryDocument {
  id: string;
  propertyId: string;
  inquiryEmailId: string;
  filename: string;
  contentType?: string | null;
  filePath: string;
  createdAt: string;
}

/** Category for user-uploaded property documents. */
export type PropertyDocumentCategory =
  | "OM"
  | "Brochure"
  | "Rent Roll"
  | "Financial Model"
  | "T12 / Operating Summary"
  | "Other";

/** User-uploaded document row (OM, brochure, rent roll, etc.). */
export interface PropertyUploadedDocument {
  id: string;
  propertyId: string;
  filename: string;
  contentType?: string | null;
  filePath: string;
  category: PropertyDocumentCategory;
  /** Source of the document (e.g. Broker, Listing agent, Email from X). */
  source?: string | null;
  createdAt: string;
}

export interface PropertyManualSourceLinks {
  streetEasyUrl?: string | null;
  omUrl?: string | null;
  addedAt?: string | null;
  omImportedAt?: string | null;
  omDocumentId?: string | null;
  omFileName?: string | null;
}

/** Placeholder keys for canonical property details (permit, tax, owner, etc.). */
export interface PropertyDetails {
  permitInfo?: string | null;
  taxCode?: string | null;
  buildingLotBlock?: string | null;
  ownerInfo?: string | null;
  /** Owner name from valuations dataset (8y4t-faws); shown in UI as "Owner (Valuations module): XXXX". */
  ownerValuations?: string | null;
  omFurnishedPricing?: string | null;
  /** OM ingestion V2 state. When authoritative is present, downstream calculations must prefer it. */
  omData?: OmData | null;
  /** Last saved-search diff result for this property's active listing. */
  sourcingUpdate?: PropertySourcingUpdate | null;
  /** Rental data: per-unit table + LLM financials (from RapidAPI, listing LLM, or inquiry). */
  rentalFinancials?: RentalFinancials | null;
  /** Monthly HOA from listing (GET sale details); for financial calculations. */
  monthlyHoa?: number | null;
  /** Monthly tax from listing (GET sale details); for financial calculations. */
  monthlyTax?: number | null;
  /** Original manual source links used to seed this property into Property Data. */
  manualSourceLinks?: PropertyManualSourceLinks | null;
  /** Current market value total from valuations (curmkttot). */
  assessedMarketValue?: number | null;
  /** Current actual/assessed total from valuations (curacttot). */
  assessedActualValue?: number | null;
  /** Current tax before total from valuations (curtxbtot). */
  assessedTaxBeforeTotal?: number | null;
  /** Gross sqft from valuations (gross_sqft). */
  assessedGrossSqft?: number | null;
  /** Land area from valuations (land_area). */
  assessedLandArea?: number | null;
  /** Residential gross sqft from valuations (residential_area_gross). */
  assessedResidentialAreaGross?: number | null;
  /** Office gross sqft from valuations (office_area_gross). */
  assessedOfficeAreaGross?: number | null;
  /** Retail gross sqft from valuations (retail_area_gross). */
  assessedRetailAreaGross?: number | null;
  /** Appointment/add-to-roll date from valuations (appt_date). */
  assessedApptDate?: string | null;
  /** Extract/roll date from valuations (extracrdt). */
  assessedExtractDate?: string | null;
  enrichment?: {
    permits_summary?: PermitsSummary | null;
    zoning?: ZoningSummary | null;
    certificateOfOccupancy?: CertificateOfOccupancySummary | null;
    hpdRegistration?: HpdRegistrationSummary | null;
    hpd_violations_summary?: HpdViolationsSummary | null;
    dob_complaints_summary?: DobComplaintsSummary | null;
    housing_litigations_summary?: HousingLitigationsSummary | null;
    affordable_housing_summary?: AffordableHousingSummary | null;
  } | null;
  dealDossier?: PropertyDealDossier | null;
  [key: string]: unknown;
}

export interface Property {
  id: string;
  canonicalAddress: string;
  /** Optional details (permit, tax code, building/lot/block, owner, OM/furnished pricing). */
  details?: PropertyDetails | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input to create a property.
 */
export interface PropertyInput {
  canonicalAddress: string;
}

/** Source for rows in the unified documents table (generated files only; broker/user stay in existing tables). */
export type DocumentSource = "generated_dossier" | "generated_excel";

/** Generated document row (dossier, Excel) — appears in same documents folder as OM on property card. */
export interface Document {
  id: string;
  propertyId: string;
  fileName: string;
  fileType?: string | null;
  source: DocumentSource;
  uploadedBy?: string | null;
  storagePath: string;
  createdAt: string;
}

/** Deal status (per user per property). */
export type DealStatus = "new" | "interesting" | "saved" | "dossier_generated" | "rejected";

/** User profile (single global user) and assumption defaults. */
export interface UserProfile {
  id: string;
  name?: string | null;
  email?: string | null;
  organization?: string | null;
  automationPaused?: boolean;
  automationPauseReason?: string | null;
  automationPausedAt?: string | null;
  dailyDigestEnabled?: boolean;
  dailyDigestTimeLocal?: string | null;
  dailyDigestTimezone?: string | null;
  lastDailyDigestSentAt?: string | null;
  defaultPurchaseClosingCostPct?: number | null;
  defaultLtv?: number | null;
  defaultInterestRate?: number | null;
  defaultAmortization?: number | null;
  defaultHoldPeriodYears?: number | null;
  defaultExitCap?: number | null;
  defaultExitClosingCostPct?: number | null;
  defaultRentUplift?: number | null;
  defaultExpenseIncrease?: number | null;
  defaultManagementFee?: number | null;
  defaultTargetIrrPct?: number | null;
  defaultVacancyPct?: number | null;
  defaultLeadTimeMonths?: number | null;
  defaultAnnualRentGrowthPct?: number | null;
  defaultAnnualOtherIncomeGrowthPct?: number | null;
  defaultAnnualExpenseGrowthPct?: number | null;
  defaultAnnualPropertyTaxGrowthPct?: number | null;
  defaultRecurringCapexAnnual?: number | null;
  defaultLoanFeePct?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Saved deal (user + property + status). */
export interface SavedDeal {
  id: string;
  userId: string;
  propertyId: string;
  dealStatus: DealStatus;
  createdAt: string;
}

export interface DealScoreBreakdown {
  returnScore: number;
  marketLiquidityScore: number;
  assumptionPenalty: number;
  structuralPenalty: number;
  regulatoryPenalty: number;
  preCapScore: number;
  cappedScore: number;
}

export interface DealRiskProfile {
  commercialRevenueSharePct?: number | null;
  rentStabilizedRevenueSharePct?: number | null;
  largestUnitRevenueSharePct?: number | null;
  rollover12moRevenueSharePct?: number | null;
  rentRollCoveragePct?: number | null;
  omDiscrepancyCount: number;
  rapidOmMismatch: boolean;
  taxBurdenPct?: number | null;
  unsupportedRentGrowthPct?: number | null;
  missingLeaseDataPct?: number | null;
  missingOccupancyDataPct?: number | null;
  missingLeaseDataMajority: boolean;
  missingOccupancyDataMajority: boolean;
  smallAssetRiskLevel?: "none" | "5_to_9" | "under_5";
  isPackageOm: boolean;
  missingEnrichmentGroup: boolean;
  explicitRecordMismatch: boolean;
  totalUnits?: number | null;
  usableRentRowsCount?: number | null;
  rentRowsCount?: number | null;
}

export interface DealScoreSensitivityScenario {
  key: "rentUpliftDown20Pts" | "exitCapUp50Bps" | "expenseGrowthUp200Bps";
  label: string;
  adjustedValue: number | null;
  score: number | null;
  delta: number | null;
}

export interface DealScoreSensitivity {
  rentUpliftDown20Pts?: DealScoreSensitivityScenario | null;
  exitCapUp50Bps?: DealScoreSensitivityScenario | null;
  expenseGrowthUp200Bps?: DealScoreSensitivityScenario | null;
}

export interface DealScoreOverride {
  id: string;
  propertyId: string;
  score: number;
  reason: string;
  createdBy?: string | null;
  createdAt: string;
  clearedAt?: string | null;
}

/** Deal signals row (one per property per generation). */
export interface DealSignalRow {
  id: string;
  propertyId: string;
  pricePerUnit?: number | null;
  pricePsf?: number | null;
  assetCapRate?: number | null;
  adjustedCapRate?: number | null;
  yieldSpread?: number | null;
  rentUpside?: number | null;
  rentPsfRatio?: number | null;
  expenseRatio?: number | null;
  liquidityScore?: number | null;
  riskScore?: number | null;
  priceMomentum?: number | null;
  dealScore?: number | null;
  /** IRR as decimal (e.g. 0.12 for 12%). */
  irrPct?: number | null;
  equityMultiple?: number | null;
  /** Cash-on-cash as decimal (e.g. 0.062 for 6.2%). */
  cocPct?: number | null;
  holdYears?: number | null;
  currentNoi?: number | null;
  adjustedNoi?: number | null;
  scoreBreakdown?: DealScoreBreakdown | null;
  riskProfile?: DealRiskProfile | null;
  riskFlags?: string[] | null;
  capReasons?: string[] | null;
  confidenceScore?: number | null;
  scoreSensitivity?: DealScoreSensitivity | null;
  scoreVersion?: string | null;
  generatedAt: string;
}
