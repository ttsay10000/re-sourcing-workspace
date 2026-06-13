import { describe, expect, it } from "vitest";
import {
  buildGeminiMarketExtractionPrompt,
  buildLiveMarketAnalysisPrompt,
  buildMarketDocumentReviewPrompt,
  GEMINI_MARKET_EXTRACTION_CORE_PROMPT,
  GEMINI_MARKET_SPECIAL_RULES_PROMPT,
  LIVE_MARKET_ANALYSIS_PROMPT,
  LIVE_MARKET_ANALYSIS_REQUIRED_BEHAVIOR_PROMPT,
  MARKET_COMPS_ROUTING_PROMPT,
  MARKET_DOCUMENT_REVIEW_PROMPT,
  MARKET_PROMPT_V3_PILLAR_SUMMARY,
} from "./marketPromptV3.js";
import { itemsFromParsedJson } from "./extractBrokerCompPackageFromGemini.js";

describe("market prompt v3 constants", () => {
  it("preserves the approved pillar summary and source language", () => {
    expect(MARKET_PROMPT_V3_PILLAR_SUMMARY).toContain("Pillar 1: Gemini extraction.");
    expect(MARKET_PROMPT_V3_PILLAR_SUMMARY).toContain("Pillar 4: Live market analysis.");
    expect(GEMINI_MARKET_EXTRACTION_CORE_PROMPT).toContain("You are a real estate market PDF extraction engine.");
    expect(GEMINI_MARKET_EXTRACTION_CORE_PROMPT).toContain("Page-level source references for every important metric or comp");
    expect(MARKET_COMPS_ROUTING_PROMPT).toContain("create a separate table-ready payload called marketCompsTableRows");
    expect(MARKET_COMPS_ROUTING_PROMPT).toContain('Use selectionDecision: "watch" and reviewStatus: "pending"');
    expect(GEMINI_MARKET_SPECIAL_RULES_PROMPT).toContain("Monthly sales reports usually contain the richest transaction-level sale comps.");
    expect(GEMINI_MARKET_SPECIAL_RULES_PROMPT).toContain("Do not deduplicate across different documents.");
    expect(MARKET_DOCUMENT_REVIEW_PROMPT).toContain("Your job is not just to summarize.");
    expect(MARKET_DOCUMENT_REVIEW_PROMPT).toContain("How does this help us source, price, underwrite, or diligence real estate?");
    expect(LIVE_MARKET_ANALYSIS_PROMPT).toContain("You are a real estate market analysis engine.");
    expect(LIVE_MARKET_ANALYSIS_PROMPT).toContain("Strong interest in small buildings under 9 or under 10 units");
    expect(LIVE_MARKET_ANALYSIS_REQUIRED_BEHAVIOR_PROMPT).toContain("Outputs updated Market Comps table actions: add, merge, watch, exclude, or needs-human-review");
  });

  it("builds prompts around the v3 schemas and prior live snapshot input", () => {
    const geminiPrompt = buildGeminiMarketExtractionPrompt({
      filename: "report.pdf",
      pageCount: 12,
      textPreview: "monthly sales table",
    });
    expect(geminiPrompt).toContain('"schemaVersion": "market_doc_extraction_v3"');
    expect(geminiPrompt).toContain('"marketCompsTableRows": []');

    const reviewPrompt = buildMarketDocumentReviewPrompt({
      filename: "report.pdf",
      geminiExtractionJson: { schemaVersion: "market_doc_extraction_v3", marketCompsTableRows: [] },
    });
    expect(reviewPrompt).toContain('"schemaVersion": "market_doc_review_v3"');
    expect(reviewPrompt).toContain("Gemini extraction JSON");

    const livePrompt = buildLiveMarketAnalysisPrompt({
      propertyContextJson: { propertyId: "p1" },
      approvedDocumentReviews: [{ schemaVersion: "market_doc_review_v3" }],
      approvedMarketCompsTableRows: [{ marketCompRowId: "row-1" }],
      approvedCompItems: [],
      excludedOrWatchRows: [],
      previousSnapshot: { schemaVersion: "live_market_analysis_v3", snapshotMeta: { generatedAt: "2026-01-01" } },
    });
    expect(livePrompt).toContain('"schemaVersion": "live_market_analysis_v3"');
    expect(livePrompt).toContain("Previously saved live_market_analysis_v3 snapshot");
    expect(livePrompt).toContain("2026-01-01");
  });
});

describe("Gemini v3 market extraction parser", () => {
  it("preserves marketCompsTableRows as pending watch rows for manual approval", () => {
    const items = itemsFromParsedJson({
      schemaVersion: "market_doc_extraction_v3",
      marketCompsTableRows: [
        {
          compType: "sale_comp",
          propertyName: "10 Example Street",
          address: "10 Example Street",
          saleDate: "2026-01-15",
          price: 5_000_000,
          sourcePageNumbers: [4],
          missingFields: ["capRatePct"],
          includeRecommended: true,
          includeRationale: "Closed nearby sale.",
          confidence: 0.95,
        },
      ],
      marketMetrics: [
        {
          metricName: "Average cap rate",
          value: "5.1%",
          period: "Q1 2026",
          pageNumber: 8,
        },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      itemType: "sale_comp",
      reviewStatus: "pending",
      selectionDecision: "watch",
      includeInDossier: false,
      analystNote: "Closed nearby sale.",
    });
    expect(items[0]?.normalizedPayload).toMatchObject({
      marketCompRowId: "market-comp-1-10-example-street-2026-01-15",
      routeTo: "market_comps_section",
      reviewStatus: "pending",
      selectionDecision: "watch",
      missingFields: ["capRatePct"],
      schemaVersion: "market_doc_extraction_v3",
    });
    expect(items[1]).toMatchObject({
      itemType: "market_metric_snapshot",
      reviewStatus: "pending",
      selectionDecision: "watch",
      includeInDossier: false,
    });
  });
});
