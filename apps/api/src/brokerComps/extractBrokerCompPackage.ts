import type { BrokerCompPackageType, BrokerCompPageType } from "@re-sourcing/contracts";
import type {
  BrokerCompExtractedItemInput,
  BrokerCompPageInput,
} from "../brokerComp/service.js";
import {
  extractTextMetadataFromBuffer,
  type ExtractedTextMetadata,
} from "../upload/extractTextFromUploadedFile.js";
import { extractBrokerCompPackageFromGeminiPdf } from "./extractBrokerCompPackageFromGemini.js";

const PARSER_VERSION = "broker-comp-mvp-v1";

type JsonRecord = Record<string, unknown>;

const PROFILE_LABELS = [
  "ADDRESS",
  "NEIGHBORHOOD",
  "DEVELOPER",
  "ARCHITECT",
  "DESIGNER",
  "YEAR COMPLETED",
  "# OF FLOORS",
  "# OF UNITS",
  "SALES BEGAN",
  "PERCENT SOLD",
  "AVG. UNIT SF",
  "ASKING PPSF",
  "SOLD PPSF",
  "PRICE RANGE",
] as const;

export interface BrokerCompExtractionDraft {
  packageType: BrokerCompPackageType;
  pages: BrokerCompPageInput[];
  extractedItems: BrokerCompExtractedItemInput[];
  packageMeta: JsonRecord;
  textChars: number;
  pageCount: number | null;
  parserVersion: string;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function normalizeNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(compactNumericText(value).replace(/[$,%\s,]/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = compactNumericText(value).toLowerCase().replace(/\/mo(?:nth)?\b/g, "");
  const multiplier = /\d(?:\.\d+)?m\b/.test(trimmed) ? 1_000_000 : /\d(?:\.\d+)?k\b/.test(trimmed) ? 1_000 : 1;
  const parsed = normalizeNumber(trimmed.replace(/[mk]\b/g, ""));
  return parsed == null ? null : parsed * multiplier;
}

function parseMoneyRange(value: string | null | undefined): { low: number | null; high: number | null; label: string | null } {
  const label = compactNumericText(value);
  if (!label || label === "-") return { low: null, high: null, label: null };
  const parts = label.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { low: null, high: null, label };
  if (parts.length === 1) {
    const amount = normalizeMoney(parts[0]);
    return { low: amount, high: amount, label };
  }
  const low = normalizeMoney(parts[0]);
  const inheritedSuffix = parts[0]?.match(/[mk]\b/i)?.[0] ?? "";
  const high = normalizeMoney(/[mk]\b/i.test(parts[1] ?? "") ? parts[1] : `${parts[1]}${inheritedSuffix}`);
  return { low, high, label };
}

function inferPackageType(filename: string, text: string): BrokerCompPackageType {
  const haystack = `${filename} ${text.slice(0, 20_000)}`.toLowerCase();
  if (/rent comp|rental comp/.test(haystack)) return "rent_comps";
  if (/lease comp/.test(haystack)) return "rent_comps";
  if (/expense comp|opex comp|operating expense/.test(haystack)) return "expense_comps";
  if (/projected pricing|sellout|asking ppsf|sold ppsf/.test(haystack)) return "pricing_sellout";
  if (/cap rate|noi|investment sale|sale comp|whisper/.test(haystack)) {
    return "sale_comps";
  }
  if (/market analysis|comp/.test(haystack)) return "market_analysis";
  return "other";
}

function classifyPage(textSample: string, pageNumber: number): { pageType: BrokerCompPageType; confidence: number } {
  const text = textSample.toLowerCase();
  if (pageNumber === 1 && /market analysis|offering|cover/.test(text)) return { pageType: "cover", confidence: 0.8 };
  if (/projected pricing|sellout/.test(text)) return { pageType: "projected_pricing", confidence: 0.85 };
  if (/unit breakdown|avg\.?\s+asking ppsf|avg\.?\s+sold ppsf|developer:|architect:/.test(text)) {
    return { pageType: "comp_profile", confidence: 0.82 };
  }
  if (/comps proximity|proximity/.test(text)) return { pageType: "proximity_map", confidence: 0.75 };
  if (/pipeline/.test(text)) return { pageType: "pipeline", confidence: 0.7 };
  if (/cap rate|noi|sale price/.test(text)) return { pageType: "sale_comp_grid", confidence: 0.65 };
  if (/rent roll|tenant schedule|lease schedule/.test(text)) return { pageType: "rent_roll_grid", confidence: 0.65 };
  if (/expense|opex|operating statement/.test(text)) return { pageType: "expense_grid", confidence: 0.65 };
  return { pageType: "other", confidence: textSample.trim().length > 0 ? 0.35 : 0.15 };
}

function normalizedLabel(value: string): string {
  return cleanText(value)
    .replace(/:$/, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function findLabelIndex(lines: string[], label: string): number {
  const target = normalizedLabel(label);
  return lines.findIndex((line) => normalizedLabel(line) === target);
}

function normalizeUnitType(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = cleanText(value).toUpperCase();
  const bedMatch = compact.match(/^(\d+)\s*BED(?:ROOM)?S?$/i);
  if (bedMatch?.[1]) return `${bedMatch[1]} BED`;
  if (/^STUDIO$/i.test(compact)) return "STUDIO";
  if (/^PENTHOUSE$/i.test(compact)) return "PENTHOUSE";
  if (/^TOWN\s*HOME$|^TOWNHOME$/i.test(compact)) return "TOWNHOME";
  return compact || null;
}

function bedroomsFromUnitType(value: string | null | undefined): number | null {
  const normalized = normalizeUnitType(value);
  if (!normalized) return null;
  if (normalized === "STUDIO") return 0;
  const match = normalized.match(/^(\d+)\s*BED$/i);
  return match?.[1] ? Number(match[1]) : null;
}

function extractProfileValueMap(lines: string[]): Record<(typeof PROFILE_LABELS)[number], string | null> | null {
  const labelStart = findLabelIndex(lines, "ADDRESS");
  if (labelStart < 0) return null;
  const valuesStart = labelStart - PROFILE_LABELS.length;
  if (valuesStart < 1) return null;
  const values = lines.slice(valuesStart, labelStart);
  const result = {} as Record<(typeof PROFILE_LABELS)[number], string | null>;
  PROFILE_LABELS.forEach((label, index) => {
    result[label] = values[index] ? cleanText(values[index]) : null;
  });
  return result;
}

function valuesBetweenLabels(lines: string[], startLabel: string, endLabel: string): string[] {
  const start = findLabelIndex(lines, startLabel);
  const end = findLabelIndex(lines, endLabel);
  if (start < 0 || end < 0 || end <= start) return [];
  return lines.slice(start + 1, end).map(compactNumericText).filter(Boolean);
}

function parseUnitTypeAndCountSegment(lines: string[]): { unitTypes: string[]; counts: Array<number | null> } {
  const unitTypes: string[] = [];
  const counts: Array<number | null> = [];
  for (const rawLine of lines) {
    const line = compactNumericText(rawLine);
    const inline = line.match(/^((?:\d+\s*BED(?:ROOM)?S?)|STUDIO|PENTHOUSE|TOWN\s*HOME|TOWNHOME)\s*(\d+)?$/i);
    if (inline?.[1]) {
      const unitType = normalizeUnitType(inline[1]);
      if (unitType) unitTypes.push(unitType);
      if (inline[2]) counts.push(normalizeNumber(inline[2]));
      continue;
    }
    if (/^\d+$/.test(line)) counts.push(normalizeNumber(line));
  }
  return { unitTypes, counts };
}

function parseBedroomBreakdown(lines: string[]): JsonRecord[] {
  const unitTypeIndex = findLabelIndex(lines, "UNIT TYPE");
  const countIndex = findLabelIndex(lines, "COUNT");
  if (unitTypeIndex < 0 || countIndex < 0 || countIndex <= unitTypeIndex) return [];

  const { unitTypes, counts } = parseUnitTypeAndCountSegment(lines.slice(unitTypeIndex + 1, countIndex));
  if (unitTypes.length === 0) return [];

  const sizes = valuesBetweenLabels(lines, "COUNT", "AVG. SIZE");
  const askingPpsf = valuesBetweenLabels(lines, "AVG. SIZE", "AVG. ASKING PPSF");
  const soldPpsf = valuesBetweenLabels(lines, "AVG. ASKING PPSF", "AVG. SOLD PPSF");
  const averageCc = valuesBetweenLabels(lines, "AVG. SOLD PPSF", "AVG. CC");
  const ranges = valuesBetweenLabels(lines, "AVG. CC", "RANGE");

  return unitTypes.map((unitType, index) => {
    const priceRange = parseMoneyRange(ranges[index]);
    return {
      unitType,
      bedroomType: unitType,
      bedrooms: bedroomsFromUnitType(unitType),
      count: counts[index] ?? null,
      avgSizeSqft: normalizeNumber(sizes[index]),
      avgAskingPpsf: normalizeMoney(askingPpsf[index]),
      avgSoldPpsf: normalizeMoney(soldPpsf[index]),
      avgCommonChargesMonthly: normalizeMoney(averageCc[index]),
      priceRange: priceRange.label,
      priceRangeLow: priceRange.low,
      priceRangeHigh: priceRange.high,
    };
  });
}

function missingDataFlags(fields: string[], source: string): JsonRecord[] {
  return fields.map((field) => ({
    field,
    label: field,
    severity: "warning",
    message: `${field} was not available in this broker comp package.`,
    source,
    resolved: false,
  }));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedPayload(item: BrokerCompExtractedItemInput): JsonRecord {
  return item.normalizedPayload && typeof item.normalizedPayload === "object" && !Array.isArray(item.normalizedPayload)
    ? item.normalizedPayload
    : {};
}

function extractedItemDedupeKey(item: BrokerCompExtractedItemInput): string | null {
  const data = normalizedPayload(item);
  if (item.itemType === "subject_projected_pricing") return "subject_projected_pricing";
  if (item.itemType === "pricing_comp" || item.itemType === "sale_comp") {
    const address = stringValue(data.address ?? data.propertyAddress);
    return address ? `${item.itemType}:${address.toLowerCase()}` : null;
  }
  if (item.itemType === "unit_breakdown_row") {
    const address = stringValue(data.address ?? data.propertyAddress);
    const bedroomType = stringValue(data.bedroomType ?? data.unitType);
    return address && bedroomType ? `unit_breakdown_row:${address.toLowerCase()}:${bedroomType.toLowerCase()}` : null;
  }
  if (item.itemType === "pricing_opinion") {
    const amount = data.amount ?? data.price;
    const note = stringValue(data.note ?? data.source);
    return amount != null ? `pricing_opinion:${amount}:${note ?? ""}` : null;
  }
  return null;
}

function mergeExtractedItems(
  primaryItems: BrokerCompExtractedItemInput[],
  supplementalItems: BrokerCompExtractedItemInput[]
): BrokerCompExtractedItemInput[] {
  const merged = [...primaryItems];
  const seen = new Set<string>();
  for (const item of primaryItems) {
    const key = extractedItemDedupeKey(item);
    if (key) seen.add(key);
  }
  for (const item of supplementalItems) {
    const key = extractedItemDedupeKey(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(item);
  }
  return merged;
}

function extractCompProfile(pageNumber: number, textSample: string): { raw: JsonRecord; normalized: JsonRecord } | null {
  if (!/unit breakdown|asking ppsf|sold ppsf|developer:/i.test(textSample)) return null;
  const lines = textSample
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const values = extractProfileValueMap(lines);
  if (!values) return null;
  const priceRange = parseMoneyRange(values["PRICE RANGE"]);
  const askingPpsf = normalizeMoney(values["ASKING PPSF"]);
  const soldPpsf = normalizeMoney(values["SOLD PPSF"]);
  const averageUnitSqft = normalizeNumber(values["AVG. UNIT SF"]);
  const bedroomBreakdown = parseBedroomBreakdown(lines);
  const percentSoldPct = normalizeNumber(values["PERCENT SOLD"]);
  const pricePerSqft = soldPpsf ?? askingPpsf;
  const missing = [
    soldPpsf == null ? "soldPpsf" : null,
    bedroomBreakdown.length === 0 ? "bedroomBreakdown" : null,
    priceRange.low == null && priceRange.high == null ? "priceRange" : null,
    "noi",
    "capRate",
  ].filter((field): field is string => Boolean(field));
  return {
    raw: { textSample, pageNumber },
    normalized: {
      propertyName: lines[0] && !/^\d/.test(lines[0]) ? lines[0] : null,
      address: values.ADDRESS,
      neighborhood: values.NEIGHBORHOOD,
      developer: values.DEVELOPER,
      architect: values.ARCHITECT,
      designer: values.DESIGNER,
      yearCompleted: normalizeNumber(values["YEAR COMPLETED"]),
      floors: normalizeNumber(values["# OF FLOORS"]),
      units: normalizeNumber(values["# OF UNITS"]),
      salesBegan: values["SALES BEGAN"],
      percentSoldPct,
      averageUnitSf: averageUnitSqft,
      averageUnitSqft,
      askingPpsf,
      soldPpsf,
      pricePerSqft,
      averageAskingUnitPrice:
        averageUnitSqft != null && askingPpsf != null
          ? Math.round(averageUnitSqft * askingPpsf)
          : null,
      priceRange: priceRange.label,
      priceRangeLow: priceRange.low,
      priceRangeHigh: priceRange.high,
      bedroomTypes: bedroomBreakdown.map((row) => row.bedroomType).filter(Boolean),
      bedroomBreakdown,
      packageFlavor: "pricing_sellout",
      missingFields: missing,
      missingDataFlags: missingDataFlags(missing, "broker_comp_profile"),
    },
  };
}

function extractProjectedPricing(pageNumber: number, textSample: string): { raw: JsonRecord; normalized: JsonRecord } | null {
  if (!/projected pricing|projected sellout|total projected sellout|sellout/i.test(textSample)) return null;
  const totalMatch =
    textSample.match(/total\s+projected\s+sellout\D{0,20}(\$?\s*\d[\d,.]*(?:\s*[mk])?)/i) ??
    textSample.match(/sellout\D{0,20}(\$?\s*\d[\d,.]*(?:\s*[mk])?)/i);
  const avgPpsfMatch =
    textSample.match(/average\s+ppsf\D{0,20}(\$?\s*\d[\d,.]*)/i) ??
    textSample.match(/avg\.?\s+ppsf\D{0,20}(\$?\s*\d[\d,.]*)/i);
  const projectedSellout = normalizeMoney(totalMatch?.[1]);
  const pricePerSqft = normalizeMoney(avgPpsfMatch?.[1]);
  if (projectedSellout == null && pricePerSqft == null) return null;
  return {
    raw: { textSample, pageNumber },
    normalized: {
      amount: projectedSellout,
      price: projectedSellout,
      projectedSellout,
      pricePerSqft,
      sourceType: "package",
      packageFlavor: "pricing_sellout",
      note: "Projected pricing page detected. Review against source page before treating this as a market signal.",
      missingDataFlags: missingDataFlags(["noi", "capRate", "rentRoll", "expenses"], "projected_pricing"),
    },
  };
}

function extractPricingOpinion(text: string): { raw: JsonRecord; normalized: JsonRecord } | null {
  const match =
    text.match(/whisper\s+(?:price|pricing|number)?\D{0,24}(\$?\s*\d[\d,]*(?:\.\d+)?\s*[mk]?)/i) ??
    text.match(/market\s+(?:is|clears|clearing|pricing)\D{0,32}(\$?\s*\d[\d,]*(?:\.\d+)?\s*[mk]?)/i);
  if (!match?.[1]) return null;
  return {
    raw: { excerpt: cleanText(text.slice(Math.max(0, match.index ?? 0), (match.index ?? 0) + 500)) },
    normalized: {
      amount: normalizeMoney(match[1]),
      sourceType: "package",
      source: "Broker package",
      note: "Extracted as a broker pricing opinion. This is a market signal only, not an underwriting offer input.",
    },
  };
}

function buildPages(metadata: ExtractedTextMetadata, filename: string): BrokerCompPageInput[] {
  const pageMetas = metadata.pages && metadata.pages.length > 0
    ? metadata.pages
    : [{ pageNumber: 1, textSample: metadata.text.slice(0, 2_000), textChars: metadata.text.length, textItems: 0 }];
  return pageMetas.map((page) => {
    const { pageType, confidence } = classifyPage(page.textSample, page.pageNumber);
    return {
      pageNumber: page.pageNumber,
      pageType,
      extractionMethod: filename.toLowerCase().match(/\.(xls|xlsx|csv)$/) ? "spreadsheet" : "text",
      pageRef: `Page ${page.pageNumber}`,
      rawTextExcerpt: page.textSample,
      normalizedPayload: {
        pageType,
        extractionMethod: filename.toLowerCase().match(/\.(xls|xlsx|csv)$/) ? "spreadsheet" : "text",
        textChars: page.textChars,
        textItems: page.textItems,
        imageHeavy: page.textChars < 80 && pageType !== "cover",
      },
      confidence,
      reviewStatus: "accepted",
    };
  });
}

export async function extractBrokerCompPackageDraft(buffer: Buffer, filename: string): Promise<BrokerCompExtractionDraft> {
  const metadata = await extractTextMetadataFromBuffer(buffer, filename);
  const packageType = inferPackageType(filename, metadata.text);
  const pages = buildPages(metadata, filename);
  let extractedItems: BrokerCompExtractedItemInput[] = [];

  for (const page of pages) {
    const pageNumber = page.pageNumber;
    const textSample = page.rawTextExcerpt ?? "";
    const compProfile = extractCompProfile(pageNumber, textSample);
    if (compProfile) {
      extractedItems.push({
        itemType: "pricing_comp",
        rawPayload: compProfile.raw,
        normalizedPayload: compProfile.normalized,
        pageRefs: [{ pageNumber, label: page.pageRef ?? null }],
        confidence: 0.72,
        reviewStatus: "accepted",
      });

      const bedroomBreakdown = Array.isArray(compProfile.normalized.bedroomBreakdown)
        ? compProfile.normalized.bedroomBreakdown
        : [];
      for (const [index, row] of bedroomBreakdown.entries()) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        extractedItems.push({
          itemType: "unit_breakdown_row",
          rawPayload: {
            ...row,
            pageNumber,
            sourceProperty: compProfile.normalized.propertyName ?? compProfile.normalized.address ?? null,
          },
          normalizedPayload: {
            ...row,
            propertyName: compProfile.normalized.propertyName ?? null,
            address: compProfile.normalized.address ?? null,
            neighborhood: compProfile.normalized.neighborhood ?? null,
            units: compProfile.normalized.units ?? null,
            percentSoldPct: compProfile.normalized.percentSoldPct ?? null,
            compAskingPpsf: compProfile.normalized.askingPpsf ?? null,
            compSoldPpsf: compProfile.normalized.soldPpsf ?? null,
            compAverageUnitSqft: compProfile.normalized.averageUnitSqft ?? compProfile.normalized.averageUnitSf ?? null,
            packageFlavor: "pricing_sellout",
            sourceType: "broker_comp_profile",
          },
          pageRefs: [{ pageNumber, label: `${page.pageRef ?? `Page ${pageNumber}`} / Bedroom row ${index + 1}` }],
          confidence: 0.74,
          reviewStatus: "accepted",
        });
      }
    }

    const projected = extractProjectedPricing(pageNumber, textSample);
    if (projected) {
      extractedItems.push({
        itemType: "subject_projected_pricing",
        rawPayload: projected.raw,
        normalizedPayload: projected.normalized,
        pageRefs: [{ pageNumber, label: page.pageRef ?? null }],
        confidence: 0.58,
        reviewStatus: "accepted",
      });
    }
  }

  const pricingOpinion = extractPricingOpinion(metadata.text);
  if (pricingOpinion) {
    extractedItems.push({
      itemType: "pricing_opinion",
      rawPayload: pricingOpinion.raw,
      normalizedPayload: pricingOpinion.normalized,
      pageRefs: [{ pageNumber: 1, label: "Page 1" }],
      confidence: 0.55,
      reviewStatus: "accepted",
    });
  }

  const geminiExtraction = await extractBrokerCompPackageFromGeminiPdf({
    buffer,
    filename,
    textPreview: metadata.text,
    pageCount: metadata.pageCount ?? pages.length,
  }).catch((error) => {
    console.warn("[extractBrokerCompPackageDraft] Gemini broker comp extraction failed.", {
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (geminiExtraction?.extractedItems.length) {
    extractedItems = mergeExtractedItems(extractedItems, geminiExtraction.extractedItems);
  }

  if (extractedItems.length === 0 && metadata.text.trim()) {
    extractedItems.push({
      itemType: "broker_note",
      rawPayload: { textSample: metadata.text.slice(0, 4_000) },
      normalizedPayload: {
        note: "Package text extracted but no structured comp rows were confidently detected. Review manually.",
        packageFlavor: packageType,
        missingDataFlags: missingDataFlags(["structuredComps"], "broker_comp_parser"),
      },
      pageRefs: [{ pageNumber: 1, label: "Page 1" }],
      confidence: 0.25,
      reviewStatus: "accepted",
    });
  }

  // Cap-rate coverage: the whole point of comp packages is cap rates for comp
  // analysis. Flag packages whose comps only carry $/PSF so the analyst knows
  // to push the broker for investment-sale comps.
  const compItems = extractedItems.filter(
    (item) => item.itemType === "sale_comp" || item.itemType === "pricing_comp"
  );
  const compsWithCapRate = compItems.filter((item) => {
    const data = item.normalizedPayload ?? {};
    return data.capRatePct != null;
  }).length;
  const psfOnlyComps = compItems.filter((item) => {
    const data = item.normalizedPayload ?? {};
    return data.capRatePct == null && (data.pricePerSqft != null || data.soldPpsf != null || data.askingPpsf != null);
  }).length;

  return {
    packageType,
    pages,
    extractedItems,
    packageMeta: {
      parserVersion: PARSER_VERSION,
      packageType,
      textChars: metadata.text.length,
      pageCount: metadata.pageCount ?? pages.length,
      extractedItemCount: extractedItems.length,
      compCount: compItems.length,
      compsWithCapRate,
      psfOnlyComps,
      psfOnlyPackage: compItems.length > 0 && compsWithCapRate === 0,
      extractionMode: geminiExtraction ? "hybrid_gemini_text" : filename.toLowerCase().match(/\.(xls|xlsx|csv)$/) ? "spreadsheet" : "text",
      gemini: geminiExtraction
        ? {
            provider: "gemini",
            model: geminiExtraction.model,
            finishReason: geminiExtraction.finishReason,
            itemCount: geminiExtraction.extractedItems.length,
            summary: geminiExtraction.summary,
            ...(geminiExtraction.packageMeta ?? {}),
          }
        : null,
    },
    textChars: metadata.text.length,
    pageCount: metadata.pageCount ?? pages.length,
    parserVersion: PARSER_VERSION,
  };
}
