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
- LTR yield = reconstructed current NOI / purchase basis (the asset cap rate at ask). MTR yield = stabilized / rent-uplift NOI / purchase basis (the adjusted cap rate).

## Reconstructed NOI Basis (everywhere)

The LTR-yield numerator is always the **reconstructed basis** from `resolveAssetCapRateNoiBasis` (`underwritingModel.ts`): actual gross rent + other income (+ conservative projected lease-up rent) − expenses. The broker-stated NOI from the OM is only used when reconstruction is impossible (no rent or expense totals) or when an operator manually overrides current NOI.

This basis is used consistently by: the OM workspace calculation (`buildOmCalculation.ts`), the dossier + Excel (`runGenerateDossier.ts`, which also persists the basis into `dealDossier.summary.currentNoi` and the `deal_signals.current_noi` column), the pipeline screening API (`pipelineV2.ts` reconstructs live per row for `ltrYocPct`), and the operating-comps fallback (`routes/comps.ts` reconstructs from extracted rent/expenses before falling back to the broker NOI). Summaries persisted before this change still hold the broker NOI until the property is re-analyzed, but the pipeline's live reconstruction takes priority over the persisted summary, so the table is correct immediately.

## Yield Callouts

`apps/api/src/deal/yieldSignals.ts` is the single comparison point for yield callouts.

LTR vs MTR — whenever an analysis runs it computes the spread (MTR − LTR, in percentage points) and classifies it:

- `mtr_below_ltr` — MTR yield is below the LTR yield; the deal should be underwritten as an LTR play on its cap rate.
- `mtr_weak_uplift` — MTR beats LTR by less than the healthy-spread threshold (default 0.75 pt; override with env `MTR_MIN_YIELD_SPREAD_PCT`).
- `mtr_spread_outlier` — MTR beats LTR by more than the plausibility ceiling (default 5 pt; override with env `MTR_MAX_YIELD_SPREAD_PCT`). Spreads this large have meant data errors, not good deals — the known cause is the LLM extracting the same rent roll twice (one OM listed every unit under two label styles, doubling the unit-model gross and pushing MTR YoC to 14.6% against a 5.9% LTR).

Broker vs reconstructed (`computeBrokerYieldComparison`) — compares the broker's cap rate (OM-stated when listed, otherwise broker NOI ÷ purchase basis) against the reconstructed-actuals cap rate, and flags any divergence of at least 0.1 pt (override with env `BROKER_CAP_MIN_DELTA_PCT`):

- `broker_cap_above_reconstructed` — broker yield runs hot; typically the broker built it on pro forma rents while we underwrite off actuals.
- `broker_cap_below_reconstructed` — broker NOI nets out items (e.g. vacancy/credit loss) that the actuals basis does not.

The callouts are surfaced in the same three places: the OM calculation snapshot (`yieldSignals` + `brokerYieldComparison` fields + validation messages, shown in the OM workspace and the deal-analysis "Current outputs" card), deal signals (`yield_spread` column plus risk-flag entries; the dossier also records the broker comparison as a financial flag), and the pipeline screening API (`yocSpreadPct`/`mtrCallout*` and `brokerCapRatePct`/`brokerCapCallout*` on the underwriting summary; the table flags the YoC MTR and YoC LTR cells). The pipeline list also supports a `minLtrYoc` filter for sourcing on LTR yield.

## Saved OM Workspace Rows Are Authoritative

Once the operator saves the OM workspace (`PUT /api/properties/:id/dossier-settings` writes `dealDossier.assumptions.unitModelRows` / `expenseModelRows`), those saved rows ARE the underwriting model. `resolveDetailedCashFlowModel` (`detailedCashFlowModel.ts`) builds the resolved row set from the saved arrays:

- a saved row whose `rowId` still matches a snapshot source row keeps inheriting source defaults for untouched fields;
- a saved row with no source match is used as-is (user-added rows, or rows orphaned by a re-extraction);
- source rows with no saved counterpart are dropped — a cost or unit the user removed stays removed.

Re-running OM analysis (pipeline "Refresh listings", document-upload post-processing, `refreshOm` on dossier generation, enrichment) re-promotes `omData.authoritative` but can no longer push extracted numbers back into the dossier/Excel/signals over the user's saved edits. The snapshot only seeds the model while nothing has been saved yet. To re-base a workspace on a new OM, re-import it through the deal-analysis surfaces and save the reviewed rows — that save becomes the new authority.

## Deal Stage Never Auto-Regresses

`UI_V2_STATUS_FUNNEL_RANK` / `isForwardPipelineStatusMove` (`@re-sourcing/contracts dealFlow.ts`) order the ui-v2 pipeline statuses. Automatic flows only ever move a deal forward:

- OM arrival (`advancePipelineOnOmArrival`) advances to `om_received` through a single conditional SQL update — the pre-OM guard is re-checked at write time and only `uiV2Status` is merged into the stored pipeline object, so a concurrent move to tour/offer can't be clobbered by a stale copy.
- Outreach sends (`markOmRequestedFromOutreach`) skip any deal ranked past the outreach stage.
- OM/underwriting document uploads use `SavedDealsRepo.ensureSaved`, which inserts the saved-deal row if missing but never downgrades `deal_status`.
- "Save deal" on a property already past `saved` keeps its current stage (it only guarantees the saved_deals row + tag).
- Listing imports merge only the pipeline keys they own via `PropertyRepo.mergeDetailsKey`.

Only explicit user moves (board drag, status PATCH, deal-path edits, reject) may move a deal backward.

## Rent Roll De-duplication

`sanitizeOmRentRollRows` (`apps/api/src/rental/omAnalysisUtils.ts`) drops rent roll rows the extraction pulled twice: rows whose normalized unit identity (street-type words, unit prefixes, and ordinal/direction spelling variants stripped, so "219 E 59th - 2" ≡ "219 East 59th Street - 2") AND rent/sqft/beds/baths figures all match an earlier row. Rows without a unit label or without any rent figure are never deduped, and identical rents on distinct unit labels are kept, so legitimate twin units survive. Because every read path resolves the roll through this sanitizer, already-stored duplicated snapshots heal on the next assumption rebuild or dossier rerun.

Ingestion also writes `duplicate_rent_roll` validation flags (`apps/api/src/om/omValidationFlags.ts`) when duplicates were removed, when the roll has ≥ 2× the declared unit count, or when the roll's summed gross is ≥ 1.7× the stated gross rental income — the last two catch double-pulls that evade exact matching.
