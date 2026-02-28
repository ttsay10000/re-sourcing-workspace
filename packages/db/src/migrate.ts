/**
 * Run migrations in order from packages/db/migrations/*.sql
 * Uses DATABASE_URL. Creates schema_migrations table to track applied migrations.
 * Resolves migrations dir relative to this file (dist/migrate.js -> ../migrations).
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getPool } from "./pool.js";

declare const __dirname: string;

async function main(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const migrationsPath = join(__dirname, "..", "migrations");
    const files = (await readdir(migrationsPath))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const name = file.replace(".sql", "");
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [name]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        console.log("Skip (already applied):", file);
        continue;
      }

      const filePath = join(migrationsPath, file);
      const sql = await readFile(filePath, "utf-8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [name]
      );
      console.log("Applied:", file);
    }

    console.log("Migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
