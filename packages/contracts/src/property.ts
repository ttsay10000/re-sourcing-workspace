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

/** Placeholder keys for canonical property details (permit, tax, owner, etc.). */
export interface PropertyDetails {
  permitInfo?: string | null;
  taxCode?: string | null;
  buildingLotBlock?: string | null;
  ownerInfo?: string | null;
  omFurnishedPricing?: string | null;
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
