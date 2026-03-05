/**
 * Save user-uploaded property documents to disk.
 * Path: {base}/{propertyId}/{docId}/{filename}
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const DEFAULT_BASE = "uploads/property-docs";

function getBaseDir(): string {
  return process.env.UPLOADED_DOCS_PATH ?? DEFAULT_BASE;
}

export async function saveUploadedDocument(
  propertyId: string,
  docId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const base = getBaseDir();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").trim() || "document";
  const dir = join(base, propertyId, docId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, safe);
  await writeFile(filePath, buffer, { flag: "w" });
  return filePath;
}

export function resolveUploadedDocFilePath(filePath: string): string {
  if (filePath.startsWith("/")) return filePath;
  return join(process.cwd(), filePath);
}
