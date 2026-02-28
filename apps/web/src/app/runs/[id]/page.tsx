"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface ListingRow {
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft?: number | null;
  url: string;
  title?: string | null;
  extra?: { apiSegment?: string } | null;
}

interface TestRunDetail {
  id: string;
  createdAt: string;
  searchUrl: string;
  stubsCount: number;
  listings: ListingRow[];
  errors: { stubUrl: string; message: string }[];
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
        {error || "Run not found."}{" "}
        <Link href="/runs">Back to Runs</Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Run at {formatTime(run.createdAt)}</h1>
      <p className="card" style={{ marginBottom: "1rem" }}>
        <Link href="/runs">← Back to Runs</Link>
        {" · "}
        <a href={run.searchUrl} target="_blank" rel="noopener noreferrer">
          NYC Real Estate API
        </a>
      </p>
      <p style={{ marginBottom: "1rem" }}>
        Listings: {run.listings.length}
        {run.errors.length > 0 && ` — Errors: ${run.errors.length}`}
      </p>

      {run.errors.length > 0 && (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          <strong>Errors:</strong>
          <ul style={{ margin: "0.25rem 0 0 1rem" }}>
            {run.errors.map((e, i) => (
              <li key={i}>
                <a href={e.stubUrl} target="_blank" rel="noopener noreferrer">
                  {e.stubUrl}
                </a>
                : {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.listings.length > 0 && (
        <div className="card" style={{ maxWidth: "none" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                  Type
                </th>
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
              {run.listings.map((row, i) => (
                <tr key={i}>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {row.extra?.apiSegment === "past" ? "Past" : row.extra?.apiSegment === "active" ? "Active" : "—"}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {row.address}
                  </td>
                  <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    ${row.price.toLocaleString()}
                  </td>
                  <td style={{ textAlign: "center", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {row.beds}
                  </td>
                  <td style={{ textAlign: "center", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {row.baths}
                  </td>
                  <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {row.sqft ?? "—"}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    <a href={row.url} target="_blank" rel="noopener noreferrer">
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
