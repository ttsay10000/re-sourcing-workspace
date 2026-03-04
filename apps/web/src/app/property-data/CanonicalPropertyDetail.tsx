"use client";

import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface CanonicalProperty {
  id: string;
  canonicalAddress: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Present when listed with ?includeListingSummary=1 for filter/sort. */
  primaryListing?: {
    price: number | null;
    listedAt: string | null;
    city: string | null;
  } | null;
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
function formatPropertyType(value: string | null | undefined | unknown): string {
  if (value == null || typeof value !== "string") return "—";
  const normalized = value.trim().replace(/_/g, " ").toLowerCase();
  if (!normalized) return "—";
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
  /** Fresh details from GET /api/properties/:id so enriched data (CO, zoning, HPD) is current after re-run. */
  const [detailsFromApi, setDetailsFromApi] = useState<Record<string, unknown> | null | undefined>(undefined);
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
  const [inquiryDocuments, setInquiryDocuments] = useState<Array<{ id: string; filename: string; contentType?: string | null; createdAt: string }> | null>(null);
  const [inquiryEmailModalOpen, setInquiryEmailModalOpen] = useState(false);
  const [inquiryDraft, setInquiryDraft] = useState<{ to: string; subject: string; body: string }>({ to: "", subject: "", body: "" });

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

  // Refetch full property when expanded so enrichment (CO, zoning, HPD) shows latest after re-run
  useEffect(() => {
    let cancelled = false;
    setDetailsFromApi(undefined);
    fetch(`${API_BASE}/api/properties/${property.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && !data?.error && data?.details != null) setDetailsFromApi(data.details as Record<string, unknown>);
        else if (!cancelled) setDetailsFromApi(null);
      })
      .catch(() => { if (!cancelled) setDetailsFromApi(null); });
    return () => { cancelled = true; };
  }, [property.id]);

  useEffect(() => {
    if (openSections.violationsComplaintsPermits && !unifiedFetched && !unifiedLoading) {
      fetchUnifiedTable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when section is open and not yet fetched
  }, [openSections.violationsComplaintsPermits, unifiedFetched, unifiedLoading]);

  useEffect(() => {
    if (!openSections.rentalOm) return;
    let cancelled = false;
    setInquiryDocuments(null);
    fetch(`${API_BASE}/api/properties/${property.id}/documents`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.documents) setInquiryDocuments(data.documents);
      })
      .catch(() => { if (!cancelled) setInquiryDocuments([]); });
    return () => { cancelled = true; };
  }, [property.id, openSections.rentalOm]);

  const toggle = (key: string) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  const d = (detailsFromApi != null && typeof detailsFromApi === "object" ? detailsFromApi : property.details) as Record<string, unknown> | null | undefined;
  const enrichment = d?.enrichment as Record<string, unknown> | undefined;
  const ps = enrichment?.permits_summary as Record<string, unknown> | undefined;
  const bbl = d?.bbl ?? d?.BBL ?? d?.buildingLotBlock;
  const bblBase = d?.bblBase ?? d?.condoBaseBbl;
  const lat = d?.lat ?? d?.latitude;
  const lon = d?.lon ?? d?.longitude;
  const monthlyHoa = d?.monthlyHoa ?? d?.monthly_hoa;
  const monthlyTax = d?.monthlyTax ?? d?.monthly_tax;
  const ownerInfo = d?.ownerInfo ?? d?.owner_info;
  const ownerModuleName = d?.ownerModuleName ?? d?.owner_module_name ?? null;
  const ownerModuleBusiness = d?.ownerModuleBusiness ?? d?.owner_module_business ?? null;
  const omFurnishedPricing = d?.omFurnishedPricing ?? d?.om_furnished_pricing;
  const rentalFinancials = d?.rentalFinancials as {
    rentalUnits?: Array<{ unit?: string | null; rentalPrice?: number | null; status?: string | null; sqft?: number | null; listedDate?: string | null; lastRentedDate?: string | null; beds?: number | null; baths?: number | null; images?: string[] | null; source?: string | null }> | null;
    fromLlm?: { noi?: number | null; capRate?: number | null; rentalEstimates?: string | null; rentalNumbersPerUnit?: Array<{ unit?: string; rent?: number; note?: string }> | null; otherFinancials?: string | null; dataGapSuggestions?: string | null } | null;
    source?: string | null;
    lastUpdatedAt?: string | null;
  } | null | undefined;
  const rentalUnits = rentalFinancials?.rentalUnits ?? [];
  const fromLlm = rentalFinancials?.fromLlm;

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
          const workType = (n?.workType ?? n?.work_type ?? p.workPermit ?? p.work_permit ?? raw?.work_type ?? "") as string;
          const status = (n?.status ?? p.status ?? "") as string;
          const jobDesc = (n?.jobDescription ?? n?.job_description ?? raw?.job_description ?? "") as string;
          const infoParts = [workType, status, jobDesc].filter(Boolean);
          rows.push({ date: formatDateOnly(date) || "—", category: "Permit", info: infoParts.join(" · ") || "—" });
          if (!firstOwner && (raw || n)) {
            const r = raw ?? n ?? {};
            const on = (r.owner_name ?? r.owner_business_name) ? { owner_name: String(r.owner_name ?? "").trim() || undefined, owner_business_name: String(r.owner_business_name ?? "").trim() || undefined } : null;
            if (on && (on.owner_name || on.owner_business_name)) firstOwner = on;
          }
        }
        setOwnerFromPermits(firstOwner);
        for (const v of violations as Record<string, unknown>[]) {
          const n = v.normalizedJson as Record<string, unknown> | undefined;
          const raw = v.rawJson as Record<string, unknown> | undefined;
          const date = (n?.approvedDate ?? "") as string;
          const cls = (n?.class ?? "") as string;
          const status = (n?.currentStatus ?? n?.current_status ?? "") as string;
          const desc = (n?.novDescription ?? n?.nov_description ?? raw?.novdescription ?? raw?.nov_description ?? "") as string;
          rows.push({ date: formatDateOnly(date) || "—", category: "HPD Violation", info: [cls, status, desc].filter(Boolean).join(" · ") || "—" });
        }
        for (const c of complaints as Record<string, unknown>[]) {
          const n = c.normalizedJson as Record<string, unknown> | undefined;
          const raw = c.rawJson as Record<string, unknown> | undefined;
          const date = (n?.dateEntered ?? n?.date_entered ?? raw?.date_entered ?? "") as string;
          const cat = (n?.complaintCategory ?? n?.complaint_category ?? raw?.complaint_category ?? "") as string;
          const status = (n?.status ?? raw?.status ?? "") as string;
          const unit = (n?.unit ?? raw?.unit ?? "") as string;
          const disposition = (n?.dispositionCode ?? n?.disposition_code ?? raw?.disposition_code ?? "") as string;
          const infoParts = [cat, disposition, status, unit].filter(Boolean);
          rows.push({ date: formatDateOnly(date) || "—", category: "DOB Complaint", info: infoParts.join(" · ") || "—" });
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
  const [unitGalleryIndices, setUnitGalleryIndices] = useState<Record<number, number>>({});

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
                        {(monthlyHoa == null || monthlyHoa === 0) ? "NA" : formatPrice(typeof monthlyHoa === "number" ? monthlyHoa : null)} / {(monthlyTax == null || monthlyTax === 0) ? "NA" : formatPrice(typeof monthlyTax === "number" ? monthlyTax : null)}
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
            <h4 className="initial-info-subtitle">Enriched data</h4>
            <div className="initial-info-geo">
              <dl className="initial-info-dl">
                <div className="initial-info-dl-row"><dt>Tax code</dt><dd>{d?.taxCode != null && String(d.taxCode).trim() !== "" ? String(d.taxCode) : "—"}</dd></div>
                <div className="initial-info-dl-row"><dt>2010 Census Block</dt><dd>{d?.censusBlock2010 != null && String(d.censusBlock2010).trim() !== "" ? String(d.censusBlock2010) : "—"}</dd></div>
                {(() => {
                  const co = enrichment?.certificateOfOccupancy as Record<string, unknown> | undefined;
                  const coJobNumber = co?.jobNumber ?? co?.job_number;
                  const coStatus = co?.status ?? co?.c_of_o_status;
                  const coDate = co?.issuanceDate ?? co?.issuance_date ?? co?.c_of_o_issuance_date;
                  const coJobType = co?.jobType ?? co?.job_type;
                  const hasCo = co != null && (coJobNumber != null || coStatus != null || coDate != null || coJobType != null);
                  return (
                    <>
                      <div className="initial-info-dl-row"><dt>CO ID (job number)</dt><dd>{coJobNumber != null && String(coJobNumber).trim() !== "" ? String(coJobNumber) : "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>CO issuance date</dt><dd>{formatDateOnly(coDate as string | null | undefined) ?? "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>Certificate of occupancy</dt><dd>{coStatus != null && String(coStatus).trim() !== "" ? String(coStatus) : "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>CO job type</dt><dd>{coJobType != null && String(coJobType).trim() !== "" ? String(coJobType) : "—"}</dd></div>
                      {!hasCo && (
                        <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From certificate_of_occupancy enrichment (BBL). Run enrichment to populate.</p>
                      )}
                    </>
                  );
                })()}
                {(() => {
                  const z = enrichment?.zoning as Record<string, unknown> | undefined;
                  const zd1 = z?.zoningDistrict1 ?? z?.zoning_district_1;
                  const zd2 = z?.zoningDistrict2 ?? z?.zoning_district_2;
                  const zMap = z?.zoningMapNumber ?? z?.zoning_map_number ?? z?.zoningMapCode ?? z?.zoning_map_code;
                  const hasZoning = z != null && (zd1 != null || zd2 != null || zMap != null);
                  return (
                    <>
                      <div className="initial-info-dl-row"><dt>Zoning district</dt><dd>{[zd1, zd2].filter(Boolean).map(String).join(", ") || "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>Zoning map</dt><dd>{zMap != null && String(zMap).trim() !== "" ? String(zMap) : "—"}</dd></div>
                      {!hasZoning && (
                        <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From zoning_ztl enrichment (BBL). Run enrichment to populate.</p>
                      )}
                    </>
                  );
                })()}
                {(() => {
                  const hpd = enrichment?.hpdRegistration as Record<string, unknown> | undefined;
                  const hpdId = hpd?.registrationId ?? hpd?.registration_id;
                  const hpdDate = hpd?.lastRegistrationDate ?? hpd?.last_registration_date;
                  const hasHpd = hpd != null && (hpdId != null || hpdDate != null);
                  return (
                    <>
                      <div className="initial-info-dl-row"><dt>HPD Registration ID</dt><dd>{hpdId != null && String(hpdId).trim() !== "" ? String(hpdId) : "—"}</dd></div>
                      <div className="initial-info-dl-row"><dt>HPD Last Registration Date</dt><dd>{formatDateOnly(hpdDate as string | null | undefined) ?? "—"}</dd></div>
                      {!hasHpd && (
                        <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From hpd_registration enrichment (BBL). Run enrichment to populate.</p>
                      )}
                    </>
                  );
                })()}
              </dl>
              {!enrichment?.certificateOfOccupancy && !enrichment?.zoning && !enrichment?.hpdRegistration && (d?.taxCode == null || String(d.taxCode).trim() === "") && (
                <p className="initial-info-empty">Run enrichment to populate tax code, certificate of occupancy, zoning, and HPD registration.</p>
              )}
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

      {/* 3. Owner information: Owner module (Phase 1 / PLUTO) + Permit module (permits_summary) */}
      <CollapsibleSection id="owner" title="Owner information" open={!!openSections.owner} onToggle={() => toggle("owner")}>
        <div style={{ fontSize: "0.875rem" }}>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", marginBottom: "0.25rem" }}>Owner module: name, business</strong>
            <div><strong>Name:</strong> {ownerModuleName != null && String(ownerModuleName).trim() !== "" ? String(ownerModuleName).trim() : "—"}</div>
            <div><strong>Business:</strong> {ownerModuleBusiness != null && String(ownerModuleBusiness).trim() !== "" ? String(ownerModuleBusiness).trim() : "—"}</div>
          </div>
          <div>
            <strong style={{ display: "block", marginBottom: "0.25rem" }}>Permit module: name, business</strong>
            <div><strong>Name:</strong> {ps?.owner_name != null && String(ps.owner_name).trim() !== "" ? String(ps.owner_name).trim() : "—"}</div>
            <div><strong>Business:</strong> {ps?.owner_business_name != null && String(ps.owner_business_name).trim() !== "" ? String(ps.owner_business_name).trim() : "—"}</div>
          </div>
        </div>
      </CollapsibleSection>

      {/* 5. Rental pricing / OM + rental financials (per-unit table, NOI, cap rate) */}
      <CollapsibleSection id="rental-om" title="Rental pricing / OM" open={!!openSections.rentalOm} onToggle={() => toggle("rentalOm")}>
        <div style={{ fontSize: "0.875rem" }}>
          {(rentalUnits.length === 0 || (rentalUnits.length < 3 && !fromLlm)) && (
            <div style={{ marginBottom: "0.75rem" }}>
              <button
                type="button"
                onClick={() => {
                  const addressLine = property.canonicalAddress.split(",")[0]?.trim() || property.canonicalAddress;
                  const subject = "Inquiry about " + addressLine;
                  const body = "Hi,\n\nI'm a broker in NYC with a client interested in this property. Could you send over an OM and any rent roll information?\n\nThanks.";
                  const agents = listingForDisplay?.agentEnrichment ?? [];
                  const emailsWithNames = agents.map((a) => ({ email: a.email?.trim(), name: a.name })).filter((x) => x.email) as { email: string; name: string }[];
                  const firstPrimaryEmail = emailsWithNames.length > 0 ? emailsWithNames[0].email : "";
                  setInquiryDraft({ to: firstPrimaryEmail, subject, body });
                  setInquiryEmailModalOpen(true);
                }}
                style={{ padding: "0.35rem 0.6rem", backgroundColor: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px", fontSize: "0.8rem", color: "#333", cursor: "pointer" }}
              >
                Request info / OM by email &amp; track reply
              </button>
              <p style={{ margin: "0.25rem 0 0", color: "#737373", fontSize: "0.75rem" }}>
                Opens a draft to review. Use the subject line so replies are matched to this property. Process-inbox runs daily to attach replies and documents here.
              </p>
            </div>
          )}
          {inquiryEmailModalOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }} onClick={() => setInquiryEmailModalOpen(false)}>
              <div style={{ backgroundColor: "#fff", borderRadius: "8px", padding: "1.25rem", maxWidth: "520px", width: "100%", maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }} onClick={(e) => e.stopPropagation()}>
                <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Request OM / rent roll from broker</p>
                <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#555" }}>
                  <strong>This will open your email client to send an email to the listing broker</strong> requesting an OM and rent roll. The email is not sent until you send it from your email app. Review the draft below and edit if needed. Keep the subject line so replies can be matched to this property.
                </p>
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>To (broker)</label>
                  <input
                    type="text"
                    value={inquiryDraft.to}
                    onChange={(e) => setInquiryDraft((p) => ({ ...p, to: e.target.value }))}
                    placeholder="Broker email (from listing)"
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                  {!inquiryDraft.to && listingForDisplay && (
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#888" }}>No broker email on file. Add agent enrichment or enter manually.</p>
                  )}
                  {listingForDisplay?.agentEnrichment && listingForDisplay.agentEnrichment.length > 1 && (
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#666" }}>
                      Other agents: {listingForDisplay.agentEnrichment.slice(1).map((a) => a.email?.trim()).filter(Boolean).join(", ") || "—"}
                    </p>
                  )}
                </div>
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>Subject</label>
                  <input
                    type="text"
                    value={inquiryDraft.subject}
                    onChange={(e) => setInquiryDraft((p) => ({ ...p, subject: e.target.value }))}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "#555" }}>Body (editable)</label>
                  <textarea
                    value={inquiryDraft.body}
                    onChange={(e) => setInquiryDraft((p) => ({ ...p, body: e.target.value }))}
                    rows={6}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.875rem", border: "1px solid #ccc", borderRadius: "4px", resize: "vertical" }}
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setInquiryEmailModalOpen(false)} style={{ padding: "0.4rem 0.75rem", border: "1px solid #ccc", borderRadius: "4px", background: "#fff", cursor: "pointer" }}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => {
                      const { to, subject, body } = inquiryDraft;
                      const toEnc = to.trim().split(/\s*,\s*/).map((e) => encodeURIComponent(e)).join(",");
                      const mailto = toEnc ? `mailto:${toEnc}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                      window.open(mailto, "_blank", "noopener,noreferrer");
                      setInquiryEmailModalOpen(false);
                    }}
                    style={{ padding: "0.4rem 0.75rem", border: "1px solid #0066cc", borderRadius: "4px", background: "#0066cc", color: "#fff", cursor: "pointer" }}
                  >
                    Open in email client
                  </button>
                </div>
              </div>
            </div>
          )}
          {rentalUnits.length > 0 && (
            <div style={{ marginBottom: "0.75rem" }}>
              <strong style={{ display: "block", marginBottom: "0.5rem" }}>Rental units (from API / inquiry)</strong>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxHeight: "520px", overflowY: "auto" }}>
                {rentalUnits.map((row, i) => {
                  const unitImages = (row.images ?? []).filter((u): u is string => typeof u === "string");
                  const idx = unitGalleryIndices[i] ?? 0;
                  const setIdx = (n: number) => setUnitGalleryIndices((prev) => ({ ...prev, [i]: n }));
                  return (
                    <div key={i} style={{ border: "1px solid #e5e5e5", borderRadius: "6px", overflow: "hidden", backgroundColor: "#fafafa" }}>
                      {unitImages.length > 0 && (
                        <div className="property-card-gallery-wrap" style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
                          <div className="property-card-gallery" style={{ maxWidth: "100%" }}>
                            <a href={unitImages[idx]} target="_blank" rel="noopener noreferrer" className="property-card-gallery-main-wrap">
                              <img key={idx} src={unitImages[idx]} alt="" className="property-card-gallery-main" style={{ maxHeight: "180px", objectFit: "contain" }} />
                            </a>
                            <div className="property-card-gallery-thumbs" style={{ flexWrap: "wrap" }}>
                              {unitImages.map((src, j) => (
                                <button key={j} type="button" onClick={() => setIdx(j)} className={`property-card-gallery-thumb-wrap ${j === idx ? "property-card-gallery-thumb-wrap--active" : ""}`}>
                                  <img src={src} alt="" loading="lazy" className="property-card-gallery-thumb" />
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem 0.35rem 0.75rem" }}>Unit</th>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Rent</th>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Status</th>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Sq ft</th>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Beds</th>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Baths</th>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Listed</th>
                              <th style={{ textAlign: "left", padding: "0.35rem 0.5rem 0.35rem 0.75rem" }}>Last rented</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr style={{ borderBottom: "none" }}>
                              <td style={{ padding: "0.35rem 0.5rem 0.35rem 0.75rem", whiteSpace: "nowrap" }}>{row.unit ?? "—"}</td>
                              <td style={{ padding: "0.35rem 0.5rem" }}>{row.rentalPrice != null ? formatPrice(row.rentalPrice) : "—"}</td>
                              <td style={{ padding: "0.35rem 0.5rem" }}>{row.status === "sold" ? "Last rent" : row.status === "open" ? "Ask" : row.status ?? "—"}</td>
                              <td style={{ padding: "0.35rem 0.5rem" }}>{row.sqft != null && row.sqft > 0 ? String(row.sqft) : "—"}</td>
                              <td style={{ padding: "0.35rem 0.5rem" }}>{row.beds != null ? String(row.beds) : "—"}</td>
                              <td style={{ padding: "0.35rem 0.5rem" }}>{row.baths != null ? String(row.baths) : "—"}</td>
                              <td style={{ padding: "0.35rem 0.5rem", whiteSpace: "nowrap" }}>{row.listedDate ? formatDateOnly(row.listedDate) : "—"}</td>
                              <td style={{ padding: "0.35rem 0.5rem 0.35rem 0.75rem", whiteSpace: "nowrap" }}>{row.lastRentedDate ? formatDateOnly(row.lastRentedDate) : "—"}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {fromLlm && (fromLlm.noi != null || fromLlm.capRate != null || fromLlm.rentalEstimates || fromLlm.otherFinancials || fromLlm.dataGapSuggestions) && (
            <div style={{ marginBottom: "0.75rem" }}>
              <strong style={{ display: "block", marginBottom: "0.25rem" }}>Financials (from listing / LLM)</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem" }}>
                {fromLlm.noi != null && <span>NOI: {formatPrice(fromLlm.noi)}</span>}
                {fromLlm.capRate != null && <span>Cap rate: {fromLlm.capRate}%</span>}
              </div>
              {fromLlm.rentalEstimates && <p style={{ margin: "0.25rem 0 0", color: "#404040" }}>{fromLlm.rentalEstimates}</p>}
              {fromLlm.otherFinancials && <p style={{ margin: "0.25rem 0 0", color: "#404040" }}>{fromLlm.otherFinancials}</p>}
              {fromLlm.dataGapSuggestions && (
                <p style={{ margin: "0.5rem 0 0", padding: "0.35rem 0.5rem", backgroundColor: "#fef3c7", borderRadius: "4px", fontSize: "0.8rem", color: "#92400e" }}>
                  <strong>Possible missing data:</strong> {fromLlm.dataGapSuggestions}
                </p>
              )}
            </div>
          )}
          {inquiryDocuments && inquiryDocuments.length > 0 && (
            <div style={{ marginBottom: "0.75rem" }}>
              <strong style={{ display: "block", marginBottom: "0.25rem" }}>Documents (from inquiry replies)</strong>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
                {inquiryDocuments.map((doc) => (
                  <li key={doc.id} style={{ marginBottom: "0.2rem" }}>
                    <a
                      href={`${API_BASE}/api/properties/${property.id}/documents/${doc.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#0066cc" }}
                    >
                      {doc.filename}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {omFurnishedPricing != null && String(omFurnishedPricing).trim() ? (
            <p style={{ margin: 0 }}>{String(omFurnishedPricing)}</p>
          ) : listingForDisplay?.rentalPriceHistory?.length && rentalUnits.length === 0 && !fromLlm ? (
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
          ) : rentalUnits.length === 0 && !fromLlm ? (
            <p style={{ color: "#737373", margin: 0 }}>—</p>
          ) : null}
        </div>
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
