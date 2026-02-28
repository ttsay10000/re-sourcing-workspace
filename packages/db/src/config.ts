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

export const dbConfig = {
  get connectionString(): string {
    return getUrl();
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export function getDatabaseUrl(): string {
  return getUrl();
}
