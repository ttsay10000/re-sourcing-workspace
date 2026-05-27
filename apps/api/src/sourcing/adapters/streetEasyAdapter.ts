import type { SearchProfile } from "@re-sourcing/contracts";
import {
  fetchActiveSalesWithCriteria,
  fetchSaleDetailsByUrl,
  type NycsSearchCriteria,
} from "../../nycRealEstateApi.js";
import { normalizeStreetEasySaleDetails } from "../normalizeStreetEasyListing.js";
import type { SourceAdapter, SourceAdapterRunBody } from "./types.js";

function splitTypes(types: string | null | undefined): string[] {
  return (types ?? "")
    .split(",")
    .map((type) => type.trim())
    .filter(Boolean);
}

function expandStreetEasyApiTypes(types: string | null | undefined): string | undefined {
  const selected = splitTypes(types);
  if (selected.length === 0) return undefined;
  const expanded = new Set(selected);
  if (selected.includes("multi_family")) {
    // StreetEasy's native type:M includes two-/three-family townhouse records
    // that RapidAPI tends to expose under the broader house bucket.
    expanded.add("house");
  }
  return Array.from(expanded).join(",");
}

export function buildStreetEasyCriteriaFromBody(body: SourceAdapterRunBody): NycsSearchCriteria {
  const requestedTypes = body.types?.trim() || undefined;
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
    requestedTypes,
    types: expandStreetEasyApiTypes(requestedTypes),
    limit: body.limit != null ? Math.min(Number(body.limit), 500) : 100,
    offset: body.offset != null ? Number(body.offset) : undefined,
  };
}

export function buildStreetEasyCriteriaFromSearch(search: SearchProfile): NycsSearchCriteria {
  const areas = search.locationMode === "single"
    ? (search.singleLocationSlug?.trim() || "all-downtown")
    : (search.areaCodes.length > 0 ? search.areaCodes.join(",") : "all-downtown,all-midtown");
  const requestedTypes = search.propertyTypes.length > 0 ? search.propertyTypes.join(",") : undefined;
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
    requestedTypes,
    types: expandStreetEasyApiTypes(requestedTypes),
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
