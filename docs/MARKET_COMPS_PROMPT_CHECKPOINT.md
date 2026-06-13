# Market Comps Extraction Prompt Checkpoint

Status: waiting for user review before implementation.

This is the proposed per-document extraction workflow for broker reports, OMs, market documents, and comp lists. The same workflow should run once per uploaded document. Multi-document uploads should process sequentially and attach a per-document ingest log, timer, status, source provenance, and "needs attention" flags.

## Proposed Model Flow

Use a two-step pipeline:

1. **Gemini document extraction:** Gemini reads the raw PDF/images/tables because it is stronger for image-heavy broker PDFs, scans, and visual tables. This step should be source-faithful and should not interpret beyond the document.
2. **GPT cleanup + analyst note synthesis:** GPT receives Gemini's structured extraction, source excerpts/page refs, and any parsed text. GPT cleans labels, resolves field names, flags conflicts, dedupes rows, normalizes asset classes/timeline fields, and writes reviewable per-document analyst notes. GPT should not invent values missing from Gemini/source material.

The saved per-document output should include both:

- `sourceExtraction`: Gemini's raw structured extraction and provenance.
- `gptAnalystNotes`: GPT's cleaned, source-cited summary, conflicts, market/asset-class notes, mixed-use/retail cues, and diligence flags.

## Implementation Rules

- Use internal uploaded/saved sources only: listings, OMs, broker reports, comp packages, saved snapshots, and user-entered notes.
- Do not use external APIs in this pass.
- Preserve exact source values, page references, dates, labels, and broker language.
- Do not invent cap rates, NOI, sale prices, rent, timeline, asset class, or neighborhood trends.
- When the source is ambiguous, return a conflict or missing-data flag instead of guessing.
- Every extracted item must carry enough provenance to audit it later: source document name/id when available, page number, source label, source excerpt, extraction confidence, and review status.
- Excluded comps should remain reviewable on comp review surfaces, but should be omitted from downstream dossier analysis, yield map, live market analysis, and exported reports.

## Step 1: Proposed Gemini Extraction Prompt

