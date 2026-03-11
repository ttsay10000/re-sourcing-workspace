# OM Ingestion V2 Implementation Spec

This document defines the next implementation step for replacing the current OM ingestion flow with a staged, reviewable, extraction-first pipeline.

It is intended to drive database migrations, worker/service implementation, API changes, property-page changes, and underwriting/dossier precedence rules.

## 1. Problem Statement

The current OM ingestion path has four issues:

1. It is not a true document-analysis pipeline.
   Uploads and inbox attachments go from `pdf-parse` text extraction into an OM-style LLM call, with no page classification, table-region detection, or bounded OCR step.

2. It mixes extraction with analysis.
   The current prompt asks for underwriting metrics, furnished scenarios, and offer analysis during ingestion.

3. It stores merged composite output instead of immutable runs.
   LLM output, deterministic fallback output, and prior parse results can be blended into the same `rentalFinancials` object.

4. Downstream calculations still use non-OM fallbacks.
   Dossier generation, scoring, and property assumptions can still pull from `fromLlm`, `uiFinancialSummary`, RapidAPI unit counts, or inferred rows when OM data is partial.

## 2. Objectives

OM Ingestion V2 must:

- analyze OM structure before extraction
- detect relevant financial regions before OCR
- extract broker-reported values without normalization
- preserve exact source values and page provenance
- store each OM parse as an immutable run
- promote only vetted OM output into the authoritative property snapshot
- ensure authoritative OM data is the only broker-data source used in property financial calculations when present

OM Ingestion V2 must not:

- compute underwriting assumptions
- create recommended offers
- normalize broker values into downstream operating assumptions
- silently backfill missing OM values with listing/fallback values inside calculations

## 3. Architecture Decision

### 3.1 Service Boundary

The three-agent document-analysis stack should be implemented as a separate Python worker/service, not inside the existing Node API process.

Reason:

- the proposed tooling is Python-first: `pdfplumber`, `pdf2image`, `layoutparser`, `opencv`, optional `detectron2`
- the current repo runtime is Node/TypeScript only
- OCR/table-region work should be isolated from request/response latency and API memory pressure

### 3.2 High-Level Flow

1. User uploads OM, brochure, rent roll, or inbox attachment is saved.
2. API creates an `om_ingestion_run` row and enqueues work.
3. Python worker fetches the document bytes and runs:
   - Document Structure Agent
   - Financial Table Locator Agent
   - Rent Roll Parsing Agent
   - extraction engine
   - validation pass
4. Worker stores run artifacts, extracted values, page map, regions, and validation flags.
5. API or worker evaluates promotion rules.
6. If promotion passes, the run becomes the active authoritative OM snapshot for the property.
7. Property page, score, underwriting, and dossier read from the authoritative OM snapshot only.

## 4. New Source-of-Truth Model

The system must separate:

- raw listings and rental API data
- inferred or fallback extraction
- historical OM ingestion runs
- the currently promoted authoritative OM snapshot

### 4.1 Proposed Property Detail Structure

Keep legacy `details.rentalFinancials` during transition, but add a new root object:

```json
{
  "omData": {
    "activeRunId": "uuid",
    "status": "promoted",
    "snapshotVersion": 2,
    "authoritative": {
      "propertyInfo": {},
      "rentRoll": [],
      "incomeStatement": {},
      "expenses": {},
      "validationFlags": [],
      "coverage": {},
      "sourceMeta": {}
    }
  }
}
```

Rules:

- `omData.authoritative` is the only OM object used by dossier/scoring/property financial calculations
- `details.rentalFinancials` becomes supplemental and transitional only
- OM historical runs remain queryable and reviewable, but not calculation inputs unless promoted

## 5. Database Additions

Add new SQL migrations under `packages/db/migrations`.

### 5.1 `om_ingestion_runs`

One row per parse attempt.

Suggested columns:

- `id uuid primary key`
- `property_id uuid not null`
- `source_document_id uuid null`
- `source_type text not null`
  - `uploaded`
  - `inquiry`
  - `manual_refresh`
