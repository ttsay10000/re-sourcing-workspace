import https from "node:https";
import { URL } from "node:url";
import { OM_ANALYSIS_PROMPT_PREFIX } from "../rental/omAnalysisPrompt.js";
import {
  fromLlmFromOmAnalysis,
  type OmAnalysisExtractionResult,
  type OmInputDocument,
  isPdfLikeOmInputDocument,
  omAnalysisFromParsedJson,
  parseCompletionJsonContent,
} from "./omAnalysisShared.js";

export interface GeminiPdfOnlyOmExtractionParams {
  documents: OmInputDocument[];
  propertyContext?: string | null;
  enrichmentContext?: string | null;
  model?: string | null;
}

export interface GeminiPdfOnlyOmExtractionResult extends OmAnalysisExtractionResult {
  model: string;
  rawOutput: string | null;
  finishReason: string | null;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

function getGeminiApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

export const DEFAULT_GEMINI_OM_MODEL = "gemini-3-flash-preview";

export function resolveGeminiOmModel(explicit?: string | null): string {
  const envModel = process.env.GEMINI_OM_MODEL;
  return explicit?.trim() || envModel?.trim() || DEFAULT_GEMINI_OM_MODEL;
}

function getGeminiTimeoutMs(): number {
  const raw = process.env.GEMINI_OM_TIMEOUT_MS;
  if (typeof raw === "string") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 30_000) return parsed;
  }
  return 420_000;
}

