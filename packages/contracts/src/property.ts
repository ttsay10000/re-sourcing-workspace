/**
 * Minimal property entity (canonical deduplicated place).
 */
export interface Property {
  id: string;
  canonicalAddress: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input to create a property.
 */
export interface PropertyInput {
  canonicalAddress: string;
}
