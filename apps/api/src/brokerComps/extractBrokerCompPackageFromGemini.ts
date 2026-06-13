import https from "node:https";
import { URL } from "node:url";
import type { BrokerCompItemType } from "@re-sourcing/contracts";
import type { BrokerCompExtractedItemInput } from "../brokerComp/service.js";
import { getSharedGeminiOmRequestQueue, runWithGeminiOmRequestQueue } from "../asyncTaskQueue.js";
import { DEFAULT_GEMINI_OM_MODEL } from "../om/extractOmAnalysisFromGeminiPdfOnly.js";
import { parseCompletionJsonContent } from "../om/omAnalysisShared.js";
import { buildGeminiMarketExtractionPrompt, MARKET_PROMPT_V3_VERSION } from "./marketPromptV3.js";

type JsonRecord = Record<string, unknown>;

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
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface GeminiHttpResponse {
  status: number;
  body: string;
}

export interface GeminiBrokerCompExtractionResult {
  extractedItems: BrokerCompExtractedItemInput[];
  packageMeta: JsonRecord;
  summary: string | null;
  rawOutput: string | null;
  finishReason: string | null;
  model: string;
}

export interface GeminiBrokerCompExtractionParams {
  buffer: Buffer;
  filename: string;
  textPreview?: string | null;
  pageCount?: number | null;
}

const geminiHttpsAgent = new https.Agent({ keepAlive: true });
const DEFAULT_GEMINI_BROKER_COMP_INLINE_MAX_BYTES = 14 * 1024 * 1024;

function getGeminiApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

function resolveGeminiBrokerCompModel(): string {
  return process.env.GEMINI_BROKER_COMP_MODEL?.trim()
    || process.env.GEMINI_OM_MODEL?.trim()
    || DEFAULT_GEMINI_OM_MODEL;
}

function getGeminiBrokerCompTimeoutMs(): number {
  const raw = process.env.GEMINI_BROKER_COMP_TIMEOUT_MS ?? process.env.GEMINI_OM_TIMEOUT_MS;
  if (typeof raw === "string") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 30_000) return parsed;
  }
  return 360_000;
}

function getGeminiBrokerCompInlineMaxBytes(): number {
  const raw = process.env.GEMINI_BROKER_COMP_INLINE_MAX_BYTES;
  if (typeof raw === "string") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_GEMINI_BROKER_COMP_INLINE_MAX_BYTES;
}

function isPdfFilename(filename: string): boolean {
  return /\.pdf$/i.test(filename.trim());
}

function getResponseText(response: GeminiGenerateContentResponse): string | null {
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("").trim();
  return text || null;
}

async function postGeminiGenerateContent(params: {
  url: string;
  apiKey: string;
  timeoutMs: number;
  payload: string;
}): Promise<GeminiHttpResponse> {
  const target = new URL(params.url);
  const payloadBuffer = Buffer.from(params.payload, "utf-8");
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        agent: geminiHttpsAgent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(payloadBuffer.length),
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
      request.destroy(new Error(`Gemini broker comp request timed out after ${params.timeoutMs}ms`));
    });
    request.on("error", reject);
    request.write(payloadBuffer);
    request.end();
  });
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

