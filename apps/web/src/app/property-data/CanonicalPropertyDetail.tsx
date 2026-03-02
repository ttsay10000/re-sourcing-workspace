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

function formatListedDate(listedAt: string | null | undefined): string {
  if (!listedAt) return "—";
  const d = new Date(listedAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
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
    description: false,
    owner: true,
    rentalOm: true,
    violationsComplaintsPermits: true,
  });
  const [unifiedRows, setUnifiedRows] = useState<UnifiedEnrichmentRow[]>([]);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedFetched, setUnifiedFetched] = useState(false);

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
        for (const p of permits as Record<string, unknown>[]) {
          const n = p.normalizedJson as Record<string, unknown> | undefined;
          const date = (p.approvedDate ?? p.approved_date ?? p.issuedDate ?? p.issued_date ?? n?.approvedDate ?? n?.issuedDate ?? "") as string;
          const workType = (n?.workType ?? n?.work_type ?? p.workPermit ?? p.work_permit ?? "") as string;
          const status = (n?.status ?? p.status ?? "") as string;
          rows.push({ date: date || "—", category: "Permit", info: [workType, status].filter(Boolean).join(" · ") || "—" });
        }
        for (const v of violations as Record<string, unknown>[]) {
          const n = v.normalizedJson as Record<string, unknown> | undefined;
          const date = (n?.approvedDate ?? "") as string;
          const cls = (n?.class ?? "") as string;
          const status = (n?.currentStatus ?? n?.current_status ?? "") as string;
          const desc = (n?.novDescription ?? n?.nov_description ?? "") as string;
          rows.push({ date: date || "—", category: "HPD Violation", info: [cls, status, desc].filter(Boolean).join(" · ") || "—" });
        }
        for (const c of complaints as Record<string, unknown>[]) {
          const n = c.normalizedJson as Record<string, unknown> | undefined;
          const date = (n?.dateEntered ?? n?.date_entered ?? "") as string;
          const cat = (n?.complaintCategory ?? n?.complaint_category ?? "") as string;
          const status = (n?.status ?? "") as string;
          rows.push({ date: date || "—", category: "DOB Complaint", info: [cat, status].filter(Boolean).join(" · ") || "—" });
        }
        for (const l of litigations as Record<string, unknown>[]) {
          const n = l.normalizedJson as Record<string, unknown> | undefined;
          const date = (n?.findingDate ?? n?.finding_date ?? "") as string;
          const caseType = (n?.caseType ?? n?.case_type ?? "") as string;
          const status = (n?.caseStatus ?? n?.case_status ?? "") as string;
          rows.push({ date: date || "—", category: "Housing Litigation", info: [caseType, status].filter(Boolean).join(" · ") || "—" });
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

  return (
    <div className="property-detail-collapsible" style={{ paddingLeft: "1.5rem", borderLeft: "3px solid #e5e5e5" }}>
      {/* Linked listing(s) — raw table format + source link */}
      {primaryListing !== "loading" && listingForDisplay && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Linked listing(s)</h4>
          <div style={{ overflowX: "auto" }}>
            <table className="property-data-table" style={{ width: "100%", minWidth: "600px", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ backgroundColor: "#f5f5f5", borderBottom: "1px solid #e5e5e5" }}>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Listing ID</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Source</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Raw Address</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Listed date</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Days on market</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Dup. Conf.</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Price History</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Link</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{listingForDisplay.externalId}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{listingForDisplay.source === "streeteasy" ? "Streeteasy" : listingForDisplay.source}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{fullAddress(listingForDisplay)}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{formatListedDate(listingForDisplay.listedAt)}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{daysOnMarket(listingForDisplay.listedAt) != null ? `${daysOnMarket(listingForDisplay.listedAt)} days` : "—"}</td>
                  <td style={{ padding: "0.4rem 0.5rem", color: (listingForDisplay.duplicateScore ?? 0) >= 80 ? "#b91c1c" : (listingForDisplay.duplicateScore ?? 0) <= 20 ? "#15803d" : "#854d0e" }}>
                    {listingForDisplay.duplicateScore != null ? listingForDisplay.duplicateScore : "—"}
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>
                    {listingForDisplay.priceHistory?.length ? `${listingForDisplay.priceHistory.length} entries` : formatPrice(listingForDisplay.price)}
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>
                    {listingForDisplay.url && listingForDisplay.url !== "#" ? (
                      <a href={listingForDisplay.url} target="_blank" rel="noopener noreferrer">view source</a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
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
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <h4 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Details</h4>
            {listingForDisplay && (
              <>
                <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>{formatPrice(listingForDisplay.price)}</div>
                <div style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                  <span>Listed: {formatListedDate(listingForDisplay.listedAt)}</span>
                  {daysOnMarket(listingForDisplay.listedAt) != null && (
                    <span style={{ marginLeft: "0.5rem" }}>{daysOnMarket(listingForDisplay.listedAt)} days on market</span>
                  )}
                </div>
                <dl style={{ fontSize: "0.875rem", margin: 0 }}>
                  <div><dt style={{ marginTop: "0.25rem" }}>Beds / Baths</dt><dd style={{ marginLeft: "1rem" }}>{listingForDisplay.beds ?? "—"} / {listingForDisplay.baths ?? "—"}</dd></div>
                  <div><dt style={{ marginTop: "0.25rem" }}>Sqft</dt><dd style={{ marginLeft: "1rem" }}>{listingForDisplay.sqft ?? "—"}</dd></div>
                  <div><dt style={{ marginTop: "0.25rem" }}>Property type</dt><dd style={{ marginLeft: "1rem" }}>{String((extra?.propertyType ?? extra?.property_type ?? extra?.type ?? "—"))}</dd></div>
                  {(extra?.builtIn ?? extra?.built_in ?? extra?.yearBuilt) != null && <div><dt style={{ marginTop: "0.25rem" }}>Built</dt><dd style={{ marginLeft: "1rem" }}>{String(extra?.builtIn ?? extra?.built_in ?? extra?.yearBuilt)}</dd></div>}
                  {(monthlyHoa != null || monthlyTax != null) && <div><dt style={{ marginTop: "0.25rem" }}>HOA / Tax</dt><dd style={{ marginLeft: "1rem" }}>{formatPrice(monthlyHoa as number)} / {formatPrice(monthlyTax as number)}</dd></div>}
                </dl>
              </>
            )}
            {!listingForDisplay && primaryListing === "loading" && <p style={{ fontSize: "0.875rem", color: "#737373" }}>Loading listing…</p>}
            {!listingForDisplay && primaryListing !== "loading" && <p style={{ fontSize: "0.875rem", color: "#737373" }}>No linked listing.</p>}
            <h4 style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: "1rem", marginBottom: "0.5rem" }}>Geospatial data</h4>
            <dl style={{ fontSize: "0.875rem", margin: 0 }}>
              {bbl != null && <><dt style={{ marginTop: "0.25rem" }}>BBL (tax / billing)</dt><dd style={{ marginLeft: "1rem" }}>{String(bbl)}</dd></>}
              {bblBase != null && <><dt style={{ marginTop: "0.25rem" }}>BBL (base)</dt><dd style={{ marginLeft: "1rem" }}>{String(bblBase)}</dd></>}
              {(lat != null || lon != null) && <><dt style={{ marginTop: "0.25rem" }}>Lat / Lon</dt><dd style={{ marginLeft: "1rem" }}>{String(lat)} / {String(lon)}</dd></>}
              {bbl == null && bblBase == null && lat == null && lon == null && <p style={{ color: "#737373", margin: 0 }}>—</p>}
            </dl>
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <h4 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Broker / Agent</h4>
            {listingForDisplay?.agentEnrichment?.length ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {listingForDisplay.agentEnrichment.map((e, i) => (
                  <li key={i} style={{ marginBottom: "0.5rem" }}><strong>{e.name}</strong>{[e.firm, e.email, e.phone].filter(Boolean).length ? ` — ${[e.firm, e.email, e.phone].filter(Boolean).join(" · ")}` : ""}</li>
                ))}
              </ul>
            ) : listingForDisplay?.agentNames?.length ? (
              <p style={{ margin: 0 }}>{listingForDisplay.agentNames.join(", ")}</p>
            ) : (
              <p style={{ color: "#737373", margin: 0 }}>—</p>
            )}
          </div>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <h4 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Amenities</h4>
            {listingForDisplay && Array.isArray(extra?.amenities) && (extra!.amenities as string[]).length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
                {(extra!.amenities as string[]).map((a, i) => (
                  <li key={i}>{String(a).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</li>
                ))}
              </ul>
            ) : (
              <p style={{ color: "#737373", margin: 0 }}>From linked listing when available.</p>
            )}
          </div>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <h4 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Price history</h4>
            {listingForDisplay?.priceHistory?.length || listingForDisplay?.rentalPriceHistory?.length ? (
              <div style={{ maxHeight: "240px", overflowY: "auto", fontSize: "0.85rem" }}>
                {listingForDisplay!.priceHistory?.slice(0, 10).map((r, i) => (
                  <div key={i} style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0" }}>{r.date} — {typeof r.price === "number" ? formatPrice(r.price) : r.price} — {r.event}</div>
                ))}
                {listingForDisplay!.rentalPriceHistory?.slice(0, 5).map((r, i) => (
                  <div key={`r${i}`} style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0" }}>Rental: {r.date} — {typeof r.price === "number" ? formatPrice(r.price) : r.price}</div>
                ))}
              </div>
            ) : (
              <p style={{ color: "#737373", margin: 0 }}>From linked listing when available.</p>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* 3. Description — collapsed by default; from listing */}
      {listingForDisplay?.description && (
        <CollapsibleSection id="description" title="Description" open={!!openSections.description} onToggle={() => toggle("description")}>
          <p className="property-card-description" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{listingForDisplay.description}</p>
        </CollapsibleSection>
      )}

      {/* 4. Owner information */}
      <CollapsibleSection id="owner" title="Owner information" open={!!openSections.owner} onToggle={() => toggle("owner")}>
        {ownerInfo != null && String(ownerInfo).trim() ? (
          <p style={{ margin: 0, fontSize: "0.875rem" }}>{String(ownerInfo)}</p>
        ) : ps && Boolean(ps.owner_name ?? ps.owner_business_name) ? (
          <div style={{ fontSize: "0.875rem" }}>
            {Boolean(ps.owner_name) && <div><strong>Owner:</strong> {String(ps.owner_name)}</div>}
            {Boolean(ps.owner_business_name) && <div><strong>Business:</strong> {String(ps.owner_business_name)}</div>}
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
          <div style={{ fontSize: "0.875rem" }}>
            {listingForDisplay.rentalPriceHistory.slice(0, 10).map((r, i) => (
              <div key={i}>{r.date} — {typeof r.price === "number" ? formatPrice(r.price) : r.price} — {r.event}</div>
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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Category</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>Info</th>
                </tr>
              </thead>
              <tbody>
                {unifiedRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "0.4rem 0.5rem" }}>{row.date}</td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>{row.category}</td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>{row.info}</td>
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
