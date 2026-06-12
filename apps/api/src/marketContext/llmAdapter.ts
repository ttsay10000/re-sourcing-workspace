/**
 * Provider-agnostic LLM adapter for the market-context pipeline. Stages pass a
 * prompt (plus optional native PDF) and get back raw + parsed JSON; the
 * provider is chosen by config, never hardcoded:
 *
 *   MARKET_LLM_PROVIDER = auto (default) | gemini | openai
 *     auto → Gemini (native PDF vision) when a key + PDF are present, else OpenAI text mode.
 *   MARKET_LLM_GEMINI_MODEL / MARKET_LLM_OPENAI_MODEL override per-provider models.
 *
 * Tests and re-processing inject their own MarketLlmRunner instead of calling out.
 */
import https from "node:https";
import { URL } from "node:url";
import OpenAI from "openai";
import { getOmAnalysisModel, getOmAnalysisReasoningEffort, supportsReasoningEffort } from "../enrichment/openaiModels.js";
import { parseCompletionJsonContent } from "../om/omAnalysisShared.js";
import { DEFAULT_GEMINI_OM_MODEL } from "../om/extractOmAnalysisFromGeminiPdfOnly.js";

export interface MarketLlmRequest {
  stage: "classify" | "extract" | "synthesize" | "knowledge" | "notes" | "review";
  prompt: string;
  /** Native document input for providers with PDF vision (Gemini inline data). */
  pdf?: { buffer: Buffer; filename: string } | null;
  /** Text fallback used when the provider cannot ingest the PDF natively. */
  documentText?: string | null;
  /**
   * Stage's preferred provider (e.g. notes read = gemini, notes refine =
   * openai). MARKET_LLM_PROVIDER still wins when explicitly configured.
   */
  provider?: "gemini" | "openai";
}

export interface MarketLlmResult {
  provider: "gemini" | "openai" | "mock";
  model: string;
  rawOutput: string | null;
  parsed: Record<string, unknown> | null;
  error: string | null;
}

export type MarketLlmRunner = (request: MarketLlmRequest) => Promise<MarketLlmResult>;

const MAX_DOCUMENT_TEXT_CHARS = 180_000;
/** Gemini inline_data limit is ~20MB request size; stay safely under it. */
const MAX_INLINE_PDF_BYTES = 15 * 1024 * 1024;
const GEMINI_TIMEOUT_MS = 300_000;

function cleanKey(raw: string | undefined): string | null {
  if (raw == null) return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  return key.length >= 10 ? key : null;
}

function getGeminiKey(): string | null {
  return cleanKey(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY);
}

function getOpenAiKey(): string | null {
  return cleanKey(process.env.OPENAI_API_KEY);
}

function resolveProvider(request: MarketLlmRequest): "gemini" | "openai" {
  const configured = (process.env.MARKET_LLM_PROVIDER ?? "auto").trim().toLowerCase();
  if (configured === "gemini") return "gemini";
  if (configured === "openai") return "openai";
  // Stage preference (when that provider has a key), then auto.
  if (request.provider === "gemini" && getGeminiKey()) return "gemini";
  if (request.provider === "openai" && getOpenAiKey()) return "openai";
  // auto: prefer native PDF vision when possible.
  if (request.pdf && getGeminiKey() && request.pdf.buffer.length <= MAX_INLINE_PDF_BYTES) return "gemini";
  return "openai";
}

function resolveGeminiModel(): string {
  return process.env.MARKET_LLM_GEMINI_MODEL?.trim() || process.env.GEMINI_OM_MODEL?.trim() || DEFAULT_GEMINI_OM_MODEL;
}

function resolveOpenAiModel(): string {
  return process.env.MARKET_LLM_OPENAI_MODEL?.trim() || getOmAnalysisModel();
}

function withDocumentText(prompt: string, documentText: string | null | undefined): string {
  const text = documentText?.trim();
  if (!text) return prompt;
  return `${prompt}\n\nDOCUMENT TEXT (extracted, page markers preserved):\n${text.slice(0, MAX_DOCUMENT_TEXT_CHARS)}`;
}

function geminiRequest(params: {
  url: string;
  apiKey: string;
  payload: string;
}): Promise<{ status: number; body: string }> {
  const target = new URL(params.url);
  const payload = Buffer.from(params.payload, "utf-8");
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": params.apiKey,
          "Content-Length": String(payload.length),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") })
        );
      }
    );
    request.setTimeout(GEMINI_TIMEOUT_MS, () => {
      request.destroy(new Error(`Gemini market-context request timed out after ${GEMINI_TIMEOUT_MS}ms`));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function runGemini(request: MarketLlmRequest): Promise<MarketLlmResult> {
  const model = resolveGeminiModel();
  const apiKey = getGeminiKey();
  if (!apiKey) {
    return { provider: "gemini", model, rawOutput: null, parsed: null, error: "GEMINI_API_KEY missing or invalid" };
  }

  const parts: Array<Record<string, unknown>> = [];
  if (request.pdf && request.pdf.buffer.length <= MAX_INLINE_PDF_BYTES) {
    parts.push({ inlineData: { mimeType: "application/pdf", data: request.pdf.buffer.toString("base64") } });
    parts.push({ text: request.prompt });
  } else {
    parts.push({ text: withDocumentText(request.prompt, request.documentText) });
  }

  const payload = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await geminiRequest({ url, apiKey, payload });
    if (response.status < 200 || response.status >= 300) {
      const error = `Gemini ${request.stage} call failed: ${response.status} ${response.body.slice(0, 300)}`;
      console.error(`[marketContext llm] ${error}`);
      return { provider: "gemini", model, rawOutput: null, parsed: null, error };
    }
    const data = JSON.parse(response.body) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      return {
        provider: "gemini",
        model,
        rawOutput: null,
        parsed: null,
        error: `Gemini blocked the request: ${data.promptFeedback.blockReason}`,
      };
    }
    const rawOutput =
      data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || null;
    const parsed = parseCompletionJsonContent(rawOutput);
    return {
      provider: "gemini",
      model,
      rawOutput,
      parsed,
      error: parsed ? null : "Gemini returned malformed JSON.",
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[marketContext llm] Gemini ${request.stage} error:`, error);
    return { provider: "gemini", model, rawOutput: null, parsed: null, error };
  }
}

async function runOpenAi(request: MarketLlmRequest): Promise<MarketLlmResult> {
  const model = resolveOpenAiModel();
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    return { provider: "openai", model, rawOutput: null, parsed: null, error: "OPENAI_API_KEY missing or invalid" };
  }
  const openai = new OpenAI({ apiKey });
  const prompt = withDocumentText(request.prompt, request.documentText);
  const reasoningEffort = getOmAnalysisReasoningEffort();

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
    });
    const rawOutput = completion.choices[0]?.message?.content?.trim() || null;
    const parsed = parseCompletionJsonContent(rawOutput);
    return {
      provider: "openai",
      model,
      rawOutput,
      parsed,
      error: parsed ? null : "OpenAI returned malformed JSON.",
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[marketContext llm] OpenAI ${request.stage} error:`, error);
    return { provider: "openai", model, rawOutput: null, parsed: null, error };
  }
}

/** Default runner; pipelines accept an override for tests and re-processing. */
export const runMarketLlm: MarketLlmRunner = async (request) => {
  const provider = resolveProvider(request);
  return provider === "gemini" ? runGemini(request) : runOpenAi(request);
};
