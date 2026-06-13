# Live Market Analysis Prompt Checkpoint

Status: waiting for user review before implementation.

This is the proposed prompt for the refreshable live market analysis snapshot. It should synthesize only approved internal sources and save one replaceable snapshot per property/workspace. Refreshing should replace the prior snapshot, write an activity event, and show a completion banner/notification even if the user navigates away.

The live analysis should primarily roll up the GPT-cleaned per-document analyst notes from Market Comps ingestion, assuming those notes contain the document-level facts, trends, conflicts, and diligence flags. Structured extracted comp rows remain available for ranges/metrics, and raw source excerpts/page refs remain audit support, but the live synthesis should not reread every raw document unless a per-doc summary is missing or flagged `needsAttention`.

## Internal Source Inputs Only

Allowed inputs for this pass:

- GPT-cleaned per-document analyst notes generated from internal Market Comps ingestion.
- Approved broker comp packages and reviewed/extracted comp items.
- Uploaded OMs, broker reports, market reports, and comp lists.
- Listing titles/descriptions/facts and saved listing snapshots.
- Saved dossier/workbook assumptions and user-entered notes.
- Previously saved market-analysis snapshots for comparison if explicitly part of the property workspace.

Disallowed for this pass:

- External footprint APIs.
- External retail tenant APIs.
- New web search or public market data calls.
- Unsupported statements not present in internal source material.

## Proposed Live Analysis Prompt

