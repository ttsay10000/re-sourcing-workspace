#!/usr/bin/env node
/**
 * One-off test: run extractPriceHistory (fetch HTML + LLM) with gpt-5.2 and print result.
 * Run from apps/api: OPENAI_API_KEY=xxx node test-price-history-run.mjs [url]
 */
import { extractPriceHistory } from "./dist/enrichment/priceHistoryEnrichment.js";
import { getPriceHistoryModel } from "./dist/enrichment/openaiModels.js";

const url = process.argv[2] || "https://streeteasy.com/building/the-vermeer/4l";
if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY");
  process.exit(1);
}

console.log("Model:", getPriceHistoryModel());
console.log("URL:", url);
console.log("Fetching HTML, then sending to LLM...\n");
const r = await extractPriceHistory(url);
console.log("Result:", JSON.stringify(r, null, 2));
