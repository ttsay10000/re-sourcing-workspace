"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  MarketDocumentBrief,
  MarketKnowledgeResponse,
  MarketKnowledgeState,
  MarketTrendDirection,
} from "@re-sourcing/contracts";
import { Badge, Button, FileDropzone, PageHeader, Panel } from "@/components/ui";
import { useProcessBanner } from "@/components/ProcessBanner";
import { API_BASE } from "@/lib/api";
import styles from "./marketDocs.module.css";

interface IngestReport {
  documentId: string;
  sourceType: "broker_provided" | "market_research";
  documentClass: string;
  publisher: string | null;
  classifierConfidence: "high" | "medium" | "low";
  flagForReview: boolean;
  nComps: number;
  nCompsMerged: number;
  nStats: number;
  unresolvedNeighborhoods: string[];
  affectedNeighborhoods: string[];
  flags: string[];
  brief?: MarketDocumentBrief | null;
  knowledgeVersion?: number | null;
}

interface MarketDocRow {
  id: string;
  filename: string;
  status: string;
  source_type: "broker_provided" | "market_research";
  publisher: string | null;
  branded: boolean;
  document_class: string;
  report_title: string | null;
  period_covered: string | null;
  classifier_confidence: "high" | "medium" | "low";
  flagForReview: boolean;
  error: string | null;
  ingestReport: IngestReport | null;
  documentBrief?: MarketDocumentBrief | null;
  createdAt: string;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function sourceBadge(doc: Pick<MarketDocRow, "source_type" | "publisher">) {
  return doc.source_type === "market_research" ? (
    <Badge tone="brand">RESEARCH{doc.publisher ? ` · ${doc.publisher}` : ""}</Badge>
  ) : (
    <Badge tone="info">BROKER{doc.publisher ? ` · ${doc.publisher}` : ""}</Badge>
  );
}

const DIRECTION_META: Record<MarketTrendDirection, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  up: { label: "▲ up", tone: "success" },
  down: { label: "▼ down", tone: "danger" },
  mixed: { label: "◆ mixed", tone: "warning" },
  flat: { label: "— flat", tone: "neutral" },
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function MarketDocsPage() {
  const processBanner = useProcessBanner();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastReports, setLastReports] = useState<IngestReport[]>([]);
  const [documents, setDocuments] = useState<MarketDocRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<MarketKnowledgeState | null>(null);

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/api/market-docs`, { credentials: "include" })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as { documents?: MarketDocRow[]; error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setDocuments(payload.documents ?? []);
        setListError(null);
      })
      .catch((err) => setListError(err instanceof Error ? err.message : "Failed to load ingest log."));
    fetch(`${API_BASE}/api/market-knowledge`, { credentials: "include" })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as MarketKnowledgeResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setKnowledge(payload.knowledge ?? null);
      })
      .catch(() => setKnowledge(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function uploadAll() {
    if (files.length === 0 || uploading) return;
    const batch = [...files];
    setUploading(true);
    setUploadError(null);
    const banner = processBanner.start("Market docs ingest", {
      message: `Classifying and extracting ${batch.length} document${batch.length === 1 ? "" : "s"}…`,
      estimateKind: "market-docs-ingest",
      estimateItems: batch.length,
    });
    const reports: IngestReport[] = [];
    try {
      for (const [index, file] of batch.entries()) {
        banner.update(
          `Ingesting ${index + 1} of ${batch.length}: ${file.name}`,
          Math.round((index / batch.length) * 100)
        );
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`${API_BASE}/api/market-docs`, {
          method: "POST",
          credentials: "include",
          body,
        });
        const payload = (await res.json().catch(() => ({}))) as { report?: IngestReport; error?: string };
        if (!res.ok || !payload.report) {
          throw new Error(payload.error || `HTTP ${res.status} for ${file.name}`);
        }
        reports.push(payload.report);
      }
      setLastReports(reports);
      setFiles([]);
      banner.succeed(
        `${reports.length} document${reports.length === 1 ? "" : "s"} folded into the market knowledge base.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      banner.fail(
        reports.length > 0 ? `${reports.length} of ${batch.length} ingested, then failed: ${message}` : message
      );
      setUploadError(message);
    } finally {
      setUploading(false);
      refresh();
    }
  }

  // Latest analyzed upload: prefer the just-ingested report's brief, else the knowledge base copy.
  const latestBrief: MarketDocumentBrief | null =
    [...lastReports].reverse().find((report) => report.brief)?.brief ?? knowledge?.latestBrief ?? null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Market context"
        title="Market documents"
        subtitle="Drop the general market reports here — Avison Young, Ariel Property Advisors, Alpha, M&M quarterly and monthly PDFs — plus broker materials (OMs, setups, comp lists). Each upload is classified, extracted with provenance, compared against the knowledge base, and folded into the living market narrative behind the Yield Map."
        actions={
          <a href="/pipeline/yield-map" className={styles.headerLink}>
            ← Yield Map
          </a>
        }
      />

      <Panel>
        <FileDropzone
          files={files}
          onChange={setFiles}
          accept=".pdf,.txt"
          maxFiles={10}
          maxBytes={MAX_UPLOAD_BYTES}
          disabled={uploading}
          label="Drag & drop market report PDFs here"
          hint="General research reports (Avison Young, Ariel, Alpha quarterlies — the good stuff) and broker deal materials · up to 50 MB each"
        />
        <div className={styles.uploadRow}>
          <Button onClick={() => void uploadAll()} disabled={files.length === 0 || uploading}>
            {uploading ? "Ingesting…" : `Ingest ${files.length || ""} document${files.length === 1 ? "" : "s"}`}
          </Button>
          {uploadError ? <span className={styles.uploadError}>{uploadError}</span> : null}
        </div>
      </Panel>

      {latestBrief ? (
        <Panel>
          <span className={styles.sectionTitle}>New upload analysis</span>
          <div className={styles.calloutCard}>
            <div className={styles.calloutHeadline}>
              <span className={styles.calloutTitle}>{latestBrief.title}</span>
              {latestBrief.discrepancies.length > 0 ? (
                <Badge tone="warning">
                  {latestBrief.discrepancies.length} discrepanc{latestBrief.discrepancies.length === 1 ? "y" : "ies"}
                </Badge>
              ) : (
                <Badge tone="success">no conflicts</Badge>
              )}
              <span className={styles.calloutMeta}>incorporated {formatWhen(latestBrief.incorporatedAt)}</span>
            </div>
            <div className={styles.briefColumns}>
              <div className={styles.briefGroup}>
                <span className={styles.briefGroupTitle}>What it says</span>
                <ul className={styles.briefList}>
                  {latestBrief.whatItSays.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.briefGroup}>
                <span className={styles.briefGroupTitle}>Compared to prior</span>
                {latestBrief.comparedToPrior.length > 0 ? (
                  <ul className={styles.briefList}>
                    {latestBrief.comparedToPrior.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.emptyNote}>Nothing comparable on record yet.</span>
                )}
              </div>
            </div>
            {latestBrief.discrepancies.length > 0 ? (
              <div className={styles.discrepancyBox}>
                <span className={styles.discrepancyTitle}>Discrepancy flags</span>
                <ul className={styles.discrepancyList}>
                  {latestBrief.discrepancies.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {lastReports.length > 0 ? (
        <Panel>
          <span className={styles.sectionTitle}>Last ingest</span>
          <div className={styles.reportList}>
            {lastReports.map((report) => (
              <div key={report.documentId} className={styles.reportCard}>
                <div className={styles.reportHeadline}>
                  {sourceBadge({ source_type: report.sourceType, publisher: report.publisher })}
                  <Badge tone="neutral">{report.documentClass}</Badge>
                  {report.flagForReview ? <Badge tone="warning">review</Badge> : null}
                  {report.knowledgeVersion != null ? <Badge tone="brand">knowledge v{report.knowledgeVersion}</Badge> : null}
                </div>
                <span>
                  {report.nComps} comps ({report.nCompsMerged} merged) · {report.nStats} stats ·{" "}
                  {report.affectedNeighborhoods.length} neighborhoods updated
                </span>
                {report.unresolvedNeighborhoods.length > 0 ? (
                  <span className={styles.reportWarning}>
                    Unresolved neighborhoods: {report.unresolvedNeighborhoods.join(", ")}
                  </span>
                ) : null}
                {report.flags.length > 0 ? (
                  <span className={styles.reportFlags}>{report.flags.join(" · ")}</span>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <div className={styles.knowledgeHeader}>
          <span className={styles.sectionTitle}>Market knowledge base</span>
          {knowledge ? (
            <>
              <Badge tone="brand">v{knowledge.version}</Badge>
              <span className={styles.knowledgeMeta}>
                updated {formatWhen(knowledge.updatedAt)}
                {knowledge.narrative.asOf ? ` · data through ${knowledge.narrative.asOf}` : ""}
              </span>
            </>
          ) : null}
        </div>
        {knowledge ? (
          <div className={styles.knowledgeBody}>
            {knowledge.narrative.submarketTrends.length > 0 ? (
              <div className={styles.trendGrid}>
                {knowledge.narrative.submarketTrends.map((trend) => (
                  <div key={trend.scope} className={styles.trendCard}>
                    <div className={styles.trendHeadline}>
                      <span className={styles.trendScope}>{trend.scope}</span>
                      <Badge tone={DIRECTION_META[trend.direction].tone}>{DIRECTION_META[trend.direction].label}</Badge>
                    </div>
                    <ul className={styles.briefList}>
                      {trend.claims.map((claim) => (
                        <li key={claim.text}>{claim.text}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}

            {knowledge.narrative.assetTypeAttention.length > 0 ? (
              <div className={styles.knowledgeGroup}>
                <span className={styles.briefGroupTitle}>Asset-type attention</span>
                <ul className={styles.attentionList}>
                  {knowledge.narrative.assetTypeAttention.map((note) => (
                    <li key={note.segment} className={styles.attentionRow}>
                      <Badge tone={note.attention === "more" ? "warning" : note.attention === "less" ? "info" : "neutral"}>
                        {note.attention}
                      </Badge>
                      <span>
                        <strong>{note.segment}</strong> — {note.note}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {knowledge.narrative.capRatePsfMovements.length > 0 ? (
              <div className={styles.knowledgeGroup}>
                <span className={styles.briefGroupTitle}>Cap rate / $PSF movements</span>
                <ul className={styles.briefList}>
                  {knowledge.narrative.capRatePsfMovements.map((claim) => (
                    <li key={claim.text}>{claim.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {knowledge.narrative.discrepancies.filter((item) => item.status === "open").length > 0 ? (
              <div className={styles.discrepancyBox}>
                <span className={styles.discrepancyTitle}>Open discrepancies</span>
                <ul className={styles.discrepancyList}>
                  {knowledge.narrative.discrepancies
                    .filter((item) => item.status === "open")
                    .map((item) => (
                      <li key={item.topic}>
                        {item.detail}
                        {item.sources.length > 0 ? ` (${item.sources.join(", ")})` : ""}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}

            {knowledge.narrative.sources.length > 0 ? (
              <span className={styles.sourcesLine}>Sources: {knowledge.narrative.sources.join(" · ")}</span>
            ) : null}
          </div>
        ) : (
          <span className={styles.emptyNote}>
            No knowledge base yet — ingest the first general market report (Avison Young, Ariel, Alpha…) to start the
            living narrative.
          </span>
        )}
      </Panel>

      <Panel>
        <span className={styles.sectionTitle}>Ingest log</span>
        {listError ? <div className={styles.uploadError}>{listError}</div> : null}
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Document</th>
              <th>Source</th>
              <th>Class</th>
              <th>Confidence</th>
              <th>Comps</th>
              <th>Stats</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td className={styles.docCell}>
                  <span className={styles.docName}>{doc.report_title ?? doc.filename}</span>
                  {doc.period_covered ? <span className={styles.docMeta}>{doc.period_covered}</span> : null}
                  {doc.documentBrief && doc.documentBrief.discrepancies.length > 0 ? (
                    <span className={styles.docDiscrepancy}>
                      {doc.documentBrief.discrepancies.length} discrepanc
                      {doc.documentBrief.discrepancies.length === 1 ? "y" : "ies"} flagged
                    </span>
                  ) : null}
                </td>
                <td>{sourceBadge(doc)}</td>
                <td>{doc.document_class}</td>
                <td>
                  {doc.flagForReview ? (
                    <Badge tone="warning">low — review</Badge>
                  ) : (
                    <Badge tone={doc.classifier_confidence === "high" ? "success" : "neutral"}>
                      {doc.classifier_confidence}
                    </Badge>
                  )}
                </td>
                <td>{doc.ingestReport ? `${doc.ingestReport.nComps} (${doc.ingestReport.nCompsMerged} merged)` : "—"}</td>
                <td>{doc.ingestReport?.nStats ?? "—"}</td>
                <td>
                  {doc.status === "failed" ? (
                    <Badge tone="danger" title={doc.error ?? undefined}>failed</Badge>
                  ) : (
                    <Badge tone={doc.status === "synthesized" ? "success" : "neutral"}>{doc.status}</Badge>
                  )}
                </td>
              </tr>
            ))}
            {documents.length === 0 && !listError ? (
              <tr>
                <td colSpan={7} className={styles.emptyRow}>
                  No market documents ingested yet — drop the first research report or broker package above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
