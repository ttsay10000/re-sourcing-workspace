import type { PoolClient } from "pg";

export interface InboxSyncStateRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class InboxSyncStateRepo {
  constructor(private options: InboxSyncStateRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async get(provider: string): Promise<{ provider: string; lastSyncedAt: string | null } | null> {
    const r = await this.client.query(
      "SELECT provider, last_synced_at FROM inbox_sync_state WHERE provider = $1",
      [provider]
    );
    if (!r.rows[0]) return null;
    return {
      provider: r.rows[0].provider as string,
      lastSyncedAt: r.rows[0].last_synced_at != null ? String(r.rows[0].last_synced_at) : null,
    };
  }

  async upsert(provider: string, lastSyncedAt: string | null): Promise<{ provider: string; lastSyncedAt: string | null }> {
    const r = await this.client.query(
      `INSERT INTO inbox_sync_state (provider, last_synced_at)
       VALUES ($1, $2)
       ON CONFLICT (provider) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         updated_at = now()
       RETURNING provider, last_synced_at`,
      [provider, lastSyncedAt]
    );
    return {
      provider: r.rows[0].provider as string,
      lastSyncedAt: r.rows[0].last_synced_at != null ? String(r.rows[0].last_synced_at) : null,
    };
  }
}
