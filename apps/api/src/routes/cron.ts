/**
 * Cron/internal endpoints (e.g. process-inbox). Protect with PROCESS_INBOX_CRON_SECRET.
 */

import { Router, type Request, type Response } from "express";
import { processInbox } from "../inquiry/processInbox.js";
import { getPool, UserProfileRepo } from "@re-sourcing/db";
import { runDueSavedSearches } from "../sourcing/savedSearchRunner.js";
import { runDailyOutreach } from "../sourcing/outreachAutomation.js";
import { sendDailyDigest } from "../notifications/dailyDigest.js";
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

async function getAutomationPauseState(): Promise<{ paused: boolean; reason: string | null }> {
  const pool = getPool();
  const repo = new UserProfileRepo({ pool });
  await repo.ensureDefault();
  const profile = await repo.getDefault();
  return {
    paused: Boolean(profile?.automationPaused),
    reason: profile?.automationPauseReason ?? null,
  };
}

async function withCronLock<T>(lockKey: string, handler: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
  const pool = getPool();
  const client = await pool.connect();
  let acquired = false;
  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockKey]
    );
    acquired = Boolean(lockResult.rows[0]?.locked);
    if (!acquired) return { acquired: false };
    return { acquired: true, result: await handler() };
  } finally {
    if (acquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => {});
    }
    client.release();
  }
}

/** POST /api/cron/process-inbox - run inbox processing (match replies to properties, save emails and attachments). */
router.post("/cron/process-inbox", async (req: Request, res: Response) => {
  if (!checkCronSecret(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const pauseState = await getAutomationPauseState();
  if (pauseState.paused) {
    res.json({ ok: true, skipped: true, reason: pauseState.reason ?? "Automation is paused" });
    return;
  }
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const maxMessages = req.body?.maxMessages != null ? Number(req.body.maxMessages) : undefined;
    const requestedMax = maxMessages != null && Number.isFinite(maxMessages) ? Math.max(0, maxMessages) : 50;
    const locked = await withCronLock("process-inbox", async () => {
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
      return processInbox({ maxMessages });
    });
    if (!locked.acquired || !locked.result) {
      res.json({ ok: true, skipped: true, reason: "process-inbox is already running" });
      return;
    }
    const result = locked.result;
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

router.post("/cron/run-saved-searches", async (req: Request, res: Response) => {
  if (!checkCronSecret(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const pauseState = await getAutomationPauseState();
  if (pauseState.paused) {
    res.json({ ok: true, skipped: true, reason: pauseState.reason ?? "Automation is paused" });
    return;
  }
  try {
    const locked = await withCronLock("run-saved-searches", () => runDueSavedSearches());
    if (!locked.acquired || !locked.result) {
      res.json({ ok: true, skipped: true, reason: "run-saved-searches is already running" });
      return;
    }
    const result = locked.result;
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron run-saved-searches]", err);
    res.status(503).json({ error: "Run saved searches failed.", details: message });
  }
});

router.post("/cron/run-daily-outreach", async (req: Request, res: Response) => {
  if (!checkCronSecret(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const pauseState = await getAutomationPauseState();
  if (pauseState.paused) {
    res.json({ ok: true, skipped: true, reason: pauseState.reason ?? "Automation is paused" });
    return;
  }
  try {
    const locked = await withCronLock("run-daily-outreach", () => runDailyOutreach());
    if (!locked.acquired || !locked.result) {
      res.json({ ok: true, skipped: true, reason: "run-daily-outreach is already running" });
      return;
    }
    const result = locked.result;
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron run-daily-outreach]", err);
    res.status(503).json({ error: "Run daily outreach failed.", details: message });
  }
});

router.post("/cron/send-daily-digest", async (req: Request, res: Response) => {
  if (!checkCronSecret(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const pauseState = await getAutomationPauseState();
  if (pauseState.paused) {
    res.json({ ok: true, skipped: true, reason: pauseState.reason ?? "Automation is paused" });
    return;
  }
  try {
    const locked = await withCronLock("send-daily-digest", () => sendDailyDigest());
    if (!locked.acquired || !locked.result) {
      res.json({ ok: true, skipped: true, reason: "send-daily-digest is already running" });
      return;
    }
    if (!locked.result.sent) {
      res.json({ ok: true, skipped: true, reason: locked.result.skippedReason ?? "no_send" });
      return;
    }
    res.json({ ok: true, ...locked.result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron send-daily-digest]", err);
    res.status(503).json({ error: "Send daily digest failed.", details: message });
  }
});

export default router;
