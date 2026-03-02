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
  /** Computed from price history: listed vs current price (from send-to-property-data). */
  priceChangeSinceListed?: { listedPrice: number; currentPrice: number; changeAmount: number; changePercent: number };
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
    photosFloorplans: true,
    detailsBrokerAmenitiesPriceHistory: true,
  });

  const details = (listing.extra ?? {}) as SaleDetails;

  useEffect(() => {
    setGalleryIndex(0);
  }, [listing.id]);

  const toggle = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
      {/* 1. Photos & floor plans — side by side */}
      <CollapsibleSection
        id="photos-floorplans"
        title="Photos / floor plans"
        count={(photoUrls.length > 0 ? photoUrls.length : 0) + (floorplanUrls.length > 0 ? floorplanUrls.length : 0)}
        open={!!openSections.photosFloorplans}
        onToggle={() => toggle("photosFloorplans")}
      >
        <div className="property-detail-media-columns" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            {photoUrls.length > 0 ? (
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
            ) : (
              <p className="property-detail-text" style={{ color: "#737373" }}>No photos</p>
            )}
          </div>
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            {floorplanUrls.length > 0 ? (
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
            ) : (
              <p className="property-detail-text" style={{ color: "#737373" }}>No floor plans</p>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* 2. Initial property info: details + broker/agent + amenities + price history — side by side */}
      <CollapsibleSection
        id="details-broker-amenities-price-history"
        title="Initial property info"
        open={!!openSections.detailsBrokerAmenitiesPriceHistory}
        onToggle={() => toggle("detailsBrokerAmenitiesPriceHistory")}
      >
        <div className="initial-info-grid">
          <div className="initial-info-card initial-info-card--details">
            <h4 className="initial-info-subtitle">Details</h4>
            <div className="initial-info-price">{formatPrice(price)}</div>
            {(listedAt !== "—" || closedAt || (daysOnMarket != null && !Number.isNaN(daysOnMarket))) && (
              <div className="initial-info-listing-meta">
                {listedAt !== "—" && <span>Listed {formatDate(listedAt)}</span>}
                {closedAt && <span> · Closed {formatDate(closedAt)}</span>}
                {daysOnMarket != null && !Number.isNaN(daysOnMarket) && <span> · {daysOnMarket} days on market</span>}
              </div>
            )}
            {details.priceChangeSinceListed && (() => {
              const p = details.priceChangeSinceListed;
              const isDecrease = p.changeAmount < 0;
              const isIncrease = p.changeAmount > 0;
              return (
                <div className="initial-info-price-change">
                  <span>Listed at {formatPrice(p.listedPrice)}</span>
                  <span> · Now {formatPrice(p.currentPrice)}</span>
                  {p.changeAmount !== 0 && (
                    <span className={isDecrease ? "initial-info-price-change--down" : isIncrease ? "initial-info-price-change--up" : ""}>
                      {" "}{isDecrease ? "−" : "+"}{formatPrice(Math.abs(p.changeAmount))} ({isDecrease ? "" : "+"}{p.changePercent.toFixed(1)}%)
                    </span>
                  )}
                </div>
              );
            })()}
            <dl className="initial-info-dl">
              <div className="initial-info-dl-row"><dt>Beds / Baths</dt><dd>{na(beds)} / {na(baths)}</dd></div>
              <div className="initial-info-dl-row"><dt>Sqft</dt><dd>{na(sqft)}</dd></div>
              <div className="initial-info-dl-row"><dt>Property type</dt><dd>{na(propertyType)}</dd></div>
              {builtIn != null && !Number.isNaN(builtIn) && <div className="initial-info-dl-row"><dt>Built</dt><dd>{builtIn}</dd></div>}
              {(monthlyHoa != null || monthlyTax != null) && (
                <div className="initial-info-dl-row"><dt>HOA / Tax</dt><dd>{formatPrice(monthlyHoa)} / {formatPrice(monthlyTax)}</dd></div>
              )}
            </dl>
          </div>
          <div className="initial-info-card">
            <h4 className="initial-info-subtitle">Broker / Agent</h4>
            {brokerDisplay || hasEnrichment ? (
              hasEnrichment ? (
                <ul className="initial-info-broker-list">
                  {listing.agentEnrichment!.map((entry, idx) => (
                    <li key={idx}>
                      <span className="initial-info-broker-name">{entry.name}</span>
                      {(entry.firm || entry.email || entry.phone) && (
                        <span className="initial-info-broker-meta">{[entry.firm, entry.email, entry.phone].filter(Boolean).join(" · ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0, color: "#0f172a", fontSize: "0.875rem" }}>{brokerDisplay}</p>
              )
            ) : (
              <p className="initial-info-empty">—</p>
            )}
          </div>
          <div className="initial-info-card">
            <h4 className="initial-info-subtitle">Amenities</h4>
            {amenities.length > 0 ? (
              <ul className="initial-info-amenities-pills">
                {amenities.map((a, i) => {
                  const capitalized = String(a).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  return <li key={i}>{capitalized}</li>;
                })}
              </ul>
            ) : (
              <p className="initial-info-empty">—</p>
            )}
          </div>
          <div className="initial-info-card">
            <h4 className="initial-info-subtitle">Price history</h4>
            {(() => {
              const hasSale = listing.priceHistory && listing.priceHistory.length > 0;
              const hasRental = listing.rentalPriceHistory && listing.rentalPriceHistory.length > 0;
              if (!hasSale && !hasRental) {
                return (
                  <p className="initial-info-empty">
                    No price history. Filled from GET sale details when you use “Send to property data”.
                  </p>
                );
              }
              return (
                <div className="initial-info-price-history-list">
                  {hasSale && (
                    <>
                      {hasRental && <div style={{ fontWeight: 600, marginBottom: "0.4rem", fontSize: "0.75rem", color: "#64748b" }}>Sale / list</div>}
                      {listing.priceHistory!.map((row, idx) => (
                        <div key={idx}>{row.date} · {typeof row.price === "number" ? formatPrice(row.price) : row.price} · {row.event}</div>
                      ))}
                    </>
                  )}
                  {hasRental && (
                    <>
                      {hasSale && <div style={{ fontWeight: 600, marginTop: "0.5rem", marginBottom: "0.4rem", fontSize: "0.75rem", color: "#64748b" }}>Rental</div>}
                      {listing.rentalPriceHistory!.map((row, idx) => (
                        <div key={idx}>{row.date} · {typeof row.price === "number" ? formatPrice(row.price) : row.price} · {row.event}</div>
                      ))}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
          {description && (
            <div className="initial-info-card initial-info-card--description">
              <h4 className="initial-info-subtitle">Description</h4>
              <div className="initial-info-description-wrap property-card-description-wrap">
                <p
                  className={`property-card-description ${descriptionExpanded ? "property-card-description--expanded" : ""}`}
                  style={{ whiteSpace: "pre-wrap" }}
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
            </div>
          )}
        </div>
      </CollapsibleSection>

      {(listing.uploadedAt || listing.uploadedRunId) && (
        <div className="property-card-footer" style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e5e5", fontSize: "0.8rem", color: "#737373" }}>
          {formatUploaded(listing.uploadedAt, listing.uploadedRunId)}
        </div>
      )}
    </div>
  );
}