- `document_category text null`
  - `OM`
  - `Brochure`
  - `Rent Roll`
  - `T12 / Operating Summary`
- `status text not null`
  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `promoted`
  - `rejected`
- `pipeline_version text not null`
- `started_at timestamptz null`
- `finished_at timestamptz null`
- `error_message text null`
- `promotion_decision jsonb null`
- `created_at timestamptz not null default now()`

### 5.2 `om_page_classifications`

One row per page per run.

Suggested columns:

- `id uuid primary key`
- `run_id uuid not null`
- `page_number int not null`
- `page_type text not null`
- `extraction_method_candidate text not null`
  - `text_table`
  - `ocr_table`
  - `ignore`
- `text_density numeric null`
- `image_density numeric null`
- `numeric_density numeric null`
- `detected_keywords jsonb null`
- `layout_blocks jsonb null`
- `created_at timestamptz not null default now()`

### 5.3 `om_table_regions`

Detected regions for OCR or text extraction.

Suggested columns:

- `id uuid primary key`
- `run_id uuid not null`
- `page_number int not null`
- `region_type text not null`
  - `financial_table`
  - `rent_roll`
  - `income_statement`
  - `expense_table`
- `bbox jsonb not null`
- `detector text not null`
- `confidence numeric null`
- `created_at timestamptz not null default now()`

### 5.4 `om_extracted_snapshots`

Immutable structured result for a run.

Suggested columns:

- `run_id uuid primary key`
- `extraction_method text not null`
  - `text_tables`
  - `ocr_tables`
  - `hybrid`
- `property_data jsonb null`
- `rent_roll jsonb null`
- `income_statement jsonb null`
- `expenses jsonb null`
- `validation_flags jsonb null`
- `coverage jsonb null`
- `source_meta jsonb null`
- `created_at timestamptz not null default now()`

### 5.5 `om_authoritative_snapshots`

Active promoted OM snapshot per property.

Suggested columns:

- `property_id uuid primary key`
- `run_id uuid not null unique`
- `snapshot jsonb not null`
- `promoted_at timestamptz not null default now()`
- `promoted_by text not null`
  - `system`
  - `manual`
- `created_at timestamptz not null default now()`

## 6. Worker Pipeline

### 6.1 Document Structure Agent

Inputs:

- document bytes
- filename
- property id

Outputs:

- one `om_page_classifications` row per page
- candidate extraction method per page

Page types:

- `COVER_PAGE`
- `PROPERTY_OVERVIEW`
- `FINANCIAL_SECTION_HEADER`
- `FINANCIAL_OVERVIEW`
- `RENT_ROLL`
- `INCOME_EXPENSE`
- `PROPERTY_DESCRIPTION`
- `FLOOR_PLANS`
- `MAPS`
- `PHOTOS`
- `BROKER_INFO`
- `DISCLAIMERS`
- `IRRELEVANT`

### 6.2 Financial Table Locator Agent

Runs only on:

- `FINANCIAL_OVERVIEW`
- `RENT_ROLL`
- `INCOME_EXPENSE`

Outputs:

- `om_table_regions`
- page-region crop metadata for OCR

Rule:

- OCR must run only within detected table regions

### 6.3 Rent Roll Parsing Agent

Responsibilities:

- detect header row
- detect columns
- reconstruct rows
- preserve current values exactly as shown
- identify row completeness
- flag placeholders separately from broker-provided blanks

Important distinction:

- broker-provided blank unit row is allowed
- system-generated placeholder row is not authoritative

### 6.4 Extraction Engine

Decision matrix:

- `text_table` -> extract with native PDF text parsing
- `ocr_table` -> extract from cropped region only
- `ignore` -> do not extract

Output must preserve:

- original broker label
- original broker string value
- parsed numeric value if safely parseable
- page number
- bbox if available
- parser name

## 7. Output Contract

The worker should return a structured payload equivalent to:

```json
{
  "extractionMethod": "hybrid",
  "pageClassification": [],
  "propertyData": {},
  "rentRoll": [],
  "incomeStatement": {},
  "expenses": {},
  "validationFlags": [],
  "coverage": {},
  "sourceMeta": {}
}
```

