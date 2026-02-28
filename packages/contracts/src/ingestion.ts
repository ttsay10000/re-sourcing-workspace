import type { IngestionRunStatus, IngestionJobStatus } from "./enums.js";
import type { ListingSource } from "./enums.js";

/**
 * A single ingestion run (one execution of a profile).
 */
export interface IngestionRun {
  id: string;
  profileId: string;
  startedAt: string;
  finishedAt: string | null;
  status: IngestionRunStatus;
  /** Counts, errors, etc. */
  summary: RunSummary | null;
  createdAt: string;
}

export interface RunSummary {
  listingsSeen?: number;
  listingsNew?: number;
  listingsUpdated?: number;
  listingsMissing?: number;
  jobsCompleted?: number;
  jobsFailed?: number;
  errors?: string[];
}

/**
 * A job within a run (one source per job).
 */
export interface IngestionJob {
  id: string;
  runId: string;
  source: ListingSource;
  status: IngestionJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/**
 * Input to start an ingestion run.
 */
export interface StartRunInput {
  profileId: string;
}
