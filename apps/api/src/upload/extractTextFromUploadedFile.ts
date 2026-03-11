/**
 * Extract plain text from an uploaded property document (PDF, TXT, XLS, XLSX) for LLM use.
 * Uses resolveUploadedDocFilePath so the path matches what was stored at upload time.
 * For re-run when file is in DB only, use extractTextFromBuffer.
 */

import { readFile } from "fs/promises";
import { resolveUploadedDocFilePath } from "./uploadedDocStorage.js";

async function extractWorkbookText(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return "";
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    const lines = rows
      .map((row) => row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" | "))
      .filter(Boolean);
    if (lines.length === 0) return "";
    return `${sheetName}\n${lines.join("\n")}`;
  }).filter(Boolean);
  return sections.join("\n\n").trim();
}

/** Extract text from a buffer (e.g. from DB file_content). Use when file is not on disk. */
export async function extractTextFromBuffer(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  try {
    if (ext === "pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      return typeof data?.text === "string" ? data.text.trim() : "";
    }
    if (ext === "txt" || ext === "text") {
      return buffer.toString("utf-8").trim();
    }
    if (ext === "xls" || ext === "xlsx") {
      return await extractWorkbookText(buffer);
    }
  } catch (e) {
    console.warn("[extractTextFromBuffer]", filename, e instanceof Error ? e.message : e);
  }
  return "";
}

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
    if (ext === "xls" || ext === "xlsx") {
      const buffer = await readFile(absolutePath);
      return await extractWorkbookText(buffer);
    }
  } catch (e) {
    console.warn("[extractTextFromUploadedFile]", filePath, e instanceof Error ? e.message : e);
  }
  return "";
}
