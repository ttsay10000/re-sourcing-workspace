"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  Clock3,
  Crosshair,
  FileText,
  RefreshCw,
  RotateCcw,
  Sparkles,
  StickyNote,
  TrendingUp,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import type {
  MarketDocumentBrief,
  MarketDocumentNotes,
  MarketKnowledgeResponse,
  MarketKnowledgeState,
  MarketReviewRecord,
  MarketReviewResponse,
  MarketTrendDirection,
} from "@re-sourcing/contracts";
import { Badge, Button, ConfirmDialog, Dialog, FileDropzone, PageHeader, Panel } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { useProcessBanner } from "@/components/ProcessBanner";
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
  nCompsPendingReview?: number;
  unresolvedNeighborhoods: string[];
  affectedNeighborhoods: string[];
  flags: string[];
  notesGenerated?: boolean;
  brief?: MarketDocumentBrief | null;
  knowledgeVersion?: number | null;
  status?: "succeeded" | "failed";
  error?: string | null;
}

type UploadItemState = "queued" | "processing" | "done" | "failed";

interface UploadItem {
  name: string;
  state: UploadItemState;
  error?: string | null;
  documentId?: string | null;
}

interface MarketPromptSection {
  key: string;
  label: string;
  text: string;
}

interface MarketPromptsResponse {
  version: string;
  sections: MarketPromptSection[];
}

interface MarketDocRow {
  id: string;
  filename: string;
  status: "uploaded" | "classified" | "extracted" | "synthesized" | "failed";
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
  llmNotes?: MarketDocumentNotes | null;
  excludedAt?: string | null;
  excludedReason?: "removed" | "duplicate" | null;
  duplicateOfId: string | null;
  pendingComps: number;
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

function sourceTypeBadge(doc: Pick<MarketDocRow, "source_type">) {
  return doc.source_type === "market_research" ? <Badge tone="brand">RESEARCH</Badge> : <Badge tone="info">BROKER</Badge>;
}

const DIRECTION_META: Record<MarketTrendDirection, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  up: { label: "▲ up", tone: "success" },
  down: { label: "▼ down", tone: "danger" },
  mixed: { label: "◆ mixed", tone: "warning" },
  flat: { label: "— flat", tone: "neutral" },
};

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const DOC_STATUS_META: Record<
  MarketDocRow["status"],
  { label: string; tone: BadgeTone; progress: number; detail: string }
> = {
  uploaded: { label: "Uploaded", tone: "neutral", progress: 25, detail: "Waiting for classification" },
  classified: { label: "Classified", tone: "info", progress: 45, detail: "Source and period identified" },
  extracted: { label: "Extracted", tone: "brand", progress: 72, detail: "Comps and stats extracted" },
  synthesized: { label: "Synthesized", tone: "success", progress: 100, detail: "Notes and knowledge updated" },
  failed: { label: "Failed", tone: "danger", progress: 100, detail: "Needs retry or removal" },
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatRelativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "time unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "time unknown";
  const diffMs = date.getTime() - now;
  const absSeconds = Math.abs(diffMs) / 1000;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absSeconds < 45) return "just now";
  if (absSeconds < 90 * 60) return formatter.format(Math.round(diffMs / 60_000), "minute");
  if (absSeconds < 36 * 60 * 60) return formatter.format(Math.round(diffMs / 3_600_000), "hour");
  if (absSeconds < 45 * 24 * 60 * 60) return formatter.format(Math.round(diffMs / 86_400_000), "day");
  return date.toLocaleDateString();
}

