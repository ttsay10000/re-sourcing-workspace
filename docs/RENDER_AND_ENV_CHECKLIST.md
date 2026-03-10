# Render and environment checklist

## What to set in Render (and locally)

### API service (backend)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Render Postgres or external). |
| `CORS_ORIGIN` | Yes | Comma-separated origins, e.g. `https://re-sourcing-web.onrender.com`. |
| `RAPIDAPI_KEY` | Yes (for rental) | NYC Real Estate API key (rentals/url, rentals/search). |
| `OPENAI_API_KEY` | Yes (for LLM) | Used for listing/inquiry financial extraction and broker enrichment. |
| **Gmail (inbox + send)** | | |
| `GMAIL_CLIENT_ID` | For inbox + send | OAuth2 client ID from Google Cloud Console. |
| `GMAIL_CLIENT_SECRET` | For inbox + send | OAuth2 client secret. |
| `GMAIL_REFRESH_TOKEN` | For inbox + send | From OAuth 2.0 Playground with **both** `gmail.readonly` and `gmail.send` scopes. |
| `GMAIL_REDIRECT_URI` | Optional | Must match the OAuth client’s redirect URI. Default: `https://developers.google.com/oauthplayground`. Only set if you use a different OAuth flow. |
| `PROCESS_INBOX_CRON_SECRET` | Optional | If set, `POST /api/cron/process-inbox` requires header `X-Cron-Secret` or `Authorization: Bearer <secret>`. |
| `INQUIRY_DOCS_PATH` | Optional | Base path for inquiry attachment files (default: `uploads/inquiry-docs`). On Render, use a path that persists or an external store. |
| `UPLOADED_DOCS_PATH` | Optional | Base path for property-uploaded docs (OM, Brochure, etc.). Default: `uploads/property-docs`. **New uploads also store file bytes in the DB** so downloads work on ephemeral disks (e.g. Render); no persistent disk required for new uploads. |
| **Document upload size** | | The API allows uploads up to 25 MB. **Render’s proxy may reject large request bodies** (e.g. 413) before they reach the app; if OM/brochure upload fails, try a smaller PDF (&lt;10 MB) or compress the file. Upload responds immediately; OM LLM analysis runs in the background so request timeout is not an issue. |
| **Optional** | | |
| `RENTAL_DEBUG` | No | Set to `1` to log 404/errors from rental API. |
| `RENTAL_SEARCH_FALLBACK` | No | Set to `1` to run rentals/search when building probe returns &lt;3 units. |
| `SOCRATA_APP_TOKEN` | No | NYC Open Data token for permits, zoning, HPD, etc. |
| `GEOCLIENT_SUBSCRIPTION_KEY` | No | NYC Geoclient for address → BBL. |

### Web (frontend)

| Variable | Required | Notes |
|----------|----------|--------|
| `NEXT_PUBLIC_API_URL` | Yes (prod) | API base URL, e.g. `https://re-sourcing-api.onrender.com`. |

### Gmail env: where to find each value