function compactNumericText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\s+/g, " ")
    .replace(/\$\s+/g, "$")
    .replace(/(\d)\s*,\s*(\d)/g, "$1,$2")
    .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2")
    .replace(/(\d)\s+(?=\d)/g, "$1")
    .replace(/\s+SF\b/gi, " SF")
    .replace(/\s*\/\s*MO\b/gi, "/MO")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(compactNumericText(value).replace(/[$,%\s,]/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const compact = compactNumericText(value).toLowerCase().replace(/\/mo(?:nth)?\b/g, "");
  const multiplier = /\d(?:\.\d+)?m\b/.test(compact) ? 1_000_000 : /\d(?:\.\d+)?k\b/.test(compact) ? 1_000 : 1;
  const parsed = numberValue(compact.replace(/[mk]\b/g, ""));
  return parsed == null ? null : parsed * multiplier;
}

function percentValue(value: unknown): number | null {
  const parsed = numberValue(value);
  if (parsed == null) return null;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function moneyRange(value: unknown, explicitLow?: unknown, explicitHigh?: unknown): {
  label: string | null;
  low: number | null;
  high: number | null;
} {
  const low = moneyValue(explicitLow);
  const high = moneyValue(explicitHigh);
  const label = stringValue(value);
  if (low != null || high != null) return { label, low, high };
  if (!label) return { label: null, low: null, high: null };
  const compact = compactNumericText(label);
  const parts = compact.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const amount = moneyValue(parts[0]);
    return { label: compact, low: amount, high: amount };
  }
  const inheritedSuffix = parts[0]?.match(/[mk]\b/i)?.[0] ?? "";
  return {
    label: compact,
    low: moneyValue(parts[0]),
    high: moneyValue(/[mk]\b/i.test(parts[1] ?? "") ? parts[1] : `${parts[1]}${inheritedSuffix}`),
  };
}

function normalizeUnitType(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const compact = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const bedMatch = compact.match(/^(\d+)\s*BED(?:ROOM)?S?$/i);
  if (bedMatch?.[1]) return `${bedMatch[1]} BED`;
  if (/^STUDIO$/i.test(compact)) return "STUDIO";
  if (/^PENTHOUSE$/i.test(compact)) return "PENTHOUSE";
  if (/^TOWN\s*HOME$|^TOWNHOME$/i.test(compact)) return "TOWNHOME";
  return compact || null;
}

function bedroomsFromUnitType(value: unknown): number | null {
  const normalized = normalizeUnitType(value);
  if (!normalized) return null;
  if (normalized === "STUDIO") return 0;
  const match = normalized.match(/^(\d+)\s*BED$/i);
  return match?.[1] ? Number(match[1]) : numberValue(value);
}

function normalizeBedroomRow(row: JsonRecord): JsonRecord {
  const range = moneyRange(row.priceRange ?? row.range, row.priceRangeLow ?? row.lowPrice, row.priceRangeHigh ?? row.highPrice);
  const unitType = normalizeUnitType(row.bedroomType ?? row.unitType ?? row.bedroomsLabel);
  return {
    unitType,
    bedroomType: unitType,
    bedrooms: numberValue(row.bedrooms) ?? bedroomsFromUnitType(unitType),
    count: numberValue(row.count ?? row.units),
    avgSizeSqft: numberValue(row.avgSizeSqft ?? row.averageSizeSqft ?? row.avgSize ?? row.averageSize),
    avgAskingPpsf: moneyValue(row.avgAskingPpsf ?? row.averageAskingPpsf ?? row.askingPpsf),
    avgSoldPpsf: moneyValue(row.avgSoldPpsf ?? row.averageSoldPpsf ?? row.soldPpsf),
    avgCommonChargesMonthly: moneyValue(row.avgCommonChargesMonthly ?? row.averageCommonChargesMonthly ?? row.avgCc ?? row.commonCharges),
    priceRange: range.label,
    priceRangeLow: range.low,
    priceRangeHigh: range.high,
  };
}

function normalizeSubjectUnitRow(row: JsonRecord): JsonRecord {
  return {
    unitLabel: stringValue(row.unitLabel ?? row.unit ?? row.name),
    bedrooms: numberValue(row.bedrooms ?? row.bed ?? row.beds),
    bathrooms: numberValue(row.bathrooms ?? row.bath ?? row.baths),
    interiorSqft: numberValue(row.interiorSqft ?? row.intSqft ?? row.intSf ?? row.internalSqft),
    exteriorSqft: numberValue(row.exteriorSqft ?? row.extSqft ?? row.extSf ?? row.outdoorSqft),
    price: moneyValue(row.price),
    ppsf: moneyValue(row.ppsf ?? row.pricePerSqft ?? row.pricePsf),
    notes: stringValue(row.notes ?? row.note),
  };
}

/**
 * Top-level JSON shape shared by every broker comp model extractor (Gemini PDF
 * vision and OpenAI spreadsheet text). Both prompts must reference this exact
 * shape so brokerCompItemsFromParsedJson yields identical item payloads and
 * downstream merge/review/promote code stays provider-agnostic.
 */
export const BROKER_COMP_EXTRACTION_JSON_SHAPE = `{
  "subject": {
    "address": string|null,
    "projectedSellout": number|null,
    "averagePpsf": number|null,
    "unitPricingRows": [
      {"unitLabel": string|null, "bedrooms": number|null, "bathrooms": number|null, "interiorSqft": number|null, "exteriorSqft": number|null, "price": number|null, "ppsf": number|null, "notes": string|null}
    ],
    "pageNumber": number|null
  },
  "comparables": [
    {
      "propertyName": string|null,
      "address": string|null,
      "neighborhood": string|null,
      "developer": string|null,
      "architect": string|null,
      "designer": string|null,
      "yearCompleted": number|null,
      "floors": number|null,
      "units": number|null,
      "salesBegan": string|null,
      "percentSold": number|null,
      "averageUnitSqft": number|null,
      "askingPpsf": number|null,
      "soldPpsf": number|null,
      "priceRange": string|null,
      "salePrice": number|null,
      "saleDate": string|null,
      "capRatePct": number|null,
      "noi": number|null,
      "pricePerUnit": number|null,
      "buildingSqft": number|null,
      "propertyType": string|null,
      "bedroomBreakdown": [
        {"bedroomType": string|null, "bedrooms": number|null, "count": number|null, "avgSizeSqft": number|null, "avgAskingPpsf": number|null, "avgSoldPpsf": number|null, "avgCommonChargesMonthly": number|null, "priceRange": string|null}
      ],
      "pageNumber": number|null
    }
  ],
  "pricingOpinions": [{"amount": number|null, "source": string|null, "note": string|null, "pageNumber": number|null}],
  "missingDataFlags": [{"field": string, "label": string|null, "severity": "info"|"warning"|"error", "message": string|null, "source": string|null}],
  "marketTakeaways": string[],
  "sourceCoverage": {"usedPdfGraphics": boolean, "imageOnlyPagesRead": number|null, "coverageGaps": string[]}
}`;

/** Extraction rules shared by the Gemini PDF and OpenAI spreadsheet broker comp prompts. */
export const BROKER_COMP_EXTRACTION_RULES = `- Preserve exact values from the source document. Do not invent sale prices, cap rates, NOI, expenses, or rent data when absent.
- Convert dollar values, percentages, square feet, and monthly common charges to numbers where possible.
- INVESTMENT-SALE COMPS ARE TOP PRIORITY: for each comparable in a sale-comp grid or profile, extract salePrice, saleDate, capRatePct, noi, pricePerUnit, buildingSqft, and propertyType whenever they appear. capRatePct is a percentage number (e.g. 5.25 for a 5.25% cap rate, never 0.0525).
- If a comparable shows only $/SF pricing with NO cap rate, still extract it, leave capRatePct null, and add a missingDataFlags entry {"field": "capRate", "severity": "warning"} for that comp.
- For condo/new-development packages, asking PPSF, sold PPSF, percent sold, price range, and bedroom mix are high-priority.
- Keep comps separated by bedroom type so a 1-bed row can be compared with other 1-bed rows, etc.
- If cap rate, NOI, sale comp, or rent/expense data is not present, add a missingDataFlags entry rather than guessing.`;

function pageRefsFromRecord(record: JsonRecord, fallbackPage: number): Array<{ pageNumber: number; label: string | null }> {
  const refs = recordArray(record.pageRefs ?? record.page_refs);
  if (refs.length > 0) {
    return refs.flatMap((ref) => {
      const pageNumber = numberValue(ref.pageNumber ?? ref.page ?? ref.sourcePage);
      if (pageNumber == null) return [];
      const label = stringValue(ref.label ?? ref.sourceTableOrSection ?? ref.source_table_or_section ?? ref.excerpt);
      return [{ pageNumber, label: label ?? `Page ${pageNumber}` }];
    });
  }
  const pageNumbers = Array.isArray(record.sourcePageNumbers)
    ? record.sourcePageNumbers
    : Array.isArray(record.pageNumbers)
      ? record.pageNumbers
      : null;
  if (pageNumbers?.length) {
    return pageNumbers.flatMap((entry) => {
      const pageNumber = numberValue(entry);
      return pageNumber == null ? [] : [{ pageNumber, label: `Page ${pageNumber}` }];
    });
  }
  const pageNumber = numberValue(record.pageNumber ?? record.page ?? record.sourcePage) ?? fallbackPage;
  return [{ pageNumber, label: stringValue(record.sourceTableOrSection ?? record.sourceExcerpt) ?? `Page ${pageNumber}` }];
}

function normalizeCompPayload(comp: JsonRecord, sourceType: string): JsonRecord {
  const priceRange = moneyRange(comp.priceRange ?? comp.range, comp.priceRangeLow ?? comp.lowPrice, comp.priceRangeHigh ?? comp.highPrice);
  const askingPpsf = moneyValue(comp.askingPpsf ?? comp.averageAskingPpsf ?? comp.avgAskingPpsf);
  const soldPpsf = moneyValue(comp.soldPpsf ?? comp.averageSoldPpsf ?? comp.avgSoldPpsf);
  const averageUnitSqft = numberValue(comp.averageUnitSqft ?? comp.averageUnitSf ?? comp.avgUnitSqft ?? comp.avgUnitSf);
  const bedroomBreakdown = recordArray(comp.bedroomBreakdown ?? comp.unitBreakdown ?? comp.bedroomMix)
    .map(normalizeBedroomRow)
    .filter((row) => stringValue(row.bedroomType) || row.count != null);
  const units = numberValue(comp.units ?? comp.unitCount);
  const capRatePct = percentValue(comp.capRatePct ?? comp.capRate ?? comp.cap_rate);
  const noi = moneyValue(comp.noi ?? comp.netOperatingIncome ?? comp.net_operating_income);
  const salePrice = moneyValue(comp.salePrice ?? comp.soldPrice ?? comp.closingPrice ?? comp.sale_price);
  const saleDate = stringValue(comp.saleDate ?? comp.closingDate ?? comp.soldDate ?? comp.sale_date);
  const buildingSqft = numberValue(comp.buildingSqft ?? comp.grossSqft ?? comp.gsf ?? comp.building_sf);
  const salePsf =
    moneyValue(comp.salePsf ?? comp.pricePsf ?? comp.price_psf) ??
    (salePrice != null && buildingSqft != null && buildingSqft > 0 ? Math.round(salePrice / buildingSqft) : null);
  const pricePerUnit =
    moneyValue(comp.pricePerUnit ?? comp.price_per_unit) ??
    (salePrice != null && units != null && units > 0 ? Math.round(salePrice / units) : null);
  const pricePerSqft = salePsf ?? soldPpsf ?? askingPpsf;
  const psfOnly = capRatePct == null && pricePerSqft != null;
  return {
    propertyName: stringValue(comp.propertyName ?? comp.projectName ?? comp.name),
    address: stringValue(comp.address ?? comp.propertyAddress),
    neighborhood: stringValue(comp.neighborhood ?? comp.submarket),
    developer: stringValue(comp.developer),
    architect: stringValue(comp.architect),
    designer: stringValue(comp.designer),
    yearCompleted: numberValue(comp.yearCompleted ?? comp.completedYear),
    floors: numberValue(comp.floors ?? comp.floorCount),
    units,
    salesBegan: stringValue(comp.salesBegan ?? comp.salesStart),
    percentSoldPct: percentValue(comp.percentSold ?? comp.percentSoldPct),
    averageUnitSqft,
    averageUnitSf: averageUnitSqft,
    askingPpsf,
    soldPpsf,
    pricePerSqft,
    salePsf,
    capRatePct,
    noi,
    salePrice,
    saleDate,
    pricePerUnit,
    buildingSqft,
    propertyType: stringValue(comp.propertyType ?? comp.assetType),
    psfOnly,
    averageAskingUnitPrice:
      averageUnitSqft != null && askingPpsf != null
        ? Math.round(averageUnitSqft * askingPpsf)
        : null,
    priceRange: priceRange.label,
    priceRangeLow: priceRange.low,
    priceRangeHigh: priceRange.high,
    bedroomTypes: bedroomBreakdown.map((row) => row.bedroomType).filter(Boolean),
    bedroomBreakdown,
    packageFlavor: capRatePct != null || salePrice != null || noi != null ? "investment_sale" : "pricing_sellout",
    sourceType,
  };
}

function normalizeMarketCompItemType(value: unknown): BrokerCompItemType {
  const raw = stringValue(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "lease_comp") return "lease_comp";
  if (raw === "rent_comp") return "rent_roll_row";
  if (raw === "expense_comp") return "expense_row";
  if (raw === "pricing_opinion") return "pricing_opinion";
  if (raw === "subject_projected_pricing") return "subject_projected_pricing";
  if (raw === "development_comp") return "development_comp";
  if (raw === "conversion_comp") return "conversion_comp";
  if (raw === "retail_sale") return "retail_sale";
  if (raw === "portfolio_sale") return "portfolio_sale";
  if (raw === "recapitalization") return "recapitalization";
  if (raw === "secondary_analysis") return "secondary_analysis";
  if (raw === "distressed_sale") return "distressed_sale";
  if (raw === "sale_comp") return "sale_comp";
  return "sale_comp";
}

function marketCompRowId(row: JsonRecord, index: number): string {
  const explicit = stringValue(row.marketCompRowId ?? row.id ?? row.rowId);
  if (explicit) return explicit;
  const address = stringValue(row.normalizedAddress ?? row.address ?? row.propertyName)?.toLowerCase() ?? "unknown";
  const date = stringValue(row.saleDate ?? row.leaseDate ?? row.compDate ?? row.asOfDate) ?? "no-date";
  return `market-comp-${index + 1}-${address.replace(/[^a-z0-9]+/g, "-")}-${date.replace(/[^a-z0-9]+/gi, "-")}`;
}

function normalizeMarketCompRow(row: JsonRecord, index: number): JsonRecord {
  const compType = stringValue(row.compType ?? row.itemType) ?? "sale_comp";
  const sourcePageNumbers = Array.isArray(row.sourcePageNumbers)
    ? row.sourcePageNumbers.flatMap((entry) => {
        const parsed = numberValue(entry);
        return parsed == null ? [] : [parsed];
      })
    : pageRefsFromRecord(row, 1).map((ref) => ref.pageNumber);
  const missingFields = Array.isArray(row.missingFields)
    ? row.missingFields
    : recordArray(row.missingDataFlags).map((flag) => flag.field).filter(Boolean);
  return {
    ...row,
    marketCompRowId: marketCompRowId(row, index),
    routeTo: "market_comps_section",
    rowStatus: stringValue(row.rowStatus) ?? "candidate",
    reviewStatus: "pending",
    selectionDecision: "watch",
    humanOverride: null,
    compType,
    sourcePageNumbers,
    missingFields,
    sourceType: "gemini_market_doc_v3",
    schemaVersion: "market_doc_extraction_v3",
  };
}

function marketCompItemsFromParsedJson(parsed: JsonRecord): BrokerCompExtractedItemInput[] {
  const rows = recordArray(parsed.marketCompsTableRows).map(normalizeMarketCompRow);
  return rows.map((row) => {
    const itemType = normalizeMarketCompItemType(row.compType);
    const includeRationale = stringValue(row.includeRationale);
    const notComparableReasons = Array.isArray(row.notComparableReasons)
      ? row.notComparableReasons.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    return {
      itemType,
      rawPayload: row,
      normalizedPayload: row,
      pageRefs: pageRefsFromRecord(row, 1),
      confidence: numberValue(row.confidence) ?? 0.72,
      reviewStatus: "pending",
      selectionDecision: "watch",
      includeInDossier: false,
      analystNote: includeRationale ?? (notComparableReasons.length ? notComparableReasons.join("; ") : null),
    };
  });
}

function marketMetricItemsFromParsedJson(parsed: JsonRecord): BrokerCompExtractedItemInput[] {
  return recordArray(parsed.marketMetrics).map((metric, index) => ({
    itemType: "market_metric_snapshot",
    rawPayload: metric,
    normalizedPayload: {
      ...metric,
      sourceType: "gemini_market_doc_v3",
      schemaVersion: "market_doc_extraction_v3",
    },
    pageRefs: pageRefsFromRecord(metric, 1),
    confidence: numberValue(metric.confidence) ?? 0.7,
    reviewStatus: "pending",
    selectionDecision: "watch",
    includeInDossier: false,
    analystNote: stringValue(metric.metricName) ?? `Market metric ${index + 1}`,
  }));
}

function marketSignalItemsFromParsedJson(parsed: JsonRecord): BrokerCompExtractedItemInput[] {
  const signalRows = [
    ...recordArray(parsed.marketSignals),
    ...recordArray(parsed.regulatorySignals),
    ...recordArray(parsed.supplyDemandSignals),
    ...recordArray(parsed.capitalMarketsSignals),
  ];
  return signalRows.map((signal, index) => ({
    itemType: "market_signal",
    rawPayload: signal,
    normalizedPayload: {
      ...signal,
      sourceType: "gemini_market_doc_v3",
      schemaVersion: "market_doc_extraction_v3",
    },
    pageRefs: pageRefsFromRecord(signal, 1),
    confidence: numberValue(signal.confidence) ?? 0.65,
    reviewStatus: "pending",
    selectionDecision: "watch",
    includeInDossier: false,
    analystNote: stringValue(signal.summary) ?? stringValue(signal.analystImplication) ?? `Market signal ${index + 1}`,
  }));
}

function secondaryAnalysisItemsFromParsedJson(parsed: JsonRecord): BrokerCompExtractedItemInput[] {
  return recordArray(parsed.propertyLevelComps)
    .filter((row) => stringValue(row.itemType) === "secondary_analysis")
    .map((row, index) => ({
      itemType: "secondary_analysis",
      rawPayload: row,
      normalizedPayload: {
        ...row,
        sourceType: "gemini_market_doc_v3",
        schemaVersion: "market_doc_extraction_v3",
      },
      pageRefs: pageRefsFromRecord(row, 1),
      confidence: numberValue(row.confidence) ?? 0.65,
      reviewStatus: "pending",
      selectionDecision: "watch",
      includeInDossier: false,
      analystNote: stringValue(row.includeRationale) ?? stringValue(row.summary) ?? `Secondary analysis ${index + 1}`,
    }));
}

export function brokerCompItemsFromParsedJson(
  parsed: JsonRecord,
  sourceType: string
): BrokerCompExtractedItemInput[] {
  if (parsed.schemaVersion === "market_doc_extraction_v3" || Array.isArray(parsed.marketCompsTableRows)) {
    const items = [
      ...marketCompItemsFromParsedJson(parsed),
      ...marketMetricItemsFromParsedJson(parsed),
      ...marketSignalItemsFromParsedJson(parsed),
      ...secondaryAnalysisItemsFromParsedJson(parsed),
    ];
    if (items.length > 0) return items;
  }

  const items: BrokerCompExtractedItemInput[] = [];
  const subject = recordValue(parsed.subject);
  if (subject) {
    const unitRows = recordArray(subject.unitPricingRows ?? subject.units ?? subject.projectedPricingRows)
      .map(normalizeSubjectUnitRow)
      .filter((row) => row.price != null || row.ppsf != null || row.unitLabel != null);
    const projectedSellout = moneyValue(subject.projectedSellout ?? subject.totalSellout ?? subject.totalPrice);
    const averagePpsf = moneyValue(subject.averagePpsf ?? subject.avgPpsf ?? subject.ppsf);
    if (unitRows.length > 0 || projectedSellout != null || averagePpsf != null) {
      const pageNumber = numberValue(subject.pageNumber ?? subject.page) ?? 1;
      items.push({
        itemType: "subject_projected_pricing",
        rawPayload: subject,
        normalizedPayload: {
          address: stringValue(subject.address),
          amount: projectedSellout,
          price: projectedSellout,
          projectedSellout,
          pricePerSqft: averagePpsf,
          unitPricingRows: unitRows,
          sourceType,
          packageFlavor: "projected_pricing",
          note: "Subject projected pricing extracted from broker market analysis PDF.",
        },
        pageRefs: [{ pageNumber, label: `Page ${pageNumber}` }],
        confidence: 0.82,
        reviewStatus: "pending",
        selectionDecision: "watch",
        includeInDossier: false,
      });
    }
  }

  for (const comp of recordArray(parsed.comparables ?? parsed.comps ?? parsed.projects)) {
    const normalized = normalizeCompPayload(comp, sourceType);
    const pageRefs = pageRefsFromRecord(comp, 1);
    const isSaleComp = normalized.capRatePct != null || normalized.salePrice != null || normalized.noi != null;
    items.push({
      itemType: isSaleComp ? "sale_comp" : "pricing_comp",
      rawPayload: comp,
      normalizedPayload: normalized,
      pageRefs,
      confidence: 0.82,
      reviewStatus: "pending",
      selectionDecision: "watch",
      includeInDossier: false,
    });

    const bedroomBreakdown = recordArray(normalized.bedroomBreakdown);
    for (const [index, row] of bedroomBreakdown.entries()) {
      items.push({
        itemType: "unit_breakdown_row",
        rawPayload: { ...row, sourceProperty: normalized.propertyName ?? normalized.address ?? null },
        normalizedPayload: {
          ...row,
          propertyName: normalized.propertyName ?? null,
          address: normalized.address ?? null,
          neighborhood: normalized.neighborhood ?? null,
          units: normalized.units ?? null,
          percentSoldPct: normalized.percentSoldPct ?? null,
          compAskingPpsf: normalized.askingPpsf ?? null,
          compSoldPpsf: normalized.soldPpsf ?? null,
          compAverageUnitSqft: normalized.averageUnitSqft ?? null,
          packageFlavor: "pricing_sellout",
          sourceType,
        },
        pageRefs: [{ ...pageRefs[0], label: `${pageRefs[0]?.label ?? "Page"} / Bedroom row ${index + 1}` }],
        confidence: 0.84,
        reviewStatus: "pending",
        selectionDecision: "watch",
        includeInDossier: false,
      });
    }
  }

  for (const opinion of recordArray(parsed.pricingOpinions ?? parsed.whisperPrices)) {
    const amount = moneyValue(opinion.amount ?? opinion.price ?? opinion.value);
    if (amount == null) continue;
    const pageRefs = pageRefsFromRecord(opinion, 1);
    items.push({
      itemType: "pricing_opinion",
      rawPayload: opinion,
      normalizedPayload: {
        amount,
        source: stringValue(opinion.source) ?? "Broker package",
        sourceType,
        note: stringValue(opinion.note ?? opinion.notes),
      },
      pageRefs,
      confidence: 0.75,
      reviewStatus: "pending",
      selectionDecision: "watch",
      includeInDossier: false,
    });
  }

  const takeaways = Array.isArray(parsed.marketTakeaways)
    ? parsed.marketTakeaways.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if (takeaways.length > 0) {
    items.push({
      itemType: "broker_note",
      rawPayload: { marketTakeaways: takeaways },
      normalizedPayload: {
        note: takeaways.join("\n"),
        marketTakeaways: takeaways,
        missingDataFlags: recordArray(parsed.missingDataFlags),
      },
      pageRefs: [{ pageNumber: 1, label: "Package" }],
      confidence: 0.7,
      reviewStatus: "pending",
      selectionDecision: "watch",
      includeInDossier: false,
    });
  }

  return items;
}

export function itemsFromParsedJson(parsed: JsonRecord): BrokerCompExtractedItemInput[] {
  return brokerCompItemsFromParsedJson(parsed, "gemini_pdf");
}

export async function extractBrokerCompPackageFromGeminiPdf(
  params: GeminiBrokerCompExtractionParams
): Promise<GeminiBrokerCompExtractionResult | null> {
  const apiKey = getGeminiApiKey();
  const model = resolveGeminiBrokerCompModel();
  if (!apiKey) return null;
  if (!isPdfFilename(params.filename)) return null;
  const maxBytes = getGeminiBrokerCompInlineMaxBytes();
  if (params.buffer.length > maxBytes) {
    console.warn("[extractBrokerCompPackageFromGeminiPdf] PDF too large for inline Gemini broker comp extraction.", {
      filename: params.filename,
      sizeBytes: params.buffer.length,
      maxBytes,
    });
    return null;
  }

  const queuedAt = Date.now();
  const pendingBeforeQueue = getSharedGeminiOmRequestQueue().getPendingCount();
  return runWithGeminiOmRequestQueue(async () => {
    const prompt = buildGeminiMarketExtractionPrompt(params);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const timeoutMs = getGeminiBrokerCompTimeoutMs();
    const response = await postGeminiGenerateContent({
      url,
      apiKey,
      timeoutMs,
      payload: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: params.buffer.toString("base64"),
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      console.warn("[extractBrokerCompPackageFromGeminiPdf] Gemini broker comp call failed.", {
        model,
        status: response.status,
        bodyPreview: response.body.slice(0, 400),
      });
      return null;
    }

    let data: GeminiGenerateContentResponse;
    try {
      data = JSON.parse(response.body) as GeminiGenerateContentResponse;
    } catch (error) {
      console.warn("[extractBrokerCompPackageFromGeminiPdf] Failed to parse Gemini response JSON.", {
        model,
        error: error instanceof Error ? error.message : String(error),
        bodyPreview: response.body.slice(0, 400),
      });
      return null;
    }
    if (data.promptFeedback?.blockReason) {
      console.warn("[extractBrokerCompPackageFromGeminiPdf] Gemini blocked broker comp extraction.", {
        model,
        blockReason: data.promptFeedback.blockReason,
      });
      return null;
    }

    const rawOutput = getResponseText(data);
    const parsed = parseCompletionJsonContent(rawOutput);
    const finishReason = Array.isArray(data.candidates) && typeof data.candidates[0]?.finishReason === "string"
      ? data.candidates[0].finishReason
      : null;
    if (!parsed) {
      console.warn("[extractBrokerCompPackageFromGeminiPdf] Gemini returned malformed broker comp JSON.", {
        model,
        finishReason,
        rawOutputPreview: rawOutput?.slice(0, 400) ?? null,
      });
      return null;
    }

    const extractedItems = itemsFromParsedJson(parsed);
    console.info("[extractBrokerCompPackageFromGeminiPdf] Gemini broker comp extraction completed.", {
      model,
      filename: params.filename,
      itemCount: extractedItems.length,
      queueWaitMs: Date.now() - queuedAt,
      queuedBehind: pendingBeforeQueue,
      promptTokenCount: data.usageMetadata?.promptTokenCount ?? null,
      candidatesTokenCount: data.usageMetadata?.candidatesTokenCount ?? null,
      totalTokenCount: data.usageMetadata?.totalTokenCount ?? null,
    });

    const takeaways = Array.isArray(parsed.marketTakeaways)
      ? parsed.marketTakeaways.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    return {
      extractedItems,
      packageMeta: {
        provider: "gemini",
        model,
        promptVersion: MARKET_PROMPT_V3_VERSION,
        schemaVersion: stringValue(parsed.schemaVersion) ?? "market_doc_extraction_v3",
        extractionMethod: "pdf_vision",
        marketDocExtraction: parsed,
        sourceDoc: recordValue(parsed.sourceDoc),
        sourceCoverage: recordValue(parsed.sourceCoverage),
        missingDataFlags: recordArray(parsed.missingDataFlags),
        marketCompsTableRows: recordArray(parsed.marketCompsTableRows),
        marketMetrics: recordArray(parsed.marketMetrics),
        marketSignals: recordArray(parsed.marketSignals),
      },
      summary: takeaways.length > 0 ? takeaways.join(" ") : null,
      rawOutput,
      finishReason,
      model,
    };
  });
}
