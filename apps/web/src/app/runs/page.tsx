"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface TestRunSummary {
  id: string;
  createdAt: string;
  searchUrl: string;
  stubsCount: number;
  listingsCount: number;
  errorsCount: number;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/test-agent/runs`)
      .then((r) => r.json())
      .then((data) => setRuns(data.runs ?? []))
      .catch((e) => setError(e.message || "Failed to load runs"))
      .finally(() => setLoading(false));
  }, []);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <>
      <h1 className="page-title">Runs</h1>
      <p className="card" style={{ marginBottom: "1rem" }}>
        Test runs from the NYC Real Estate API (active + past 3 months sales).
        These are for review only and are not saved to the main listings database.
      </p>

      {loading && <div className="card">Loading runs…</div>}
      {error && (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {!loading && !error && runs.length === 0 && (
        <div className="card">
          No test runs yet. Run a test from{" "}
          <Link href="/agent-test">Agent test</Link>.
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div className="card" style={{ maxWidth: "none" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                  Run at
                </th>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                  Search
                </th>
                <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                  Listings
                </th>
                <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                  Errors
                </th>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {formatTime(run.createdAt)}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    <a href={run.searchUrl} target="_blank" rel="noopener noreferrer">
                      API docs
                    </a>
                  </td>
                  <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {run.listingsCount}
                  </td>
                  <td style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {run.errorsCount > 0 ? (
                      <span className="error">{run.errorsCount}</span>
                    ) : (
                      0
                    )}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    <Link href={`/runs/${run.id}`}>View listings</Link>
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
