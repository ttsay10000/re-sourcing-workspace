/**
 * Cron/internal endpoints (e.g. process-inbox). Protect with PROCESS_INBOX_CRON_SECRET.
 */

import { Router, type Request, type Response } from "express";
import { processInbox } from "../inquiry/processInbox.js";
import {
  createWorkflowRun,
  mergeWorkflowRunMetadata,
  updateWorkflowRun,
  upsertWorkflowStep,
} from "../workflow/workflowTracker.js";

const router = Router();

function checkCronSecret(req: Request): boolean {
  const secret = process.env.PROCESS_INBOX_CRON_SECRET;
  if (!secret) return true;
  const header = req.headers["x-cron-secret"] ?? req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7) === secret;
  }
  return header === secret;
}

/** POST /api/cron/process-inbox - run inbox processing (match replies to properties, save emails and attachments). */
router.post("/cron/process-inbox", async (req: Request, res: Response) => {
  if (!checkCronSecret(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const maxMessages = req.body?.maxMessages != null ? Number(req.body.maxMessages) : undefined;
    const requestedMax = maxMessages != null && Number.isFinite(maxMessages) ? Math.max(0, maxMessages) : 50;
    workflowRunId = await createWorkflowRun({
      runType: "process_inbox",
      displayName: "Process inbox",
      scopeLabel: `up to ${requestedMax} message${requestedMax === 1 ? "" : "s"}`,
      triggerSource: "cron",
      totalItems: requestedMax,
      metadata: { requestedMaxMessages: requestedMax },
      steps: [
        {
          stepKey: "inbox",
          totalItems: requestedMax,
          status: requestedMax === 0 ? "completed" : "running",
          startedAt: workflowStartedAt,
          finishedAt: requestedMax === 0 ? workflowStartedAt : null,
          lastMessage:
            requestedMax === 0
              ? "No messages requested"
              : `Processing up to ${requestedMax} inbox message${requestedMax === 1 ? "" : "s"}`,
        },
      ],
    });
    const result = await processInbox({ maxMessages });
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inbox",
      totalItems: result.processed,
      completedItems: result.matched,
      failedItems: result.errors.length,
      skippedItems: result.skipped,
      status:
        result.errors.length > 0
          ? result.matched > 0 || result.skipped > 0
            ? "partial"
            : "failed"
          : "completed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: `${result.saved} email${result.saved === 1 ? "" : "s"} saved from ${result.processed} processed`,
      lastError: result.errors[0] ?? null,
    });
    await mergeWorkflowRunMetadata(workflowRunId, result as unknown as Record<string, unknown>);
    await updateWorkflowRun(workflowRunId, {
      status:
        result.errors.length > 0
          ? result.saved > 0 || result.matched > 0 || result.skipped > 0
            ? "partial"
            : "failed"
          : "completed",
      finishedAt: new Date().toISOString(),
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron process-inbox]", err);
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inbox",
      totalItems: 1,
      completedItems: 0,
      failedItems: 1,
      status: "failed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastError: message,
      lastMessage: "Inbox processing failed",
    });
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Process inbox failed.", details: message });
  }
});

export default router;
