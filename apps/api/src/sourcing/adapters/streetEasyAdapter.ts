import type { SearchProfile } from "@re-sourcing/contracts";
import {
  fetchActiveSalesWithCriteria,
  fetchSaleDetailsByUrl,
  type NycsSearchCriteria,
} from "../../nycRealEstateApi.js";
import { normalizeStreetEasySaleDetails } from "../normalizeStreetEasyListing.js";
import type { SourceAdapter, SourceAdapterRunBody } from "./types.js";

export function buildStreetEasyCriteriaFromBody(body: SourceAdapterRunBody): NycsSearchCriteria {
  return {
    areas: body.areas?.trim() || "all-downtown,all-midtown",
    minPrice: body.minPrice != null ? Number(body.minPrice) : undefined,
    maxPrice: body.maxPrice != null ? Number(body.maxPrice) : undefined,
    minBeds: body.minBeds != null ? Number(body.minBeds) : undefined,
    maxBeds: body.maxBeds != null ? Number(body.maxBeds) : undefined,
    minBaths: body.minBaths != null ? Number(body.minBaths) : undefined,
    maxHoa: body.maxHoa != null ? Number(body.maxHoa) : undefined,
    maxTax: body.maxTax != null ? Number(body.maxTax) : undefined,
    amenities: body.amenities ?? undefined,
    types: body.types ?? undefined,
    limit: body.limit != null ? Math.min(Number(body.limit), 500) : 100,
    offset: body.offset != null ? Number(body.offset) : undefined,
  };
}

export function buildStreetEasyCriteriaFromSearch(search: SearchProfile): NycsSearchCriteria {
  const areas = search.locationMode === "single"
    ? (search.singleLocationSlug?.trim() || "all-downtown")
    : (search.areaCodes.length > 0 ? search.areaCodes.join(",") : "all-downtown,all-midtown");
  return {
    areas,
    minPrice: search.minPrice ?? undefined,
    maxPrice: search.maxPrice ?? undefined,
    minBeds: search.minBeds ?? undefined,
    maxBeds: search.maxBeds ?? undefined,
    minBaths: search.minBaths ?? undefined,
    maxHoa: search.maxHoa ?? undefined,
    maxTax: search.maxTax ?? undefined,
    amenities: search.requiredAmenities.length > 0 ? search.requiredAmenities.join(",") : undefined,
    types: search.propertyTypes.length > 0 ? search.propertyTypes.join(",") : undefined,
    limit: search.resultLimit ?? 100,
  };
}

export const streetEasyAdapter: SourceAdapter<NycsSearchCriteria> = {
  id: "streeteasy",
  displayName: "StreetEasy",
  listingSource: "streeteasy",
  capabilities: {
    manualSearch: true,
    savedSearch: true,
    manualUrlIngestion: true,
  },
  defaultEnabled: true,
  buildManualCriteria: buildStreetEasyCriteriaFromBody,
  buildSavedSearchCriteria: buildStreetEasyCriteriaFromSearch,
  async fetchSearch(criteria) {
    return fetchActiveSalesWithCriteria(criteria);
  },
  async fetchDetailsByUrl(url) {
    return fetchSaleDetailsByUrl(url);
  },
  normalize: normalizeStreetEasySaleDetails,
  validateManualUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "streeteasy.com" || parsed.hostname.endsWith(".streeteasy.com");
    } catch {
      return false;
    }
  },
};
