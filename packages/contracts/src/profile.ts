import type { LocationMode } from "./enums.js";

export type SearchCadence = "manual" | "daily" | "weekly" | "monthly";

export interface SearchOutreachRules {
  minUnits?: number | null;
  maxPrice?: number | null;
  propertyTypes?: string[] | null;
  requireResolvedRecipient?: boolean;
  minimumRecipientConfidence?: number | null;
}

/**
 * Search profile: filters, source toggles, and schedule.
 * Used for automated ingestion and UI.
 */
export interface SearchProfile {
  id: string;
  name: string;
  enabled: boolean;
  /** single = one location slug; multi = area_codes or multiple slugs. */
  locationMode: LocationMode;
  /** When locationMode is 'single', the slug (e.g. StreetEasy neighborhood). */
  singleLocationSlug: string | null;
  /** When locationMode is 'multi', list of area codes or location identifiers. */
  areaCodes: string[];
  /** Min price filter (dollars). */
  minPrice: number | null;
  /** Max price filter (dollars). */
  maxPrice: number | null;
  /** Min bedrooms. */
  minBeds: number | null;
  /** Max bedrooms. */
  maxBeds: number | null;
  /** Min bathrooms. */
  minBaths: number | null;
  /** Max bathrooms. */
  maxBaths: number | null;
  /** Max monthly HOA. */
  maxHoa: number | null;
  /** Max monthly taxes. */
  maxTax: number | null;
  /** Min square footage. */
  minSqft: number | null;
  /** Max square footage. */
  maxSqft: number | null;
  /** Amenities that must be present (e.g. "doorman", "laundry_in_unit"). */
  requiredAmenities: string[];
  /** Property types supported by the StreetEasy source query (e.g. condo, coop, house, multi_family). */
  propertyTypes: string[];
  /** Source toggles: which sources are enabled for this profile. */
  sourceToggles: SourceToggles;
  /** V1 saved-search cadence. */
  scheduleCadence: SearchCadence;
  /** Local timezone for the scheduled run. */
  timezone: string;
  /** Local time string in HH:MM:SS format. */
  runTimeLocal: string | null;
  /** 0 = Sunday through 6 = Saturday for weekly cadence. */
  weeklyRunDay: number | null;
  /** 1-31 for monthly cadence. */
  monthlyRunDay: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  outreachRules: SearchOutreachRules;
  /** Schedule: cron expression or null for manual-only. */
  scheduleCron: string | null;
  /** Alternative: run interval in minutes (if no cron). */
  runIntervalMinutes: number | null;
  /** Max number of listings to request from the source query. */
  resultLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Which listing sources are enabled for a profile.
 */
export interface SourceToggles {
  streeteasy: boolean;
  manual: boolean;
  zillow?: boolean;
  [key: string]: boolean | undefined;
}

/**
 * Input to create or update a search profile (API/UI).
 */
export interface SearchProfileInput {
  name: string;
  enabled?: boolean;
  locationMode: LocationMode;
  singleLocationSlug?: string | null;
  areaCodes?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  maxBeds?: number | null;
  minBaths?: number | null;
  maxBaths?: number | null;
  maxHoa?: number | null;
  maxTax?: number | null;
  minSqft?: number | null;
  maxSqft?: number | null;
  requiredAmenities?: string[];
  propertyTypes?: string[];
  sourceToggles?: SourceToggles;
  scheduleCadence?: SearchCadence;
  timezone?: string | null;
  runTimeLocal?: string | null;
  weeklyRunDay?: number | null;
  monthlyRunDay?: number | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  outreachRules?: SearchOutreachRules;
  scheduleCron?: string | null;
  runIntervalMinutes?: number | null;
  resultLimit?: number | null;
}

export type SavedSearch = SearchProfile;
export type SavedSearchInput = SearchProfileInput;
