/**
 * Extract rental-related financials from listing description, OM, or email/attachments via LLM.
 * Used by: (1) processInbox when broker/thread emails have OM attachments, (2) POST upload when user uploads OM/Brochure.
 * When OM-style: uses senior-analyst prompt and returns full OmAnalysis + derived fromLlm. Otherwise returns fromLlm only.
 */

import type {
  RentalFinancialsFromLlm,
  ExpenseLineItem,
  RentalNumberPerUnit,
  OmAnalysis,
  OmRentRollRow,
} from "@re-sourcing/contracts";
import OpenAI from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  getEnrichmentModel,
  getOmAnalysisModel,
  getOmAnalysisReasoningEffort,
  supportsReasoningEffort,
} from "../enrichment/openaiModels.js";
import { OM_ANALYSIS_PROMPT_PREFIX } from "./omAnalysisPrompt.js";
import { resolveCurrentFinancialsFromOmAnalysis } from "./currentFinancials.js";
import { extractRentalFinancialsFallback } from "./extractRentalFinancialsFallback.js";

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

export interface ExtractRentalFinancialsResult {
  fromLlm: RentalFinancialsFromLlm | null;
  omAnalysis?: OmAnalysis | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) {
    return Object.values(value).some((entry) => hasMeaningfulValue(entry));
  }
  return true;
}

function mergeArrayValues(primary: unknown[], fallback: unknown[]): unknown[] {
  if (primary.length === 0) return fallback;
  if (fallback.length === 0) return primary;
  if (primary.every((value) => typeof value === "string") && fallback.every((value) => typeof value === "string")) {
    return Array.from(new Set([...(primary as string[]), ...(fallback as string[])]));
  }
  return primary;
}

function mergeMissingValues<T>(primary: T, fallback: T): T {
  if (!hasMeaningfulValue(primary)) return fallback;
  if (!hasMeaningfulValue(fallback)) return primary;
  if (Array.isArray(primary) && Array.isArray(fallback)) {
    return mergeArrayValues(primary, fallback) as T;
  }
  if (isPlainObject(primary) && isPlainObject(fallback)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(fallback), ...Object.keys(primary)]);
    for (const key of keys) {
      merged[key] = mergeMissingValues(primary[key], fallback[key]);
    }
    return merged as T;
  }
  return primary;
}

function overrideWithFallbackFields(
  target: Record<string, unknown>,
  fallback: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const next = { ...target };
  for (const key of keys) {
    if (hasMeaningfulValue(fallback[key])) next[key] = fallback[key];
  }
  return next;
}

function rowHasStructuredDetails(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return [
    "monthlyRent",
    "annualRent",
    "monthlyBaseRent",
    "annualBaseRent",
    "monthlyTotalRent",
    "annualTotalRent",
    "beds",
    "baths",
    "sqft",
    "tenantName",
    "leaseStartDate",
    "leaseEndDate",
    "lastRentedDate",
    "dateVacant",
    "reimbursementAmount",
  ].some((key) => hasMeaningfulValue(value[key]));
}

function shouldPreferFallbackRows(primaryRows: unknown[], fallbackRows: unknown[]): boolean {
  if (fallbackRows.length === 0) return false;
  if (primaryRows.length === 0) return true;
  const primaryHasStructuredDetails = primaryRows.some((row) => rowHasStructuredDetails(row));
  const fallbackHasStructuredDetails = fallbackRows.some((row) => rowHasStructuredDetails(row));
  if (fallbackHasStructuredDetails && !primaryHasStructuredDetails) return true;
  return !primaryHasStructuredDetails && fallbackRows.length > primaryRows.length;
}

function getReportedTotalUnits(omAnalysis: OmAnalysis | null | undefined): number | null {
  const propertyInfo = isPlainObject(omAnalysis?.propertyInfo) ? omAnalysis.propertyInfo : null;
  const totalUnits = propertyInfo?.totalUnits;
  return typeof totalUnits === "number" && Number.isFinite(totalUnits) ? totalUnits : null;
}

function shouldDropIncompleteRows(rows: unknown[], totalUnits: number | null): boolean {
  if (rows.length === 0 || totalUnits == null || totalUnits <= 0) return false;
  if (rows.length >= totalUnits) return false;
  return !rows.some((row) => rowHasStructuredDetails(row));
}

