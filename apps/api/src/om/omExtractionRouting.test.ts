import { describe, expect, it } from "vitest";
import { decideOmExtractionRouting } from "./omExtractionRouting.js";

describe("omExtractionRouting", () => {
  it("routes text-rich PDFs through text_tables", () => {
    const decision = decideOmExtractionRouting([
      {
        id: "doc-text",
        filename: "offering-memo.pdf",
        mimeType: "application/pdf",
        fileBytes: 420_000,
        pageCount: 8,
        extractedText: Array.from({ length: 80 }, (_, index) =>
          `Unit ${index + 1} monthly rent $${2_000 + index * 25} annual rent ${24_000 + index * 300} operating expenses taxes insurance`
        ).join("\n"),
        pageStats: Array.from({ length: 8 }, (_, index) => ({
          pageNumber: index + 1,
          textChars: 900,
          textItems: 60,
          textSample: index < 4 ? "Rent roll monthly rent annual rent operating expenses" : "Financial overview gross income noi taxes insurance",
        })),
      },
    ]);

    expect(decision.extractionMethod).toBe("text_tables");
    expect(decision.attachFileDocumentIds).toEqual([]);
    expect(decision.ocrPageCount).toBeNull();
  });

  it("routes low-text PDFs through ocr_tables", () => {
    const decision = decideOmExtractionRouting([
      {
        id: "doc-ocr",
        filename: "executive-summary.pdf",
        mimeType: "application/pdf",
        fileBytes: 3_200_000,
        pageCount: 12,
        extractedText: "Marcus Millichap Exclusive Listing Confidentiality Agreement",
        pageStats: Array.from({ length: 12 }, (_, index) => ({
          pageNumber: index + 1,
          textChars: index === 0 ? 65 : 20,
          textItems: index === 0 ? 8 : 2,
          textSample: index === 0 ? "Offering memorandum financial analysis" : "Property photos",
        })),
      },
    ]);

    expect(decision.extractionMethod).toBe("ocr_tables");
    expect(decision.attachFileDocumentIds).toEqual(["doc-ocr"]);
    expect(decision.ocrPageCount).toBe(12);
  });

  it("uses hybrid routing for mixed document quality", () => {
    const decision = decideOmExtractionRouting([
      {
        id: "doc-text",
        filename: "rent-roll.pdf",
        mimeType: "application/pdf",
        fileBytes: 280_000,
        pageCount: 4,
        extractedText: Array.from({ length: 50 }, (_, index) =>
          `Unit ${index + 1} lease monthly rent $${2_500 + index * 10} annual rent ${30_000 + index * 120}`
        ).join("\n"),
        pageStats: Array.from({ length: 4 }, (_, index) => ({
          pageNumber: index + 1,
          textChars: 760,
          textItems: 48,
          textSample: "Rent roll lease monthly rent annual rent",
        })),
      },
      {
        id: "doc-scan",
        filename: "brochure-scan.pdf",
        mimeType: "application/pdf",
        fileBytes: 2_800_000,
        pageCount: 10,
        extractedText: "Investment Highlights Broker Information",
        pageStats: Array.from({ length: 10 }, (_, index) => ({
          pageNumber: index + 1,
          textChars: index === 0 ? 140 : 40,
          textItems: index === 0 ? 14 : 4,
          textSample: index === 0 ? "Investment highlights financial overview" : "Property photos neighborhood",
        })),
      },
    ]);

    expect(decision.extractionMethod).toBe("hybrid");
    expect(decision.attachFileDocumentIds).toEqual(["doc-scan"]);
    expect(decision.ocrPageCount).toBe(10);
    expect(decision.pageCount).toBe(14);
  });

  it("does not route a long OM to text_tables when the financial pages are image-based", () => {
    const decision = decideOmExtractionRouting([
      {
        id: "doc-mixed",
        filename: "18-christopher.pdf",
        mimeType: "application/pdf",
        fileBytes: 8_789_698,
        pageCount: 18,
        extractedText: "Narrative offering text ".repeat(400),
        pageStats: [
          { pageNumber: 1, textChars: 19, textItems: 1, textSample: "OFFERING MEMORANDUM" },
          { pageNumber: 2, textChars: 339, textItems: 32, textSample: "Team contacts offering memorandum" },
          { pageNumber: 3, textChars: 2243, textItems: 276, textSample: "The offering New York Multifamily is pleased..." },
          { pageNumber: 4, textChars: 18, textItems: 2, textSample: "FINANCIAL ANALYSIS" },
          { pageNumber: 5, textChars: 559, textItems: 13, textSample: "FINANCIAL OVERVIEW FINANCIAL ANALYSIS" },
          { pageNumber: 6, textChars: 53, textItems: 5, textSample: "RENT ROLL FINANCIAL ANALYSIS" },
          { pageNumber: 7, textChars: 69, textItems: 5, textSample: "INCOME & EXPENSE ANALYSIS FINANCIAL ANALYSIS" },
          { pageNumber: 8, textChars: 20, textItems: 2, textSample: "PROPERTY DESCRIPTION" },
          { pageNumber: 9, textChars: 522, textItems: 49, textSample: "18 Christopher Street 20 Christopher Street neighborhood" },
          { pageNumber: 10, textChars: 48, textItems: 4, textSample: "PROPERTY PHOTOS – EXTERIORS" },
          { pageNumber: 11, textChars: 44, textItems: 4, textSample: "PROPERTY PHOTOS – APT 1" },
          { pageNumber: 12, textChars: 44, textItems: 4, textSample: "PROPERTY PHOTOS – APT 2" },
          { pageNumber: 13, textChars: 44, textItems: 4, textSample: "PROPERTY PHOTOS – APT 3" },
          { pageNumber: 14, textChars: 44, textItems: 4, textSample: "PROPERTY PHOTOS – APT 4" },
          { pageNumber: 15, textChars: 51, textItems: 4, textSample: "PROPERTY PHOTOS – NEIGHBORHOOD" },
          { pageNumber: 16, textChars: 24, textItems: 2, textSample: "MAP PROPERTY DESCRIPTION" },
          { pageNumber: 17, textChars: 3977, textItems: 634, textSample: "NON-ENDORSEMENT AND DISCLAIMER NOTICE CONFIDENTIALITY" },
          { pageNumber: 18, textChars: 339, textItems: 32, textSample: "Team contacts offering memorandum" },
        ],
      },
    ]);

    expect(decision.extractionMethod).toBe("hybrid");
    expect(decision.attachFileDocumentIds).toEqual(["doc-mixed"]);
    expect(decision.ocrPageCount).toBe(18);
  });
});
