"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "./dossierSuccess.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }, 1000);
}

function DossierSuccessContent() {
  const searchParams = useSearchParams();
  const [downloading, setDownloading] = useState<"pdf" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const propertyId = searchParams.get("property_id") ?? "";
  const dossierId = searchParams.get("dossier_id") ?? "";
  const excelId = searchParams.get("excel_id") ?? "";
  const emailSent = searchParams.get("email_sent") === "1";
  const dealScoreParam = searchParams.get("deal_score");
  const dealScore = dealScoreParam != null && /^\d+$/.test(dealScoreParam) ? Number(dealScoreParam) : null;

  const dossierUrl =
    propertyId && dossierId
      ? `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/${encodeURIComponent(dossierId)}/file`
      : null;
  const excelUrl =
    propertyId && excelId
      ? `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/${encodeURIComponent(excelId)}/file`
      : null;

  async function downloadDocument(
    url: string,
    fallbackName: string,
    kind: "pdf" | "excel"
  ) {
    setDownloading(kind);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.details || data?.error || "Failed to download file.");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
      const fileName = fileNameMatch?.[1]
        ? decodeURIComponent(fileNameMatch[1])
        : fallbackName;
      downloadBlob(blob, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download file.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <p className={styles.kicker}>Output ready</p>
        <h1 className={styles.title}>Deal dossier generated</h1>
        <p className={styles.copy}>
        Your deal dossier and Excel pro forma have been saved to the property documents.
        {dealScore != null && (
          <> Deal score: <strong>{dealScore}/100</strong> (included in dossier PDF).</>
        )}
        {emailSent && " A copy was sent to your profile email address."}
        </p>
      <div className={styles.actions}>
        {dossierUrl && (
          <button
            type="button"
            onClick={() => void downloadDocument(dossierUrl, "Deal-Dossier.pdf", "pdf")}
            disabled={downloading != null}
            className={styles.downloadButton}
          >
            {downloading === "pdf" ? "Downloading dossier..." : "Download dossier (PDF)"}
          </button>
        )}
        {excelUrl && (
          <button
            type="button"
            onClick={() => void downloadDocument(excelUrl, "Deal-Dossier-Workbook.xlsx", "excel")}
            disabled={downloading != null}
            className={`${styles.downloadButton} ${styles.downloadButtonSecondary}`}
          >
            {downloading === "excel" ? "Downloading Excel..." : "Download Excel pro forma"}
          </button>
        )}
        {(!dossierUrl || !excelUrl) && (
          <p className={styles.copy}>
            Missing document IDs in the URL. You can still open the property and download from the Documents section.
          </p>
        )}
        {error && (
          <p className={styles.error}>
            {error}
          </p>
        )}
      </div>
      </section>
      <p className={styles.links}>
        {propertyId && (
          <>
            <Link href={`/property/${propertyId}`}>View property &amp; documents</Link>
            {" · "}
          </>
        )}
        <Link href={propertyId ? `/deal-analysis?property_id=${encodeURIComponent(propertyId)}` : "/deal-analysis"}>
          Back to deal analysis
        </Link>
      </p>
    </div>
  );
}

export default function DossierSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <section className={styles.panel}>
            <p className={styles.kicker}>Output ready</p>
            <h1 className={styles.title}>Deal dossier generated</h1>
            <p className={styles.copy}>Loading…</p>
          </section>
        </div>
      }
    >
      <DossierSuccessContent />
    </Suspense>
  );
}
