"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { UiV2PipelineListPayload, UiV2PipelineRow } from "@re-sourcing/contracts";
import {
  AlertTriangle,
  CalendarClock,
  FileQuestion,
  MailX,
  Minus,
  Plus,
  RefreshCcw,
  type LucideIcon,
} from "lucide-react";
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
  ltrYocPct?: number | null;
  mtrYocPct?: number | null;
  hasOm?: boolean | null;
  hasComps?: boolean | null;
  hasDossier?: boolean | null;
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

type FunnelMetric = {
  key: SavedStageKey;
  label: string;
  count: number;
  href: string;
  subMetric?: {
    label: string;
    count: number;
    tone?: "danger" | "neutral";
  };
};
type AttentionGroup = {
  count: number;
  icon: LucideIcon;
  label: string;
  rows: Array<UiV2PipelineRow | HomeProgressRow>;
  tone: "warning" | "neutral" | "danger";
};

const SAVED_STAGE_GROUPS = [
  { key: "sourced", label: "Sourced", statuses: ["new", "screening", "interesting", "saved"] },
  { key: "om_requested", label: "OM Requested", statuses: ["outreach", "awaiting_broker"] },
  { key: "underwriting", label: "Underwriting", statuses: ["underwriting", "om_received", "dossier_generated"] },
  { key: "tour_scheduled", label: "Tour Scheduled", statuses: ["tour_scheduled"] },
  { key: "tour_completed_awaiting_inputs", label: "Awaiting Inputs", statuses: ["tour_completed_awaiting_inputs"] },
  { key: "loi_sent", label: "LOI Sent", statuses: ["offer_review"] },
  { key: "negotiation", label: "Negotiation", statuses: ["negotiation"] },
  { key: "contract_signed", label: "Contract Signed", statuses: ["contract_signed"] },
] as const;

type SavedStageKey = (typeof SAVED_STAGE_GROUPS)[number]["key"];

