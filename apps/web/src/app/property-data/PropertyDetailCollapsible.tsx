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
  property_type?: string;
  type?: string;
  listing_type?: string;
  category?: string;
  sqft?: number;
  ppsqft?: number;
  bedrooms?: number;
  bathrooms?: number;
  monthlyHoa?: number;
  monthlyTax?: number;
  amenities?: string[];
  builtIn?: number;
  description?: string;
  building?: { id?: string; type?: string; propertyType?: string; property_type?: string };
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

/** Get property type from detail object; API may use propertyType, property_type, type, listing_type, or building.type. */
function getPropertyType(details: SaleDetails): string | undefined {
  const keys: (keyof SaleDetails)[] = ["propertyType", "property_type", "type", "listing_type", "category"];
  for (const key of keys) {
    const v = details[key];
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
  }
  const building = details.building;
  if (building && typeof building === "object") {
    const v = building.type ?? building.propertyType ?? building.property_type;
    if (v != null && typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Enriched broker entry (firm, email, phone). */
export interface AgentEnrichmentEntry {
  name: string;
  firm?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Price history row (date, price, event). */
export interface PriceHistoryEntry {
  date: string;
  price: string | number;
  event: string;
}

export interface PropertyDetailListing {
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
  agentEnrichment?: AgentEnrichmentEntry[] | null;
  priceHistory?: PriceHistoryEntry[] | null;
  rentalPriceHistory?: PriceHistoryEntry[] | null;
  extra?: Record<string, unknown> | null;
  uploadedAt?: string | null;
  uploadedRunId?: string | null;
  duplicateScore?: number | null;
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

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
  count,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  const label = count != null ? `${title} (${count})` : title;
  return (
    <div className="property-detail-section">
      <button
        type="button"
        className="property-detail-section-header"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`property-detail-${id}`}
        id={`property-detail-${id}-header`}
      >
        <span className="property-detail-section-title">{label}</span>
        <span className={`property-detail-section-chevron ${open ? "property-detail-section-chevron--open" : ""}`} aria-hidden>
          ▼
        </span>
      </button>
      {open && (
        <div id={`property-detail-${id}`} className="property-detail-section-body" role="region" aria-labelledby={`property-detail-${id}-header`}>
          {children}
        </div>
      )}
    </div>
  );
}

export function PropertyDetailCollapsible({ listing }: { listing: PropertyDetailListing }) {
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    details: true,
  });

  const details = (listing.extra ?? {}) as SaleDetails;

  useEffect(() => {
    setGalleryIndex(0);
  }, [listing.id]);

  const toggle = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
  const propertyType = getPropertyType(details);
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

  const hasEnrichment = listing.agentEnrichment && listing.agentEnrichment.length > 0;

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

  const formatUploaded = (at: string | null | undefined, runId: string | null | undefined) => {
    if (!at && !runId) return null;
    const d = at ? (() => { const x = new Date(at); return Number.isNaN(x.getTime()) ? null : x.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); })() : null;
    return (
      <span className="property-card-uploaded">
        {d && <>Uploaded: {d}</>}
        {d && runId && " · "}
        {runId && <>Run: {runId.slice(0, 8)}…</>}
      </span>
    );
  };

  return (
    <div className="property-detail-collapsible">
      <div className="property-detail-address-block">
        <h3 className="property-card-title">{title}</h3>
        {neighborhood !== "—" && (
          <div className="property-card-meta">
            <span className="property-card-neighborhood">{neighborhood}</span>
          </div>
        )}
        {listing.url && listing.url !== "#" && (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="property-card-source-link"
            style={{ fontSize: "0.875rem", marginTop: "0.25rem", display: "inline-block" }}
          >
            view source
          </a>
        )}
      </div>

      {photoUrls.length > 0 && (
        <CollapsibleSection
          id="photos"
          title="Photos"
          count={photoUrls.length}
          open={!!openSections.photos}
          onToggle={() => toggle("photos")}
        >
          <div className="property-card-gallery-wrap">
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
                    <img src={src} alt="" loading="lazy" className="property-card-gallery-thumb" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {floorplanUrls.length > 0 && (
        <CollapsibleSection
          id="floorplans"
          title="Floor plans"
          count={floorplanUrls.length}
          open={!!openSections.floorplans}
          onToggle={() => toggle("floorplans")}
        >
          <div className="property-card-photos">
            {floorplanUrls.map((src, i) => (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="property-card-photo-wrap"
              >
                <img src={src} alt="" loading="lazy" className="property-card-photo" />
              </a>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {(brokerDisplay || hasEnrichment) && (
        <CollapsibleSection
          id="broker"
          title="Broker / Agent"
          open={!!openSections.broker}
          onToggle={() => toggle("broker")}
        >
          {hasEnrichment ? (
            <ul className="property-detail-broker-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {listing.agentEnrichment!.map((entry, idx) => (
                <li key={idx} className="property-detail-broker-entry" style={{ marginBottom: "0.75rem" }}>
                  <strong>{entry.name}</strong>
                  {(entry.firm || entry.email || entry.phone) && (
                    <span className="property-detail-text" style={{ display: "block", marginTop: "0.25rem", fontSize: "0.9rem" }}>
                      {[entry.firm, entry.email, entry.phone].filter(Boolean).join(" · ") || "N/A"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="property-detail-text">{brokerDisplay}</p>
          )}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        id="price-history"
        title="Price history"
        count={(listing.priceHistory?.length ?? 0) + (listing.rentalPriceHistory?.length ?? 0)}
        open={!!openSections.priceHistory}
        onToggle={() => toggle("priceHistory")}
      >
        {(() => {
          const hasSale = listing.priceHistory && listing.priceHistory.length > 0;
          const hasRental = listing.rentalPriceHistory && listing.rentalPriceHistory.length > 0;
          if (!hasSale && !hasRental) {
            return (
              <p className="property-detail-text" style={{ color: "#737373" }}>
                No price history yet. It’s filled when you use “Send to property data” (with OPENAI_API_KEY set in the API). The listing must have a valid URL and the source page must include a price history section.
              </p>
            );
          }
          return (
            <div className="property-detail-price-history-wrap" style={{ maxHeight: "360px", overflowY: "auto" }}>
              {hasSale && (
                <>
                  {hasRental && <p className="property-detail-text" style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Sale / list</p>}
                  <table className="property-detail-price-history-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", marginBottom: hasRental ? "1rem" : 0 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Date</th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Price</th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Event</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listing.priceHistory!.map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "0.5rem 0.75rem" }}>{row.date}</td>
                          <td style={{ padding: "0.5rem 0.75rem" }}>{typeof row.price === "number" ? formatPrice(row.price) : row.price}</td>
                          <td style={{ padding: "0.5rem 0.75rem" }}>{row.event}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {hasRental && (
                <>
                  {hasSale && <p className="property-detail-text" style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Rental</p>}
                  <table className="property-detail-price-history-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Date</th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Price</th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Event</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listing.rentalPriceHistory!.map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "0.5rem 0.75rem" }}>{row.date}</td>
                          <td style={{ padding: "0.5rem 0.75rem" }}>{typeof row.price === "number" ? formatPrice(row.price) : row.price}</td>
                          <td style={{ padding: "0.5rem 0.75rem" }}>{row.event}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })()}
      </CollapsibleSection>

      <CollapsibleSection
        id="details"
        title="Details"
        open={!!openSections.details}
        onToggle={() => toggle("details")}
      >
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
      </CollapsibleSection>

      {amenities.length > 0 && (
        <CollapsibleSection
          id="amenities"
          title="Amenities"
          count={amenities.length}
          open={!!openSections.amenities}
          onToggle={() => toggle("amenities")}
        >
          <ul className="property-card-amenities">
            {amenities.map((a, i) => {
              const label = String(a)
                .replace(/_/g, " ")
                .trim();
              const capitalized = label.replace(/\b\w/g, (c) => c.toUpperCase());
              return <li key={i}>{capitalized}</li>;
            })}
          </ul>
        </CollapsibleSection>
      )}

      {description && (
        <CollapsibleSection
          id="description"
          title="Description"
          open={!!openSections.description}
          onToggle={() => toggle("description")}
        >
          <div className="property-card-description-wrap">
            <p
              className={`property-card-description ${descriptionExpanded ? "property-card-description--expanded" : ""}`}
            >
              {description}
            </p>
            <button
              type="button"
              className="property-card-expand"
              onClick={(e) => {
                e.stopPropagation();
                setDescriptionExpanded((prev) => !prev);
              }}
            >
              {descriptionExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </CollapsibleSection>
      )}

      {(listing.uploadedAt || listing.uploadedRunId) && (
        <div className="property-card-footer" style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e5e5", fontSize: "0.8rem", color: "#737373" }}>
          {formatUploaded(listing.uploadedAt, listing.uploadedRunId)}
        </div>
      )}
    </div>
  );
}
