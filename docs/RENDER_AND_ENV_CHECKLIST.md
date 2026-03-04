# Render and environment checklist

## What to set in Render (and locally)

### API service (backend)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Render Postgres or external). |
| `CORS_ORIGIN` | Yes | Comma-separated origins, e.g. `https://re-sourcing-web.onrender.com`. |
| `RAPIDAPI_KEY` | Yes (for rental) | NYC Real Estate API key (rentals/url, rentals/search). |
| `OPENAI_API_KEY` | Yes (for LLM) | Used for listing/inquiry financial extraction and broker enrichment. |
| **Gmail (process-inbox)** | | |
| `GMAIL_CLIENT_ID` | For process-inbox | OAuth2 client ID from Google Cloud Console. |
| `GMAIL_CLIENT_SECRET` | For process-inbox | OAuth2 client secret. |
| `GMAIL_REFRESH_TOKEN` | For process-inbox | From OAuth 2.0 Playground (Gmail read scope). |
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

### Gmail setup (for process-inbox)

1. Google Cloud Console: create OAuth 2.0 credentials (Desktop or Web).
2. OAuth 2.0 Playground: use Gmail API v1, scope `https://www.googleapis.com/auth/gmail.readonly`, authorize, exchange code for refresh token.
3. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` in Render (and locally if you run process-inbox).

### What is NOT sent until the user acts

- **Email client:** The “Request info / OM by email” flow does **not** send any email from the app. It opens a **draft in a modal**; the user reviews and edits To/Subject/Body, then clicks **“Open in email client”**. Only then does the app open `mailto:` in the browser (user’s default email client). The email is sent only when the user sends it from that client.

---

## Testing the flow

### 1. Rental + LLM (1–2 units)

From repo root with `RAPIDAPI_KEY` and `OPENAI_API_KEY` set:

```bash
RAPIDAPI_KEY=your_key OPENAI_API_KEY=your_key npx tsx apps/api/src/scripts/testFullFlowWithLogging.ts
```

Uses address **485 West 22nd Street**. You should see units with data (e.g. unit 2, 4), Listed/Last rented dates, and Status. To test another address, change `ADDRESS` in that script and run again.

### 2. Email draft and client (test to tyler@stayhaus.co)

1. Open the **Property data** page and pick a canonical property (with or without rental data).
2. Open the **Rental pricing / OM** section.
3. Click **“Request info / OM by email & track reply”** (this only opens the modal; no email is sent).
4. A **modal** opens with a warning and an editable draft (To, Subject, Body).
5. In **To**, enter `tyler@stayhaus.co` to test delivery (or leave the pre-filled first primary broker email).
6. Review Subject and Body; edit if you like.
7. Click **“Open in email client”**. Your default email app should open with the draft. Send from the email client to verify the message is received at tyler@stayhaus.co.

This confirms: the email client is not triggered until “Open in email client” is clicked; you can review and edit the draft before opening the client.

### 3. Process-inbox (Gmail)

- Trigger manually: `POST /api/cron/process-inbox` with header `X-Cron-Secret: <PROCESS_INBOX_CRON_SECRET>` (if set).
- Requires `GMAIL_*` env vars. Inbox messages with subject like “Re: Inquiry about 416 West 20th Street” are matched to properties and stored with attachments.

---

## Possible bugs to watch

- **Broker email empty:** If the listing has no `agentEnrichment` (or no emails), the draft **To** is empty; user can type an address or run broker enrichment first.
- **Subject line:** Replies are matched by subject. If the user changes the subject, process-inbox may not match the reply; the UI warns to keep the subject.
- **mailto length:** Very long body can hit URL length limits; keep body under ~1–2k chars if issues appear.
- **Process-inbox and attachments:** Attachments are written to `INQUIRY_DOCS_PATH`. On Render, that directory may be ephemeral unless you use a persistent disk or external storage.
