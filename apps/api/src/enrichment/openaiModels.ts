/**
 * OpenAI model selection for LLM enrichment.
 * Uses GPT-5 family per https://developers.openai.com/api/docs/guides/latest-model
 *
 * - gpt-5.2: default for all enrichment (best accuracy)
 * - gpt-5-mini: cost-optimized override via OPENAI_MODEL
 */

const DEFAULT_ENRICHMENT_MODEL = "gpt-5.2";

/** Default model for all enrichment (broker, price history). Override with OPENAI_MODEL. */
export function getEnrichmentModel(): string {
  const m = process.env.OPENAI_MODEL;
  if (m && typeof m === "string" && m.trim()) return m.trim();
  return DEFAULT_ENRICHMENT_MODEL;
}

/** Model for price history extraction. Override with OPENAI_PRICE_HISTORY_MODEL, else OPENAI_MODEL, else gpt-5.2. */
export function getPriceHistoryModel(): string {
  const m = process.env.OPENAI_PRICE_HISTORY_MODEL;
  if (m && typeof m === "string" && m.trim()) return m.trim();
  return getEnrichmentModel();
}
