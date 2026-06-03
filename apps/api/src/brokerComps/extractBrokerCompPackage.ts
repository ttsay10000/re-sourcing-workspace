import type { BrokerCompPackageType, BrokerCompPageType } from "@re-sourcing/contracts";
import type {
  BrokerCompExtractedItemInput,
  BrokerCompPageInput,
} from "../brokerComp/service.js";
import {
  extractTextMetadataFromBuffer,
  type ExtractedTextMetadata,
} from "../upload/extractTextFromUploadedFile.js";

const PARSER_VERSION = "broker-comp-mvp-v1";

type JsonRecord = Record<string, unknown>;

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

function normalizeNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const multiplier = trimmed.includes("m") ? 1_000_000 : trimmed.includes("k") ? 1_000 : 1;
  const parsed = normalizeNumber(trimmed.replace(/[mk]/g, ""));
  return parsed == null ? null : parsed * multiplier;
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

function lineValue(lines: string[], label: string): string | null {
  const normalizedLabel = label.replace(/:$/, "").toUpperCase();
  const exactIndex = lines.findIndex((line) => line.replace(/\s+/g, " ").trim().replace(/:$/, "").toUpperCase() === normalizedLabel);
  if (exactIndex >= 0 && exactIndex > 0) return lines[exactIndex - 1] ?? null;
  const inline = lines.find((line) => line.toUpperCase().startsWith(normalizedLabel));
  if (inline) {
    const [, value] = inline.split(/:\s*/);
    return value?.trim() || null;
  }
  return null;
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

function extractCompProfile(pageNumber: number, textSample: string): { raw: JsonRecord; normalized: JsonRecord } | null {
  if (!/unit breakdown|asking ppsf|sold ppsf|developer:/i.test(textSample)) return null;
  const lines = textSample
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const askingPpsf = normalizeMoney(lineValue(lines, "ASKING PPSF:"));
  const soldPpsf = normalizeMoney(lineValue(lines, "SOLD PPSF:"));
  const missing = [
    soldPpsf == null ? "soldPpsf" : null,
    "noi",
    "capRate",
    "rentRoll",
    "expenses",
  ].filter((field): field is string => Boolean(field));
  return {
    raw: { textSample, pageNumber },
    normalized: {
      propertyName: lines[0] && !/^\d/.test(lines[0]) ? lines[0] : null,
      address: lineValue(lines, "ADDRESS:"),
      neighborhood: lineValue(lines, "NEIGHBORHOOD:"),
      developer: lineValue(lines, "DEVELOPER:"),
      yearCompleted: normalizeNumber(lineValue(lines, "YEAR COMPLETED:")),
      units: normalizeNumber(lineValue(lines, "# OF UNITS:")),
      averageUnitSf: normalizeNumber(lineValue(lines, "AVG. UNIT SF")),
      askingPpsf,
      soldPpsf,
      pricePerSqft: soldPpsf ?? askingPpsf,
      priceRange: lineValue(lines, "PRICE RANGE:"),
      packageFlavor: "pricing_sellout",
      missingFields: missing,
      missingDataFlags: missingDataFlags(missing, "broker_comp_profile"),
    },
  };
}

function extractProjectedPricing(pageNumber: number, textSample: string): { raw: JsonRecord; normalized: JsonRecord } | null {
  if (!/projected pricing|sellout|ppsf/i.test(textSample)) return null;
  const totalMatch =
    textSample.match(/total\s+projected\s+sellout\D{0,20}(\$?\s*\d[\d,.]*(?:\s*[mk])?)/i) ??
    textSample.match(/sellout\D{0,20}(\$?\s*\d[\d,.]*(?:\s*[mk])?)/i);
  const avgPpsfMatch =
    textSample.match(/average\s+ppsf\D{0,20}(\$?\s*\d[\d,.]*)/i) ??
    textSample.match(/avg\.?\s+ppsf\D{0,20}(\$?\s*\d[\d,.]*)/i);
  const projectedSellout = normalizeMoney(totalMatch?.[1]);
  return {
    raw: { textSample, pageNumber },
    normalized: {
      amount: projectedSellout,
      price: projectedSellout,
      projectedSellout,
      pricePerSqft: normalizeMoney(avgPpsfMatch?.[1]),
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
      reviewStatus: "pending",
    };
  });
}

export async function extractBrokerCompPackageDraft(buffer: Buffer, filename: string): Promise<BrokerCompExtractionDraft> {
  const metadata = await extractTextMetadataFromBuffer(buffer, filename);
  const packageType = inferPackageType(filename, metadata.text);
  const pages = buildPages(metadata, filename);
  const extractedItems: BrokerCompExtractedItemInput[] = [];

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
        reviewStatus: "pending",
      });
    }

    const projected = extractProjectedPricing(pageNumber, textSample);
    if (projected) {
      extractedItems.push({
        itemType: "subject_projected_pricing",
        rawPayload: projected.raw,
        normalizedPayload: projected.normalized,
        pageRefs: [{ pageNumber, label: page.pageRef ?? null }],
        confidence: 0.58,
        reviewStatus: "pending",
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
      reviewStatus: "pending",
    });
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
      reviewStatus: "pending",
    });
  }

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
      extractionMode: filename.toLowerCase().match(/\.(xls|xlsx|csv)$/) ? "spreadsheet" : "text",
    },
    textChars: metadata.text.length,
    pageCount: metadata.pageCount ?? pages.length,
    parserVersion: PARSER_VERSION,
  };
}
