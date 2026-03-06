"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PropertyDetailCollapsible } from "./PropertyDetailCollapsible";
import { CanonicalPropertyDetail, type CanonicalProperty } from "./CanonicalPropertyDetail";
import { AREA_OPTIONS, cityToArea, cityFromCanonicalAddress } from "./areas";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type TabId = "raw" | "canonical";

/** Labels for enrichment module keys (from API byModule). */
const ENRICHMENT_MODULE_LABELS: Record<string, string> = {
  permits: "Permits",
  zoning_ztl: "Zoning",
  certificate_of_occupancy: "Certificate of Occupancy",
  hpd_registration: "HPD Registration",
  hpd_violations: "HPD Violations",
  dob_complaints: "DOB Complaints",
  housing_litigations: "Housing Litigations",
};

interface RunLogEntry {
  runNumber: number;
  runId: string;
  sentAt: string;
  criteria?: Record<string, unknown>;
  listingsCreated: number;
  listingsUpdated: number;
}

interface PipelineEnrichmentRow {
  key: string;
  label: string;
  completed: number;
}

interface PipelineStats {
  rawListings: number;
  canonicalProperties: number;
  enrichment: PipelineEnrichmentRow[];
  /** When requested with includeRemaining=1: property IDs not yet completed per module. */
  remainingByModule?: Record<string, { count: number; propertyIds: string[] }>;
}

