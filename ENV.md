# Environment variables – API and Web

All variables for both services and what to set for **local** vs **deployed** (e.g. Render).

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
