/**
 * Source of listing data. StreetEasy-first; extensible for other sources.
 */
export type ListingSource = "streeteasy" | "manual" | "zillow" | "nyc_api" | "other";

/**
 * Lifecycle state for filter governance and pruning.
 * - active: currently visible from source
 * - missing: no longer returned by source (e.g. delisted)
 * - pruned: intentionally removed from active view (e.g. filter change, dedupe)
 */
export type ListingLifecycleState = "active" | "missing" | "pruned";

/**
 * Location mode for search profiles.
 * - single: one location slug (e.g. StreetEasy neighborhood)
 * - multi: multiple area codes or identifiers
 */
export type LocationMode = "single" | "multi";

/**
 * Ingestion run status.
 */
export type IngestionRunStatus = "running" | "completed" | "failed" | "cancelled";

/**
 * Ingestion job status.
 */
export type IngestionJobStatus = "pending" | "running" | "completed" | "failed";

/**
 * Match status for listing–property dedupe.
 */
export type MatchStatus = "pending" | "accepted" | "rejected";
