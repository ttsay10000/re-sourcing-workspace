"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface TestRunDetail {
  id: string;
  startedAt: string;
  criteria: Record<string, unknown>;
  step1Status: string;
  step1Count: number;
  step1Error: string | null;
  step2Status: string;
  step2Count: number;
  step2Total: number;
  step2Error: string | null;
  properties: Record<string, unknown>[];
  errors: { url?: string; message: string }[];
}

export default function RunDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [run, setRun] = useState<TestRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/api/test-agent/runs/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Run not found");
        return r.json();
      })
      .then(setRun)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const formatTime = (iso: string) => new Date(iso).toLocaleString();

  if (loading) return <div className="card">Loading…</div>;
  if (error || !run) {
    return (
      <div className="card error">
        {error || "Run not found."} <Link href="/runs">Back to Runs</Link>
      </div>
    );
  }

  const pick = (p: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) {
      if (p[k] != null && p[k] !== "") return String(p[k]);
    }
    return "—";
  };

  return (
    <>
      <h1 className="page-title">Run at {formatTime(run.startedAt)}</h1>
      <p className="card" style={{ marginBottom: "1rem" }}>
        <Link href="/runs">← Back to Runs</Link>
        {" · "}
        <a
          href="https://rapidapi.com/realestator/api/nyc-real-estate-api"
          target="_blank"
          rel="noopener noreferrer"
        >
          NYC Real Estate API
        </a>
      </p>
      <p style={{ marginBottom: "1rem" }}>
        Step 1: {run.step1Status} ({run.step1Count} URLs) — Step 2: {run.step2Status} (
        {run.step2Count}/{run.step2Total} properties)
        {run.errors.length > 0 && ` — Errors: ${run.errors.length}`}
      </p>

      {run.errors.length > 0 && (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          <strong>Errors:</strong>
          <ul style={{ margin: "0.25rem 0 0 1rem" }}>
            {run.errors.map((e, i) => (
              <li key={i}>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer">
                    {e.url}
                  </a>
                ) : (
                  "—"
                )}
                : {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.properties.length > 0 && (
        <div className="card" style={{ maxWidth: "none" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Property data (raw)</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    Address
                  </th>
                  <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    Price
                  </th>
                  <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    Beds
                  </th>
                  <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    Baths
                  </th>
                  <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    Sqft
                  </th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    Link
                  </th>
                </tr>
              </thead>
              <tbody>
                {run.properties.map((p, i) => (
                  <tr key={i}>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      {pick(p, "address", "formatted_address", "street_address", "title")}
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      {p.price != null || p.list_price != null
                        ? `$${Number(p.price ?? p.list_price ?? 0).toLocaleString()}`
                        : "—"}
                    </td>
                    <td style={{ textAlign: "center", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      {pick(p, "bedrooms", "beds")}
                    </td>
                    <td style={{ textAlign: "center", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      {pick(p, "bathrooms", "baths")}
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      {pick(p, "square_feet", "sqft", "sqft_feet")}
                    </td>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                      {(p.url || p.link || p.listing_url) ? (
                        <a
                          href={String(p.url ?? p.link ?? p.listing_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
