/**
 * Save inquiry email attachments to disk. Path: {base}/{propertyId}/{emailId}/{filename}.
 * Store only file_path in DB; do not store blobs in Postgres.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const DEFAULT_BASE = "uploads/inquiry-docs";

function getBaseDir(): string {
  return process.env.INQUIRY_DOCS_PATH ?? DEFAULT_BASE;
}

/**
 * Save attachment bytes to disk. Returns the relative file_path to store in property_inquiry_documents.
 * Creates directories as needed. Sanitizes filename for safe filesystem use.
 */
export async function saveInquiryAttachment(
  propertyId: string,
  inquiryEmailId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const base = getBaseDir();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").trim() || "attachment";
  const dir = join(base, propertyId, inquiryEmailId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, safe);
  await writeFile(filePath, buffer, { flag: "w" });
  return filePath;
}

/**
 * Resolve absolute path for serving a file (when file_path is relative).
 */
export function resolveInquiryFilePath(filePath: string): string {
  if (filePath.startsWith("/")) return filePath;
  return join(process.cwd(), filePath);
}
