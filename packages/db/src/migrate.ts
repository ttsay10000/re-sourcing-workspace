/**
 * CLI entrypoint: run migrations against DATABASE_URL.
 * The actual runner lives in runMigrations.ts (shared with migrate-on-boot).
 */
import { getPool } from "./pool.js";
import { runMigrations } from "./runMigrations.js";

async function main(): Promise<void> {
  const pool = getPool();
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
