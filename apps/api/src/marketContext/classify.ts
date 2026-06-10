/**
 * Stage 1a: document classification. The LLM sees the first 1–3 pages plus a
 * sampled middle page (cover, TOC/methodology, one data page) and returns the
 * provenance verdict; code validates/coerces it and applies the safe default —
 * broker_provided — whenever the output is missing or malformed (decision rule 5).
 */
import type {
  ClassifierConfidence,
  MarketDocClassification,
  MarketDocumentClass,
  MarketSourceType,
} from "@re-sourcing/contracts";
import type { ExtractedTextPageMetadata } from "../upload/extractTextFromUploadedFile.js";
import { CLASSIFIER_PROMPT, MARKET_PROMPT_VERSIONS } from "./prompts.js";
import type { MarketLlmRequest, MarketLlmResult, MarketLlmRunner } from "./llmAdapter.js";

const SOURCE_TYPES: MarketSourceType[] = ["broker_provided", "market_research"];
const DOCUMENT_CLASSES: MarketDocumentClass[] = ["published_report", "om", "bov", "comp_list", "email", "unknown"];
const CONFIDENCES: ClassifierConfidence[] = ["high", "medium", "low"];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Coerce raw classifier JSON into a valid classification. Anything outside the
 * two-value source_type enum (or a missing/unparseable response) falls back to
 * broker_provided with low confidence — never invent research provenance.
 */
export function coerceClassification(parsed: Record<string, unknown> | null): MarketDocClassification {
  const evidence = Array.isArray(parsed?.evidence)
    ? (parsed?.evidence ?? []).filter((item): item is string => typeof item === "string").slice(0, 12)
    : [];

  const rawSourceType = asString(parsed?.source_type);
  const sourceTypeValid = SOURCE_TYPES.includes(rawSourceType as MarketSourceType);
  const rawClass = asString(parsed?.document_class);
  const documentClass = DOCUMENT_CLASSES.includes(rawClass as MarketDocumentClass)
    ? (rawClass as MarketDocumentClass)
    : "unknown";
  const rawConfidence = asString(parsed?.classifier_confidence);
  let confidence = CONFIDENCES.includes(rawConfidence as ClassifierConfidence)
    ? (rawConfidence as ClassifierConfidence)
    : "low";
  if (!sourceTypeValid) {
    confidence = "low";
    evidence.push("classifier output missing/invalid source_type — defaulted to broker_provided");
  }

  return {
    source_type: sourceTypeValid ? (rawSourceType as MarketSourceType) : "broker_provided",
    publisher: asString(parsed?.publisher),
    branded: parsed?.branded === true,
    document_class: documentClass,
    report_title: asString(parsed?.report_title),
    period_covered: asString(parsed?.period_covered),
    geo_scope: asString(parsed?.geo_scope),
    subject_property: asString(parsed?.subject_property),
    classifier_confidence: confidence,
    evidence,
  };
}

/** First 1–3 pages plus one sampled middle page, with page markers. */
export function buildClassifierSample(pages: ExtractedTextPageMetadata[]): string {
  if (pages.length === 0) return "";
  const picks = pages.slice(0, 3);
  if (pages.length > 4) {
    const middle = pages[Math.floor(pages.length / 2)];
    if (middle && !picks.includes(middle)) picks.push(middle);
  }
  return picks
    .map((page) => `[Page ${page.pageNumber} of ${pages.length}]\n${page.textSample}`)
    .join("\n\n")
    .slice(0, 60_000);
}

export interface ClassifyMarketDocumentResult {
  classification: MarketDocClassification;
  flagForReview: boolean;
  llm: MarketLlmResult;
  promptVersion: string;
}

export async function classifyMarketDocument(params: {
  pdf: { buffer: Buffer; filename: string };
  pages: ExtractedTextPageMetadata[];
  llm: MarketLlmRunner;
}): Promise<ClassifyMarketDocumentResult> {
  const sample = buildClassifierSample(params.pages);
  const request: MarketLlmRequest = {
    stage: "classify",
    prompt: CLASSIFIER_PROMPT,
    documentText: sample || null,
    // Scanned PDFs with no text layer need native vision to classify.
    pdf: sample.length < 200 ? params.pdf : null,
  };
  const llm = await params.llm(request);
  const classification = coerceClassification(llm.parsed);
  return {
    classification,
    flagForReview: classification.classifier_confidence === "low",
    llm,
    promptVersion: MARKET_PROMPT_VERSIONS.classify,
  };
}