function shouldDropPartialRows(rows: unknown[], totalUnits: number | null): boolean {
  if (rows.length === 0 || totalUnits == null || totalUnits <= 0) return false;
  return rows.length < totalUnits;
}

function removeRecordKeys(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const next = { ...value };
  for (const key of keys) delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
}

export function sanitizeOmAnalysisByCoverage(
  omAnalysis: OmAnalysis,
  fallbackOmAnalysis: OmAnalysis | null | undefined
): OmAnalysis {
  const next: OmAnalysis = { ...omAnalysis };
  const coverage = isPlainObject(next.sourceCoverage) ? next.sourceCoverage : null;
  const currentFinancialsExtracted = coverage?.currentFinancialsExtracted === true;
  const expensesExtracted = coverage?.expensesExtracted === true;
  const rentRollExtracted = coverage?.rentRollExtracted === true;
  const totalUnits = getReportedTotalUnits(next);

  if (!currentFinancialsExtracted) {
    next.income = isPlainObject(fallbackOmAnalysis?.income) ? fallbackOmAnalysis?.income ?? undefined : undefined;
    next.revenueComposition = removeRecordKeys(next.revenueComposition, [
      "commercialAnnualRent",
      "commercialMonthlyRent",
      "residentialAnnualRent",
      "residentialMonthlyRent",
      "commercialRevenueShare",
      "residentialRevenueShare",
    ]);
    next.uiFinancialSummary = removeRecordKeys(next.uiFinancialSummary, [
      "grossRent",
      "noi",
      "capRate",
      "expenseRatio",
      "furnishedNOI",
      "furnishedCapRate",
      "adjustedCapRate",
      "breakEvenOccupancy",
      "rentUpsidePercent",
    ]);
    next.valuationMetrics = removeRecordKeys(next.valuationMetrics, ["capRate", "NOI", "grossRentMultiplier"]);
    next.financialMetrics = undefined;
    next.underwritingMetrics = undefined;
    next.furnishedModel = undefined;
    next.recommendedOfferAnalysis = undefined;
    next.noiReported = undefined;
    if (Array.isArray(next.investmentTakeaways)) {
      next.investmentTakeaways = next.investmentTakeaways.filter(
        (line) => !/\b(NOI|gross rent|cap rate|expense ratio|furnished|break-even occupancy)\b/i.test(line)
      );
      if (next.investmentTakeaways.length === 0) next.investmentTakeaways = undefined;
    }
  }

  if (!expensesExtracted) {
    next.expenses = fallbackOmAnalysis?.expenses ?? undefined;
    next.uiFinancialSummary = removeRecordKeys(next.uiFinancialSummary, ["expenseRatio"]);
  }

  if (!rentRollExtracted && shouldDropPartialRows(Array.isArray(next.rentRoll) ? next.rentRoll : [], totalUnits)) {
    delete next.rentRoll;
  }

  return next;
}

