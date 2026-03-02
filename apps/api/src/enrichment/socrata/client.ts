/**
 * Shared Socrata client for NYC Open Data: v3 view query endpoint support,
 * SoQL params, retries/backoff, and response mapping for array-shaped responses.
 * Permits continue to use the resource URL in permits/socrataClient.ts.
 */

export interface SoQLQueryParams {
  $select: string;
  $where: string;
  $order: string;
  $limit: number;
  $offset: number;
}

export function escapeSoQLString(s: string): string {
  return s.replace(/'/g, "''");
}

export function paramsToSearchParams(params: SoQLQueryParams): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("$select", params.$select);
  sp.set("$where", params.$where);
  sp.set("$order", params.$order);
  sp.set("$limit", String(params.$limit));
  sp.set("$offset", String(params.$offset));
  return sp;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface FetchSocrataOptions {
  appToken?: string | null;
  timeoutMs?: number;
}

/** Base URL for v3 view query endpoint (SoQL as query params). */
export function v3ViewQueryUrl(datasetId: string): string {
  return `https://data.cityofnewyork.us/api/views/${datasetId}/query.json`;
}

/** Legacy resource URL (same as permits) for SoQL query params. */
export function resourceUrl(datasetId: string): string {
  return `https://data.cityofnewyork.us/resource/${datasetId}.json`;
}

/**
 * v3 /views/ API can return either:
 * - Array of objects [{ col: val }, ...]
 * - Or { columns: [{ name: "col" }, ...], rows: [[val, ...], ...] }
 * This maps the second form to array of objects keyed by column name.
 */
export function mapV3ResponseToRows<T = Record<string, unknown>>(response: unknown): T[] {
  if (Array.isArray(response)) {
    return response as T[];
  }
  const obj = response as { columns?: Array<{ name?: string }>; rows?: unknown[][] };
  const columns = obj?.columns;
  const rows = obj?.rows;
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    return [];
  }
  const names = columns.map((c) => (c && typeof c.name === "string" ? c.name : "") || "");
  const out: T[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const record: Record<string, unknown> = {};
    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      if (key) record[key] = row[i] ?? null;
    }
    out.push(record as T);
  }
  return out;
}

/**
 * Fetch one page from a Socrata endpoint (resource or v3 view).
 * Uses retries with exponential backoff for 429 and 5xx.
 */
export async function fetchSocrataQuery<T = Record<string, unknown>>(
  baseUrl: string,
  params: SoQLQueryParams,
  options: FetchSocrataOptions = {}
): Promise<T[]> {
  const { appToken, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = `${baseUrl}?${paramsToSearchParams(params)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (appToken?.trim()) headers["X-App-Token"] = appToken.trim();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
      clearTimeout(timeoutId);
      const body = await res.json();
      if (res.ok) {
        return mapV3ResponseToRows<T>(body);
      }
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (retryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
        console.warn(`[socrata] ${res.status} retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        lastError = new Error(`Socrata ${res.status}: ${res.statusText}`);
        continue;
      }
      throw new Error(`Socrata ${res.status}: ${JSON.stringify(body) || res.statusText}`);
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable =
        lastError.name === "AbortError" ||
        (lastError.message && /429|5\d{2}/.test(lastError.message));
      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw lastError;
      }
    }
  }
  throw lastError ?? new Error("Socrata fetch failed");
}

/** Fetch all pages via limit/offset until a page returns fewer than limit rows. */
export async function fetchAllPages<T = Record<string, unknown>>(
  baseUrl: string,
  buildParams: (limit: number, offset: number) => SoQLQueryParams,
  options: FetchSocrataOptions = {}
): Promise<T[]> {
  const limit = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const params = buildParams(limit, offset);
    const page = await fetchSocrataQuery<T>(baseUrl, params, options);
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}
