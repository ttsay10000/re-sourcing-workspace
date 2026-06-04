"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { UiV2PipelineListPayload, UiV2PipelineRow } from "@re-sourcing/contracts";
import styles from "./home.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

type PipelineResponse = { pipeline?: UiV2PipelineListPayload; error?: string; details?: string };
type SavedDealsResponse = {
  savedDeals?: {
    rows?: SavedDealRow[];
    total?: number;
  };
  error?: string;
  details?: string;
};
type ProgressResponse = {
  summary?: Record<string, number | null | undefined>;
  sections?: Array<{ id: string; label?: string; count?: number; rows?: HomeProgressRow[] }>;
  error?: string;
  details?: string;
};
type SavedDealRow = {
  savedDeal?: {
    id?: string;
    propertyId?: string;
    dealStatus?: string;
    createdAt?: string;
  };
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  source?: string | null;
  price?: number | null;
  units?: number | null;
  pricePerUnit?: number | null;
  pricePerSqft?: number | null;
  capRate?: number | null;
  dealScore?: number | null;
  status?: string | null;
  omStatus?: string | null;
  documentCount?: number | null;
  openActionItemCount?: number | null;
  neighborhood?: string | null;
  borough?: string | null;
  firstImageUrl?: string | null;
  listingUrl?: string | null;
  rejection?: { reasonLabel?: string | null; reasonCode?: string | null; note?: string | null } | null;
  updatedAt?: string | null;
};
type HomeProgressRow = {
  propertyId: string;
  displayAddress?: string | null;
  canonicalAddress?: string | null;
  source?: string | null;
  price?: number | null;
  units?: number | null;
  dealScore?: number | null;
  status?: string | null;
  omStatus?: string | null;
};

const SAVED_STAGE_GROUPS = [
  { key: "contract_signed", label: "Contract Signed", statuses: ["contract_signed"] },
  { key: "negotiation", label: "Negotiation", statuses: ["negotiation"] },
  { key: "loi_sent", label: "LOI Sent", statuses: ["offer_review"] },
  { key: "underwriting", label: "Underwriting", statuses: ["underwriting", "om_received", "dossier_generated"] },
  { key: "om_requested", label: "OM Requested", statuses: ["outreach", "awaiting_broker"] },
  { key: "sourced", label: "Sourced", statuses: ["new", "screening", "interesting", "saved"] },
] as const;

const CLOSED_STATUSES = new Set(["deal_closed", "archived", "closed"]);
const REJECTED_STATUSES = new Set(["rejected"]);

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function titleize(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bOm\b/g, "OM")
    .replace(/\bNoi\b/g, "NOI")
    .replace(/\bPsf\b/g, "PSF")
    .replace(/\bSf\b/g, "SF");
}

const AREA_LABELS: Record<string, string> = {
  fultonseaport: "Fulton Seaport",
  "fulton-seaport": "Fulton Seaport",
  "hells-kitchen": "Hell's Kitchen",
  nomad: "NoMad",
  noho: "NoHo",
  "sutton-place": "Sutton Place",
  soho: "SoHo",
  tribeca: "TriBeCa",
};

function areaLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return AREA_LABELS[normalized] ?? titleize(normalized);
}

