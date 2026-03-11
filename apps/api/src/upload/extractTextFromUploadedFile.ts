/**
 * Extract plain text from an uploaded property document (PDF, TXT, XLS, XLSX) for LLM use.
 * Uses resolveUploadedDocFilePath so the path matches what was stored at upload time.
 * For re-run when file is in DB only, use extractTextFromBuffer.
 */

import { readFile } from "fs/promises";
import { resolveUploadedDocFilePath } from "./uploadedDocStorage.js";

export interface ExtractedTextMetadata {
  text: string;
  pageCount: number | null;
  pages?: ExtractedTextPageMetadata[];
}

export interface ExtractedTextPageMetadata {
  pageNumber: number;
  textChars: number;
  textItems: number;
  textSample: string;
}

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

async function extractPdfTextMetadata(buffer: Buffer): Promise<ExtractedTextMetadata> {
  const pdfParse = (await import("pdf-parse")).default as unknown as (
    dataBuffer: Buffer,
    options?: {
      pagerender?: (pageData: {
        getTextContent: (options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
          items: Array<{ str?: string; transform: number[] }>;
        }>;
      }) => Promise<string>;
    }
  ) => Promise<{ text: string; numpages?: number; info?: unknown }>;
  const pages: ExtractedTextPageMetadata[] = [];
  const data = await pdfParse(buffer, {
    pagerender: async (pageData: {
      getTextContent: (options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
        items: Array<{ str?: string; transform: number[] }>;
      }>;
    }) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      let lastY: number | undefined;
      let pageText = "";
      for (const item of textContent.items) {
        const itemY = Array.isArray(item.transform) ? item.transform[5] : undefined;
        const itemText = typeof item.str === "string" ? item.str : "";
        if ((lastY == null || lastY === itemY) && pageText.length > 0) pageText += itemText;
        else if (pageText.length > 0) pageText += `\n${itemText}`;
        else pageText += itemText;
        lastY = itemY;
      }
      const normalized = pageText.replace(/\s+/g, " ").trim();
      pages.push({
        pageNumber: pages.length + 1,
        textChars: normalized.length,
        textItems: textContent.items.length,
        textSample: normalized.slice(0, 500),
      });
      return pageText;
    },
  });
  return {
    text: typeof data?.text === "string" ? data.text.trim() : "",
    pageCount: typeof data?.numpages === "number" && Number.isFinite(data.numpages) ? data.numpages : null,
    pages,
  };
}

export async function extractTextMetadataFromBuffer(buffer: Buffer, filename: string): Promise<ExtractedTextMetadata> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  try {
    if (ext === "pdf") {
      return await extractPdfTextMetadata(buffer);
    }
    if (ext === "txt" || ext === "text") {
      return { text: buffer.toString("utf-8").trim(), pageCount: null, pages: [] };
    }
    if (ext === "xls" || ext === "xlsx") {
      return { text: await extractWorkbookText(buffer), pageCount: null, pages: [] };
    }
  } catch (e) {
    console.warn("[extractTextMetadataFromBuffer]", filename, e instanceof Error ? e.message : e);
  }
  return { text: "", pageCount: null, pages: [] };
}

/** Extract text from a buffer (e.g. from DB file_content). Use when file is not on disk. */
export async function extractTextFromBuffer(buffer: Buffer, filename: string): Promise<string> {
  const metadata = await extractTextMetadataFromBuffer(buffer, filename);
  return metadata.text;
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
