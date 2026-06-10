/**
 * OpenAI broker comp extraction for spreadsheet/text source packages (XLSX,
 * XLS, CSV) where no PDF exists for Gemini's native PDF ingestion. Workbook
 * sheets arrive rendered as "cell | cell | cell" rows (see
 * extractTextMetadataFromBuffer). The prompt reuses the exact JSON shape and
 * rules of the Gemini PDF extractor so brokerCompItemsFromParsedJson yields
 * identical item types and normalized payload field names, keeping downstream
 * merge/review/promote code untouched.
 */
import OpenAI from "openai";
import type { BrokerCompExtractedItemInput } from "../brokerComp/service.js";
import {
  getOmAnalysisModel,
  getOmAnalysisReasoningEffort,
  supportsReasoningEffort,
} from "../enrichment/openaiModels.js";
import { parseCompletionJsonContent } from "../om/omAnalysisShared.js";
import {
  BROKER_COMP_EXTRACTION_JSON_SHAPE,
  BROKER_COMP_EXTRACTION_RULES,
  brokerCompItemsFromParsedJson,
} from "./extractBrokerCompPackageFromGemini.js";

type JsonRecord = Record<string, unknown>;

export interface OpenAiBrokerCompExtractionParams {
  /** Extracted document text (workbook sheets rendered as "cell | cell" rows, or CSV text). */
  textContent: string;
  filename: string;
  model?: string | null;
}

export interface OpenAiBrokerCompExtractionResult {
  extractedItems: BrokerCompExtractedItemInput[];
  packageMeta: JsonRecord;
  summary: string | null;
  rawOutput: string | null;
  finishReason: string | null;
  model: string;
  /** Set when the call was skipped or failed; extractedItems is empty in that case. */
  error: string | null;
}

const MAX_TEXT_CONTENT_CHARS = 180_000;

function getOpenAiApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

/** Defaults to getOmAnalysisModel() (gpt-5.5 unless OPENAI_BROKER_COMP_MODEL / OPENAI_OM_MODEL override). */
export function resolveOpenAiBrokerCompModel(explicit?: string | null): string {
  return explicit?.trim() || process.env.OPENAI_BROKER_COMP_MODEL?.trim() || getOmAnalysisModel();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): JsonRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function recordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = recordValue(entry);
    return record ? [record] : [];
  });
}

export function buildOpenAiBrokerCompPrompt(params: { textContent: string; filename: string }): string {
  const textContent = params.textContent.trim().slice(0, MAX_TEXT_CONTENT_CHARS);
  return `You are extracting broker market comps from a real estate spreadsheet package.

Source file: ${params.filename}

The package below was extracted from a spreadsheet (XLSX/XLS/CSV); workbook sheets are rendered as "cell | cell | cell" rows in sheet order. Return one JSON object only.

Top-level JSON shape:
${BROKER_COMP_EXTRACTION_JSON_SHAPE}

Rules:
${BROKER_COMP_EXTRACTION_RULES}
- Header rows name the columns for the comp rows beneath them; map every comp row to the schema fields using its header row.
- There are no PDF pages here: set sourceCoverage.usedPdfGraphics to false, and use the sheet's position (1-based) as pageNumber when one is needed.${params.textContent.length > MAX_TEXT_CONTENT_CHARS ? "\n- The source text was truncated to fit the context window; add a missingDataFlags entry noting possible truncation." : ""}

Source package:
${textContent}`;
}

function failedResult(model: string, error: string): OpenAiBrokerCompExtractionResult {
  return {
    extractedItems: [],
    packageMeta: { provider: "openai", model, extractionMethod: "spreadsheet_text" },
    summary: null,
    rawOutput: null,
    finishReason: null,
    model,
    error,
  };
}

export async function extractBrokerCompPackageFromOpenAiText(
  params: OpenAiBrokerCompExtractionParams
): Promise<OpenAiBrokerCompExtractionResult> {
  const model = resolveOpenAiBrokerCompModel(params.model);
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    console.warn("[extractBrokerCompPackageFromOpenAiText] OPENAI_API_KEY missing or invalid; skipping OpenAI call.");
    return failedResult(model, "OPENAI_API_KEY is missing or invalid; spreadsheet comp extraction was skipped.");
  }
  if (!params.textContent.trim()) {
    console.warn("[extractBrokerCompPackageFromOpenAiText] No spreadsheet text was provided.", {
      filename: params.filename,
    });
    return failedResult(model, "Spreadsheet text extraction returned no usable text, so comp extraction was skipped.");
  }

  const openai = new OpenAI({ apiKey });
  const prompt = buildOpenAiBrokerCompPrompt({ textContent: params.textContent, filename: params.filename });
  const reasoningEffort = getOmAnalysisReasoningEffort();
  const requestStartedAt = Date.now();

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
    });
    const choice = completion.choices[0] ?? null;
    const rawOutput = typeof choice?.message?.content === "string" ? choice.message.content.trim() || null : null;
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    const parsed = parseCompletionJsonContent(rawOutput);
    if (!parsed) {
      const error =
        finishReason === "length"
          ? "OpenAI returned truncated JSON before completing the broker comp response."
          : "OpenAI returned malformed JSON for the broker comp response.";
      console.warn("[extractBrokerCompPackageFromOpenAiText] Failed to parse OpenAI broker comp JSON.", {
        model,
        finishReason,
        rawOutputPreview: rawOutput?.slice(0, 400) ?? null,
      });
      return { ...failedResult(model, error), rawOutput, finishReason };
    }

    const extractedItems = brokerCompItemsFromParsedJson(parsed, "openai_spreadsheet");
    console.info("[extractBrokerCompPackageFromOpenAiText] OpenAI broker comp extraction completed.", {
      model,
      filename: params.filename,
      itemCount: extractedItems.length,
      textContentChars: params.textContent.length,
      requestDurationMs: Date.now() - requestStartedAt,
      reasoningEffort: supportsReasoningEffort(model) ? reasoningEffort : null,
      finishReason,
      promptTokens: completion.usage?.prompt_tokens ?? null,
      completionTokens: completion.usage?.completion_tokens ?? null,
      totalTokens: completion.usage?.total_tokens ?? null,
    });

    const takeaways = Array.isArray(parsed.marketTakeaways)
      ? parsed.marketTakeaways.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    return {
      extractedItems,
      packageMeta: {
        provider: "openai",
        model,
        extractionMethod: "spreadsheet_text",
        subjectAddress: stringValue(recordValue(parsed.subject)?.address),
        sourceCoverage: recordValue(parsed.sourceCoverage),
        missingDataFlags: recordArray(parsed.missingDataFlags),
      },
      summary: takeaways.length > 0 ? takeaways.join(" ") : null,
      rawOutput,
      finishReason,
      model,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extractBrokerCompPackageFromOpenAiText] OpenAI call failed.", { model, error: message });
    return failedResult(model, `OpenAI spreadsheet comp extraction failed: ${message}`);
  }
}
