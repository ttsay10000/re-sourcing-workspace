import type { ListingNormalized, ListingSource, SearchProfile, SourceToggles } from "@re-sourcing/contracts";

export type SourceAdapterId = "streeteasy" | "loopnet";

export type SourceRunKind = "manual" | "saved_search";

export interface SourceAdapterCapabilities {
  manualSearch: boolean;
  savedSearch: boolean;
  manualUrlIngestion: boolean;
}

export interface SourceRunContext {
  runKind: SourceRunKind;
}

export interface SourceSearchResult {
  urls: string[];
  metadata?: Record<string, unknown>;
  warnings?: string[];
}

export interface SourceAdapterRunBody {
  source?: string | null;
  areas?: string | null;
  location?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minBeds?: number | null;
  maxBeds?: number | null;
  minBaths?: number | null;
  maxHoa?: number | null;
  maxTax?: number | null;
  minSqft?: number | null;
  maxSqft?: number | null;
  amenities?: string | null;
  types?: string | null;
  limit?: number | null;
  offset?: number | null;
  manualUrl?: string | null;
  manualUrls?: string[] | null;
}

export interface SourceAdapter<Criteria extends object = Record<string, unknown>> {
  id: SourceAdapterId;
  displayName: string;
  listingSource: ListingSource;
  capabilities: SourceAdapterCapabilities;
  defaultEnabled: boolean;
  buildManualCriteria(body: SourceAdapterRunBody): Criteria;
  buildSavedSearchCriteria?(search: SearchProfile): Criteria;
  fetchSearch(criteria: Criteria, context: SourceRunContext): Promise<SourceSearchResult>;
  fetchDetailsByUrl(url: string, context: SourceRunContext): Promise<Record<string, unknown>>;
  normalize(raw: Record<string, unknown>, index: number): ListingNormalized;
  validateManualUrl?(url: string): boolean;
}

export type AnySourceAdapter = SourceAdapter<any>;

export type SourceToggleInput = SourceToggles | Record<string, unknown> | null | undefined;