function buildPdfOnlyOmPrompt(params: {
  propertyContext?: string | null;
  enrichmentContext?: string | null;
  filenames: string[];
}): string {
  const contextSections = [
    params.propertyContext ? `Property context:\n${params.propertyContext.trim()}` : null,
    params.enrichmentContext ? `Additional enrichment data:\n${params.enrichmentContext.trim()}` : null,
    params.filenames.length > 0 ? `Attached PDF file(s): ${params.filenames.join(", ")}` : null,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const prefix = contextSections.length > 0 ? `${contextSections.join("\n\n")}\n\n` : "";

  return `${OM_ANALYSIS_PROMPT_PREFIX}

${prefix}CRITICAL PDF-ONLY MODE:
- No extracted PDF text is provided. You must inspect the attached PDF file(s) directly.
- Review the entire PDF page by page, including image-based rent rolls, screenshots, graphics, and scanned financial tables.
- Preserve exact current figures shown in the document. Prefer CURRENT over PRO FORMA when both appear.
- Return one JSON object only.

GEMINI RESPONSE RULES:
- Keep these keys at the TOP LEVEL only: propertyInfo, rentRoll, income, expenses, revenueComposition, financialMetrics, valuationMetrics, underwritingMetrics, nycRegulatorySummary, furnishedModel, reportedDiscrepancies, sourceCoverage, investmentTakeaways, recommendedOfferAnalysis, uiFinancialSummary, dossierMemo, noiReported.
- sourceCoverage may contain ONLY coverage diagnostics. Do not place uiFinancialSummary, investmentTakeaways, recommendedOfferAnalysis, or dossierMemo inside sourceCoverage.
- noiReported must be the CURRENT in-place NOI if the OM explicitly states NOI. If the OM does not explicitly state NOI, set noiReported to null and still compute uiFinancialSummary.noi from current income and expenses.
- uiFinancialSummary must contain current grossRent, noi, capRate, expenseRatio, and breakEvenOccupancy whenever they can be derived from the OM.
- propertyInfo.totalUnits must be the selected unit count after reconciliation. rentRoll must still include every rent-bearing row, even if one tenant leases multiple spaces and rentRoll rows exceed totalUnits.
- If a narrative/unit summary conflicts with the detailed rent roll, choose one value for calculations, record the conflict in reportedDiscrepancies, and explain exactly why.
- Use exact CURRENT / IN-PLACE figures. Do not put pro forma numbers into income, noiReported, uiFinancialSummary, or valuationMetrics.
- Preserve exact dollar amounts from the OM. Do not shift decimals or simplify values.`;
}

function emptyResult(model: string): GeminiPdfOnlyOmExtractionResult {
  return {
    fromLlm: null,
    omAnalysis: null,
    model,
    rawOutput: null,
    finishReason: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function applyInferredSourceCoverage(parsed: Record<string, unknown>): Record<string, unknown> {
  const propertyInfo = isPlainObject(parsed.propertyInfo) ? parsed.propertyInfo : {};
  const income = isPlainObject(parsed.income) ? parsed.income : {};
  const expenses = isPlainObject(parsed.expenses) ? parsed.expenses : {};
  const existingCoverage = isPlainObject(parsed.sourceCoverage) ? parsed.sourceCoverage : {};
  const rentRoll = Array.isArray(parsed.rentRoll) ? parsed.rentRoll : [];
  const expensesTable = Array.isArray(expenses.expensesTable) ? expenses.expensesTable : [];
  const uiFinancialSummary = isPlainObject(parsed.uiFinancialSummary) ? parsed.uiFinancialSummary : {};
  const currentFinancialsExtracted =
    hasNumber(income.grossRentActual) ||
    hasNumber(income.grossRentPotential) ||
    hasNumber(income.effectiveGrossIncome) ||
    hasNumber(uiFinancialSummary.grossRent) ||
    hasNumber(uiFinancialSummary.noi);

  return {
    ...parsed,
    sourceCoverage: {
      ...existingCoverage,
      propertyInfoExtracted:
        existingCoverage.propertyInfoExtracted ?? Object.keys(propertyInfo).length > 0,
      rentRollExtracted:
        existingCoverage.rentRollExtracted ?? rentRoll.length > 0,
      incomeStatementExtracted:
        existingCoverage.incomeStatementExtracted ?? Object.keys(income).length > 0,
      expensesExtracted:
        existingCoverage.expensesExtracted ?? (expensesTable.length > 0 || hasNumber(expenses.totalExpenses)),
      currentFinancialsExtracted:
        existingCoverage.currentFinancialsExtracted ?? currentFinancialsExtracted,
      unitCountExtracted:
        existingCoverage.unitCountExtracted ?? (hasNumber(propertyInfo.totalUnits) || rentRoll.length > 0),
    },
  };
}

function getResponseText(response: GeminiGenerateContentResponse): string | null {
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
  return text || null;
}

function buildStructuredOutputSchema() {
  const looseObject = {
    type: "object",
    additionalProperties: true,
  } as const;
  const nullableNumber = {
    type: ["number", "null"],
  } as const;
  const nullableBoolean = {
    type: ["boolean", "null"],
  } as const;
  const stringArray = {
    type: "array",
    items: {
      type: "string",
    },
  } as const;
  const strictSourceCoverage = {
    type: "object",
    additionalProperties: false,
    properties: {
      usedExtractedText: nullableBoolean,
      usedPdfGraphics: nullableBoolean,
      tablePagesDetected: nullableNumber,
      tablePagesReadFromGraphics: nullableNumber,
      coverageGaps: stringArray,
      propertyInfoExtracted: nullableBoolean,
      rentRollExtracted: nullableBoolean,
      incomeStatementExtracted: nullableBoolean,
      expensesExtracted: nullableBoolean,
      currentFinancialsExtracted: nullableBoolean,
      unitCountExtracted: nullableBoolean,
    },
  } as const;
  const strictUiFinancialSummary = {
    type: "object",
    additionalProperties: false,
    properties: {
      price: nullableNumber,
      pricePerUnit: nullableNumber,
      pricePerSqft: nullableNumber,
      grossRent: nullableNumber,
      noi: nullableNumber,
      capRate: nullableNumber,
      adjustedCapRate: nullableNumber,
      rentUpsidePercent: nullableNumber,
      expenseRatio: nullableNumber,
      breakEvenOccupancy: nullableNumber,
      furnishedNOI: nullableNumber,
      furnishedCapRate: nullableNumber,
    },
  } as const;

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "propertyInfo",
      "rentRoll",
      "income",
      "expenses",
      "revenueComposition",
      "financialMetrics",
      "valuationMetrics",
      "underwritingMetrics",
      "nycRegulatorySummary",
      "furnishedModel",
      "reportedDiscrepancies",
      "sourceCoverage",
      "investmentTakeaways",
      "recommendedOfferAnalysis",
      "uiFinancialSummary",
      "dossierMemo",
      "noiReported",
    ],
    properties: {
      propertyInfo: looseObject,
      rentRoll: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      income: looseObject,
      expenses: looseObject,
      revenueComposition: looseObject,
      financialMetrics: looseObject,
      valuationMetrics: looseObject,
      underwritingMetrics: looseObject,
      nycRegulatorySummary: looseObject,
      furnishedModel: looseObject,
      reportedDiscrepancies: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      investmentTakeaways: {
        type: "array",
        items: {
          type: "string",
        },
      },
      recommendedOfferAnalysis: looseObject,
      uiFinancialSummary: strictUiFinancialSummary,
      dossierMemo: looseObject,
      sourceCoverage: strictSourceCoverage,
      noiReported: nullableNumber,
    },
  } as const;
}

async function postGeminiGenerateContent(params: {
  url: string;
  apiKey: string;
  timeoutMs: number;
  payload: string;
}): Promise<{ status: number; body: string }> {
  const target = new URL(params.url);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(params.payload),
          "x-goog-api-key": params.apiKey,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );

    request.setTimeout(params.timeoutMs, () => {
      request.destroy(new Error(`Gemini request timed out after ${params.timeoutMs}ms`));
    });
    request.on("error", reject);
    request.write(params.payload);
    request.end();
  });
}

