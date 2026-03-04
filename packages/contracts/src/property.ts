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
  [key: string]: unknown;
}

/** LLM-extracted financials (from listing description or email/attachments); merged without overwriting API data. */
export interface RentalFinancialsFromLlm {
  noi?: number | null;
  capRate?: number | null;
  rentalEstimates?: string | null;
  rentalNumbersPerUnit?: Array<{ unit?: string; rent?: number; note?: string }> | null;
  otherFinancials?: string | null;
  /** LLM suggestion when sale listing vs rental units suggest missing data (e.g. sale has 4 beds, rental data sums to 2). */
  dataGapSuggestions?: string | null;
  [key: string]: unknown;
}

/** Rental data on a property: per-unit table (from API or inquiry) + LLM-extracted financials. */
export interface RentalFinancials {
  rentalUnits?: RentalUnitRow[] | null;
  fromLlm?: RentalFinancialsFromLlm | null;
  source?: "rapidapi" | "llm" | "inquiry" | null;
  lastUpdatedAt?: string | null;
  [key: string]: unknown;
}

/** Inquiry email row (reply matched to property by subject address). */
export interface PropertyInquiryEmail {
  id: string;
  propertyId: string;
  messageId: string;
  subject?: string | null;
  fromAddress?: string | null;
  receivedAt?: string | null;
  bodyText?: string | null;
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

/** Placeholder keys for canonical property details (permit, tax, owner, etc.). */
export interface PropertyDetails {
  permitInfo?: string | null;
  taxCode?: string | null;
  buildingLotBlock?: string | null;
  ownerInfo?: string | null;
  omFurnishedPricing?: string | null;
  /** Rental data: per-unit table + LLM financials (from RapidAPI, listing LLM, or inquiry). */
  rentalFinancials?: RentalFinancials | null;
  /** Monthly HOA from listing (GET sale details); for financial calculations. */
  monthlyHoa?: number | null;
  /** Monthly tax from listing (GET sale details); for financial calculations. */
  monthlyTax?: number | null;
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
