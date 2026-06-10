# API And Data Flow

This document is the current high-level source of truth for runtime behavior.

## Main System Stages

### 1. StreetEasy Agent

Internal endpoints:

- `POST /api/test-agent/run`
- `GET /api/test-agent/runs`
- `GET /api/test-agent/runs/:id`
- `POST /api/test-agent/runs/:id/send-to-property-data`
- `GET /api/test-agent/property-data/runs`
- `DELETE /api/test-agent/property-data`

Behavior:

1. Search active sale listings from the NYC Real Estate API
2. Fetch sale details for each listing URL
3. Keep run data in memory until an operator sends the run into raw listings

External dependency:

- RapidAPI NYC Real Estate API
  - `GET /sales/search`
  - `GET /sales/url`

### 2. Raw Listings

Internal endpoints:

- `GET /api/listings`
- `GET /api/listings/:id`
- `GET /api/listings/duplicate-candidates`
- `DELETE /api/listings/:id`

Behavior:

- Raw listings are created only when a StreetEasy Agent run is manually sent to property data.
- Duplicate scoring is recomputed during that persistence step.

### 3. Canonical Properties

Internal endpoints:

- `GET /api/properties`
- `POST /api/properties/from-listings`
- `POST /api/properties/run-enrichment`
- `POST /api/properties/run-rental-flow`
- `POST /api/properties/:id/refresh-om-financials`
- `GET /api/properties/:id`
- `GET /api/properties/:id/listing`
- `GET /api/properties/pipeline-stats`

Behavior:

- `from-listings` creates canonical properties from active raw listings
- `from-listings` still runs:
  - enrichment automatically
  - rental flow automatically
- operators can manually re-run:
  - enrichment
  - rental flow
  - OM financial refresh

External dependencies:

- NYC Open Data / Socrata
- NYC Geoclient
- OpenAI
- RapidAPI NYC Real Estate API rental endpoints

### 4. Documents

Internal endpoints:

- `GET /api/properties/:id/documents`
- `GET /api/properties/:id/documents/:docId/file`
- `DELETE /api/properties/:id/documents/:docId`
- `POST /api/properties/:id/documents/upload`

Unified document list includes:

- inquiry reply attachments
- manual uploads
- generated outputs such as dossier / Excel

There is no separate uploaded-documents API surface anymore.
New inquiry, uploaded, and generated documents store file bytes in Postgres and can still be served after Render restarts.
Run `npm run backfill:documents -w @re-sourcing/api` once to copy older disk-only records into Postgres before a restart or redeploy.

### 5. Inquiry Email And Inbox Processing

Internal endpoints:

- `POST /api/properties/:id/send-inquiry-email`
- `GET /api/properties/:id/inquiry-emails`
- `POST /api/cron/process-inbox`

Behavior:

- operators send inquiry emails manually
- inbox processing runs from the Render cron or manual trigger endpoint
- message dedupe is keyed by Gmail `message_id`
- one run will not process the same Gmail message twice across subject-match, broker-match, and thread-match phases

External dependency:

- Gmail API

### 6. Deal Analysis / Dossier

Internal endpoints:

- `POST /api/properties/:id/compute-score`
- dossier/deal routes under `/api/dossier` and `/api/deals`

Behavior:

- underwriting and scoring are manual/operator-driven
- generated outputs are stored as unified property documents

## External Systems

### RapidAPI NYC Real Estate API

Used for:

- StreetEasy Agent listing search and sale detail fetch
- rental flow

Required env:

- `RAPIDAPI_KEY`

### NYC Open Data / Socrata

Used for:

- permits
- zoning
- certificate of occupancy
- HPD registration
- HPD violations
- DOB complaints
- housing litigations
- affordable housing

Optional env:

- `SOCRATA_APP_TOKEN`

### Gmail API

Used for:

- send inquiry emails
- process broker replies / attachments

Required env for inbox flow:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

### OpenAI API

Used for:

- broker enrichment
- rental listing financial extraction
- OM/Brochure extraction
- inquiry email extraction

Required env:

- `OPENAI_API_KEY`

## Automation Boundaries

Automatic:

- `from-listings` enrichment
- `from-listings` rental flow
- OM extraction after manual upload
- inbox processing via cron

Manual:

- sending StreetEasy Agent results into raw listings
- creating canonical properties from raw listings
- re-run enrichment
- re-run rental flow
- send inquiry email
- compute score
- generate dossier

## OM Extraction Priority

OM extraction may happen from:

1. manual OM/Brochure upload
2. inbox reply processing
3. re-run enrichment

Priority rule:

- manual upload is the preferred source when operators intentionally provide a cleaner or corrected OM

## Storage Notes

- StreetEasy Agent run state is still in memory
- raw listings / canonical properties / enrichment / docs are persisted in Postgres
- inquiry attachments, uploaded property docs, and generated docs store file bytes in the DB so unified downloads can work even on ephemeral disk environments

## Market Knowledge Base And Headlines

The market-context layer (market-docs page → Yield Map) maintains a living, cumulative market narrative on top of the per-document ingest pipeline.

Pipeline (per upload, after rollup/synthesis):

1. classify → extract → dedupe comps → store stats → neighborhood rollups (existing stages)
2. analyst brief + knowledge merge (prompt `knowledge_v1`): the model receives the current knowledge base, this upload's comps/stats, and prior stats + rollups for the same metrics/geographies, and returns `{document_brief, knowledge}`. When no LLM key is configured or output fails validation, a deterministic numbers-only brief + merge runs instead — ingest never blocks on a model.

Endpoints:

- `POST /api/market-docs` — ingest report now includes `brief` (per-upload analyst brief) and `knowledgeVersion`
- `GET /api/market-docs` — document rows now carry `documentBrief`
- `GET /api/market-knowledge` — `{ knowledge: { version, updatedAt, narrative, latestBrief, documentId } | null }`; narrative groups per-submarket direction (with bps/$PSF/% numbers), asset-type attention (free-market sub-9-unit, RS share, north vs south of 96th St), cap-rate/$PSF movements, open discrepancies, and publisher+period citations
- `GET /api/market-headlines` — `{ headlines: [{ id, text, tone: up|down|neutral|watch, scope, source, asOf }], generatedAt, knowledgeVersion }`; top 3-6 numbered bullets from the knowledge base, with a rule-based fallback computed from `neighborhood_summaries`/`market_stats` deltas when the knowledge base is empty; never returns 500

Tables (migration `060_market_knowledge.sql`):

- `market_knowledge_entries` — append-only, versioned; each ingest appends one row with the FULL updated narrative + the triggering document's brief (auditable history; latest version = current state)
- `market_documents.document_brief` — JSONB analyst brief per upload ({ title, whatItSays, comparedToPrior, discrepancies, incorporatedAt })
- `market_llm_outputs` — raw model output for the merge step persisted under the new `knowledge` stage (prompt version `knowledge_v1`)
