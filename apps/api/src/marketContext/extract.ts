/**
 * Stage 1b: structured extraction. The model returns {comps, market_stats};
 * code validates every row, normalizes numerics, and injects provenance from
 * the classifier verdict — the extractor can never override source_type.
 */
import type {
  ClassifierConfidence,
  MarketAssetType,
  MarketDocClassification,
  MarketGeoLevel,
  MarketMetricType,
  MarketPriceType,
  MarketProvenance,
  MarketSaleCondition,
} from "@re-sourcing/contracts";
import { MARKET_PROMPT_VERSIONS, buildExtractionPrompt } from "./prompts.js";
import type { MarketLlmRequest, MarketLlmResult, MarketLlmRunner } from "./llmAdapter.js";

/** Comp row as extracted (pre-persistence: no id, provenance injected). */
export interface ExtractedComp {
  address: string;
  neighborhoodRaw: string | null;
  borough: string | null;
  salePrice: number | null;
  priceType: MarketPriceType;
  saleDate: string | null;
  gsf: number | null;
  pricePsf: number | null;
  unitsTotal: number | null;
  unitsResi: number | null;
  pctRentStabilized: number | null;
  capRate: number | null;
  grm: number | null;
  assetType: MarketAssetType | null;
  buyer: string | null;
  seller: string | null;
  saleConditions: MarketSaleCondition[];
  notesShort: string | null;
  cherryPickRisk: boolean;
  isSubjectProperty: boolean;
  confidence: ClassifierConfidence;
  rawText: string | null;
  provenance: MarketProvenance;
}

/** Market stat as extracted (pre-persistence). */
export interface ExtractedStat {
  metric: string;
  metricType: MarketMetricType;
  value: number;
  comparisonPeriod: string | null;
  geoLevel: MarketGeoLevel;
  geoName: string;
  segment: string | null;
  period: string | null;
  provenance: MarketProvenance;
}

export interface ExtractionCoercionResult {
  comps: ExtractedComp[];
  stats: ExtractedStat[];
  flags: string[];
}

const PRICE_TYPES: MarketPriceType[] = ["closed", "asking", "in_contract", "unknown"];
const ASSET_TYPES: MarketAssetType[] = ["multifamily", "mixed-use", "office", "retail", "development", "conversion"];
const GEO_LEVELS: MarketGeoLevel[] = ["address", "neighborhood", "submarket", "borough", "citywide"];
const CONFIDENCES: ClassifierConfidence[] = ["high", "medium", "low"];
const SALE_CONDITIONS: MarketSaleCondition[] = [
  "portfolio_sale",
  "partial_interest",
  "note_sale",
  "ground_lease",
  "distressed",
  "estate_sale",
  "delivered_vacant",
  "1031_exchange",
  "related_party",
];

/** Whitelist + dedupe the model's sale-condition tags; unknown tags are dropped. */
function asSaleConditions(value: unknown): MarketSaleCondition[] {
  if (!Array.isArray(value)) return [];
  const conditions = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is MarketSaleCondition => SALE_CONDITIONS.includes(item as MarketSaleCondition));
  return [...new Set(conditions)];
}

/** GRM sanity window: NYC multifamily prints roughly 5-40x gross; outside that is a misread cell. */
function asGrm(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null || parsed < 1 || parsed > 60) return null;
  return parsed;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Lenient numeric parse: accepts "$11,750,000", "5.82%", 11750000. */
export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,%\s,]/g, "");
    if (!cleaned || /n\/?a/i.test(cleaned)) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Rates are stored as decimals; coerce "5.82" / "5.82%" → 0.0582 without touching real decimals. */
export function asRate(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null) return null;
  if (parsed < 0) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function asIsoDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return direct[0];
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Provenance injected by code into every extracted record. */
export function buildProvenance(
  classification: MarketDocClassification,
  documentId: string,
  page: number | null
): MarketProvenance {
  return {
    source_type: classification.source_type,
    publisher: classification.publisher,
    branded: classification.branded,
    document_class: classification.document_class,
    document_id: documentId,
    report_title: classification.report_title,
    page,
    classifier_confidence: classification.classifier_confidence,
  };
}

function normalizeForSubjectMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Validate + coerce raw extractor output. Drops rows without an address or
 * value, injects provenance per record, and enforces the OM/BOV structural
 * rules in code: non-subject comps inside a deal document carry
 * cherry_pick_risk, and broker asking prices are never recorded as closed.
 */
