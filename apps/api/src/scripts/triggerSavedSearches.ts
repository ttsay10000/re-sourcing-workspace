/**
 * Trigger saved-search scheduling for the daily Render cron.
 * Runs searches due on the current local calendar day.
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { getPool, UserProfileRepo } from "@re-sourcing/db";
import { runDueSavedSearches } from "../sourcing/savedSearchRunner.js";

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

async function main() {
  console.log("[triggerSavedSearches] Starting...");
  const pauseState = await getAutomationPauseState();
  if (pauseState.paused) {
    console.log("[triggerSavedSearches] Skipped.", pauseState.reason ?? "Automation is paused");
    return;
  }

  const locked = await withCronLock("run-saved-searches", () =>
    runDueSavedSearches(new Date(), { dueMode: "local-day" })
  );
  if (!locked.acquired || !locked.result) {
    console.log("[triggerSavedSearches] Skipped. run-saved-searches is already running");
    return;
  }

  console.log("[triggerSavedSearches] Done.", locked.result);
}

main().catch((err) => {
  console.error("[triggerSavedSearches]", err);
  process.exit(1);
});
