"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PropertyDetailCollapsible } from "./PropertyDetailCollapsible";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type TabId = "raw" | "canonical";

interface RunLogEntry {
  runNumber: number;
  runId: string;
  sentAt: string;
  criteria?: Record<string, unknown>;
  listingsCreated: number;
  listingsUpdated: number;
}

interface AgentEnrichmentEntry {
  name: string;
  firm?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface PriceHistoryEntry {
  date: string;
  price: string | number;
  event: string;
}

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
  agentEnrichment?: AgentEnrichmentEntry[] | null;
  priceHistory?: PriceHistoryEntry[] | null;
  rentalPriceHistory?: PriceHistoryEntry[] | null;
  extra?: Record<string, unknown> | null;
  uploadedAt?: string | null;
  uploadedRunId?: string | null;
  duplicateScore?: number | null;
}

interface CanonicalProperty {
  id: string;
  canonicalAddress: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface PermitsSummaryData {
  count?: number;
  last_issued_date?: string;
  owner_business_name?: string;
  owner_name?: string;
}

type EnrichmentRows = Record<string, { violations?: unknown[]; complaints?: unknown[]; litigations?: unknown[]; affordableHousing?: unknown[] }>;
type EnrichmentLoading = Record<string, boolean>;

function CanonicalPropertyDetail({ property }: { property: CanonicalProperty }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [enrichmentRows, setEnrichmentRows] = useState<EnrichmentRows>({});
  const [enrichmentLoading, setEnrichmentLoading] = useState<EnrichmentLoading>({});
  const toggle = (key: string) => setOpen((p) => ({ ...p, [key]: !p[key] }));
  const sections = [
    { id: "permits_dob", title: "Permits (DOB)" },
    { id: "zoning_ztl", title: "Zoning (ZTL)" },
    { id: "certificate_of_occupancy", title: "Certificate of Occupancy" },
    { id: "hpd_registration", title: "HPD Registration" },
    { id: "hpd_violations", title: "Violations (HPD)" },
    { id: "dob_complaints", title: "DOB Complaints" },
    { id: "housing_litigations", title: "Housing Litigations" },
    { id: "affordable_housing", title: "Affordable Housing" },
    { id: "hoa_tax", title: "HOA / Tax (monthly)" },
    { id: "permit", title: "Permit info" },
    { id: "tax", title: "Tax code" },
    { id: "building", title: "Building / lot / block" },
    { id: "owner", title: "Owner information" },
    { id: "om", title: "OM / furnished rental pricing" },
  ] as const;
  const getDetail = (key: string) => {
    const d = property.details;
    if (!d || typeof d !== "object") return null;
    const k = key === "permit" ? "permitInfo" : key === "tax" ? "taxCode" : key === "building" ? "buildingLotBlock" : key === "owner" ? "ownerInfo" : "omFurnishedPricing";
    return (d as Record<string, unknown>)[k];
  };
  const enrichment = (property.details as Record<string, unknown> | null)?.enrichment as Record<string, unknown> | undefined;
  const ps = enrichment?.permits_summary as PermitsSummaryData | undefined;
  const zoning = enrichment?.zoning as Record<string, unknown> | undefined;
  const co = enrichment?.certificateOfOccupancy as Record<string, unknown> | undefined;
  const hpdReg = enrichment?.hpdRegistration as Record<string, unknown> | undefined;
  const violationsSummary = enrichment?.hpd_violations_summary as Record<string, unknown> | undefined;
  const complaintsSummary = enrichment?.dob_complaints_summary as Record<string, unknown> | undefined;
  const litigationsSummary = enrichment?.housing_litigations_summary as Record<string, unknown> | undefined;
  const affordableSummary = enrichment?.affordable_housing_summary as Record<string, unknown> | undefined;

  const fetchEnrichmentRows = (endpoint: "violations" | "complaints" | "litigations" | "affordable-housing") => {
    const key = endpoint === "affordable-housing" ? "affordableHousing" : endpoint;
    setEnrichmentLoading((p) => ({ ...p, [endpoint]: true }));
    fetch(`${API_BASE}/api/properties/${property.id}/enrichment/${endpoint}`)
      .then((r) => r.json())
      .then((data) => {
        const list = data.violations ?? data.complaints ?? data.litigations ?? data.affordableHousing ?? [];
        setEnrichmentRows((p) => ({ ...p, [property.id]: { ...(p[property.id] ?? {}), [key]: list } }));
      })
      .catch(() => setEnrichmentRows((p) => ({ ...p, [property.id]: { ...(p[property.id] ?? {}), [key]: [] } })))
      .finally(() => setEnrichmentLoading((p) => ({ ...p, [endpoint]: false })));
  };

  const renderSectionBody = (id: string) => {
    if (id === "permits_dob") {
      return ps && (ps.count != null || ps.last_issued_date || ps.owner_business_name || ps.owner_name) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
          {ps.count != null && <div><strong>Count:</strong> {ps.count}</div>}
          {ps.last_issued_date && <div><strong>Last issued:</strong> {ps.last_issued_date}</div>}
          {ps.owner_business_name && <div><strong>Owner (business):</strong> {String(ps.owner_business_name)}</div>}
          {ps.owner_name && <div><strong>Owner:</strong> {String(ps.owner_name)}</div>}
        </div>
      ) : "—";
    }
    if (id === "zoning_ztl") {
      return zoning && (zoning.zoningDistrict1 ?? zoning.zoningDistrict2 ?? zoning.specialDistrict1 ?? zoning.zoningMapNumber ?? zoning.zoningMapCode) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
          {zoning.zoningDistrict1 != null && <div><strong>Zoning district 1:</strong> {String(zoning.zoningDistrict1)}</div>}
          {zoning.zoningDistrict2 != null && <div><strong>Zoning district 2:</strong> {String(zoning.zoningDistrict2)}</div>}
          {zoning.specialDistrict1 != null && <div><strong>Special district 1:</strong> {String(zoning.specialDistrict1)}</div>}
          {zoning.zoningMapNumber != null && <div><strong>Zoning map number:</strong> {String(zoning.zoningMapNumber)}</div>}
          {zoning.zoningMapCode != null && <div><strong>Zoning map code:</strong> {String(zoning.zoningMapCode)}</div>}
        </div>
      ) : "—";
    }
    if (id === "certificate_of_occupancy") {
      return co && (co.jobType ?? co.status ?? co.issuanceDate ?? co.dwellingUnits != null) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
          {co.jobType != null && <div><strong>Job type:</strong> {String(co.jobType)}</div>}
          {co.status != null && <div><strong>Status:</strong> {String(co.status)}</div>}
          {co.issuanceDate != null && <div><strong>Issuance date:</strong> {String(co.issuanceDate)}</div>}
          {co.dwellingUnits != null && <div><strong>Dwelling units:</strong> {Number(co.dwellingUnits)}</div>}
        </div>
      ) : "—";
    }
    if (id === "hpd_registration") {
      return hpdReg && (hpdReg.registrationId ?? hpdReg.lastRegistrationDate) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
          {hpdReg.registrationId != null && <div><strong>Registration ID:</strong> {String(hpdReg.registrationId)}</div>}
          {hpdReg.lastRegistrationDate != null && <div><strong>Last registration date:</strong> {String(hpdReg.lastRegistrationDate)}</div>}
        </div>
      ) : "—";
    }
    if (id === "hpd_violations") {
      const rows = enrichmentRows[property.id]?.violations as Record<string, unknown>[] | undefined;
      const loading = enrichmentLoading["violations"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
          {violationsSummary && (
            <div>
              {violationsSummary.total != null && <div><strong>Total:</strong> {Number(violationsSummary.total)}</div>}
              {violationsSummary.openCount != null && <div><strong>Open:</strong> {Number(violationsSummary.openCount)}</div>}
              {violationsSummary.rentImpairingOpen != null && <div><strong>Rent-impairing open:</strong> {Number(violationsSummary.rentImpairingOpen)}</div>}
            </div>
          )}
          <button type="button" onClick={() => fetchEnrichmentRows("violations")} disabled={loading} style={{ alignSelf: "flex-start" }}>
            {loading ? "Loading…" : "View all"}
          </button>
          {rows != null && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ fontSize: "0.75rem", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Violation ID</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Class</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Status</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Approved date</th></tr></thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => {
                    const row = r as Record<string, unknown>;
                    const n = row.normalizedJson as Record<string, unknown> | undefined;
                    return (
                      <tr key={i}>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(row.sourceRowId ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.class ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.currentStatus ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.approvedDate ?? "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 20 && <div style={{ marginTop: 4 }}>Showing 20 of {rows.length}</div>}
            </div>
          )}
        </div>
      );
    }
    if (id === "dob_complaints") {
      const rows = enrichmentRows[property.id]?.complaints as Record<string, unknown>[] | undefined;
      const loading = enrichmentLoading["complaints"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
          {complaintsSummary && (
            <div>
              {complaintsSummary.count30 != null && <div><strong>Last 30 days:</strong> {Number(complaintsSummary.count30)}</div>}
              {complaintsSummary.count90 != null && <div><strong>Last 90 days:</strong> {Number(complaintsSummary.count90)}</div>}
              {complaintsSummary.openCount != null && <div><strong>Open:</strong> {Number(complaintsSummary.openCount)}</div>}
            </div>
          )}
          <button type="button" onClick={() => fetchEnrichmentRows("complaints")} disabled={loading} style={{ alignSelf: "flex-start" }}>
            {loading ? "Loading…" : "View all"}
          </button>
          {rows != null && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ fontSize: "0.75rem", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Date entered</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Status</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Category</th></tr></thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => {
                    const n = (r as Record<string, unknown>).normalizedJson as Record<string, unknown> | undefined;
                    return (
                      <tr key={i}>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.dateEntered ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.status ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.complaintCategory ?? "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 20 && <div style={{ marginTop: 4 }}>Showing 20 of {rows.length}</div>}
            </div>
          )}
        </div>
      );
    }
    if (id === "housing_litigations") {
      const rows = enrichmentRows[property.id]?.litigations as Record<string, unknown>[] | undefined;
      const loading = enrichmentLoading["litigations"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
          {litigationsSummary && (
            <div>
              {litigationsSummary.total != null && <div><strong>Total:</strong> {Number(litigationsSummary.total)}</div>}
              {litigationsSummary.openCount != null && <div><strong>Open:</strong> {Number(litigationsSummary.openCount)}</div>}
              {litigationsSummary.totalPenalty != null && <div><strong>Total penalty:</strong> {Number(litigationsSummary.totalPenalty)}</div>}
            </div>
          )}
          <button type="button" onClick={() => fetchEnrichmentRows("litigations")} disabled={loading} style={{ alignSelf: "flex-start" }}>
            {loading ? "Loading…" : "View all"}
          </button>
          {rows != null && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ fontSize: "0.75rem", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Case type</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Status</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Finding date</th></tr></thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => {
                    const n = (r as Record<string, unknown>).normalizedJson as Record<string, unknown> | undefined;
                    return (
                      <tr key={i}>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.caseType ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.caseStatus ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.findingDate ?? "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 20 && <div style={{ marginTop: 4 }}>Showing 20 of {rows.length}</div>}
            </div>
          )}
        </div>
      );
    }
    if (id === "affordable_housing") {
      const rows = enrichmentRows[property.id]?.affordableHousing as Record<string, unknown>[] | undefined;
      const loading = enrichmentLoading["affordable-housing"];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
          {affordableSummary && (
            <div>
              {affordableSummary.latestProjectName != null && <div><strong>Latest project:</strong> {String(affordableSummary.latestProjectName)}</div>}
              {affordableSummary.totalUnits != null && <div><strong>Total units:</strong> {Number(affordableSummary.totalUnits)}</div>}
              {affordableSummary.projectCount != null && <div><strong>Projects:</strong> {Number(affordableSummary.projectCount)}</div>}
            </div>
          )}
          <button type="button" onClick={() => fetchEnrichmentRows("affordable-housing")} disabled={loading} style={{ alignSelf: "flex-start" }}>
            {loading ? "Loading…" : "View all"}
          </button>
          {rows != null && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ fontSize: "0.75rem", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Project</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Completion date</th><th style={{ border: "1px solid #ccc", padding: "2px 4px" }}>Total units</th></tr></thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => {
                    const n = (r as Record<string, unknown>).normalizedJson as Record<string, unknown> | undefined;
                    return (
                      <tr key={i}>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.projectName ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.projectCompletionDate ?? "—")}</td>
                        <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{String(n?.totalUnits ?? "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 20 && <div style={{ marginTop: 4 }}>Showing 20 of {rows.length}</div>}
            </div>
          )}
        </div>
      );
    }
    if (id === "hoa_tax") {
      const d = property.details as Record<string, unknown> | null | undefined;
      const monthlyHoa = d?.monthlyHoa ?? d?.monthly_hoa;
      const monthlyTax = d?.monthlyTax ?? d?.monthly_tax;
      if (monthlyHoa == null && monthlyTax == null) return "—";
      const fmt = (n: unknown) =>
        n != null && typeof n === "number" && !Number.isNaN(n)
          ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
          : "—";
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
          <div><strong>Monthly HOA:</strong> {fmt(monthlyHoa)}</div>
          <div><strong>Monthly tax:</strong> {fmt(monthlyTax)}</div>
        </div>
      );
    }
    return getDetail(id) != null && getDetail(id) !== "" ? String(getDetail(id)) : "—";
  };

  return (
    <div className="property-detail-collapsible">
      {sections.map(({ id, title }) => (
        <div key={id} className="property-detail-section">
          <button
            type="button"
            className="property-detail-section-header"
            onClick={() => toggle(id)}
            aria-expanded={!!open[id]}
          >
            <span className="property-detail-section-title">{title}</span>
            <span className={`property-detail-section-chevron ${open[id] ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
          </button>
          {open[id] && (
            <div className="property-detail-section-body">
              {renderSectionBody(id)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PropertyDataContent() {
  const [activeTab, setActiveTab] = useState<TabId>("raw");
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [runLog, setRunLog] = useState<RunLogEntry[]>([]);
  const [runLogOpen, setRunLogOpen] = useState(false);
  const [reviewDupOpen, setReviewDupOpen] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<ListingRow[]>([]);
  const [loadingDup, setLoadingDup] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [canonicalProperties, setCanonicalProperties] = useState<CanonicalProperty[]>([]);
  const [loadingCanonical, setLoadingCanonical] = useState(false);
  const [sendingToCanonical, setSendingToCanonical] = useState(false);
  const [expandedCanonicalId, setExpandedCanonicalId] = useState<string | null>(null);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [enrichmentTimerSeconds, setEnrichmentTimerSeconds] = useState(0);
  const enrichmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  const fetchListings = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/listings`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setListings(data.listings ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e.message || "Failed to load listings"))
      .finally(() => setLoading(false));
  }, []);

  const fetchRunLog = useCallback(() => {
    fetch(`${API_BASE}/api/test-agent/property-data/runs`)
      .then((r) => r.json())
      .then((data) => setRunLog(data.runs ?? []))
      .catch(() => setRunLog([]));
  }, []);

  const fetchCanonicalProperties = useCallback(() => {
    setLoadingCanonical(true);
    fetch(`${API_BASE}/api/properties`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCanonicalProperties(data.properties ?? []);
      })
      .catch((e) => setError(e.message || "Failed to load canonical properties"))
      .finally(() => setLoadingCanonical(false));
  }, []);

  useEffect(() => {
    if (activeTab === "raw") fetchListings();
  }, [activeTab, fetchListings]);

  useEffect(() => {
    if (activeTab === "canonical") fetchCanonicalProperties();
  }, [activeTab, fetchCanonicalProperties]);

  // Timer for LLM enrichment / loading: track elapsed time while raw listings are loading so user knows data may still be populating
  useEffect(() => {
    if (activeTab !== "raw") return;
    if (loading) {
      setEnrichmentTimerSeconds(0);
      enrichmentTimerRef.current = setInterval(() => {
        setEnrichmentTimerSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (enrichmentTimerRef.current) {
        clearInterval(enrichmentTimerRef.current);
        enrichmentTimerRef.current = null;
      }
      setEnrichmentTimerSeconds(0);
    }
    return () => {
      if (enrichmentTimerRef.current) {
        clearInterval(enrichmentTimerRef.current);
        enrichmentTimerRef.current = null;
      }
    };
  }, [activeTab, loading]);

  useEffect(() => {
    fetchRunLog();
  }, [fetchRunLog]);

  const selectedListing = selectedId ? listings.find((l) => l.id === selectedId) ?? null : null;

  const formatPrice = (n: number) =>
    n != null && !Number.isNaN(n)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
      : "—";

  const formatListedDate = (listedAt: string | null | undefined) => {
    if (!listedAt) return "—";
    const d = new Date(listedAt);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  const daysOnMarket = (listedAt: string | null | undefined) => {
    if (!listedAt) return null;
    const d = new Date(listedAt);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - d.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  const fullAddress = (row: ListingRow) =>
    [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ") || "—";

  const dupConfStyle = (score: number | null | undefined) => {
    if (score == null) return {};
    const intensity = score / 100;
    return {
      color: intensity >= 0.8 ? "#b91c1c" : intensity <= 0.2 ? "#15803d" : "#854d0e",
      fontWeight: score >= 80 ? 600 : 400,
    };
  };

  const handleClearPropertyData = () => {
    if (!confirm("Clear all raw listings and their snapshots? This cannot be undone.")) return;
    setClearing(true);
    setError(null);
    fetch(`${API_BASE}/api/test-agent/property-data?confirm=1`, { method: "DELETE" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok && data?.error) {
          const detail = data.details ? ` — ${data.details}` : "";
          throw new Error(data.error + detail);
        }
        if (data?.error) throw new Error(data.error);
        fetchListings();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to clear property data"))
      .finally(() => setClearing(false));
  };

  const searchParams = useSearchParams();
  const sentMessage = searchParams.get("sent");

  const openReviewDup = () => {
    setReviewDupOpen(true);
    setLoadingDup(true);
    setDuplicateCandidates([]);
    fetch(`${API_BASE}/api/listings/duplicate-candidates?threshold=80`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDuplicateCandidates(data.listings ?? []);
      })
      .catch(() => setDuplicateCandidates([]))
      .finally(() => setLoadingDup(false));
  };

  const handleDeleteListing = (id: string) => {
    if (!confirm("Remove this raw listing? Snapshots will be deleted. This cannot be undone.")) return;
    setDeletingId(id);
    fetch(`${API_BASE}/api/listings/${id}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDuplicateCandidates((prev) => prev.filter((l) => l.id !== id));
        fetchListings();
      })
      .catch((e) => setError(e.message || "Failed to delete"))
      .finally(() => setDeletingId(null));
  };

  const handleSendToCanonical = () => {
    const toSend = selectedListingIds.size > 0 ? selectedListingIds.size : total;
    if (toSend === 0) return;
    const message =
      selectedListingIds.size > 0
        ? `Create canonical properties from ${selectedListingIds.size} selected listing(s) and run enrichment?`
        : `Create canonical properties from all ${total} raw listing(s) and link them?`;
    if (!confirm(message)) return;
    setSendingToCanonical(true);
    setError(null);
    const body =
      selectedListingIds.size > 0
        ? { listingIds: Array.from(selectedListingIds) }
        : undefined;
    fetch(`${API_BASE}/api/properties/from-listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSelectedListingIds(new Set());
        fetchCanonicalProperties();
        setActiveTab("canonical");
      })
      .catch((e) => setError(e.message || "Failed to send to canonical"))
      .finally(() => setSendingToCanonical(false));
  };

  const toggleListingSelection = (id: string) => {
    setSelectedListingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllListings = () => {
    setSelectedListingIds(new Set(listings.map((r) => r.id)));
  };

  const clearListingSelection = () => {
    setSelectedListingIds(new Set());
  };

  const allSelected = listings.length > 0 && selectedListingIds.size === listings.length;
  const someSelected = selectedListingIds.size > 0;

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (el) el.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    <div className="property-data-layout">
      <h1 className="page-title">Property Data</h1>
      {sentMessage && (
        <div className="card" style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#f0fdf4", borderColor: "#86efac" }}>
          {decodeURIComponent(sentMessage)}
        </div>
      )}

      <div className="property-data-search-row">
        <input
          type="search"
          placeholder="Search by Address, property ID, or Listing ID"
          className="input-text property-data-search"
          disabled
        />
      </div>

      <div className="property-data-tabs-row">
        <div className="property-data-tabs">
          <button
            type="button"
            className={`property-data-tab ${activeTab === "raw" ? "property-data-tab--active" : ""}`}
            onClick={() => setActiveTab("raw")}
          >
            Raw Listings
          </button>
          <button
            type="button"
            className={`property-data-tab ${activeTab === "canonical" ? "property-data-tab--active" : ""}`}
            onClick={() => setActiveTab("canonical")}
          >
            Canonical Properties
          </button>
        </div>
        <div className="property-data-filters">
          <select className="input-text property-data-filter-select" disabled>
            <option>Filters</option>
          </select>
          <select className="input-text property-data-filter-select" disabled>
            <option>Source...</option>
          </select>
          <select className="input-text property-data-filter-select" disabled>
            <option>Dedup Confidence</option>
          </select>
          <select className="input-text property-data-filter-select" disabled>
            <option>Missing Data</option>
          </select>
        </div>
      </div>

      <div className="property-data-content property-data-content--no-sidebar">
        {activeTab === "raw" && loading && (
          <div
            className="card"
            role="status"
            aria-live="polite"
            style={{
              marginBottom: "1rem",
              padding: "0.75rem 1rem",
              background: "#fef9c3",
              borderColor: "#facc15",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              Loading raw listings — broker &amp; price history may still be populating.
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              {formatElapsed(enrichmentTimerSeconds)}
            </span>
          </div>
        )}
        <div className="property-data-table-wrap">
          {error && (
            <div className="card error" style={{ margin: "1rem" }}>
              {error}
            </div>
          )}
          {loading && activeTab === "raw" && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#525252" }}>
              Loading raw listings…
            </div>
          )}
          {activeTab === "canonical" && (
            <>
              {loadingCanonical ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#525252" }}>
                  Loading canonical properties…
                </div>
              ) : (
                <table className="property-data-table">
                  <thead>
                    <tr>
                      <th className="property-data-table-expand-col" aria-label="Expand row" />
                      <th>Canonical address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {canonicalProperties.length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ padding: "2rem", color: "#737373", textAlign: "center" }}>
                          No canonical properties yet. Add raw listings, then use &quot;Add to canonical properties&quot; from the Raw Listings tab.
                        </td>
                      </tr>
                    ) : (
                      canonicalProperties.map((prop) => (
                        <React.Fragment key={prop.id}>
                          <tr
                            className="property-data-row--clickable"
                            onClick={() => setExpandedCanonicalId((id) => (id === prop.id ? null : prop.id))}
                          >
                            <td className="property-data-table-expand-col">
                              <button
                                type="button"
                                className="property-data-row-expand-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCanonicalId((id) => (id === prop.id ? null : prop.id));
                                }}
                                aria-expanded={expandedCanonicalId === prop.id}
                              >
                                <span className={`property-data-row-expand-chevron ${expandedCanonicalId === prop.id ? "property-data-row-expand-chevron--open" : ""}`}>▼</span>
                              </button>
                            </td>
                            <td>{prop.canonicalAddress}</td>
                          </tr>
                          {expandedCanonicalId === prop.id && (
                            <tr className="property-data-detail-row">
                              <td colSpan={2} className="property-data-detail-cell" style={{ padding: "1rem" }}>
                                <CanonicalPropertyDetail property={prop} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </>
          )}
          {activeTab === "raw" && !loading && (
            <table className="property-data-table">
              <thead>
                <tr>
                  <th className="property-data-table-expand-col" aria-label="Expand row" />
                  <th className="property-data-table-checkbox-col" aria-label="Select for canonical">
                    {listings.length > 0 && (
                      <input
                        type="checkbox"
                        ref={selectAllCheckboxRef}
                        checked={allSelected}
                        onChange={() => (allSelected ? clearListingSelection() : selectAllListings())}
                        aria-label={allSelected ? "Clear selection" : "Select all"}
                        title={allSelected ? "Clear selection" : "Select all"}
                      />
                    )}
                  </th>
                  <th>Listing ID</th>
                  <th>Source</th>
                  <th>Raw Address</th>
                  <th>Listed date</th>
                  <th>Days on market</th>
                  <th>Dup. Conf.</th>
                  <th>Price History</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {listings.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: "2rem", color: "#737373", textAlign: "center" }}>
                      No raw listings yet. Run a flow from Runs, then use &quot;Send to property data&quot; for a
                      completed run.
                    </td>
                  </tr>
                ) : (
                  listings.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`property-data-row--clickable ${selectedId === row.id ? "property-data-row--selected" : ""}`}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td className="property-data-table-expand-col">
                          <button
                            type="button"
                            className="property-data-row-expand-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRowId((id) => (id === row.id ? null : row.id));
                            }}
                            aria-expanded={expandedRowId === row.id}
                            aria-label={expandedRowId === row.id ? "Collapse row" : "Expand row"}
                          >
                            <span className={`property-data-row-expand-chevron ${expandedRowId === row.id ? "property-data-row-expand-chevron--open" : ""}`}>
                              ▼
                            </span>
                          </button>
                        </td>
                        <td className="property-data-table-checkbox-col" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedListingIds.has(row.id)}
                            onChange={() => toggleListingSelection(row.id)}
                            aria-label={`Select ${fullAddress(row)} for canonical`}
                          />
                        </td>
                        <td>{row.externalId}</td>
                        <td>{row.source === "streeteasy" ? "Streeteasy" : row.source}</td>
                        <td>{fullAddress(row)}</td>
                        <td>{formatListedDate(row.listedAt)}</td>
                        <td>{daysOnMarket(row.listedAt) != null ? `${daysOnMarket(row.listedAt)} days` : "—"}</td>
                        <td style={dupConfStyle(row.duplicateScore)} title="Duplicate likelihood (100 = likely duplicate)">
                          {row.duplicateScore != null ? row.duplicateScore : "—"}
                        </td>
                        <td>
                          {row.priceHistory && row.priceHistory.length > 0
                            ? `${row.priceHistory.length} entries`
                            : formatPrice(row.price)}
                        </td>
                        <td>
                          {row.url && row.url !== "#" ? (
                            <a href={row.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              view source
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                      {expandedRowId === row.id && (
                        <tr key={`${row.id}-detail`} className="property-data-detail-row">
                          <td colSpan={10} className="property-data-detail-cell">
                            <PropertyDetailCollapsible listing={row} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="property-data-bottom-bar">
        <span className="property-data-bottom-label">
          {activeTab === "raw" && total > 0
            ? someSelected
              ? `${selectedListingIds.size} of ${total} selected`
              : `${total} raw listing(s)`
            : "Reset of filters"}
        </span>
        <div className="property-data-bottom-actions">
          {activeTab === "raw" && total > 0 && (
            <>
              {someSelected ? (
                <button type="button" className="btn-secondary" onClick={clearListingSelection} title="Clear selection">
                  Clear selection
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={selectAllListings} title="Select all listings">
                  Select all
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={handleSendToCanonical}
            disabled={activeTab !== "raw" || total === 0 || sendingToCanonical}
            title={someSelected ? "Send selected to canonical and run enrichment" : "Create canonical properties from all raw listings and link them"}
          >
            {sendingToCanonical ? "Sending…" : someSelected ? `Add ${selectedListingIds.size} to canonical` : "Add to canonical properties"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={openReviewDup}
            disabled={activeTab !== "raw" || total === 0}
            title="Review potential duplicate listings (score ≥ 80)"
          >
            Review duplicates
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClearPropertyData}
            disabled={clearing || activeTab !== "raw"}
            title="Remove all raw listings and snapshots (for testing)"
          >
            {clearing ? "Clearing…" : "Clear all (test)"}
          </button>
          <button type="button" className="btn-secondary" disabled>Reset</button>
          <button type="button" className="btn-primary" disabled>Apply</button>
        </div>
      </div>

      {reviewDupOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="review-dup-title" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ maxWidth: "560px", width: "90%", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <h2 id="review-dup-title" style={{ margin: 0, marginBottom: "0.75rem", fontSize: "1.1rem" }}>Review potential duplicates</h2>
            <p style={{ fontSize: "0.875rem", color: "#525252", marginBottom: "1rem" }}>
              Listings with duplicate score ≥ 80. Delete duplicates to keep one record per property.
            </p>
            {loadingDup ? (
              <p style={{ color: "#737373" }}>Loading…</p>
            ) : duplicateCandidates.length === 0 ? (
              <p style={{ color: "#737373" }}>No potential duplicates found.</p>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table className="property-data-table" style={{ fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Score</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateCandidates.map((row) => (
                      <tr key={row.id}>
                        <td>{fullAddress(row)}</td>
                        <td style={dupConfStyle(row.duplicateScore)}>{row.duplicateScore ?? "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={deletingId === row.id}
                            onClick={() => handleDeleteListing(row.id)}
                          >
                            {deletingId === row.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e5e5" }}>
              <button type="button" className="btn-primary" onClick={() => setReviewDupOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="property-data-run-log-section">
        <button
          type="button"
          className="property-detail-section-header"
          onClick={() => setRunLogOpen((o) => !o)}
          aria-expanded={runLogOpen}
          style={{ width: "100%", maxWidth: "640px" }}
        >
          <span className="property-detail-section-title">Run log (data integrity)</span>
          <span className={`property-detail-section-chevron ${runLogOpen ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
        </button>
        {runLogOpen && (
          <div className="property-data-run-log-table-wrap">
            {runLog.length === 0 ? (
              <p style={{ color: "#737373", fontSize: "0.875rem" }}>No runs sent to property data yet.</p>
            ) : (
              <table className="property-data-table" style={{ maxWidth: "640px" }}>
                <thead>
                  <tr>
                    <th>Run #</th>
                    <th>Run ID</th>
                    <th>Sent</th>
                    <th>Created</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {runLog.map((entry) => (
                    <tr key={entry.runNumber}>
                      <td>{entry.runNumber}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}>{entry.runId.slice(0, 8)}…</td>
                      <td>{new Date(entry.sentAt).toLocaleString()}</td>
                      <td>{entry.listingsCreated}</td>
                      <td>{entry.listingsUpdated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PropertyDataPage() {
  return (
    <Suspense fallback={<div className="property-data-layout"><h1 className="page-title">Property Data</h1><p style={{ padding: "2rem", color: "#737373" }}>Loading…</p></div>}>
      <PropertyDataContent />
    </Suspense>
  );
}
