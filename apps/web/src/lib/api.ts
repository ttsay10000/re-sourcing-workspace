/**
 * Single API origin + fetch helper for the web app. Pages must import from
 * here instead of hand-rolling `API_BASE` per file.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

/** Build a full API URL from a path like "/api/ui-v2/pipeline". */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function errorMessageFrom(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error) return record.error;
    if (typeof record.details === "string" && record.details) return record.details;
    if (typeof record.message === "string" && record.message) return record.message;
  }
  return fallback;
}

/**
 * JSON fetch against the API. Accepts a path ("/api/…") or a full URL so the
 * existing per-page helpers can migrate without touching call sites.
 */
export async function apiFetch<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(pathOrUrl), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      errorMessageFrom(payload, `Request failed (${response.status})`),
      response.status,
      payload
    );
  }
  return payload as T;
}
