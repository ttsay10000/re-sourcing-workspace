# RE Sourcing Workspace

Monorepo for the StreetEasy Agent workflow, canonical property pipeline, rental/OM analysis, and deal dossier generation.

## Repo Structure

| Path | Description |
|------|-------------|
| `apps/api` | Express API for StreetEasy Agent ingestion, canonical properties, documents, inbox processing, and dossier/deal endpoints |
| `apps/web` | Next.js operator UI |
| `packages/contracts` | Shared TS types and API contracts |
| `packages/db` | DB config, migrations, and repositories |

## Core Flows

### 1. StreetEasy Agent

- UI path: `/runs`
- API path: `/api/test-agent/*`
- Purpose: run NYC Real Estate API search + sale-detail fetch, review results, then manually send them into raw listings

This flow is intentionally manual at the persistence boundary:

1. Run search
2. Review results
3. Click **Send to property data**

### 2. Property Data

- Raw listings live in `listings`
- Canonical properties are created from raw listings through `POST /api/properties/from-listings`
- `from-listings` still runs enrichment and rental flow automatically for newly created canonical properties
- Operators can also re-run:
  - enrichment
  - rental flow
  - OM financial refresh

### 3. Documents

There is one document surface for each property:

- inquiry reply attachments
- manual uploads
- generated outputs such as dossier / Excel

Use the unified routes under `/api/properties/:id/documents*`.
All new document types also store file bytes in Postgres, so they remain downloadable after Render restarts.
For older existing files created before this change, run `npm run backfill:documents -w @re-sourcing/api` before the next restart/deploy.

### 4. OM Extraction Priority

OM extraction can run from three places:

1. manual OM/Brochure upload
2. inbox reply processing
3. re-run enrichment

Manual upload is the preferred source of truth when there is a conflict or the inbox source is noisy/incomplete.

## Local Development

```bash
npm install
npm run dev
```

- API: `http://localhost:4000`
- Web: `http://localhost:3000`

Optional local Postgres:

```bash
docker compose up -d
```

Then set:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

Run migrations:

```bash
npm run db:migrate
```

## Main Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Run API + web locally |
| `npm run build` | Build all workspaces |
| `npm run start` | Production-style local start |
| `npm run db:migrate` | Apply DB migrations |
| `npm run db:seed` | Seed the DB |
| `npm run enrich:permits -w @re-sourcing/api -- --property-id <uuid>` | Re-run permit enrichment for one property |
| `npm run enrich:permits -w @re-sourcing/api -- --all` | Batch permit enrichment |
| `npm run enrich:all -w @re-sourcing/api -- --property-id <uuid>` | Full enrichment CLI for one property |

## Render Deployment

Use `render.yaml`.

Services defined:

- `re-sourcing-api`
- `re-sourcing-web`
- `re-sourcing-process-inbox`
- `re-sourcing-db`

The weekly enrich-all cron has been removed. Canonical property enrichment happens during `from-listings`, and operators can manually re-run enrichment from the app.

See [docs/RENDER_AND_ENV_CHECKLIST.md](/Users/tylertsay/Desktop/Coding%20projects/Real%20Estate%20Sourcing%20Flow/RE%20Sourcing%20Workspace/docs/RENDER_AND_ENV_CHECKLIST.md) for deployment setup.

## Reference Docs

- [docs/API_AND_DATA_FLOW.md](/Users/tylertsay/Desktop/Coding%20projects/Real%20Estate%20Sourcing%20Flow/RE%20Sourcing%20Workspace/docs/API_AND_DATA_FLOW.md)
- [docs/RENDER_AND_ENV_CHECKLIST.md](/Users/tylertsay/Desktop/Coding%20projects/Real%20Estate%20Sourcing%20Flow/RE%20Sourcing%20Workspace/docs/RENDER_AND_ENV_CHECKLIST.md)
- [docs/SETUP-DEAL-DOSSIER.md](/Users/tylertsay/Desktop/Coding%20projects/Real%20Estate%20Sourcing%20Flow/RE%20Sourcing%20Workspace/docs/SETUP-DEAL-DOSSIER.md)
- [apps/api/src/rental/FINANCIAL_FLOWS.md](/Users/tylertsay/Desktop/Coding%20projects/Real%20Estate%20Sourcing%20Flow/RE%20Sourcing%20Workspace/apps/api/src/rental/FINANCIAL_FLOWS.md)
