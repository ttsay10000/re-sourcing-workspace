# @re-sourcing/db

Migrations, repositories, and seed for Phase 1. Uses `DATABASE_URL` (Render Postgres or local).

## Snapshot pruning

**Listing snapshots** use a **pruned flag** (no hard delete by default):

- `pruned = false`: normal snapshot, included in default list queries.
- `pruned = true`: logically pruned, excluded unless `includePruned: true` is passed.

This allows audit trail and optional undelete. Hard delete can be added later if required (e.g. GDPR); document in migrations.

## Commands

- **Build**: `npm run build` (from repo root or this package).
- **Migrate**: `npm run migrate` (run after build; requires `DATABASE_URL`).
- **Seed**: `npm run seed` (run after migrate; idempotent for listings due to upsert; may duplicate profiles/runs if run multiple times).

## Repositories

Import from `@re-sourcing/db`:

- `ProfileRepo` – create, byId, list, update
- `RunRepo` – create, byId, list, finish
- `JobRepo` – create, byId, listByRunId, start, finish
- `ListingRepo` – byId, bySourceAndExternalId, list, upsert, setLifecycle
- `SnapshotRepo` – byId, list, create, setPruned
- `PropertyRepo` – byId, byCanonicalAddress, list, create
- `MatchRepo` – byId, list, create, updateStatus
- `EventRepo` – list, emit

All repos accept `{ pool, client? }`. Pass a `client` when inside a transaction.

## Seed data

- 2 profiles (single-location vs multi area_codes)
- 2 ingestion runs (one completed, one failed) with jobs
- 20 StreetEasy-like listings + 3 manual-entry listings
- Duplicates/near-duplicates and listing–property matches for dedupe tests
- Snapshots pointing to `seed-payloads/<id>.json` (paths only; files optional)
