import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BROKER_COMP_EXTRACTION_JSON_SHAPE,
  brokerCompItemsFromParsedJson,
} from "./extractBrokerCompPackageFromGemini.js";
import {
  buildOpenAiBrokerCompPrompt,
  extractBrokerCompPackageFromOpenAiText,
} from "./extractBrokerCompPackageFromOpenAi.js";

describe("buildOpenAiBrokerCompPrompt", () => {
  it("reuses the exact Gemini JSON shape so both extractors emit identical payloads", () => {
    const prompt = buildOpenAiBrokerCompPrompt({ textContent: "Sheet1\nAddress | Cap Rate", filename: "comps.xlsx" });
    expect(prompt).toContain(BROKER_COMP_EXTRACTION_JSON_SHAPE);
    expect(prompt).toContain("comps.xlsx");
    expect(prompt).toContain("Sheet1\nAddress | Cap Rate");
    expect(prompt).toContain("INVESTMENT-SALE COMPS ARE TOP PRIORITY");
  });
});

describe("brokerCompItemsFromParsedJson", () => {
  it("maps the shared JSON shape to the same item types as the Gemini path with provenance per source", () => {
    const parsed = {
      subject: {
        address: "210 East 39th Street",
        projectedSellout: 24_000_000,
        averagePpsf: 2_150,
        unitPricingRows: [{ unitLabel: "PH", bedrooms: 3, price: 6_500_000, ppsf: 2_400 }],
        pageNumber: 2,
      },
      comparables: [
        {
          propertyName: "The Example",
          address: "401 East 34th Street",
          salePrice: 18_000_000,
          capRatePct: 5.4,
          noi: 972_000,
          units: 24,
          buildingSqft: 30_000,
          pageNumber: 3,
        },
        {
          propertyName: "Sellout Comp",
          address: "181 Macdougal Street",
          askingPpsf: 2_996,
          percentSold: 25,
          bedroomBreakdown: [
            { bedroomType: "2 BED", count: 13, avgAskingPpsf: 2_976, priceRange: "$3.27M-$4.35M" },
          ],
          pageNumber: 4,
        },
      ],
      pricingOpinions: [{ amount: 21_500_000, source: "Broker call", note: "whisper", pageNumber: 1 }],
      marketTakeaways: ["Cap rates holding near 5.5%."],
    };

    const items = brokerCompItemsFromParsedJson(parsed, "openai_spreadsheet");

    const saleComp = items.find((item) => item.itemType === "sale_comp");
    expect(saleComp?.normalizedPayload).toMatchObject({
      address: "401 East 34th Street",
      salePrice: 18_000_000,
      capRatePct: 5.4,
      noi: 972_000,
      pricePerUnit: 750_000,
      sourceType: "openai_spreadsheet",
      packageFlavor: "investment_sale",
    });

    const pricingComp = items.find((item) => item.itemType === "pricing_comp");
    expect(pricingComp?.normalizedPayload).toMatchObject({
      address: "181 Macdougal Street",
      askingPpsf: 2_996,
      percentSoldPct: 25,
      sourceType: "openai_spreadsheet",
    });

    const unitRow = items.find((item) => item.itemType === "unit_breakdown_row");
    expect(unitRow?.normalizedPayload).toMatchObject({
      bedroomType: "2 BED",
      count: 13,
      priceRangeLow: 3_270_000,
      priceRangeHigh: 4_350_000,
      sourceType: "openai_spreadsheet",
    });

    const subject = items.find((item) => item.itemType === "subject_projected_pricing");
    expect(subject?.normalizedPayload).toMatchObject({
      address: "210 East 39th Street",
      projectedSellout: 24_000_000,
      pricePerSqft: 2_150,
    });

    expect(items.some((item) => item.itemType === "pricing_opinion")).toBe(true);
    expect(items.some((item) => item.itemType === "broker_note")).toBe(true);
  });
});

describe("extractBrokerCompPackageFromOpenAiText", () => {
  const savedKey = { value: undefined as string | undefined };

  beforeEach(() => {
    savedKey.value = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (savedKey.value == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey.value;
  });

  it("returns an explicit error result when OPENAI_API_KEY is missing", async () => {
    const result = await extractBrokerCompPackageFromOpenAiText({
      textContent: "Sheet1\nAddress | Cap Rate",
      filename: "comps.xlsx",
    });
    expect(result.extractedItems).toEqual([]);
    expect(result.error).toMatch(/OPENAI_API_KEY/);
  });

  it("returns an explicit error result when the spreadsheet text is empty", async () => {
    process.env.OPENAI_API_KEY = "test-key-1234567890";
    const result = await extractBrokerCompPackageFromOpenAiText({ textContent: "   ", filename: "comps.xlsx" });
    expect(result.extractedItems).toEqual([]);
    expect(result.error).toMatch(/no usable text/i);
  });
});
