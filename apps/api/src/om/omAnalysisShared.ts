import type {
  ExpenseLineItem,
  OmAnalysis,
  OmRentRollRow,
  RentalFinancialsFromLlm,
  RentalNumberPerUnit,
} from "@re-sourcing/contracts";
import { resolveCurrentFinancialsFromOmAnalysis } from "../rental/currentFinancials.js";
import {
  hasStructuredRentRollDetails,
  isPlaceholderRentRollRow,
  sanitizeExpenseTableRows,
  sanitizeOmRentRollRows,
  sanitizeRentalNumberRows,
} from "../rental/omAnalysisUtils.js";

export interface OmInputDocument {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}

export interface OmAnalysisExtractionResult {
  fromLlm: RentalFinancialsFromLlm | null;
  omAnalysis?: OmAnalysis | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function getReportedTotalUnits(omAnalysis: OmAnalysis | null | undefined): number | null {
  const propertyInfo = isPlainObject(omAnalysis?.propertyInfo) ? omAnalysis.propertyInfo : null;
  const totalUnits = propertyInfo?.totalUnits;
  return typeof totalUnits === "number" && Number.isFinite(totalUnits) ? totalUnits : null;
}

function shouldDropIncompleteRows(rows: unknown[], totalUnits: number | null): boolean {
  if (rows.length === 0 || totalUnits == null || totalUnits <= 0) return false;
  if (rows.length >= totalUnits) return false;
  return !rows.some((row) => hasStructuredRentRollDetails(row));
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

const UI_PERCENT_KEYS = ["capRate", "adjustedCapRate", "furnishedCapRate", "rentUpsidePercent"];
const UI_RATIO_KEYS = ["expenseRatio", "breakEvenOccupancy"];
const UI_DOLLAR_KEYS = ["price", "pricePerUnit", "pricePerSqft", "grossRent", "noi", "furnishedNOI"];

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
      out[key] = num > 0 && num <= 1 ? num * 100 : num;
    } else if (UI_RATIO_KEYS.includes(key)) {
      if (num > 0 && num <= 0.02) out[key] = num * 100;
      else if (num > 1 && num <= 100) out[key] = num / 100;
      else out[key] = num;
    } else if (
      UI_DOLLAR_KEYS.includes(key) ||
      key.includes("price") ||
      key.includes("Rent") ||
      key.includes("noi") ||
      key.includes("NOI")
    ) {
      out[key] = num;
    } else {
      out[key] = typeof value === "number" ? value : num;
    }
  }
  return out;
}

export function isPdfLikeOmInputDocument(
  doc: Pick<OmInputDocument, "filename"> & { mimeType?: string | null }
): boolean {
  const mime = (doc.mimeType ?? "").toLowerCase();
  const filename = doc.filename.toLowerCase();
  return mime.includes("pdf") || filename.endsWith(".pdf");
}

export function parseCompletionJsonContent(content: string | null | undefined): Record<string, unknown> | null {
  if (!content || typeof content !== "string") return null;
  let jsonStr = content.trim();
  const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (codeBlock) jsonStr = codeBlock[1].trim();
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function sanitizeOmAnalysisByCoverage(omAnalysis: OmAnalysis): OmAnalysis {
  const next: OmAnalysis = { ...omAnalysis };
  const sanitizedRentRoll = sanitizeOmRentRollRows(Array.isArray(next.rentRoll) ? next.rentRoll : []);
  next.rentRoll = sanitizedRentRoll.length > 0 ? sanitizedRentRoll : undefined;
  const sanitizedExpenses = sanitizeExpenseTableRows(
    (next.expenses as { expensesTable?: ExpenseLineItem[] } | undefined)?.expensesTable
  );
  if (next.expenses && typeof next.expenses === "object") {
    next.expenses = {
      ...next.expenses,
      expensesTable: sanitizedExpenses.length > 0 ? sanitizedExpenses : undefined,
    };
  }
  const coverage = isPlainObject(next.sourceCoverage) ? next.sourceCoverage : null;
  const currentFinancialsExtracted = coverage?.currentFinancialsExtracted === true;
  const expensesExtracted = coverage?.expensesExtracted === true;
  const rentRollExtracted = coverage?.rentRollExtracted === true;
  const totalUnits = getReportedTotalUnits(next);

  if (!currentFinancialsExtracted) {
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
    next.expenses = undefined;
    next.uiFinancialSummary = removeRecordKeys(next.uiFinancialSummary, ["expenseRatio"]);
  }

  if (!rentRollExtracted && shouldDropPartialRows(Array.isArray(next.rentRoll) ? next.rentRoll : [], totalUnits)) {
    delete next.rentRoll;
  }

  return next;
}

export function omAnalysisFromParsedJson(parsed: Record<string, unknown>): OmAnalysis {
  const rawUi = (parsed.uiFinancialSummary as Record<string, unknown>) ?? undefined;
  return sanitizeOmAnalysisByCoverage({
    propertyInfo: (parsed.propertyInfo as Record<string, unknown>) ?? undefined,
    rentRoll: Array.isArray(parsed.rentRoll) ? (parsed.rentRoll as OmRentRollRow[]) : undefined,
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
  });
}

export function fromLlmFromOmAnalysis(om: OmAnalysis): RentalFinancialsFromLlm {
  const expenses = om.expenses as { totalExpenses?: number; expensesTable?: ExpenseLineItem[] } | undefined;
  const valuation = om.valuationMetrics as Record<string, unknown> | undefined;
  const ui = om.uiFinancialSummary as Record<string, unknown> | undefined;
  const resolved = resolveCurrentFinancialsFromOmAnalysis(om);
  const noi = resolved.noi;
  let capRate = (valuation?.capRate as number | undefined) ?? (ui?.capRate as number | undefined);
  if (capRate != null && typeof capRate === "number" && capRate > 0 && capRate <= 1) capRate = capRate * 100;
  const grossRentTotal = resolved.grossRentalIncome;
  const totalExpenses = resolved.operatingExpenses ?? expenses?.totalExpenses;
  const expensesTable = sanitizeExpenseTableRows(expenses?.expensesTable);
  const rentRoll = sanitizeOmRentRollRows(om.rentRoll ?? []);
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
  const cleanedRentalNumbersPerUnit = sanitizeRentalNumberRows(rentalNumbersPerUnit);
  const shouldOmitRentalRows =
    (!rentRollExtracted && shouldDropPartialRows(cleanedRentalNumbersPerUnit, getReportedTotalUnits(om))) ||
    shouldDropIncompleteRows(cleanedRentalNumbersPerUnit, getReportedTotalUnits(om));
  if (!shouldOmitRentalRows && cleanedRentalNumbersPerUnit.length > 0) {
    out.rentalNumbersPerUnit = cleanedRentalNumbersPerUnit;
  }
  if (investmentTakeaways.length > 0) {
    out.keyTakeaways = (investmentTakeaways as string[]).map((t: string) => (t.startsWith("•") ? t : `• ${t}`)).join("\n");
  }
  return out;
}

export function summarizeOmAnalysisCoverage(omAnalysis: OmAnalysis | null | undefined) {
  const rentRoll = Array.isArray(omAnalysis?.rentRoll) ? omAnalysis.rentRoll : [];
  const expensesTable = Array.isArray(omAnalysis?.expenses?.expensesTable) ? omAnalysis.expenses.expensesTable : [];
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

export function hasPlaceholderRentRollRows(omAnalysis: OmAnalysis | null | undefined): boolean {
  return sanitizeOmRentRollRows(omAnalysis?.rentRoll ?? []).some((row) => isPlaceholderRentRollRow(row));
}
