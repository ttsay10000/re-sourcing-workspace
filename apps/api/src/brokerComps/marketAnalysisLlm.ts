import OpenAI from "openai";
import {
  getMarketAnalysisModel,
  getMarketAnalysisReasoningEffort,
  supportsReasoningEffort,
} from "../enrichment/openaiModels.js";
import { parseCompletionJsonContent } from "../om/omAnalysisShared.js";
import {
  buildLiveMarketAnalysisPrompt,
  buildMarketDocumentReviewPrompt,
  MARKET_PROMPT_V3_VERSION,
} from "./marketPromptV3.js";

type JsonRecord = Record<string, unknown>;

export interface MarketLlmJsonResult {
  parsed: JsonRecord | null;
  model: string;
  rawOutput: string | null;
  finishReason: string | null;
  parseError?: string | null;
}

export interface ReviewMarketDocumentParams {
  filename: string;
  geminiExtractionJson: JsonRecord;
  textPreview?: string | null;
  strategyContext?: string | null;
}

export interface RunLiveMarketAnalysisParams {
  propertyContextJson: JsonRecord;
  approvedDocumentReviews: unknown[];
  approvedMarketCompsTableRows: unknown[];
  approvedCompItems: unknown[];
  excludedOrWatchRows: unknown[];
  previousSnapshot: unknown;
}

function getOpenAiApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

function emptyResult(model: string, parseError?: string | null): MarketLlmJsonResult {
  return {
    parsed: null,
    model,
    rawOutput: null,
    finishReason: null,
    parseError: parseError ?? null,
  };
}

async function runMarketJsonPrompt(prompt: string, logLabel: string): Promise<MarketLlmJsonResult> {
  const model = getMarketAnalysisModel();
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    console.warn(`[${logLabel}] OPENAI_API_KEY missing or invalid; skipping OpenAI call.`);
    return emptyResult(model, "OPENAI_API_KEY is missing or invalid; market analysis LLM call was skipped.");
  }

  const openai = new OpenAI({ apiKey });
  const reasoningEffort = getMarketAnalysisReasoningEffort();
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
    const requestDurationMs = Date.now() - requestStartedAt;

    console.info(`[${logLabel}] OpenAI market analysis request completed`, {
      model,
      promptVersion: MARKET_PROMPT_V3_VERSION,
      requestDurationMs,
      reasoningEffort: supportsReasoningEffort(model) ? reasoningEffort : null,
      finishReason,
      promptTokens: completion.usage?.prompt_tokens ?? null,
      completionTokens: completion.usage?.completion_tokens ?? null,
      totalTokens: completion.usage?.total_tokens ?? null,
    });

    if (!parsed) {
      return {
        parsed: null,
        model,
        rawOutput,
        finishReason,
        parseError: finishReason === "length"
          ? "OpenAI returned truncated JSON before completing the market analysis response."
          : "OpenAI returned malformed JSON for the market analysis response.",
      };
    }

    return {
      parsed,
      model,
      rawOutput,
      finishReason,
      parseError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${logLabel}] OpenAI market analysis call failed`, { model, error: message });
    return emptyResult(model, `OpenAI request failed: ${message}`);
  }
}

export async function reviewMarketDocumentExtraction(params: ReviewMarketDocumentParams): Promise<MarketLlmJsonResult> {
  const prompt = buildMarketDocumentReviewPrompt(params);
  return runMarketJsonPrompt(prompt, "reviewMarketDocumentExtraction");
}

export async function runLiveMarketAnalysis(params: RunLiveMarketAnalysisParams): Promise<MarketLlmJsonResult> {
  const prompt = buildLiveMarketAnalysisPrompt(params);
  return runMarketJsonPrompt(prompt, "runLiveMarketAnalysis");
}
