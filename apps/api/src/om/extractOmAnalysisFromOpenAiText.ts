/**
 * OpenAI OM extraction for text-only source packages (spreadsheets, CSV, plain
 * text) where no PDF/image exists for Gemini's native file ingestion. Produces
 * the same structured OmAnalysis as the Gemini PDF path so downstream review,
 * promotion, and underwriting behave identically regardless of provider.
 */
import OpenAI from "openai";
import { OM_ANALYSIS_PROMPT_PREFIX } from "../rental/omAnalysisPrompt.js";
import {
  getOmAnalysisModel,
  getOmAnalysisReasoningEffort,
  supportsReasoningEffort,
} from "../enrichment/openaiModels.js";
import {
  OM_SOURCE_PACKAGE_RULES,
  OM_STRUCTURED_RESPONSE_RULES,
  applyInferredSourceCoverage,
  fromLlmFromOmAnalysis,
  type OmAnalysisExtractionResult,
  omAnalysisFromParsedJson,
  parseCompletionJsonContent,
} from "./omAnalysisShared.js";

export interface OpenAiTextOmExtractionParams {
  /** Extracted document text (workbook sheets rendered as "cell | cell" rows, CSV, or plain text). */
  textContext: string;
  propertyContext?: string | null;
  model?: string | null;
}

export interface OpenAiTextOmExtractionResult extends OmAnalysisExtractionResult {
  model: string;
  rawOutput: string | null;
  finishReason: string | null;
  parseError?: string | null;
}

const MAX_TEXT_CONTEXT_CHARS = 180_000;

function getOpenAiApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

/** Defaults to getOmAnalysisModel() (gpt-5.5 unless OPENAI_OM_MODEL overrides). */
export function resolveOpenAiOmModel(explicit?: string | null): string {
  return explicit?.trim() || getOmAnalysisModel();
}

export function buildOpenAiTextOmPrompt(params: {
  textContext: string;
  propertyContext?: string | null;
}): string {
  const propertyContext = params.propertyContext?.trim();
  const prefix = propertyContext ? `Property context:\n${propertyContext}\n\n` : "";
  const textContext = params.textContext.trim().slice(0, MAX_TEXT_CONTEXT_CHARS);

  return `${OM_ANALYSIS_PROMPT_PREFIX}

${prefix}CRITICAL TEXT PACKAGE MODE:
- No readable PDF file is attached for this run. The source package below was extracted from spreadsheet/text documents; workbook sheets are rendered as "cell | cell | cell" rows in sheet order.
- Treat workbook sheets, delimited rows, and extracted text as authoritative source material when they contain rent roll, T-12, expense, or OM data.
- Expense/operating statements may report semi-annual, quarterly, or monthly period columns; sum periods into annual figures per line item, prefer the most recent full year, and state the period basis in notes/reportedDiscrepancies.
${OM_SOURCE_PACKAGE_RULES}

${OM_STRUCTURED_RESPONSE_RULES}

Source package:
${textContext}`;
}

function emptyResult(model: string, parseError?: string | null): OpenAiTextOmExtractionResult {
  return {
    fromLlm: null,
    omAnalysis: null,
    model,
    rawOutput: null,
    finishReason: null,
    parseError: parseError ?? null,
  };
}

export async function extractOmAnalysisFromOpenAiText(
  params: OpenAiTextOmExtractionParams
): Promise<OpenAiTextOmExtractionResult> {
  const model = resolveOpenAiOmModel(params.model);
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    console.warn("[extractOmAnalysisFromOpenAiText] OPENAI_API_KEY missing or invalid; skipping OpenAI call.");
    return emptyResult(model, "OPENAI_API_KEY is missing or invalid; OpenAI text OM extraction was skipped.");
  }
  if (!params.textContext.trim()) {
    console.warn("[extractOmAnalysisFromOpenAiText] No text context was provided.");
    return emptyResult(model, "No extractable document text was provided for OpenAI OM extraction.");
  }

  const openai = new OpenAI({ apiKey });
  const prompt = buildOpenAiTextOmPrompt({
    textContext: params.textContext,
    propertyContext: params.propertyContext ?? null,
  });
  const reasoningEffort = getOmAnalysisReasoningEffort();
  const requestStartedAt = Date.now();

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
    });
    const requestDurationMs = Date.now() - requestStartedAt;
    const choice = completion.choices[0] ?? null;
    const rawOutput = typeof choice?.message?.content === "string" ? choice.message.content.trim() || null : null;
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;

    console.info("[extractOmAnalysisFromOpenAiText] OpenAI OM request completed", {
      model,
      textContextChars: params.textContext.length,
      requestDurationMs,
      reasoningEffort: supportsReasoningEffort(model) ? reasoningEffort : null,
      finishReason,
      promptTokens: completion.usage?.prompt_tokens ?? null,
      completionTokens: completion.usage?.completion_tokens ?? null,
      totalTokens: completion.usage?.total_tokens ?? null,
    });

    const parsed = parseCompletionJsonContent(rawOutput);
    if (!parsed) {
      const parseError =
        finishReason === "length"
          ? "OpenAI returned truncated JSON output before completing the structured response."
          : "OpenAI returned malformed JSON for the structured OM response.";
      console.warn("[extractOmAnalysisFromOpenAiText] Failed to parse OpenAI OM JSON payload", {
        model,
        finishReason,
        parseError,
      });
      return {
        ...emptyResult(model),
        rawOutput,
        finishReason,
        parseError,
      };
    }

    const omAnalysis = omAnalysisFromParsedJson(applyInferredSourceCoverage(parsed));
    return {
      fromLlm: fromLlmFromOmAnalysis(omAnalysis),
      omAnalysis,
      model,
      rawOutput,
      finishReason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extractOmAnalysisFromOpenAiText] OpenAI call failed", { model, error: message });
    return emptyResult(model, `OpenAI request failed: ${message}`);
  }
}
