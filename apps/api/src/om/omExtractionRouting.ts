import type { OmCoverage, OmExtractionMethod } from "@re-sourcing/contracts";

export interface OmRoutingPreparedDocument {
  id: string;
  filename: string;
  mimeType?: string | null;
  fileBytes: number;
  pageCount?: number | null;
  extractedText: string;
  pageStats?: Array<{
    pageNumber: number;
    textChars: number;
    textItems: number;
    textSample: string;
  }>;
}

export interface OmRoutingDocumentDecision {
  id: string;
  filename: string;
  mimeType?: string | null;
  fileBytes: number;
  pageCount: number | null;
  charCount: number;
  wordCount: number;
  charsPerPage: number | null;
  wordsPerPage: number | null;
  numericTokenCount: number;
  financialKeywordHits: number;
  tableLikeLineCount: number;
  extractionMethod: OmExtractionMethod;
  attachFile: boolean;
  rationale: string;
}

export interface OmExtractionRoutingDecision {
  extractionMethod: OmExtractionMethod;
  pageCount: number | null;
  financialPageCount: number | null;
  ocrPageCount: number | null;
  coverage: OmCoverage;
  attachFileDocumentIds: string[];
  documents: OmRoutingDocumentDecision[];
  rationale: string;
}

const FINANCIAL_KEYWORDS = [
  "rent roll",
  "gross rent",
  "noi",
  "net operating income",
  "operating expenses",
  "expenses",
  "taxes",
  "insurance",
  "vacancy",
  "unit",
  "lease",
  "annual rent",
  "monthly rent",
  "gross income",
  "effective gross income",
];
const FINANCIAL_PAGE_PATTERNS = /(financial|rent roll|income|expense|operating|t-?12|cash flow|overview)/i;
const VISUAL_PAGE_PATTERNS = /(photo|photos|map|aerial|location|neighborhood)/i;

function normalizePageCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function isPdfLike(filename: string, mimeType?: string | null): boolean {
  const ext = filename.toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();
  return ext.endsWith(".pdf") || mime === "application/pdf";
}

function countWords(text: string): number {
  const tokens = text.match(/\S+/g);
  return tokens?.length ?? 0;
}

function countNumericTokens(text: string): number {
  return text.match(/\b[$(]?\d[\d,./%-)]*\b/g)?.length ?? 0;
}

function countFinancialKeywordHits(text: string): number {
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const keyword of FINANCIAL_KEYWORDS) {
    if (haystack.includes(keyword)) hits += 1;
  }
  return hits;
}

function countTableLikeLines(text: string): number {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length < 6) return false;
      if (!/\d/.test(trimmed)) return false;
      return /(\$|%|rent|income|expense|tax|noi|unit|lease|annual|monthly)/i.test(trimmed);
    })
    .length;
}

function summarizeRationale(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("; ");
}

function countSparsePages(
  pageStats: OmRoutingPreparedDocument["pageStats"]
): number {
  return (pageStats ?? []).filter((page) => page.textChars < 120 || page.textItems <= 6).length;
}

function countDensePages(
  pageStats: OmRoutingPreparedDocument["pageStats"]
): number {
  return (pageStats ?? []).filter((page) => page.textChars >= 450 && page.textItems >= 25).length;
}

function countSparseFinancialPages(
  pageStats: OmRoutingPreparedDocument["pageStats"]
): number {
  return (pageStats ?? []).filter((page) => {
    if (!FINANCIAL_PAGE_PATTERNS.test(page.textSample)) return false;
    return page.textChars < 250 || page.textItems <= 12;
  }).length;
}

function countVisualPages(
  pageStats: OmRoutingPreparedDocument["pageStats"]
): number {
  return (pageStats ?? []).filter((page) => {
    if (!VISUAL_PAGE_PATTERNS.test(page.textSample)) return false;
    return page.textChars < 120;
  }).length;
}

