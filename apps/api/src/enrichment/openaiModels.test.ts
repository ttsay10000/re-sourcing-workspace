import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDealScoringModel,
  getDossierModel,
  getEnrichmentModel,
  getOmAnalysisModel,
} from "./openaiModels.js";

describe("OpenAI model helpers", () => {
  beforeEach(() => {
    for (const key of [
      "OPENAI_MODEL",
      "OPENAI_OM_MODEL",
      "OPENAI_DOSSIER_MODEL",
      "OPENAI_DEAL_SCORING_MODEL",
      "OPENAI_COMPLEX_ANALYSIS_MODEL",
    ]) {
      vi.stubEnv(key, "");
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults complex analysis workloads to GPT-5.5", () => {
    expect(getDossierModel()).toBe("gpt-5.5");
    expect(getOmAnalysisModel()).toBe("gpt-5.5");
    expect(getDealScoringModel()).toBe("gpt-5.5");
  });

  it("normalizes GPT-5.5 shorthand and ChatGPT display names to the API model id", () => {
    vi.stubEnv("OPENAI_MODEL", "5.5");
    expect(getEnrichmentModel()).toBe("gpt-5.5");

    vi.stubEnv("OPENAI_MODEL", "ChatGPT 5.5");
    expect(getEnrichmentModel()).toBe("gpt-5.5");

    vi.stubEnv("OPENAI_COMPLEX_ANALYSIS_MODEL", "chatgpt-5.5");
    expect(getDossierModel()).toBe("gpt-5.5");
  });
});
