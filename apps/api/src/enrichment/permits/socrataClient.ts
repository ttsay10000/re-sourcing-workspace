/**
 * Socrata client for NYC DOB NOW Build – Approved Permits (rbx6-tga4).
 * Selective queries only: BBL or borough+house_no+street_name, 10-year date filter, pagination.
 */

import type { SocrataPermitRow } from "./types.js";

const BASE_URL = "https://data.cityofnewyork.us/resource/rbx6-tga4.json";

/** Columns we request (Socrata API uses snake_case field names). */
const SELECT_COLUMNS = [
  "bbl",
  "block",
  "lot",
  "bin",
  "borough",
  "house_no",
  "street_name",
  "owner_business_name",
  "owner_name",
  "permit_status",
  "work_permit",
  "job_filing_number",
  "work_on_floor",
  "work_type",
  "applicant_first_name",
  "applicant_middle_name",
  "applicant_last_name",
  "applicant_business_name",
  "applicant_business_address",
  "approved_date",
  "issued_date",
  "expired_date",
  "job_description",
  "estimated_job_costs",
  "tracking_number",
];

const DEFAULT_LIMIT = 1000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

function escapeSoQLString(s: string): string {
  return s.replace(/'/g, "''");
}

export interface SoQLQueryParams {
  $select: string;
  $where: string;
  $order: string;
  $limit: number;
  $offset: number;
}

/**
 * Build SoQL query params for a BBL-based query (primary).
 * Date filter: Issued_Date or Approved_Date >= cutoff (10-year window).
 */
export function buildSoQLParamsByBBL(
  bbl: string,
  cutoffDate: string,
  limit: number = DEFAULT_LIMIT,
  offset: number = 0
): SoQLQueryParams {
  const esc = escapeSoQLString(bbl.trim());
  const cut = escapeSoQLString(cutoffDate);
  const where = `bbl = '${esc}' AND (issued_date >= '${cut}' OR approved_date >= '${cut}')`;
  return {
    $select: SELECT_COLUMNS.join(", "),
    $where: where,
    $order: "issued_date DESC",
    $limit: limit,
    $offset: offset,
  };
}

/**
 * Build SoQL query params for address-based fallback (borough + house no + street name).
 */
export function buildSoQLParamsByAddress(
  borough: string,
  houseNo: string,
  streetName: string,
  cutoffDate: string,
  limit: number = DEFAULT_LIMIT,
  offset: number = 0
): SoQLQueryParams {
  const b = escapeSoQLString(borough.trim());
  const h = escapeSoQLString(houseNo.trim());
  const s = escapeSoQLString(streetName.trim());
  const cut = escapeSoQLString(cutoffDate);
  const where = `borough = '${b}' AND house_no = '${h}' AND street_name = '${s}' AND (issued_date >= '${cut}' OR approved_date >= '${cut}')`;
  return {
    $select: SELECT_COLUMNS.join(", "),
    $where: where,
    $order: "issued_date DESC",
    $limit: limit,
    $offset: offset,
  };
}

function paramsToSearchParams(params: SoQLQueryParams): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("$select", params.$select);
  sp.set("$where", params.$where);
  sp.set("$order", params.$order);
  sp.set("$limit", String(params.$limit));
  sp.set("$offset", String(params.$offset));
  return sp;
}

export interface FetchPermitsOptions {
  appToken?: string | null;
  timeoutMs?: number;
}

/**
 * Fetch one page of permits from Socrata. Uses retries with exponential backoff for 429/5xx.
 */
export async function fetchPermitsPage(
  params: SoQLQueryParams,
  options: FetchPermitsOptions = {}
): Promise<SocrataPermitRow[]> {
  const { appToken, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = `${BASE_URL}?${paramsToSearchParams(params)}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (appToken?.trim()) {
    headers["X-App-Token"] = appToken.trim();
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const elapsed = Date.now() - start;

      if (res.ok) {
        const data = (await res.json()) as SocrataPermitRow[];
        console.log(`[socrata] ${url.split("?")[0]} ... ${res.status} ${data.length} rows in ${elapsed}ms`);
        return data;
      }

      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (retryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
        console.warn(`[socrata] ${res.status} retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        lastError = new Error(`Socrata ${res.status}: ${res.statusText}`);
        continue;
      }

      const text = await res.text();
      throw new Error(`Socrata ${res.status}: ${text || res.statusText}`);
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable =
        lastError.name === "AbortError" ||
        (lastError.message && /429|5\d{2}/.test(lastError.message));
      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
        console.warn(`[socrata] ${lastError.message} retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw lastError;
      }
    }
  }
  throw lastError ?? new Error("Socrata fetch failed");
}

/**
 * Fetch all pages of permits (limit/offset loop) until fewer than limit rows returned.
 */
export async function fetchAllPermits(
  buildParams: (limit: number, offset: number) => SoQLQueryParams,
  options: FetchPermitsOptions = {}
): Promise<SocrataPermitRow[]> {
  const all: SocrataPermitRow[] = [];
  let offset = 0;
  const limit = DEFAULT_LIMIT;
  while (true) {
    const params = buildParams(limit, offset);
    const page = await fetchPermitsPage(params, options);
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}