```text
You are a senior real estate sourcing analyst extracting structured deal, comp, and market information from one internal source document.

Source document:
- Filename: {{filename}}
- Document category selected by user, if any: {{documentCategory}}
- Property context, if any: {{propertyAddress}}
- Parsed selectable text preview, if any: {{textPreview}}

Read the entire attached document. Use the PDF/images/tables directly when available, not only the text preview. Return exactly one JSON object and no commentary.

Primary objective:
Extract deal-based information and market/neighborhood trend information that helps an analyst move quickly through sourcing decisions. Prioritize facts that can drive underwriting, comp review, yield analysis, dossier language, and "where to hunt" conclusions.

Top-level JSON shape:
{
  "documentMeta": {
    "documentTitle": string|null,
    "brokerageOrSource": string|null,
    "documentType": "offering_memorandum"|"broker_report"|"market_report"|"sale_comp_package"|"rent_comp_package"|"expense_comp_package"|"pricing_sellout"|"listing"|"other",
    "primaryAssetClass": "multifamily"|"mixed_use"|"retail"|"office"|"industrial"|"condo"|"development_site"|"land"|"unspecified",
    "geography": {
      "borough": string|null,
      "neighborhood": string|null,
      "submarket": string|null,
      "corridor": string|null
    },
    "timeline": {
      "asOfPeriodLabel": string|null,
      "asOfMonth": number|null,
      "asOfQuarter": "Q1"|"Q2"|"Q3"|"Q4"|null,
      "asOfYear": number|null,
      "publicationDate": string|null,
      "dataPeriodStart": string|null,
      "dataPeriodEnd": string|null
    },
    "sourceCoverage": {
      "usedPdfGraphics": boolean,
      "imageOnlyPagesRead": number|null,
      "tablesRead": number|null,
      "coverageGaps": string[]
    }
  },
  "subjectProperty": {
    "address": string|null,
    "propertyName": string|null,
    "assetClass": "multifamily"|"mixed_use"|"retail"|"office"|"industrial"|"condo"|"development_site"|"land"|"unspecified"|null,
    "propertyTypeLabel": string|null,
    "borough": string|null,
    "neighborhood": string|null,
    "units": number|null,
    "residentialUnits": number|null,
    "commercialUnits": number|null,
    "rentableSqft": number|null,
    "residentialSqft": number|null,
    "commercialSqft": number|null,
    "lotSqft": number|null,
    "yearBuilt": number|null,
    "askingPrice": number|null,
    "whisperPrice": number|null,
    "brokerPriceGuidance": number|null,
    "currentNoi": number|null,
    "stabilizedNoi": number|null,
    "capRatePct": number|null,
    "pricePerSqft": number|null,
    "pricePerUnit": number|null,
    "conditionLanguage": string[],
    "brokerClaims": string[],
    "upsideCues": string[],
    "amenities": string[],
    "diligenceFlags": string[],
    "mixedUseRetailContext": {
      "commercialRentSharePct": number|null,
      "commercialRentAmount": number|null,
      "frontage": string|null,
      "corridorOrCrossStreet": string|null,
      "tenantNames": string[],
      "leaseTermClues": string[],
      "vacancyClues": string[],
      "commercialGrowthAssumptions": string[]
    },
    "pageRefs": [{"pageNumber": number, "label": string|null, "excerpt": string|null}]
  },
  "comparables": [
    {
      "itemType": "sale_comp"|"operating_snapshot"|"rent_comp"|"expense_comp"|"pricing_comp"|"unit_breakdown_row"|"subject_projected_pricing"|"pricing_opinion",
      "address": string|null,
      "propertyName": string|null,
      "assetClass": "multifamily"|"mixed_use"|"retail"|"office"|"industrial"|"condo"|"development_site"|"land"|"unspecified"|null,
      "propertyTypeLabel": string|null,
      "borough": string|null,
      "neighborhood": string|null,
      "submarket": string|null,
      "corridor": string|null,
      "saleDate": string|null,
      "contractDate": string|null,
      "asOfPeriodLabel": string|null,
      "asOfMonth": number|null,
      "asOfQuarter": "Q1"|"Q2"|"Q3"|"Q4"|null,
      "asOfYear": number|null,
      "salePrice": number|null,
      "askingPrice": number|null,
      "whisperPrice": number|null,
      "pricePerSqft": number|null,
      "pricePerUnit": number|null,
      "capRatePct": number|null,
      "noi": number|null,
      "units": number|null,
      "residentialUnits": number|null,
      "commercialUnits": number|null,
      "rentableSqft": number|null,
      "commercialSqft": number|null,
      "avgRentPerUnit": number|null,
      "rentPsf": number|null,
      "expensePsf": number|null,
      "taxPsf": number|null,
      "occupancyPct": number|null,
      "tenants": string[],
      "leaseClues": string[],
      "brokerNotes": string[],
      "similarityRationale": string|null,
      "notComparableReasons": string[],
      "includeRecommended": boolean,
      "reviewStatus": "pending",
      "selectionDecision": "watch",
      "confidence": number,
      "pageRefs": [{"pageNumber": number, "label": string|null, "excerpt": string|null}]
    }
  ],
  "marketSignals": [
    {
      "signalType": "neighborhood_trend"|"borough_trend"|"asset_class_trend"|"rent_trend"|"sale_velocity"|"cap_rate_trend"|"pricing_trend"|"retail_footprint"|"tenant_demand"|"supply_pipeline"|"where_to_hunt"|"risk",
      "geographyLabel": string|null,
      "assetClass": string|null,
      "periodLabel": string|null,
      "direction": "up"|"down"|"flat"|"mixed"|"unknown",
      "metricName": string|null,
      "metricValue": number|null,
      "metricUnit": string|null,
      "summary": string,
      "analystImplication": string|null,
      "confidence": number,
      "pageRefs": [{"pageNumber": number, "label": string|null, "excerpt": string|null}]
    }
  ],
  "conflicts": [
    {
      "field": string,
      "description": string,
      "values": [{"value": string|number|null, "sourceLabel": string|null, "pageNumber": number|null}],
      "recommendedResolution": string|null
    }
  ],
  "missingDataFlags": [
    {
      "field": string,
      "label": string|null,
      "severity": "info"|"warning"|"error",
      "message": string,
      "source": string|null
    }
  ],
  "analystSummary": {
    "oneLineRead": string|null,
    "keyTakeaways": string[],
    "whereToHunt": string[],
    "diligenceFollowUps": string[],
    "sourceLimitations": string[]
  }
}

Extraction rules:
- Convert dollars, percentages, square feet, unit counts, and dates into normalized values where possible.
- Keep raw excerpts short but specific enough to verify the number or trend.
- Extract quarter, month, as-of period, and year whenever visible near a comp, table, report title, or chart.
- Extract property type/asset class even when it appears only in prose, table headers, or broker labeling.
- Mixed-use and retail details matter: capture commercial rent share, units, frontage, tenant/lease clues, corridor language, foot traffic, and commercial growth assumptions when present.
- Listing descriptions matter: capture condition language, broker claims, upside cues, amenities, mixed-use clues, and diligence flags.
- If a document contains a broker's opinion or pricing guidance rather than a closed comp, classify it as pricing_opinion and do not promote it as a closed sale comp.
- If a comp appears only as $/PSF with no cap rate or NOI, still extract it and set missingDataFlags for unavailable cap-rate/NOI fields.
- Do not treat unsupported broker marketing claims as facts. Put them in brokerClaims or marketSignals with source references.
- Return empty arrays instead of omitting arrays.
```

