/**
 * Shared bulk-action runner for property workflows (OM analysis refresh,
 * dossier rerun, ...). The Pipeline table and the Deal Progress board used to
 * carry near-identical copies of this loop; both now delegate here and keep
 * only their page-specific reload + state wiring.
 */
import type { ProcessHandle } from "@/components/ProcessBanner";

export interface BulkRunRow {
  propertyId: string;
  address: string;
}

export interface BulkRunFailure {
  propertyId: string;
  address: string;
  message: string;
}

export interface BulkRunSummary {
  completed: number;
  failures: BulkRunFailure[];
  /** Human summary for the notice + banner (success or partial). */
  summaryMessage: string;
  /** First-failure detail for the error strip; null when everything passed. */
  errorMessage: string | null;
}

export interface RunBulkPropertyActionParams {
  rows: BulkRunRow[];
  /** Selected items that were filtered out before the run (e.g. no OM). */
  skippedCount?: number;
  /** "property" (pipeline) or "deal" (progress board). */
  noun?: string;
  /** e.g. "Updating OM analysis" — used for per-item progress messages. */
  progressVerb: string;
  /** e.g. "OM analysis updated" — used for the final summary. */
  successVerb: string;
  /** e.g. "OM analysis refresh" — used in the failure-count error message. */
  failureNoun: string;
  banner: ProcessHandle;
  /** Receives every progress + summary message (wire to setNotice). */
  onProgress?: (message: string) => void;
  /** Run the underlying API call for one property; throw to record a failure. */
  runOne: (row: BulkRunRow) => Promise<void>;
  /** Optional extra sentence appended to the success summary. */
  extraSummary?: () => string;
}

export async function runBulkPropertyAction(params: RunBulkPropertyActionParams): Promise<BulkRunSummary> {
  const {
    rows,
    skippedCount = 0,
    noun = "property",
    progressVerb,
    successVerb,
    failureNoun,
    banner,
    onProgress,
    runOne,
    extraSummary,
  } = params;
  const plural = (count: number) => (noun === "property" ? (count === 1 ? "property" : "properties") : count === 1 ? noun : `${noun}s`);

  let completed = 0;
  const failures: BulkRunFailure[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const progressMessage = `${progressVerb} ${index + 1} of ${rows.length}: ${row.address}`;
    onProgress?.(progressMessage);
    banner.update(progressMessage, Math.round((index / rows.length) * 100));
    try {
      await runOne(row);
      completed++;
    } catch (err) {
      failures.push({
        propertyId: row.propertyId,
        address: row.address,
        message: err instanceof Error ? err.message : `${progressVerb} failed.`,
      });
    }
  }

  const skippedMessage = skippedCount > 0 ? ` ${skippedCount} selected without OM skipped.` : "";
  const extra = extraSummary?.() ?? "";
  const summaryMessage =
    failures.length === 0
      ? `${successVerb} for ${completed} ${plural(completed)}.${skippedMessage}${extra}`
      : `${successVerb} for ${completed} of ${rows.length} eligible ${plural(rows.length)}.${skippedMessage}${extra}`;
  const errorMessage =
    failures.length > 0
      ? `${failures.length} ${failureNoun}${failures.length === 1 ? "" : "s"} failed. First issue: ${failures[0]!.address} - ${failures[0]!.message}`
      : null;

  onProgress?.(summaryMessage);
  if (failures.length > 0) banner.fail(summaryMessage);
  else banner.succeed(summaryMessage);

  return { completed, failures, summaryMessage, errorMessage };
}
