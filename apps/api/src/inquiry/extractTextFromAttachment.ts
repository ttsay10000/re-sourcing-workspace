/**
 * Extract plain text from inquiry attachment files (PDF, .txt). Other types return empty string.
 */

import { readFile } from "fs/promises";
import { resolveInquiryFilePath } from "./storage.js";

export async function extractTextFromFile(filePath: string, filename?: string): Promise<string> {
  const absolutePath = resolveInquiryFilePath(filePath);
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
    console.warn("[extractTextFromFile]", filePath, e instanceof Error ? e.message : e);
  }
  return "";
}
