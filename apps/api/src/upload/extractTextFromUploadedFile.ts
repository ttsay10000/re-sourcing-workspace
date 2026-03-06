/**
 * Extract plain text from an uploaded property document (PDF, .txt) for LLM use.
 * Uses resolveUploadedDocFilePath so the path matches what was stored at upload time.
 */

import { readFile } from "fs/promises";
import { resolveUploadedDocFilePath } from "./uploadedDocStorage.js";

export async function extractTextFromUploadedFile(filePath: string, filename?: string): Promise<string> {
  const absolutePath = resolveUploadedDocFilePath(filePath);
  const ext = (filename ?? filePath).toLowerCase().split(".").pop() ?? "";
  try {
    if (ext === "pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const buffer = await readFile(absolutePath);
      const data = await pdfParse(buffer);
      return typeof data?.text === "string" ? data.text.trim() : "";
    }
    if (ext === "txt" || ext === "text") {
      const buf = await readFile(absolutePath, "utf-8");
      return buf.trim();
    }
  } catch (e) {
    console.warn("[extractTextFromUploadedFile]", filePath, e instanceof Error ? e.message : e);
  }
  return "";
}