export async function extractOmAnalysisFromGeminiPdfOnly(
  params: GeminiPdfOnlyOmExtractionParams
): Promise<GeminiPdfOnlyOmExtractionResult> {
  const documents = params.documents.filter((doc) => doc.buffer instanceof Buffer && doc.buffer.length > 0);
  const pdfDocuments = documents.filter((doc) => isPdfLikeOmInputDocument(doc));
  const model = resolveGeminiOmModel(params.model);
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    console.warn("[extractOmAnalysisFromGeminiPdfOnly] GEMINI_API_KEY missing or invalid; skipping Gemini call.");
    return emptyResult(model);
  }
  if (pdfDocuments.length === 0) {
    console.warn("[extractOmAnalysisFromGeminiPdfOnly] No readable PDF documents were provided.");
    return emptyResult(model);
  }

  const prompt = buildPdfOnlyOmPrompt({
    propertyContext: params.propertyContext ?? null,
    enrichmentContext: params.enrichmentContext ?? null,
    filenames: pdfDocuments.map((doc) => doc.filename),
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const timeoutMs = getGeminiTimeoutMs();
  const payload = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          ...pdfDocuments.map((doc) => ({
            inlineData: {
              mimeType: doc.mimeType ?? "application/pdf",
              data: doc.buffer.toString("base64"),
            },
          })),
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseJsonSchema: buildStructuredOutputSchema(),
    },
  });
  const response = await postGeminiGenerateContent({
    url,
    apiKey,
    timeoutMs,
    payload,
  });

  if (response.status < 200 || response.status >= 300) {
    const bodyText = response.body;
    console.error(`[extractOmAnalysisFromGeminiPdfOnly] Gemini call failed: ${response.status} ${bodyText}`);
    return emptyResult(model);
  }

  const data = JSON.parse(response.body) as GeminiGenerateContentResponse;
  if (data.promptFeedback?.blockReason) {
    console.error(
      `[extractOmAnalysisFromGeminiPdfOnly] Gemini blocked the request: ${data.promptFeedback.blockReason}`
    );
    return emptyResult(model);
  }

  const rawOutput = getResponseText(data);
  const finishReason =
    Array.isArray(data.candidates) && typeof data.candidates[0]?.finishReason === "string"
      ? data.candidates[0].finishReason
      : null;
  const parsed = parseCompletionJsonContent(rawOutput);
  if (!parsed) {
    return {
      ...emptyResult(model),
      rawOutput,
      finishReason,
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
}
