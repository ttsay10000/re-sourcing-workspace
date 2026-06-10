import { Pool } from "pg";
import { dbConfig } from "./config.js";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(dbConfig);
    // Idle pooled clients emit 'error' when the server or network drops the
    // connection (e.g. Render reaping a quiet TCP flow). Without a listener,
    // Node treats the event as fatal and exits the process. The pool has
    // already discarded the dead client, so log it and keep serving.
    pool.on("error", (err) => {
      console.error(`[db] idle client error (pool recovers): ${err.message}`);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
