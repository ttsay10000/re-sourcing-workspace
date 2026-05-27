# Agent Contracts Handoff

Shared contract scope for parallel work on listing ingestion sources, OM review, neighborhood enrichment, and dossier/scoring.

## Listing Sources

- `ListingSource` now includes `loopnet` and `marcus_millichap`.
- `ListingSource` already included `nyc_api`, but the existing DB enum did not. Migration `048_listing_source_loopnet_marcus_millichap.sql` adds `nyc_api`, `loopnet`, and `marcus_millichap`.
- Until migration 048 is applied, DB writes to `listings.source` or `ingestion_jobs.source` with those values can fail.

Adapter contract:

- Source adapters should return `ListingSourceAdapterOutput<TExtra>`.
- Each item should use `ListingAdapterRecord.normalized`, which is a `ListingNormalized` plus a typed `extra`.
- Source-specific fields should go in `normalized.extra`, not new listing columns.
- Use `LoopNetListingExtra` and `MarcusMillichapListingExtra` for source-specific payloads. Put raw source fields under `rawAttributes` when they do not belong in a typed field.

## Neighborhood Container

- Property neighborhood enrichment belongs in `Property.details.neighborhood`.
- Use `PropertyNeighborhoodContainer.primary` for the selected canonical neighborhood.
- Use `sourceMatches` for alternate source-derived neighborhood names.
- Use `metrics` for scoring/dossier-safe metrics such as rent, sale, price-psf, cap-rate, income, walk/transit, and population.
- Use `sources` and `lastRefreshedAt` for provenance.
- No migration is required because `properties.details` is already JSONB.

## OM Review Statuses

`OmIngestionRunStatus` is:

- `queued`
- `processing`
- `completed`
- `needs_review`
- `promoted`
- `rejected`
- `failed`

Manual review transitions:

- `completed` or `needs_review` can move to `promoted`.
- `completed` or `needs_review` can move to `rejected`.
- `promoted` means the run has an active authoritative snapshot.
- `rejected` must not change the active authoritative snapshot.

`OmIngestionReviewOutcome` defines the minimal manual promote/reject decision payload. The current DB has `om_ingestion_runs.status` as `TEXT`, so `rejected` needs no enum migration.

## Migration Notes

Added low-risk migration:

- `048_listing_source_loopnet_marcus_millichap.sql`: additive `listing_source` enum values for `nyc_api`, `loopnet`, and `marcus_millichap`.

Unresolved OM review audit risk:

- `om_ingestion_runs` does not currently have a dedicated review/audit column.
- If Agents working on OM review need persisted reviewer metadata outside `source_meta`, add a later additive migration:

```sql
ALTER TABLE om_ingestion_runs
  ADD COLUMN IF NOT EXISTS review_outcome JSONB;

COMMENT ON COLUMN om_ingestion_runs.review_outcome IS
  'Manual OM review decision payload matching OmIngestionReviewOutcome.';
```

## Agent Handoff

- Agent A: use `ListingSourceAdapterOutput<LoopNetListingExtra>` for LoopNet ingestion.
- Agent B: use `ListingSourceAdapterOutput<MarcusMillichapListingExtra>` for Marcus & Millichap ingestion.
- Agent C: use the OM statuses above for manual promote/reject. Do not invent a separate rejected status.
- Agent D: write neighborhood enrichment to `Property.details.neighborhood`.
- Agent E: dossier/scoring should read neighborhood metrics from `details.neighborhood.metrics` and authoritative OM data from `details.omData.authoritative` when present.
- Agent F: apply migration 048 before inserting non-StreetEasy source rows; keep any further DB changes additive.

## Files Changed

- `packages/contracts/src/enums.ts`
- `packages/contracts/src/listing.ts`
- `packages/contracts/src/property.ts`
- `packages/db/migrations/048_listing_source_loopnet_marcus_millichap.sql`
- `docs/AGENT_CONTRACTS.md`
