/**
 * Programmatic migration runner shared by the CLI script (migrate.ts) and the
 * API's migrate-on-boot path. Applies packages/db/migrations/*.sql in order,
 * tracked in schema_migrations. Safe to run repeatedly.
 */
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { Pool } from "pg";

declare const __dirname: string;

export interface RunMigrationsResult {
  applied: string[];
  skipped: number;
}

export async function runMigrations(pool: Pool, log: (line: string) => void = console.log): Promise<RunMigrationsResult> {
  const client = await pool.connect();
  const applied: string[] = [];
  let skipped = 0;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const migrationsPath = join(__dirname, "..", "migrations");
    const files = (await readdir(migrationsPath)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const name = file.replace(".sql", "");
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
      if (existing.rowCount && existing.rowCount > 0) {
        skipped += 1;
        continue;
      }
      const sql = await readFile(join(migrationsPath, file), "utf-8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      applied.push(file);
      log(`[migrate] applied ${file}`);
    }
    log(`[migrate] complete — ${applied.length} applied, ${skipped} already in place.`);
    return { applied, skipped };
  } finally {
    client.release();
  }
}
