/**
 * OpenAI model for broker/agent enrichment (contact lookup), OM analysis, etc.
 * Default: gpt-4o. Override with OPENAI_MODEL.
 * Normalize common variants so "5.4" or "gpt-5.4" work (API expects e.g. gpt-5.4, gpt-4o).
 */

const DEFAULT_MODEL = "gpt-4o";

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

export function getEnrichmentModel(): string {
  const m = process.env.OPENAI_MODEL;
  if (m && typeof m === "string" && m.trim()) return normalizeModel(m);
  return DEFAULT_MODEL;
}

/** Used by price history enrichment; defaults to same as getEnrichmentModel. */
export function getPriceHistoryModel(): string {
  const m = process.env.OPENAI_PRICE_HISTORY_MODEL;
  if (m && typeof m === "string" && m.trim()) return normalizeModel(m);
  return getEnrichmentModel();
}

/** Used by deal dossier LLM; defaults to same as getEnrichmentModel. Override with OPENAI_DOSSIER_MODEL. */
export function getDossierModel(): string {
  const m = process.env.OPENAI_DOSSIER_MODEL;
  if (m && typeof m === "string" && m.trim()) return normalizeModel(m);
  return getEnrichmentModel();
}

/** Used by deal scoring LLM; defaults to same as getDossierModel. Override with OPENAI_DEAL_SCORING_MODEL. */
export function getDealScoringModel(): string {
  const m = process.env.OPENAI_DEAL_SCORING_MODEL;
  if (m && typeof m === "string" && m.trim()) return normalizeModel(m);
  return getDossierModel();
}
