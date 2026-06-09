import { describe, expect, it } from "vitest";
import { buildDealAnalysisDocumentTextContext } from "./dealAnalysisOmImport.js";

describe("buildDealAnalysisDocumentTextContext", () => {
  it("converts broker CSV/text files into Gemini text-package context", async () => {
    const context = await buildDealAnalysisDocumentTextContext([
      {
        filename: "115 South Street rent roll.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Unit,Type,Monthly Rent\n1R,Residential,$4,750\nStore,Commercial,$15,000"),
        sizeBytes: 78,
      },
    ]);

    expect(context).toContain("Broker OM / financial package text context");
    expect(context).toContain("SOURCE DOCUMENT: 115 South Street rent roll.csv");
    expect(context).toContain("TYPE HINT: Rent Roll");
    expect(context).toContain("Monthly Rent");
    expect(context).toContain("$15,000");
  });

  it("leaves PDFs for Gemini file upload instead of duplicating them into text context", async () => {
    const context = await buildDealAnalysisDocumentTextContext([
      {
        filename: "115 South Street OM.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7"),
        sizeBytes: 8,
      },
    ]);

    expect(context).toBeNull();
  });
});
