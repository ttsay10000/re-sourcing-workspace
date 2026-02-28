"use client";

import { useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface ListingRow {
  source: string;
  externalId: string;
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

interface RunResult {
  runId: string;
  searchUrl: string;
  stubsCount: number;
  listings: ListingRow[];
  errors?: { stubUrl: string; message: string }[];
}

export default function AgentTestPage() {
  const [activeLimit, setActiveLimit] = useState<string>("50");
  const [pastLimit, setPastLimit] = useState<string>("50");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const body = {
        activeLimit: activeLimit ? Number(activeLimit) : null,
        pastLimit: pastLimit ? Number(pastLimit) : null,
      };
      const res = await fetch(`${API_BASE}/api/test-agent/run-first-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="page-title">NYC Real Estate API Test</h1>
      <p className="card" style={{ marginBottom: "1rem" }}>
        Fetch active sales and past sales (last 3 months) from the NYC Real Estate API.
        Results appear here and under <Link href="/runs">Runs</Link> and{" "}
        <Link href="/listings">Listings</Link> for review (not saved to the main
        listings database). Set <code>RAPIDAPI_KEY</code> in the API server environment.
      </p>

      <form onSubmit={handleSubmit} className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Active sales limit</label>
            <input
              type="number"
              min={1}
              max={200}
              value={activeLimit}
              onChange={(e) => setActiveLimit(e.target.value)}
              className="input-text"
              style={{ width: "6rem" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Past sales limit (3 mo)</label>
            <input
              type="number"
              min={1}
              max={200}
              value={pastLimit}
              onChange={(e) => setPastLimit(e.target.value)}
              className="input-text"
              style={{ width: "6rem" }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? "Fetching…" : "Fetch active + past sales"}
        </button>
      </form>

      {error && (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div className="card">
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Results</h2>
          <p>
            This run is saved for review. View it under{" "}
            <Link href="/runs">Runs</Link> or <Link href="/listings">Listings</Link>.
          </p>
          <p>
            <a href={result.searchUrl} target="_blank" rel="noopener noreferrer">
              NYC Real Estate API on RapidAPI
            </a>
          </p>
          <p>
            Listings: {result.listings.length}
          </p>
          {result.errors && result.errors.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <strong>Errors ({result.errors.length}):</strong>
              <ul style={{ margin: "0.25rem 0 0 1rem", fontSize: "0.875rem" }}>
                {result.errors.map((e, i) => (
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
          {result.listings.length > 0 && (
            <div style={{ marginTop: "1rem", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                      Type
                    </th>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                      Address
                    </th>
                    <th style={{ textAlign: "right", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                      Price
                    </th>
                    <th style={{ textAlign: "center", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                      Beds
                    </th>
                    <th style={{ textAlign: "center", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                      Baths
                    </th>
                    <th style={{ textAlign: "right", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                      Sqft
                    </th>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                      Link
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.listings.map((row, i) => (
                    <tr key={i}>
                      <td style={{ padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                        {row.extra?.apiSegment === "past" ? "Past" : row.extra?.apiSegment === "active" ? "Active" : "—"}
                      </td>
                      <td style={{ padding: "0.35rem", borderBottom: "1px solid #27272a" }}>{row.address}</td>
                      <td style={{ textAlign: "right", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                        ${row.price.toLocaleString()}
                      </td>
                      <td style={{ textAlign: "center", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                        {row.beds}
                      </td>
                      <td style={{ textAlign: "center", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                        {row.baths}
                      </td>
                      <td style={{ textAlign: "right", padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
                        {row.sqft ?? "—"}
                      </td>
                      <td style={{ padding: "0.35rem", borderBottom: "1px solid #27272a" }}>
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
        </div>
      )}
    </>
  );
}
