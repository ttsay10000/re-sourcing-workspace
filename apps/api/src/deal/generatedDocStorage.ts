/**
 * Save generated deal documents (dossier, Excel) to disk.
 * Path: {base}/{propertyId}/{docId}/{filename}
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const DEFAULT_BASE = "uploads/generated-docs";

function getBaseDir(): string {
  return process.env.GENERATED_DOCS_PATH ?? DEFAULT_BASE;
}

/**
 * Write a generated file to disk. Returns the relative storage_path for the documents table.
 * docId is used as subfolder (e.g. UUID) so multiple files per property don't clash.
 */
export async function saveGeneratedDocument(
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

/** Resolve storage_path to absolute path for serving. */
export function resolveGeneratedDocPath(storagePath: string): string {
  if (storagePath.startsWith("/")) return storagePath;
  return join(process.cwd(), storagePath);
}
