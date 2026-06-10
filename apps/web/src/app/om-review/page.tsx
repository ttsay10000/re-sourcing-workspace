"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, PageHeader, SkeletonRows } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import styles from "./omReview.module.css";

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

function priorityTone(priority: string) {
  if (priority === "high") return "warning" as const;
  if (priority === "urgent") return "danger" as const;
  return "neutral" as const;
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
    <div className={styles.page}>
      <PageHeader
        eyebrow="Broker OM"
        title="Email Review Queue"
        subtitle="Triage broker email attachments and create extraction review runs. Ambiguous batch replies stay grouped for human review. For uploading and analyzing OM packages, use the OM Workspace under Deal Progress."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void loadQueue()}>
              Refresh
            </Button>
            <Link href="/property-data">
              <Button variant="secondary" size="sm">Property Data</Button>
            </Link>
            <Link href="/broker-om/email-search">
              <Button variant="secondary" size="sm">Manual Gmail Pull</Button>
            </Link>
          </>
        }
      />

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionHeadingCopy}>
            <h2>Broker attachments</h2>
            <p>Each action creates a needs-review extraction run only. Promotion remains separate.</p>
          </div>
        </div>

        {loading ? (
          <SkeletonRows count={4} />
        ) : groups.length === 0 ? (
          <EmptyState
            title="Queue is clear"
            description="No broker attachment review actions are open."
          />
        ) : (
          <div className={styles.groupList}>
            {groups.map((group) => (
              <section key={group.groupKey} className={styles.group}>
                <div className={styles.groupHeader}>
                  <div>
                    <h3>{group.isAmbiguous ? "Batch review" : "Single-property review"}</h3>
                    <p>{group.items.length} propert{group.items.length === 1 ? "y" : "ies"} linked to this broker reply.</p>
                  </div>
                  {group.isAmbiguous && <Badge tone="warning">Ambiguous</Badge>}
                </div>
                <div className={styles.groupItems}>
                  {group.items.map((item) => {
                    const attachments = item.details.attachmentCandidates ?? [];
                    return (
                      <article key={item.id} className={styles.item}>
                        <div className={styles.itemMain}>
                          <h4 className={styles.itemAddress}>{item.canonicalAddress}</h4>
                          <p className={styles.itemSummary}>
                            {item.summary ?? "Create document review run"}
                          </p>
                          <p className={styles.itemMeta}>
                            {item.details.fromAddress ?? "Unknown sender"}
                            {item.details.subject ? ` | ${item.details.subject}` : ""}
                          </p>
                          {attachments.length > 0 && (
                            <div className={styles.attachmentList}>
                              {attachments.map((attachment, index) => (
                                <div key={`${attachment.id ?? attachment.filename ?? index}`} className={styles.attachment}>
                                  <span className={styles.attachmentName}>{attachment.filename ?? "Attachment"}</span>
                                  <Badge tone={priorityTone(item.priority)}>{attachmentLabel(attachment)}</Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className={styles.itemActions}>
                          <Link href={`/property-data?expand=${item.propertyId}`}>
                            <Button variant="secondary" size="sm">View property</Button>
                          </Link>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void createReviewRun(item)}
                            disabled={runningActionId === item.id}
                          >
                            {runningActionId === item.id ? "Creating…" : "Create review run"}
                          </Button>
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