### 7.1 Coverage Fields

Coverage must be explicit and machine-usable.

Suggested coverage keys:

- `propertyInfoExtracted`
- `rentRollExtracted`
- `incomeStatementExtracted`
- `expensesExtracted`
- `currentFinancialsExtracted`
- `unitCountExtracted`
- `pageCountAnalyzed`
- `financialPagesDetected`
- `ocrPagesUsed`
- `placeholderRowsGenerated`
- `brokerBlankRowsObserved`

## 8. Promotion Rules

A run should be promoted into `om_authoritative_snapshots` only if it passes minimum coverage.

### 8.1 Promotion Requirements

Minimum:

- property info present with at least one of:
  - `totalUnits`
  - `unitsResidential`
  - `buildingSqft`
  - `annualTaxes`
- at least one current-state financial anchor present:
  - `gross_potential_rent`
  - `effective_gross_income`
  - `total_expenses`
  - `reported_noi`
- no system-generated placeholder rent rows in the promoted rent roll

Preferred:

- rent roll coverage aligned to stated unit count
- expense table extracted
- current-state values available without needing inferred math

### 8.2 Rejection Rules

Do not promote when:

- only fallback/inferred values are present
- rent roll is populated mainly by system-generated placeholder rows
- OCR failed on all financial pages
- document is mostly non-financial marketing material with no current-state broker numbers

Rejected runs still remain queryable for review.

## 9. OM Priority Rules For Calculations

This is the critical downstream behavior change.

### 9.1 When an authoritative OM snapshot exists

The following calculation inputs must come only from the authoritative OM snapshot:

- unit count
- rent roll rows
- current gross rent
- other income
- vacancy loss
- effective gross income
- operating expense total
- expense line items
- reported NOI
- annual taxes when used in OM-based underwriting context
- commercial/residential mix used for uplift gating

When any of those fields are missing in the authoritative OM snapshot:

- return `null`
- surface a data completeness warning
- do not silently backfill from RapidAPI, listing text, `fromLlm`, or placeholder rows for deal math

### 9.2 What remains external truth

The following must not be overwritten by OM:

- BBL
- HPD registration
- DOB complaints
- DOB violations
- zoning
- tax class if external system is more authoritative

OM values can be stored and compared, but discrepancies become validation flags, not silent overrides.

## 10. API Changes

### 10.1 New Endpoints

- `POST /api/properties/:id/om-ingestion/run`
  - enqueue ingestion for one document or active OM-like documents

- `GET /api/properties/:id/om-ingestion/runs`
  - list historical runs

- `GET /api/properties/:id/om-ingestion/runs/:runId`
  - fetch page map, regions, extracted snapshot, promotion decision

- `POST /api/properties/:id/om-ingestion/runs/:runId/promote`
  - manual promotion override

- `POST /api/properties/:id/om-ingestion/runs/:runId/reject`
  - manual rejection

### 10.2 Existing Endpoint Changes

- `POST /api/properties/:id/documents/upload`
  - enqueue OM V2 ingestion for OM-like categories
  - stop directly merging parse output into `details.rentalFinancials`

- `POST /api/properties/:id/refresh-om-financials`
  - replace with V2 ingestion refresh semantics

- `GET /api/properties/:id`
  - include `omData.activeRunId`
  - include authoritative OM coverage summary
  - include latest validation flags

## 11. Code Changes Required In Current Consumers

### 11.1 New Resolver Layer

Add a new resolver module in the API app, for example:

- `apps/api/src/om/resolveAuthoritativeOmSnapshot.ts`

Core functions:

- `getAuthoritativeOmSnapshot(details): AuthoritativeOmSnapshot | null`
- `resolveAuthoritativeCurrentFinancials(details): ResolvedCurrentFinancials`
- `resolveAuthoritativeExpenseRows(details): ExpenseRow[]`
- `resolveAuthoritativeUnitCount(details): number | null`
- `hasAuthoritativeOmSnapshot(details): boolean`

