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

/** Normalize for DOS lookup: trim and collapse runs of whitespace so trailing spaces/weird syntax don't break matching. */
function normalizeBusinessNameForSearch(name: string | null | undefined): string {
  if (!name || typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ").trim();
}

/** True if the name looks like a corporation, LLC, limited partnership, or similar business entity. */
function isBusinessEntityName(name: string | null | undefined): boolean {
  const s = normalizeBusinessNameForSearch(name);
  if (!s) return false;
  const businessPattern = /\b(LLC|L\.?L\.?C\.?|Inc\.?|Incorporated|Corp\.?|Corporation|L\.?P\.?|Limited\s+Partnership|Ltd\.?|Co\.?|Company|P\.?C\.?|PLLC|P\.?L\.?L\.?C\.?)\s*$/i;
  return businessPattern.test(s);
}

/** NY DOS entity result from API (when owner is a business entity). */
interface NyDosEntityResult {
  filingDate: string | null;
  dosProcessName: string | null;
  dosProcessAddress: string | null;
  ceoName: string | null;
  ceoAddress: string | null;
  registeredAgentName: string | null;
  registeredAgentAddress: string | null;
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
    valuations: true,
    rentalOm: true,
    violationsComplaintsPermits: true,
  });
  const [unifiedRows, setUnifiedRows] = useState<UnifiedEnrichmentRow[]>([]);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedFetched, setUnifiedFetched] = useState(false);
  const [ownerFromPermits, setOwnerFromPermits] = useState<{ owner_name?: string; owner_business_name?: string } | null>(null);
  const [inquiryDocuments, setInquiryDocuments] = useState<Array<{ id: string; filename: string; source?: string | null; createdAt: string }> | null>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<Array<{ id: string; filename: string; category: string; source?: string | null; createdAt: string }> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [inquiryEmailModalOpen, setInquiryEmailModalOpen] = useState(false);
  const [inquiryDraft, setInquiryDraft] = useState<{ to: string; subject: string; body: string }>({ to: "", subject: "", body: "" });
  const [inquirySending, setInquirySending] = useState(false);
  const [inquirySendError, setInquirySendError] = useState<string | null>(null);
  const [inquirySendSuccess, setInquirySendSuccess] = useState<string | null>(null);
  const [lastInquirySentAt, setLastInquirySentAt] = useState<string | null>(null);
  const [sendAnotherConfirm, setSendAnotherConfirm] = useState(false);
  const [dosEntityLoading, setDosEntityLoading] = useState(false);
  const [dosEntity, setDosEntity] = useState<NyDosEntityResult | "n/a" | null>(null);
  const [dosEntityQueryName, setDosEntityQueryName] = useState<string | null>(null);

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
        if (!cancelled && !data?.error) {
          if (data?.details != null) setDetailsFromApi(data.details as Record<string, unknown>);
          else setDetailsFromApi(null);
          setLastInquirySentAt(data?.lastInquirySentAt ?? null);
        } else if (!cancelled) {
          setDetailsFromApi(null);
        }
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
    setUploadedDocuments(null);
    fetch(`${API_BASE}/api/properties/${property.id}/documents`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.documents) setInquiryDocuments(data.documents);
      })
      .catch(() => { if (!cancelled) setInquiryDocuments([]); });
    fetch(`${API_BASE}/api/properties/${property.id}/uploaded-documents`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.documents) setUploadedDocuments(data.documents);
      })
      .catch(() => { if (!cancelled) setUploadedDocuments([]); });
    return () => { cancelled = true; };
  }, [property.id, openSections.rentalOm]);

  // When owner section has a business-like name (from owner module or permit data), fetch NY DOS entity details
  useEffect(() => {
    const d = (detailsFromApi != null && typeof detailsFromApi === "object" ? detailsFromApi : property.details) as Record<string, unknown> | null | undefined;
    const enrichment = d?.enrichment as Record<string, unknown> | undefined;
    const ps = enrichment?.permits_summary as Record<string, unknown> | undefined;
    const modName = d?.ownerModuleName ?? d?.owner_module_name;
    const modBiz = d?.ownerModuleBusiness ?? d?.owner_module_business;
    const permName = ps?.owner_name;
    const permBiz = ps?.owner_business_name;
    const candidates = [
      modBiz != null ? normalizeBusinessNameForSearch(String(modBiz)) : "",
      permBiz != null ? normalizeBusinessNameForSearch(String(permBiz)) : "",
      modName != null ? normalizeBusinessNameForSearch(String(modName)) : "",
      permName != null ? normalizeBusinessNameForSearch(String(permName)) : "",
    ].filter(Boolean);
    const businessName = candidates.find((c) => isBusinessEntityName(c)) ?? null;

    if (!businessName) {
      setDosEntityQueryName(null);
      setDosEntity("n/a");
      return;
    }
    if (businessName === dosEntityQueryName) return; // already fetched or loading for this name
    setDosEntityQueryName(businessName);
    setDosEntity(null);
    setDosEntityLoading(true);
    let cancelled = false;
    const controller = new AbortController();
    const timeoutMs = 25_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    fetch(`${API_BASE}/api/properties/ny-dos-entity?name=${encodeURIComponent(businessName)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDosEntity(data?.entity ?? "n/a");
      })
      .catch(() => { if (!cancelled) setDosEntity("n/a"); })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setDosEntityLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
      setDosEntityLoading(false);
    };
  }, [detailsFromApi, property.details, property.id, dosEntityQueryName]);

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
  const ownerValuations = (d?.ownerValuations ?? d?.owner_valuations) as string | null | undefined;
  const assessedMarketValue = (d?.assessedMarketValue ?? d?.assessed_market_value) as number | null | undefined;
  const assessedActualValue = (d?.assessedActualValue ?? d?.assessed_actual_value) as number | null | undefined;
  const assessedTaxBeforeTotal = (d?.assessedTaxBeforeTotal ?? d?.assessed_tax_before_total) as number | null | undefined;
  const assessedGrossSqft = (d?.assessedGrossSqft ?? d?.assessed_gross_sqft) as number | null | undefined;
  const assessedLandArea = (d?.assessedLandArea ?? d?.assessed_land_area) as number | null | undefined;
  const assessedResidentialAreaGross = (d?.assessedResidentialAreaGross ?? d?.assessed_residential_area_gross) as number | null | undefined;
  const assessedOfficeAreaGross = (d?.assessedOfficeAreaGross ?? d?.assessed_office_area_gross) as number | null | undefined;
  const assessedRetailAreaGross = (d?.assessedRetailAreaGross ?? d?.assessed_retail_area_gross) as number | null | undefined;
  const assessedApptDate = (d?.assessedApptDate ?? d?.assessed_appt_date) as string | null | undefined;
  const assessedExtractDate = (d?.assessedExtractDate ?? d?.assessed_extract_date) as string | null | undefined;

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
          <div className="initial-info-right-col">
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
          </div>
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

      {/* 3. Owner information: Owner module (Phase 1 / PLUTO) + Permit module (permits_summary) + NY DOS entity when business-like */}
      <CollapsibleSection id="owner" title="Owner information" open={!!openSections.owner} onToggle={() => toggle("owner")}>
        <div style={{ fontSize: "0.875rem" }}>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", marginBottom: "0.25rem" }}>Owner module: name, business</strong>
            <div><strong>Name:</strong> {ownerModuleName != null && String(ownerModuleName).trim() !== "" ? String(ownerModuleName).trim() : "—"}</div>
            <div><strong>Business:</strong> {ownerModuleBusiness != null && String(ownerModuleBusiness).trim() !== "" ? String(ownerModuleBusiness).trim() : "—"}</div>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", marginBottom: "0.25rem" }}>Permit module: name, business</strong>
            <div><strong>Name:</strong> {ps?.owner_name != null && String(ps.owner_name).trim() !== "" ? String(ps.owner_name).trim() : "—"}</div>
            <div><strong>Business:</strong> {ps?.owner_business_name != null && String(ps.owner_business_name).trim() !== "" ? String(ps.owner_business_name).trim() : "—"}</div>
          </div>
          {ownerValuations != null && String(ownerValuations).trim() !== "" && (
            <div style={{ marginBottom: "0.75rem" }}>
              <strong style={{ display: "block", marginBottom: "0.25rem" }}>Owner (Valuations module)</strong>
              <div>{String(ownerValuations).trim()}</div>
            </div>
          )}
          {/* NY DOS entity details when owner name looks like LLC, Corp, etc. */}
          <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e5e5" }}>
            <strong style={{ display: "block", marginBottom: "0.35rem" }}>NY DOS entity details</strong>
            {!dosEntityQueryName && dosEntity === "n/a" && (
              <p style={{ margin: 0, color: "#737373" }}>N/A — Owner name does not appear to be a corporation, LLC, or similar entity.</p>
            )}
            {dosEntityQueryName && dosEntityLoading && (
              <p style={{ margin: 0, color: "#737373" }}>Loading…</p>
            )}
            {dosEntityQueryName && !dosEntityLoading && dosEntity === "n/a" && (
              <p style={{ margin: 0, color: "#737373" }}>No matching entity found in NY DOS for &quot;{dosEntityQueryName}&quot;.</p>
            )}
            {dosEntityQueryName && !dosEntityLoading && dosEntity !== null && dosEntity !== "n/a" && (
              <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                <li><strong>Filing date:</strong> {dosEntity.filingDate ?? "N/A"}</li>
                <li>
                  <strong>DOS process:</strong> {dosEntity.dosProcessName ?? "N/A"}
                  {dosEntity.dosProcessAddress && (
                    <ul style={{ margin: "0.15rem 0 0", paddingLeft: "1rem" }}>
                      <li>{dosEntity.dosProcessAddress}</li>
                    </ul>
                  )}
                </li>
                <li>
                  <strong>CEO:</strong> {dosEntity.ceoName ?? "N/A"}
                  {dosEntity.ceoAddress && (
                    <ul style={{ margin: "0.15rem 0 0", paddingLeft: "1rem" }}>
                      <li>{dosEntity.ceoAddress}</li>
                    </ul>
                  )}
                </li>
                <li>
                  <strong>Registered agent:</strong> {dosEntity.registeredAgentName ?? "N/A"}
                  {dosEntity.registeredAgentAddress && (
                    <ul style={{ margin: "0.15rem 0 0", paddingLeft: "1rem" }}>
                      <li>{dosEntity.registeredAgentAddress}</li>
                    </ul>
                  )}
                </li>
              </ul>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* 4. Valuations (assessment): market value, assessed value, tax before total, sqft/area, dates */}
      <CollapsibleSection id="valuations" title="Valuations (assessment)" open={!!openSections.valuations} onToggle={() => toggle("valuations")}>
        <div style={{ fontSize: "0.875rem" }}>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Market value (curmkttot):</strong> {assessedMarketValue != null ? `$${Number(assessedMarketValue).toLocaleString()}` : "—"}</li>
            <li><strong>Actual assessed (curacttot):</strong> {assessedActualValue != null ? `$${Number(assessedActualValue).toLocaleString()}` : "—"}</li>
            <li><strong>Tax before total (curtxbtot):</strong> {assessedTaxBeforeTotal != null ? `$${Number(assessedTaxBeforeTotal).toLocaleString()}` : "—"}</li>
          </ul>
          <strong style={{ display: "block", marginBottom: "0.25rem" }}>Area (sqft)</strong>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Gross sqft:</strong> {assessedGrossSqft != null ? Number(assessedGrossSqft).toLocaleString() : "—"}</li>
            <li><strong>Land area:</strong> {assessedLandArea != null ? Number(assessedLandArea).toLocaleString() : "—"}</li>
            <li><strong>Residential area gross:</strong> {assessedResidentialAreaGross != null ? Number(assessedResidentialAreaGross).toLocaleString() : "—"}</li>
            <li><strong>Office area gross:</strong> {assessedOfficeAreaGross != null ? Number(assessedOfficeAreaGross).toLocaleString() : "—"}</li>
            <li><strong>Retail area gross:</strong> {assessedRetailAreaGross != null ? Number(assessedRetailAreaGross).toLocaleString() : "—"}</li>
          </ul>
          <strong style={{ display: "block", marginBottom: "0.25rem" }}>Dates</strong>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li><strong>Appt date:</strong> {assessedApptDate != null && String(assessedApptDate).trim() !== "" ? formatDateOnly(assessedApptDate) ?? String(assessedApptDate) : "—"}</li>
            <li><strong>Extract date (extracrdt):</strong> {assessedExtractDate != null && String(assessedExtractDate).trim() !== "" ? formatDateOnly(assessedExtractDate) ?? String(assessedExtractDate) : "—"}</li>
          </ul>
          {assessedMarketValue == null && assessedActualValue == null && assessedTaxBeforeTotal == null && assessedGrossSqft == null && assessedLandArea == null && assessedResidentialAreaGross == null && assessedOfficeAreaGross == null && assessedRetailAreaGross == null && (assessedApptDate == null || String(assessedApptDate).trim() === "") && (assessedExtractDate == null || String(assessedExtractDate).trim() === "") && (
            <p className="initial-info-empty" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>From valuations enrichment (BBL). Run enrichment to populate.</p>
          )}
        </div>
      </CollapsibleSection>

      {/* 5. Rental pricing / OM + rental financials (per-unit table, NOI, cap rate) */}
      <CollapsibleSection id="rental-om" title="Rental pricing / OM" open={!!openSections.rentalOm} onToggle={() => toggle("rentalOm")}>
        <div style={{ fontSize: "0.875rem" }}>
          {/* Request info by email — always first */}
          <div style={{ marginBottom: "0.75rem" }}>
            <strong style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.9rem", color: "#1a1a1a" }}>Request info by email</strong>
            {lastInquirySentAt && (
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "#166534", fontWeight: 500 }}>
                Last inquiry sent: {formatDateOnly(lastInquirySentAt) ?? lastInquirySentAt}
              </p>
            )}
            {inquirySendSuccess && (
              <p style={{ margin: "0 0 0.5rem", padding: "0.4rem 0.6rem", backgroundColor: "#dcfce7", border: "1px solid #22c55e", borderRadius: "6px", fontSize: "0.875rem", color: "#166534" }}>
                {inquirySendSuccess}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                const addressLine = property.canonicalAddress.split(",")[0]?.trim() || property.canonicalAddress;
                const subject = "Inquiry about " + addressLine;
                const agents = listingForDisplay?.agentEnrichment ?? [];
                const emailsWithNames = agents.map((a) => ({ email: a.email?.trim(), name: a.name })).filter((x) => x.email) as { email: string; name: string }[];
                const firstPrimary = emailsWithNames[0];
                const brokerFirstName = firstPrimary?.name?.trim()
                  ? firstPrimary.name.trim().split(/\s+/)[0] ?? "[Broker Name]"
                  : "[Broker Name]";
                const body = `Hi ${brokerFirstName},

My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the property at ${addressLine} currently on the market. We are evaluating the building and would appreciate the opportunity to review further.

Would you be able to share the OM, current rent roll, expenses, and/or any available financials?

Thanks in advance - looking forward to taking a look.

Best,
Tyler Tsay
617 306 3336
tyler@stayhaus.co`;
                setInquiryDraft({ to: firstPrimary?.email ?? "", subject, body });
                setInquirySendError(null);
                setSendAnotherConfirm(false);
                setInquiryEmailModalOpen(true);
              }}
              style={{ padding: "0.35rem 0.6rem", backgroundColor: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px", fontSize: "0.8rem", color: "#333", cursor: "pointer" }}
            >
              {lastInquirySentAt ? "Send another inquiry" : "Request info / OM by email & track reply"}
            </button>
            <p style={{ margin: "0.25rem 0 0", color: "#737373", fontSize: "0.75rem" }}>
              Review the draft and click Send to email the broker. Use the subject line so replies are matched to this property. Replies and attachments appear in <strong>Documents (from inquiry replies)</strong> below after the daily process-inbox cron runs.
            </p>
          </div>
          {inquiryEmailModalOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }} onClick={() => setInquiryEmailModalOpen(false)}>
              <div style={{ backgroundColor: "#fff", borderRadius: "8px", padding: "1.25rem", maxWidth: "520px", width: "100%", maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }} onClick={(e) => e.stopPropagation()}>
                <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Request OM / rent roll from broker</p>
                {lastInquirySentAt && (
                  <p style={{ margin: "0 0 0.75rem", padding: "0.5rem 0.6rem", backgroundColor: "#fef3c7", border: "1px solid #f59e0b", borderRadius: "6px", fontSize: "0.8rem", color: "#92400e" }}>
                    An inquiry was already sent on {formatDateOnly(lastInquirySentAt) ?? lastInquirySentAt}. Sending again may result in duplicate emails to the broker.
                  </p>
                )}
                <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#555" }}>
                  Review the draft below and edit if needed (e.g. add your phone and email in the signature). Click <strong>Send email</strong> to send from your connected Gmail. Keep the subject line so replies can be matched to this property.
                </p>
                {inquirySendError && <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "#b91c1c" }}>{inquirySendError}</p>}
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
                {lastInquirySentAt && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.875rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={sendAnotherConfirm}
                        onChange={(e) => setSendAnotherConfirm(e.target.checked)}
                      />
                      Send another inquiry anyway (I understand this may duplicate emails)
                    </label>
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => { setInquiryEmailModalOpen(false); setInquirySendError(null); }} style={{ padding: "0.4rem 0.75rem", border: "1px solid #ccc", borderRadius: "4px", background: "#fff", cursor: "pointer" }}>Cancel</button>
                  <button
                    type="button"
                    disabled={Boolean(inquirySending || !inquiryDraft.to?.trim() || (lastInquirySentAt && !sendAnotherConfirm))}
                    onClick={async () => {
                      setInquirySendError(null);
                      setInquirySending(true);
                      try {
                        const res = await fetch(`${API_BASE}/api/properties/${property.id}/send-inquiry-email`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ to: inquiryDraft.to.trim(), subject: inquiryDraft.subject, body: inquiryDraft.body }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          const msg = typeof data?.details === "string" ? data.details : typeof data?.error === "string" ? data.error : "Failed to send";
                          throw new Error(msg);
                        }
                        setLastInquirySentAt(data.sentAt ?? null);
                        setInquirySendSuccess("Email sent successfully.");
                        setInquiryEmailModalOpen(false);
                        setTimeout(() => setInquirySendSuccess(null), 4000);
                      } catch (e) {
                        setInquirySendError(e instanceof Error ? e.message : "Failed to send email");
                      } finally {
                        setInquirySending(false);
                      }
                    }}
                    style={{ padding: "0.4rem 0.75rem", border: "1px solid #0066cc", borderRadius: "4px", background: inquirySending ? "#94a3b8" : "#0066cc", color: "#fff", cursor: inquirySending ? "wait" : "pointer" }}
                  >
                    {inquirySending ? "Sending…" : "Send email"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {rentalUnits.length > 0 && (
            <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: "0.6rem", marginTop: "0.6rem", marginBottom: "0.5rem" }}>
              <strong style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.95rem", color: "#1a1a1a" }}>Rental units (from API / inquiry)</strong>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "520px", overflowY: "auto" }}>
                {rentalUnits.map((row, i) => {
                  const unitImages = (row.images ?? []).filter((u): u is string => typeof u === "string");
                  const idx = unitGalleryIndices[i] ?? 0;
                  const setIdx = (n: number) => setUnitGalleryIndices((prev) => ({ ...prev, [i]: n }));
                  const bulletStyle = { margin: "0.2rem 0", fontSize: "0.85rem", color: "#404040" };
                  return (
                    <div key={i} style={{ border: "1px solid #e5e5e5", borderRadius: "8px", overflow: "hidden", backgroundColor: "#fafafa", display: "flex", flexDirection: "row", alignItems: "stretch", minHeight: "120px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                      {/* Unit info: bold unit name + 2 columns of bullets (no Status) */}
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0.5rem 0.75rem", justifyContent: "center", gap: "0.35rem", minWidth: 0, borderRight: "1px solid #eee" }}>
                        <strong style={{ fontSize: "0.95rem", color: "#1a1a1a", marginBottom: "0.2rem" }}>Unit #{row.unit ?? String(i + 1)}</strong>
                        <div style={{ display: "flex", flexDirection: "row", flexWrap: "nowrap", gap: "2rem", fontSize: "0.85rem" }}>
                          <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc", flexShrink: 0 }}>
                            <li style={bulletStyle}>Sq ft: {row.sqft != null && row.sqft > 0 ? String(row.sqft) : "—"}</li>
                            <li style={bulletStyle}>Beds: {row.beds != null ? String(row.beds) : "—"}</li>
                            <li style={bulletStyle}>Baths: {row.baths != null ? String(row.baths) : "—"}</li>
                          </ul>
                          <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc", flexShrink: 0 }}>
                            <li style={bulletStyle}>Rent (latest): {row.rentalPrice != null ? formatPrice(row.rentalPrice) : "—"}</li>
                            <li style={bulletStyle}>Last listed: {row.listedDate ? formatDateOnly(row.listedDate) : "—"}</li>
                            <li style={bulletStyle}>Last rented: {row.lastRentedDate ? formatDateOnly(row.lastRentedDate) : "—"}</li>
                          </ul>
                        </div>
                      </div>
                      {/* Photos: main left, thumbnails right (contained on right) */}
                      <div style={{ flexShrink: 0, display: "flex", flexDirection: "row", padding: "0.35rem", gap: "0.35rem" }}>
                        {unitImages.length > 0 ? (
                          <>
                            <a href={unitImages[idx]} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, display: "block", maxHeight: "140px", maxWidth: "220px" }}>
                              <img src={unitImages[idx]} alt="" style={{ maxHeight: "140px", maxWidth: "220px", width: "auto", height: "auto", objectFit: "contain", display: "block" }} />
                            </a>
                            <div style={{ display: "flex", flexDirection: "column", flexWrap: "wrap", gap: "0.25rem", maxHeight: "140px", alignContent: "flex-start" }}>
                              {unitImages.map((src, j) => (
                                <button key={j} type="button" onClick={() => setIdx(j)} className={`property-card-gallery-thumb-wrap ${j === idx ? "property-card-gallery-thumb-wrap--active" : ""}`} style={{ flexShrink: 0 }}>
                                  <img src={src} alt="" loading="lazy" className="property-card-gallery-thumb" />
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div style={{ minWidth: "120px", minHeight: "80px", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: "0.85rem" }}>No photo</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {fromLlm && (fromLlm.noi != null || fromLlm.capRate != null || fromLlm.rentalEstimates || fromLlm.otherFinancials || fromLlm.dataGapSuggestions) && (
            <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: "0.6rem", marginTop: "0.6rem", marginBottom: "0.5rem" }}>
              <strong style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.9rem", color: "#1a1a1a" }}>Financials (from listing / LLM)</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1.25rem", marginBottom: "0.5rem" }}>
                {fromLlm.noi != null && <span style={{ fontWeight: 500 }}>NOI: {formatPrice(fromLlm.noi)}</span>}
                {fromLlm.capRate != null && <span style={{ fontWeight: 500 }}>Cap rate: {fromLlm.capRate}%</span>}
              </div>
              {fromLlm.rentalEstimates && (
                <div style={{ marginBottom: "0.4rem" }}>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "#666", marginBottom: "0.15rem" }}>Rental estimates</span>
                  <p style={{ margin: 0, padding: "0.35rem 0.5rem", backgroundColor: "#f8f9fa", borderRadius: "4px", fontSize: "0.85rem", color: "#404040", lineHeight: 1.4 }}>{fromLlm.rentalEstimates}</p>
                </div>
              )}
              {fromLlm.otherFinancials && (
                <div style={{ marginBottom: "0.4rem" }}>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "#666", marginBottom: "0.15rem" }}>Other financials</span>
                  <p style={{ margin: 0, padding: "0.35rem 0.5rem", backgroundColor: "#f8f9fa", borderRadius: "4px", fontSize: "0.85rem", color: "#404040", lineHeight: 1.4 }}>{fromLlm.otherFinancials}</p>
                </div>
              )}
              {fromLlm.dataGapSuggestions && (
                <p style={{ margin: "0.5rem 0 0", padding: "0.35rem 0.5rem", backgroundColor: "#fef3c7", borderRadius: "4px", fontSize: "0.8rem", color: "#92400e" }}>
                  <strong>Possible missing data:</strong> {fromLlm.dataGapSuggestions}
                </p>
              )}
            </div>
          )}
          <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: "0.6rem", marginTop: "0.6rem", marginBottom: "0.5rem" }}>
            <strong style={{ display: "block", marginBottom: "0.2rem" }}>Documents (from inquiry replies)</strong>
            <p style={{ margin: "0 0 0.35rem", fontSize: "0.75rem", color: "#666" }}>Replies and attachments from your inquiry emails are saved here by the daily <strong>process-inbox</strong> cron job.</p>
            {inquiryDocuments === null ? (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#737373" }}>Loading…</p>
            ) : inquiryDocuments.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
                {inquiryDocuments.map((doc) => (
                  <li key={doc.id} style={{ marginBottom: "0.5rem" }}>
                    <a
                      href={`${API_BASE}/api/properties/${property.id}/documents/${doc.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#0066cc" }}
                    >
                      {doc.filename}
                    </a>
                    {doc.source && <div style={{ fontSize: "0.75rem", color: "#555", marginTop: "0.1rem" }}>Source: {doc.source}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#737373" }}>No documents yet. Send an inquiry using the button above; once brokers reply, the cron will attach them here.</p>
            )}
          </div>
          <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: "0.6rem", marginTop: "0.6rem", marginBottom: "0.5rem" }}>
            <strong style={{ display: "block", marginBottom: "0.2rem" }}>Upload document</strong>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
                const categorySelect = form.querySelector<HTMLSelectElement>('select[name="docCategory"]');
                const file = fileInput?.files?.[0];
                if (!file) {
                  setUploadError("Select a file.");
                  return;
                }
                setUploadError(null);
                setUploading(true);
                try {
                  const formData = new FormData();
                  formData.append("file", file);
                  formData.append("category", categorySelect?.value ?? "Other");
                  const sourceInput = form.querySelector<HTMLInputElement>('input[name="docSource"]');
                  if (sourceInput?.value?.trim()) formData.append("source", sourceInput.value.trim());
                  const res = await fetch(`${API_BASE}/api/properties/${property.id}/documents/upload`, {
                    method: "POST",
                    body: formData,
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : data?.details ?? "Upload failed");
                  setUploadedDocuments((prev) => (prev ? [{ id: data.document.id, filename: data.document.filename, category: data.document.category, source: data.document.source ?? null, createdAt: data.document.createdAt }, ...prev] : [{ id: data.document.id, filename: data.document.filename, category: data.document.category, source: data.document.source ?? null, createdAt: data.document.createdAt }]));
                  form.reset();
                  fileInput.value = "";
                } catch (err) {
                  setUploadError(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setUploading(false);
                }
              }}
              style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}
            >
              <input type="file" name="file" style={{ fontSize: "0.8rem" }} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*" />
              <input type="text" name="docSource" placeholder="Source (e.g. Broker, Listing agent)" style={{ padding: "0.35rem 0.5rem", fontSize: "0.8rem", border: "1px solid #ccc", borderRadius: "4px", minWidth: "140px" }} />
              <select name="docCategory" style={{ padding: "0.35rem 0.5rem", fontSize: "0.8rem", border: "1px solid #ccc", borderRadius: "4px" }}>
                <option value="OM">OM</option>
                <option value="Brochure">Brochure</option>
                <option value="Rent Roll">Rent Roll</option>
                <option value="Financial Model">Financial Model</option>
                <option value="T12 / Operating Summary">T12 / Operating Summary</option>
                <option value="Other">Other</option>
              </select>
              <button type="submit" disabled={Boolean(uploading)} style={{ padding: "0.35rem 0.6rem", fontSize: "0.8rem", border: "1px solid #0066cc", borderRadius: "4px", background: uploading ? "#94a3b8" : "#0066cc", color: "#fff", cursor: uploading ? "wait" : "pointer" }}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </form>
            {uploadError && <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#b91c1c" }}>{uploadError}</p>}
            <strong style={{ display: "block", marginTop: "0.5rem", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Uploaded documents</strong>
            {uploadedDocuments === null ? (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#737373" }}>Loading…</p>
            ) : uploadedDocuments.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
                {uploadedDocuments.map((doc) => (
                  <li key={doc.id} style={{ marginBottom: "0.5rem", display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span>
                      <span style={{ color: "#555", marginRight: "0.35rem" }}>[{doc.category}]</span>
                      <a
                        href={`${API_BASE}/api/properties/${property.id}/uploaded-documents/${doc.id}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#0066cc" }}
                      >
                        {doc.filename}
                      </a>
                      {(doc.source || doc.createdAt) && (
                        <div style={{ fontSize: "0.75rem", color: "#555", marginTop: "0.1rem" }}>
                          {doc.source && <span>Source: {doc.source}</span>}
                          {doc.source && doc.createdAt && " · "}
                          {doc.createdAt && <span>Uploaded: {formatDateOnly(doc.createdAt) ?? doc.createdAt}</span>}
                        </div>
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(deletingDocId === doc.id)}
                      onClick={async () => {
                        if (deletingDocId) return;
                        setDeletingDocId(doc.id);
                        try {
                          const res = await fetch(`${API_BASE}/api/properties/${property.id}/uploaded-documents/${doc.id}`, { method: "DELETE" });
                          if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            throw new Error(typeof data?.details === "string" ? data.details : data?.error ?? "Failed to remove");
                          }
                          setUploadedDocuments((prev) => (prev ? prev.filter((d) => d.id !== doc.id) : []));
                        } catch (e) {
                          setUploadError(e instanceof Error ? e.message : "Failed to remove document");
                        } finally {
                          setDeletingDocId(null);
                        }
                      }}
                      style={{ flexShrink: 0, padding: "0.2rem 0.4rem", fontSize: "0.75rem", border: "1px solid #dc2626", borderRadius: "4px", background: "#fff", color: "#dc2626", cursor: deletingDocId === doc.id ? "wait" : "pointer" }}
                    >
                      {deletingDocId === doc.id ? "Removing…" : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#737373" }}>No uploaded documents yet.</p>
            )}
          </div>
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