function applyDeterministicFallbackOverrides(
  merged: ExtractRentalFinancialsResult,
  fallback: ExtractRentalFinancialsResult
): ExtractRentalFinancialsResult {
  const next: ExtractRentalFinancialsResult = {
    fromLlm: merged.fromLlm ?? null,
    omAnalysis: merged.omAnalysis ?? null,
  };

  const fallbackOm = isPlainObject(fallback.omAnalysis) ? fallback.omAnalysis : null;
  const mergedOm = isPlainObject(next.omAnalysis) ? ({ ...next.omAnalysis } as OmAnalysis) : null;
  if (mergedOm) {
    if (fallbackOm) {
      const fallbackPropertyInfo = isPlainObject(fallbackOm.propertyInfo) ? fallbackOm.propertyInfo : null;
      const mergedPropertyInfo = isPlainObject(mergedOm.propertyInfo) ? mergedOm.propertyInfo : null;
      if (fallbackPropertyInfo) {
        mergedOm.propertyInfo = overrideWithFallbackFields(
          mergedPropertyInfo ?? {},
          fallbackPropertyInfo,
          [
            "address",
            "packageAddress",
            "block",
            "lotNumbers",
            "unitsResidential",
            "unitsCommercial",
            "totalUnits",
            "unitCountSource",
            "borough",
            "propertyType",
            "portfolioType",
            "commercialSummary",
          ]
        );
      }

      const fallbackRevenueComposition = isPlainObject(fallbackOm.revenueComposition) ? fallbackOm.revenueComposition : null;
      const mergedRevenueComposition = isPlainObject(mergedOm.revenueComposition) ? mergedOm.revenueComposition : null;
      if (fallbackRevenueComposition) {
        mergedOm.revenueComposition = overrideWithFallbackFields(
          mergedRevenueComposition ?? {},
          fallbackRevenueComposition,
          ["commercialUnits", "freeMarketUnits", "rentStabilizedUnits", "notes"]
        );
      }
    }

    const mergedRentRoll = Array.isArray(mergedOm.rentRoll) ? mergedOm.rentRoll : [];
    const fallbackRentRoll = Array.isArray(fallbackOm?.rentRoll) ? fallbackOm.rentRoll : [];
    if (shouldPreferFallbackRows(mergedRentRoll, fallbackRentRoll)) {
      mergedOm.rentRoll = fallbackRentRoll;
    } else if (shouldDropIncompleteRows(mergedRentRoll, getReportedTotalUnits(mergedOm))) {
      delete mergedOm.rentRoll;
    }

    next.omAnalysis = mergedOm;
  }

  const mergedFromLlm = isPlainObject(next.fromLlm) ? ({ ...next.fromLlm } as RentalFinancialsFromLlm) : null;
  const fallbackFromLlm = isPlainObject(fallback.fromLlm) ? fallback.fromLlm : null;
  if (mergedFromLlm) {
    const mergedRows = Array.isArray(mergedFromLlm.rentalNumbersPerUnit) ? mergedFromLlm.rentalNumbersPerUnit : [];
    const fallbackRows = Array.isArray(fallbackFromLlm?.rentalNumbersPerUnit) ? fallbackFromLlm.rentalNumbersPerUnit : [];
    if (shouldPreferFallbackRows(mergedRows, fallbackRows)) {
      mergedFromLlm.rentalNumbersPerUnit = fallbackRows as RentalNumberPerUnit[];
    } else if (shouldDropIncompleteRows(mergedRows, getReportedTotalUnits(next.omAnalysis ?? null))) {
      delete mergedFromLlm.rentalNumbersPerUnit;
    }
    next.fromLlm = mergedFromLlm;
  }

  return next;
}

function nonEmptyObject<T extends Record<string, unknown> | null | undefined>(value: T): T | null {
  return isPlainObject(value) && Object.keys(value).length > 0 ? value : null;
}

/**
 * Keep the richer LLM parse, but backfill missing structure from deterministic parsing.
 * This preserves package/unit mix facts when the model returns only financial summaries.
 */
export function mergeExtractionResultWithFallback(
  primary: ExtractRentalFinancialsResult,
  fallback: ExtractRentalFinancialsResult
): ExtractRentalFinancialsResult {
  const mergedFromLlm = nonEmptyObject(
    mergeMissingValues(
      (primary.fromLlm ?? null) as RentalFinancialsFromLlm | null,
      (fallback.fromLlm ?? null) as RentalFinancialsFromLlm | null
    )
  ) as RentalFinancialsFromLlm | null;
  const mergedOmAnalysis = nonEmptyObject(
    mergeMissingValues(
      (primary.omAnalysis ?? null) as OmAnalysis | null,
      (fallback.omAnalysis ?? null) as OmAnalysis | null
    )
  ) as OmAnalysis | null;
  return applyDeterministicFallbackOverrides({
    fromLlm: mergedFromLlm,
    omAnalysis: mergedOmAnalysis,
  }, fallback);
}

/**
 * Call LLM to extract NOI, cap rate, rental estimates, etc. from listing text (short).
 * Returns legacy fromLlm only; for full OM analysis use extractRentalFinancialsFromText with forceOmStyle or long text.
 */
export async function extractRentalFinancialsFromListing(
  description: string | null | undefined,
  buildingName: string | null | undefined
): Promise<RentalFinancialsFromLlm | null> {
  const key = getApiKey();
  if (!key) return null;
  const desc = (description ?? "").trim();
  const building = (buildingName ?? "").trim();
  const text = [building ? `Building name: ${building}` : "", desc].filter(Boolean).join("\n\n");
  const result = await extractRentalFinancialsFromText(text, { allowImplicitOmStyle: false });
  return stripStructuredOmFields(result.fromLlm);
}

