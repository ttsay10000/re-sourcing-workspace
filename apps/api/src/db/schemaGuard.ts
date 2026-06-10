/**
 * Boot-time schema guard: verifies sentinel relations/columns from recent
 * migrations exist so a deployed database that is behind on `db:migrate`
 * fails loudly in the logs instead of 500ing one route at a time.
 *
 * Non-blocking by design — the server intentionally does not require a DB
 * connection at startup; this only runs when DATABASE_URL is configured.
 */
import { getPool } from "@re-sourcing/db";

type SchemaSentinel =
  | { kind: "table"; name: string; migration: string }
  | { kind: "column"; table: string; column: string; migration: string };

const SENTINELS: SchemaSentinel[] = [
  { kind: "table", name: "stage_transitions", migration: "056_deal_stage_and_geo.sql" },
  { kind: "column", table: "properties", column: "deal_stage", migration: "056_deal_stage_and_geo.sql" },
  { kind: "column", table: "properties", column: "lat", migration: "056_deal_stage_and_geo.sql" },
  { kind: "table", name: "broker_contacts", migration: "broker CRM migrations" },
  { kind: "table", name: "property_recipient_resolution", migration: "broker CRM migrations" },
  { kind: "table", name: "deal_signals", migration: "026_deal_signals.sql" },
  { kind: "table", name: "market_comps", migration: "058_market_context_v1.sql" },
  { kind: "table", name: "comp_address_geocodes", migration: "059_comp_address_geocodes.sql" },
];

export async function assertSchemaCurrent(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const pool = getPool();
    const missing: string[] = [];
    for (const sentinel of SENTINELS) {
      if (sentinel.kind === "table") {
        const result = await pool.query<{ exists: boolean }>(
          "SELECT to_regclass($1) IS NOT NULL AS exists",
          [sentinel.name]
        );
        if (result.rows[0]?.exists !== true) {
          missing.push(`table "${sentinel.name}" (from ${sentinel.migration})`);
        }
      } else {
        const result = await pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2
           ) AS exists`,
          [sentinel.table, sentinel.column]
        );
        if (result.rows[0]?.exists !== true) {
          missing.push(`column "${sentinel.table}.${sentinel.column}" (from ${sentinel.migration})`);
        }
      }
    }
    if (missing.length > 0) {
      console.error(
        [
          "============================================================",
          "[api] DATABASE SCHEMA IS BEHIND — routes will fail until fixed.",
          ...missing.map((item) => `[api]   missing: ${item}`),
          "[api] Fix: run `npm run db:migrate` against this DATABASE_URL.",
          "============================================================",
        ].join("\n")
      );
    } else {
      console.log("[api] schema guard: all sentinel tables/columns present.");
    }
  } catch (err) {
    console.warn("[api] schema guard skipped:", err instanceof Error ? err.message : err);
  }
}
