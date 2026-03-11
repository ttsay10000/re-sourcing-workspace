import type { AgentEnrichmentEntry, PriceHistoryEntry } from "./listing.js";
import type { PropertySourcingUpdate } from "./property.js";

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
  rawPayload?: Record<string, unknown> | null;
  agentEnrichment?: AgentEnrichmentEntry[] | null;
  priceHistory?: PriceHistoryEntry[] | null;
  rentalPriceHistory?: PriceHistoryEntry[] | null;
  normalizedListing?: Record<string, unknown> | null;
  sourcingUpdate?: PropertySourcingUpdate | null;
  [key: string]: unknown;
}