const OM_STYLE_MIN_LENGTH = 2500;
const MIN_TEXT_LENGTH_FOR_LLM = 20;
const MAX_MULTIMODAL_DOCS = 1;
const MAX_MULTIMODAL_DOC_BYTES = 10 * 1024 * 1024;
const OM_FILE_PARSE_TIMEOUT_MS = Number(process.env.OPENAI_OM_FILE_TIMEOUT_MS) || 30_000;

/** Cap rate and furnished cap rate: store as percentage number (5.47 for 5.47%). */
const UI_PERCENT_KEYS = ["capRate", "adjustedCapRate", "furnishedCapRate", "rentUpsidePercent"];
/** Ratio/occupancy: store as decimal 0–1 (0.24 for 24%). */
const UI_RATIO_KEYS = ["expenseRatio", "breakEvenOccupancy"];
/** Dollar amounts: keep as number, no % scaling. */
const UI_DOLLAR_KEYS = ["price", "pricePerUnit", "pricePerSqft", "grossRent", "noi", "furnishedNOI"];

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,%\s]/g, "");
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Normalize LLM uiFinancialSummary so cap rates are percentage numbers (5.47), ratios are decimals (0.24),
 * and string/dollar values are coerced to numbers for consistent UI display.
 */
function normalizeUiFinancialSummary(
  raw: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const num = toNum(value);
    if (num === null) {
      out[key] = value;
      continue;
    }
    if (UI_PERCENT_KEYS.includes(key)) {
      // LLM may return 0.0547 (decimal) or 5.47 (percentage). Store as percentage.
      out[key] = num > 0 && num <= 1 ? num * 100 : num;
    } else if (UI_RATIO_KEYS.includes(key)) {
      // Store as decimal 0–1 (0.24 = 24%). LLM may return 0.0024 (wrong); scale to 0.24.
      if (num > 0 && num <= 0.02) out[key] = num * 100; // e.g. 0.0024 -> 0.24
      else if (num > 1 && num <= 100) out[key] = num / 100; // e.g. 24 -> 0.24
      else out[key] = num;
    } else if (UI_DOLLAR_KEYS.includes(key) || key.includes("price") || key.includes("Rent") || key.includes("noi") || key.includes("NOI")) {
      out[key] = num;
    } else {
      out[key] = typeof value === "number" ? value : num;
    }
  }
  return out;
}

export interface ExtractRentalFinancialsOptions {
  /** When true, use the full senior-analyst OM prompt regardless of text length. Use for uploaded OM/Brochure. */
  forceOmStyle?: boolean;
  /** When false, do not infer OM-style mode from long plain text alone. Use for listing-only extraction. */
  allowImplicitOmStyle?: boolean;
  /** Optional enrichment context (HPD, violations, permits, etc.) to append for the LLM. */
  enrichmentContext?: string;
  /**
   * Optional original document inputs to send to the model alongside extracted text.
   * Use for PDFs with image-based tables or page graphics that plain-text extraction can miss.
   */
  documentFiles?: OmInputDocument[];
}

export interface OmInputDocument {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}

function isPdfLikeDocument(doc: OmInputDocument): boolean {
  const filename = doc.filename.toLowerCase();
  const mime = (doc.mimeType ?? "").toLowerCase();
  return filename.endsWith(".pdf") || mime === "application/pdf";
}

function scoreOmDocument(doc: OmInputDocument): number {
  const name = doc.filename.toLowerCase();
  let score = 0;
  if (name.includes("offering")) score += 6;
  if (name.includes("memorandum")) score += 6;
  if (name.includes("executive")) score += 4;
  if (name.includes("brochure")) score += 3;
  if (name.includes("rent roll")) score += 2;
  if (name.endsWith(".pdf")) score += 1;
  return score;
}

function selectOmDocumentFiles(documentFiles?: OmInputDocument[]): OmInputDocument[] {
  if (!Array.isArray(documentFiles) || documentFiles.length === 0) return [];
  return documentFiles
    .filter((doc) => doc?.buffer instanceof Buffer && doc.buffer.length > 0 && isPdfLikeDocument(doc))
    .filter((doc) => doc.buffer.length <= MAX_MULTIMODAL_DOC_BYTES)
    .sort((a, b) => scoreOmDocument(b) - scoreOmDocument(a))
    .slice(0, MAX_MULTIMODAL_DOCS);
}

