"use client";

import { PropertyDetailCollapsible, type PropertyDetailListing } from "./PropertyDetailCollapsible";

interface PropertyCardProps {
  /** Listing row from API (address, price, extra = sale details). */
  listing: PropertyDetailListing;
}

/** Thin wrapper: renders the shared collapsible detail view. Kept for backwards compatibility. */
export function PropertyCard({ listing }: PropertyCardProps) {
  return (
    <div className="property-card">
      <PropertyDetailCollapsible listing={listing} />
    </div>
  );
}
