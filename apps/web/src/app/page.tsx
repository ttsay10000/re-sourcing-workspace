"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { DEAL_FLOW_STAGES, type UiV2PipelineListPayload, type UiV2PipelineRow } from "@re-sourcing/contracts";
import {
  AlertTriangle,
  CalendarClock,
  FileQuestion,
  FileSearch,
  MailX,
  Minus,
  Plus,
  RefreshCcw,
  type LucideIcon,
} from "lucide-react";
import { SkeletonRows } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import styles from "./home.module.css";

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
  summary?: { updatedAt?: string | null } & Record<string, number | string | null | undefined>;
  sections?: HomeProgressSection[];
  error?: string;
  details?: string;
};

type DigestPreview = {
  newProperties?: number;
  updatedProperties?: number;
  omGeneratedCount?: number;
  dossierGeneratedCount?: number;
  error?: string;
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
  ltrYocPct?: number | null;
  mtrYocPct?: number | null;
  hasOm?: boolean | null;
  hasComps?: boolean | null;
  hasDossier?: boolean | null;
  neighborhood?: string | null;
  borough?: string | null;
  firstImageUrl?: string | null;
};

type HomeProgressSection = {
  id: string;
  label?: string;
  count?: number;
  rows?: HomeProgressRow[];
};

