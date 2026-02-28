import type { LocationMode } from "./enums.js";

/**
 * Search profile: filters, source toggles, and schedule.
 * Used for automated ingestion and UI.
 */
export interface SearchProfile {
  id: string;
  name: string;
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
  /** Min square footage. */
  minSqft: number | null;
  /** Max square footage. */
  maxSqft: number | null;
  /** Amenities that must be present (e.g. "doorman", "laundry_in_unit"). */
  requiredAmenities: string[];
  /** Source toggles: which sources are enabled for this profile. */
  sourceToggles: SourceToggles;
  /** Schedule: cron expression or null for manual-only. */
  scheduleCron: string | null;
  /** Alternative: run interval in minutes (if no cron). */
  runIntervalMinutes: number | null;
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
  locationMode: LocationMode;
  singleLocationSlug?: string | null;
  areaCodes?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  maxBeds?: number | null;
  minBaths?: number | null;
  maxBaths?: number | null;
  minSqft?: number | null;
  maxSqft?: number | null;
  requiredAmenities?: string[];
  sourceToggles?: SourceToggles;
  scheduleCron?: string | null;
  runIntervalMinutes?: number | null;
}