function stripStructuredOmFields(
  value: RentalFinancialsFromLlm | null | undefined
): RentalFinancialsFromLlm | null {
  if (!value || typeof value !== "object") return null;
  const next: RentalFinancialsFromLlm = { ...value };
  delete next.expensesTable;
  delete next.rentalNumbersPerUnit;
  const hasAny = Object.values(next).some((fieldValue) => hasMeaningfulValue(fieldValue));
  return hasAny ? next : null;
}

export function buildOmStyleMessages(prompt: string, documentFiles: OmInputDocument[]): ChatCompletionMessageParam[] {
  if (documentFiles.length === 0) return [{ role: "user", content: prompt }];

  const content: ChatCompletionContentPart[] = [{ type: "text", text: prompt }];
  for (const doc of documentFiles) {
    const mimeType = (doc.mimeType ?? "").trim() || "application/pdf";
    content.push({
      type: "file",
      file: {
        file_data: `data:${mimeType};base64,${doc.buffer.toString("base64")}`,
        filename: doc.filename,
      },
    });
  }
  return [{ role: "user", content }];
}

async function createOmStyleCompletion(
  openai: OpenAI,
  prompt: string,
  documentFiles: OmInputDocument[]
) {
  const model = getOmAnalysisModel();
  const reasoningEffort = getOmAnalysisReasoningEffort();
  try {
    return await openai.chat.completions.create({
      model,
      messages: buildOmStyleMessages(prompt, documentFiles),
      response_format: { type: "json_object" },
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
    }, documentFiles.length > 0 ? { timeout: OM_FILE_PARSE_TIMEOUT_MS, maxRetries: 0 } : undefined);
  } catch (err) {
    if (documentFiles.length === 0) throw err;
    console.warn(
      "[extractRentalFinancialsFromText] File-assisted OM parsing failed; retrying text-only:",
      err instanceof Error ? err.message : err
    );
    return await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
    });
  }
}

/**
 * Derive legacy fromLlm from OmAnalysis for backward compatibility and property page fallback.
 */
