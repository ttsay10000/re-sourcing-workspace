# Render And Environment Checklist

## Services In `render.yaml`

- `re-sourcing-api`
- `re-sourcing-web`
- `re-sourcing-process-inbox`
- `re-sourcing-run-saved-searches`
- `re-sourcing-db`

The weekly enrich-all cron has been removed.

## API Service

Required env:

- `DATABASE_URL`
- `CORS_ORIGIN`
- `RAPIDAPI_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

Optional env:

- `SOCRATA_APP_TOKEN`
- `GEOCLIENT_SUBSCRIPTION_KEY`
- `GEMINI_OM_MODEL`
- `GEMINI_OM_TIMEOUT_MS`
- `GEMINI_OM_MAX_CONCURRENCY`
- `GEMINI_OM_THINKING_LEVEL`
- `PROCESS_INBOX_CRON_SECRET`
- `INQUIRY_DOCS_PATH`
- `UPLOADED_DOCS_PATH`
- `RENTAL_DEBUG`
- `RENTAL_SEARCH_FALLBACK`

Notes:

- `UPLOADED_DOCS_PATH` defaults to `uploads/property-docs`
- authoritative OM parsing now runs through Gemini PDF ingestion; set `GEMINI_API_KEY` on the API service and keep `GEMINI_OM_MODEL=gemini-3-flash-preview` unless you are intentionally testing another model
- dossier generation is serialized per API process; Gemini OM parsing is also serialized by default with `GEMINI_OM_MAX_CONCURRENCY=1`
- Gemini 3 OM extraction defaults to `GEMINI_OM_THINKING_LEVEL=low` unless you override it
- inquiry attachments, uploaded property docs, and generated docs store file bytes in the DB, so new files can still be downloaded on ephemeral disks
- after deploying this change, run `npm run backfill:documents -w @re-sourcing/api` once before the next restart/redeploy if you need older disk-only files preserved too
- large uploads can still be blocked by the Render proxy before they reach the app

## Web Service

Required env:

- `NEXT_PUBLIC_API_URL`

This value is build-time for Next.js. Rebuild the web app after changing it.
Render Blueprint references do not expose another service's public URL directly, so `NEXT_PUBLIC_API_URL` still needs to be set on the web service explicitly.

## Inbox Cron

Service:

- `re-sourcing-process-inbox`

Required env:

- `DATABASE_URL`

Optional env:

- `PROCESS_INBOX_CRON_SECRET`
- `INQUIRY_DOCS_PATH`

All Gmail/OpenAI credentials are inherited from `re-sourcing-api` via `fromService`.
Gemini OM parser credentials are also inherited from `re-sourcing-api` via `fromService`.

Schedule in blueprint:

- `0 9 * * *`

Behavior:

- reads Gmail inbox
- matches replies by subject, broker email, or thread
- stores inquiry emails and attachments on the property
- runs Gemini authoritative OM ingestion when OM PDFs are present
- inherits Gmail/OpenAI/Gemini credentials from `re-sourcing-api` via `fromService`

## Saved Search Cron

Service:

- `re-sourcing-run-saved-searches`

Required env:

- `DATABASE_URL`

Optional env:

- `SOCRATA_APP_TOKEN`
- `GEOCLIENT_SUBSCRIPTION_KEY`

All shared runtime credentials are inherited from `re-sourcing-api` via `fromService`.

Schedule in blueprint:

- `0 13 * * *`

Behavior:

- runs once daily from Render
- evaluates saved searches against their stored cadence/timezone schedule
- starts any enabled searches due on the current local calendar day
- advances `nextRunAt` before launching each search so the daily tick does not double-trigger later that day
- inherits RapidAPI/OpenAI/Socrata/Geoclient credentials from `re-sourcing-api` via `fromService`

## Gmail Setup

1. Enable Gmail API in Google Cloud Console.
2. Create OAuth credentials.
3. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. Use OAuth 2.0 Playground to generate a refresh token with:
   - `gmail.readonly`
   - `gmail.send`
5. Set the Gmail credentials on the API service. The inbox cron inherits them from `re-sourcing-api`.

## Manual Trigger For Inbox Processing

You can manually run inbox processing by calling:

- `POST /api/cron/process-inbox`

If `PROCESS_INBOX_CRON_SECRET` is set, include either:

- `X-Cron-Secret: <secret>`
- `Authorization: Bearer <secret>`

## Deployment Checklist

1. Create Render Postgres.
2. Apply the repo blueprint.
3. Set shared API env vars once.
4. Set web env vars.
5. Deploy.
6. Verify:
   - `GET /api/health`
   - StreetEasy Agent run works
   - send inquiry email works
   - inbox cron can run successfully
   - saved-search cron can start due searches successfully
