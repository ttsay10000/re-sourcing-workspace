/**
 * Rental Analysis / Competitor Pricing Calendar contracts.
 *
 * Monthly furnished-rental pricing collected from public competitor inventory
 * (Haus first; Rove/Blueground adapters next) and turned into a map-based
 * rental comp layer. The unit of record is a MonthlyRateObservation: one
 * tested check-in/check-out range for one listing, normalized down to the
 * accommodation subtotal (taxes/fees/deposits always excluded).
 */

export type CompetitorSource = "haus" | "rove" | "blueground";

export const COMPETITOR_SOURCES: CompetitorSource[] = ["haus", "rove", "blueground"];

export type CompetitorScrapeStatus =
  | "discovered"
  | "metadata_collected"
  | "pricing_collected"
  | "pricing_failed"
  | "excluded";

export interface CompetitorListing {
  id: string;
  source: CompetitorSource;
  sourceListingId: string;
  url: string;

  title?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  borough?: string | null;

  latitude?: number | null;
  longitude?: number | null;

  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  guests?: number | null;

  minStayNights?: number | null;
  maxStayNights?: number | null;

  availableFrom?: string | null;
  imageUrl?: string | null;

  /** Excluded from the active comp set (restrictive terms); kept for diagnostics. */
  excludedFromComps: boolean;
  exclusionReason?: string | null;

  scrapeStatus: CompetitorScrapeStatus;
  scrapeTimestamp: string;
  updatedAt: string;
}

export type RentalQuoteType =
  | "calendar_month"
  | "rolling_30_nights"
  | "rolling_60_nights"
  | "rolling_90_nights"
  | "rolling_180_nights";

export type RentalAvailabilityStatus = "available" | "unavailable" | "partial" | "unknown";

/**
 * How clean the normalized rate is. Only the first three are comp-grade;
 * everything else renders with an explicit caveat label.
 */
export type RentalNormalizationStatus =
  | "subtotal_clean_no_fees_taxes"
  | "discount_removed"
  | "discount_estimated"
  | "effective_rate_only"
  | "pricing_unavailable"
  | "excluded_term_requirement"
  | "low_confidence";

export type RentalConfidence = "high" | "medium" | "low";

export interface MonthlyRateObservation {
  id: string;

  listingId: string;
  source: CompetitorSource;
  listingUrl: string;

  checkIn: string;
  checkOut: string;
  nights: number;

  /** "2026-07" for calendar_month quotes; the dominant month otherwise. */
  calendarMonth?: string | null;

  quoteType: RentalQuoteType;
  availabilityStatus: RentalAvailabilityStatus;

  displayedAdr?: number | null;
  displayedMonthlyRate?: number | null;

  /** Accommodation subtotal as charged (after any visible discount). */
  accommodationSubtotalEffective?: number | null;
  /** Accommodation subtotal with visible/estimated discounts added back. */
  accommodationSubtotalUndiscounted?: number | null;

  effectiveAdr?: number | null;
  undiscountedAdr?: number | null;

  /** ADR × 30 — comparable across stay lengths. */
  effectiveMonthlyEquivalent?: number | null;
  undiscountedMonthlyEquivalent?: number | null;

  discountAmount?: number | null;
  discountLabels?: string[] | null;

  feesExcluded: boolean;
  taxesExcluded: boolean;

  cleaningFee?: number | null;
  serviceFee?: number | null;
  taxes?: number | null;
  otherFees?: number | null;

  normalizationStatus: RentalNormalizationStatus;
  confidence: RentalConfidence;

  rawText?: string | null;

  scrapedAt: string;
}

export interface QuoteSpec {
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  pets: boolean;
  currency: "USD";
  quoteType: RentalQuoteType;
}

export interface RentalCompMatchScore {
  listingId: string;
  targetPropertyId: string;

  totalScore: number;

  distanceScore: number;
  bedroomMatchScore: number;
  sqftSimilarityScore: number;
  neighborhoodScore: number;
  qualityScore?: number | null;
  confidenceScore: number;
  termComparabilityScore: number;

  explanation: string;
  /** Display chips, e.g. "Best match", "Same bedroom count", "Similar SF". */
  labels: string[];
  distanceMiles?: number | null;
}

export interface RentalMarketSummary {
  month: string;
  quoteType: "calendar_month" | "rolling_30_nights";
  sourceFilter: CompetitorSource[];

  bedroomCount?: number | null;
  neighborhood?: string | null;
  radiusMiles?: number | null;

  compCount: number;
  excludedCount: number;
  unavailableCount: number;
  lowConfidenceCount: number;

  averageMonthlyRate?: number | null;
  medianMonthlyRate?: number | null;
  p25MonthlyRate?: number | null;
  p75MonthlyRate?: number | null;

  averageAdr?: number | null;
  medianAdr?: number | null;
}

export interface SuggestedMtrRent {
  targetPropertyId: string;
  month: string;

  suggestedMonthlyRentLow?: number | null;
  suggestedMonthlyRentBase?: number | null;
  suggestedMonthlyRentHigh?: number | null;

  suggestedAdrLow?: number | null;
  suggestedAdrBase?: number | null;
  suggestedAdrHigh?: number | null;

  compCount: number;
  confidence: RentalConfidence;

  explanation: string;
}

export type RentalScrapeStage =
  | "discovery"
  | "metadata"
  | "date_entry"
  | "quote_fetch"
  | "normalization"
  | "storage";

export interface RentalScrapeError {
  source: CompetitorSource;
  listingId?: string | null;
  url?: string | null;
  stage: RentalScrapeStage;
  message: string;
  retryable: boolean;
  createdAt: string;
}

export type RentalScrapeRunStatus = "running" | "completed" | "failed";

/** One manual/scheduled collection run per source — diagnostics view backbone. */
export interface RentalScrapeRunSummary {
  id: string;
  source: CompetitorSource;
  status: RentalScrapeRunStatus;
  startedAt: string;
  finishedAt?: string | null;

  discoveredCount: number;
  metadataSuccessCount: number;
  metadataFailureCount: number;
  pricingSuccessCount: number;
  pricingFailureCount: number;
  excludedCount: number;

  errorCount: number;
  errors?: RentalScrapeError[];
  note?: string | null;
}

/** Listings stay in the active comp set only below this minimum-stay threshold. */
export const DEFAULT_MAX_MIN_STAY_NIGHTS = 45;