const WORKLIST_STAGE_KEYS = new Set<SavedStageKey>([
  "underwriting",
  "tour_scheduled",
  "tour_completed_awaiting_inputs",
  "loi_sent",
  "negotiation",
  "contract_signed",
]);
const TOUR_STAGE_STATUSES = new Set(["tour_scheduled", "tour_completed_awaiting_inputs"]);
const LATER_STAGE_STATUSES = new Set(["tour_scheduled", "tour_completed_awaiting_inputs", "offer_review", "negotiation", "contract_signed"]);
const CLOSED_STATUSES = new Set(["deal_closed", "archived", "closed"]);
const REJECTED_STATUSES = new Set(["rejected"]);
const OM_REQUESTED_STATUSES = new Set(["outreach", "awaiting_broker"]);
const OM_EVIDENCE_STATUSES = new Set(["available", "completed", "promoted", "needs_review"]);

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(1)}%`;
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

function normalizedSavedStatus(row: SavedDealRow): string {
  return String(row.status ?? row.savedDeal?.dealStatus ?? "saved");
}

function rowHasOm(row: SavedDealRow): boolean {
  if (row.hasOm != null) return row.hasOm;
  const status = String(row.omStatus ?? "").trim().toLowerCase();
  return ["received", "needs_review", "promoted", "complete", "completed"].includes(status);
}

function rowHasComps(row: SavedDealRow): boolean {
  return row.hasComps === true;
}

function rowHasDossier(row: SavedDealRow): boolean {
  return row.hasDossier === true || normalizedSavedStatus(row) === "dossier_generated";
}

function savedStageKeyForRow(row: SavedDealRow): SavedStageKey | null {
  const status = normalizedSavedStatus(row);
  if (CLOSED_STATUSES.has(status) || REJECTED_STATUSES.has(status) || row.rejection) return null;
  const explicitStage = SAVED_STAGE_GROUPS.find((stage) => (stage.statuses as readonly string[]).includes(status))?.key;
  if (explicitStage && explicitStage !== "sourced") return explicitStage;
  if (TOUR_STAGE_STATUSES.has(status)) return explicitStage ?? "underwriting";
  if (rowHasOm(row) && !LATER_STAGE_STATUSES.has(status)) return "underwriting";
  return explicitStage ?? "sourced";
}

function pipelineStatus(row: UiV2PipelineRow): string {
  return String(row.statusChip?.status ?? "");
}

function pipelineIsTerminal(row: UiV2PipelineRow): boolean {
  const status = pipelineStatus(row);
  return CLOSED_STATUSES.has(status) || REJECTED_STATUSES.has(status) || status === "archived";
}

function pipelineHasOmRequest(row: UiV2PipelineRow): boolean {
  const omStatus = String(row.documentStatus?.omStatus ?? "").trim().toLowerCase();
  return Boolean(row.documentStatus?.latestRequestAt) || omStatus === "requested" || OM_REQUESTED_STATUSES.has(pipelineStatus(row));
}

function pipelineHasOmEvidence(row: UiV2PipelineRow): boolean {
  const omStatus = String(row.documentStatus?.omStatus ?? "").trim().toLowerCase();
  return row.documentStatus?.hasOm === true || OM_EVIDENCE_STATUSES.has(omStatus);
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
    return SAVED_STAGE_GROUPS.map((stage) => ({
      ...stage,
      rows: filteredSavedRows.filter((row) => savedStageKeyForRow(row) === stage.key),
    }));
  }, [filteredSavedRows]);

  const worklistStageGroups = useMemo(
    () => savedStageGroups.filter((group) => WORKLIST_STAGE_KEYS.has(group.key)),
    [savedStageGroups]
  );
  const worklistCount = useMemo(
    () => worklistStageGroups.reduce((sum, group) => sum + group.rows.length, 0),
    [worklistStageGroups]
  );

  const terminalSavedCounts = useMemo(() => {
    const closed = filteredSavedRows.filter((row) => CLOSED_STATUSES.has(normalizedSavedStatus(row))).length;
    const rejected = filteredSavedRows.filter((row) => REJECTED_STATUSES.has(normalizedSavedStatus(row)) || row.rejection != null).length;
    return { closed, rejected };
  }, [filteredSavedRows]);

  const funnelMetrics = useMemo<FunnelMetric[]>(() => {
    const rejected = pipelineRows.filter((row) => REJECTED_STATUSES.has(pipelineStatus(row))).length;
    const omRequested = pipelineRows.filter((row) =>
      !pipelineIsTerminal(row) &&
      pipelineHasOmRequest(row) &&
      !pipelineHasOmEvidence(row)
    ).length;
    const underwriting = pipelineRows.filter((row) =>
      !pipelineIsTerminal(row) &&
      pipelineHasOmEvidence(row) &&
      !LATER_STAGE_STATUSES.has(pipelineStatus(row))
    ).length;
    const tourScheduled = pipelineRows.filter((row) => pipelineStatus(row) === "tour_scheduled").length;
    const awaitingInputs = pipelineRows.filter((row) => pipelineStatus(row) === "tour_completed_awaiting_inputs").length;
    const loiSent = pipelineRows.filter((row) => pipelineStatus(row) === "offer_review").length;
    const negotiation = pipelineRows.filter((row) => pipelineStatus(row) === "negotiation").length;
    const contractSigned = pipelineRows.filter((row) => pipelineStatus(row) === "contract_signed").length;
    return [
      {
        key: "sourced",
        label: "Sourced",
        count: pipelineTotal,
        href: "/pipeline",
        subMetric: { label: "Rejected", count: rejected, tone: "danger" },
      },
      { key: "om_requested", label: "OM Requested", count: omRequested, href: "/pipeline" },
      { key: "underwriting", label: "Underwriting", count: underwriting, href: "/pipeline" },
      { key: "tour_scheduled", label: "Tour Scheduled", count: tourScheduled, href: "/pipeline?status=tour_scheduled" },
      { key: "tour_completed_awaiting_inputs", label: "Awaiting Inputs", count: awaitingInputs, href: "/pipeline?status=tour_completed_awaiting_inputs" },
      { key: "loi_sent", label: "LOI Sent", count: loiSent, href: "/pipeline" },
      { key: "negotiation", label: "Negotiation", count: negotiation, href: "/pipeline" },
      { key: "contract_signed", label: "Contract Signed", count: contractSigned, href: "/pipeline" },
    ];
  }, [pipelineRows, pipelineTotal]);

  const attentionItems = useMemo<AttentionGroup[]>(() => {
    const missingEnrichment = pipelineRows.filter((row) => row.enrichmentState?.status !== "complete").slice(0, 5);
    const tourInputsNeeded = pipelineRows.filter((row) => pipelineStatus(row) === "tour_completed_awaiting_inputs");
    const missingDocs = pipelineRows.filter((row) => !row.documentStatus?.hasOm).slice(0, 5);
    const missingBroker = pipelineRows.filter((row) => !row.broker?.email).slice(0, 5);
    return [
      { label: "Missing enrichment", icon: AlertTriangle, tone: "warning", count: missingEnrichment.length, rows: missingEnrichment },
      { label: "Tour inputs needed", icon: CalendarClock, tone: "warning", count: tourInputsNeeded.length, rows: tourInputsNeeded.slice(0, 5) },
      { label: "Missing rental flow", icon: RefreshCcw, tone: "neutral", count: pipelineRows.filter((row) => row.openActionItemCount).length, rows: progressRows.slice(0, 5) },
      { label: "Missing broker contact", icon: MailX, tone: "danger", count: missingBroker.length, rows: missingBroker },
      { label: "Needs OM request", icon: FileQuestion, tone: "warning", count: missingDocs.length, rows: missingDocs },
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
        <div className={styles.stageStrip}>
          {funnelMetrics.map((metric) => (
            <Link key={metric.key} href={metric.href} className={styles.stageCell}>
              <span>{metric.label}</span>
              <strong>{metric.count}</strong>
              {metric.subMetric ? (
                <small className={`${styles.stageSubMetric} ${metric.subMetric.tone === "danger" ? styles.stageSubMetricDanger : ""}`}>
                  {metric.subMetric.label} <b>{metric.subMetric.count}</b>
                </small>
              ) : null}
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
            <h2>Saved Deal Flow</h2>
            <span>{worklistCount} underwriting+ deal{worklistCount === 1 ? "" : "s"}</span>
          </div>
          <div className={styles.savedStageList}>
            {worklistStageGroups.map((group) => (
              <section key={group.key} className={styles.savedStage}>
                <div className={styles.savedStageHeader}>
                  <h3>{group.label}</h3>
                  <span>{group.rows.length}</span>
                </div>
                {group.rows.length > 0 ? (
                  <div className={styles.savedDealRows}>
                    <div className={styles.savedDealHeaderRow} aria-hidden="true">
                      <span>Deal</span>
                      <span>Listed</span>
                      <span>YoC LTR</span>
                      <span>YoC MTR</span>
                      <span>Score</span>
                      <span>Workup</span>
                    </div>
                    {group.rows.map((row) => {
                      const score = rowScore(row);
                      const subtitle = [locationSubtitle(row), unitLabel(row.units)].filter(Boolean).join(" · ");
                      return (
                        <Link key={row.propertyId} href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`} className={styles.savedDealRow}>
                          {row.firstImageUrl ? <img src={row.firstImageUrl} alt="" /> : <span className={styles.thumbnailFallback}>{rowAddress(row).charAt(0)}</span>}
                          <span className={styles.savedDealTitle}>
                            <strong>{rowAddress(row)}</strong>
                            <small>{subtitle || titleize(row.source)}</small>
                          </span>
                          <span className={styles.metricCell}>
                            <small>Listed</small>
                            <strong>{formatCurrency(row.price)}</strong>
                          </span>
                          <span className={styles.metricCell}>
                            <small>YoC LTR</small>
                            <strong>{formatPercent(row.ltrYocPct)}</strong>
                          </span>
                          <span className={styles.metricCell}>
                            <small>YoC MTR</small>
                            <strong>{formatPercent(row.mtrYocPct)}</strong>
                          </span>
                          <span className={`${styles.scorePill} ${scoreClass(score)}`}>
                            <strong>{score == null ? "—" : Math.round(score)}</strong>
                            <em> /100</em>
                          </span>
                          <span className={styles.workflowBadges} aria-label="Deal workup status">
                            <span className={`${styles.workflowBadge} ${rowHasComps(row) ? styles.badgeReady : styles.badgeMissing}`}>Comps</span>
                            <span className={`${styles.workflowBadge} ${rowHasOm(row) ? styles.badgeReady : styles.badgeMissing}`}>OM</span>
                            <span className={`${styles.workflowBadge} ${rowHasDossier(row) ? styles.badgeReady : styles.badgeMissing}`}>UW</span>
                          </span>
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
            const AttentionIcon = group.icon;
            return (
              <section key={group.label} className={styles.attentionGroup}>
                <button
                  className={styles.attentionToggle}
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenAttentionGroups((current) => ({ ...current, [group.label]: !isOpen }))}
                >
                  <span className={`${styles.attentionIcon} ${styles[`attentionTone${titleize(group.tone)}`]}`} aria-hidden="true">
                    <AttentionIcon size={14} strokeWidth={2} />
                  </span>
                  <strong>{group.label}</strong>
                  <span>{group.count}</span>
                  <i aria-hidden="true">{isOpen ? <Minus size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2} />}</i>
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