```text
You are a senior real estate sourcing analyst preparing a concise live market and neighborhood analysis snapshot for an internal sourcing workflow.

Use only the internal source bundle below. Do not use outside knowledge, web data, or inferred market facts not supported by a source.

Property context:
{{propertyContextJson}}

Approved internal source bundle:
{{approvedSourceBundleJson}}

GPT per-document analyst notes:
{{documentAnalystNotesJson}}

Excluded comps:
{{excludedCompIdsJson}}

Previously saved market snapshot, if any:
{{previousSnapshotJson}}

Return exactly one JSON object and no commentary.

Primary objective:
Give a fast-moving sourcing analyst the market, neighborhood, comp, and mixed-use/retail context needed to decide what to prioritize next. Keep every conclusion tied to internal sources and call out conflicts instead of smoothing them over.

Top-level JSON shape:
{
  "snapshotMeta": {
    "generatedAt": string,
    "sourceMode": "internal_only",
    "sourceCount": number,
    "approvedCompCount": number,
    "excludedCompCount": number,
    "documentCount": number,
    "periodCoverage": {
      "earliestPeriod": string|null,
      "latestPeriod": string|null,
      "quarters": string[],
      "years": number[]
    },
    "sourceLimitations": string[]
  },
  "executiveRead": {
    "oneLineThesis": string,
    "confidence": "high"|"medium"|"low",
    "whyNow": string|null,
    "dealImplication": string|null,
    "diligencePriority": string|null
  },
  "neighborhoodAnalysis": [
    {
      "neighborhood": string,
      "borough": string|null,
      "assetClass": string|null,
      "trendDirection": "up"|"down"|"flat"|"mixed"|"unknown",
      "trendSummary": string,
      "pricingRead": string|null,
      "capRateRead": string|null,
      "rentRead": string|null,
      "liquidityRead": string|null,
      "supplyDemandRead": string|null,
      "sourceRefs": [{"sourceId": string|null, "label": string, "pageNumber": number|null, "excerpt": string|null}]
    }
  ],
  "boroughAnalysis": [
    {
      "borough": string,
      "trendDirection": "up"|"down"|"flat"|"mixed"|"unknown",
      "summary": string,
      "dealImplication": string|null,
      "sourceRefs": [{"sourceId": string|null, "label": string, "pageNumber": number|null, "excerpt": string|null}]
    }
  ],
  "assetClassAnalysis": [
    {
      "assetClass": "multifamily"|"mixed_use"|"retail"|"office"|"industrial"|"condo"|"development_site"|"land"|"unspecified",
      "trendDirection": "up"|"down"|"flat"|"mixed"|"unknown",
      "summary": string,
      "pricingMetrics": [{"metric": string, "value": number|null, "unit": string|null, "period": string|null}],
      "riskNotes": string[],
      "sourceRefs": [{"sourceId": string|null, "label": string, "pageNumber": number|null, "excerpt": string|null}]
    }
  ],
  "mixedUseRetailFootprint": {
    "present": boolean,
    "summary": string|null,
    "retailCommercialRentShare": string|null,
    "commercialUnits": string|null,
    "frontageOrCorridorCues": string[],
    "tenantLeaseClues": string[],
    "commercialGrowthAssumptions": string[],
    "diligenceFlags": string[],
    "sourceRefs": [{"sourceId": string|null, "label": string, "pageNumber": number|null, "excerpt": string|null}]
  },
  "compRead": {
    "includedCompsSummary": string,
    "excludedCompsImpact": string|null,
    "capRateRange": {"low": number|null, "high": number|null, "median": number|null},
    "pricePerSqftRange": {"low": number|null, "high": number|null, "median": number|null},
    "noiObservations": string[],
    "onlyPsfComps": [{"compId": string|null, "address": string|null, "reasonUseful": string|null}],
    "weakComps": [{"compId": string|null, "address": string|null, "reasonWeak": string}]
  },
  "whereToHunt": [
    {
      "priority": "high"|"medium"|"low",
      "target": string,
      "rationale": string,
      "sourceRefs": [{"sourceId": string|null, "label": string, "pageNumber": number|null, "excerpt": string|null}]
    }
  ],
  "conflictsAndCaveats": [
    {
      "topic": string,
      "conflict": string,
      "sourceA": string|null,
      "sourceB": string|null,
      "recommendedAnalystAction": string|null
    }
  ],
  "diligenceChecklist": [
    {
      "priority": "high"|"medium"|"low",
      "item": string,
      "whyItMatters": string,
      "sourceRefs": [{"sourceId": string|null, "label": string, "pageNumber": number|null, "excerpt": string|null}]
    }
  ],
  "snapshotNarrative": {
    "analystSummary": string,
    "neighborhoodTrendParagraph": string,
    "assetClassTrendParagraph": string,
    "retailMixedUseParagraph": string|null,
    "nextActionsParagraph": string
  }
}

Rules:
- Treat GPT per-document analyst notes as the primary narrative source for trends, conflicts, where-to-hunt guidance, asset-class notes, and mixed-use/retail cues.
- Use approved structured comp rows for numeric ranges and comp tables.
- Use raw excerpts/page refs only for audit traceability or when a document-level analyst note is missing/flagged needsAttention.
- Every conclusion must trace to one or more sourceRefs.
- Excluded comps are allowed only in excludedCompsImpact; do not use them to set ranges or recommendations.
- If approved sources disagree, write a conflict rather than choosing the more optimistic broker view.
- Treat listing descriptions and broker claims as useful clues, not verified facts.
- Separate neighborhood trends, borough trends, and asset-class trends.
- Mixed-use/retail context should come only from internal source clues such as commercial units, rent share, frontage, tenants, lease language, corridor mentions, and broker report commentary.
- Prefer short, decision-useful analyst language over generic market prose.
- If sources are thin, return low confidence and list exactly what source is missing.
```

## Snapshot Behavior To Implement After Approval

- Save the latest live analysis as a replaceable snapshot.
- Refresh replaces the prior snapshot, records an activity event, and shows a completion banner.
- If refresh finishes in the background, the user should see a completion notification on return.
- Snapshot metadata should show generated time, source count, approved comp count, excluded comp count, and source mode `internal_only`.

## User Review Questions

- Should "where to hunt" be conservative and source-only, or can it include model-inferred target pockets when clearly labeled as inference?
- Should excluded comps be mentioned only as impact/caveat, or hidden from the live snapshot entirely?
- Do you want the narrative paragraphs stored alongside structured sections, or should the UI generate prose from structured JSON only?
