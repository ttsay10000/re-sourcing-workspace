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
