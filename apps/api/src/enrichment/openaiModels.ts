/**
 * Model helpers:
 * - General/lightweight enrichment defaults to gpt-4o
 * - High-stakes underwriting / dossier analysis defaults to gpt-5.4
 * Normalize common variants so "5.4" or "gpt-5.4" work.
 */

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_COMPLEX_ANALYSIS_MODEL = "gpt-5.4";
const DEFAULT_REASONING_EFFORT = "high";

/** Map shorthand to API model id so OPENAI_MODEL=5.4 works. */
const MODEL_ALIASES: Record<string, string> = {
  "5.4": "gpt-5.4",
  "5.0": "gpt-5",
  "5.1": "gpt-5.1",
  "5.2": "gpt-5.2",
  "5.3": "gpt-5.3",
  "4o": "gpt-4o",
  "4o-mini": "gpt-4o-mini",
};

function normalizeModel(envValue: string): string {
  const trimmed = envValue.trim();
  const lower = trimmed.toLowerCase();
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  if (MODEL_ALIASES[trimmed]) return MODEL_ALIASES[trimmed];
  return trimmed;
}

function getModelFromEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && typeof value === "string" && value.trim()) return normalizeModel(value);
  }
  return null;
}

function normalizeReasoningEffort(value: string | undefined): "low" | "medium" | "high" {
  const lower = (value ?? "").trim().toLowerCase();
  if (lower === "low" || lower === "medium" || lower === "high") return lower;
  if (lower === "extra-high" || lower === "very-high" || lower === "max") return "high";
  return "high";
}

function getReasoningEffortFromEnv(...keys: string[]): "low" | "medium" | "high" {
  for (const key of keys) {
    const value = process.env[key];
    if (value && typeof value === "string" && value.trim()) return normalizeReasoningEffort(value);
  }
  return DEFAULT_REASONING_EFFORT;
}

export function getEnrichmentModel(): string {
  const model = getModelFromEnv("OPENAI_MODEL");
  if (model) return model;
  return DEFAULT_MODEL;
}

/** Used by price history enrichment; defaults to same as getEnrichmentModel. */
export function getPriceHistoryModel(): string {
  const model = getModelFromEnv("OPENAI_PRICE_HISTORY_MODEL");
  if (model) return model;
  return getEnrichmentModel();
}

/** High-reasoning OM extraction model. */
export function getOmAnalysisModel(): string {
  const model = getModelFromEnv("OPENAI_OM_MODEL", "OPENAI_COMPLEX_ANALYSIS_MODEL");
  if (model) return model;
  return DEFAULT_COMPLEX_ANALYSIS_MODEL;
}

/** Highest available reasoning effort for OM extraction. */
export function getOmAnalysisReasoningEffort(): "low" | "medium" | "high" {
  return getReasoningEffortFromEnv("OPENAI_OM_REASONING_EFFORT", "OPENAI_COMPLEX_REASONING_EFFORT");
}

/** Used by deal dossier analysis LLM; defaults to gpt-5.4 unless overridden. */
export function getDossierModel(): string {
  const model = getModelFromEnv("OPENAI_DOSSIER_MODEL", "OPENAI_COMPLEX_ANALYSIS_MODEL");
  if (model) return model;
  return DEFAULT_COMPLEX_ANALYSIS_MODEL;
}

/** Highest available reasoning effort for dossier analysis. */
export function getDossierReasoningEffort(): "low" | "medium" | "high" {
  return getReasoningEffortFromEnv("OPENAI_DOSSIER_REASONING_EFFORT", "OPENAI_COMPLEX_REASONING_EFFORT");
}

/** Formatting-only pass can stay on a cheaper/faster model unless explicitly overridden. */
export function getDossierPresentationModel(): string {
  const model = getModelFromEnv("OPENAI_DOSSIER_PRESENTATION_MODEL");
  if (model) return model;
  return getEnrichmentModel();
}

/** Used by deal scoring LLM; defaults to the same complex analysis stack as dossier. */
export function getDealScoringModel(): string {
  const model = getModelFromEnv("OPENAI_DEAL_SCORING_MODEL", "OPENAI_COMPLEX_ANALYSIS_MODEL");
  if (model) return model;
  return getDossierModel();
}

/** Deal scoring should reason deeply when using GPT-5.x / reasoning-capable models. */
export function getDealScoringReasoningEffort(): "low" | "medium" | "high" {
  return getReasoningEffortFromEnv("OPENAI_DEAL_SCORING_REASONING_EFFORT", "OPENAI_COMPLEX_REASONING_EFFORT");
}

export function supportsReasoningEffort(model: string): boolean {
  const normalized = normalizeModel(model).toLowerCase();
  return normalized.startsWith("gpt-5") || normalized.startsWith("o1") || normalized.startsWith("o3") || normalized.startsWith("o4");
}
