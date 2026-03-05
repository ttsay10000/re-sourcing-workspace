# Environment variables – API, Web, and Cron jobs

All variables for web services and **cron jobs**, and what to set for **local** vs **deployed** (e.g. Render).  
Set values in **Render Dashboard → [service name] → Environment**. The blueprint (`render.yaml`) declares which vars each service needs; variables marked `sync: false` must be set manually in the dashboard.

---

## Quick reference: env vars by Render service

| Service | Required | Optional | Notes |
|---------|----------|----------|--------|
| **re-sourcing-api** | `DATABASE_URL`, `CORS_ORIGIN`, `RAPIDAPI_KEY`, `OPENAI_API_KEY` | `GMAIL_*`, `SOCRATA_APP_TOKEN`, `PROCESS_INBOX_CRON_SECRET`, `INQUIRY_DOCS_PATH`, `GEOCLIENT_*`, `RENTAL_*` | Gmail needed for send-inquiry + process-inbox |
| **re-sourcing-web** | `NEXT_PUBLIC_API_URL` | — | |
| **re-sourcing-permits-refresh** (cron) | `DATABASE_URL` | `SOCRATA_APP_TOKEN`, `PERMITS_RATE_LIMIT_DELAY_MS`, `PERMITS_BATCH_SIZE` | Weekly enrichment; token improves rate limits |
| **re-sourcing-process-inbox** (cron) | `DATABASE_URL`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `OPENAI_API_KEY` | `INQUIRY_DOCS_PATH` | Daily Gmail inbox → properties |

---

## API service (`apps/api`)

Set these in `apps/api/.env` (local) or in the API service’s environment (e.g. Render dashboard).

