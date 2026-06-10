"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, FileDropzone, PageHeader, Panel } from "@/components/ui";
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

export default function MarketDocsPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastReports, setLastReports] = useState<IngestReport[]>([]);
  const [documents, setDocuments] = useState<MarketDocRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/api/market-docs`, { credentials: "include" })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as { documents?: MarketDocRow[]; error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setDocuments(payload.documents ?? []);
        setListError(null);
      })
      .catch((err) => setListError(err instanceof Error ? err.message : "Failed to load ingest log."));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function uploadAll() {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setUploadError(null);
    const reports: IngestReport[] = [];
    try {
      for (const file of files) {
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
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      refresh();
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Market context"
        title="Market documents"
        subtitle="Upload broker materials (OMs, setups, comp lists — the default) and published research reports (AY, Ariel, Alpha, M&M forecasts). Each PDF is classified, extracted with provenance, and rolled into the Yield Map's neighborhood layer."
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
          label="Drag & drop market PDFs here"
          hint="Broker deal materials and published research reports · up to 50 MB each"
        />
        <div className={styles.uploadRow}>
          <Button onClick={() => void uploadAll()} disabled={files.length === 0 || uploading}>
            {uploading ? "Ingesting…" : `Ingest ${files.length || ""} document${files.length === 1 ? "" : "s"}`}
          </Button>
          {uploadError ? <span className={styles.uploadError}>{uploadError}</span> : null}
        </div>
      </Panel>

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
