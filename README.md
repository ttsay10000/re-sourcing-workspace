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

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run API + web concurrently (dev mode) |
| `npm run build` | Build all workspaces |
| `npm run start` | Build then run API + web (production style) |
| `npm run db:migrate` | Apply migrations (requires `DATABASE_URL`) |
| `npm run db:seed` | Seed DB (run after migrate) |

## Environment variables

| Where | Variable | Description |
|-------|----------|-------------|
| API | `PORT` | Server port (default `4000`) |
| API | `DATABASE_URL` | Postgres connection string (optional for health; required for DB routes) |
| API | `CORS_ORIGIN` | Allowed origins, comma-separated (default includes `http://localhost:3000`) |
| API | `NODE_ENV` | `development` / `production` |
| Web | `NEXT_PUBLIC_API_URL` | API base URL (e.g. `http://localhost:4000` locally, Render URL in prod) |

## Render deployment

1. **Blueprint**: Use `render.yaml` in the repo (or create two web services + one Postgres manually).
2. **API service**
   - Build: `npm install && npm run build -w @re-sourcing/contracts && npm run build -w @re-sourcing/api`
   - Start: `npm run start -w @re-sourcing/api`
   - Env: `DATABASE_URL` (from Postgres), `CORS_ORIGIN` = your web service URL (e.g. `https://re-sourcing-web.onrender.com`).
3. **Web service**
   - Build: `npm install && npm run build -w @re-sourcing/web`
   - Start: `npm run start -w @re-sourcing/web`
   - Env: `NEXT_PUBLIC_API_URL` = your API service URL (e.g. `https://re-sourcing-api.onrender.com`).
4. **Postgres**: Create a database and attach `DATABASE_URL` to the API service. The API starts even if the DB is empty; health does not require DB.

## One source of truth

- **DB tables/migrations**: `packages/db/migrations/` (placeholder in this skeleton).
- **Shared types**: `packages/contracts`
- **API contracts**: `packages/contracts` (TS interfaces only)

## Packages

- **@re-sourcing/contracts** – Types, enums, API request/response interfaces (including `HealthResponse`).
- **@re-sourcing/db** – Pool, config, repos, migrations placeholder.
