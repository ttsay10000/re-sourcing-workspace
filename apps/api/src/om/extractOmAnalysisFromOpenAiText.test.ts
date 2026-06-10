import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOpenAiTextOmPrompt, resolveOpenAiOmModel } from "./extractOmAnalysisFromOpenAiText.js";

const WORKBOOK_TEXT = [
  "Document: 325_West_22nd_St._3yr_annual_expense.xlsx",
  "Category: Financial Model",
  "Source: uploaded_document",
  "Report",
  "325 w 22nd",
  "Category | 1/1/2023-6/30/2023 | 7/1/2023-12/31/2023 | OVERALL TOTAL",
  "Utilities | 6464.07 | 3023.41 | 31087.73",
  "prop tax | 20686.94 | 20687.34 | 130667.82",
  "TOTAL EXPENSES | 32712.48 | 31886.62 | 205590.06",
].join("\n");

describe("resolveOpenAiOmModel", () => {
  beforeEach(() => {
    for (const key of ["OPENAI_OM_MODEL", "OPENAI_COMPLEX_ANALYSIS_MODEL"]) {
      vi.stubEnv(key, "");
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults text-package OM extraction to GPT-5.5", () => {
    expect(resolveOpenAiOmModel()).toBe("gpt-5.5");
  });

  it("honors OPENAI_OM_MODEL and explicit overrides", () => {
    vi.stubEnv("OPENAI_OM_MODEL", "5.4");
    expect(resolveOpenAiOmModel()).toBe("gpt-5.4");
    expect(resolveOpenAiOmModel("gpt-5.5")).toBe("gpt-5.5");
  });
});

describe("buildOpenAiTextOmPrompt", () => {
  it("carries the source package text and the shared structured-output contract", () => {
    const prompt = buildOpenAiTextOmPrompt({
      textContext: WORKBOOK_TEXT,
      propertyContext: "325 West 22nd Street, New York, NY",
    });

    expect(prompt).toContain("Property context:\n325 West 22nd Street, New York, NY");
    expect(prompt).toContain("CRITICAL TEXT PACKAGE MODE");
    expect(prompt).toContain("Utilities | 6464.07 | 3023.41 | 31087.73");
    expect(prompt).toContain("TOTAL EXPENSES | 32712.48 | 31886.62 | 205590.06");
    // Same top-level keys the Gemini path demands, so review/promotion stay identical.
    expect(prompt).toContain("RESPONSE RULES:");
    expect(prompt).toContain(
      "Keep these keys at the TOP LEVEL only: propertyInfo, rentRoll, income, expenses, revenueComposition"
    );
    // Period-summing guidance for semi-annual/quarterly expense statements.
    expect(prompt).toContain("sum periods into annual figures per line item");
  });

  it("omits the property context block when none is provided", () => {
    const prompt = buildOpenAiTextOmPrompt({ textContext: WORKBOOK_TEXT });
    expect(prompt).not.toContain("Property context:");
    expect(prompt).toContain("Source package:");
  });
});