## Step 2: Proposed GPT Cleanup + Analyst Notes Prompt

```text
You are a senior real estate sourcing analyst cleaning one internal document extraction for review.

Inputs:
- Property context: {{propertyContextJson}}
- Source document metadata: {{documentMetaJson}}
- Gemini source extraction: {{geminiExtractionJson}}
- Parsed text excerpts, if any: {{textPreview}}

Use only the provided extraction and excerpts. Do not use outside knowledge. Do not invent missing values.

Return exactly one JSON object:
{
  "normalizedDocumentMeta": {
    "documentType": string|null,
    "primaryAssetClass": string|null,
    "borough": string|null,
    "neighborhood": string|null,
    "asOfPeriodLabel": string|null,
    "asOfMonth": number|null,
    "asOfQuarter": "Q1"|"Q2"|"Q3"|"Q4"|null,
    "asOfYear": number|null,
    "sourceQuality": "high"|"medium"|"low",
    "needsAttention": boolean,
    "needsAttentionReasons": string[]
  },
  "cleanedItems": [],
  "analystNotes": {
    "oneLineRead": string|null,
    "dealRelevantFacts": string[],
    "marketNeighborhoodNotes": string[],
    "assetClassNotes": string[],
    "mixedUseRetailNotes": string[],
    "whereToHuntNotes": string[],
    "diligenceFlags": string[],
    "brokerClaims": string[],
    "conflicts": string[],
    "sourceLimitations": string[]
  },
  "provenance": [
    {"noteOrField": string, "sourceId": string|null, "pageNumber": number|null, "excerpt": string|null}
  ]
}

Rules:
- Keep Gemini/source page references attached to every cleaned item and analyst note.
- Convert obvious synonyms into consistent fields, but preserve the original label in provenance.
- Mark uncertain values as conflicts or needsAttention; do not silently pick the optimistic broker number.
- Excluded/duplicate/not-comparable decisions remain analyst-review decisions unless already specified in the stored review state.
- The analyst notes are the document-level summary that live market analysis should later roll up.
```

## User Review Questions

- Are the item types enough, or should retail lease comps get a separate `lease_comp` item type now?
- Should extracted comps default to `selectionDecision: "watch"` as proposed, or default to `include` when confidence is high?
- Should the model recommend `includeRecommended`, or should every inclusion decision remain manual?