function titleizeToken(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function notesSignalCount(notes: MarketDocumentNotes | null | undefined): number {
  if (!notes) return 0;
  return (
    notes.overview.length +
    notes.neighborhoods.length +
    notes.assetTypes.length +
    notes.buyerActivity.length +
    notes.notableTransactions.length +
    notes.capRatePsf.length +
    notes.financing.length +
    notes.smallBuildingFocus.length +
    notes.regulatory.length +
    notes.risksWatchItems.length +
    notes.investmentRelevance.length
  );
}

/** Notes dialog section: skip silently when the report had nothing on the topic. */
function NotesSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.briefGroup}>
      <span className={styles.briefGroupTitle}>{title}</span>
      <ul className={styles.briefList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ReviewGroup({
  icon,
  title,
  items,
}: {
  icon: ReactNode;
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className={styles.briefGroup}>
      <span className={styles.briefGroupTitle}>
        {icon}
        {title}
      </span>
      <ul className={styles.briefList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function MarketDocsPage() {
  const processBanner = useProcessBanner();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [lastReports, setLastReports] = useState<IngestReport[]>([]);
  const [documents, setDocuments] = useState<MarketDocRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<MarketKnowledgeState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Live AI review state.
  const [review, setReview] = useState<MarketReviewRecord | null>(null);
  const [reviewStale, setReviewStale] = useState(false);
  const [reviewDocCount, setReviewDocCount] = useState(0);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<MarketPromptsResponse | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);

  // Ingest-log management state.
  const [showRemoved, setShowRemoved] = useState(false);
  const [notesDoc, setNotesDoc] = useState<MarketDocRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MarketDocRow | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

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
    fetch(`${API_BASE}/api/market-review`, { credentials: "include" })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as MarketReviewResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setReview(payload.review ?? null);
        setReviewStale(payload.stale);
        setReviewDocCount(payload.currentDocumentCount);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadPrompts = useCallback(() => {
    fetch(`${API_BASE}/api/market-docs/prompts`, { credentials: "include" })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as MarketPromptsResponse & { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
        setPrompts({ version: payload.version, sections: payload.sections ?? [] });
        setPromptsError(null);
      })
      .catch((err) => setPromptsError(err instanceof Error ? err.message : "Failed to load prompt templates."));
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const refreshReview = useCallback(async () => {
    if (reviewBusy) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const res = await fetch(`${API_BASE}/api/market-review/refresh`, { method: "POST", credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as MarketReviewResponse & { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
      setReview(payload.review ?? null);
      setReviewStale(payload.stale);
      setReviewDocCount(payload.currentDocumentCount);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Failed to refresh the live review.");
    } finally {
      setReviewBusy(false);
    }
  }, [reviewBusy]);

  function patchUploadItem(index: number, patch: Partial<UploadItem>) {
    setUploadItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  // Each file uploads independently: one bad PDF marks its own row failed
  // (with the stage-tagged reason) and the batch keeps going. After the batch,
  // the live AI review regenerates so the cross-document read stays current.
  async function uploadAll() {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setUploadError(null);
    const batch = [...files];
    setUploadItems(batch.map((file) => ({ name: file.name, state: "queued" as const })));
    const banner = processBanner.start("Market doc ingestion", {
      message: `0/${batch.length} docs ingested`,
    });
    const reports: IngestReport[] = [];
    const failedFiles: File[] = [];
    for (let index = 0; index < batch.length; index += 1) {
      const file = batch[index];
      patchUploadItem(index, { state: "processing" });
      banner.update(
        `Reading ${file.name} (${index + 1}/${batch.length})${failedFiles.length ? ` · ${failedFiles.length} failed` : ""}`,
        Math.round((index / batch.length) * 100)
      );
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`${API_BASE}/api/market-docs`, {
          method: "POST",
          credentials: "include",
          body,
        });
        const payload = (await res.json().catch(() => ({}))) as { report?: IngestReport; error?: string; details?: string };
        if (!res.ok || !payload.report) {
          throw new Error(payload.error || payload.details || `HTTP ${res.status}`);
        }
        if (payload.report.status === "failed") {
          patchUploadItem(index, {
            state: "failed",
            error: payload.report.error ?? "Ingest failed — see the ingest log.",
            documentId: payload.report.documentId,
          });
          failedFiles.push(file);
        } else {
          reports.push(payload.report);
          patchUploadItem(index, { state: "done", documentId: payload.report.documentId });
        }
      } catch (err) {
        patchUploadItem(index, { state: "failed", error: err instanceof Error ? err.message : "Upload failed." });
        failedFiles.push(file);
      }
    }
    if (reports.length > 0) setLastReports(reports);
    // Failed files stay staged so a fixed network/server is one click away.
    setFiles(failedFiles);
    if (reports.length === 0 && batch.length > 0) {
      setUploadError("No documents ingested — every file failed. See the per-file errors above.");
      banner.fail(`All ${batch.length} doc${batch.length === 1 ? "" : "s"} failed to ingest.`);
    } else {
      banner.succeed(
        `${reports.length}/${batch.length} docs ingested${failedFiles.length ? ` · ${failedFiles.length} failed` : ""}`
      );
    }
    setUploading(false);
    refresh();
    if (reports.length > 0) {
      setReviewStale(true);
      void refreshReview();
    }
  }

  async function retryDocument(documentId: string) {
    if (retryingId) return;
    setRetryingId(documentId);
    let shouldRefreshReview = false;
    const banner = processBanner.start("Market doc retry", { message: "Re-running ingestion…" });
    try {
      const res = await fetch(`${API_BASE}/api/market-docs/${encodeURIComponent(documentId)}/retry`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await res.json().catch(() => ({}))) as { report?: IngestReport; error?: string };
      if (!res.ok || !payload.report) throw new Error(payload.error || `HTTP ${res.status}`);
      if (payload.report.status === "failed") {
        setUploadError(`Retry failed: ${payload.report.error ?? "see the ingest log."}`);
        banner.fail(`Retry failed: ${payload.report.error ?? "see the ingest log."}`);
      } else {
        setUploadError(null);
        setLastReports((current) => [...current, payload.report as IngestReport]);
        setUploadItems((current) =>
          current.map((item) => (item.documentId === documentId ? { ...item, state: "done", error: null } : item))
        );
        shouldRefreshReview = true;
        setReviewStale(true);
        banner.succeed("Document ingested on retry.");
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Retry failed.");
      banner.fail(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetryingId(null);
      refresh();
      if (shouldRefreshReview) void refreshReview();
    }
  }

  async function removeDocument(doc: MarketDocRow, reason: "removed" | "duplicate") {
    setRowBusyId(doc.id);
    try {
      const res = await fetch(
        `${API_BASE}/api/market-docs/${encodeURIComponent(doc.id)}?reason=${reason}`,
        { method: "DELETE", credentials: "include" }
      );
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
      setRemoveTarget(null);
      setReviewStale(true);
      refresh();
      void refreshReview();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to remove document.");
    } finally {
      setRowBusyId(null);
    }
  }

  async function restoreDocument(doc: MarketDocRow) {
    setRowBusyId(doc.id);
    try {
      const res = await fetch(`${API_BASE}/api/market-docs/${encodeURIComponent(doc.id)}/restore`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`);
      setReviewStale(true);
      refresh();
      void refreshReview();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to restore document.");
    } finally {
      setRowBusyId(null);
    }
  }

  // Latest analyzed upload: prefer the just-ingested report's brief, else the knowledge base copy.
  const latestBrief: MarketDocumentBrief | null =
    [...lastReports].reverse().find((report) => report.brief)?.brief ?? knowledge?.latestBrief ?? null;

  const removedCount = useMemo(() => documents.filter((doc) => doc.excludedAt).length, [documents]);
  const visibleDocuments = useMemo(
    () => (showRemoved ? documents : documents.filter((doc) => !doc.excludedAt)),
    [documents, showRemoved]
  );
  const pendingCompsTotal = useMemo(
    () => documents.filter((doc) => !doc.excludedAt).reduce((sum, doc) => sum + (doc.pendingComps ?? 0), 0),
    [documents]
  );
  const docTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of documents) map.set(doc.id, doc.report_title ?? doc.filename);
    return map;
  }, [documents]);

  const liveReview = review?.review ?? null;
  const reviewIncludedCount = review?.includedDocumentIds.length ?? 0;
  const reviewDocDelta = review ? reviewDocCount - reviewIncludedCount : 0;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Market context"
        title="Market documents"
        subtitle="Drop the general market reports here — Avison Young, Ariel Property Advisors, Alpha, M&M quarterly and monthly PDFs — plus broker materials (OMs, setups, comp lists). Each upload gets a Gemini read refined by the OpenAI model into analyst notes, extracted deals go to the comp review queue, and the live AI review keeps the cross-report acquisitions read current."
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
        {uploadItems.length > 0 ? (
          <div className={styles.uploadStatusList}>
            {uploadItems.map((item, index) => (
              <div key={`${item.name}-${index}`} className={styles.uploadStatusRow}>
                <Badge
                  tone={
                    item.state === "done"
                      ? "success"
                      : item.state === "failed"
                        ? "danger"
                        : item.state === "processing"
                          ? "info"
                          : "neutral"
                  }
                >
                  {item.state}
                </Badge>
                <span className={styles.uploadStatusName}>{item.name}</span>
                {item.error ? <span className={styles.uploadStatusError}>{item.error}</span> : null}
                {item.state === "failed" && item.documentId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void retryDocument(item.documentId as string)}
                    disabled={retryingId != null}
                  >
                    {retryingId === item.documentId ? "Retrying…" : "Retry"}
                  </Button>
                ) : null}
              </div>
            ))}
            <span className={styles.uploadSummary}>
              {uploadItems.filter((item) => item.state === "done").length} ingested ·{" "}
              {uploadItems.filter((item) => item.state === "failed").length} failed
              {uploading ? " · working…" : ""}
            </span>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <div className={styles.promptHeader}>
          <div>
            <span className={styles.sectionTitle}>Prompt review</span>
            <span className={styles.promptMeta}>
              {prompts ? `${prompts.version} · ${prompts.sections.length} sections/templates` : "Loading prompt templates…"}
            </span>
          </div>
          <div className={styles.promptActions}>
            <Button variant="secondary" size="sm" onClick={loadPrompts}>
              <RefreshCw size={13} strokeWidth={2.2} aria-hidden="true" />
              Reload
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPromptsOpen((open) => !open)}>
              {promptsOpen ? "Collapse" : "Open prompts"}
            </Button>
          </div>
        </div>
        {promptsError ? <div className={styles.uploadError}>{promptsError}</div> : null}
        {promptsOpen && prompts ? (
          <div className={styles.promptList}>
            {prompts.sections.map((section) => (
              <details key={section.key} className={styles.promptDetails}>
                <summary>{section.label}</summary>
                <pre>{section.text}</pre>
              </details>
            ))}
          </div>
        ) : null}
      </Panel>

      {/* ---- Live AI market review: the cross-document acquisitions read ---- */}
      <Panel>
        <div className={`${styles.reviewHeader} ${reviewStale ? styles.reviewHeaderStale : ""}`}>
          <div className={styles.reviewTitleBlock}>
            <span className={styles.reviewEyebrow}>
              <Sparkles size={15} strokeWidth={2.2} aria-hidden="true" />
              Live AI market review
            </span>
            <span className={styles.reviewTitle}>
              {review ? "Current acquisitions read across included documents" : "Generate the cross-report acquisitions read"}
            </span>
            <span className={styles.reviewMetaLine}>
              {review
                ? `Generated ${formatRelativeTime(review.createdAt, now)} from ${reviewIncludedCount} document${reviewIncludedCount === 1 ? "" : "s"}`
                : `${reviewDocCount} active document${reviewDocCount === 1 ? "" : "s"} ready`}
              {review?.provider ? ` · ${review.provider}${review.model ? `/${review.model}` : ""}` : ""}
            </span>
          </div>
          <div className={styles.reviewStatusStack}>
            <div className={styles.reviewBadgeRow}>
              {review ? <Badge tone="brand">v{review.version}</Badge> : null}
              {reviewBusy ? <Badge tone="info">refreshing</Badge> : null}
              {reviewStale ? (
                <Badge tone="warning" title="Documents were added, removed, restored, or retried since this review was generated.">
                  stale
                </Badge>
              ) : review ? (
                <Badge tone="success">
                  <CheckCircle2 size={12} strokeWidth={2.4} aria-hidden="true" />
                  current
                </Badge>
              ) : null}
            </div>
            <Button
              variant={reviewStale || !review ? "primary" : "secondary"}
              size="sm"
              onClick={() => void refreshReview()}
              disabled={reviewBusy || uploading || reviewDocCount === 0}
            >
              <RefreshCw size={13} strokeWidth={2.2} aria-hidden="true" className={reviewBusy ? styles.spinning : undefined} />
              {reviewBusy ? "Reviewing…" : review ? "Refresh review" : "Generate review"}
            </Button>
          </div>
        </div>
        {reviewStale ? (
          <div className={styles.staleReviewBanner}>
            <AlertTriangle size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>
              Review is behind the ingest log: last review used {reviewIncludedCount} document
              {reviewIncludedCount === 1 ? "" : "s"}; {reviewDocCount} active document{reviewDocCount === 1 ? "" : "s"} would be included now
              {reviewDocDelta !== 0 ? ` (${reviewDocDelta > 0 ? "+" : ""}${reviewDocDelta})` : ""}.
            </span>
            <Button variant="secondary" size="sm" onClick={() => void refreshReview()} disabled={reviewBusy || uploading || reviewDocCount === 0}>
              <RefreshCw size={13} strokeWidth={2.2} aria-hidden="true" className={reviewBusy ? styles.spinning : undefined} />
              Update review
            </Button>
          </div>
        ) : null}
        {reviewError ? <div className={styles.uploadError}>{reviewError}</div> : null}
        {reviewBusy && !liveReview ? (
          <span className={styles.emptyNote}>Reading every included document&apos;s notes and writing the cross-report review…</span>
        ) : null}
        {liveReview ? (
          <div className={styles.knowledgeBody}>
            <div className={styles.execSummary}>
              <span className={styles.execSummaryTitle}>
                <TrendingUp size={15} strokeWidth={2} aria-hidden="true" />
                {liveReview.headline}
              </span>
              {liveReview.marketPulse.length > 0 ? (
                <ul className={styles.execSummaryList}>
                  {liveReview.marketPulse.map((line) => (
                    <li key={line} className={styles.execSummaryRow}>
                      <span className={styles.execSummaryText}>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className={styles.briefColumns}>
              <ReviewGroup
                icon={<Building2 size={14} strokeWidth={2} aria-hidden="true" />}
                title="Small multifamily focus"
                items={liveReview.smallMultifamilyFocus}
              />
              <ReviewGroup
                icon={<TrendingUp size={14} strokeWidth={2} aria-hidden="true" />}
                title="Cap rate trends"
                items={liveReview.capRateTrends}
              />
              <ReviewGroup
                icon={<Users size={14} strokeWidth={2} aria-hidden="true" />}
                title="Buying & selling activity"
                items={liveReview.buyerSellerActivity}
              />
              <ReviewGroup
                icon={<Banknote size={14} strokeWidth={2} aria-hidden="true" />}
                title="Loan environment"
                items={liveReview.loanEnvironment}
              />
            </div>

            {liveReview.opportunities.length > 0 ? (
              <div className={styles.opportunityBox}>
                <span className={styles.briefGroupTitle}>
                  <Crosshair size={14} strokeWidth={2} aria-hidden="true" />
                  Where to hunt
                </span>
                <ul className={styles.briefList}>
                  {liveReview.opportunities.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {liveReview.qoqComparisons.length > 0 ? (
              <div className={styles.knowledgeGroup}>
                <span className={styles.briefGroupTitle}>Quarter-over-quarter, same publisher</span>
                <div className={styles.trendGrid}>
                  {liveReview.qoqComparisons.map((comparison) => (
                    <div key={`${comparison.publisher}-${comparison.toPeriod}`} className={styles.trendCard}>
                      <div className={styles.trendHeadline}>
                        <span className={styles.trendScope}>{comparison.publisher}</span>
                        <Badge tone="neutral">{comparison.fromPeriod} → {comparison.toPeriod}</Badge>
                      </div>
                      <ul className={styles.briefList}>
                        {comparison.changes.map((change) => (
                          <li key={change}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {liveReview.discrepancies.length > 0 ? (
              <div className={styles.discrepancyBox}>
                <span className={styles.discrepancyTitle}>
                  <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
                  Brokerages disagree
                </span>
                <ul className={styles.discrepancyList}>
                  {liveReview.discrepancies.map((item) => (
                    <li key={item.topic}>
                      <strong>{item.topic}:</strong>{" "}
                      {item.positions.map((position) => `${position.claim} (${position.source}${position.period ? `, ${position.period}` : ""})`).join(" vs ")}
                      {item.note ? ` — ${item.note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {liveReview.sources.length > 0 ? (
              <span className={styles.sourcesLine}>Reviewed: {liveReview.sources.join(" · ")}</span>
            ) : null}
          </div>
        ) : !reviewBusy ? (
          <span className={styles.emptyNote}>
            {reviewDocCount > 0
              ? "No live review yet — hit Generate review to synthesize the acquisitions read across every ingested report."
              : "Ingest market documents above and the live AI review will synthesize the small-multifamily acquisitions read across all of them."}
          </span>
        ) : null}
      </Panel>

      {pendingCompsTotal > 0 ? (
        <div className={styles.queueCallout}>
          <strong>
            {pendingCompsTotal} extracted deal{pendingCompsTotal === 1 ? "" : "s"} awaiting comp review.
          </strong>{" "}
          Approve or reject them on{" "}
          <Link href="/pipeline/comp-analysis" className={styles.queueLink}>
            Comp Analysis → Review queue
          </Link>{" "}
          to control what reaches the comp table and the yield map layer.
        </div>
      ) : null}

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
                  {report.notesGenerated ? <Badge tone="success">notes ✓</Badge> : null}
                  {report.knowledgeVersion != null ? <Badge tone="brand">knowledge v{report.knowledgeVersion}</Badge> : null}
                </div>
                <span>
                  {report.nComps} comps ({report.nCompsMerged} merged
                  {report.nCompsPendingReview ? `, ${report.nCompsPendingReview} to review` : ""}) · {report.nStats} stats ·{" "}
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
            {(knowledge.narrative.executiveSummary ?? []).length > 0 ? (
              <div className={styles.execSummary}>
                <span className={styles.execSummaryTitle}>
                  <TrendingUp size={15} strokeWidth={2} aria-hidden="true" />
                  Executive summary — trends across all reports
                </span>
                <ul className={styles.execSummaryList}>
                  {(knowledge.narrative.executiveSummary ?? []).map((insight) => (
                    <li key={insight.text} className={styles.execSummaryRow}>
                      {insight.direction ? (
                        <Badge tone={DIRECTION_META[insight.direction].tone}>
                          {DIRECTION_META[insight.direction].label}
                        </Badge>
                      ) : null}
                      <span className={styles.execSummaryText}>{insight.text}</span>
                      {insight.source || insight.period ? (
                        <span className={styles.execSummaryMeta}>
                          {[insight.source, insight.period].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {knowledge.narrative.submarketTrends.length > 0 ? (
              <div className={styles.trendGrid}>
                {knowledge.narrative.submarketTrends.map((trend) => (
                  <div key={trend.scope} className={`${styles.trendCard} ${styles[`trendCard_${trend.direction}`] ?? ""}`}>
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
                <span className={styles.briefGroupTitle}>
                  <Building2 size={14} strokeWidth={2} aria-hidden="true" />
                  Asset-type attention
                </span>
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
                <span className={styles.briefGroupTitle}>
                  <TrendingUp size={14} strokeWidth={2} aria-hidden="true" />
                  Cap rate / $PSF movements
                </span>
                <ul className={styles.briefList}>
                  {knowledge.narrative.capRatePsfMovements.map((claim) => (
                    <li key={claim.text}>{claim.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {knowledge.narrative.discrepancies.filter((item) => item.status === "open").length > 0 ? (
              <div className={styles.discrepancyBox}>
                <span className={styles.discrepancyTitle}>
                  <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
                  Open discrepancies
                </span>
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
        <div className={styles.knowledgeHeader}>
          <span className={styles.sectionTitle}>Ingest log</span>
          {removedCount > 0 ? (
            <label className={styles.showRemovedToggle}>
              <input
                type="checkbox"
                checked={showRemoved}
                onChange={(event) => setShowRemoved(event.target.checked)}
              />
              Show removed ({removedCount})
            </label>
          ) : null}
        </div>
        {listError ? <div className={styles.uploadError}>{listError}</div> : null}
        <div className={styles.tableScroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Document & notes</th>
                <th>Source / period</th>
                <th>Extraction</th>
                <th>Pipeline</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
            {visibleDocuments.map((doc) => {
              const statusMeta = DOC_STATUS_META[doc.status] ?? DOC_STATUS_META.uploaded;
              const report = doc.ingestReport;
              const noteCount = notesSignalCount(doc.llmNotes);
              const duplicateTitle = doc.duplicateOfId ? docTitleById.get(doc.duplicateOfId) ?? "earlier upload" : null;
              const docTitle = doc.report_title ?? doc.llmNotes?.title ?? doc.filename;
              const notesGeneratedAt = doc.llmNotes?.generatedAt;
              const unresolvedPreview = report?.unresolvedNeighborhoods.slice(0, 3) ?? [];
              const unresolvedRemainder = report ? report.unresolvedNeighborhoods.length - unresolvedPreview.length : 0;
              return (
                <tr key={doc.id} className={doc.excludedAt ? styles.removedRow : undefined}>
                  <td className={styles.docCell}>
                    <div className={styles.docTitleRow}>
                      <span className={styles.docName}>{docTitle}</span>
                      {doc.excludedAt ? (
                        <Badge tone={doc.excludedReason === "duplicate" ? "warning" : "neutral"}>
                          {doc.excludedReason === "duplicate" ? "duplicate excluded" : "removed"}
                        </Badge>
                      ) : null}
                    </div>
                    {docTitle !== doc.filename ? <span className={styles.docMeta}>{doc.filename}</span> : null}
                    <div className={styles.docChipRow}>
                      {doc.documentBrief && doc.documentBrief.discrepancies.length > 0 ? (
                        <Badge tone="warning">
                          {doc.documentBrief.discrepancies.length} discrepanc
                          {doc.documentBrief.discrepancies.length === 1 ? "y" : "ies"}
                        </Badge>
                      ) : null}
                      {!doc.excludedAt && duplicateTitle ? <Badge tone="warning">possible duplicate</Badge> : null}
                      {!doc.excludedAt && doc.pendingComps > 0 ? (
                        <Link href="/pipeline/comp-analysis" className={styles.pendingCompPill}>
                          {doc.pendingComps} comp{doc.pendingComps === 1 ? "" : "s"} pending
                        </Link>
                      ) : null}
                    </div>
                    {doc.llmNotes ? (
                      <button type="button" className={styles.notesTeaser} onClick={() => setNotesDoc(doc)}>
                        <StickyNote size={14} strokeWidth={2.1} aria-hidden="true" />
                        <span>
                          <strong>Analyst notes ready</strong>
                          <small>
                            {noteCount} signal{noteCount === 1 ? "" : "s"}
                            {notesGeneratedAt ? ` · generated ${formatRelativeTime(notesGeneratedAt, now)}` : ""}
                          </small>
                        </span>
                      </button>
                    ) : (
                      <span className={styles.notesPending}>
                        <FileText size={13} strokeWidth={2} aria-hidden="true" />
                        Notes pending
                      </span>
                    )}
                    {!doc.excludedAt && duplicateTitle ? (
                      <span
                        className={styles.duplicateCallout}
                        title={`Same publisher, period, and class as "${duplicateTitle}".`}
                      >
                        Possible duplicate of <strong>{duplicateTitle}</strong>
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <div className={styles.sourceStack}>
                      {sourceTypeBadge(doc)}
                      <span className={styles.sourceLine}>
                        <strong>Publisher</strong>
                        {doc.publisher ?? "Unknown"}
                      </span>
                      <span className={styles.sourceLine}>
                        <strong>Period</strong>
                        {doc.period_covered ?? "Not detected"}
                      </span>
                      <span className={styles.sourceLine}>
                        <strong>Class</strong>
                        {titleizeToken(doc.document_class)}
                      </span>
                      <span className={styles.sourceLine}>
                        <strong>Confidence</strong>
                        {doc.flagForReview ? (
                          <Badge tone="warning">low — review</Badge>
                        ) : (
                          <Badge tone={doc.classifier_confidence === "high" ? "success" : "neutral"}>
                            {doc.classifier_confidence}
                          </Badge>
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.metricStack}>
                      <span className={styles.metricPrimary}>
                        {report ? `${report.nComps} comp${report.nComps === 1 ? "" : "s"}` : "No extraction yet"}
                      </span>
                      {report ? (
                        <>
                          <span className={styles.metricLine}>
                            {report.nCompsMerged} merged · {doc.pendingComps || report.nCompsPendingReview || 0} pending review
                          </span>
                          <span className={styles.metricLine}>
                            {report.nStats} stat{report.nStats === 1 ? "" : "s"} · {report.affectedNeighborhoods.length} neighborhood
                            {report.affectedNeighborhoods.length === 1 ? "" : "s"} updated
                          </span>
                          {report.unresolvedNeighborhoods.length > 0 ? (
                            <span className={styles.reportWarning}>
                              Unresolved: {unresolvedPreview.join(", ")}
                              {unresolvedRemainder > 0 ? ` +${unresolvedRemainder} more` : ""}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                      {!doc.excludedAt && doc.pendingComps > 0 ? (
                        <Link href="/pipeline/comp-analysis" className={styles.reviewQueueLink}>
                          Review queue →
                        </Link>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className={styles.statusBlock}>
                      <div className={styles.statusLine}>
                        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                        <span className={styles.statusTime}>
                          <Clock3 size={12} strokeWidth={2} aria-hidden="true" />
                          uploaded {formatRelativeTime(doc.createdAt, now)}
                        </span>
                      </div>
                      <div
                        className={styles.progressTrack}
                        aria-label={`${statusMeta.label} progress`}
                        title={`${statusMeta.progress}%`}
                      >
                        <span
                          className={`${styles.progressFill} ${doc.status === "failed" ? styles.progressFillFailed : ""}`}
                          style={{ width: `${statusMeta.progress}%` }}
                        />
                      </div>
                      <span className={styles.statusDetail}>{statusMeta.detail}</span>
                      {notesGeneratedAt ? (
                        <span className={styles.statusDetail}>Notes {formatRelativeTime(notesGeneratedAt, now)}</span>
                      ) : null}
                      {doc.documentBrief?.incorporatedAt ? (
                        <span className={styles.statusDetail}>
                          Brief incorporated {formatRelativeTime(doc.documentBrief.incorporatedAt, now)}
                        </span>
                      ) : null}
                      {doc.excludedAt ? (
                        <span className={styles.statusDetail}>
                          {doc.excludedReason === "duplicate" ? "Excluded as duplicate" : "Removed"} {formatRelativeTime(doc.excludedAt, now)}
                        </span>
                      ) : null}
                      {doc.status === "failed" && doc.error ? <span className={styles.statusError}>{doc.error}</span> : null}
                      {report?.flags.length ? <span className={styles.reportFlags}>{report.flags.join(" · ")}</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className={styles.actionsCell}>
                      {doc.llmNotes ? (
                        <Button variant="secondary" size="sm" onClick={() => setNotesDoc(doc)}>
                          <FileText size={13} strokeWidth={2} aria-hidden="true" />
                          Open notes
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" disabled>
                          <FileText size={13} strokeWidth={2} aria-hidden="true" />
                          Notes pending
                        </Button>
                      )}
                      {doc.status === "failed" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void retryDocument(doc.id)}
                          disabled={retryingId != null}
                        >
                          <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
                          {retryingId === doc.id ? "Retrying…" : "Retry"}
                        </Button>
                      ) : null}
                      {doc.excludedAt ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void restoreDocument(doc)}
                          disabled={rowBusyId != null}
                        >
                          <Undo2 size={13} strokeWidth={2} aria-hidden="true" />
                          {rowBusyId === doc.id ? "Restoring…" : "Restore"}
                        </Button>
                      ) : (
                        <Button
                          variant={doc.duplicateOfId ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setRemoveTarget(doc)}
                          disabled={rowBusyId != null}
                        >
                          <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                          {doc.duplicateOfId ? "Exclude duplicate" : "Remove"}
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {visibleDocuments.length === 0 && !listError ? (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>
                  No market documents ingested yet — drop the first research report or broker package above.
                </td>
              </tr>
            ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---- Per-document analyst notes dialog ---- */}
      <Dialog
        open={notesDoc != null}
        onClose={() => setNotesDoc(null)}
        title={notesDoc?.llmNotes?.title ?? "Analyst notes"}
        description={
          notesDoc?.llmNotes
            ? `${notesDoc.llmNotes.sourceLabel} · generated ${formatWhen(notesDoc.llmNotes.generatedAt)} · ${notesDoc.llmNotes.providers.join(" → ")}`
            : undefined
        }
        size="lg"
      >
        {notesDoc?.llmNotes ? (
          <div className={styles.notesBody}>
            <div className={styles.notesSummary}>
              <span className={styles.notesSummaryTitle}>
                <StickyNote size={15} strokeWidth={2.1} aria-hidden="true" />
                Analyst notes
              </span>
              <span>
                <strong>Source</strong>
                {notesDoc.llmNotes.sourceLabel}
              </span>
              <span>
                <strong>Period</strong>
                {notesDoc.llmNotes.periodCovered ?? notesDoc.period_covered ?? "Not detected"}
              </span>
              <span>
                <strong>Signals</strong>
                {notesSignalCount(notesDoc.llmNotes)}
              </span>
              <span>
                <strong>Generated</strong>
                {formatRelativeTime(notesDoc.llmNotes.generatedAt, now)}
              </span>
            </div>
            <NotesSection title="Overview" items={notesDoc.llmNotes.overview} />
            {notesDoc.llmNotes.neighborhoods.length > 0 ? (
              <div className={styles.briefGroup}>
                <span className={styles.briefGroupTitle}>Neighborhoods</span>
                <ul className={styles.briefList}>
                  {notesDoc.llmNotes.neighborhoods.map((hood) => (
                    <li key={hood.name}>
                      <strong>{hood.name}</strong> — {hood.takeaway}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {notesDoc.llmNotes.assetTypes.length > 0 ? (
              <div className={styles.briefGroup}>
                <span className={styles.briefGroupTitle}>Asset types</span>
                <ul className={styles.attentionList}>
                  {notesDoc.llmNotes.assetTypes.map((take) => (
                    <li key={take.segment} className={styles.attentionRow}>
                      <Badge tone={DIRECTION_META[take.direction].tone}>{DIRECTION_META[take.direction].label}</Badge>
                      <span>
                        <strong>{take.segment}</strong> — {take.note}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <NotesSection title="Buying & selling activity" items={notesDoc.llmNotes.buyerActivity} />
            <NotesSection title="Notable transactions" items={notesDoc.llmNotes.notableTransactions} />
            <NotesSection title="Cap rates & $/SF" items={notesDoc.llmNotes.capRatePsf} />
            <NotesSection title="Financing & loan environment" items={notesDoc.llmNotes.financing} />
            <NotesSection title="Small-building focus" items={notesDoc.llmNotes.smallBuildingFocus} />
            <NotesSection title="Regulatory" items={notesDoc.llmNotes.regulatory} />
            <NotesSection title="Risks & watch items" items={notesDoc.llmNotes.risksWatchItems} />
            {notesDoc.llmNotes.investmentRelevance.length > 0 ? (
              <div className={styles.opportunityBox}>
                <span className={styles.briefGroupTitle}>
                  <Crosshair size={14} strokeWidth={2} aria-hidden="true" />
                  Why it matters for small-MF acquisitions
                </span>
                <ul className={styles.briefList}>
                  {notesDoc.llmNotes.investmentRelevance.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <span className={styles.emptyNote}>No notes stored for this document.</span>
        )}
      </Dialog>

      {/* ---- Remove confirmation ---- */}
      <ConfirmDialog
        open={removeTarget != null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) void removeDocument(removeTarget, removeTarget.duplicateOfId ? "duplicate" : "removed");
        }}
        busy={rowBusyId != null}
        title={`Remove “${removeTarget?.report_title ?? removeTarget?.filename ?? "document"}”?`}
        description={
          removeTarget?.duplicateOfId
            ? "This looks like a duplicate upload — it will be excluded as a duplicate. Its comps leave the rollups and comp surfaces, its stats stop backing the map, and the live AI review will drop it on the next refresh. You can restore it later."
            : "The document is excluded (not deleted): its comps leave the rollups and comp surfaces, its stats stop backing the map, and the live AI review will drop it on the next refresh. You can restore it later."
        }
        confirmLabel={removeTarget?.duplicateOfId ? "Exclude duplicate" : "Remove document"}
      />
    </div>
  );
}
