"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function DossierSuccessContent() {
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("property_id") ?? "";
  const dossierId = searchParams.get("dossier_id") ?? "";
  const excelId = searchParams.get("excel_id") ?? "";
  const emailSent = searchParams.get("email_sent") === "1";

  const dossierUrl =
    propertyId && dossierId
      ? `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/${encodeURIComponent(dossierId)}/file`
      : null;
  const excelUrl =
    propertyId && excelId
      ? `${API_BASE}/api/properties/${encodeURIComponent(propertyId)}/documents/${encodeURIComponent(excelId)}/file`
      : null;

  return (
    <div style={{ padding: "1.5rem", maxWidth: "560px" }}>
      <h1 className="page-title">Deal dossier generated</h1>
      <p style={{ marginBottom: "1.5rem", color: "#666" }}>
        Your deal dossier and Excel pro forma have been saved to the property documents.
        {emailSent && " A copy was sent to your profile email address."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {dossierUrl && (
          <a
            href={dossierUrl}
            download
            style={{
              display: "inline-block",
              padding: "0.75rem 1rem",
              background: "#0066cc",
              color: "#fff",
              borderRadius: "6px",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Download dossier (TXT)
          </a>
        )}
        {excelUrl && (
          <a
            href={excelUrl}
            download
            style={{
              display: "inline-block",
              padding: "0.75rem 1rem",
              background: "#15803d",
              color: "#fff",
              borderRadius: "6px",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Download Excel pro forma
          </a>
        )}
        {(!dossierUrl || !excelUrl) && (
          <p style={{ fontSize: "0.875rem", color: "#666" }}>
            Missing document IDs in the URL. You can still open the property and download from the Documents section.
          </p>
        )}
      </div>
      <p style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
        {propertyId && (
          <>
            <Link href={`/property-data?expand=${propertyId}`}>View property &amp; documents</Link>
            {" · "}
          </>
        )}
        <Link href="/dossier-assumptions">Back to dossier assumptions</Link>
      </p>
    </div>
  );
}

export default function DossierSuccessPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "1.5rem" }}>
          <h1 className="page-title">Deal dossier generated</h1>
          <p>Loading…</p>
        </div>
      }
    >
      <DossierSuccessContent />
    </Suspense>
  );
}