export function coerceExtraction(
  parsed: Record<string, unknown> | null,
  classification: MarketDocClassification,
  documentId: string
): ExtractionCoercionResult {
  const flags: string[] = [];
  const comps: ExtractedComp[] = [];
  const stats: ExtractedStat[] = [];
  const isDealDocument = classification.document_class === "om" || classification.document_class === "bov";
  const subjectKey = classification.subject_property
    ? normalizeForSubjectMatch(classification.subject_property)
    : null;

  const rawComps = Array.isArray(parsed?.comps) ? (parsed?.comps as unknown[]) : [];
  for (const raw of rawComps) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const address = asString(row.address);
    if (!address) {
      flags.push("dropped comp row without address");
      continue;
    }

    const rawPriceType = asString(row.price_type);
    let priceType = PRICE_TYPES.includes(rawPriceType as MarketPriceType)
      ? (rawPriceType as MarketPriceType)
      : "unknown";
    const rawConfidence = asString(row.confidence);
    const confidence = CONFIDENCES.includes(rawConfidence as ClassifierConfidence)
      ? (rawConfidence as ClassifierConfidence)
      : "medium";

    let isSubjectProperty = row.is_subject_property === true;
    if (subjectKey && normalizeForSubjectMatch(address).includes(subjectKey)) isSubjectProperty = true;

    // Subject assets being marketed have asking prices; never let a deal doc
    // record its own subject as a closed sale (extraction rule 8).
    if (isDealDocument && isSubjectProperty && priceType === "closed") {
      priceType = "asking";
      flags.push(`subject property "${address}" price demoted closed → asking (deal document)`);
    }

    const cherryPickRisk = isDealDocument ? !isSubjectProperty : row.cherry_pick_risk === true;
    const rawAssetType = asString(row.asset_type);
    const page = asNumber(row.page);

    comps.push({
      address,
      neighborhoodRaw: asString(row.neighborhood_raw),
      borough: asString(row.borough),
      salePrice: asNumber(row.sale_price),
      priceType,
      saleDate: asIsoDate(row.sale_date),
      gsf: asNumber(row.gsf),
      pricePsf: asNumber(row.price_psf),
      unitsTotal: asNumber(row.units_total),
      unitsResi: asNumber(row.units_resi),
      pctRentStabilized: asRate(row.pct_rent_stabilized),
      capRate: asRate(row.cap_rate),
      grm: asGrm(row.grm),
      assetType: ASSET_TYPES.includes(rawAssetType as MarketAssetType) ? (rawAssetType as MarketAssetType) : null,
      buyer: asString(row.buyer),
      seller: asString(row.seller),
      saleConditions: asSaleConditions(row.sale_conditions),
      notesShort: asString(row.notes_short),
      cherryPickRisk,
      isSubjectProperty,
      confidence,
      rawText: asString(row.raw_text),
      provenance: buildProvenance(classification, documentId, page == null ? null : Math.round(page)),
    });
  }

  const rawStats = Array.isArray(parsed?.market_stats) ? (parsed?.market_stats as unknown[]) : [];
  for (const raw of rawStats) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const metric = asString(row.metric);
    const geoName = asString(row.geo_name);
    const value = asNumber(row.value);
    if (!metric || !geoName || value == null) {
      flags.push("dropped market stat missing metric/geo_name/value");
      continue;
    }
    const metricType: MarketMetricType = asString(row.metric_type) === "pct_change" ? "pct_change" : "level";
    const rawGeoLevel = asString(row.geo_level);
    const page = asNumber(row.page);
    stats.push({
      metric,
      metricType,
      value,
      comparisonPeriod: asString(row.comparison_period),
      geoLevel: GEO_LEVELS.includes(rawGeoLevel as MarketGeoLevel) ? (rawGeoLevel as MarketGeoLevel) : "submarket",
      geoName,
      segment: asString(row.segment),
      period: asString(row.period),
      provenance: buildProvenance(classification, documentId, page == null ? null : Math.round(page)),
    });
  }

  return { comps, stats, flags };
}

export interface ExtractMarketDocumentResult extends ExtractionCoercionResult {
  llm: MarketLlmResult;
  promptVersion: string;
}

export async function extractMarketDocument(params: {
  pdf: { buffer: Buffer; filename: string };
  documentText: string | null;
  classification: MarketDocClassification;
  documentId: string;
  llm: MarketLlmRunner;
}): Promise<ExtractMarketDocumentResult> {
  const request: MarketLlmRequest = {
    stage: "extract",
    prompt: buildExtractionPrompt({
      documentClass: params.classification.document_class,
      sourceType: params.classification.source_type,
    }),
    pdf: params.pdf,
    documentText: params.documentText,
  };
  const llm = await params.llm(request);
  const coerced = coerceExtraction(llm.parsed, params.classification, params.documentId);
  return { ...coerced, llm, promptVersion: MARKET_PROMPT_VERSIONS.extract };
}
