import { basename } from "path";

export const DEFAULT_OM_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_OM_DOWNLOAD_TIMEOUT_MS = 20_000;

export function resolveOmImportMaxBytes(): number {
  const raw = process.env.OM_IMPORT_MAX_BYTES ?? process.env.MANUAL_OM_MAX_BYTES;
  const parsed = typeof raw === "string" ? Number(raw.trim()) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OM_IMPORT_MAX_BYTES;
}

export function resolveOmDownloadTimeoutMs(): number {
  const raw = process.env.MANUAL_OM_DOWNLOAD_TIMEOUT_MS ?? process.env.OM_DOWNLOAD_TIMEOUT_MS;
  const parsed = typeof raw === "string" ? Number(raw.trim()) : NaN;
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : DEFAULT_OM_DOWNLOAD_TIMEOUT_MS;
}

export function formatByteLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const encodedMatch = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) return decodeFilename(encodedMatch[1].trim().replace(/^"(.*)"$/, "$1"));
  const plainMatch = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plainMatch?.[1] ? decodeFilename(plainMatch[1].trim()) : null;
}

function fileNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = basename(parsed.pathname);
    if (!name || name === "/") return null;
    return decodeFilename(name);
  } catch {
    return null;
  }
}

function ensureDownloadedDocumentFilename(filename: string | null, contentType: string | null): string {
  const trimmed = filename?.trim() || "document";
  if (contentType?.toLowerCase().includes("pdf") && !/\.pdf$/i.test(trimmed)) {
    return `${trimmed}.pdf`;
  }
  return trimmed;
}

export function isPdfLikeDownloadedDocument(params: {
  contentType?: string | null;
  filename?: string | null;
}): boolean {
  return Boolean(
    params.contentType?.toLowerCase().includes("pdf") ||
      (params.filename != null && /\.pdf$/i.test(params.filename))
  );
}

export async function downloadOmDocument(url: string, options?: {
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<{
  buffer: Buffer;
  contentType: string | null;
  filename: string;
  resolvedUrl: string;
}> {
  const maxBytes = options?.maxBytes ?? resolveOmImportMaxBytes();
  const timeoutMs = options?.timeoutMs ?? resolveOmDownloadTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(`OM download failed (${response.status}): ${message || response.statusText}`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : NaN;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`OM file is too large (${formatByteLimit(contentLength)}). Max ${formatByteLimit(maxBytes)}.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("OM link returned an empty file.");
    }
    if (buffer.length > maxBytes) {
      throw new Error(`OM file is too large (${formatByteLimit(buffer.length)}). Max ${formatByteLimit(maxBytes)}.`);
    }

    const contentType = response.headers.get("content-type");
    const preview = buffer.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
    if (
      contentType?.toLowerCase().includes("text/html") &&
      (preview.startsWith("<!doctype html") || preview.startsWith("<html"))
    ) {
      throw new Error("OM link returned HTML instead of a downloadable document.");
    }

    const filename = ensureDownloadedDocumentFilename(
      fileNameFromContentDisposition(response.headers.get("content-disposition")) ??
        fileNameFromUrl(response.url) ??
        fileNameFromUrl(url),
      contentType
    );

    return {
      buffer,
      contentType,
      filename,
      resolvedUrl: response.url || url,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out while downloading the OM document.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
