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

1. **Google Cloud Console:** [Enable Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) for your project. Create OAuth 2.0 credentials (APIs & Services → Credentials → Create credentials → OAuth client ID; use Desktop or Web).
2. **OAuth 2.0 Playground:** Use the table above to get the refresh token with **both** `gmail.readonly` and `gmail.send` (e.g. “Read, compose, send” in the scope list).
3. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` on the API service and on the **re-sourcing-process-inbox** cron in Render.

### Inbox monitoring (replies and file storage)

- **What it does:** The **process-inbox** job reads your Gmail inbox, finds messages that look like replies to property inquiries (e.g. subject contains “Re: Inquiry about [address]”), matches them to canonical properties by address, and then:
  - Saves each reply as a row in `property_inquiry_emails` and stores attachment files under `INQUIRY_DOCS_PATH`.
  - Runs the LLM on the email body and on extracted text from attachments (e.g. PDFs) to pull out financials and merges them into the property’s rental financials.
- **Cron (auto deploy):** The blueprint defines **re-sourcing-process-inbox** (in `render.yaml`). It builds and runs like the permits cron; on each deploy it uses the latest code. Schedule: **daily at 9:00 UTC** (`0 9 * * *`). Set the same Gmail env vars (and `OPENAI_API_KEY`, optional `INQUIRY_DOCS_PATH`) on that cron service in the Render dashboard so the job can read Gmail and run the LLM.

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
- **Gmail send:** If “Send email” fails with an auth error, re-create the refresh token in OAuth 2.0 Playground with **gmail.send** included in the scopes.
- **Process-inbox and attachments:** Attachments are written to `INQUIRY_DOCS_PATH`. On Render, that directory may be ephemeral unless you use a persistent disk or external storage.