function locationSubtitle(row: Pick<UiV2PipelineRow, "neighborhood" | "borough">): string {
  const seen = new Set<string>();
  const parts = [row.neighborhood, row.borough]
    .flatMap((value) => String(value ?? "").split(/[·/,]/g))
    .map((value) => areaLabel(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return parts.join(" · ");
}

function scoreClass(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return styles.scoreMuted;
  if (score >= 50) return styles.scoreGood;
  return styles.scoreBad;
}

function rowScore(row: UiV2PipelineRow | HomeProgressRow | SavedDealRow): number | null {
  return "statusChip" in row ? row.underwriting?.dealScore ?? null : row.dealScore ?? null;
}

function rowAddress(row: UiV2PipelineRow | HomeProgressRow | SavedDealRow): string {
  return row.displayAddress ?? row.canonicalAddress ?? "Property";
}

function unitLabel(units: number | null | undefined): string | null {
  if (units == null || !Number.isFinite(units) || units <= 0) return null;
  const rounded = Math.round(units);
  return `${rounded} ${rounded === 1 ? "unit" : "units"}`;
}

function HomePageContent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [pipelineRows, setPipelineRows] = useState<UiV2PipelineRow[]>([]);
  const [savedRows, setSavedRows] = useState<SavedDealRow[]>([]);
  const [pipelineTotal, setPipelineTotal] = useState(0);
  const [progressRows, setProgressRows] = useState<HomeProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminalCounter, setTerminalCounter] = useState<"closed" | "rejected">("closed");
  const [openAttentionGroups, setOpenAttentionGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let ignore = false;
    async function loadHome() {
      setLoading(true);
      setError(null);
      try {
        const [pipelineResponse, progressResponse, savedResponse] = await Promise.all([
          fetch(`${API_BASE}/api/ui-v2/pipeline?limit=250&includeRejected=true`, { credentials: "include" }),
          fetch(`${API_BASE}/api/ui-v2/deal-progress`, { credentials: "include" }),
          fetch(`${API_BASE}/api/ui-v2/saved-deals?limit=250`, { credentials: "include" }),
        ]);
        const pipelineData = (await pipelineResponse.json().catch(() => ({}))) as PipelineResponse;
        const progressData = (await progressResponse.json().catch(() => ({}))) as ProgressResponse;
        const savedData = (await savedResponse.json().catch(() => ({}))) as SavedDealsResponse;
        if (!pipelineResponse.ok) throw new Error(pipelineData.error || pipelineData.details || "Failed to load pipeline.");
        if (!progressResponse.ok) throw new Error(progressData.error || progressData.details || "Failed to load progress.");
        if (!savedResponse.ok) throw new Error(savedData.error || savedData.details || "Failed to load saved deals.");
        if (ignore) return;
        setPipelineRows(pipelineData.pipeline?.rows ?? []);
        setPipelineTotal(pipelineData.pipeline?.total ?? 0);
        setSavedRows(savedData.savedDeals?.rows ?? []);
        setProgressRows((progressData.sections ?? []).flatMap((section) => section.rows ?? []));
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load home dashboard.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void loadHome();
    return () => {
      ignore = true;
    };
  }, []);

  const filteredSavedRows = useMemo(() => {
    if (!query) return savedRows;
    return savedRows.filter((row) =>
      [
        row.propertyId,
        row.canonicalAddress,
        row.displayAddress,
        row.source,
        row.neighborhood,
        row.borough,
        row.status,
        row.savedDeal?.dealStatus,
        row.omStatus,
        row.rejection?.reasonCode,
        row.rejection?.reasonLabel,
        row.rejection?.note,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [query, savedRows]);

  const savedStageGroups = useMemo(() => {
    const assigned = new Set<string>();
    const rowsForStatusGroup = (statuses: readonly string[]) =>
      filteredSavedRows.filter((row) => {
        if (assigned.has(row.propertyId)) return false;
        const status = String(row.status ?? row.savedDeal?.dealStatus ?? "saved");
        if (!statuses.includes(status)) return false;
        assigned.add(row.propertyId);
        return true;
      });
    const groups = SAVED_STAGE_GROUPS.map((stage) => ({
      ...stage,
      rows: rowsForStatusGroup(stage.statuses),
    }));
    const unassigned = filteredSavedRows.filter((row) => {
      const status = String(row.status ?? row.savedDeal?.dealStatus ?? "saved");
      return !assigned.has(row.propertyId) && !CLOSED_STATUSES.has(status) && !REJECTED_STATUSES.has(status) && !row.rejection;
    });
    if (unassigned.length > 0) {
      const sourced = groups.find((group) => group.key === "sourced");
      if (sourced) sourced.rows = [...sourced.rows, ...unassigned];
    }
    return groups;
  }, [filteredSavedRows]);

  const terminalSavedCounts = useMemo(() => {
    const closed = filteredSavedRows.filter((row) => CLOSED_STATUSES.has(String(row.status ?? row.savedDeal?.dealStatus ?? ""))).length;
    const rejected = filteredSavedRows.filter((row) => REJECTED_STATUSES.has(String(row.status ?? row.savedDeal?.dealStatus ?? "")) || row.rejection != null).length;
    return { closed, rejected };
  }, [filteredSavedRows]);

  const attentionItems = useMemo(() => {
    const missingEnrichment = pipelineRows.filter((row) => row.enrichmentState?.status !== "complete").slice(0, 5);
    const missingDocs = pipelineRows.filter((row) => !row.documentStatus?.hasOm).slice(0, 5);
    const missingBroker = pipelineRows.filter((row) => !row.broker?.email).slice(0, 5);
    return [
      { label: "Missing enrichment", icon: "!", tone: "warning", count: missingEnrichment.length, rows: missingEnrichment },
      { label: "Missing rental flow", icon: "R", tone: "neutral", count: pipelineRows.filter((row) => row.openActionItemCount).length, rows: progressRows.slice(0, 5) },
      { label: "Missing broker contact", icon: "@", tone: "danger", count: missingBroker.length, rows: missingBroker },
      { label: "Needs OM request", icon: "OM", tone: "warning", count: missingDocs.length, rows: missingDocs },
    ];
  }, [pipelineRows, progressRows]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1>Acquisitions dashboard</h1>
          <p>
            Manhattan multifamily &amp; mixed-use ·{" "}
            {loading ? "loading…" : `${filteredSavedRows.length} saved deals · ${pipelineTotal} sourced properties`}
          </p>
        </div>
        <div className={styles.headerMeta}>
          <div>Last refresh · {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
          <div>Source: StreetEasy · broker network · city data</div>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {query ? <div className={styles.notice}>Filtered by: <strong>{searchParams.get("q")}</strong></div> : null}

      <section aria-label="Saved deal status overview">
        <div className={styles.statusCards}>
          {savedStageGroups.map((group) => (
            <Link key={group.key} href="/saved" className={`${styles.statusCard} ${group.key === "contract_signed" ? styles.green : group.key === "underwriting" ? styles.blue : styles.neutral}`}>
              <span>{group.label}</span>
              <strong>{group.rows.length}</strong>
            </Link>
          ))}
        </div>
        <div className={styles.terminalCounter}>
          <div className={styles.segmentedControl} aria-label="Closed or rejected counter">
            <button
              type="button"
              className={terminalCounter === "closed" ? styles.segmentActive : undefined}
              onClick={() => setTerminalCounter("closed")}
            >
              Closed
            </button>
            <button
              type="button"
              className={terminalCounter === "rejected" ? styles.segmentActive : undefined}
              onClick={() => setTerminalCounter("rejected")}
            >
              Rejected
            </button>
          </div>
          <strong>{terminalCounter === "closed" ? terminalSavedCounts.closed : terminalSavedCounts.rejected}</strong>
          <span>{terminalCounter === "closed" ? "saved deals closed" : "saved deals rejected"}</span>
        </div>
      </section>

      <div className={styles.dashboardGrid}>
        <section className={styles.dealsPanel}>
          <div className={styles.panelHeader}>
            <h2>Saved Deals By Status</h2>
            <span>{filteredSavedRows.length} saved deal{filteredSavedRows.length === 1 ? "" : "s"}</span>
          </div>
          <div className={styles.savedStageList}>
            {savedStageGroups.map((group) => (
              <section key={group.key} className={styles.savedStage}>
                <div className={styles.savedStageHeader}>
                  <h3>{group.label}</h3>
                  <span>{group.rows.length}</span>
                </div>
                {group.rows.length > 0 ? (
                  <div className={styles.savedDealRows}>
                    {group.rows.slice(0, 8).map((row) => {
                      const score = rowScore(row);
                      const subtitle = [locationSubtitle(row), unitLabel(row.units)].filter(Boolean).join(" · ");
                      return (
                        <Link key={row.propertyId} href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`} className={styles.savedDealRow}>
                          {row.firstImageUrl ? <img src={row.firstImageUrl} alt="" /> : <span className={styles.thumbnailFallback}>{rowAddress(row).charAt(0)}</span>}
                          <span>
                            <strong>{rowAddress(row)}</strong>
                            <small>{subtitle || titleize(row.source)}</small>
                          </span>
                          <em>{formatCurrency(row.price)}</em>
                          <span className={`${styles.scorePill} ${scoreClass(score)}`}>
                            <strong>{score == null ? "—" : Math.round(score)}</strong>
                            <em> /100</em>
                          </span>
                          <small>{titleize(row.omStatus ?? "no_om")}</small>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.emptyStage}>No saved deals in this stage.</div>
                )}
              </section>
            ))}
          </div>
        </section>

        <aside className={styles.attentionPanel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Needs attention</h2>
              <p>{attentionItems.reduce((sum, item) => sum + item.count, 0)} items across {attentionItems.length} categories</p>
            </div>
            <Link href="/progress">View all</Link>
          </div>
          {attentionItems.map((group) => {
            const isOpen = openAttentionGroups[group.label] !== false;
            return (
              <section key={group.label} className={styles.attentionGroup}>
                <button
                  className={styles.attentionToggle}
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenAttentionGroups((current) => ({ ...current, [group.label]: !isOpen }))}
                >
                  <span className={`${styles.attentionIcon} ${styles[`attentionTone${titleize(group.tone)}`]}`} aria-hidden="true">{group.icon}</span>
                  <strong>{group.label}</strong>
                  <span>{group.count}</span>
                  <i aria-hidden="true">{isOpen ? "−" : "+"}</i>
                </button>
                {isOpen ? (
                  <div className={styles.attentionRows}>
                    {group.rows.slice(0, 4).map((row) => (
                      <Link key={row.propertyId} href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`}>
                        <span>{rowAddress(row)}</span>
                        <small>{"neighborhood" in row ? areaLabel(row.neighborhood) ?? "" : ""}</small>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </aside>
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<main className={styles.page}>Loading dashboard...</main>}>
      <HomePageContent />
    </Suspense>
  );
}
