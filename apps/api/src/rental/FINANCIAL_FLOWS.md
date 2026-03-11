# Financial Flows

## Two Financial Sources On A Property

1. **Rental flow**
2. **OM / senior-analyst extraction**

Both write into `property.details.rentalFinancials`.

## 1. Rental Flow

What it does:

- fetches rental/unit data
- runs listing-text extraction
- writes rental units and top-line financials

When it runs:

- automatically during `POST /api/properties/from-listings`
- manually through `POST /api/properties/run-rental-flow`

## 2. OM / Senior-Analyst Extraction

What it does:

- extracts text from OM/Brochure-like source material
- runs OM-style LLM extraction with enrichment context
- writes:
  - `rentalFinancials.omAnalysis`
  - `rentalFinancials.fromLlm`

Where it can run:

1. manual upload of `OM` / `Brochure`
2. inbox reply processing
3. `POST /api/properties/run-enrichment`

## Priority Rule

Manual upload is the preferred source of truth.

Reason:

- operators may upload a cleaner or corrected OM when inbox parsing is incomplete, noisy, or formatted poorly

## Practical Interpretation

- inbox processing is still allowed to populate OM analysis
- re-run enrichment is still allowed to refresh OM analysis from uploaded docs
- but when an operator manually uploads an OM/Brochure, that is the highest-signal source and should be treated as the intended correction path

## Inbox Dedupe

Inbox processing is deduped by Gmail message ID.

Within one run, the same Gmail message is not processed twice across:

- subject matching
- broker-email matching
- thread matching

Across runs, already-saved messages are skipped.

## UI Behavior

The property UI prefers OM-style analysis when present and falls back to rental-flow output when there is no OM analysis.
