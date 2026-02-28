/**
 * Listing snapshot: raw lake metadata + pointer to raw payload.
 * Snapshots use a pruned flag (not hard delete) so we can audit and optionally undelete.
 */
export interface ListingSnapshot {
  id: string;
  listingId: string;
  /** Run that produced this snapshot (optional). */
  runId: string | null;
  capturedAt: string;
  /** Path to raw payload file (local path or S3 key). */
  rawPayloadPath: string;
  /** Raw lake metadata (e.g. fetch time, status code). */
  metadata: SnapshotMetadata;
  /** If true, snapshot is logically pruned (excluded from default queries). */
  pruned: boolean;
  createdAt: string;
}

export interface SnapshotMetadata {
  fetchedAt?: string;
  statusCode?: number;
  contentType?: string;
  byteLength?: number;
  [key: string]: unknown;
}
