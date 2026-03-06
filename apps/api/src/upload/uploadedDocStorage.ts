/**
 * Save user-uploaded property documents to disk.
 * Path: {base}/{propertyId}/{docId}/{filename}
 */

import { mkdir, writeFile, unlink } from "fs/promises";
import { join, normalize } from "path";
import { existsSync } from "fs";

const DEFAULT_BASE = "uploads/property-docs";

function getBaseDir(): string {
  return process.env.UPLOADED_DOCS_PATH ?? DEFAULT_BASE;
}

/**
 * Resolve base dir to absolute so write and read always use the same path (avoids cwd differences).
 */
function getAbsoluteBaseDir(): string {
  const base = getBaseDir();
  if (base.startsWith("/") || /^[A-Za-z]:\\/.test(base)) return normalize(base);
  return normalize(join(process.cwd(), base));
}

export async function saveUploadedDocument(
  propertyId: string,
  docId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const base = getAbsoluteBaseDir();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").trim() || "document";
  const dir = join(base, propertyId, docId);
  await mkdir(dir, { recursive: true });
  const absolutePath = join(dir, safe);
  await writeFile(absolutePath, buffer, { flag: "w" });
  return absolutePath;
}

export function resolveUploadedDocFilePath(filePath: string): string {
  if (!filePath || typeof filePath !== "string") return join(process.cwd(), "uploads/property-docs");
  const trimmed = filePath.trim();
  if (trimmed.startsWith("/") || /^[A-Za-z]:\\/.test(trimmed)) return normalize(trimmed);
  return normalize(join(process.cwd(), trimmed));
}

/** Return true if the resolved file exists (for download 404). */
export function uploadedDocFileExists(filePath: string): boolean {
  return existsSync(resolveUploadedDocFilePath(filePath));
}

/** Remove the file from disk if it exists. Ignores errors (e.g. file already missing). */
export async function deleteUploadedDocumentFile(filePath: string): Promise<void> {
  const absolutePath = resolveUploadedDocFilePath(filePath);
  await unlink(absolutePath).catch(() => {});
}
