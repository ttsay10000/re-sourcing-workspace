/**
 * Extract plain text from inquiry attachment files (PDF, TXT, XLS, XLSX). Other types return empty string.
 */

import { readFile } from "fs/promises";
import { resolveInquiryFilePath } from "./storage.js";

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
    if (ext === "xls" || ext === "xlsx") {
      const buffer = await readFile(absolutePath);
      return await extractWorkbookText(buffer);
    }
  } catch (e) {
    console.warn("[extractTextFromFile]", filePath, e instanceof Error ? e.message : e);
  }
  return "";
}