| Variable | Required | What to put (local) | What to put (deployed) |
|----------|----------|---------------------|------------------------|
| **RAPIDAPI_KEY** | **Yes** (for Runs) | Your RapidAPI key from [NYC Real Estate API](https://rapidapi.com/realestator/api/nyc-real-estate-api) (subscribe → copy key) | Same: your RapidAPI key |
| **OPENAI_API_KEY** | **Yes** (for enrichment) | Your OpenAI API key (broker enrichment and price-history extraction) | Same: your OpenAI API key |
| **PORT** | No | Omit, or `4000` | Omit (Render sets port), or e.g. `4000` |
| **CORS_ORIGIN** | No | Omit (defaults to `http://localhost:3000` and `http://127.0.0.1:3000`) | Your **web** app URL, e.g. `https://re-sourcing-web.onrender.com` (comma-separated if multiple) |
| **DATABASE_URL** | No for API server | Omit unless you use DB routes | Omit unless you use DB; if so, your Postgres connection string (e.g. Render Postgres internal URL) |
| **NODE_ENV** | No | Omit, or `development` | `production` (often set by host) |
| **SOCRATA_APP_TOKEN** | No | Omit | Optional; NYC Open Data app token (improves rate limits for DOB permit enrichment) |
| **PERMITS_RATE_LIMIT_DELAY_MS** | No | Omit (default 300) | Delay in ms between property requests when batching permit enrichment (e.g. 500 for cron) |
| **PERMITS_BATCH_SIZE** | No | Omit (default 50) | Batch size for `enrich:permits --all` |

**Example `apps/api/.env` (local):**

```env
RAPIDAPI_KEY=your_actual_rapidapi_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

**Example API env (deployed, e.g. Render):**

```env
RAPIDAPI_KEY=your_actual_rapidapi_key_here
OPENAI_API_KEY=your_openai_api_key_here
CORS_ORIGIN=https://re-sourcing-web.onrender.com
```

---

## Web service (`apps/web`)

Set these in `apps/web/.env.local` (local) or in the Web service’s environment (e.g. Render).  
`NEXT_PUBLIC_*` values are baked in at **build** time; change them only before a new build.

| Variable | Required | What to put (local) | What to put (deployed) |
|----------|----------|---------------------|------------------------|
| **NEXT_PUBLIC_API_URL** | No | Omit (defaults to `http://localhost:4000`) | Your **API** base URL, e.g. `https://re-sourcing-api.onrender.com` (no trailing slash) |

**Example local:**  
Do nothing, or create `apps/web/.env.local` with:

```env
# Optional; omit to use http://localhost:4000
# NEXT_PUBLIC_API_URL=http://localhost:4000
```

**Example Web env (deployed, e.g. Render):**

```env
NEXT_PUBLIC_API_URL=https://re-sourcing-api.onrender.com
```

After changing `NEXT_PUBLIC_API_URL`, **rebuild and redeploy** the web app.

---

## Cron jobs (Render)

Set these in **Render Dashboard → [cron job name] → Environment**. `DATABASE_URL` is usually auto-set when the cron is linked to the same Postgres as the API.

### re-sourcing-permits-refresh (weekly: Sunday 3:00 UTC)

Refreshes DOB permits and all enrichment modules for canonical properties (`enrichAll.js --all`).

| Variable | Required | Value / notes |
|----------|----------|----------------|
| `DATABASE_URL` | Yes | Same as API (often auto from blueprint link). |
| `SOCRATA_APP_TOKEN` | Recommended | NYC Open Data app token; improves rate limits. [Create token](https://data.cityofnewyork.us). |
| `PERMITS_RATE_LIMIT_DELAY_MS` | No | In blueprint as `500`. Override if needed. |
| `PERMITS_BATCH_SIZE` | No | In blueprint as `50`. Override if needed. |

### re-sourcing-process-inbox (daily: 9:00 UTC)

Processes Gmail inbox for broker replies; matches to properties, saves emails and attachments, runs LLM.

| Variable | Required | Value / notes |
|----------|----------|----------------|
| `DATABASE_URL` | Yes | Same as API (often auto from blueprint link). |
| `GMAIL_CLIENT_ID` | Yes | Google Cloud OAuth 2.0 Client ID. |
| `GMAIL_CLIENT_SECRET` | Yes | Same OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Yes | From [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) with Gmail Read + Send; same account as API send-inquiry. |
| `OPENAI_API_KEY` | Yes | For extracting financials from email/attachments. |
| `INQUIRY_DOCS_PATH` | No | Where to store attachments (default `uploads/inquiry-docs`). |

---

## Public consumption / Render deployment (checklist)

For a public deployment (e.g. Render) you should set **all** of the following.

### 1. Render Postgres (database)

- In Render: **New → PostgreSQL**. Create a database.
- After it’s created, open it and copy the **Internal Database URL** (or External if your API runs outside Render).
- You will set this as **DATABASE_URL** on the **API** service.  
  (Runs are currently stored in memory; setting DATABASE_URL prepares the app for DB-backed features and migrations.)

### 2. API service (backend) – set these in Render dashboard

| Variable | What to put |
|----------|-------------|
| **RAPIDAPI_KEY** | Your RapidAPI key from [NYC Real Estate API](https://rapidapi.com/realestator/api/nyc-real-estate-api) |
| **OPENAI_API_KEY** | Your OpenAI API key (for broker enrichment and price-history extraction) |
| **CORS_ORIGIN** | Your **web** app URL, e.g. `https://your-web-app.onrender.com` (so the browser can call the API) |
| **DATABASE_URL** | The **Internal Database URL** from your Render Postgres (paste as-is; Render may inject it automatically if you link the DB to the service) |
| **PORT** | Leave blank (Render sets it) |

### 3. Web service (frontend) – set these in Render dashboard

| Variable | What to put |
|----------|-------------|
| **NEXT_PUBLIC_API_URL** | Your **API** app URL, e.g. `https://your-api.onrender.com` (no trailing slash). Rebuild/redeploy after changing. |

### 4. Order of operations

1. Create **Render Postgres**; note the database URL.
2. Create **API** (Web Service); connect repo, set build/start; add env vars: **RAPIDAPI_KEY**, **CORS_ORIGIN** = web URL, **DATABASE_URL** = Postgres URL.
3. Create **Web** (Web Service); connect repo, set build/start; add env var **NEXT_PUBLIC_API_URL** = API URL.
4. Deploy both. If you add DB migrations later, run them against the same **DATABASE_URL** (e.g. in API start or a one-off job).

---

## Summary

| Service | Variable | Local value | Deployed value |
|---------|----------|-------------|----------------|
| **API** | RAPIDAPI_KEY | Your RapidAPI key | Your RapidAPI key |
| **API** | OPENAI_API_KEY | Your OpenAI API key | Your OpenAI API key |
| **API** | PORT | Omit or `4000` | Omit (host sets it) |
| **API** | CORS_ORIGIN | Omit | Your web URL (e.g. `https://re-sourcing-web.onrender.com`) |
| **API** | DATABASE_URL | Omit unless using DB | **Render Postgres Internal (or External) URL** |
| **Web** | NEXT_PUBLIC_API_URL | Omit | Your API URL (e.g. `https://re-sourcing-api.onrender.com`) |

---

## Quick check

- **API up:** Open `http://localhost:4000/api/health` → should see `{"ok":true,...}`.
- **“Failed to fetch”:** Start both with `npm run dev`; ensure API has `RAPIDAPI_KEY`; if deployed, set `CORS_ORIGIN` on API and `NEXT_PUBLIC_API_URL` on Web and rebuild Web.
