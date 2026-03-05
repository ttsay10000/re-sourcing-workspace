/**
 * Trigger process-inbox (for Render cron). Run: node dist/scripts/triggerProcessInbox.js
 * Requires: DATABASE_URL, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { processInbox } from "../inquiry/processInbox.js";

async function main() {
  console.log("[triggerProcessInbox] Starting…");
  const result = await processInbox({ maxMessages: 50 });
  console.log("[triggerProcessInbox] Done.", result);
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[triggerProcessInbox]", err);
  process.exit(1);
});