function fromLlmFromOmAnalysis(om: OmAnalysis): RentalFinancialsFromLlm {
  const expenses = om.expenses as { totalExpenses?: number; expensesTable?: ExpenseLineItem[] } | undefined;
  const valuation = om.valuationMetrics as Record<string, unknown> | undefined;
  const ui = om.uiFinancialSummary as Record<string, unknown> | undefined;
  const resolved = resolveCurrentFinancialsFromOmAnalysis(om);
  const noi = resolved.noi;
  let capRate =
    (valuation?.capRate as number | undefined) ?? (ui?.capRate as number | undefined);
  // LLM may return cap rate as decimal (0.0356); we store and display as percentage (3.56)
  if (capRate != null && typeof capRate === "number" && capRate > 0 && capRate <= 1) capRate = capRate * 100;
  const grossRentTotal = resolved.grossRentalIncome;
  const totalExpenses = resolved.operatingExpenses ?? expenses?.totalExpenses;
  const expensesTable = expenses?.expensesTable;
  const rentRoll = om.rentRoll ?? [];
  const sourceCoverage = isPlainObject(om.sourceCoverage) ? om.sourceCoverage : null;
  const rentRollExtracted = sourceCoverage?.rentRollExtracted === true;
  const investmentTakeaways = om.investmentTakeaways ?? [];

  const rentalNumbersPerUnit: RentalNumberPerUnit[] = rentRoll.map((r: OmRentRollRow) => {
    const unitLabel =
      typeof r.building === "string" && r.building.trim() !== ""
        ? `${r.building} ${typeof r.unit === "string" ? r.unit : typeof r.tenantName === "string" ? r.tenantName : ""}`.trim()
        : typeof r.unit === "string"
          ? r.unit
          : typeof r.tenantName === "string"
            ? r.tenantName
            : undefined;
    const monthlyRent =
      typeof r.monthlyTotalRent === "number"
        ? r.monthlyTotalRent
        : typeof r.monthlyBaseRent === "number"
          ? r.monthlyBaseRent
          : typeof r.monthlyRent === "number"
            ? r.monthlyRent
            : undefined;
    const annualRent =
      typeof r.annualTotalRent === "number"
        ? r.annualTotalRent
        : typeof r.annualBaseRent === "number"
          ? r.annualBaseRent
          : typeof r.annualRent === "number"
            ? r.annualRent
            : monthlyRent != null
              ? monthlyRent * 12
              : undefined;
    const note = [
      r.unitCategory,
      r.rentType,
      r.tenantStatus,
      r.tenantName,
      r.leaseType,
      r.leaseEndDate ? `Lease ends ${r.leaseEndDate}` : null,
      r.reimbursementType,
      r.rentEscalations,
      r.notes,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .join("; ");
    return {
      unit: unitLabel,
      monthlyRent,
      annualRent,
      beds: r.beds,
      baths: r.baths,
      sqft: r.sqft,
      occupied: r.occupied,
      lastRentedDate: r.lastRentedDate,
      dateVacant: r.dateVacant,
      note: note || undefined,
    };
  });

  const out: RentalFinancialsFromLlm = {};
  if (noi != null && typeof noi === "number") out.noi = noi;
  if (capRate != null && typeof capRate === "number") out.capRate = capRate;
  if (grossRentTotal != null && typeof grossRentTotal === "number") out.grossRentTotal = grossRentTotal;
  if (totalExpenses != null && typeof totalExpenses === "number") out.totalExpenses = totalExpenses;
  if (Array.isArray(expensesTable) && expensesTable.length > 0) out.expensesTable = expensesTable;
  const shouldOmitRentalRows =
    (!rentRollExtracted && shouldDropPartialRows(rentalNumbersPerUnit, getReportedTotalUnits(om))) ||
    shouldDropIncompleteRows(rentalNumbersPerUnit, getReportedTotalUnits(om));
  if (!shouldOmitRentalRows && rentalNumbersPerUnit.length > 0) {
    out.rentalNumbersPerUnit = rentalNumbersPerUnit;
  }
  if (investmentTakeaways.length > 0)
    out.keyTakeaways = (investmentTakeaways as string[]).map((t: string) => (t.startsWith("•") ? t : `• ${t}`)).join("\n");
  return out;
}

/**
 * Extract rental financials from arbitrary text (e.g. inquiry email body, OM PDF text, brochure).
 * When OM-style (long text or forceOmStyle): uses senior-analyst prompt, returns full omAnalysis + derived fromLlm.
 * Otherwise: uses short prompt, returns fromLlm only.
 */
export async function extractRentalFinancialsFromText(
  text: string,
  options?: ExtractRentalFinancialsOptions
): Promise<ExtractRentalFinancialsResult> {
  const trimmed = (text ?? "").trim();
  const omDocumentFiles = selectOmDocumentFiles(options?.documentFiles);
  const hasDocumentFiles = omDocumentFiles.length > 0;
  const fallbackResult = extractRentalFinancialsFallback(trimmed);
  const key = getApiKey();
  if (!key) {
    console.warn("[extractRentalFinancialsFromText] OPENAI_API_KEY missing or invalid; skipping OpenAI call.");
    return fallbackResult;
  }
  if ((!trimmed || trimmed.length < MIN_TEXT_LENGTH_FOR_LLM) && !hasDocumentFiles) {
    console.warn("[extractRentalFinancialsFromText] Text too short for LLM (length:", trimmed.length, "); skipping OpenAI call.");
    return fallbackResult;
  }

  const isOmStyle =
    options?.forceOmStyle === true ||
    hasDocumentFiles ||
    (options?.allowImplicitOmStyle !== false && trimmed.length >= OM_STYLE_MIN_LENGTH);
  /** For OM-style, use more context so long/complex OMs (e.g. full Executive Summary + appendices) are not truncated; rent roll often appears later in the doc. */
  const omDocLimit = 48000;
  const docLimit = isOmStyle ? omDocLimit : 15000;
  const docSnippet = trimmed.slice(0, docLimit);
  const omModel = isOmStyle ? getOmAnalysisModel() : getEnrichmentModel();
  console.log(
    "[extractRentalFinancialsFromText] Calling OpenAI model=" +
      omModel +
      " isOmStyle=" +
      isOmStyle +
      " promptChars=" +
      (OM_ANALYSIS_PROMPT_PREFIX.length + docSnippet.length) +
      " fileInputs=" +
      omDocumentFiles.length +
      (trimmed.length > docLimit ? " (doc truncated)" : "")
  );
  const openai = new OpenAI({ apiKey: key });

  const documentSection =
    (options?.enrichmentContext ? `Additional enrichment data:\n${options.enrichmentContext}\n\n` : "") +
    (isOmStyle && hasDocumentFiles
      ? `Attached original PDF file(s): ${omDocumentFiles.map((doc) => doc.filename).join(", ")}.
Use the attached file(s) together with the extracted text below. The extracted text may miss image-based rent rolls, financial tables, or lease schedules.\n\n`
      : "") +
    `Document text (OM/listing${hasDocumentFiles ? "; may be incomplete on graphic pages" : ""}):\n${
      docSnippet || "[No reliable plain text extracted; rely on the attached PDF file if provided.]"
    }`;

  const prompt = isOmStyle
    ? OM_ANALYSIS_PROMPT_PREFIX + documentSection
    : `Below is text from a NYC real estate listing or inquiry (description, email body, or attachment). Extract any financial or rental-related information into a JSON object. Keep string fields concise and readable.

Return a JSON object with these keys (use null for missing):
- noi: number (Net Operating Income if mentioned)
- capRate: number (cap rate % if mentioned)
- grossRentTotal: number (total gross rent if mentioned)
- totalExpenses: number (total expenses if mentioned)
- expensesTable: array of { "lineItem": string, "amount": number } for each expense line if a breakdown is given
- rentalEstimates: string (brief summary of rent roll or income; not a raw dump)
- rentalNumbersPerUnit: array of { "unit": string, "monthlyRent": number (optional), "annualRent": number (optional), "rent": number (optional), "beds": number (optional), "baths": number (optional), "sqft": number (optional), "note": string (optional) } if per-unit rents are mentioned
- otherFinancials: string (taxes, expenses, HOA, other numbers — clean "Item: $X" format)
- keyTakeaways: string (optional; 1–3 bullet points if the text highlights value, condition, or risks)

Only include keys where you found relevant data. If nothing financial or rental-related is found, return {"otherFinancials": null}.

Text:
${trimmed.slice(0, 15000)}`;

  try {
    const completion =
      isOmStyle
        ? await createOmStyleCompletion(openai, prompt, omDocumentFiles)
        : await openai.chat.completions.create({
            model: omModel,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string")
      return fallbackResult;

    let jsonStr = content.trim();
    const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (isOmStyle) {
      const rawUi = (parsed.uiFinancialSummary as Record<string, unknown>) ?? undefined;
      const omAnalysis = sanitizeOmAnalysisByCoverage({
        propertyInfo: (parsed.propertyInfo as Record<string, unknown>) ?? undefined,
        rentRoll: Array.isArray(parsed.rentRoll)
          ? (parsed.rentRoll as OmRentRollRow[])
          : undefined,
        income: (parsed.income as Record<string, unknown>) ?? undefined,
        expenses: (parsed.expenses as OmAnalysis["expenses"]) ?? undefined,
        revenueComposition: (parsed.revenueComposition as Record<string, unknown>) ?? undefined,
        financialMetrics: (parsed.financialMetrics as Record<string, unknown>) ?? undefined,
        valuationMetrics: (parsed.valuationMetrics as Record<string, unknown>) ?? undefined,
        underwritingMetrics: (parsed.underwritingMetrics as Record<string, unknown>) ?? undefined,
        nycRegulatorySummary: (parsed.nycRegulatorySummary as Record<string, unknown>) ?? undefined,
        furnishedModel: (parsed.furnishedModel as Record<string, unknown>) ?? undefined,
        reportedDiscrepancies: Array.isArray(parsed.reportedDiscrepancies)
          ? (parsed.reportedDiscrepancies as Array<Record<string, unknown>>)
          : undefined,
        sourceCoverage: (parsed.sourceCoverage as Record<string, unknown>) ?? undefined,
        investmentTakeaways: Array.isArray(parsed.investmentTakeaways)
          ? (parsed.investmentTakeaways as string[])
          : undefined,
        recommendedOfferAnalysis: (parsed.recommendedOfferAnalysis as Record<string, unknown>) ?? undefined,
        uiFinancialSummary: normalizeUiFinancialSummary(rawUi),
        dossierMemo: (parsed.dossierMemo as Record<string, string>) ?? undefined,
        noiReported:
          typeof parsed.noiReported === "number" && !Number.isNaN(parsed.noiReported)
            ? parsed.noiReported
            : undefined,
      }, fallbackResult.omAnalysis ?? null);
      return mergeExtractionResultWithFallback(
        { fromLlm: fromLlmFromOmAnalysis(omAnalysis), omAnalysis },
        fallbackResult
      );
    }

    const result: RentalFinancialsFromLlm = {};
    if (parsed.noi != null && typeof parsed.noi === "number") result.noi = parsed.noi;
    if (parsed.capRate != null && typeof parsed.capRate === "number") result.capRate = parsed.capRate;
    if (parsed.grossRentTotal != null && typeof parsed.grossRentTotal === "number")
      result.grossRentTotal = parsed.grossRentTotal;
    if (parsed.totalExpenses != null && typeof parsed.totalExpenses === "number")
      result.totalExpenses = parsed.totalExpenses;
    if (Array.isArray(parsed.expensesTable) && parsed.expensesTable.length > 0) {
      result.expensesTable = (parsed.expensesTable as Array<{ lineItem?: unknown; amount?: unknown }>)
        .map((e) => ({ lineItem: String(e?.lineItem ?? "").trim(), amount: Number(e?.amount) || 0 }))
        .filter((e) => e.lineItem.length > 0) as ExpenseLineItem[];
    }
    if (typeof parsed.rentalEstimates === "string" && parsed.rentalEstimates.trim())
      result.rentalEstimates = parsed.rentalEstimates.trim();
    if (Array.isArray(parsed.rentalNumbersPerUnit) && parsed.rentalNumbersPerUnit.length > 0) {
      result.rentalNumbersPerUnit = (parsed.rentalNumbersPerUnit as Array<Record<string, unknown>>).map((u) => {
        const monthly = typeof u.monthlyRent === "number" ? u.monthlyRent : null;
        const annual = typeof u.annualRent === "number" ? u.annualRent : null;
        const rent = typeof u.rent === "number" ? u.rent : null;
        const beds = typeof u.beds === "number" && !Number.isNaN(u.beds) ? u.beds : undefined;
        const baths = typeof u.baths === "number" && !Number.isNaN(u.baths) ? u.baths : undefined;
        const sqft = typeof u.sqft === "number" && !Number.isNaN(u.sqft) && u.sqft > 0 ? u.sqft : undefined;
        return {
          unit: typeof u.unit === "string" ? u.unit.trim() : undefined,
          monthlyRent: monthly ?? (rent != null ? rent : (annual != null ? annual / 12 : undefined)),
          annualRent: annual ?? (rent != null ? rent * 12 : (monthly != null ? monthly * 12 : undefined)),
          rent: rent ?? monthly ?? (annual != null ? annual / 12 : undefined),
          beds,
          baths,
          sqft,
          note: typeof u.note === "string" ? u.note.trim() || undefined : undefined,
        } as RentalNumberPerUnit;
      });
    }
    if (typeof parsed.otherFinancials === "string" && parsed.otherFinancials.trim())
      result.otherFinancials = parsed.otherFinancials.trim();
    if (typeof parsed.keyTakeaways === "string" && parsed.keyTakeaways.trim())
      result.keyTakeaways = parsed.keyTakeaways.trim();

    const mergedShortResult = mergeExtractionResultWithFallback(
      {
        fromLlm: Object.keys(result).length > 0 ? result : null,
        omAnalysis: null,
      },
      { fromLlm: fallbackResult.fromLlm, omAnalysis: null }
    );

    return {
      fromLlm: mergedShortResult.fromLlm,
      omAnalysis: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
    console.error(
      "[extractRentalFinancialsFromText] OpenAI call failed:",
      msg,
      code ? `(code: ${code})` : "",
      status ? `(status: ${status})` : ""
    );
    if (err && typeof err === "object" && "error" in err) {
      const apiErr = (err as { error?: { message?: string; code?: string } }).error;
      if (apiErr?.message) console.error("[extractRentalFinancialsFromText] API error:", apiErr.message, apiErr.code ?? "");
    }
    return fallbackResult;
  }
}
