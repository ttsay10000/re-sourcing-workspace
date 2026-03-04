/**
 * Cron/internal endpoints (e.g. process-inbox). Protect with PROCESS_INBOX_CRON_SECRET.
 */

import { Router, type Request, type Response } from "express";
import { processInbox } from "../inquiry/processInbox.js";

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
  try {
    const maxMessages = req.body?.maxMessages != null ? Number(req.body.maxMessages) : undefined;
    const result = await processInbox({ maxMessages });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron process-inbox]", err);
    res.status(503).json({ error: "Process inbox failed.", details: message });
  }
});

export default router;