| Env variable | Where to get it |
|--------------|------------------|
| **GMAIL_CLIENT_ID** | [Google Cloud Console](https://console.cloud.google.com/) → your project → **APIs & Services** → **Credentials** → create or open **OAuth 2.0 Client ID** (Desktop or Web). Copy the **Client ID** (long string ending in `.apps.googleusercontent.com`). |
| **GMAIL_CLIENT_SECRET** | Same Credentials page as above → same OAuth client → click to view details → copy the **Client secret**. |
| **GMAIL_REFRESH_TOKEN** | [OAuth 2.0 Playground](https://developers.google.com/oauthplayground). Click the gear (⚙️) and check “Use your own OAuth credentials”, enter your **Client ID** and **Client secret**. In the left list, under “Gmail API v1” select **Read, compose, send** (or add both `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`). Click **Authorize APIs** → sign in with the Gmail account you want to use → **Exchange authorization code for tokens** → copy the **Refresh_token** (long string). Use this same account for sending and receiving. |

Set all three on the **API** service and on the **re-sourcing-process-inbox** cron service in Render (Dashboard → each service → Environment).

### Gmail setup (read inbox + send emails)

1. **Google Cloud Console:** [Enable Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) for your project. Create OAuth 2.0 credentials: **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**. Choose **Web application** (required for Playground). Under **Authorized redirect URIs** add `https://developers.google.com/oauthplayground`. Save.
2. **OAuth 2.0 Playground:** Use the table above to get the refresh token with **both** `gmail.readonly` and `gmail.send` (e.g. “Read, compose, send” in the scope list).
3. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` on the API service and on the **re-sourcing-process-inbox** cron in Render.

### Inbox monitoring (replies and file storage)

- **Where replies go:** When the **process-inbox** cron runs, it reads your Gmail inbox and matches messages to properties in three ways:
  1. **By subject:** Messages with subject like “Re: Inquiry about [address]” are matched to the property by that address.
  2. **By broker on record:** For each property that has a matched listing with broker/agent email in `agent_enrichment`, the job searches Gmail for messages **from that broker email** (from yesterday onward). Covers the primary agent and any **other listed team members** whose emails are in `agent_enrichment`.
  3. **By thread:** For each inquiry we sent (stored in `property_inquiry_sends` with a Gmail message ID), the job loads that message’s **thread** and attributes every reply in the thread to the same property. This covers **(1) broker replying from a different/alternate email** (e.g. personal vs work) and **(2) a teammate or other firm member replying** who isn’t the primary agent on the listing. Only messages from yesterday onward are saved; our own sent messages in the thread are skipped.
- **Date range:** Only messages **from yesterday onward** (UTC) are considered (`after:YYYY/M/D`). There is no “before” limit, so all future replies are included each run.
- **What gets saved:** For each matched message the job:
  - Inserts/updates a row in `property_inquiry_emails` (idempotent by Gmail `message_id`) with subject, from address, **date sent** (`received_at` from the message Date header), and body text.
  - Saves any **attachments** to disk under `INQUIRY_DOCS_PATH` and records them in `property_inquiry_documents`.
  - Runs the LLM on body + attachment text to extract financials and merge into the property’s rental data.
- **Cron (auto deploy):** The blueprint defines **re-sourcing-process-inbox** (in `render.yaml`). It builds and runs like the permits cron; on each deploy it uses the latest code. Schedule: **daily at 9:00 UTC** (`0 9 * * *`). Set the env vars below on that cron service in the Render dashboard.

### Process-inbox cron: setup checklist

To get the **re-sourcing-process-inbox** cron job running on Render:

1. **Create the cron from the blueprint**  
   Deploy from the repo; Render will create the `re-sourcing-process-inbox` cron service from `render.yaml`.

2. **Set environment variables** on the **re-sourcing-process-inbox** service (Dashboard → re-sourcing-process-inbox → Environment):

   | Variable | Required | Where to get it |
   |----------|----------|------------------|
   | `DATABASE_URL` | Yes | Usually auto-set from the linked Postgres database in the blueprint. If not, copy from the API service. |
   | `GMAIL_CLIENT_ID` | Yes | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID. |
   | `GMAIL_CLIENT_SECRET` | Yes | Same OAuth client → Client secret. |
   | `GMAIL_REFRESH_TOKEN` | Yes | [OAuth 2.0 Playground](https://developers.google.com/oauthplayground): use your OAuth client, select Gmail “Read, compose, send”, authorize, then copy **Refresh token**. Must be the same Gmail account used to send inquiry emails. |
   | `OPENAI_API_KEY` | Yes (for LLM) | Your OpenAI API key; used to extract financials from email body and attachments. |
   | `INQUIRY_DOCS_PATH` | Optional | Path where attachment files are saved (default: `uploads/inquiry-docs`). On Render, consider a path that persists if you add a disk. |

3. **Gmail API**  
   In Google Cloud Console, enable the **Gmail API** for your project. The OAuth client used for the refresh token must have **Gmail read** and **Gmail send** access (so the same token can be used by the API to send and by the cron to read inbox).

4. **Schedule**  
   The job is scheduled for **daily at 9:00 UTC** (`0 9 * * *`). You can change this in Render (Cron job → Schedule).

5. **Manual run**  
   In Render, open the cron job and use “Manual Deploy” to run it once, or call `POST /api/cron/process-inbox` on the API with `X-Cron-Secret: <PROCESS_INBOX_CRON_SECRET>` if you use that guard.

**Cron job spec (from `render.yaml`):** Name `re-sourcing-process-inbox`, runtime Node, schedule `0 9 * * *`, build `npm install --include=dev && npm run build -w @re-sourcing/contracts && npm run build -w @re-sourcing/db && npm run build -w @re-sourcing/api`, start `cd apps/api && node dist/scripts/triggerProcessInbox.js`. Link the same Postgres DB as the API for `DATABASE_URL`.

**Email date filter:** The job only processes inbox messages **from yesterday onward** (Gmail query `in:inbox after:YYYY/M/D`, date = yesterday UTC). There is no upper bound, so replies from brokers in the future are included on each run. Older messages are ignored so you can run it after turning on inquiry emails without reprocessing old mail.

**Broker matching:** Properties whose matched listing(s) have broker/agent emails in `agent_enrichment` are included. For each such email the job runs a Gmail search `from:<email> after:<yesterday>`. Any message from that broker (or another listed team member with an email in the same listing’s `agent_enrichment`) is saved to the property. If the same broker is on multiple properties, the first property found is used.

**Thread matching:** For sends in the last 90 days that have a Gmail message ID, the job fetches the thread and saves any **new** reply in that thread (from yesterday onward) to the property we sent to. So replies from the broker’s alternate address or from a teammate in the same thread are captured even if they’re not in `agent_enrichment`. Up to 50 threads are processed per run.

### Sending inquiry emails

- **Request info / OM by email:** The button appears for every property. Click it to open a draft (To, Subject, Body). Edit as needed (e.g. add your phone and email in the signature). Click **“Send email”** to send via Gmail API from your connected account. No email client is opened; the app sends the message for you. Replies are then picked up by the process-inbox cron when they arrive.

---

## Testing the flow

### 1. Rental + LLM (1–2 units)

From repo root with `RAPIDAPI_KEY` and `OPENAI_API_KEY` set:

```bash
RAPIDAPI_KEY=your_key OPENAI_API_KEY=your_key npx tsx apps/api/src/scripts/testFullFlowWithLogging.ts
```

Uses address **485 West 22nd Street**. You should see units with data (e.g. unit 2, 4), Listed/Last rented dates, and Status. To test another address, change `ADDRESS` in that script and run again.

### 2. Send inquiry email (test to tyler@stayhaus.co)

1. Open the **Property data** page and pick a canonical property.
2. Open the **Rental pricing / OM** section.
3. Click **“Request info / OM by email & track reply”**. A **modal** opens with an editable draft (To, Subject, Body) using the standard OM request template.
4. In **To**, enter `tyler@stayhaus.co` to test (or use the pre-filled broker email). Add your phone and email in the signature if desired.
5. Click **“Send email”**. The app sends the message via Gmail API. You should see success and the modal closes; confirm receipt at the To address.

### 3. Process-inbox (Gmail)

- Trigger manually: `POST /api/cron/process-inbox` with header `X-Cron-Secret: <PROCESS_INBOX_CRON_SECRET>` (if set).
- Requires `GMAIL_*` env vars. Messages are matched (1) by subject “Re: Inquiry about [address]” or (2) by From address = broker on record for a property. Matched emails are stored with send date and attachments.

---

## Possible bugs to watch

- **Broker email empty:** If the listing has no `agentEnrichment` (or no emails), the draft **To** is empty; user can type an address or run broker enrichment first.
- **Subject line:** Replies are first matched by subject. If the user changes the subject, that match fails; the reply can still be matched by **broker on record** (From address) if the property’s listing has that broker’s email in agent enrichment. The UI warns to keep the subject for consistency.
- **Gmail send:** If “Send email” fails with an auth error, re-create the refresh token with **gmail.send** and **gmail.readonly** in OAuth 2.0 Playground, then set the new `GMAIL_REFRESH_TOKEN` on the API. The UI now shows the backend error (e.g. invalid_grant, insufficient scopes) so you can confirm the cause.
- **`unauthorized_client`:** Usually means the OAuth client/redirect URI don't match how the refresh token was obtained. Fix: (1) In Google Cloud Console use a **Web application** OAuth client (not Desktop). (2) Add **Authorized redirect URI** `https://developers.google.com/oauthplayground`. (3) Get a new refresh token from [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) (gear → use your credentials, authorize, exchange for tokens). (4) Set the new `GMAIL_REFRESH_TOKEN` and same client ID/secret on the API and process-inbox cron.
- **Process-inbox and attachments:** Attachments are written to `INQUIRY_DOCS_PATH`. On Render, that directory may be ephemeral unless you use a persistent disk or external storage.
