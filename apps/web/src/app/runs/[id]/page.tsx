"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { PageHeader, Panel, SkeletonRows } from "@/components/ui";
import styles from "../runs.module.css";

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

  if (loading) {
    return (
      <div className={styles.page}>
        <SkeletonRows count={6} />
      </div>
    );
  }
  if (error || !run) {
    return (
      <div className={styles.error}>
        {error || "Run not found."}{" "}
        <Link href="/runs" className={styles.link}>
          Back to Sourcing Agent
        </Link>
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
    <div className={styles.page}>
      <PageHeader title={<>Sourcing Agent Run at {formatTime(run.startedAt)}</>} />
      <p className={styles.backLine}>
        <Link href="/runs" className={styles.link}>
          ← Back to Sourcing Agent
        </Link>
      </p>
      <p className={styles.runSummary}>
        Step 1: {run.step1Status} ({run.step1Count} URLs) — Step 2: {run.step2Status} (
        {run.step2Count}/{run.step2Total} properties)
        {run.errors.length > 0 && ` — Errors: ${run.errors.length}`}
      </p>

      {run.errors.length > 0 && (
        <div className={styles.error}>
          <strong>Errors:</strong>
          <ul className={styles.errorList}>
            {run.errors.map((e, i) => (
              <li key={i}>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
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
        <Panel padding="lg">
          <h2 className={styles.sectionTitle}>
            <Building2 size={16} strokeWidth={2} aria-hidden="true" className={styles.sectionIcon} />
            Property data (raw)
          </h2>
          <div className={`${styles.tableScroll} ${styles.logScroll}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    Address
                  </th>
                  <th className={styles.cellNum}>
                    Price
                  </th>
                  <th className={styles.cellNum}>
                    Beds
                  </th>
                  <th className={styles.cellNum}>
                    Baths
                  </th>
                  <th className={styles.cellNum}>
                    Sqft
                  </th>
                  <th>
                    Link
                  </th>
                  <th>
                    Broker / Agent
                  </th>
                  <th className={styles.cellCenter}>
                    Photos
                  </th>
                </tr>
              </thead>
              <tbody>
                {run.properties.map((p, i) => {
                  const brokerDisplay = (() => {
                    const agents = p.agents;
                    if (Array.isArray(agents) && agents.length > 0) {
                      return agents.map((a) => (a != null ? String(a) : "")).filter(Boolean).join(", ") || "—";
                    }
                    return pick(p, "broker_name", "broker", "listing_agent", "agent_name", "agent");
                  })();
                  const imgs = Array.isArray(p.images) ? (p.images as string[]).filter((u): u is string => typeof u === "string") : [];
                  const firstImg = imgs[0];
                  return (
                  <tr key={i}>
                    <td>
                      {pick(p, "address", "formatted_address", "street_address", "title")}
                    </td>
                    <td className={styles.cellNum}>
                      {p.price != null || p.list_price != null
                        ? `$${Number(p.price ?? p.list_price ?? 0).toLocaleString()}`
                        : "—"}
                    </td>
                    <td className={styles.cellNum}>
                      {pick(p, "bedrooms", "beds")}
                    </td>
                    <td className={styles.cellNum}>
                      {pick(p, "bathrooms", "baths")}
                    </td>
                    <td className={styles.cellNum}>
                      {pick(p, "square_feet", "sqft", "sqft_feet")}
                    </td>
                    <td>
                      {(p._fetchUrl != null && String(p._fetchUrl).trim()) || (p.url || p.link || p.listing_url) ? (
                        <a
                          href={String((p._fetchUrl != null && String(p._fetchUrl).trim()) ? p._fetchUrl : (p.url ?? p.link ?? p.listing_url))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.link}
                        >
                          view source
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {brokerDisplay}
                    </td>
                    <td className={styles.cellCenter}>
                      {imgs.length > 0 ? (
                        <span className={styles.photoWrap}>
                          {firstImg && (
                            <a href={firstImg} target="_blank" rel="noopener noreferrer" className={styles.thumbLink}>
                              <img src={firstImg} alt="" loading="lazy" className={styles.thumb} />
                            </a>
                          )}
                          <span className={styles.photoCount}>{imgs.length} photo{imgs.length !== 1 ? "s" : ""}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
