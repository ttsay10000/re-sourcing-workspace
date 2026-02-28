/**
 * DB config from DATABASE_URL (Render Postgres / local dev).
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

const databaseUrl = getUrl();

export const dbConfig = {
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export function getDatabaseUrl(): string {
  return databaseUrl;
}
