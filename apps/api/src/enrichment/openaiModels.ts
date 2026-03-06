/**
 * OpenAI model for broker/agent enrichment (contact lookup).
 * Default: gpt-4o. Override with OPENAI_MODEL.
 */

const DEFAULT_MODEL = "gpt-4o";

export function getEnrichmentModel(): string {
  const m = process.env.OPENAI_MODEL;
  if (m && typeof m === "string" && m.trim()) return m.trim();
  return DEFAULT_MODEL;
}

/** Used by price history enrichment; defaults to same as getEnrichmentModel. */
export function getPriceHistoryModel(): string {
  const m = process.env.OPENAI_PRICE_HISTORY_MODEL;
  if (m && typeof m === "string" && m.trim()) return m.trim();
  return getEnrichmentModel();
}

/** Used by deal dossier LLM; defaults to same as getEnrichmentModel. Override with OPENAI_DOSSIER_MODEL. */
export function getDossierModel(): string {
  const m = process.env.OPENAI_DOSSIER_MODEL;
  if (m && typeof m === "string" && m.trim()) return m.trim();
  return getEnrichmentModel();
}
