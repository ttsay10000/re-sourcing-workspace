"use client";

import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface CanonicalProperty {
  id: string;
  canonicalAddress: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** Listing row shape returned by GET /api/properties/:id/listing */
interface ListingRow {
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
  agentEnrichment?: { name: string; firm?: string | null; email?: string | null; phone?: string | null }[] | null;
  priceHistory?: { date: string; price: string | number; event: string }[] | null;
  rentalPriceHistory?: { date: string; price: string | number; event: string }[] | null;
  duplicateScore?: number | null;
  extra?: Record<string, unknown> | null;
}

/** Unified row for violations/complaints/permits table */
interface UnifiedEnrichmentRow {
  date: string;
  category: string;
  info: string;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Format price for history rows: no decimals when whole dollars. */
function formatPriceCompact(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[$,]/g, ""));
  if (Number.isNaN(n)) return "—";
  const opts = n % 1 === 0 ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...opts }).format(n);
}

/** Format YYYY-MM-DD or ISO date for display. */
function formatPriceHistoryDate(dateStr: string | null | undefined): string {
  if (!dateStr || typeof dateStr !== "string") return "—";
  const d = new Date(dateStr.trim().split("T")[0] + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Human-readable event label for price history. */
function formatPriceEventLabel(event: string | null | undefined): string {
  if (!event || typeof event !== "string") return "—";
  const lower = event.trim().toLowerCase().replace(/_/g, " ");
  if (!lower) return "—";
  return lower.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Title-case property type for display (e.g. "multi family" → "Multi Family"). */
function formatPropertyType(value: string | null | undefined): string {
  if (value == null || String(value).trim() === "") return "—";
  const normalized = String(value).trim().replace(/_/g, " ").toLowerCase();
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatListedDate(listedAt: string | null | undefined): string {
  if (!listedAt) return "—";
  const d = new Date(listedAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Normalize date strings to YYYY-MM-DD (strip time/timezone). */
function formatDateOnly(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  const datePart = trimmed.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  return d.toISOString().slice(0, 10);
}

function daysOnMarket(listedAt: string | null | undefined): number | null {
  if (!listedAt) return null;
  const d = new Date(listedAt);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function fullAddress(row: ListingRow): string {
  return [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ") || "—";
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
        aria-controls={`canonical-detail-${id}`}
      >
        <span className="property-detail-section-title">{label}</span>
        <span className={`property-detail-section-chevron ${open ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
      </button>
      {open && (
        <div id={`canonical-detail-${id}`} className="property-detail-section-body" role="region">
          {children}
        </div>
      )}
    </div>
  );
}

export function CanonicalPropertyDetail({ property }: { property: CanonicalProperty }) {
  const [primaryListing, setPrimaryListing] = useState<ListingRow | null | "loading">("loading");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    photosFloorplans: true,
    detailsBrokerAmenitiesPriceHistory: true,
    owner: true,
    rentalOm: true,
    violationsComplaintsPermits: true,
  });
  const [unifiedRows, setUnifiedRows] = useState<UnifiedEnrichmentRow[]>([]);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedFetched, setUnifiedFetched] = useState(false);
  const [ownerFromPermits, setOwnerFromPermits] = useState<{ owner_name?: string; owner_business_name?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPrimaryListing("loading");
    fetch(`${API_BASE}/api/properties/${property.id}/listing`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setPrimaryListing(data.listing ?? null);
      })
      .catch(() => { if (!cancelled) setPrimaryListing(null); });
    return () => { cancelled = true; };
  }, [property.id]);

  useEffect(() => {
    if (openSections.violationsComplaintsPermits && !unifiedFetched && !unifiedLoading) {
      fetchUnifiedTable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when section is open and not yet fetched
  }, [openSections.violationsComplaintsPermits, unifiedFetched, unifiedLoading]);

  const toggle = (key: string) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  const d = property.details as Record<string, unknown> | null | undefined;
  const enrichment = d?.enrichment as Record<string, unknown> | undefined;
  const ps = enrichment?.permits_summary as Record<string, unknown> | undefined;
  const bbl = d?.bbl ?? d?.BBL ?? d?.buildingLotBlock;
  const bblBase = d?.bblBase ?? d?.condoBaseBbl;
  const lat = d?.lat ?? d?.latitude;
  const lon = d?.lon ?? d?.longitude;
  const monthlyHoa = d?.monthlyHoa ?? d?.monthly_hoa;
  const monthlyTax = d?.monthlyTax ?? d?.monthly_tax;
  const ownerInfo = d?.ownerInfo ?? d?.owner_info;
  const omFurnishedPricing = d?.omFurnishedPricing ?? d?.om_furnished_pricing;

  const fetchUnifiedTable = () => {
    if (unifiedFetched) return;
    setUnifiedLoading(true);
    const base = `${API_BASE}/api/properties/${property.id}/enrichment`;
    Promise.all([
      fetch(`${base}/permits`).then((r) => r.json()).then((data) => data.permits ?? []),
      fetch(`${base}/violations`).then((r) => r.json()).then((data) => data.violations ?? []),
      fetch(`${base}/complaints`).then((r) => r.json()).then((data) => data.complaints ?? []),
      fetch(`${base}/litigations`).then((r) => r.json()).then((data) => data.litigations ?? []),
    ])
      .then(([permits, violations, complaints, litigations]) => {
        const rows: UnifiedEnrichmentRow[] = [];
        let firstOwner: { owner_name?: string; owner_business_name?: string } | null = null;
        for (const p of permits as Record<string, unknown>[]) {
          const n = p.normalizedJson as Record<string, unknown> | undefined;
          const raw = p.rawJson as Record<string, unknown> | undefined;
          const date = (p.approvedDate ?? p.approved_date ?? p.issuedDate ?? p.issued_date ?? n?.approvedDate ?? n?.issuedDate ?? "") as string;
          const workType = (n?.workType ?? n?.work_type ?? p.workPermit ?? p.work_permit ?? "") as string;
          const status = (n?.status ?? p.status ?? "") as string;
          rows.push({ date: formatDateOnly(date) || "—", category: "Permit", info: [workType, status].filter(Boolean).join(" · ") || "—" });
          if (!firstOwner && (raw || n)) {
            const r = raw ?? n ?? {};
            const on = (r.owner_name ?? r.owner_business_name) ? { owner_name: String(r.owner_name ?? "").trim() || undefined, owner_business_name: String(r.owner_business_name ?? "").trim() || undefined } : null;
            if (on && (on.owner_name || on.owner_business_name)) firstOwner = on;
          }
        }
        setOwnerFromPermits(firstOwner);
        for (const v of violations as Record<string, unknown>[]) {
          const n = v.normalizedJson as Record<string, unknown> | undefined;
          const date = (n?.approvedDate ?? "") as string;
          const cls = (n?.class ?? "") as string;
          const status = (n?.currentStatus ?? n?.current_status ?? "") as string;
          const desc = (n?.novDescription ?? n?.nov_description ?? "") as string;
          rows.push({ date: formatDateOnly(date) || "—", category: "HPD Violation", info: [cls, status, desc].filter(Boolean).join(" · ") || "—" });
        }
        for (const c of complaints as Record<string, unknown>[]) {
          const n = c.normalizedJson as Record<string, unknown> | undefined;
          const date = (n?.dateEntered ?? n?.date_entered ?? "") as string;
          const cat = (n?.complaintCategory ?? n?.complaint_category ?? "") as string;
          const status = (n?.status ?? "") as string;
          rows.push({ date: formatDateOnly(date) || "—", category: "DOB Complaint", info: [cat, status].filter(Boolean).join(" · ") || "—" });
        }
        for (const l of litigations as Record<string, unknown>[]) {
          const n = l.normalizedJson as Record<string, unknown> | undefined;
          const date = (n?.findingDate ?? n?.finding_date ?? "") as string;
          const caseType = (n?.caseType ?? n?.case_type ?? "") as string;
          const status = (n?.caseStatus ?? n?.case_status ?? "") as string;
          rows.push({ date: formatDateOnly(date) || "—", category: "Housing Litigation", info: [caseType, status].filter(Boolean).join(" · ") || "—" });
        }
        rows.sort((a, b) => (b.date === "—" ? -1 : a.date === "—" ? 1 : b.date.localeCompare(a.date)));
        setUnifiedRows(rows);
        setUnifiedFetched(true);
      })
      .finally(() => setUnifiedLoading(false));
  };

  const hasListing = primaryListing && primaryListing !== "loading";
  const listingForDisplay = hasListing ? primaryListing : null;
  const extra = listingForDisplay?.extra as Record<string, unknown> | undefined;
  const photoUrls = (listingForDisplay?.imageUrls?.length ? listingForDisplay.imageUrls : Array.isArray(extra?.images) ? (extra!.images as string[]).filter((u): u is string => typeof u === "string") : []) ?? [];
  const floorplanUrls = (Array.isArray(extra?.floorplans) ? (extra.floorplans as string[]).filter((u): u is string => typeof u === "string") : []) ?? [];
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  return (
    <div className="property-detail-collapsible" style={{ paddingLeft: "1.5rem", borderLeft: "3px solid #e5e5e5" }}>
      {/* Linked listing — single header row, since there should only be one per canonical property */}
      {primaryListing !== "loading" && listingForDisplay && (
        <div className="linked-listing-bar">
          <div className="linked-listing-bar-inner">
            <div className="property-metric">
              <div className="property-metric-label">Listing ID</div>
              <div className="property-metric-value">{listingForDisplay.externalId}</div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Source</div>
              <div className="property-metric-value">
                {listingForDisplay.source === "streeteasy" ? "Streeteasy" : listingForDisplay.source}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Raw address</div>
              <div className="property-metric-value">{fullAddress(listingForDisplay)}</div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Listed date</div>
              <div className="property-metric-value">{formatListedDate(listingForDisplay.listedAt)}</div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Days on market</div>
              <div className="property-metric-value">
                {daysOnMarket(listingForDisplay.listedAt) != null ? `${daysOnMarket(listingForDisplay.listedAt)} days` : "—"}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Dup. conf.</div>
              <div
                className="property-metric-value"
                style={{
                  color:
                    (listingForDisplay.duplicateScore ?? 0) >= 80
                      ? "#b91c1c"
                      : (listingForDisplay.duplicateScore ?? 0) <= 20
                        ? "#15803d"
                        : "#854d0e",
                }}
              >
                {listingForDisplay.duplicateScore != null ? listingForDisplay.duplicateScore : "—"}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Price / history</div>
              <div className="property-metric-value">
                {listingForDisplay.priceHistory?.length
                  ? `${listingForDisplay.priceHistory.length} entries`
                  : formatPrice(listingForDisplay.price)}
              </div>
            </div>
            <div className="property-metric">
              <div className="property-metric-label">Link</div>
              <div className="property-metric-value">
                {listingForDisplay.url && listingForDisplay.url !== "#" ? (
                  <a href={listingForDisplay.url} target="_blank" rel="noopener noreferrer">
                    view source
                  </a>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1. Photos / floor plans — side by side, same layout as raw listings */}
      <CollapsibleSection
        id="photos-floorplans"
        title="Photos / floor plans"
        count={photoUrls.length + floorplanUrls.length}
        open={!!openSections.photosFloorplans}
        onToggle={() => toggle("photosFloorplans")}
      >
        {primaryListing === "loading" ? (
          <p style={{ color: "#737373" }}>Loading listing…</p>
        ) : photoUrls.length > 0 || floorplanUrls.length > 0 ? (
          <div className="property-detail-media-columns" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              {photoUrls.length > 0 ? (
                <div className="property-card-gallery-wrap">
                  <div className="property-card-gallery">
                    <a href={photoUrls[galleryIndex]} target="_blank" rel="noopener noreferrer" className="property-card-gallery-main-wrap">
                      <img key={galleryIndex} src={photoUrls[galleryIndex]} alt="" className="property-card-gallery-main" />
                    </a>
                    <div className="property-card-gallery-thumbs">
                      {photoUrls.map((src, i) => (
                        <button key={i} type="button" onClick={() => setGalleryIndex(i)} className={`property-card-gallery-thumb-wrap ${i === galleryIndex ? "property-card-gallery-thumb-wrap--active" : ""}`}>
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
                    <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="property-card-photo-wrap">
                      <img src={src} alt="" loading="lazy" className="property-card-photo" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="property-detail-text" style={{ color: "#737373" }}>No floor plans</p>
              )}
            </div>
          </div>
        ) : (
          <p style={{ color: "#737373" }}>No linked listing or no media. Add raw listings and link to this property.</p>
        )}
      </CollapsibleSection>

      {/* 2. Initial property info: same as raw (details, broker, amenities, price history) + Geospatial data */}
      <CollapsibleSection
        id="details-broker-amenities-price-history"
        title="Initial property info"
        open={!!openSections.detailsBrokerAmenitiesPriceHistory}
        onToggle={() => toggle("detailsBrokerAmenitiesPriceHistory")}
      >
        <div className="initial-info-grid">
          <div className="initial-info-card initial-info-card--details">
            <h4 className="initial-info-subtitle">Details</h4>
            {listingForDisplay && (
              <>
                <div className="initial-info-price">{formatPrice(listingForDisplay.price)}</div>
                <div className="initial-info-listing-meta">
                  <span>Listed {formatListedDate(listingForDisplay.listedAt)}</span>
                  {daysOnMarket(listingForDisplay.listedAt) != null && (
                    <span> · {daysOnMarket(listingForDisplay.listedAt)} days on market</span>
                  )}
                </div>
                {(extra?.priceChangeSinceListed as { listedPrice: number; currentPrice: number; changeAmount: number; changePercent: number } | undefined) && (() => {
                  const p = extra!.priceChangeSinceListed as { listedPrice: number; currentPrice: number; changeAmount: number; changePercent: number };
                  const isDecrease = p.changeAmount < 0;
                  const isIncrease = p.changeAmount > 0;
                  return (
                    <div className="initial-info-price-change">
                      <span>Listed at {formatPrice(p.listedPrice)}</span>
                      {p.changeAmount === 0 ? (
                        <span> — No change</span>
                      ) : (
                        <span className={isDecrease ? "initial-info-price-change--down" : "initial-info-price-change--up"}>
                          {" → "}{isDecrease ? "−" : "+"}{formatPrice(Math.abs(p.changeAmount))} ({isDecrease ? "" : "+"}{p.changePercent.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  );
                })()}
                <dl className="initial-info-dl">
                  <div className="initial-info-dl-row"><dt>Beds / Baths</dt><dd>{listingForDisplay.beds ?? "—"} / {listingForDisplay.baths ?? "—"}</dd></div>
                  <div className="initial-info-dl-row"><dt>Sqft</dt><dd>{listingForDisplay.sqft ?? "—"}</dd></div>
                  <div className="initial-info-dl-row"><dt>Property type</dt><dd>{formatPropertyType(extra?.propertyType ?? extra?.property_type ?? extra?.type ?? "")}</dd></div>
                  {(extra?.builtIn ?? extra?.built_in ?? extra?.yearBuilt) != null && <div className="initial-info-dl-row"><dt>Built</dt><dd>{String(extra?.builtIn ?? extra?.built_in ?? extra?.yearBuilt)}</dd></div>}
                  {(monthlyHoa != null || monthlyTax != null) && (
                    <div className="initial-info-dl-row">
                      <dt>HOA / Tax</dt>
                      <dd>
                        {(monthlyHoa == null || monthlyHoa === 0) ? "NA" : formatPrice(monthlyHoa)} / {(monthlyTax == null || monthlyTax === 0) ? "NA" : formatPrice(monthlyTax)}
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            )}
            {!listingForDisplay && primaryListing === "loading" && <p className="initial-info-empty">Loading listing…</p>}
            {!listingForDisplay && primaryListing !== "loading" && <p className="initial-info-empty">No linked listing.</p>}
            <h4 className="initial-info-subtitle">Geospatial data</h4>
            <div className="initial-info-geo">
              {bbl != null && <dl className="initial-info-dl"><div className="initial-info-dl-row"><dt>BBL (tax)</dt><dd>{String(bbl)}</dd></div></dl>}
              {bblBase != null && <dl className="initial-info-dl"><div className="initial-info-dl-row"><dt>BBL (base)</dt><dd>{String(bblBase)}</dd></div></dl>}
              {(lat != null && lon != null) && (
                <dl className="initial-info-dl">
                  <div className="initial-info-dl-row">
                    <dt>Location</dt>
                    <dd>
                      <a className="initial-info-geo-link" href={`https://www.google.com/maps?q=${lat},${lon}`} target="_blank" rel="noopener noreferrer">{String(lat)}, {String(lon)}</a>
                    </dd>
                  </div>
                </dl>
              )}
              {bbl == null && bblBase == null && lat == null && lon == null && <p className="initial-info-empty">—</p>}
            </div>
          </div>
          <div className="initial-info-card">
            <h4 className="initial-info-subtitle">Broker / Agent</h4>
            {listingForDisplay?.agentEnrichment?.length ? (
              <ul className="initial-info-broker-list">
                {listingForDisplay.agentEnrichment.map((e, i) => (
                  <li key={i}>
                    <span className="initial-info-broker-name">{e.name}</span>
                    <span className="initial-info-broker-meta">
                      {e.firm && <span>{e.firm}</span>}
                      <span className={!e.email && !e.phone ? "initial-info-broker-contact-missing" : ""}>
                        {e.firm && " · "}
                        Email: {e.email ?? "—"} · Phone: {e.phone ?? "—"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : listingForDisplay?.agentNames?.length ? (
              <p style={{ margin: 0, color: "#0f172a", fontSize: "0.875rem" }}>{listingForDisplay.agentNames.join(", ")}</p>
            ) : (
              <p className="initial-info-empty">—</p>
            )}
          </div>
          <div className="initial-info-card">
            <h4 className="initial-info-subtitle">Amenities</h4>
            {listingForDisplay && Array.isArray(extra?.amenities) && (extra!.amenities as string[]).length > 0 ? (
              <ul className="initial-info-amenities-pills">
                {(extra!.amenities as string[]).map((a, i) => (
                  <li key={i}>{String(a).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</li>
                ))}
              </ul>
            ) : (
              <p className="initial-info-empty">From linked listing when available.</p>
            )}
          </div>
          {(listingForDisplay?.priceHistory?.length ?? 0) > 0 && (
            <div className="initial-info-card initial-info-card--price-history">
              <h4 className="initial-info-subtitle">Price history</h4>
              <div className="initial-info-price-history-list">
                {listingForDisplay!.priceHistory!.map((r, i) => (
                  <div key={i} className="initial-info-price-history-row">
                    <span className="initial-info-price-history-date">{formatPriceHistoryDate(r.date)}</span>
                    <span className="initial-info-price-history-sep">·</span>
                    <span className="initial-info-price-history-price">{formatPriceCompact(r.price)}</span>
                    <span className="initial-info-price-history-sep">·</span>
                    <span className="initial-info-price-history-event">{formatPriceEventLabel(r.event)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {listingForDisplay?.description && (
            <div className="initial-info-card initial-info-card--description">
              <h4 className="initial-info-subtitle">Description</h4>
              <div className="initial-info-description-wrap property-card-description-wrap">
                <p
                  className={`property-card-description ${descriptionExpanded ? "property-card-description--expanded" : ""}`}
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {listingForDisplay.description}
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

      {/* 3. Owner information */}
      <CollapsibleSection id="owner" title="Owner information" open={!!openSections.owner} onToggle={() => toggle("owner")}>
        {ownerInfo != null && String(ownerInfo).trim() ? (
          <p style={{ margin: 0, fontSize: "0.875rem" }}>{String(ownerInfo)}</p>
        ) : ps && Boolean(ps.owner_name ?? ps.owner_business_name) ? (
          <div style={{ fontSize: "0.875rem" }}>
            {Boolean(ps.owner_name) && <div><strong>Owner:</strong> {String(ps.owner_name)}</div>}
            {Boolean(ps.owner_business_name) && <div><strong>Business:</strong> {String(ps.owner_business_name)}</div>}
          </div>
        ) : ownerFromPermits && (ownerFromPermits.owner_name || ownerFromPermits.owner_business_name) ? (
          <div style={{ fontSize: "0.875rem" }}>
            {ownerFromPermits.owner_name && <div><strong>Owner:</strong> {ownerFromPermits.owner_name}</div>}
            {ownerFromPermits.owner_business_name && <div><strong>Business:</strong> {ownerFromPermits.owner_business_name}</div>}
          </div>
        ) : (
          <p style={{ color: "#737373", margin: 0 }}>—</p>
        )}
      </CollapsibleSection>

      {/* 5. Rental pricing / OM */}
      <CollapsibleSection id="rental-om" title="Rental pricing / OM" open={!!openSections.rentalOm} onToggle={() => toggle("rentalOm")}>
        {omFurnishedPricing != null && String(omFurnishedPricing).trim() ? (
          <p style={{ margin: 0, fontSize: "0.875rem" }}>{String(omFurnishedPricing)}</p>
        ) : listingForDisplay?.rentalPriceHistory?.length ? (
          <div className="initial-info-price-history-list">
            {listingForDisplay.rentalPriceHistory.slice(0, 10).map((r, i) => (
              <div key={i} className="initial-info-price-history-row">
                <span className="initial-info-price-history-date">{formatPriceHistoryDate(r.date)}</span>
                <span className="initial-info-price-history-sep">·</span>
                <span className="initial-info-price-history-price">{formatPriceCompact(r.price)}</span>
                <span className="initial-info-price-history-sep">·</span>
                <span className="initial-info-price-history-event">{formatPriceEventLabel(r.event)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: "#737373", margin: 0 }}>—</p>
        )}
      </CollapsibleSection>

      {/* 6. Violations, complaints, permits — one table */}
      <CollapsibleSection
        id="violations-complaints-permits"
        title="Violations, complaints, permits"
        count={unifiedRows.length}
        open={!!openSections.violationsComplaintsPermits}
        onToggle={() => { toggle("violationsComplaintsPermits"); if (!unifiedFetched) fetchUnifiedTable(); }}
      >
        {unifiedLoading ? (
          <p style={{ color: "#737373" }}>Loading…</p>
        ) : unifiedRows.length === 0 ? (
          <p style={{ color: "#737373" }}>No permits, violations, complaints, or litigations on file. Open this section to load data.</p>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "7rem", minWidth: "7rem" }} />
                <col style={{ width: "8rem", minWidth: "8rem" }} />
                <col style={{ width: "auto" }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                  <th style={{ textAlign: "left", padding: "0.5rem 0.75rem 0.5rem 0" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Category</th>
                  <th style={{ textAlign: "left", padding: "0.5rem 0 0.5rem 0.75rem" }}>Info</th>
                </tr>
              </thead>
              <tbody>
                {unifiedRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "0.5rem 0.75rem 0.5rem 0", whiteSpace: "nowrap", verticalAlign: "top" }}>{row.date}</td>
                    <td style={{ padding: "0.5rem 0.75rem", verticalAlign: "top" }}>{row.category}</td>
                    <td style={{ padding: "0.5rem 0 0.5rem 0.75rem", wordBreak: "break-word", verticalAlign: "top" }}>{row.info}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
