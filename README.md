# RE Sourcing Workspace

Monorepo: web UI (Next.js) + API (Express) + shared packages. Deployable to Render.

## Repo structure

| Path | Description |
|------|-------------|
| `apps/api` | Express API (health, CORS; uses `DATABASE_URL`) |
| `apps/web` | Next.js admin UI (left nav: Profiles, Runs, Listings, Dedupe, Manual Entry) |
| `packages/contracts` | Shared TS types and API contracts |
| `packages/db` | DB client, repos, migrations placeholder |

## Local development

```bash
npm install
npm run dev
```

- **API** runs at `http://localhost:4000` (GET `/api/health` → `{ ok, version, env }`).
- **Web** runs at `http://localhost:3000` and calls the API for health on the home page.

Optional local Postgres:

```bash
docker compose up -d
# Then set DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

**First-time DB setup (Runs → Send to property data):** If you see "relation \"listings\" does not exist", create the schema by setting `DATABASE_URL` (e.g. in `.env` or your shell) and running from the repo root:

```bash
npm run db:migrate
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run API + web concurrently (dev mode) |
| `npm run build` | Build all workspaces |
| `npm run start` | Build then run API + web (production style) |
| `npm run db:migrate` | Apply migrations (requires `DATABASE_URL`) |
| `npm run db:seed` | Seed DB (run after migrate) |
| `npm run enrich:permits -w @re-sourcing/api -- --property-id <uuid>` | Enrich one property with DOB permits |
| `npm run enrich:permits -w @re-sourcing/api -- --all` | Batch enrich properties (optional `--batch-size N`) |

## Environment variables

| Where | Variable | Description |
|-------|----------|-------------|
| API | `PORT` | Server port (default `4000`) |
| API | `DATABASE_URL` | Postgres connection string (optional for health; required for DB routes) |
| API | `CORS_ORIGIN` | Allowed origins, comma-separated (default includes `http://localhost:3000`) |
| API | `NODE_ENV` | `development` / `production` |
| API | `SOCRATA_APP_TOKEN` | Optional; NYC Open Data app token (improves rate limits for permit enrichment) |
| API | `PERMITS_RATE_LIMIT_DELAY_MS` | Delay (ms) between property requests when batching (default 300 in API, 500 in cron) |
| API | `PERMITS_BATCH_SIZE` | Batch size for `enrich:permits --all` (default 50) |
| Web | `NEXT_PUBLIC_API_URL` | API base URL (e.g. `http://localhost:4000` locally, Render URL in prod) |

## Render deployment

1. **Blueprint**: Use `render.yaml` in the repo (or create two web services + one Postgres manually).
2. **Making sure cron jobs exist**: The blueprint defines two cron jobs (`re-sourcing-permits-refresh`, `re-sourcing-process-inbox`). For Render to **create** them you must apply the blueprint:
   - **Dashboard → Blueprint** → open the blueprint connected to this repo.
   - Click **Apply** (or **Sync** / **Update**) so Render creates any services in `render.yaml` that don’t exist yet (including the cron jobs).
   - If you created the API/Web/DB manually and never used the blueprint, use **New → Blueprint**, connect this repo, then Apply so all resources (including crons) are created.
3. **API service**
   - Build: `npm install && npm run build -w @re-sourcing/contracts && npm run build -w @re-sourcing/db && npm run build -w @re-sourcing/api`
   - Start: `npm run db:migrate && npm run start -w @re-sourcing/api` (migrations run automatically on each deploy; safe to run every time).
   - Env: `DATABASE_URL` (from Postgres), `CORS_ORIGIN` = your web service URL (e.g. `https://re-sourcing-web.onrender.com`).
4. **Web service**
   - Build: `npm install && npm run build -w @re-sourcing/web`
   - Start: `npm run start -w @re-sourcing/web`
   - Env: `NEXT_PUBLIC_API_URL` = your API service URL (e.g. `https://re-sourcing-api.onrender.com`).
5. **Postgres**: Create a database and attach `DATABASE_URL` to the API service. The API starts even if the DB is empty; health does not require DB.
6. **Cron jobs** (in `render.yaml`; created when you apply the blueprint):
   - **re-sourcing-permits-refresh** (weekly): DOB permit enrichment. Set `SOCRATA_APP_TOKEN` on the cron for better rate limits.
   - **re-sourcing-process-inbox** (daily): Process Gmail for broker replies and save to properties. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `OPENAI_API_KEY` (and optionally `DATABASE_URL` if not auto-linked). See `docs/RENDER_AND_ENV_CHECKLIST.md` for full setup.

## Deal Dossier & Deal Scoring

Profile, saved deals, deal score, and generate-dossier (Excel + dossier + optional email) require:

- **Database**: `DATABASE_URL` set and migrations applied (`npm run db:migrate`).
- **Profile**: In the app, set Profile (name, email) and Assumptions (or use "Generate standard leverage").
- **Email (optional)**: Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` on the API to email the generated dossier to the profile email.

Full checklist (env vars, Gmail OAuth, file storage, data prerequisites): **`docs/SETUP-DEAL-DOSSIER.md`**.

## One source of truth

- **DB tables/migrations**: `packages/db/migrations/` (placeholder in this skeleton).
- **Shared types**: `packages/contracts`
- **API contracts**: `packages/contracts` (TS interfaces only)

## Packages

- **@re-sourcing/contracts** – Types, enums, API request/response interfaces (including `HealthResponse`).
- **@re-sourcing/db** – Pool, config, repos, migrations placeholder.