### 11.2 Replace Current Calculation Inputs

Update these consumers to use the authoritative OM resolver:

- `apps/api/src/rental/currentFinancials.ts`
- `apps/api/src/deal/runGenerateDossier.ts`
- `apps/api/src/deal/computeDealSignals.ts`
- `apps/api/src/deal/propertyAssumptions.ts`

### 11.3 Required Behavior Changes

Current behavior to remove:

- using `fromLlm` as a calculation fallback when OM exists
- using `uiFinancialSummary` as a proxy for current financials when authoritative OM fields are missing
- taking the highest available unit count across OM, RapidAPI, and fallback rows
- using placeholder or inferred rows in rent-roll totals

Replacement behavior:

- if authoritative OM exists, calculations use only authoritative OM broker fields
- if authoritative OM is incomplete, calculations remain incomplete and say so explicitly

## 12. Property Page Changes

The property page should display three tiers of financial data:

1. `Authoritative OM`
2. `Supplemental market/listing data`
3. `Validation discrepancies`

### 12.1 Authoritative OM Panel

Display:

- property summary
- rent roll
- income statement
- expenses
- coverage indicators
- page/source provenance

### 12.2 Supplemental Panel

Display separately:

- RapidAPI rental units
- listing-text extraction
- legacy fallback values

Rules:

- supplemental values do not appear in authoritative totals
- placeholder rows must be visually labeled
- dossier CTA should show whether authoritative OM coverage is sufficient

## 13. Migration Strategy

### Phase 1

- add DB tables
- add worker scaffold
- add run queue + status tracking
- keep current V1 flow live

### Phase 2

- dual-run V1 and V2 on uploads and inbox attachments
- store V2 results only
- do not promote automatically yet

### Phase 3

- implement promotion rules
- add authoritative OM resolver
- switch dossier/scoring/property assumptions to authoritative OM inputs

### Phase 4

- switch property page to authoritative OM panel
- de-emphasize legacy `rentalFinancials`

### Phase 5

- retire direct OM merges into `details.rentalFinancials`
- keep legacy object only as historical compatibility layer if still needed

## 14. Testing Plan

### 14.1 Benchmark Corpus

Create a benchmark set of 20-40 OMs including:

- text-based tables
- scanned/image-based tables
- mixed-use assets
- package OMs
- incomplete rent rolls
- broker formats with current vs pro forma columns

### 14.2 Assertions

Measure:

- page classification accuracy
- financial page recall
- table-region recall
- rent-roll row completeness
- current NOI extraction accuracy
- expense-table extraction accuracy
- promotion precision

### 14.3 Regression Tests

Add tests covering:

- authoritative OM blocks fallback math
- incomplete authoritative OM returns `null` instead of silent backfill
- unit count no longer uses `Math.max` across RapidAPI and fallback rows once OM is promoted
- placeholder rows are excluded from authoritative totals

## 15. Initial Ticket Breakdown

1. Add OM V2 schema and repos in `packages/db`
2. Add OM ingestion workflow run type and board columns in API
3. Scaffold Python worker service with health check and run executor
4. Implement Document Structure Agent
5. Implement Financial Table Locator Agent
6. Implement Rent Roll Parsing Agent
7. Implement extracted snapshot persistence and promotion logic
8. Add authoritative OM resolver in API
9. Update dossier/scoring/assumptions to use authoritative OM only
10. Update property page to show authoritative OM, supplemental data, and validation flags
11. Add benchmark harness and regression tests

## 16. Immediate Next Coding Step

The next coding step should not be worker implementation yet.

It should be the data-contract and precedence foundation:

1. add OM V2 DB tables and repo methods
2. add `omData` authoritative snapshot shape to contracts
3. add authoritative OM resolver functions in the API
4. refactor dossier/scoring/assumptions to read from the resolver
5. keep resolver returning `null` for now until V2 ingestion is implemented

This sequence is intentional:

- it decouples downstream math from legacy fallback behavior first
- it creates a clear insertion point for the new worker output
- it prevents new ingestion work from being blocked by unresolved precedence rules

