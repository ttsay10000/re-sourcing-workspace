"use client";

import { useState, useEffect } from "react";

/** Sale details shape from GET sale details (stored in listing.extra). */
interface SaleDetails {
  id?: string;
  status?: string;
  listedAt?: string;
  closedAt?: string;
  daysOnMarket?: number;
  address?: string;
  price?: number;
  closedPrice?: number;
  borough?: string;
  neighborhood?: string;
  zipcode?: string;
  propertyType?: string;
  sqft?: number;
  ppsqft?: number;
  bedrooms?: number;
  bathrooms?: number;
  monthlyHoa?: number;
  monthlyTax?: number;
  amenities?: string[];
  builtIn?: number;
  description?: string;
  building?: { id?: string };
  agents?: string[];
  broker_name?: string;
  broker?: string;
  listing_agent?: string;
  agent_name?: string;
  images?: string[];
  videos?: string[];
  floorplans?: string[];
  [key: string]: unknown;
}

interface PropertyCardProps {
  /** Listing row from API (address, price, extra = sale details). */
  listing: {
    id: string;
    externalId: string;
    source: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    price: number;
    beds: number;
    baths: number;
    sqft?: number | null;
    description?: string | null;
    listedAt?: string | null;
    url?: string;
    imageUrls?: string[] | null;
    agentNames?: string[] | null;
    extra?: Record<string, unknown> | null;
  };
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(s: string | null | undefined): string {
  if (!s || typeof s !== "string") return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatNeighborhood(s: string | null | undefined): string {
  if (!s || typeof s !== "string") return "—";
  return s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function PropertyCard({ listing }: PropertyCardProps) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const details = (listing.extra ?? {}) as SaleDetails;

  useEffect(() => {
    setGalleryIndex(0);
  }, [listing.id]);

  const title = [listing.address || details.address, listing.zip || details.zipcode]
    .filter(Boolean)
    .join(", ") || "—";
  const neighborhood = formatNeighborhood(details.neighborhood);
  const price = details.closedPrice ?? details.price ?? listing.price;
  const listedAt = details.listedAt ?? listing.listedAt;
  const closedAt = details.closedAt;
  const beds = details.bedrooms ?? listing.beds;
  const baths = details.bathrooms ?? listing.baths;
  const sqft = details.sqft ?? listing.sqft;
  const propertyType = details.propertyType;
  const amenities = Array.isArray(details.amenities) ? details.amenities : [];
  const description = details.description ?? listing.description;
  const monthlyHoa = details.monthlyHoa;
  const monthlyTax = details.monthlyTax;
  const builtIn = details.builtIn;
  const daysOnMarket = details.daysOnMarket;
  const brokerDisplay = (() => {
    if (listing.agentNames && listing.agentNames.length > 0) {
      return listing.agentNames.join(", ");
    }
    if (Array.isArray(details.agents) && details.agents.length > 0) {
      return details.agents.map((a) => (a != null ? String(a) : "")).filter(Boolean).join(", ");
    }
    const single = details.broker_name ?? details.broker ?? details.listing_agent ?? details.agent_name;
    return single != null && String(single).trim() ? String(single).trim() : null;
  })();

  const photoUrls = (listing.imageUrls && listing.imageUrls.length > 0)
    ? listing.imageUrls
    : (Array.isArray(details.images) ? details.images.filter((u): u is string => typeof u === "string") : []);
  const floorplanUrls = Array.isArray(details.floorplans) ? details.floorplans.filter((u): u is string => typeof u === "string") : [];

  const na = (v: unknown) =>
    v === null || v === undefined || v === "" ? (
      <span className="property-card-na">Not available</span>
    ) : (
      String(v)
    );

  return (
    <div className="property-card">
      <h3 className="property-card-title">{title}</h3>
      <div className="property-card-meta">
        {neighborhood !== "—" && (
          <span className="property-card-neighborhood">{neighborhood}</span>
        )}
      </div>

      {photoUrls.length > 0 && (
        <div className="property-card-section property-card-gallery-wrap">
          <h4 className="property-card-heading">Photos ({photoUrls.length})</h4>
          <div className="property-card-gallery">
            <a
              href={photoUrls[galleryIndex]}
              target="_blank"
              rel="noopener noreferrer"
              className="property-card-gallery-main-wrap"
            >
              <img
                key={galleryIndex}
                src={photoUrls[galleryIndex]}
                alt=""
                className="property-card-gallery-main"
              />
            </a>
            <div className="property-card-gallery-thumbs">
              {photoUrls.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setGalleryIndex(i)}
                  className={`property-card-gallery-thumb-wrap ${i === galleryIndex ? "property-card-gallery-thumb-wrap--active" : ""}`}
                >
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="property-card-gallery-thumb"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {floorplanUrls.length > 0 && (
        <div className="property-card-section">
          <h4 className="property-card-heading">Floor plans ({floorplanUrls.length})</h4>
          <div className="property-card-photos">
            {floorplanUrls.map((src, i) => (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="property-card-photo-wrap"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="property-card-photo"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="property-card-section">
        <div className="property-card-price">{formatPrice(price)}</div>
        {listedAt !== "—" && (
          <div className="property-card-dates">
            <span>Listed: {formatDate(listedAt)}</span>
            {closedAt && <span>Closed: {formatDate(closedAt)}</span>}
            {daysOnMarket != null && !Number.isNaN(daysOnMarket) && (
              <span>{daysOnMarket} days on market</span>
            )}
          </div>
        )}
      </div>

      <dl className="property-card-dl">
        <div>
          <dt>Beds / Baths</dt>
          <dd>{na(beds)} / {na(baths)}</dd>
        </div>
        <div>
          <dt>Sqft</dt>
          <dd>{na(sqft)}</dd>
        </div>
        <div>
          <dt>Property type</dt>
          <dd>{na(propertyType)}</dd>
        </div>
        {brokerDisplay && (
          <div>
            <dt>Broker / Agent</dt>
            <dd>{brokerDisplay}</dd>
          </div>
        )}
        {builtIn != null && !Number.isNaN(builtIn) && (
          <div>
            <dt>Built</dt>
            <dd>{builtIn}</dd>
          </div>
        )}
        {(monthlyHoa != null || monthlyTax != null) && (
          <div>
            <dt>HOA / Tax</dt>
            <dd>
              {formatPrice(monthlyHoa)} / {formatPrice(monthlyTax)}
            </dd>
          </div>
        )}
      </dl>

      {amenities.length > 0 && (
        <div className="property-card-section">
          <h4 className="property-card-heading">Amenities</h4>
          <ul className="property-card-amenities">
            {amenities.map((a, i) => (
              <li key={i}>{String(a).replace(/_/g, " ")}</li>
            ))}
          </ul>
        </div>
      )}

      {description && (
        <div className="property-card-section">
          <h4 className="property-card-heading">Description</h4>
          <div className="property-card-description-wrap">
            <p
              className={`property-card-description ${descriptionExpanded ? "property-card-description--expanded" : ""}`}
            >
              {description}
            </p>
            <button
              type="button"
              className="property-card-expand"
              onClick={() => setDescriptionExpanded((e) => !e)}
            >
              {descriptionExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
      )}

      <div className="property-card-footer">
        <span className="property-card-id">Listing ID: {listing.externalId}</span>
        {listing.url && listing.url !== "#" && (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="property-card-source-link"
          >
            view source
          </a>
        )}
      </div>
    </div>
  );
}