/** Result of last enrichment run (from POST from-listings or run-enrichment permitEnrichment + omFinancialsRefresh). */
interface LastEnrichmentResult {
  ran: true;
  success: number;
  failed: number;
  byModule: Record<string, number>;
  /** OM/Brochure financials: docs re-processed by LLM (run-enrichment only). */
  omFinancialsProcessed?: number;
  /** OM/Brochure docs skipped because file was not on disk (e.g. ephemeral storage). */
  omFinancialsSkippedNoFile?: number;
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

function PropertyDataContent() {
  const [activeTab, setActiveTab] = useState<TabId>("canonical");
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearingCanonical, setClearingCanonical] = useState(false);
  const [runLog, setRunLog] = useState<RunLogEntry[]>([]);
  const [runLogOpen, setRunLogOpen] = useState(false);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);
  const [pipelineStatsOpen, setPipelineStatsOpen] = useState(false);
  const [reviewDupOpen, setReviewDupOpen] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<ListingRow[]>([]);
  const [loadingDup, setLoadingDup] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [canonicalProperties, setCanonicalProperties] = useState<CanonicalProperty[]>([]);
  const [loadingCanonical, setLoadingCanonical] = useState(false);
  const [sendingToCanonical, setSendingToCanonical] = useState(false);
  const [rerunningEnrichment, setRerunningEnrichment] = useState(false);
  const [runningRentalFlow, setRunningRentalFlow] = useState(false);
  const [expandedCanonicalId, setExpandedCanonicalId] = useState<string | null>(null);
  const [savedPropertyIds, setSavedPropertyIds] = useState<Set<string>>(new Set());
  const [savedDealsLoading, setSavedDealsLoading] = useState<Set<string>>(new Set());
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [enrichmentTimerSeconds, setEnrichmentTimerSeconds] = useState(0);
  const enrichmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [lastEnrichmentResult, setLastEnrichmentResult] = useState<LastEnrichmentResult | null>(null);

  // Filter/sort state (shared concept for raw and canonical)
  const [sortBy, setSortBy] = useState<"price" | "listedAt" | "area">("listedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [listedAfter, setListedAfter] = useState<string>("");
  const [listedBefore, setListedBefore] = useState<string>("");

  const fetchListings = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/listings`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data.error || data.details || `HTTP ${r.status}`) as string);
        if (data.error) throw new Error(data.error);
        setListings(data.listings ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e.message === "Failed to fetch" ? `Cannot reach API at ${API_BASE}. Check CORS and NEXT_PUBLIC_API_URL.` : (e.message || "Failed to load listings")))
      .finally(() => setLoading(false));
  }, []);

  const fetchRunLog = useCallback(() => {
    fetch(`${API_BASE}/api/test-agent/property-data/runs`)
      .then((r) => r.json())
      .then((data) => setRunLog(data.runs ?? []))
      .catch(() => setRunLog([]));
  }, []);

  const fetchPipelineStats = useCallback((includeRemaining = false) => {
    const url = `${API_BASE}/api/properties/pipeline-stats${includeRemaining ? "?includeRemaining=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPipelineStats({
          rawListings: data.rawListings ?? 0,
          canonicalProperties: data.canonicalProperties ?? 0,
          enrichment: data.enrichment ?? [],
          remainingByModule: data.remainingByModule ?? undefined,
        });
      })
      .catch(() => setPipelineStats(null));
  }, []);

  const fetchCanonicalProperties = useCallback(() => {
    setLoadingCanonical(true);
    fetch(`${API_BASE}/api/properties?includeListingSummary=1`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data.error || data.details || `HTTP ${r.status}`) as string);
        if (data.error) throw new Error(data.error);
        setCanonicalProperties(data.properties ?? []);
      })
      .catch((e) => setError(e.message === "Failed to fetch" ? `Cannot reach API at ${API_BASE}. Check CORS and NEXT_PUBLIC_API_URL.` : (e.message || "Failed to load canonical properties")))
      .finally(() => setLoadingCanonical(false));
  }, []);

  useEffect(() => {
    if (activeTab === "raw") fetchListings();
  }, [activeTab, fetchListings]);

  useEffect(() => {
    if (activeTab === "canonical") fetchCanonicalProperties();
  }, [activeTab, fetchCanonicalProperties]);

  useEffect(() => {
    if (canonicalProperties.length === 0) return;
    const ids = canonicalProperties.map((p) => p.id).join(",");
    fetch(`${API_BASE}/api/profile/saved-deals/check?propertyIds=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((data) => {
        // #region agent log
        const hasSaved = data && typeof data.saved === "object";
        fetch("http://127.0.0.1:7590/ingest/742bd78a-5157-440b-b6aa-e9509cd8e861",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"fd8b77"},body:JSON.stringify({sessionId:"fd8b77",location:"property-data/page.tsx:saved-check",message:"Saved-deals check response",data:{hasSaved,keysCount:hasSaved?Object.keys(data.saved).length:0},timestamp:Date.now(),hypothesisId:"H2"})}).catch(()=>{});
        // #endregion
        if (hasSaved)
          setSavedPropertyIds(new Set(Object.keys(data.saved).filter((id) => Boolean(data.saved[id]))));
      })
      .catch(() => {});
  }, [canonicalProperties]);

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

  useEffect(() => {
    fetchPipelineStats(true);
  }, [fetchPipelineStats]);

  // While re-run enrichment is in progress, poll pipeline stats so counts and remaining update live
  useEffect(() => {
    if (!rerunningEnrichment) return;
    fetchPipelineStats(true);
    const interval = setInterval(() => fetchPipelineStats(true), 2500);
    return () => clearInterval(interval);
  }, [rerunningEnrichment, fetchPipelineStats]);

  const selectedListing = selectedId ? listings.find((l) => l.id === selectedId) ?? null : null;

  const parseNum = (s: string): number | null => {
    const n = parseFloat(s.replace(/[$,]/g, "").trim());
    return s.trim() === "" || Number.isNaN(n) ? null : n;
  };
  const parseDate = (s: string): number | null => {
    if (!s.trim()) return null;
    const t = new Date(s.trim()).getTime();
    return Number.isNaN(t) ? null : t;
  };

  const filteredSortedListings = useMemo(() => {
    let out = listings.filter((row) => {
      if (areaFilter) {
        const area = cityToArea(row.city);
        if (area !== areaFilter) return false;
      }
      const price = row.price;
      if (minPrice != null && parseNum(minPrice) != null && price < parseNum(minPrice)!) return false;
      if (maxPrice != null && parseNum(maxPrice) != null && price > parseNum(maxPrice)!) return false;
      const listedTs = row.listedAt ? new Date(row.listedAt).getTime() : null;
      if (listedAfter && parseDate(listedAfter) != null && (listedTs == null || listedTs < parseDate(listedAfter)!)) return false;
      if (listedBefore && parseDate(listedBefore) != null && (listedTs == null || listedTs > parseDate(listedBefore)!)) return false;
      return true;
    });
    const mult = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (sortBy === "price") {
        const pa = a.price ?? 0;
        const pb = b.price ?? 0;
        return mult * (pa - pb);
      }
      if (sortBy === "listedAt") {
        const ta = a.listedAt ? new Date(a.listedAt).getTime() : 0;
        const tb = b.listedAt ? new Date(b.listedAt).getTime() : 0;
        return mult * (ta - tb);
      }
      const areaA = cityToArea(a.city);
      const areaB = cityToArea(b.city);
      return mult * areaA.localeCompare(areaB);
    });
    return out;
  }, [listings, areaFilter, minPrice, maxPrice, listedAfter, listedBefore, sortBy, sortDir]);

  const filteredSortedCanonical = useMemo(() => {
    let out = canonicalProperties.filter((prop) => {
      const area = prop.primaryListing?.city != null
        ? cityToArea(prop.primaryListing.city)
        : cityFromCanonicalAddress(prop.canonicalAddress);
      if (areaFilter && area !== areaFilter) return false;
      const price = prop.primaryListing?.price ?? null;
      if (price != null) {
        if (parseNum(minPrice) != null && price < parseNum(minPrice)!) return false;
        if (parseNum(maxPrice) != null && price > parseNum(maxPrice)!) return false;
      } else if (minPrice.trim() || maxPrice.trim()) return false;
      const listedAt = prop.primaryListing?.listedAt ?? null;
      const listedTs = listedAt ? new Date(listedAt).getTime() : null;
      if (listedAfter && parseDate(listedAfter) != null && (listedTs == null || listedTs < parseDate(listedAfter)!)) return false;
      if (listedBefore && parseDate(listedBefore) != null && (listedTs == null || listedTs > parseDate(listedBefore)!)) return false;
      return true;
    });
    const mult = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (sortBy === "price") {
        const pa = a.primaryListing?.price ?? 0;
        const pb = b.primaryListing?.price ?? 0;
        return mult * (pa - pb);
      }
      if (sortBy === "listedAt") {
        const ta = a.primaryListing?.listedAt ? new Date(a.primaryListing.listedAt).getTime() : 0;
        const tb = b.primaryListing?.listedAt ? new Date(b.primaryListing.listedAt).getTime() : 0;
        return mult * (ta - tb);
      }
      const areaA = a.primaryListing?.city != null ? cityToArea(a.primaryListing.city) : cityFromCanonicalAddress(a.canonicalAddress);
      const areaB = b.primaryListing?.city != null ? cityToArea(b.primaryListing.city) : cityFromCanonicalAddress(b.canonicalAddress);
      return mult * areaA.localeCompare(areaB);
    });
    return out;
  }, [canonicalProperties, areaFilter, minPrice, maxPrice, listedAfter, listedBefore, sortBy, sortDir]);

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

  const handleClearRawListings = () => {
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
        fetchPipelineStats(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to clear raw listings"))
      .finally(() => setClearing(false));
  };

  const handleClearCanonicalProperties = () => {
    if (!confirm("Clear all canonical properties and their matches/enrichment data? This cannot be undone.")) return;
    setClearingCanonical(true);
    setError(null);
    fetch(`${API_BASE}/api/properties?confirm=1`, { method: "DELETE" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok && data?.error) {
          const detail = data.details ? ` — ${data.details}` : "";
          throw new Error(data.error + detail);
        }
        if (data?.error) throw new Error(data.error);
        fetchCanonicalProperties();
        fetchPipelineStats(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to clear canonical properties"))
      .finally(() => setClearingCanonical(false));
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
    setLastEnrichmentResult(null);
    setPipelineStatsOpen(true);
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
        if (data.permitEnrichment?.ran && data.permitEnrichment.byModule) {
          setLastEnrichmentResult({
            ran: true,
            success: data.permitEnrichment.success ?? 0,
            failed: data.permitEnrichment.failed ?? 0,
            byModule: data.permitEnrichment.byModule ?? {},
          });
        }
        setSelectedListingIds(new Set());
        fetchCanonicalProperties();
        fetchPipelineStats(true);
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
    setSelectedListingIds(new Set(filteredSortedListings.map((r) => r.id)));
  };

  const clearListingSelection = () => {
    setSelectedListingIds(new Set());
  };

  const handleRerunEnrichment = () => {
    if (canonicalProperties.length === 0) return;
    if (!confirm(`Re-run enrichment for all ${canonicalProperties.length} canonical propert${canonicalProperties.length === 1 ? "y" : "ies"}? This will refresh data from NYC Open Data (BBL is assumed already set).`)) return;
    setRerunningEnrichment(true);
    setError(null);
    setLastEnrichmentResult(null);
    setPipelineStatsOpen(true);
    fetch(`${API_BASE}/api/properties/run-enrichment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds: canonicalProperties.map((p) => p.id) }),
    })
      .then(async (r) => {
        const text = await r.text();
        let data: {
          error?: string;
          permitEnrichment?: { ran?: boolean; success?: number; failed?: number; byModule?: Record<string, number> };
          omFinancialsRefresh?: { documentsProcessed?: number; documentsSkippedNoFile?: number };
        };
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          if (text.trimStart().startsWith("<")) {
            throw new Error(`Server returned an HTML error page (${r.status}). Check that the API is running and the API URL is correct.`);
          }
          throw new Error(`Server returned invalid JSON (${r.status}). Check API logs.`);
        }
        if (!r.ok && data?.error) throw new Error(data.error);
        if (!r.ok) throw new Error(r.statusText || `Request failed (${r.status})`);
        return data;
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (data.permitEnrichment?.ran && data.permitEnrichment.byModule) {
          setLastEnrichmentResult({
            ran: true,
            success: data.permitEnrichment.success ?? 0,
            failed: data.permitEnrichment.failed ?? 0,
            byModule: data.permitEnrichment.byModule ?? {},
            omFinancialsProcessed: data.omFinancialsRefresh?.documentsProcessed,
            omFinancialsSkippedNoFile: data.omFinancialsRefresh?.documentsSkippedNoFile,
          });
        }
        fetchCanonicalProperties();
        fetchPipelineStats(true);
      })
      .catch((e) => setError(e.message || "Failed to re-run enrichment"))
      .finally(() => setRerunningEnrichment(false));
  };

  const handleRunRentalFlow = () => {
    if (canonicalProperties.length === 0) return;
    if (!confirm(`Run rental flow (RapidAPI + LLM) for all ${canonicalProperties.length} canonical propert${canonicalProperties.length === 1 ? "y" : "ies"}? This fetches rental data by URL and extracts financials from listing text.`)) return;
    setRunningRentalFlow(true);
    setError(null);
    fetch(`${API_BASE}/api/properties/run-rental-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds: canonicalProperties.map((p) => p.id) }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        fetchCanonicalProperties();
        const withUnits = (data.results ?? []).filter((r: { rentalUnitsCount?: number }) => (r.rentalUnitsCount ?? 0) > 0).length;
        const withLlm = (data.results ?? []).filter((r: { hasLlmFinancials?: boolean }) => r.hasLlmFinancials).length;
        alert(`Done. ${withUnits} propert${withUnits === 1 ? "y" : "ies"} with rental units; ${withLlm} with LLM financials.`);
      })
      .catch((e) => setError(e.message || "Run rental flow failed"))
      .finally(() => setRunningRentalFlow(false));
  };

  const allSelected = filteredSortedListings.length > 0 && filteredSortedListings.every((l) => selectedListingIds.has(l.id));
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
        <div className="property-data-filters" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Sort by</span>
            <select
              className="input-text property-data-filter-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "price" | "listedAt" | "area")}
              aria-label="Sort by"
            >
              <option value="price">Price</option>
              <option value="listedAt">Listed date</option>
              <option value="area">Area</option>
            </select>
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Direction</span>
            <select
              className="input-text property-data-filter-select"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              aria-label="Sort direction"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Area</span>
            <select
              className="input-text property-data-filter-select"
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              aria-label="Filter by area"
            >
              {AREA_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Min price</span>
            <input
              type="text"
              className="input-text"
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              aria-label="Minimum price"
              style={{ width: "5rem" }}
            />
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Max price</span>
            <input
              type="text"
              className="input-text"
              placeholder="Max"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              aria-label="Maximum price"
              style={{ width: "5rem" }}
            />
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Listed after</span>
            <input
              type="date"
              className="input-text"
              value={listedAfter}
              onChange={(e) => setListedAfter(e.target.value)}
              aria-label="Listed after date"
            />
          </label>
          <label className="property-data-filter-label" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>Listed before</span>
            <input
              type="date"
              className="input-text"
              value={listedBefore}
              onChange={(e) => setListedBefore(e.target.value)}
              aria-label="Listed before date"
            />
          </label>
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
                      <th style={{ width: "2rem" }} aria-label="Save deal" title="Save / Unsave deal" />
                      <th>Canonical address</th>
                      <th>Area</th>
                      <th>Price</th>
                      <th>Listed date</th>
                      <th>OM status</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSortedCanonical.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: "2rem", color: "#737373", textAlign: "center" }}>
                          {canonicalProperties.length === 0
                            ? "No canonical properties yet. Properties added from Runs are added to canonical automatically."
                            : "No properties match the current filters."}
                        </td>
                      </tr>
                    ) : (
                      filteredSortedCanonical.map((prop) => {
                        const area = prop.primaryListing?.city != null ? cityToArea(prop.primaryListing.city) : cityFromCanonicalAddress(prop.canonicalAddress);
                        return (
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
                              <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (savedDealsLoading.has(prop.id)) return;
                                    const isSaved = savedPropertyIds.has(prop.id);
                                    setSavedDealsLoading((prev) => new Set(prev).add(prop.id));
                                    const url = `${API_BASE}/api/profile/saved-deals`;
                                    (isSaved
                                      ? fetch(`${url}/${encodeURIComponent(prop.id)}`, { method: "DELETE" })
                                      : fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: prop.id }) })
                                    )
                                      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
                                      .then(({ ok }) => {
                                        // #region agent log
                                        fetch("http://127.0.0.1:7590/ingest/742bd78a-5157-440b-b6aa-e9509cd8e861",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"fd8b77"},body:JSON.stringify({sessionId:"fd8b77",location:"property-data/page.tsx:star-response",message:"Star save/unsave response",data:{isSaved,ok},timestamp:Date.now(),hypothesisId:"H1"})}).catch(()=>{});
                                        // #endregion
                                        if (!ok) return;
                                        setSavedPropertyIds((prev) => {
                                          const next = new Set(prev);
                                          if (isSaved) next.delete(prop.id);
                                          else next.add(prop.id);
                                          return next;
                                        });
                                      })
                                      .catch(() => {})
                                      .finally(() => setSavedDealsLoading((prev) => { const n = new Set(prev); n.delete(prop.id); return n; }));
                                  }}
                                  title={savedPropertyIds.has(prop.id) ? "Unsave deal" : "Save deal"}
                                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.25rem", lineHeight: 1 }}
                                  aria-label={savedPropertyIds.has(prop.id) ? "Unsave deal" : "Save deal"}
                                >
                                  {savedPropertyIds.has(prop.id) ? "★" : "☆"}
                                </button>
                              </td>
                              <td>{prop.canonicalAddress}</td>
                              <td>{area}</td>
                              <td>{prop.primaryListing?.price != null ? formatPrice(prop.primaryListing.price) : "—"}</td>
                              <td>{formatListedDate(prop.primaryListing?.listedAt ?? null)}</td>
                              <td>{prop.omStatus ?? "—"}</td>
                              <td>{prop.dealScore != null ? prop.dealScore : "—"}</td>
                            </tr>
                            {expandedCanonicalId === prop.id && (
                              <tr className="property-data-detail-row">
                                <td colSpan={8} className="property-data-detail-cell" style={{ padding: "1rem 1rem 1rem 2.5rem", backgroundColor: "#fafafa" }}>
                                  <CanonicalPropertyDetail
                                    property={prop}
                                    isSaved={savedPropertyIds.has(prop.id)}
                                    onSavedChange={(propertyId, saved) => {
                                      if (saved) setSavedPropertyIds((prev) => new Set(prev).add(propertyId));
                                      else setSavedPropertyIds((prev) => {
                                        const next = new Set(prev);
                                        next.delete(propertyId);
                                        return next;
                                      });
                                    }}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
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
                    {filteredSortedListings.length > 0 && (
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
                  <th>Price</th>
                  <th>Area</th>
                  <th>Listed date</th>
                  <th>Days on market</th>
                  <th>Dup. Conf.</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredSortedListings.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: "2rem", color: "#737373", textAlign: "center" }}>
                      {listings.length === 0
                        ? "No raw listings yet. Run a flow from Runs, then use \"Send to property data\" for a completed run."
                        : "No listings match the current filters."}
                    </td>
                  </tr>
                ) : (
                  filteredSortedListings.map((row) => (
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
                        <td>{formatPrice(row.price)}</td>
                        <td>{cityToArea(row.city)}</td>
                        <td>{formatListedDate(row.listedAt)}</td>
                        <td>{daysOnMarket(row.listedAt) != null ? `${daysOnMarket(row.listedAt)} days` : "—"}</td>
                        <td style={dupConfStyle(row.duplicateScore)} title="Duplicate likelihood (100 = likely duplicate)">
                          {row.duplicateScore != null ? row.duplicateScore : "—"}
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
                          <td colSpan={11} className="property-data-detail-cell" style={{ paddingLeft: "2.5rem", backgroundColor: "#fafafa" }}>
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
          {activeTab === "raw"
            ? total > 0
              ? someSelected
                ? `${selectedListingIds.size} of ${filteredSortedListings.length} selected`
                : filteredSortedListings.length < total
                  ? `${filteredSortedListings.length} of ${total} raw listing(s)`
                  : `${total} raw listing(s)`
              : "No raw listings"
            : canonicalProperties.length > 0
              ? filteredSortedCanonical.length < canonicalProperties.length
                ? `${filteredSortedCanonical.length} of ${canonicalProperties.length} canonical propert${canonicalProperties.length === 1 ? "y" : "ies"}`
                : `${canonicalProperties.length} canonical propert${canonicalProperties.length === 1 ? "y" : "ies"}`
              : "No canonical properties"}
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
            disabled={Boolean(activeTab !== "raw" || total === 0 || sendingToCanonical)}
            title={someSelected ? "Send selected to canonical and run enrichment" : "Create canonical properties from all raw listings and link them"}
          >
            {sendingToCanonical ? "Sending…" : someSelected ? `Add ${selectedListingIds.size} to canonical` : "Add to canonical properties"}
          </button>
          {activeTab === "canonical" && canonicalProperties.length > 0 && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRerunEnrichment}
                disabled={Boolean(rerunningEnrichment)}
                title="Re-run enrichment for all canonical properties (BBL assumed already set). Refreshes data from NYC Open Data."
              >
                {rerunningEnrichment ? "Re-running…" : "Re-run enrichment"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRunRentalFlow}
                disabled={Boolean(runningRentalFlow)}
                title="Run rental flow (steps 1+2): RapidAPI rental-by-URL + LLM on listing description. Fetches rental units and extracts NOI, cap rate, etc."
              >
                {runningRentalFlow ? "Running…" : "Run rental flow"}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={openReviewDup}
            disabled={Boolean(activeTab !== "raw" || total === 0)}
            title="Review potential duplicate listings (score ≥ 80)"
          >
            Review duplicates
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClearRawListings}
            disabled={Boolean(clearing || total === 0)}
            title="Remove all raw listings and their snapshots. Cannot be undone."
          >
            {clearing ? "Clearing…" : "Clear raw listings"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClearCanonicalProperties}
            disabled={Boolean(clearingCanonical || canonicalProperties.length === 0)}
            title="Remove all canonical properties and their matches/enrichment data. Cannot be undone."
          >
            {clearingCanonical ? "Clearing…" : "Clear canonical properties"}
          </button>
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
                            disabled={Boolean(deletingId === row.id)}
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
        {(sendingToCanonical || rerunningEnrichment || runningRentalFlow || lastEnrichmentResult) && (
          <div
            className="card"
            role="status"
            aria-live="polite"
            style={{
              marginBottom: "1rem",
              padding: "1rem",
              maxWidth: "720px",
              background: sendingToCanonical || rerunningEnrichment || runningRentalFlow ? "#fef9c3" : "#f0fdf4",
              borderColor: sendingToCanonical || rerunningEnrichment || runningRentalFlow ? "#facc15" : "#86efac",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1rem", fontWeight: 600 }}>
              Enrichment run
            </h3>
            {sendingToCanonical || rerunningEnrichment || runningRentalFlow ? (
              <p style={{ margin: 0, color: "#854d0e" }}>
                {sendingToCanonical
                  ? "Enrichment in progress… Creating canonical properties and running all modules (Phase 1, Permits, Zoning, CO, HPD, etc.). This may take a minute."
                  : runningRentalFlow
                    ? "Running rental flow… Fetching rental data (RapidAPI) and extracting financials from listing text (LLM). This may take a few minutes."
                    : "Re-running enrichment for existing canonical properties… Refreshing data from NYC Open Data. This may take a minute."}
              </p>
            ) : lastEnrichmentResult ? (
              <>
                <p style={{ margin: "0 0 0.75rem 0" }}>
                  Last enrichment: <strong>{lastEnrichmentResult.success} succeeded</strong>
                  {lastEnrichmentResult.failed > 0 && (
                    <>, <strong>{lastEnrichmentResult.failed} failed</strong></>
                  )}.
                  {(lastEnrichmentResult.omFinancialsProcessed != null || lastEnrichmentResult.omFinancialsSkippedNoFile != null) && (
                    <> OM financials: <strong>{lastEnrichmentResult.omFinancialsProcessed ?? 0} doc(s) processed</strong>
                      {(lastEnrichmentResult.omFinancialsSkippedNoFile ?? 0) > 0 && (
                        <>; <strong>{lastEnrichmentResult.omFinancialsSkippedNoFile} skipped</strong> (file not on disk — use persistent storage on Render)</>
                      )}
                    </>
                  )}
                </p>
                <table className="property-data-table" style={{ fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th style={{ textAlign: "right" }}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(lastEnrichmentResult.byModule)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, count]) => (
                        <tr key={key}>
                          <td>{ENRICHMENT_MODULE_LABELS[key] ?? key}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        )}

        <button
          type="button"
          className="property-detail-section-header"
          onClick={() => setPipelineStatsOpen((o) => !o)}
          aria-expanded={pipelineStatsOpen}
          style={{ width: "100%", maxWidth: "720px" }}
        >
          <span className="property-detail-section-title">Pipeline progress (raw → canonical → enrichment)</span>
          <span className={`property-detail-section-chevron ${pipelineStatsOpen ? "property-detail-section-chevron--open" : ""}`} aria-hidden>▼</span>
        </button>
        {pipelineStatsOpen && (
          <div className="property-data-run-log-table-wrap">
            {pipelineStats == null ? (
              <p style={{ color: "#737373", fontSize: "0.875rem" }}>Loading pipeline stats…</p>
            ) : (
              <table className="property-data-table" style={{ maxWidth: "720px", fontSize: "0.875rem" }}>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th style={{ textAlign: "right" }}>Count</th>
                    <th style={{ textAlign: "right" }}>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Raw listings</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pipelineStats.rawListings}</td>
                    <td style={{ textAlign: "right", color: "#737373" }}>—</td>
                  </tr>
                  <tr>
                    <td>Canonical properties</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pipelineStats.canonicalProperties}</td>
                    <td style={{ textAlign: "right", color: "#737373" }}>—</td>
                  </tr>
                  {pipelineStats.enrichment.map((row) => {
                    const remaining = Math.max(0, pipelineStats.canonicalProperties - row.completed);
                    const remainingInfo = pipelineStats.remainingByModule?.[row.key];
                    const remainingIds = remainingInfo?.propertyIds ?? [];
                    return (
                      <React.Fragment key={row.key}>
                        <tr>
                          <td>{row.label}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.completed}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: remaining > 0 ? "#854d0e" : "#737373" }}>
                            {remaining > 0 ? `${remaining} left` : "—"}
                          </td>
                        </tr>
                        {remaining > 0 && remainingIds.length > 0 && (
                          <tr>
                            <td colSpan={3} style={{ paddingTop: 0, paddingLeft: "1.5rem", fontSize: "0.8125rem", color: "#737373", verticalAlign: "top" }}>
                              Not yet completed:{" "}
                              {remainingIds
                                .map((id) => canonicalProperties.find((p) => p.id === id)?.canonicalAddress ?? id)
                                .join(", ")}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        <button
          type="button"
          className="property-detail-section-header"
          onClick={() => setRunLogOpen((o) => !o)}
          aria-expanded={runLogOpen}
          style={{ width: "100%", maxWidth: "640px", marginTop: "1rem" }}
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
