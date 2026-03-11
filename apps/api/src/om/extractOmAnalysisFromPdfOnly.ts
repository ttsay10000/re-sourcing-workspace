import OpenAI from "openai";
import type { OmAnalysis } from "@re-sourcing/contracts";
import {
  getOmAnalysisModel,
  getOmAnalysisReasoningEffort,
  supportsReasoningEffort,
} from "../enrichment/openaiModels.js";
import { OM_ANALYSIS_PROMPT_PREFIX } from "../rental/omAnalysisPrompt.js";
import {
  type ExtractRentalFinancialsResult,
  fromLlmFromOmAnalysis,
  omAnalysisFromParsedJson,
  parseCompletionJsonContent,
  type OmInputDocument,
} from "../rental/extractRentalFinancialsFromListing.js";

export interface PdfOnlyOmExtractionParams {
  documents: OmInputDocument[];
  propertyContext?: string | null;
  enrichmentContext?: string | null;
  model?: string | null;
  maxOutputTokens?: number | null;
}

export interface PdfOnlyOmExtractionResult extends ExtractRentalFinancialsResult {
  model: string;
  responseId: string | null;
  rawOutput: string | null;
}

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
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
- Return one JSON object only.`;
}

function buildPdfOnlyResponseInput(
  prompt: string,
  files: Array<{ fileId: string }>
): Array<{
  role: "user";
  content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_file"; file_id: string }
  >;
}> {
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...files.map((file) => ({
          type: "input_file" as const,
          file_id: file.fileId,
        })),
      ],
    },
  ];
}

function emptyResult(model: string): PdfOnlyOmExtractionResult {
  return {
    fromLlm: null,
    omAnalysis: null,
    model,
    responseId: null,
    rawOutput: null,
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
  const currentFinancialsExtracted =
    hasNumber(income.grossRentActual) ||
    hasNumber(income.grossRentPotential) ||
    hasNumber(income.effectiveGrossIncome) ||
    hasNumber((parsed.uiFinancialSummary as Record<string, unknown> | undefined)?.grossRent) ||
    hasNumber((parsed.uiFinancialSummary as Record<string, unknown> | undefined)?.noi);

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

export function summarizePdfOnlyOmCoverage(omAnalysis: OmAnalysis | null | undefined) {
  const rentRoll = Array.isArray(omAnalysis?.rentRoll) ? omAnalysis.rentRoll : [];
  const expensesTable = Array.isArray(omAnalysis?.expenses?.expensesTable) ? omAnalysis?.expenses?.expensesTable : [];
  const propertyInfo = omAnalysis?.propertyInfo as Record<string, unknown> | undefined;
  const valuationMetrics = omAnalysis?.valuationMetrics as Record<string, unknown> | undefined;
  return {
    hasPrice: typeof propertyInfo?.price === "number" || typeof valuationMetrics?.price === "number",
    hasUnitCount: typeof propertyInfo?.totalUnits === "number",
    hasRentRoll: rentRoll.length > 0,
    rentRollCount: rentRoll.length,
    hasExpenses: expensesTable.length > 0 || typeof omAnalysis?.expenses?.totalExpenses === "number",
    expenseLineCount: expensesTable.length,
  };
}

export async function extractOmAnalysisFromPdfOnly(
  params: PdfOnlyOmExtractionParams
): Promise<PdfOnlyOmExtractionResult> {
  const documents = params.documents.filter((doc) => doc.buffer instanceof Buffer && doc.buffer.length > 0);
  const model = params.model?.trim() || getOmAnalysisModel();
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn("[extractOmAnalysisFromPdfOnly] OPENAI_API_KEY missing or invalid; skipping OpenAI call.");
    return emptyResult(model);
  }
  if (documents.length === 0) {
    console.warn("[extractOmAnalysisFromPdfOnly] No readable PDF documents were provided.");
    return emptyResult(model);
  }

  const prompt = buildPdfOnlyOmPrompt({
    propertyContext: params.propertyContext ?? null,
    enrichmentContext: params.enrichmentContext ?? null,
    filenames: documents.map((doc) => doc.filename),
  });
  const openai = new OpenAI({ apiKey });
  const reasoningEffort = getOmAnalysisReasoningEffort();
  const uploadedFileIds: string[] = [];

  try {
    const uploadedFiles = [];
    for (const doc of documents) {
      const uploaded = await openai.files.create({
        file: await OpenAI.toFile(doc.buffer, doc.filename, { type: doc.mimeType ?? "application/pdf" }),
        purpose: "user_data",
      });
      uploadedFileIds.push(uploaded.id);
      uploadedFiles.push({
        fileId: uploaded.id,
      });
    }

    const response = await openai.responses.create({
      model,
      input: buildPdfOnlyResponseInput(prompt, uploadedFiles),
      max_output_tokens: params.maxOutputTokens ?? 8_000,
      text: {
        format: {
          type: "json_object",
        },
      },
      ...(supportsReasoningEffort(model) ? { reasoning: { effort: reasoningEffort } } : {}),
    });

    const rawOutput = typeof response.output_text === "string" ? response.output_text : null;
    const parsed = parseCompletionJsonContent(rawOutput);
    if (!parsed) {
      return {
        ...emptyResult(model),
        responseId: response.id ?? null,
        rawOutput,
      };
    }

    const omAnalysis = omAnalysisFromParsedJson(applyInferredSourceCoverage(parsed));
    return {
      fromLlm: fromLlmFromOmAnalysis(omAnalysis),
      omAnalysis,
      model,
      responseId: response.id ?? null,
      rawOutput,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extractOmAnalysisFromPdfOnly] OpenAI call failed:", message);
    return emptyResult(model);
  } finally {
    await Promise.all(
      uploadedFileIds.map(async (fileId) => {
        try {
          await openai.files.del(fileId);
        } catch {
          // Ignore cleanup failures for one-off test uploads.
        }
      })
    );
  }
}
