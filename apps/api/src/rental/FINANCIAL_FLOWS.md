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

## Return Metric Definitions

- Cash-on-cash (year 1 and average) = (NOI − debt service) / initial equity. Recurring capex is intentionally excluded from the CoC numerator; it is included in unlevered cash flow ("CF after reserves") and in IRR via the levered cash flow series. The dossier Excel (`excelProForma.ts`) and the deal-analysis workbook (`dealAnalysisWorkbook.ts`) use the same definition (debt service is stored as a negative value in the sheets, so `NOI + debtService` is a subtraction).
- LTR yield = current NOI / purchase basis (the asset cap rate at ask). MTR yield = stabilized / rent-uplift NOI / purchase basis (the adjusted cap rate).

## LTR vs MTR Yield Callouts

`apps/api/src/deal/yieldSignals.ts` is the single comparison point for LTR vs MTR yields. Whenever an analysis runs it computes the spread (MTR − LTR, in percentage points) and classifies it:

- `mtr_below_ltr` — MTR yield is below the LTR yield; the deal should be underwritten as an LTR play on its cap rate.
- `mtr_weak_uplift` — MTR beats LTR by less than the healthy-spread threshold (default 0.75 pt; override with env `MTR_MIN_YIELD_SPREAD_PCT`).

The callout is surfaced in three places: the OM calculation snapshot (`yieldSignals` field + validation messages, shown in the OM workspace), deal signals (`yield_spread` column plus a risk-flag entry), and the pipeline screening API (`yocSpreadPct`, `mtrCalloutCode`, `mtrCalloutLabel` on the underwriting summary; the table flags the YoC MTR cell). The pipeline list also supports a `minLtrYoc` filter for sourcing on LTR yield.
