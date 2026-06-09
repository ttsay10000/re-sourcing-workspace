"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface ReviewAttachmentCandidate {
  id?: string | null;
  filename?: string | null;
  category?: string | null;
  classificationLabel?: string | null;
  classificationConfidence?: string | null;
  reviewRole?: string | null;
}

interface ReviewQueueItem {
  id: string;
  propertyId: string;
  canonicalAddress: string;
  priority: string;
  summary?: string | null;
  details: {
    subject?: string | null;
    fromAddress?: string | null;
    matchedBatchIds?: string[];
    attachmentCandidates?: ReviewAttachmentCandidate[];
  };
  createdAt: string;
}

interface ReviewQueueGroup {
  groupKey: string;
  isAmbiguous: boolean;
  items: ReviewQueueItem[];
}

function attachmentLabel(candidate: ReviewAttachmentCandidate): string {
  const category = candidate.category ?? candidate.classificationLabel ?? "Document";
  const confidence = candidate.classificationConfidence ? `, ${candidate.classificationConfidence}` : "";
  const role = candidate.reviewRole === "supporting" ? ", supporting" : "";
  return `${category}${confidence}${role}`;
}

export default function OmReviewPage() {
  const [groups, setGroups] = useState<ReviewQueueGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/properties/om-attachment-review-queue`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.details || "Failed to load review queue");
      setGroups(data.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const createReviewRun = async (item: ReviewQueueItem) => {
    setRunningActionId(item.id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/properties/${encodeURIComponent(item.propertyId)}/action-items/${encodeURIComponent(item.id)}/create-om-review-run`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
      );
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.details || "Failed to create review run");
      setNotice(`Review run created for ${item.canonicalAddress}.`);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create review run");
    } finally {
      setRunningActionId(null);
    }
  };

  return (
    <div className="profile-page profile-page--holistic">
      <header className="profile-page-header">
        <div>
          <p className="profile-page-kicker">Manual document review</p>
          <h1 className="page-title profile-page-title">OM Review Queue</h1>
          <p className="profile-page-intro">
            Create review runs from broker attachments. Ambiguous batch replies stay grouped for human review.
          </p>
        </div>
        <Link href="/property-data" className="profile-secondary-button">
          Property Data
        </Link>
        <Link href="/broker-om/email-search" className="profile-secondary-button">
          Manual Gmail Pull
        </Link>
      </header>

      {error && <p className="profile-page-error">{error}</p>}
      {notice && <p style={{ color: "#166534", marginTop: 0 }}>{notice}</p>}

      <section className="profile-section">
        <div className="profile-section-heading">
          <div>
            <h2>Broker attachments</h2>
            <p>Each action creates a needs-review extraction run only. Promotion remains separate.</p>
          </div>
          <button type="button" onClick={() => void loadQueue()} className="profile-secondary-button">
            Refresh
          </button>
        </div>

        {loading ? (
          <p>Loading review queue...</p>
        ) : groups.length === 0 ? (
          <p className="profile-section-note">No broker attachment review actions are open.</p>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {groups.map((group) => (
              <section key={group.groupKey} className="profile-assumption-group">
                <div className="profile-assumption-group-header">
                  <h3>{group.isAmbiguous ? "Batch review" : "Single-property review"}</h3>
                  <p>{group.items.length} propert{group.items.length === 1 ? "y" : "ies"} linked to this broker reply.</p>
                </div>
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  {group.items.map((item) => {
                    const attachments = item.details.attachmentCandidates ?? [];
                    return (
                      <article key={item.id} className="profile-saved-deal-card">
                        <div className="profile-saved-deal-main">
                          <h4 className="profile-saved-deal-address">{item.canonicalAddress}</h4>
                          <p style={{ margin: "0.35rem 0", color: "#57534e" }}>
                            {item.summary ?? "Create document review run"}
                          </p>
                          <p style={{ margin: 0, color: "#737373", fontSize: "0.9rem" }}>
                            {item.details.fromAddress ?? "Unknown sender"} {item.details.subject ? `| ${item.details.subject}` : ""}
                          </p>
                          <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.85rem" }}>
                            {attachments.map((attachment, index) => (
                              <div key={`${attachment.id ?? attachment.filename ?? index}`} style={{ color: "#44403c" }}>
                                <strong>{attachment.filename ?? "Attachment"}</strong> - {attachmentLabel(attachment)}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="profile-saved-deals-actions profile-saved-deals-actions--row">
                          <Link href={`/property-data?expand=${item.propertyId}`} className="profile-saved-deals-action">
                            View property
                          </Link>
                          <button
                            type="button"
                            onClick={() => void createReviewRun(item)}
                            disabled={runningActionId === item.id}
                            className="profile-saved-deals-action"
                          >
                            {runningActionId === item.id ? "Creating..." : "Create review run"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
