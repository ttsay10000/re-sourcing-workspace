/**
 * Minimal property entity (canonical deduplicated place).
 */
/** Placeholder keys for canonical property details (permit, tax, owner, etc.). */
export interface PropertyDetails {
  permitInfo?: string | null;
  taxCode?: string | null;
  buildingLotBlock?: string | null;
  ownerInfo?: string | null;
  omFurnishedPricing?: string | null;
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
