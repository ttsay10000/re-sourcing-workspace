# Render And Environment Checklist

## Services In `render.yaml`

- `re-sourcing-api`
- `re-sourcing-web`
- `re-sourcing-process-inbox`
- `re-sourcing-db`

The weekly enrich-all cron has been removed.

## API Service

Required env:

- `DATABASE_URL`
- `CORS_ORIGIN`
- `RAPIDAPI_KEY`
- `OPENAI_API_KEY`

Optional env:

- `SOCRATA_APP_TOKEN`
- `GEOCLIENT_SUBSCRIPTION_KEY`
- `PROCESS_INBOX_CRON_SECRET`
- `INQUIRY_DOCS_PATH`
- `UPLOADED_DOCS_PATH`
- `RENTAL_DEBUG`
- `RENTAL_SEARCH_FALLBACK`

Notes:

- `UPLOADED_DOCS_PATH` defaults to `uploads/property-docs`
- inquiry attachments, uploaded property docs, and generated docs store file bytes in the DB, so new files can still be downloaded on ephemeral disks
- after deploying this change, run `npm run backfill:documents -w @re-sourcing/api` once before the next restart/redeploy if you need older disk-only files preserved too
- large uploads can still be blocked by the Render proxy before they reach the app

## Web Service

Required env:

- `NEXT_PUBLIC_API_URL`

This value is build-time for Next.js. Rebuild the web app after changing it.

## Inbox Cron

Service:

- `re-sourcing-process-inbox`

Required env:

- `DATABASE_URL`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `OPENAI_API_KEY`

Optional env:

- `PROCESS_INBOX_CRON_SECRET`
- `INQUIRY_DOCS_PATH`

Schedule in blueprint:

- `0 9 * * *`

Behavior:

- reads Gmail inbox
- matches replies by subject, broker email, or thread
- stores inquiry emails and attachments on the property
- runs OM-style extraction when readable content is present

## Gmail Setup

1. Enable Gmail API in Google Cloud Console.
2. Create OAuth credentials.
3. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. Use OAuth 2.0 Playground to generate a refresh token with:
   - `gmail.readonly`
   - `gmail.send`
5. Set the same Gmail credentials on:
   - API service
   - inbox cron service

## Manual Trigger For Inbox Processing

You can manually run inbox processing by calling:

- `POST /api/cron/process-inbox`

If `PROCESS_INBOX_CRON_SECRET` is set, include either:

- `X-Cron-Secret: <secret>`
- `Authorization: Bearer <secret>`

## Deployment Checklist

1. Create Render Postgres.
2. Apply the repo blueprint.
3. Set API env vars.
4. Set web env vars.
5. Set inbox cron Gmail env vars.
6. Deploy.
7. Verify:
   - `GET /api/health`
   - StreetEasy Agent run works
   - send inquiry email works
   - inbox cron can run successfully
