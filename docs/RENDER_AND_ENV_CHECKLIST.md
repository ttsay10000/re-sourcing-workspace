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

- **Where replies go:** When the **process-inbox** cron runs, it reads your Gmail inbox, finds replies to property inquiries (subject like “Re: Inquiry about [address]”), matches them to the correct property by address, and then:
  - Saves each reply in the database (`property_inquiry_emails`) and stores attachment files on disk (under `INQUIRY_DOCS_PATH`).
  - Those attachments show up in the **Documents (from inquiry replies)** section on each property’s detail page (Rental pricing / OM). The LLM also runs on email body and attachment text to extract financials and merge them into the property’s rental data.
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

**Email date filter:** The job only processes inbox messages **from yesterday onward** (Gmail query `in:inbox after:YYYY/M/D`, date = yesterday UTC). Older messages are ignored so you can run it after turning on inquiry emails without reprocessing old mail.

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
- Requires `GMAIL_*` env vars. Inbox messages with subject like “Re: Inquiry about 416 West 20th Street” are matched to properties and stored with attachments.

---

## Possible bugs to watch

- **Broker email empty:** If the listing has no `agentEnrichment` (or no emails), the draft **To** is empty; user can type an address or run broker enrichment first.
- **Subject line:** Replies are matched by subject. If the user changes the subject, process-inbox may not match the reply; the UI warns to keep the subject.
- **Gmail send:** If “Send email” fails with an auth error, re-create the refresh token with **gmail.send** and **gmail.readonly** in OAuth 2.0 Playground, then set the new `GMAIL_REFRESH_TOKEN` on the API. The UI now shows the backend error (e.g. invalid_grant, insufficient scopes) so you can confirm the cause.
- **`unauthorized_client`:** Usually means the OAuth client/redirect URI don't match how the refresh token was obtained. Fix: (1) In Google Cloud Console use a **Web application** OAuth client (not Desktop). (2) Add **Authorized redirect URI** `https://developers.google.com/oauthplayground`. (3) Get a new refresh token from [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) (gear → use your credentials, authorize, exchange for tokens). (4) Set the new `GMAIL_REFRESH_TOKEN` and same client ID/secret on the API and process-inbox cron.
- **Process-inbox and attachments:** Attachments are written to `INQUIRY_DOCS_PATH`. On Render, that directory may be ephemeral unless you use a persistent disk or external storage.
