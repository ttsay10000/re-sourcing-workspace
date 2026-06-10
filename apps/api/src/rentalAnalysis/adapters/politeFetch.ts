/**
 * Rate-limited fetch for public-page pricing research.
 *
 * - Serializes requests per host with a configurable delay + jitter.
 * - Honors robots.txt Disallow rules for our user agent (cached per host).
 * - Identifies itself with a transparent UA; never retries 401/403/429
 *   aggressively — those bubble up so the source is marked unavailable.
 */

const REQUEST_DELAY_MS = Number(process.env.RENTAL_SCRAPE_DELAY_MS) || 1500;
const REQUEST_TIMEOUT_MS = Number(process.env.RENTAL_SCRAPE_TIMEOUT_MS) || 20000;
const USER_AGENT =
  process.env.RENTAL_SCRAPE_USER_AGENT ||
  "re-sourcing-rental-research/1.0 (public pricing research; contact: ops@re-sourcing.local)";

const lastRequestAtByHost = new Map<string, number>();
const robotsCache = new Map<string, { disallows: string[]; fetchedAt: number }>();
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(host: string): Promise<void> {
  const now = Date.now();
  const last = lastRequestAtByHost.get(host) ?? 0;
  const jitter = Math.random() * 400;
  const waitMs = Math.max(0, last + REQUEST_DELAY_MS + jitter - now);
  lastRequestAtByHost.set(host, now + waitMs);
  if (waitMs > 0) await sleep(waitMs);
}

/** Minimal robots.txt parse: Disallow lines under User-agent: * or our UA. */
export function parseRobotsDisallows(robotsTxt: string, userAgent = USER_AGENT): string[] {
  const lines = robotsTxt.split(/\r?\n/);
  const disallows: string[] = [];
  let applies = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      applies = value === "*" || userAgent.toLowerCase().includes(value.toLowerCase());
    } else if (applies && key === "disallow" && value) {
      disallows.push(value);
    }
  }
  return disallows;
}

async function robotsDisallowsFor(url: URL): Promise<string[]> {
  const cached = robotsCache.get(url.host);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.disallows;
  let disallows: string[] = [];
  try {
    const response = await fetch(`${url.protocol}//${url.host}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      disallows = parseRobotsDisallows(await response.text());
    }
    // Non-2xx robots responses (404, 403, …) leave the path list empty: a
    // missing robots.txt imposes no rules, and a blocked one will block the
    // real request anyway.
  } catch {
    disallows = [];
  }
  robotsCache.set(url.host, { disallows, fetchedAt: Date.now() });
  return disallows;
}

export function isPathAllowed(pathname: string, disallows: string[]): boolean {
  return !disallows.some((rule) => rule !== "/" && pathname.startsWith(rule)) &&
    !disallows.includes("/");
}

export class FetchBlockedError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "FetchBlockedError";
    this.status = status;
  }
}

export interface PoliteFetchResult {
  status: number;
  text: string;
  contentType: string | null;
  finalUrl: string;
}

/**
 * Fetch one public URL politely. Throws FetchBlockedError on robots
 * disallow or 401/403/407/429 so callers mark the source unavailable.
 */
export async function politeFetch(rawUrl: string): Promise<PoliteFetchResult> {
  const url = new URL(rawUrl);
  const disallows = await robotsDisallowsFor(url);
  if (!isPathAllowed(url.pathname, disallows)) {
    throw new FetchBlockedError(`robots.txt disallows ${url.pathname} on ${url.host}`);
  }

  await throttle(url.host);

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if ([401, 403, 407, 429].includes(response.status)) {
    throw new FetchBlockedError(
      `${url.host} responded ${response.status} — source blocks automated access`,
      response.status
    );
  }

  return {
    status: response.status,
    text: await response.text(),
    contentType: response.headers.get("content-type"),
    finalUrl: response.url || rawUrl,
  };
}
