#!/usr/bin/env node
/**
 * Verify OM LLM flow: call OpenAI with the senior-analyst OM prompt and sample text.
 * Run from repo root or apps/api:
 *   OPENAI_API_KEY=xxx node apps/api/scripts/testOmLlm.mjs
 * Or after building: OPENAI_API_KEY=xxx node apps/api/dist/scripts/testOmLlm.js
 */
import { extractRentalFinancialsFromText } from "../dist/rental/extractRentalFinancialsFromListing.js";
import { getEnrichmentModel } from "../dist/enrichment/openaiModels.js";

const sampleDocText = `
27 West 9th Street – Greenwich Village
6-unit walk-up. Price: $3,200,000.

Rent roll:
Unit 1: 2br, $3,200/mo
Unit 2: 2br, $3,400/mo
Unit 3: 3br, $4,100/mo
Unit 4: 2br, $3,100/mo
Unit 5: 2br, $3,300/mo
Unit 6: 3br, $4,200/mo

Gross rent: $21,200/mo. Expenses: taxes $2,100, insurance $400, utilities $600, maintenance $800. NOI: $165,000. Cap rate 5.2%.
`;

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("Set OPENAI_API_KEY to run this test.");
  process.exit(1);
}

console.log("Model:", getEnrichmentModel());
console.log("Calling extractRentalFinancialsFromText with forceOmStyle: true...\n");

const result = await extractRentalFinancialsFromText(sampleDocText.trim(), { forceOmStyle: true });

console.log("OpenAI was called. Result:");
console.log("  fromLlm keys:", result.fromLlm && typeof result.fromLlm === "object" ? Object.keys(result.fromLlm) : "null");
console.log("  omAnalysis:", result.omAnalysis ? "present" : "null");
if (result.fromLlm?.noi != null) console.log("  noi:", result.fromLlm.noi);
if (result.fromLlm?.capRate != null) console.log("  capRate:", result.fromLlm.capRate);
if (result.fromLlm?.grossRentTotal != null) console.log("  grossRentTotal:", result.fromLlm.grossRentTotal);
console.log("\nDone. If you see fromLlm/omAnalysis above, the OM LLM flow is working.");
