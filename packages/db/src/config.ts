/**
 * DB config from DATABASE_URL (Render Postgres / local dev).
 * Config is lazy so the package can be imported without DATABASE_URL set;
 * the error is thrown when getPool() or getDatabaseUrl() is first used.
 */

function getUrl(): string {
  const u = process.env.DATABASE_URL;
  if (!u) {
    throw new Error(
      "DATABASE_URL is required. Set it for local dev or use Render Postgres."
    );
  }
  return u;
}

function shouldUseSsl(): boolean {
  const explicit = process.env.DATABASE_SSL ?? process.env.PGSSLMODE;
  if (explicit) {
    const normalized = explicit.trim().toLowerCase();
    if (["0", "false", "disable", "disabled", "no"].includes(normalized)) return false;
    if (["1", "true", "require", "required", "yes"].includes(normalized)) return true;
  }
  const url = process.env.DATABASE_URL ?? "";
  return /render\.com/i.test(url) || /[?&]sslmode=require/i.test(url);
}

export const dbConfig = {
  get connectionString(): string {
    return getUrl();
  },
  get ssl(): { rejectUnauthorized: false } | undefined {
    return shouldUseSsl() ? { rejectUnauthorized: false } : undefined;
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export function getDatabaseUrl(): string {
  return getUrl();
}
