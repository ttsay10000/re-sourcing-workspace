"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { UiV2PipelineListPayload, UiV2PipelineRow } from "@re-sourcing/contracts";
import styles from "./home.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

type PipelineResponse = { pipeline?: UiV2PipelineListPayload; error?: string; details?: string };
type ProgressResponse = {
  summary?: Record<string, number | null | undefined>;
  sections?: Array<{ id: string; label?: string; count?: number; rows?: HomeProgressRow[] }>;
  error?: string;
  details?: string;
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

const SNAPSHOT_STAGES = [
  { key: "new", label: "Sourced" },
  { key: "outreach", label: "OM Requested" },
  { key: "om_received", label: "OM Received" },
  { key: "underwriting", label: "Underwriting" },
  { key: "offer_review", label: "Offer Review" },
  { key: "archived", label: "Closed / Archived" },
  { key: "rejected", label: "Rejected" },
];

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function titleize(value: string | null | undefined): string {
  if (!value) return "-";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  return [areaLabel(row.neighborhood), areaLabel(row.borough)].filter(Boolean).join(" · ");
}

function scoreClass(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return styles.scoreMuted;
  if (score >= 50) return styles.scoreGood;
  return styles.scoreBad;
}

function rowScore(row: UiV2PipelineRow | HomeProgressRow): number | null {
  return "statusChip" in row ? row.underwriting?.dealScore ?? null : row.dealScore ?? null;
}

function rowAddress(row: UiV2PipelineRow | HomeProgressRow): string {
  return row.displayAddress ?? row.canonicalAddress ?? "Property";
}

export default function HomePage() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [pipelineRows, setPipelineRows] = useState<UiV2PipelineRow[]>([]);
  const [pipelineTotal, setPipelineTotal] = useState(0);
  const [progressRows, setProgressRows] = useState<HomeProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openAttentionGroups, setOpenAttentionGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let ignore = false;
    async function loadHome() {
      setLoading(true);
      setError(null);
      try {
        const [pipelineResponse, progressResponse] = await Promise.all([
          fetch(`${API_BASE}/api/ui-v2/pipeline?limit=250&includeRejected=true`, { credentials: "include" }),
          fetch(`${API_BASE}/api/ui-v2/deal-progress`, { credentials: "include" }),
        ]);
        const pipelineData = (await pipelineResponse.json().catch(() => ({}))) as PipelineResponse;
        const progressData = (await progressResponse.json().catch(() => ({}))) as ProgressResponse;
        if (!pipelineResponse.ok) throw new Error(pipelineData.error || pipelineData.details || "Failed to load pipeline.");
        if (!progressResponse.ok) throw new Error(progressData.error || progressData.details || "Failed to load progress.");
        if (ignore) return;
        setPipelineRows(pipelineData.pipeline?.rows ?? []);
        setPipelineTotal(pipelineData.pipeline?.total ?? 0);
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

  const filteredPipeline = useMemo(() => {
    if (!query) return pipelineRows;
    return pipelineRows.filter((row) =>
      [
        row.canonicalAddress,
        row.displayAddress,
        row.source,
        row.neighborhood,
        row.borough,
        row.statusChip.label,
        row.broker?.name,
        row.broker?.email,
        ...(row.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [pipelineRows, query]);

  const counts = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const row of pipelineRows) {
      const status = String(row.statusChip.status);
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    }
    return byStatus;
  }, [pipelineRows]);

  const dealsInProgress = useMemo(() => {
    const statuses = new Set(["saved", "underwriting", "outreach", "awaiting_broker", "om_received", "dossier_generated", "offer_review"]);
    return filteredPipeline.filter((row) => statuses.has(String(row.statusChip.status))).slice(0, 8);
  }, [filteredPipeline]);

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
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1>Home</h1>
          <p>{loading ? "Refreshing dashboard..." : `${pipelineTotal} properties loaded into the sourcing workspace`}</p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/pipeline" className={styles.secondaryButton}>Full Pipeline</Link>
          <Link href="/add-property" className={styles.primaryButton}>Add Property</Link>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {query ? <div className={styles.notice}>Home filtered by global search: <strong>{searchParams.get("q")}</strong></div> : null}

      <section className={styles.statusCards} aria-label="Deal status cards">
        {[
          { label: "LOIs Sent", value: counts.get("offer_review") ?? 0, tone: "green" },
          { label: "Negotiation", value: progressRows.filter((row) => row.status === "offer_review").length, tone: "neutral" },
          { label: "Contract / Diligence", value: counts.get("dossier_generated") ?? 0, tone: "neutral" },
          { label: "Closed", value: counts.get("archived") ?? 0, tone: "green" },
          { label: "Rejected / Removed", value: counts.get("rejected") ?? 0, tone: "red" },
        ].map((card) => (
          <article key={card.label} className={`${styles.statusCard} ${styles[card.tone]}`}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className={styles.snapshot}>
        <div className={styles.panelHeader}>
          <h2>Pipeline Snapshot</h2>
          <Link href="/pipeline">Full pipeline</Link>
        </div>
        <div className={styles.stageStrip}>
          {SNAPSHOT_STAGES.map((stage) => (
            <Link key={stage.key} href={`/pipeline?status=${stage.key}`} className={styles.stageCell}>
              <strong>{counts.get(stage.key) ?? 0}</strong>
              <span>{stage.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className={styles.dashboardGrid}>
        <section className={styles.dealsPanel}>
          <div className={styles.panelHeader}>
            <h2>Deals In Progress</h2>
            <span>{dealsInProgress.length} visible deals</span>
          </div>
          <table className={styles.dealsTable}>
            <thead>
              <tr>
                <th>Address</th>
                <th>Source</th>
                <th>Ask</th>
                <th>Score</th>
                <th>Status</th>
                <th>OM</th>
              </tr>
            </thead>
            <tbody>
              {dealsInProgress.map((row) => (
                <tr key={row.propertyId}>
                  <td>
                    <Link href={`/pipeline?propertyId=${encodeURIComponent(row.propertyId)}`}>{rowAddress(row)}</Link>
                    <small>{locationSubtitle(row)}</small>
                  </td>
                  <td>{titleize(String(row.source ?? ""))}</td>
                  <td>{formatCurrency(row.askingPrice)}</td>
                  <td><span className={`${styles.scorePill} ${scoreClass(rowScore(row))}`}>{rowScore(row) == null ? "-" : `${Math.round(rowScore(row)!)} / 100`}</span></td>
                  <td>{row.statusChip.label}</td>
                  <td>{titleize(row.documentStatus?.omStatus ?? (row.documentStatus?.hasOm ? "available" : "missing"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dealsInProgress.length === 0 ? <div className={styles.empty}>No active deals match the current view.</div> : null}
        </section>

        <aside className={styles.attentionPanel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Needs Attention</h2>
              <span>{attentionItems.reduce((sum, item) => sum + item.count, 0)} items across {attentionItems.length} categories</span>
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
                  <span className={`${styles.attentionIcon} ${styles[`attentionTone${titleize(group.tone)}`]}`}>{group.icon}</span>
                  <strong>{group.label}</strong>
                  <span>{group.count}</span>
                  <i>{isOpen ? "-" : "+"}</i>
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
