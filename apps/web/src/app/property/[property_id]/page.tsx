"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CanonicalPropertyDetail, type CanonicalProperty } from "../../property-data/CanonicalPropertyDetail";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function PropertyDetailPage() {
  const params = useParams();
  const propertyId = params?.property_id as string | undefined;
  const [property, setProperty] = useState<CanonicalProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) {
      setLoading(false);
      setError("Missing property ID");
      return;
    }
    Promise.all([
      fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Property not found")))),
      fetch(`${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/listing`).then((r) => (r.ok ? r.json() : { listing: null })),
    ])
      .then(([propData, listingData]) => {
        const listing = listingData?.listing ?? null;
        const canonical: CanonicalProperty = {
          id: propData.id,
          canonicalAddress: propData.canonicalAddress ?? "",
          details: propData.details ?? null,
          createdAt: propData.createdAt,
          updatedAt: propData.updatedAt,
          primaryListing: listing
            ? {
                price: listing.price ?? null,
                listedAt: listing.listedAt ?? null,
                city: listing.city ?? null,
              }
            : null,
          omStatus: undefined,
          dealScore: propData.dealScore ?? null,
        };
        setProperty(canonical);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load property"))
      .finally(() => setLoading(false));
  }, [propertyId]);

  if (loading) {
    return (
      <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
        Loading property…
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="card error" style={{ padding: "1.5rem" }}>
        {error || "Property not found."}{" "}
        <Link href="/">Back to Home</Link> · <Link href="/property-data">Property Data</Link>
      </div>
    );
  }

  return (
    <div className="property-data-layout" style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/" style={{ fontSize: "0.9rem", color: "#15803d" }}>← Back to Deal Discovery</Link>
      </div>
      <CanonicalPropertyDetail property={property} />
    </div>
  );
}