type FunnelMetric = {
  key: string;
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

// Same columns as the Deal Progress board (shared constant) — the home
// funnel and the board always show identical steps and counts.
const WORKLIST_STAGE_KEYS = new Set<string>([
  "underwriting_awaiting_review",
  "underwriting_review_completed",
  "tour_requested",
  "tour_scheduled",
  "tour_completed_awaiting_inputs",
  "offer_review",
  "negotiation",
  "contract_signed",
]);
const CLOSED_STATUSES = new Set(["deal_closed", "archived", "closed"]);
const REJECTED_STATUSES = new Set(["rejected"]);

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

function progressRowHasOm(row: HomeProgressRow): boolean {
  if (row.hasOm != null) return row.hasOm;
  const status = String(row.omStatus ?? "").trim().toLowerCase();
  return ["received", "needs_review", "promoted", "complete", "completed"].includes(status);
}

function pipelineStatus(row: UiV2PipelineRow): string {
  return String(row.statusChip?.status ?? "");
}

function HomePageContent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [pipelineRows, setPipelineRows] = useState<UiV2PipelineRow[]>([]);
  const [savedRows, setSavedRows] = useState<SavedDealRow[]>([]);
  const [pipelineTotal, setPipelineTotal] = useState(0);
  const [progressSections, setProgressSections] = useState<HomeProgressSection[]>([]);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminalCounter, setTerminalCounter] = useState<"closed" | "rejected">("closed");
  const [openAttentionGroups, setOpenAttentionGroups] = useState<Record<string, boolean>>({});
  const [yieldFlagRows, setYieldFlagRows] = useState<HomeProgressRow[]>([]);

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
        setProgressSections(progressData.sections ?? []);
        setDataUpdatedAt(typeof progressData.summary?.updatedAt === "string" ? progressData.summary.updatedAt : null);
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load home dashboard.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void loadHome();
    async function loadDigest() {
      try {
        const response = await fetch(`${API_BASE}/api/notifications/digest-preview`, { credentials: "include" });
        const data = (await response.json().catch(() => ({}))) as DigestPreview;
        if (!ignore && response.ok && !data.error) setDigest(data);
      } catch {
        // strip simply doesn't render
      }
    }
    void loadDigest();
    async function loadYieldFlags() {
      try {
        const response = await fetch(`${API_BASE}/api/comps/operating?flagged=1`, { credentials: "include" });
        const data = (await response.json().catch(() => ({}))) as {
          comps?: Array<{ propertyId: string; canonicalAddress: string; neighborhood?: string | null; yieldFlagDetail?: string | null }>;
          error?: string;
        };
        if (ignore || !response.ok || data.error) return;
        setYieldFlagRows(
          (data.comps ?? []).map((comp) => ({
            propertyId: comp.propertyId,
            canonicalAddress: comp.canonicalAddress,
            displayAddress: comp.canonicalAddress,
            neighborhood: comp.neighborhood ?? null,
          }))
        );
      } catch {
        // group simply doesn't render
      }
    }
    void loadYieldFlags();
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

  // Board sections, filtered by the global search like everything else.
  const filteredProgressSections = useMemo(() => {
    if (!query) return progressSections;
    return progressSections.map((section) => ({
      ...section,
      rows: (section.rows ?? []).filter((row) =>
        [row.propertyId, row.canonicalAddress, row.displayAddress, row.source, row.neighborhood, row.borough, row.status, row.omStatus]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      ),
    }));
  }, [progressSections, query]);

  const progressSectionById = useMemo(
    () => new Map(filteredProgressSections.map((section) => [section.id, section])),
    [filteredProgressSections]
  );

  const worklistStageGroups = useMemo(
    () =>
      DEAL_FLOW_STAGES.filter((stage) => WORKLIST_STAGE_KEYS.has(stage.id)).map((stage) => {
        const section = progressSectionById.get(stage.id);
        return { key: stage.id, label: stage.label, rows: section?.rows ?? [] };
      }),
    [progressSectionById]
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

  // Funnel cells mirror the Deal Progress board: same stages, same counts.
  const funnelMetrics = useMemo<FunnelMetric[]>(() => {
    const rejected = pipelineRows.filter((row) => REJECTED_STATUSES.has(pipelineStatus(row))).length;
    return DEAL_FLOW_STAGES.filter((stage) => stage.id !== "deal_closed").map((stage) => {
      const section = progressSectionById.get(stage.id);
      const sectionCount = section?.count ?? section?.rows?.length ?? 0;
      if (stage.id === "sourced") {
        return {
          key: stage.id,
          label: stage.shortLabel,
          count: pipelineTotal,
          href: "/pipeline",
          subMetric: { label: "Rejected", count: rejected, tone: "danger" as const },
        };
      }
      return { key: stage.id, label: stage.shortLabel, count: sectionCount, href: "/progress" };
    });
  }, [pipelineRows, pipelineTotal, progressSectionById]);

  const attentionItems = useMemo<AttentionGroup[]>(() => {
    const missingEnrichment = pipelineRows.filter((row) => row.enrichmentState?.status !== "complete").slice(0, 5);
    const tourInputsNeeded = pipelineRows.filter((row) => pipelineStatus(row) === "tour_completed_awaiting_inputs");
    const missingDocs = pipelineRows.filter((row) => !row.documentStatus?.hasOm).slice(0, 5);
    const missingBroker = pipelineRows.filter((row) => !row.broker?.email).slice(0, 5);
    const openActionRows = pipelineRows.filter((row) => row.openActionItemCount);
    // New underwriting extracted but not yet trusted — a human has to promote/reject it.
    const omNeedsReview = pipelineRows.filter(
      (row) => String(row.documentStatus?.omStatus ?? "").trim().toLowerCase() === "needs_review"
    );
    return [
      // 0%/negative cap or $0 NOI: excluded from Yield Map stats until the extraction is fixed.
      { label: "Yield data flags", icon: AlertTriangle, tone: "danger", count: yieldFlagRows.length, rows: yieldFlagRows.slice(0, 5) },
      { label: "OM review pending", icon: FileSearch, tone: "warning", count: omNeedsReview.length, rows: omNeedsReview.slice(0, 5) },
      { label: "Missing enrichment", icon: AlertTriangle, tone: "warning", count: missingEnrichment.length, rows: missingEnrichment },
      { label: "Tour inputs needed", icon: CalendarClock, tone: "warning", count: tourInputsNeeded.length, rows: tourInputsNeeded.slice(0, 5) },
      { label: "Open action items", icon: RefreshCcw, tone: "neutral", count: openActionRows.length, rows: openActionRows.slice(0, 5) },
      { label: "Missing broker contact", icon: MailX, tone: "danger", count: missingBroker.length, rows: missingBroker },
      { label: "Needs OM request", icon: FileQuestion, tone: "warning", count: missingDocs.length, rows: missingDocs },
    ];
  }, [pipelineRows, yieldFlagRows]);

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
          <div>
            Data updated ·{" "}
            {dataUpdatedAt
              ? new Date(dataUpdatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : "—"}
          </div>
          <div>Source: StreetEasy · broker network · city data</div>
          {digest && ((digest.newProperties ?? 0) > 0 || (digest.updatedProperties ?? 0) > 0 || (digest.omGeneratedCount ?? 0) > 0) ? (
            <div className={styles.digestLine}>
              Last 24h ·{" "}
              {[
                digest.newProperties ? `${digest.newProperties} new` : null,
                digest.updatedProperties ? `${digest.updatedProperties} updated` : null,
                digest.omGeneratedCount ? `${digest.omGeneratedCount} OM${digest.omGeneratedCount === 1 ? "" : "s"} analyzed` : null,
                digest.dossierGeneratedCount ? `${digest.dossierGeneratedCount} dossier${digest.dossierGeneratedCount === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}
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
          {loading ? <SkeletonRows count={6} className={styles.panelSkeleton} /> : null}
          <div className={styles.savedStageList}>
            {!loading && worklistStageGroups.map((group) => (
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
                            <span className={`${styles.workflowBadge} ${row.hasComps === true ? styles.badgeReady : styles.badgeMissing}`}>Comps</span>
                            <span className={`${styles.workflowBadge} ${progressRowHasOm(row) ? styles.badgeReady : styles.badgeMissing}`}>OM</span>
                            <span className={`${styles.workflowBadge} ${row.hasDossier === true ? styles.badgeReady : styles.badgeMissing}`}>UW</span>
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
