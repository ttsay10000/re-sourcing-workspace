"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface TestRunSummary {
  id: string;
  startedAt: string;
  propertiesCount: number;
  errorsCount: number;
}

interface TestRunDetail {
  id: string;
  startedAt: string;
  properties: Record<string, unknown>[];
}

function pick(p: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (p[k] != null && p[k] !== "") return String(p[k]);
  }
  return "—";
}

/** Flatten all properties from all runs for display. */
interface ListingWithRun {
  runId: string;
  runAt: string;
  address: string;
  price: number;
  beds: string;
  baths: string;
  sqft: string;
  url: string;
}

export default function ListingsPage() {
  const [listings, setListings] = useState<ListingWithRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/test-agent/runs`)
      .then((r) => r.json())
      .then(async (data: { runs: TestRunSummary[] }) => {
        const runs = data.runs ?? [];
        const all: ListingWithRun[] = [];
        for (const run of runs) {
          const detailRes = await fetch(`${API_BASE}/api/test-agent/runs/${run.id}`);
          if (!detailRes.ok) continue;
          const detail: TestRunDetail = await detailRes.json();
          const runAt = detail.startedAt;
          for (const p of detail.properties ?? []) {
            all.push({
              runId: detail.id,
              runAt,
              address: pick(p, "address", "formatted_address", "street_address", "title"),
              price: Number(p.price ?? p.list_price ?? 0),
              beds: pick(p, "bedrooms", "beds"),
              baths: pick(p, "bathrooms", "baths"),
              sqft: pick(p, "square_feet", "sqft", "sqft_feet"),
              url: String(p.url ?? p.link ?? p.listing_url ?? "#"),
            });
          }
        }
        setListings(all);
      })
      .catch((e) => setError(e.message || "Failed to load listings"))
      .finally(() => setLoading(false));
  }, []);

  const formatTime = (iso: string) => new Date(iso).toLocaleString();

  return (
    <>
      <h1 className="page-title">Listings</h1>
      <p className="card" style={{ marginBottom: "1rem" }}>
        Listings from NYC Real Estate API test runs (for review only; not saved to
        the main database). Each row shows when the run was conducted; click
        &quot;View&quot; to open the listing.
      </p>

      {loading && <div className="card">Loading listings…</div>}
      {error && (
        <div className="card error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {!loading && !error && listings.length === 0 && (
        <div className="card">
          No properties yet. Start a run from <Link href="/runs">Runs</Link> (filters + Send).
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="card" style={{ maxWidth: "none" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                  Run at
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
              {listings.map((row, i) => (
                <tr key={`${row.runId}-${i}`}>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    <Link href={`/runs/${row.runId}`}>{formatTime(row.runAt)}</Link>
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
                    {row.sqft}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #27272a" }}>
                    {row.url !== "#" ? (
                      <a href={row.url} target="_blank" rel="noopener noreferrer">
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
      )}
    </>
  );
}