function classifyDocument(doc: OmRoutingPreparedDocument): OmRoutingDocumentDecision {
  const pdfLike = isPdfLike(doc.filename, doc.mimeType);
  const text = (doc.extractedText ?? "").trim();
  const pageCount = normalizePageCount(doc.pageCount);
  const pageStats = doc.pageStats ?? [];
  const charCount = text.length;
  const wordCount = countWords(text);
  const numericTokenCount = countNumericTokens(text);
  const financialKeywordHits = countFinancialKeywordHits(text);
  const tableLikeLineCount = countTableLikeLines(text);
  const charsPerPage = pageCount ? charCount / pageCount : charCount;
  const wordsPerPage = pageCount ? wordCount / pageCount : wordCount;
  const sparsePageCount = countSparsePages(pageStats);
  const densePageCount = countDensePages(pageStats);
  const sparseFinancialPageCount = countSparseFinancialPages(pageStats);
  const visualPageCount = countVisualPages(pageStats);
  const sparsePageShare = pageCount ? sparsePageCount / pageCount : 0;
  const densePageShare = pageCount ? densePageCount / pageCount : 0;
  const mixedCoverage =
    sparseFinancialPageCount > 0 &&
    (
      densePageCount >= 2 ||
      charCount >= 2_500 ||
      (pageCount != null && densePageShare >= 0.2)
    );

  const lowTextYield =
    charCount < 900 ||
    wordCount < 140 ||
    (pageCount != null && charsPerPage < 220 && wordsPerPage < 45);
  const strongTextCoverage =
    (
      pageCount != null &&
      densePageShare >= 0.5 &&
      sparseFinancialPageCount === 0 &&
      sparsePageShare <= 0.35
    ) ||
    (
      charCount >= 2_500 &&
      densePageCount >= Math.max(2, Math.ceil((pageCount ?? 1) * 0.35)) &&
      sparseFinancialPageCount === 0 &&
      (tableLikeLineCount >= 6 || financialKeywordHits >= 6)
    );
  const likelyImageHeavy =
    pdfLike &&
    (
      lowTextYield ||
      sparseFinancialPageCount > 0 ||
      (pageCount != null && sparsePageShare >= 0.5) ||
      (pageCount != null && visualPageCount >= Math.ceil(pageCount * 0.35) && sparsePageShare >= 0.4) ||
      (doc.fileBytes >= 1_000_000 && charCount < 1_800) ||
      (pageCount != null && pageCount >= 6 && charsPerPage < 300)
    );

  let extractionMethod: OmExtractionMethod;
  if (!pdfLike) {
    extractionMethod = "text_tables";
  } else if (likelyImageHeavy && !strongTextCoverage) {
    extractionMethod = mixedCoverage ? "hybrid" : "ocr_tables";
  } else if (mixedCoverage) {
    extractionMethod = "hybrid";
  } else if (likelyImageHeavy) {
    extractionMethod = "ocr_tables";
  } else if (strongTextCoverage && !likelyImageHeavy) {
    extractionMethod = "text_tables";
  } else {
    extractionMethod = "hybrid";
  }

  return {
    id: doc.id,
    filename: doc.filename,
    mimeType: doc.mimeType ?? null,
    fileBytes: doc.fileBytes,
    pageCount,
    charCount,
    wordCount,
    charsPerPage: pageCount ? Number(charsPerPage.toFixed(1)) : null,
    wordsPerPage: pageCount ? Number(wordsPerPage.toFixed(1)) : null,
    numericTokenCount,
    financialKeywordHits,
    tableLikeLineCount,
    extractionMethod,
    attachFile: pdfLike && extractionMethod !== "text_tables",
    rationale: summarizeRationale([
      pdfLike ? "pdf-like document" : "non-pdf document",
      lowTextYield ? "low extracted-text yield" : null,
      strongTextCoverage ? "strong extracted-text coverage" : null,
      likelyImageHeavy ? "likely image-heavy pages" : null,
      mixedCoverage ? "mixed text/image coverage" : null,
      sparseFinancialPageCount > 0 ? `sparse financial pages: ${sparseFinancialPageCount}` : null,
      sparsePageCount > 0 ? `sparse pages: ${sparsePageCount}` : null,
      tableLikeLineCount >= 4 ? "table-like financial rows present" : null,
      financialKeywordHits >= 4 ? "financial keywords present" : null,
    ]),
  };
}

function estimatedPages(decision: OmRoutingDocumentDecision): number {
  return decision.pageCount ?? 1;
}

export function decideOmExtractionRouting(
  docs: OmRoutingPreparedDocument[]
): OmExtractionRoutingDecision {
  const decisions = docs.map(classifyDocument);
  const pdfDecisions = decisions.filter((doc) => isPdfLike(doc.filename, doc.mimeType));
  const attachFileDocumentIds = decisions.filter((doc) => doc.attachFile).map((doc) => doc.id);
  const totalPages = decisions.reduce((sum, doc) => sum + estimatedPages(doc), 0);
  const financialPageCount = decisions.reduce((sum, doc) => {
    if (doc.tableLikeLineCount > 0 || doc.financialKeywordHits > 0) return sum + estimatedPages(doc);
    return sum;
  }, 0);
  const ocrPageCount = decisions.reduce((sum, doc) => {
    if (doc.attachFile) return sum + estimatedPages(doc);
    return sum;
  }, 0);

  let extractionMethod: OmExtractionMethod = "text_tables";
  if (attachFileDocumentIds.length === 0) {
    extractionMethod = "text_tables";
  } else if (
    pdfDecisions.length > 0 &&
    pdfDecisions.every((doc) => doc.extractionMethod === "ocr_tables")
  ) {
    extractionMethod = "ocr_tables";
  } else if (
    decisions.every((doc) => doc.extractionMethod === "text_tables")
  ) {
    extractionMethod = "text_tables";
  } else {
    extractionMethod = "hybrid";
  }

  const rationale = summarizeRationale([
    extractionMethod === "ocr_tables" ? "all PDF inputs have low text coverage and stay on file-assisted extraction" : null,
    extractionMethod === "text_tables" ? "extracted text is strong enough to avoid file-assisted parsing" : null,
    extractionMethod === "hybrid" ? "mixed document quality; attach only low-text PDFs and use extracted text for the rest" : null,
  ]);

  return {
    extractionMethod,
    pageCount: totalPages > 0 ? totalPages : null,
    financialPageCount: financialPageCount > 0 ? Math.min(financialPageCount, totalPages || financialPageCount) : null,
    ocrPageCount: ocrPageCount > 0 ? Math.min(ocrPageCount, totalPages || ocrPageCount) : null,
    coverage: {
      pageCountAnalyzed: totalPages > 0 ? totalPages : null,
      financialPagesDetected: financialPageCount > 0 ? Math.min(financialPageCount, totalPages || financialPageCount) : null,
      ocrPagesUsed: ocrPageCount > 0 ? Math.min(ocrPageCount, totalPages || ocrPageCount) : null,
    },
    attachFileDocumentIds,
    documents: decisions,
    rationale,
  };
}
